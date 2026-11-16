import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";

import {
  enqueueAutoIngest,
  enqueueRssDigestAutoIngest,
  extractRssDigestTopN,
  getAutoIngestStats,
  __autoIngestTesting,
} from "../server/wikiAutoIngest.js";

const ORIGINAL_LOG = console.log;
const ORIGINAL_ERR = console.error;
function silence() { console.log = () => {}; console.error = () => {}; }
function restore() { console.log = ORIGINAL_LOG; console.error = ORIGINAL_ERR; }

function makePrefs(over = {}) {
  return { rss: false, video: false, line: false, last30: false, tz: "Asia/Hong_Kong", ...over };
}

async function flush() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

beforeEach(() => {
  silence();
  __autoIngestTesting.resetState();
  delete process.env.RSS_AUTO_INGEST_TOPN;
});

afterEach(() => {
  __autoIngestTesting.resetDeps();
  __autoIngestTesting.resetState();
  delete process.env.RSS_AUTO_INGEST_TOPN;
  restore();
});

after(async () => {
  try { const { pool } = await import("../server/db.js"); await pool.end(); } catch {}
});

test("skips when trigger is unknown", () => {
  const r = enqueueAutoIngest({ uid: 1, trigger: "bogus", input: "hello" });
  assert.equal(r.queued, false);
  assert.equal(r.reason, "unknown_trigger");
});

test("skips when user has the matching pref disabled", async () => {
  __autoIngestTesting.setDeps({
    prefLoader: async () => makePrefs({ rss: false }),
    runImpl: async () => { throw new Error("must not run"); },
  });
  const r = enqueueAutoIngest({ uid: 1, trigger: "rss-digest", input: "x" });
  assert.equal(r.queued, true);
  await flush();
  const s = getAutoIngestStats();
  assert.equal(s.enqueued, 0);
  assert.equal(s.skippedNoPref, 1);
});

test("runs ingest with source='auto' + the requested trigger when pref enabled", async () => {
  const calls = [];
  __autoIngestTesting.setDeps({
    prefLoader: async () => makePrefs({ rss: true }),
    runImpl: async (args) => { calls.push(args); return { ok: true, runId: 1 }; },
  });
  enqueueAutoIngest({ uid: 42, trigger: "rss-digest", input: "today's digest" });
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].uid, 42);
  assert.equal(calls[0].op, "ingest");
  // Per #164 spec: source='auto', trigger=concrete origin enum.
  assert.equal(calls[0].source, "auto");
  assert.equal(calls[0].trigger, "rss-digest");
  assert.equal(calls[0].tz, "Asia/Hong_Kong");
  assert.match(calls[0].input, /today's digest/);
  const s = getAutoIngestStats();
  assert.equal(s.enqueued, 1);
  assert.equal(s.succeeded, 1);
  assert.equal(s.failed, 0);
});

test("LINE triggers (food / expense / medicine) all map to wikiAutoIngestLineLog pref; line_memo is NOT supported", async () => {
  const calls = [];
  __autoIngestTesting.setDeps({
    prefLoader: async () => makePrefs({ line: true }),
    runImpl: async (args) => { calls.push(args.trigger); return { ok: true }; },
  });
  for (const t of ["line-food", "line-expense", "line-medicine"]) {
    enqueueAutoIngest({ uid: 1, trigger: t, input: `${t} payload` });
  }
  // Generic LINE memo is intentionally out of scope.
  const r = enqueueAutoIngest({ uid: 1, trigger: "line-memo", input: "memo body" });
  assert.equal(r.queued, false);
  assert.equal(r.reason, "unknown_trigger");
  await flush();
  assert.deepEqual(calls.sort(), ["line-expense", "line-food", "line-medicine"]);
});

