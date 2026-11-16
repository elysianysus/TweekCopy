import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";

import {
  __weeklyLintTesting,
  invalidateWeeklyLintCache,
  getWeeklyLintSchedulerStats,
} from "../server/lineBot.js";

const {
  setDeps,
  resetDeps,
  resetState,
  loadWeeklyLintBuckets,
  tickWeeklyLint,
  formatWeeklyLintLineMessage,
  getBuckets,
  getLastSent,
} = __weeklyLintTesting;

const ORIGINAL_LOG = console.log;
const ORIGINAL_ERR = console.error;
function silence() { console.log = () => {}; console.error = () => {}; }
function restore() { console.log = ORIGINAL_LOG; console.error = ORIGINAL_ERR; }

function user(over = {}) {
  return {
    id: 1, email: "a@x.com", lineUserId: "U1234567890abcdef",
    timezone: "Asia/Hong_Kong",
    wikiLintEnabled: true, wikiLintDow: 0, wikiLintHour: 9, wikiLintMinute: 0,
    ...over,
  };
}

beforeEach(() => {
  silence();
  resetState();
  invalidateWeeklyLintCache();
  setDeps({
    loadRecentSent: async () => [],
    recordSent: async () => {},
    pruneOldSent: async () => {},
    pushMessage: async () => {},
    runLint: async () => ({ ok: true, output: "Lint summary…" }),
    createLintReportMemo: async () => ({ id: 0 }),
    // Deterministic dow injection — tests pin "today" so the scheduler's
    // dow-match check is independent of the wall clock.
    dowInTz: () => 0,
  });
});

afterEach(() => {
  resetDeps();
  resetState();
  invalidateWeeklyLintCache();
  restore();
});

after(async () => {
  try { const { pool } = await import("../server/db.js"); await pool.end(); } catch {}
});

test("buckets group users by timezone + dow + hour:minute", async () => {
  const a = user({ id: 1, timezone: "Asia/Hong_Kong", wikiLintDow: 0, wikiLintHour: 9, wikiLintMinute: 0 });
  const b = user({ id: 2, timezone: "Asia/Hong_Kong", wikiLintDow: 0, wikiLintHour: 9, wikiLintMinute: 0 });
  const c = user({ id: 3, timezone: "America/New_York", wikiLintDow: 1, wikiLintHour: 9, wikiLintMinute: 0 });
  const d = user({ id: 4, timezone: "Asia/Hong_Kong", wikiLintDow: 0, wikiLintHour: 10, wikiLintMinute: 30 });

  setDeps({ loadEnabledUsers: async () => [a, b, c, d] });
  await loadWeeklyLintBuckets();
  const buckets = getBuckets();

  assert.equal(buckets.size, 3);
  assert.deepEqual(
    [...buckets.keys()].sort(),
    ["America/New_York|1|9:0", "Asia/Hong_Kong|0|10:30", "Asia/Hong_Kong|0|9:0"],
  );
  assert.equal(buckets.get("Asia/Hong_Kong|0|9:0").users.length, 2);
});

test("tick fires runLint, creates Lint report memo, and LINE-pushes only the title", async () => {
  let fired = 0; let pushed = 0; let lastPush = null;
  let memoCreated = null;
  setDeps({
    loadEnabledUsers: async () => [user()],
    getTimeInTimezone: () => ({ hour: 9, minute: 0, todayStr: "2026-05-17" }),
    dowInTz: () => 0, // pin to Sunday
    runLint: async () => { fired++; return { ok: true, output: "- 3 orphan memos found.\n- 2 missing tags." }; },
    createLintReportMemo: async (uid, payload) => { memoCreated = { uid, ...payload }; return { id: 999 }; },
    pushMessage: async (uid, msg) => { pushed++; lastPush = msg; },
  });
  await tickWeeklyLint();
  assert.equal(fired, 1);
  assert.equal(pushed, 1);
  assert.ok(memoCreated, "expected a Lint report memo to be created");
  assert.match(memoCreated.title, /Weekly wiki lint — 2026-05-17/);
  assert.match(memoCreated.body, /orphan memos/);
  // LINE message must be one-line (title) — NOT the lint body.
  assert.match(lastPush, /Weekly wiki lint — 2026-05-17/);
  assert.doesNotMatch(lastPush, /orphan memos/);
});

test("non-matching dow suppresses fire (deterministic)", async () => {
  let fired = 0;
  setDeps({
    loadEnabledUsers: async () => [user({ wikiLintDow: 0 })],
    getTimeInTimezone: () => ({ hour: 9, minute: 0, todayStr: "2026-05-18" }),
    dowInTz: () => 1, // Monday — does not match user's Sunday target
    runLint: async () => { fired++; return { ok: true, output: "x" }; },
    createLintReportMemo: async () => ({ id: 1 }),
    pushMessage: async () => {},
  });
  await tickWeeklyLint();
  assert.equal(fired, 0);
});

