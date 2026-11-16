import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq, and } from "drizzle-orm";

after(() => { setTimeout(() => process.exit(0), 100).unref(); });

const TEST_UID = 999991;

async function loadModules() {
  const { db } = await import("../server/db.js");
  const schema = await import("../server/schema.js");
  const wikiOps = await import("../server/wikiOps.js");
  const wikiTools = await import("../server/wikiTools.js");
  const wikiDiff = await import("../server/wikiDiff.js");
  return { db, schema, wikiOps, wikiTools, wikiDiff };
}

async function cleanup(db, schema, uid = TEST_UID) {
  const memoIds = (await db.select({ id: schema.memos.id }).from(schema.memos).where(eq(schema.memos.uid, uid))).map(r => r.id);
  if (memoIds.length) {
    for (const id of memoIds) {
      await db.delete(schema.memoTags).where(eq(schema.memoTags.memoId, id));
    }
  }
  await db.delete(schema.memoLinks).where(eq(schema.memoLinks.uid, uid));
  await db.delete(schema.memos).where(eq(schema.memos.uid, uid));
  await db.delete(schema.agentRunUpdates).where(eq(schema.agentRunUpdates.uid, uid));
  await db.delete(schema.agentRuns).where(eq(schema.agentRuns.uid, uid));
}

async function newRun(db, schema, op = "ingest") {
  const [r] = await db.insert(schema.agentRuns).values({ uid: TEST_UID, op, status: "running", input: "test" }).returning();
  return r.id;
}

async function newMemo(db, schema, { title = "M", content = "", isHandMaintained = false } = {}) {
  const [m] = await db.insert(schema.memos).values({ uid: TEST_UID, title, content, color: "white", isHandMaintained, date: "2026-05-12" }).returning();
  return m;
}

test("unifiedDiff produces a basic line-based diff", async () => {
  const { wikiDiff } = await loadModules();
  const d = wikiDiff.unifiedDiff("a\nb\nc", "a\nb\nx\nc", "L", "R");
  assert.match(d, /--- L/);
  assert.match(d, /\+\+\+ R/);
  assert.match(d, /\+x/);
  // unchanged lines kept
  assert.match(d, / a/);
  assert.match(d, / b/);
});

test("update_memo respects review mode (autoApply=false): stages a pending update, no memo mutation", async () => {
  const { db, schema, wikiOps, wikiTools } = await loadModules();
  await cleanup(db, schema);
  const memo = await newMemo(db, schema, { title: "Karpathy", content: "Original body." });
  const runId = await newRun(db, schema, "ingest");
  const runState = wikiTools.makeRunState("ingest");
  const tools = wikiTools.buildWikiTools({ uid: TEST_UID, runId, runState, autoApply: false });
  const updateTool = tools.find(t => t.name === "update_memo");
  const r = await updateTool.handler({ id: memo.id, appendContent: "\n- Source: [[Article]] — important." });
  assert.equal(r.staged, true);
  assert.ok(r.updateId);
  assert.match(r.diff, /\+- Source: \[\[Article\]\]/);
  // memo unchanged
  const [after] = await db.select().from(schema.memos).where(eq(schema.memos.id, memo.id));
  assert.equal(after.content, "Original body.");
  // pending row exists
  const updates = await db.select().from(schema.agentRunUpdates).where(eq(schema.agentRunUpdates.runId, runId));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, "pending");
  await cleanup(db, schema);
});

test("update_memo with autoApply=true mutates the memo and records auto_applied", async () => {
  const { db, schema, wikiOps, wikiTools } = await loadModules();
  await cleanup(db, schema);
  const memo = await newMemo(db, schema, { title: "Karpathy", content: "Original body." });
  const runId = await newRun(db, schema, "ingest");
  const runState = wikiTools.makeRunState("ingest");
  const tools = wikiTools.buildWikiTools({ uid: TEST_UID, runId, runState, autoApply: true });
  const updateTool = tools.find(t => t.name === "update_memo");
  const r = await updateTool.handler({ id: memo.id, appendContent: "Source: [[Article]]" });
  assert.equal(r.applied, true);
  const [after] = await db.select().from(schema.memos).where(eq(schema.memos.id, memo.id));
  assert.match(after.content, /Source: \[\[Article\]\]/);
  const [up] = await db.select().from(schema.agentRunUpdates).where(eq(schema.agentRunUpdates.runId, runId));
  assert.equal(up.status, "auto_applied");
  await cleanup(db, schema);
});