test("per-user serialization: jobs run one-at-a-time even when stacked", async () => {
  const order = [];
  let inFlight = 0; let maxInFlight = 0;
  __autoIngestTesting.setDeps({
    prefLoader: async () => makePrefs({ video: true }),
    runImpl: async (args) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      order.push(args.input);
      return { ok: true };
    },
  });
  for (let i = 0; i < 4; i++) {
    enqueueAutoIngest({ uid: 7, trigger: "video-transcript", input: `t${i}` });
  }
  for (let i = 0; i < 100 && order.length < 4; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(order.length, 4);
  assert.equal(maxInFlight, 1, "queue must serialize per user");
  assert.deepEqual(order, ["t0", "t1", "t2", "t3"]);
});

test("queue is bounded per user (extras drop with skippedQueueFull)", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  __autoIngestTesting.setDeps({
    prefLoader: async () => makePrefs({ last30: true }),
    runImpl: async () => { await gate; return { ok: true }; },
  });
  for (let i = 0; i < 20; i++) {
    enqueueAutoIngest({ uid: 99, trigger: "last30days", input: `b${i}` });
  }
  await flush();
  const s = getAutoIngestStats();
  assert.ok(s.skippedQueueFull > 0, `expected some skips, got ${JSON.stringify(s)}`);
  release();
  for (let i = 0; i < 100; i++) await new Promise((r) => setImmediate(r));
});

test("queue dedupe: same uid+trigger+normalized payload only enqueues once while pending", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let runs = 0;
  __autoIngestTesting.setDeps({
    prefLoader: async () => makePrefs({ rss: true }),
    runImpl: async () => { runs++; await gate; return { ok: true }; },
  });
  // Fire the SAME payload 5 times back-to-back; only one job should run and
  // the queue should not balloon past 1 pending entry.
  for (let i = 0; i < 5; i++) {
    enqueueAutoIngest({ uid: 1, trigger: "rss-digest", input: "Same   payload    text" });
  }
  await flush();
  // Whitespace-different but normalization-equal payload also dedupes.
  enqueueAutoIngest({ uid: 1, trigger: "rss-digest", input: "SAME payload text" });
  await flush();
  // A genuinely different payload should NOT be deduped.
  enqueueAutoIngest({ uid: 1, trigger: "rss-digest", input: "Different payload" });
  await flush();
  const s = getAutoIngestStats();
  assert.ok(s.skippedDuplicate >= 5, `expected ≥5 skippedDuplicate, got ${s.skippedDuplicate}`);
  release();
  for (let i = 0; i < 100 && runs < 2; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(runs, 2, "exactly two distinct payloads should have run");
});

test("perTrigger metrics: attemptedUsers + lastRunAt populate per trigger", async () => {
  __autoIngestTesting.setDeps({
    prefLoader: async () => makePrefs({ rss: true, video: true }),
    runImpl: async () => ({ ok: true }),
  });
  enqueueAutoIngest({ uid: 1, trigger: "rss-digest", input: "a" });
  enqueueAutoIngest({ uid: 2, trigger: "rss-digest", input: "b" });
  enqueueAutoIngest({ uid: 1, trigger: "video-transcript", input: "v" });
  await flush();
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
  const s = getAutoIngestStats();
  const rss = s.perTrigger.find((t) => t.trigger === "rss-digest");
  const vid = s.perTrigger.find((t) => t.trigger === "video-transcript");
  assert.ok(rss, "expected rss-digest in perTrigger");
  assert.equal(rss.attemptedUsers, 2);
  assert.equal(rss.succeeded, 2);
  assert.ok(rss.lastRunAt, "expected rss-digest lastRunAt timestamp");
  assert.equal(vid.attemptedUsers, 1);
});

test("runImpl failure increments failed count and never throws to caller", async () => {
  __autoIngestTesting.setDeps({
    prefLoader: async () => makePrefs({ rss: true }),
    runImpl: async () => { throw new Error("boom"); },
  });
  enqueueAutoIngest({ uid: 1, trigger: "rss-digest", input: "x" });
  await flush();
  const s = getAutoIngestStats();
  assert.equal(s.failed, 1);
  assert.match(s.lastError, /boom/);
});

