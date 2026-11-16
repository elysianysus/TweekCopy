import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import express from "express";
import { PgDialect } from "drizzle-orm/pg-core";

// Bundle only the real route + service, replacing external I/O. No database,
// credentials or paid model requests are needed; SQL parameters still determine
// cache identity, so changes to the service's cache lookup are exercised.
async function setup(t) {
  const state = { cache: new Map(), calls: [], sql: [], writes: [], modelError: null, modelResponse: undefined, writeError: null };
  const dialect = new PgDialect();
  const db = { async execute(query) {
    const { sql, params } = dialect.sqlToQuery(query);
    state.sql.push(sql);
    const key = JSON.stringify(params.slice(0, 4));
    if (/CREATE /i.test(sql)) return { rows: [] };
    if (/SELECT rating/i.test(sql)) return { rows: [] };
    if (/SELECT summary/i.test(sql)) {
      return { rows: state.cache.has(key) ? [{ summary: state.cache.get(key) }] : [] };
    }
    if (/INSERT INTO reflection_summary_cache/i.test(sql)) {
      state.writes.push(params[4]);
      if (state.writeError) throw state.writeError;
      state.cache.set(key, params[4]);
      return { rows: [] };
    }
    if (/DELETE FROM reflection_summary_cache/i.test(sql)) {
      state.cache.delete(key);
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }};
  const result = await build({
    entryPoints: ["server/reflectionSummaryRoute.js"], bundle: true,
    platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{
      name: "isolated-reflection-io",
      setup(builder) {
        builder.onResolve({ filter: /^(openai|\.\/db\.js)$/ }, args => ({
          path: args.path, namespace: "test-io",
        }));
        builder.onLoad({ filter: /.*/, namespace: "test-io" }, args => ({
          contents: args.path === "openai"
            ? "export default class OpenAI { constructor() { this.chat = { completions: { create: (...args) => globalThis.__io.complete(...args) } }; } }"
            : "export const db = globalThis.__io.db;",
        }));
      },
    }],
  });
  // Evaluate the isolated bundle with its own global object, not process globals.
  const { createRequire } = await import("node:module");
  const module = { exports: {} };
  const io = { db, complete: async payload => {
    state.calls.push(payload);
    if (state.modelError) throw state.modelError;
    if (state.modelResponse !== undefined) return state.modelResponse;
    return { choices: [{ message: { content: `Theme generation ${state.calls.length}` } }] };
  }};
  new Function("require", "module", "exports", "globalThis", result.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports, { __io: io },
  );
  const app = express();
  app.use(express.json());
  app.post("/api/reflection-summary", (req, res, next) => {
    req.userId = Number(req.get("x-test-user") || 1001);
    next();
  }, module.exports.reflectionSummaryHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const payload = {
    weekStart: "2026-05-11", promptId: "change", promptLabel: "想改變的事",
    entries: [
      { ds: "2026-05-11", text: "- focused reading\n- focused writing" },
      { ds: "2026-05-12", text: "- focused learning" },
    ],
  };
  async function post(body, uid = 1001, status = 200) {
    const response = await fetch(`${base}/api/reflection-summary`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-test-user": String(uid) },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, status);
    return response.json();
  }
  return { state, payload, post };
}

test("reflection-summary HTTP: sparse skip, cache reuse and edit invalidation", async (t) => {
  const { state, payload, post } = await setup(t);
  assert.deepEqual(await post({ ...payload, entries: [] }), { summary: "", cached: false, skipped: "empty" });
  assert.deepEqual(await post({ ...payload, entries: [payload.entries[0]] }), { summary: "", cached: false, skipped: "sparse" });
  assert.equal(state.calls.length, 0);
  assert.equal(state.sql.length, 0, "sparse weeks should not access the cache");
  const first = await post(payload);
  assert.equal(first.cached, false);
  assert.equal(first.summary, "Theme generation 1");
  assert.deepEqual(await post(payload), { ...first, cached: true });
  assert.deepEqual(await post({ ...payload, entries: [...payload.entries].reverse() }), { ...first, cached: true });
  assert.equal(state.calls.length, 1);
  const edited = { ...payload, entries: [{ ...payload.entries[0], text: "- focused rest\n- focused exercise" }, payload.entries[1]] };
  assert.deepEqual(await post(edited), { summary: "Theme generation 2", cached: false });
  assert.equal(state.calls.length, 2);
  assert.match(state.calls[1].messages[1].content, /focused exercise/);
  assert.equal((await post(edited)).cached, true);
  for (const [body, uid] of [[payload, 1002], [{ ...payload, promptId: "start" }, 1001], [{ ...payload, weekStart: "2026-05-18" }, 1001]]) {
    assert.equal((await post(body, uid)).cached, false, "cache must isolate user, prompt and week");
  }
  assert.equal(state.calls.length, 5);
  await post({ ...payload, entries: null }, 1001, 400);
  await post({ entries: [] }, 1001, 400);
  assert.equal(state.calls.length, 5);
});

test("reflection-summary HTTP: model exception returns fallback without caching and can recover", async (t) => {
  const { state, payload, post } = await setup(t);
  state.modelError = new Error("Mock model unavailable");
  assert.deepEqual(await post(payload), { summary: "", cached: false, error: "Mock model unavailable" });
  assert.equal(state.calls.length, 1);
  assert.deepEqual(state.writes, []);
  assert.equal(state.cache.size, 0);

  state.modelError = null;
  const recovered = await post(payload);
  assert.deepEqual(recovered, { summary: "Theme generation 2", cached: false });
  assert.deepEqual(await post(payload), { ...recovered, cached: true });
  assert.equal(state.calls.length, 2);
});

for (const [label, response] of [
  ["empty string", { choices: [{ message: { content: "" } }] }],
  ["whitespace", { choices: [{ message: { content: " \n\t " } }] }],
  ["quotes only", { choices: [{ message: { content: '""' } }] }],
  ["null content", { choices: [{ message: { content: null } }] }],
  ["missing choices", {}],
]) {
  test(`reflection-summary HTTP: ${label} returns empty_response without caching`, async (t) => {
    const { state, payload, post } = await setup(t);
    state.modelResponse = response;
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.deepEqual(await post(payload), { summary: "", cached: false, skipped: "empty_response" });
    }
    assert.equal(state.calls.length, 2, "empty responses must not suppress later model attempts");
    assert.deepEqual(state.writes, []);
    assert.equal(state.cache.size, 0);
    state.modelResponse = undefined;
    const recovered = await post(payload);
    assert.deepEqual(recovered, { summary: "Theme generation 3", cached: false });
    assert.deepEqual(await post(payload), { ...recovered, cached: true });
    assert.equal(state.calls.length, 3);
  });
}

test("reflection-summary HTTP: cache-write failure preserves generated summary and retries later", async (t) => {
  const { state, payload, post } = await setup(t);
  state.writeError = new Error("Mock cache write unavailable");
  for (let attempt = 1; attempt <= 2; attempt++) {
    assert.deepEqual(await post(payload), { summary: `Theme generation ${attempt}`, cached: false });
    assert.equal(state.cache.size, 0);
  }
  assert.equal(state.calls.length, 2);
  assert.deepEqual(state.writes, ["Theme generation 1", "Theme generation 2"]);
  state.writeError = null;
  const recovered = await post(payload);
  assert.deepEqual(recovered, { summary: "Theme generation 3", cached: false });
  assert.deepEqual(await post(payload), { ...recovered, cached: true });
  assert.equal(state.calls.length, 3);
  assert.equal(state.cache.size, 1);
});