test("update_memo refuses to touch hand-maintained memos", async () => {
  const { db, schema, wikiTools } = await loadModules();
  await cleanup(db, schema);
  const memo = await newMemo(db, schema, { title: "Locked", content: "Mine.", isHandMaintained: true });
  const runId = await newRun(db, schema, "ingest");
  const runState = wikiTools.makeRunState("ingest");
  const tools = wikiTools.buildWikiTools({ uid: TEST_UID, runId, runState, autoApply: true });
  const updateTool = tools.find(t => t.name === "update_memo");
  const r = await updateTool.handler({ id: memo.id, appendContent: "x" });
  assert.match(r.error || "", /hand_maintained/);
  // memo unchanged, no update row written, no cap consumed
  const [after] = await db.select().from(schema.memos).where(eq(schema.memos.id, memo.id));
  assert.equal(after.content, "Mine.");
  const ups = await db.select().from(schema.agentRunUpdates).where(eq(schema.agentRunUpdates.runId, runId));
  assert.equal(ups.length, 0);
  assert.equal(runState.updates, 0);
  await cleanup(db, schema);
});

test("update_memo enforces the per-run update cap for ingest (5)", async () => {
  const { db, schema, wikiTools } = await loadModules();
  await cleanup(db, schema);
  const memos = [];
  for (let i = 0; i < 6; i++) memos.push(await newMemo(db, schema, { title: `M${i}`, content: `body ${i}` }));
  const runId = await newRun(db, schema, "ingest");
  const runState = wikiTools.makeRunState("ingest");
  const tools = wikiTools.buildWikiTools({ uid: TEST_UID, runId, runState, autoApply: true });
  const updateTool = tools.find(t => t.name === "update_memo");
  for (let i = 0; i < 5; i++) {
    const r = await updateTool.handler({ id: memos[i].id, appendContent: "added" });
    assert.equal(r.applied, true, `expected #${i} to apply`);
  }
  const r6 = await updateTool.handler({ id: memos[5].id, appendContent: "added" });
  assert.match(r6.error || "", /cap_exceeded/);
  await cleanup(db, schema);
});

test("synthesize cap: only one mutation per run (create_memo OR update_memo, not both)", async () => {
  const { db, schema, wikiTools } = await loadModules();
  await cleanup(db, schema);
  const runId = await newRun(db, schema, "synthesize");
  const runState = wikiTools.makeRunState("synthesize");
  const tools = wikiTools.buildWikiTools({ uid: TEST_UID, runId, runState, autoApply: true });
  const createTool = tools.find(t => t.name === "create_memo");
  const updateTool = tools.find(t => t.name === "update_memo");
  const memo = await newMemo(db, schema, { title: "Existing synth", content: "old" });
  const c = await createTool.handler({ title: "Synthesis: x", content: "body" });
  assert.ok(c.id, "first create should succeed");
  const u = await updateTool.handler({ id: memo.id, appendContent: "anything" });
  assert.match(u.error || "", /cap_exceeded/);
  await cleanup(db, schema);
});

test("approveAgentRunUpdate applies a staged change; rejectAgentRunUpdate marks it rejected", async () => {
  const { db, schema, wikiOps, wikiTools } = await loadModules();
  await cleanup(db, schema);
  const memo = await newMemo(db, schema, { title: "K", content: "first." });
  const runId = await newRun(db, schema, "ingest");
  const runState = wikiTools.makeRunState("ingest");
  const tools = wikiTools.buildWikiTools({ uid: TEST_UID, runId, runState, autoApply: false });
  const updateTool = tools.find(t => t.name === "update_memo");
  const r = await updateTool.handler({ id: memo.id, appendContent: "second." });
  assert.equal(r.staged, true);
  const ok = await wikiOps.approveAgentRunUpdate(TEST_UID, r.updateId);
  assert.equal(ok.ok, true);
  const [after] = await db.select().from(schema.memos).where(eq(schema.memos.id, memo.id));
  assert.match(after.content, /second\./);
  const [row] = await db.select().from(schema.agentRunUpdates).where(eq(schema.agentRunUpdates.id, r.updateId));
  assert.equal(row.status, "applied");
  // approving again is a no-op error
  const again = await wikiOps.approveAgentRunUpdate(TEST_UID, r.updateId);
  assert.equal(again.ok, false);

  // reject path
  const r2 = await updateTool.handler({ id: memo.id, appendContent: "third." });
  const rej = await wikiOps.rejectAgentRunUpdate(TEST_UID, r2.updateId);
  assert.equal(rej.ok, true);
  const [memo2] = await db.select().from(schema.memos).where(eq(schema.memos.id, memo.id));
  assert.doesNotMatch(memo2.content, /third\./);
  await cleanup(db, schema);
});

