import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import SwaggerParser from "@apidevtools/swagger-parser";
import { buildOpenApi, collectApiRoutes, operationDetails, setupApiDocs } from "../server/openapi.js";
import { applicationRouteInventory } from "./helpers/applicationRouteInventory.js";

const inventory = applicationRouteInventory();
const document = buildOpenApi(inventory.routes);
const endpoint = (path, method = "post") => document.paths[path][method];
const body = (path, method = "post", media = "application/json") => endpoint(path, method).requestBody.content[media].schema;
const output = (path, method = "get") => endpoint(path, method).responses[200].content["application/json"].schema;

test("every current handler has an explicit response contract, not just an inventory entry", () => {
  const registered = new Set();
  for (const { method, path } of inventory.routes) {
    const key = `${method.toUpperCase()} ${path}`;
    assert.ok(!registered.has(key), `Duplicate registration: ${key}`);
    registered.add(key);
    assert.ok(operationDetails[key]?.responses?.[200]?.content, `${key} needs a success contract`);
  }
  for (const key of Object.keys(operationDetails)) {
    assert.ok(registered.has(key), `Documented operation no longer registered: ${key}`);
  }
});

test("real startup includes auth, application and conditional LINE routes without running workers", () => {
  assert.equal(inventory.listenCalls, 1);
  assert.deepEqual(inventory.servedSpec, document, "Startup must snapshot documentation after every application route is mounted");
  assert.equal(inventory.timers.length, 3, "LINE timers are recorded, never scheduled");
  const withoutLine = applicationRouteInventory({ lineEnabled: false });
  assert.deepEqual(withoutLine.servedSpec, buildOpenApi(withoutLine.routes));
  assert.equal(withoutLine.timers.length, 0);
  const keys = routes => routes.map(r => `${r.method} ${r.path}`).sort();
  assert.deepEqual(keys(withoutLine.routes), keys(inventory.routes.filter(r => r.path !== "/api/line/webhook")));
  for (const key of [
    "post /api/login", "get /api/auth/user", "get /api/tasks",
    "post /api/memos", "post /api/reflection-summary", "get /api/health/office",
    "post /api/line/webhook",
  ]) assert.ok(keys(inventory.routes).includes(key), `Missing common operation: ${key}`);
  assert.deepEqual(inventory.routes.filter(r => r.path === "/api/webhook/in/:token").map(r => r.method).sort(),
    ["delete", "get", "head", "options", "patch", "post", "put", "trace"]);
});

test("full inventory preserves unique operation IDs and every required path parameter", async () => {
  await SwaggerParser.validate(structuredClone(document));
  const ids = new Set();
  let operationCount = 0;
  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      const label = `${method.toUpperCase()} ${path}`;
      operationCount++;
      assert.ok(operation.operationId, `${label}: missing operationId`);
      assert.ok(!ids.has(operation.operationId), `${label}: duplicate operationId`);
      ids.add(operation.operationId);
      const expected = [...path.matchAll(/\{([^}]+)\}/g)].map(m => m[1]).sort();
      const params = operation.parameters.filter(p => p.in === "path");
      assert.deepEqual(params.map(p => p.name).sort(), expected, `${label}: path parameters`);
      for (const param of params) {
        assert.equal(param.required, true, `${label}: ${param.name} must be required`);
        assert.ok(param.schema, `${label}: ${param.name} needs a schema`);
      }
    }
  }
  assert.equal(operationCount, inventory.routes.length, "No registered operation may disappear during export");
});

