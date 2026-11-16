const source = { type: "object", properties: { id: { type: "integer" }, title: { type: "string" } }, required: ["id", "title"] };
const facts = { type: "array", items: { type: "object", properties: {
  fact: { type: "string" }, validAt: { type: "string", nullable: true }, invalidAt: { type: "string", nullable: true },
} } };
const evidence = { sources: { type: "array", items: source }, facts };
const response = properties => ({ 200: { description: "Success", content: { "application/json": { schema: { type: "object", properties } } } } });
export const memoKnowledge = {
  "GET /api/memo-knowledge/status": {
    summary: "Read Graphiti sync status for the signed-in user's memos",
    responses: response({ enabled: { type: "boolean" }, configured: { type: "boolean" },
      total: { type: "integer" }, synced: { type: "integer" }, pending: { type: "integer" },
      failed: { type: "integer" }, lastError: { type: "string", nullable: true } }),
  },
  "POST /api/memo-knowledge/sync": {
    summary: "Enable automatic Graphiti indexing and retry failed memos",
    description: "Opt-in: sends the signed-in user's memo text to configured Neo4j and OpenAI services; AI usage may incur charges. Runs asynchronously.",
    responses: response({ enabled: { type: "boolean" } }),
  },
  "POST /api/memo-knowledge/ask": {
    summary: "Ask a question grounded in current indexed memos",
    requestBody: { required: true, content: { "application/json": { schema: {
      type: "object", required: ["question"], properties: { question: { type: "string", minLength: 1, maxLength: 2000 } },
    } } } },
    responses: response({ answer: { type: "string" }, ...evidence }),
  },
  "GET /api/memo-knowledge/related/:id": {
    summary: "Find Graphiti-related memos owned by the signed-in user",
    responses: response(evidence),
  },
};
