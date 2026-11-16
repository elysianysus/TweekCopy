import swaggerUi from "swagger-ui-express";
import { core } from "./openapi/core.js";
import { memoKnowledge } from "./openapi/memoKnowledge.js";
import { ai } from "./openapi/ai.js";
import { health } from "./openapi/health.js";
import { integrations } from "./openapi/integrations.js";
import { operations } from "./openapi/operations.js";
import { error as errorSchema } from "./openapi/schema.js";
import { addErrorResponses } from "./openapi/errors.js";

const string = { type: "string" };
const object = properties => ({ type: "object", properties });
const jsonBody = (schema, example, required = true) => ({
  required, content: { "application/json": { schema, ...(example ? { example } : {}) } },
});
const response = (description, schema) => ({
  description, ...(schema ? { content: { "application/json": { schema } } } : {}),
});
const entries = {
  type: "array", items: {
    ...object({ ds: string, text: string }), required: ["ds", "text"],
  },
};
const summaryInput = {
  ...object({ weekStart: string, promptId: string, promptLabel: string, entries, regenerate: { type: "boolean", default: false } }),
  required: ["weekStart", "promptId", "entries"],
};
const researchInput = {
  ...object({ topic: { type: "string", minLength: 1, maxLength: 280 }, sources: { type: "array", items: string } }),
  required: ["topic"],
};

// Hand-verified contracts, grouped by domain. Runtime collection only discovers
// paths/security; it never guesses request or response fields from handler text.
export const operationDetails = {
  ...memoKnowledge,
  "POST /api/login": {
    summary: "Log in and obtain a Bearer token",
    security: [],
    description: "Returns a token and sets a session cookie. In Swagger, copy the returned token into Authorize (without the Bearer prefix). Tokens are not persisted by this documentation page.",
    requestBody: jsonBody({ ...object({ email: { type: "string", format: "email" }, password: { type: "string", format: "password" } }), required: ["email", "password"] }),
    responses: {
      200: response("Signed-in profile and token", object({ id: { type: "integer" }, email: string, name: string, token: string })),
      400: response("Email and password required"),
      401: response("Invalid credentials"),
    },
  },
  "GET /api/auth/user": { summary: "Get the signed-in user", security: [{ bearerAuth: [] }, { sessionCookie: [] }] },
  "POST /api/logout": { summary: "End the current session", security: [] },
  "GET /api/tasks": { summary: "List your tasks" },
  "POST /api/tasks": {
    summary: "Create a task",
    requestBody: jsonBody(object({ name: string, date: string, description: string, done: { type: "boolean" }, color: string }),
      { name: "Read API documentation", date: "2026-10-30", description: "Example task" }),
  },
  "GET /api/memos": { summary: "List your notes" },
  "POST /api/memos": {
    summary: "Create a note",
    requestBody: jsonBody(object({
      title: string, content: string, date: { type: "string", nullable: true },
      color: string, tags: { type: "array", items: string }, noteType: string, isHandMaintained: { type: "boolean" },
    }), { title: "API example", content: "A note created using the API.", tags: ["api"] }),
  },
  "GET /api/memos/by-date/:date": { summary: "Get notes for a date" },
  "GET /api/podcasts/shows": { summary: "List podcast shows" },
  "GET /api/podcasts/episodes/:id/notes": { summary: "List timestamped notes for an episode" },
  "POST /api/podcasts/episodes/:id/summarize": {
    summary: "Generate an episode summary",
    description: "May use a paid AI model. Requires an accessible transcript.",
    requestBody: jsonBody(object({ force: { type: "boolean", default: false } }), undefined, false),
  },
  "POST /api/last30days/runs": {
    summary: "Queue Last 30 Days research",
    description: "Starts background research and can incur AI usage. Poll GET /api/last30days/runs/{id} for progress.",
    requestBody: jsonBody(researchInput, { topic: "AI coding assistants", sources: ["reddit", "hn", "github"] }),
  },
  "GET /api/last30days/runs": {
    summary: "List your research runs",
    parameters: [{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 30 } }],
  },
  "GET /api/last30days/runs/:id": {
    summary: "Get research progress or a finished brief",
    parameters: [{ name: "include", in: "query", schema: { type: "string", enum: ["html"] } }],
  },
  "POST /api/last30days/subscriptions": {
    summary: "Enable weekly research for a topic",
    description: "Schedules recurring research with AI usage; first automatic refresh is approximately seven days after subscribing.",
    requestBody: jsonBody(researchInput, { topic: "AI coding assistants", sources: ["reddit", "hn", "github"] }),
  },
  "POST /api/reflection-summary": {
    summary: "Generate or reuse a weekly reflection theme",
    description: "Fewer than three bullets returns an empty summary without an AI call. Identical entries reuse the cache; edited entries generate a new theme. Set regenerate to true to bypass the cache.",
    requestBody: jsonBody(summaryInput, {
      weekStart: "2026-10-26", promptId: "change", promptLabel: "想改變的事",
      entries: [{ ds: "2026-10-26", text: "- Read more\n- Exercise regularly\n- Sleep earlier" }],
    }),
    responses: { 200: response("Theme, cache hit, skip or model error", object({
      summary: string, cached: { type: "boolean" }, skipped: { type: "string", enum: ["empty", "sparse", "empty_response"] }, error: string,
    })) },
  },
  "POST /api/reflection-summary/feedback": {
    summary: "Rate a generated reflection theme",
    requestBody: jsonBody({
      ...object({ weekStart: string, promptId: string, entries, rating: { type: "string", enum: ["up", "down"] } }),
      required: ["weekStart", "promptId", "entries", "rating"],
    }),
    responses: { 200: response("Feedback saved", object({ ok: { type: "boolean" }, rating: { type: "string", enum: ["up", "down"] } })) },
  },
};