test("security and administrator metadata match the real registered handlers", () => {
  const userSecurity = [{ bearerAuth: [] }, { sessionCookie: [] }];
  // These handlers validate credentials internally instead of using middleware.
  // Keep this independent of operationDetails so a documentation edit can fail.
  const internalSecurity = {
    "GET /api/auth/user": userSecurity,
    "POST /api/share-receive": [{ shareToken: [] }],
    "POST /api/expenses/auto-capture": [{ shareToken: [] }],
    "POST /api/email/webhook": [{ emailWebhookHeader: [] }, { emailWebhookQuery: [] }],
    "POST /api/line/webhook": [{ lineSignature: [] }],
  };
  let adminCount = 0;
  for (const { method, path, handlers } of inventory.routes) {
    const key = `${method.toUpperCase()} ${path}`;
    const operation = document.paths[path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")][method];
    const admin = handlers.includes("isAdmin");
    const authenticated = admin || handlers.includes("isAuthenticated");
    assert.deepEqual(operation.security, authenticated ? userSecurity : (internalSecurity[key] || []), key);
    assert.equal(operation.description.includes("Administrator access is required."), admin, key);
    if (admin) {
      adminCount++;
      assert.equal(operation.responses[403].description, "Administrator access required", key);
      assert.ok(operation.responses[403].content["application/json"], key);
    }
  }
  assert.ok(adminCount > 0, "Inventory must exercise real administrator handlers");
});

test("required fields reflect create, partial update, and alternative inputs", () => {
  assert.deepEqual(body("/api/signup").required, ["email", "password", "name"]);
  assert.equal(body("/api/signup").properties.password.minLength, 6);
  assert.deepEqual(body("/api/tasks").required, ["name", "date"]);
  assert.equal(body("/api/tasks/{id}", "put").required, undefined);
  assert.deepEqual(body("/api/blood-pressure").required, ["date", "sys", "dia", "pulse"]);
  assert.equal(body("/api/blood-pressure").properties.sys.maximum, 300);
  assert.equal(body("/api/steps").properties.steps.maximum, 200000);
  assert.deepEqual(body("/api/milestones/{id}", "put").required, ["title", "date"]);
  assert.deepEqual(body("/api/career/jobs").anyOf, [{ required: ["company"] }, { required: ["role"] }]);
  assert.deepEqual(body("/api/office/jobs").required, ["skillKey", "actionType"]);
  assert.deepEqual(body("/api/whiteboards/{id}/memos/bulk-move").required, ["placementIds", "targetWhiteboardId"]);
  assert.equal(body("/api/muse/spec-builder-questions", "put").properties.questions.nullable, true);
  assert.equal(endpoint("/api/podcasts/episodes/{id}/transcript").requestBody.required, false);
});

test("query parameters include filters, aliases, bounded limits and OAuth callback inputs", () => {
  const params = (path, method = "get") => Object.fromEntries(endpoint(path, method).parameters.filter(p => p.in === "query").map(p => [p.name, p]));
  assert.equal(params("/api/office/jobs").limit.schema.default, 80);
  assert.equal(params("/api/office/jobs").limit.schema.maximum, 200);
  assert.equal(params("/api/expenses/audit-log").limit.schema.maximum, 50);
  assert.deepEqual(Object.keys(params("/api/sleep")), ["from", "to"]);
  assert.ok(params("/api/muse/memories").source_conversation_id);
  assert.ok(params("/api/muse/memories").sourceConversationId);
  assert.ok(params("/api/tasks/{id}", "put").applyTo);
  assert.ok(params("/api/tasks/{id}", "delete").scope);
  assert.equal(params("/api/nutrition/lookup").name.required, true);
  assert.equal(params("/api/rss/fetch").url.required, true);
  assert.equal(params("/api/gmail/callback").code.required, true);
  assert.equal(params("/api/gmail/callback").state.required, true);
});

test("uploads use the exact multipart fields and optional share attachments", () => {
  for (const path of ["/api/tasks/{id}/files", "/api/memos/{id}/files"]) {
    const schema = body(path, "post", "multipart/form-data");
    assert.deepEqual(schema.required, ["file"]);
    assert.equal(schema.properties.file.format, "binary");
  }
  for (const path of ["/api/ocr", "/api/muse/chat-with-image", "/api/expenses/import-image", "/api/blood-pressure/import-image", "/api/steps/import-image", "/api/sleep/import-image"]) {
    const schema = body(path, "post", "multipart/form-data");
    assert.deepEqual(schema.required, ["image"]);
    assert.equal(schema.properties.image.format, "binary");
  }
  assert.equal(body("/api/muse/chat-with-image", "post", "multipart/form-data").properties.conversationId.type, "string");
  assert.equal(body("/api/share-receive", "post", "multipart/form-data").required, undefined);
  assert.ok(endpoint("/api/share-receive").requestBody.content["application/json"]);
});

test("stream and download responses do not pretend to be JSON", () => {
  for (const path of ["/api/muse/chat", "/api/muse/chat-with-image", "/api/health/ai-summary"]) {
    const responses = endpoint(path).responses;
    assert.equal(responses[200].content["text/event-stream"].schema.type, "string");
    assert.equal(responses[200].content["application/json"], undefined);
    assert.ok(responses[500].content["application/json"]);
  }
  assert.ok(endpoint("/api/last30days/runs/{id}/raw", "get").responses[200].content["text/html"]);
  assert.ok(endpoint("/api/share-shortcut", "get").responses[200].content["application/x-apple-shortcut"]);
  assert.equal(endpoint("/api/file-data/{filename}", "get").responses[200].content["*/*"].schema.format, "binary");
  assert.ok(endpoint("/api/gmail/callback", "get").responses[400].content["text/html"]);
});

test("response schemas preserve real projections, nested fields and snake_case SQL results", () => {
  assert.equal(output("/api/tasks").items.properties.subtasks.type, "array");
  assert.equal(output("/api/tasks").items.properties.files.items.properties.data, undefined);
  assert.equal(output("/api/memos").items.properties.tags.items.type, "string");
  assert.equal(output("/api/memos/by-date/{date}").items.properties.tags.items.properties.tag.type, "string");
  assert.equal(output("/api/muse/memories").items.properties.source_conversation_id.type, "integer");
  assert.equal(output("/api/muse/memories").items.properties.sourceConversationId, undefined);
  assert.equal(output("/api/podcasts/shows").items.properties.episodeCount.type, "integer");
  assert.equal(output("/api/podcasts/notes").items.properties.timedNotes.type, "array");
  assert.equal(output("/api/expenses/auto-capture", "post").properties.total.type, "string");
  assert.equal(output("/api/expenses/auto-capture", "post").properties.expense, undefined);
  assert.equal(output("/api/last30days/subscriptions").items.properties.lastEnqueuedAt.format, "date-time");
  assert.equal(output("/api/whiteboards/overview").properties.boards.items.properties.snapshot.properties.connections.type, "array");
  assert.equal(output("/api/user").properties.password, undefined);
  assert.equal(output("/api/user").properties.pin, undefined);
  assert.equal(output("/api/auth/user").properties.tzExpandedGroups.type, "array");
  assert.equal(output("/api/expenses/parse", "post").type, undefined, "Unvalidated model JSON must not acquire an invented fixed shape");
});

test("special credentials and meaningful error statuses survive export", () => {
  assert.deepEqual(endpoint("/api/share-receive").security, [{ shareToken: [] }]);
  assert.equal(document.components.securitySchemes.shareToken.name, "x-share-token");
  assert.deepEqual(endpoint("/api/email/webhook").security, [{ emailWebhookHeader: [] }, { emailWebhookQuery: [] }]);
  assert.equal(document.components.securitySchemes.lineSignature.name, "x-line-signature");
  assert.ok(endpoint("/api/podcasts/shows").responses[409].content["application/json"].schema.properties.show);
  assert.ok(endpoint("/api/expenses/auto-capture").responses[429]);
  assert.ok(endpoint("/api/sleep/import-image").responses[422]);
  assert.ok(endpoint("/api/video-notes/import").responses[502]);
  assert.ok(endpoint("/api/muse/chat").responses[403]);
  assert.ok(endpoint("/api/webhook/in/{token}", "get").responses[404]);
  assert.equal(endpoint("/api/tasks/{id}", "put").parameters[0].schema.type, "integer");
  assert.equal(endpoint("/api/webhook/in/{token}", "get").parameters[0].schema.type, "string");
});

test("OpenAPI common contracts validate and retain security/path parameters", async () => {
  const spec = buildOpenApi(inventory.routes);
  await SwaggerParser.validate(spec);
  assert.deepEqual(spec.paths["/api/login"].post.security, []);
  assert.equal(spec.servers[0].url, "/");
  assert.deepEqual(spec.paths["/api/tasks"].get.security, [{ bearerAuth: [] }, { sessionCookie: [] }]);
  assert.equal(spec.paths["/api/last30days/runs/{id}"].get.parameters[0].required, true);
  assert.ok(spec.paths["/api/health/office"].get.responses[403]);
  assert.ok(spec.paths["/api/reflection-summary"].post.requestBody.content["application/json"].schema.required.includes("entries"));
});

test("documentation and locally served Swagger assets work over HTTP", async t => {
  const app = express();
  const router = express.Router();
  router.get("/api/example/:id", function isAuthenticated(_req, _res, next) { next(); }, (_req, res) => res.json({}));
  router.all("/api/webhook/in/:token", (_req, res) => res.json({}));
  app.use(router);
  assert.equal(collectApiRoutes(app._router.stack).length, 9);
  setupApiDocs(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/openapi.json`);
  assert.equal(response.status, 200);
  const spec = await response.json();
  await SwaggerParser.validate(spec);
  assert.ok(spec.paths["/api/example/{id}"]);
  const docs = await fetch(`${base}/api/docs`);
  assert.match(await docs.text(), /swagger-ui/);
  for (const file of ["swagger-ui.css", "swagger-ui-bundle.js", "swagger-ui-init.js"]) {
    const asset = await fetch(`${base}/api/docs/${file}`);
    assert.equal(asset.status, 200);
    if (file === "swagger-ui-init.js") assert.match(await asset.text(), /\/api\/openapi\.json/);
  }
});