test("happy-path Ingest run: mocked LLM updates an existing entity memo and creates a new source memo", async () => {
  const { db, schema, wikiOps } = await loadModules();
  await cleanup(db, schema);
  const entity = await newMemo(db, schema, { title: "Karpathy", content: "Andrej Karpathy is a researcher." });

  // Scripted "LLM" that walks the agent loop step by step.
  const calls = [
    {
      tool_calls: [{
        id: "c1", type: "function",
        function: { name: "search_memos", arguments: JSON.stringify({ query: "Karpathy" }) },
      }],
    },
    {
      tool_calls: [{
        id: "c2", type: "function",
        function: { name: "create_memo", arguments: JSON.stringify({
          title: "Karpathy LLM Wiki article",
          content: "Notes on the [[Karpathy]] LLM Wiki post.",
          tags: ["wiki", "ai"],
        }) },
      }],
    },
    {
      tool_calls: [{
        id: "c3", type: "function",
        function: { name: "update_memo", arguments: JSON.stringify({
          id: entity.id,
          appendContent: "\n- Source: [[Karpathy LLM Wiki article]] — wiki should compound.",
        }) },
      }],
    },
    {
      tool_calls: [{
        id: "c4", type: "function",
        function: { name: "append_to_log", arguments: JSON.stringify({ entry: "Ingested Karpathy article." }) },
      }],
    },
    { content: "Created memo + updated 1 entity memo." },
  ];

  let i = 0;
  const fakeRunAgent = async ({ tools, systemPrompt, userInput, budget }) => {
    const trace = [];
    let finalText = "";
    let toolCallCount = 0;
    for (const step of calls) {
      if (step.content && !step.tool_calls) {
        finalText = step.content;
        trace.push({ step: trace.length + 1, kind: "final", text: finalText });
        break;
      }
      for (const tc of step.tool_calls) {
        const tool = tools.find(t => t.name === tc.function.name && t.allowed !== false);
        if (!tool) {
          trace.push({ step: trace.length + 1, kind: "tool_call", toolName: tc.function.name, error: "not allowed" });
          continue;
        }
        const args = JSON.parse(tc.function.arguments);
        const result = await tool.handler(args);
        toolCallCount++;
        trace.push({ step: trace.length + 1, kind: "tool_call", toolName: tc.function.name, args, result });
      }
    }
    return { ok: true, finalText, trace, toolCallCount, durationMs: 1, error: null };
  };

  const result = await wikiOps.runWikiOp({
    uid: TEST_UID, op: "ingest", input: "Article about Karpathy LLM Wiki",
    tz: "Asia/Hong_Kong", autoApplyOverride: true, runAgentImpl: fakeRunAgent,
  });

  assert.equal(result.ok, true);
  assert.equal(result.appliedUpdateCount, 1, "should record one applied update");

  // The new source memo exists.
  const allMemos = await db.select().from(schema.memos).where(eq(schema.memos.uid, TEST_UID));
  const titles = allMemos.map(m => m.title).sort();
  assert.ok(titles.includes("Karpathy LLM Wiki article"));
  // The entity memo was updated.
  const [entityAfter] = allMemos.filter(m => m.id === entity.id);
  assert.match(entityAfter.content, /Karpathy LLM Wiki article/);
  // The update was recorded with a diff.
  const updates = await db.select().from(schema.agentRunUpdates).where(eq(schema.agentRunUpdates.runId, result.runId));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, "auto_applied");
  assert.match(updates[0].diff, /\+- Source:/);

  // getAgentRun returns the updates.
  const detail = await wikiOps.getAgentRun(TEST_UID, result.runId);
  assert.equal(detail.updates.length, 1);
  assert.match(detail.updates[0].diff, /\+- Source:/);

  await cleanup(db, schema);
});