for (const [key, detail] of Object.entries({ ...core, ...ai, ...health, ...integrations, ...operations })) {
  operationDetails[key] = {
    ...operationDetails[key], ...detail,
    description: detail.description || operationDetails[key]?.description || "Request and response contract verified against the application handler.",
  };
}
addErrorResponses(operationDetails);

export function collectApiRoutes(stack) {
  const routes = [];
  for (const layer of stack || []) {
    if (layer.route && typeof layer.route.path === "string" && layer.route.path.startsWith("/api/")) {
      const handlers = layer.route.stack.map(item => item.handle.name);
      const methods = layer.route.methods._all
        ? ["get", "post", "put", "patch", "delete", "options", "head", "trace"]
        : Object.keys(layer.route.methods);
      for (const method of methods) {
        if (layer.route.methods._all || layer.route.methods[method]) routes.push({ method, path: layer.route.path, handlers });
      }
    } else if (layer.name === "router") {
      routes.push(...collectApiRoutes(layer.handle.stack));
    }
  }
  return routes;
}

export function buildOpenApi(routes) {
  const paths = {};
  for (const route of routes) {
    const path = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    const detail = operationDetails[`${route.method.toUpperCase()} ${route.path}`] || {};
    const protectedRoute = route.handlers.some(name => ["isAuthenticated", "isAdmin"].includes(name));
    const admin = route.handlers.includes("isAdmin");
    const parameters = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map(match => ({
      name: match[1], in: "path", required: true,
      schema: operationDetails[`${route.method.toUpperCase()} ${route.path}`] && ["id", "noteId", "updateId", "conversationId"].includes(match[1])
        ? { type: "integer" } : string,
    }));
    const operation = {
      tags: [route.path.split("/")[2]],
      operationId: `${route.method}_${route.path.replace(/[^a-zA-Z0-9]+/g, "_")}`,
      summary: `${route.method.toUpperCase()} ${route.path}`,
      description: operationDetails[`${route.method.toUpperCase()} ${route.path}`]
        ? "Request and response contract verified against the application handler."
        : "Route inventory entry. Detailed request/response fields are not yet modeled; consult the application handler before calling this endpoint.",
      security: protectedRoute ? [{ bearerAuth: [] }, { sessionCookie: [] }] : [],
      ...detail,
      parameters: [...parameters, ...(detail.parameters || [])],
      responses: {
        200: response("Successful response; payload varies by operation"),
        400: response("Invalid request", errorSchema),
        401: response("Authentication required or invalid credentials", errorSchema),
        500: response("Server error", errorSchema),
        ...(detail.responses || {}),
      },
    };
    if (!protectedRoute && !detail.security) {
      operation.description += " This route may perform additional authentication or signature checks inside its handler; security: [] does not imply unrestricted access.";
    }
    if (admin) {
      operation.description += " Administrator access is required.";
      operation.responses[403] = response("Administrator access required", errorSchema);
    }
    (paths[path] ||= {})[route.method] = operation;
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "Monotecho API",
      version: "1.0.0",
      description: "Same-origin API contracts verified against application handlers. AI/provider JSON remains open where the server does not validate its shape. Log in via POST /api/login, then use Authorize with the returned token, or use an existing same-origin session. Try it out calls the real app: writes/deletes change real data and AI calls can incur usage. Never share passwords or tokens.",
    },
    servers: [{ url: "/", description: "This app's current origin" }],
    components: { securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "Token returned by POST /api/login. Enter the token without the Bearer prefix." },
      sessionCookie: { type: "apiKey", in: "cookie", name: "connect.sid", description: "Existing same-origin login cookie. Browsers manage this HttpOnly cookie automatically; do not paste it into Swagger." },
      shareToken: { type: "apiKey", in: "header", name: "x-share-token", description: "Share token obtained from GET /api/share-token." },
      emailWebhookHeader: { type: "apiKey", in: "header", name: "x-webhook-secret" },
      emailWebhookQuery: { type: "apiKey", in: "query", name: "secret" },
      lineSignature: { type: "apiKey", in: "header", name: "x-line-signature", description: "LINE HMAC signature of the raw body; not a reusable credential." },
    } },
    paths,
  };
}

export function setupApiDocs(app) {
  // Snapshot after auth, webhooks and the main router are registered.
  const spec = buildOpenApi(collectApiRoutes(app._router.stack));
  app.get("/api/openapi.json", (_req, res) => res.json(spec));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(null, {
    customSiteTitle: "Monotecho API documentation",
    swaggerOptions: {
      url: "/api/openapi.json", validatorUrl: null,
      persistAuthorization: false, withCredentials: true,
      docExpansion: "none", filter: true,
    },
  }));
}