test("kill switch (runImpl returns ok:false with that error) is recorded as failed and lastError", async () => {
  __autoIngestTesting.setDeps({
    prefLoader: async () => makePrefs({ rss: true }),
    runImpl: async () => ({ ok: false, error: "Muse agent is paused (kill switch)." }),
  });
  enqueueAutoIngest({ uid: 1, trigger: "rss-digest", input: "x" });
  await flush();
  const s = getAutoIngestStats();
  assert.equal(s.failed, 1);
  assert.equal(s.succeeded, 0);
  assert.match(s.lastError, /kill switch/);
});

test("runImpl returning ok:false counts as failed", async () => {
  __autoIngestTesting.setDeps({
    prefLoader: async () => makePrefs({ rss: true }),
    runImpl: async () => ({ ok: false, error: "agent budget exceeded" }),
  });
  enqueueAutoIngest({ uid: 1, trigger: "rss-digest", input: "x" });
  await flush();
  const s = getAutoIngestStats();
  assert.equal(s.failed, 1);
  assert.match(s.lastError, /budget/);
});

// ---------- RSS top-N fanout ----------

test("extractRssDigestTopN parses bullet items and pulls in indented descriptions", () => {
  const body = [
    "# 每日新聞摘要 · 2026-05-17", "",
    "## RTHK", "",
    "- [Story A](https://a) — 09:00",
    "  Story A description goes here.",
    "- [Story B](https://b)",
    "  Body B.",
    "- [Story C](https://c)",
    "- [Story D](https://d)",
    "",
    "## SCMP", "",
    "- [Story E](https://e)",
  ].join("\n");
  const items = extractRssDigestTopN(body, 3);
  assert.equal(items.length, 3);
  assert.match(items[0], /Story A/);
  assert.match(items[0], /Story A description/);
  assert.match(items[1], /Story B/);
  assert.match(items[2], /Story C/);
});

test("RSS digest ingest fans out top-N items (default 3) — one ingest per highlight", async () => {
  const calls = [];
  __autoIngestTesting.setDeps({
    prefLoader: async () => makePrefs({ rss: true }),
    runImpl: async (args) => { calls.push(args); return { ok: true }; },
  });
  const body = [
    "## RTHK", "- [A](https://a)", "- [B](https://b)", "- [C](https://c)", "- [D](https://d)", "- [E](https://e)",
  ].join("\n");
  enqueueRssDigestAutoIngest({ uid: 5, title: "📰 HK Digest · 2026-05-17", content: body });
  for (let i = 0; i < 200 && calls.length < 3; i++) await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 3, "default top-N fanout must produce exactly 3 ingest runs");
  for (const c of calls) {
    assert.equal(c.source, "auto");
    assert.equal(c.trigger, "rss-digest");
    assert.match(c.input, /RSS digest highlight/);
  }
  // Inputs are distinct (one per highlight).
  const inputs = new Set(calls.map((c) => c.input));
  assert.equal(inputs.size, 3);
});

test("RSS_AUTO_INGEST_TOPN env overrides the fanout count", async () => {
  process.env.RSS_AUTO_INGEST_TOPN = "2";
  const calls = [];
  __autoIngestTesting.setDeps({
    prefLoader: async () => makePrefs({ rss: true }),
    runImpl: async (args) => { calls.push(args); return { ok: true }; },
  });
  const body = ["- [A](https://a)", "- [B](https://b)", "- [C](https://c)"].join("\n");
  enqueueRssDigestAutoIngest({ uid: 5, title: "Digest", content: body });
  for (let i = 0; i < 200 && calls.length < 2; i++) await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 2);
});

test("RSS digest with no parseable bullets falls back to a single full-body ingest", async () => {
  const calls = [];
  __autoIngestTesting.setDeps({
    prefLoader: async () => makePrefs({ rss: true }),
    runImpl: async (args) => { calls.push(args); return { ok: true }; },
  });
  enqueueRssDigestAutoIngest({ uid: 5, title: "Plain digest", content: "No bullets — just prose body." });
  for (let i = 0; i < 100 && calls.length < 1; i++) await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1);
  assert.match(calls[0].input, /RSS daily digest: Plain digest/);
  assert.match(calls[0].input, /No bullets/);
});
