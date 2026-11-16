import { test, after } from "node:test";
import assert from "node:assert/strict";
import { addMemory as addMuseMemory } from "../server/museMemories.js";
import { pool } from "../server/db.js";

const BASE = process.env.MUSE_TEST_BASE || "http://localhost:3001";

after(async () => {
  try { await pool.end(); } catch { /* ignore */ }
});

async function isServerUp() {
  try {
    const r = await fetch(BASE + "/api/auth/user", { signal: AbortSignal.timeout(800) });
    return r.status === 401 || r.ok;
  } catch {
    return false;
  }
}

async function newUser(prefix) {
  const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.com`;
  const r = await fetch(BASE + "/api/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "test12345", name: prefix, timezone: "Asia/Hong_Kong" }),
  }).then((r) => r.json());
  if (!r.token) throw new Error("signup failed: " + JSON.stringify(r));
  return { token: r.token, uid: r.id };
}

function H(token) {
  return { Authorization: "Bearer " + token, "Content-Type": "application/json" };
}

async function createMemory(token, content) {
  const r = await fetch(BASE + "/api/muse/memories", {
    method: "POST",
    headers: H(token),
    body: JSON.stringify({ content, kind: "manual" }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error("create memory failed: " + JSON.stringify(body));
  return body;
}

async function listMemories(token, q = "") {
  const url = q
    ? BASE + "/api/muse/memories?q=" + encodeURIComponent(q)
    : BASE + "/api/muse/memories";
  const r = await fetch(url, { headers: H(token) });
  const body = await r.json();
  if (!r.ok) throw new Error("list memories failed: " + JSON.stringify(body));
  return body;
}

test("tenant isolation: a user cannot read, update, or delete another user's memories", async (t) => {
  if (!(await isServerUp())) return t.skip("server not running");

  const { token: tokenA, uid: uidA } = await newUser("museA");
  const { token: tokenB } = await newUser("museB");

  const memA = await createMemory(tokenA, `User A loves jazz ${Date.now()}_A`);
  const memB = await createMemory(tokenB, `User B loves rock ${Date.now()}_B`);

  // --- LIST: each user only sees their own ---
  const listA = await listMemories(tokenA);
  const listB = await listMemories(tokenB);

  assert.ok(listA.some((m) => m.id === memA.id), "A should see own memory");
  assert.ok(!listA.some((m) => m.id === memB.id), "A must NOT see B's memory in default list");
  assert.ok(listB.some((m) => m.id === memB.id), "B should see own memory");
  assert.ok(!listB.some((m) => m.id === memA.id), "B must NOT see A's memory in default list");

  // --- LIST with search query: must not leak across users ---
  const searchA = await listMemories(tokenA, "rock");
  assert.ok(!searchA.some((m) => m.id === memB.id), "A's search must NOT return B's memory");
  const searchB = await listMemories(tokenB, "jazz");
  assert.ok(!searchB.some((m) => m.id === memA.id), "B's search must NOT return A's memory");

  // --- PATCH: B cannot update A's memory ---
  const patchRes = await fetch(BASE + `/api/muse/memories/${memA.id}`, {
    method: "PATCH",
    headers: H(tokenB),
    body: JSON.stringify({ content: "HACKED by B" }),
  });
  assert.equal(patchRes.status, 404, "cross-tenant PATCH must return 404");

  // Confirm A's memory unchanged.
  const listA2 = await listMemories(tokenA);
  const memAAfter = listA2.find((m) => m.id === memA.id);
  assert.ok(memAAfter, "A's memory still exists after B's PATCH attempt");
  assert.notEqual(memAAfter.content, "HACKED by B", "A's content must NOT be mutated by B");
  assert.equal(memAAfter.content, memA.content, "A's content unchanged");

  // --- DELETE single: B cannot delete A's memory ---
  const delRes = await fetch(BASE + `/api/muse/memories/${memA.id}`, {
    method: "DELETE",
    headers: H(tokenB),
  });
  // The single-id DELETE always returns 200 ok at the route level, but the row
  // must still exist for A afterwards because deleteMemory is uid-scoped.
  assert.ok(delRes.ok, "DELETE returns ok regardless");
  const listA3 = await listMemories(tokenA);
  assert.ok(listA3.some((m) => m.id === memA.id), "A's memory must still exist after B's DELETE attempt");

  // --- DELETE all (clear-all): B clearing should not affect A ---
  const clearRes = await fetch(BASE + "/api/muse/memories/all", {
    method: "DELETE",
    headers: H(tokenB),
  });
  assert.ok(clearRes.ok, "B's clear-all returns ok");
  const listA4 = await listMemories(tokenA);
  assert.ok(listA4.some((m) => m.id === memA.id), "A's memory must survive B's clear-all");

  // --- DELETE by conversation: B cannot delete A's memories tied to a convo id ---
  // Seed A with a memory tied to a specific source_conversation_id (the public
  // POST route doesn't accept it, so use the module directly against the same DB).
  const sharedConvoId = 1_000_000 + Math.floor(Math.random() * 1_000_000);
  const memAConvo = await addMuseMemory({
    uid: uidA,
    content: `User A convo-tied memory ${Date.now()}`,
    kind: "manual",
    sourceConversationId: sharedConvoId,
    skipDedupe: true,
  });
  assert.ok(memAConvo && memAConvo.id, "seed convo-tied memory for A");

  // B attempts to delete by that exact conversation id.
  const delByConvoRes = await fetch(BASE + `/api/muse/memories/conversation/${sharedConvoId}`, {
    method: "DELETE",
    headers: H(tokenB),
  });
  assert.ok(delByConvoRes.ok);
  const delByConvoBody = await delByConvoRes.json();
  assert.equal(delByConvoBody.deleted, 0, "B must delete 0 of A's convo-tied memories");

  const listA5 = await listMemories(tokenA);
  assert.ok(listA5.some((m) => m.id === memAConvo.id), "A's convo-tied memory must survive B's delete-by-conversation attempt");
  assert.ok(listA5.some((m) => m.id === memA.id), "A's original memory must also survive");
});