test("dedup: same week+time only fires once across multiple ticks", async () => {
  let fired = 0;
  setDeps({
    loadEnabledUsers: async () => [user()],
    getTimeInTimezone: () => ({ hour: 9, minute: 0, todayStr: "2026-05-17" }),
    dowInTz: () => 0,
    runLint: async () => { fired++; return { ok: true, output: "x" }; },
    createLintReportMemo: async () => ({ id: 1 }),
    pushMessage: async () => {},
  });
  await tickWeeklyLint();
  await tickWeeklyLint();
  await tickWeeklyLint();
  assert.equal(fired, 1, "scheduler must dedup the same week's run");
});

test("runLint is invoked with source='auto' + trigger='scheduler'", async () => {
  // We can't observe runWikiOp directly here, but we can verify the dep
  // override receives the same uid + tz the scheduler resolved. The
  // production runLint dep wraps runWikiOp with source='auto' + trigger='scheduler';
  // tests/wikiAutoIngest.test.js covers the persisted metadata for the auto path,
  // and this assert pins the call signature the scheduler uses.
  const calls = [];
  setDeps({
    loadEnabledUsers: async () => [user({ timezone: "America/New_York" })],
    getTimeInTimezone: () => ({ hour: 9, minute: 0, todayStr: "2026-05-17" }),
    dowInTz: () => 0,
    runLint: async (uid, tz) => { calls.push({ uid, tz }); return { ok: true, output: "x" }; },
    createLintReportMemo: async () => ({ id: 1 }),
    pushMessage: async () => {},
  });
  await tickWeeklyLint();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].uid, 1);
  assert.equal(calls[0].tz, "America/New_York");
});

test("kill switch / failed lint does NOT create memo, push LINE, or record dedup", async () => {
  let memoCalls = 0; let pushCalls = 0; let recordCalls = 0;
  setDeps({
    loadEnabledUsers: async () => [user()],
    getTimeInTimezone: () => ({ hour: 9, minute: 0, todayStr: "2026-05-17" }),
    dowInTz: () => 0,
    // Mirror runWikiOp's kill-switch shape: it returns ok:false rather than throwing.
    runLint: async () => ({ ok: false, error: "Muse agent is paused (kill switch)." }),
    createLintReportMemo: async () => { memoCalls++; return { id: 1 }; },
    pushMessage: async () => { pushCalls++; },
    recordSent: async () => { recordCalls++; },
  });
  await tickWeeklyLint();
  assert.equal(memoCalls, 0, "must not create a Lint report memo on failure");
  assert.equal(pushCalls, 0, "must not push a success notification on failure");
  assert.equal(recordCalls, 0, "must not record dedup on failure (next tick should retry)");
  // In-memory dedup must also stay clear so a retry can fire.
  assert.equal(getLastSent().get(1), undefined);
  const stats = getWeeklyLintSchedulerStats();
  assert.ok(stats.failed >= 1);
});

test("kill switch retry: a successful run AFTER a failed one still fires (no false dedup)", async () => {
  let okNext = false; let memoCalls = 0; let pushCalls = 0;
  setDeps({
    loadEnabledUsers: async () => [user()],
    getTimeInTimezone: () => ({ hour: 9, minute: 0, todayStr: "2026-05-17" }),
    dowInTz: () => 0,
    runLint: async () => okNext ? { ok: true, output: "all good" } : { ok: false, error: "kill switch" },
    createLintReportMemo: async () => { memoCalls++; return { id: 7 }; },
    pushMessage: async () => { pushCalls++; },
  });
  await tickWeeklyLint();
  assert.equal(memoCalls, 0);
  okNext = true;
  await tickWeeklyLint();
  assert.equal(memoCalls, 1);
  assert.equal(pushCalls, 1);
});

test("formatWeeklyLintLineMessage is one-line title-only", () => {
  const msg = formatWeeklyLintLineMessage({ title: "Weekly wiki lint — 2026-05-17" });
  assert.match(msg, /Weekly wiki lint — 2026-05-17/);
  assert.match(msg, /Open Muse/);
  // Must not embed the body — the body lives in the auto-created memo.
  assert.ok(msg.length < 200);
});

test("getWeeklyLintSchedulerStats reflects loaded buckets", async () => {
  setDeps({ loadEnabledUsers: async () => [user({ id: 1 }), user({ id: 2, timezone: "America/New_York", wikiLintDow: 3 })] });
  await loadWeeklyLintBuckets();
  const stats = getWeeklyLintSchedulerStats();
  assert.equal(stats.buckets.length, 2);
  assert.ok(stats.cacheLoadedAt);
});
