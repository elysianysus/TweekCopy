import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createContext, Script } from "node:vm";
import { transformSync } from "esbuild";
import express from "express";
import * as openapi from "../../server/openapi.js";

const serverDir = fileURLToPath(new URL("../../server/", import.meta.url));
const require = createRequire(import.meta.url);
const realModules = new Set(["index.js", "routes.js", "auth.js", "lineBot.js", "schema.js", "memoKnowledge.js"]);
const safePackages = new Set([
  "path", "url", "crypto", "drizzle-orm", "drizzle-orm/pg-core", "multer",
]);

// Execute the actual startup registration order, but never its listen callback.
// Only explicitly allowed modules can load: db/provider/worker modules cannot
// even be imported, and unexpected calls to their stand-ins fail immediately.
export function applicationRouteInventory({ lineEnabled = true } = {}) {
  const app = express();
  const timers = [];
  let listenCalls = 0;
  app.listen = () => { listenCalls++; };
  const blocked = label => {
    const fn = function () { throw new Error(`Inventory attempted I/O: ${label}`); };
    Object.defineProperty(fn, "name", { value: label.split(".").at(-1) });
    return fn;
  };
  const mocks = new Map();
  const mockModule = name => {
    if (!mocks.has(name)) {
      const members = new Map();
      mocks.set(name, new Proxy({}, {
        get(_target, key) {
          if (key === "__esModule") return true;
          if (!members.has(key)) members.set(key, blocked(`${name}.${String(key)}`));
          return members.get(key);
        },
      }));
    }
    return mocks.get(name);
  };
  class ProviderStub {} // Constructors are inert; any provider API use fails.
  const session = () => function inventorySession(_req, _res, next) { next(); };
  const context = createContext({
    console: { log() {}, warn() {}, error() {} },
    process: { env: {
      NODE_ENV: "test", SESSION_SECRET: "inventory-only-not-a-real-secret",
      ...(lineEnabled ? { LINE_CHANNEL_SECRET: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" } : {}),
    } },
    Buffer, URL, URLSearchParams,
    fetch: blocked("fetch"),
    setTimeout: blocked("setTimeout"),
    setInterval: (_callback, delay) => { timers.push(delay); return timers.length; },
    clearInterval() {},
  });
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const localRequire = specifier => {
      if (specifier === "express") return Object.assign(() => app, express);
      if (specifier === "express-session") return session;
      if (specifier === "connect-pg-simple") return () => class InertSessionStore {};
      if (specifier === "openai" || specifier === "@anthropic-ai/sdk") return ProviderStub;
      if (specifier === "@google/genai") return { GoogleGenAI: ProviderStub };
      if (specifier === "module") return { createRequire: () => name => mockModule(name) };
      if (safePackages.has(specifier)) return require(specifier);
      if (specifier.startsWith(".")) {
        const target = resolve(dirname(filename), specifier);
        if (target === resolve(serverDir, "openapi.js")) return openapi;
        if (dirname(target) === serverDir.replace(/\/$/, "") && realModules.has(target.split("/").at(-1))) {
          return load(target);
        }
      }
      return mockModule(specifier);
    };
    const { code } = transformSync(readFileSync(filename, "utf8"), {
      format: "cjs", platform: "node", sourcefile: filename,
      define: { "import.meta.url": JSON.stringify(pathToFileURL(filename).href) },
    });
    new Script(`(function(require, module, exports) {${code}\n})`, { filename })
      .runInContext(context)(localRequire, module, module.exports);
    return module.exports;
  }
  load(resolve(serverDir, "index.js"));
  const docsRoute = app._router.stack.find(layer => layer.route?.path === "/api/openapi.json");
  if (!docsRoute) throw new Error("Application startup did not register /api/openapi.json");
  let servedSpec;
  // Invoke only the read-only documentation handler, never application handlers.
  docsRoute.route.stack[0].handle({}, { json(spec) { servedSpec = spec; } });
  // Docs are registered after the snapshot, so exclude only the docs endpoint.
  const routes = openapi.collectApiRoutes(app._router.stack)
    .filter(route => route.path !== "/api/openapi.json");
  return { routes, servedSpec, timers, listenCalls };
}
