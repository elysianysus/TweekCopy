import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  __dailySummaryTesting,
  invalidateDailySummaryCache,
} from "../server/lineBot.js";

const {
  setDeps,
  resetDeps,
  resetState,
  loadDailySummaryUserBuckets,
  sendDailyFoodSummaryToAllUsers,
  getBuckets,
  getLastSent,
  getStatsSnapshot,
  recordDailySummaryBucketRun,
  recordDailySummaryBucketError,
} = __dailySummaryTesting;

const ORIGINAL_LOG = console.log;
const ORIGINAL_ERR = console.error;

function silenceConsole() {
  console.log = () => {};
  console.error = () => {};
}

function restoreConsole() {
  console.log = ORIGINAL_LOG;
  console.error = ORIGINAL_ERR;
}

function makeUser(overrides = {}) {
  return {
    id: 1,
    email: "user@example.com",
    name: "Tester",
    lineUserId: "U1234567890abcdef",
    timezone: "Asia/Hong_Kong",
    dailySummaryEnabled: true,
    dailySummaryHour: 21,
    dailySummaryMinute: 0,
    proteinGoal: null,
    carbsGoal: null,
    fatGoal: null,
    sodiumGoal: null,
    sodiumIsMax: true,
    ...overrides,
  };
}

function makeTotals(overrides = {}) {
  return {
    calories: 1500,
    protein: 80,
    carbs: 150,
    fat: 50,
    sodium: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  silenceConsole();
  resetState();
  invalidateDailySummaryCache();
  // Stub the persistence-touching deps so unrelated tests do not hit the real DB.
  setDeps({
    loadRecentSent: async () => [],
    recordSent: async () => {},
    pruneOldSent: async () => {},
  });
});

afterEach(() => {
  resetDeps();
  resetState();
  invalidateDailySummaryCache();
  restoreConsole();
});

after(async () => {
  // Close the pg pool that was opened when ../server/db.js was imported,
  // so the test process exits cleanly.
  try {
    const { pool } = await import("../server/db.js");
    await pool.end();
  } catch {
    /* ignore */
  }
});

test("buckets group users by timezone + scheduled hour:minute", async () => {
  const userA = makeUser({ id: 1, email: "a@x.com", timezone: "Asia/Hong_Kong", dailySummaryHour: 21, dailySummaryMinute: 0 });
  const userB = makeUser({ id: 2, email: "b@x.com", timezone: "America/New_York", dailySummaryHour: 21, dailySummaryMinute: 0 });
  const userC = makeUser({ id: 3, email: "c@x.com", timezone: "Asia/Hong_Kong", dailySummaryHour: 9, dailySummaryMinute: 30 });
  const userD = makeUser({ id: 4, email: "d@x.com", timezone: "Asia/Hong_Kong", dailySummaryHour: 21, dailySummaryMinute: 0 });

  setDeps({ loadEnabledUsers: async () => [userA, userB, userC, userD] });
  await loadDailySummaryUserBuckets();

  const buckets = getBuckets();
  assert.equal(buckets.size, 3, "expected three distinct buckets");
  assert.deepEqual(
    [...buckets.keys()].sort(),
    [
      "America/New_York|21:0",
      "Asia/Hong_Kong|21:0",
      "Asia/Hong_Kong|9:30",
    ],
  );

  const hkEvening = buckets.get("Asia/Hong_Kong|21:0");
  assert.equal(hkEvening.users.length, 2);
  assert.deepEqual(hkEvening.users.map((u) => u.id).sort(), [1, 4]);
});

test("users with missing or short lineUserId are skipped during bucket load", async () => {
  const linked = makeUser({ id: 1 });
  const unlinked = makeUser({ id: 2, lineUserId: null });
  const tooShort = makeUser({ id: 3, lineUserId: "abc" });

  setDeps({ loadEnabledUsers: async () => [linked, unlinked, tooShort] });
  await loadDailySummaryUserBuckets();

  const allUsers = [...getBuckets().values()].flatMap((b) => b.users);
  assert.deepEqual(allUsers.map((u) => u.id), [1]);
});

test("each user gets a summary at their own local hour:minute", async () => {
  const hkUser = makeUser({ id: 10, lineUserId: "U_hk_1234567890", timezone: "Asia/Hong_Kong", dailySummaryHour: 21, dailySummaryMinute: 0 });
  const nyUser = makeUser({ id: 20, lineUserId: "U_ny_1234567890", timezone: "America/New_York", dailySummaryHour: 9, dailySummaryMinute: 15 });

  // "Now" in HK is 21:00, in NY is 09:15 - both buckets should fire.
  const fakeTimes = {
    "Asia/Hong_Kong": { hour: 21, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" },
    "America/New_York": { hour: 9, minute: 15, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" },
  };

  const pushed = [];
  setDeps({
    loadEnabledUsers: async () => [hkUser, nyUser],
    getTimeInTimezone: (tz) => fakeTimes[tz],
    getTodayMacroTotals: async () => makeTotals(),
    pushMessage: async (lineUserId, msg) => pushed.push({ lineUserId, msg }),
  });

  await sendDailyFoodSummaryToAllUsers();

  assert.equal(pushed.length, 2);
  const recipients = pushed.map((p) => p.lineUserId).sort();
  assert.deepEqual(recipients, ["U_hk_1234567890", "U_ny_1234567890"]);
});

test("only buckets whose local hour AND minute match are sent", async () => {
  const hkUser = makeUser({ id: 10, lineUserId: "U_hk_1234567890", timezone: "Asia/Hong_Kong", dailySummaryHour: 21, dailySummaryMinute: 0 });
  const nyUser = makeUser({ id: 20, lineUserId: "U_ny_1234567890", timezone: "America/New_York", dailySummaryHour: 9, dailySummaryMinute: 15 });
  const tokyoUser = makeUser({ id: 30, lineUserId: "U_tk_1234567890", timezone: "Asia/Tokyo", dailySummaryHour: 8, dailySummaryMinute: 0 });

  const fakeTimes = {
    "Asia/Hong_Kong": { hour: 21, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" },   // matches
    "America/New_York": { hour: 9, minute: 14, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }, // off by 1 minute
    "Asia/Tokyo": { hour: 7, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" },        // off by 1 hour
  };

  const pushed = [];
  setDeps({
    loadEnabledUsers: async () => [hkUser, nyUser, tokyoUser],
    getTimeInTimezone: (tz) => fakeTimes[tz],
    getTodayMacroTotals: async () => makeTotals(),
    pushMessage: async (lineUserId, msg) => pushed.push({ lineUserId, msg }),
  });

  await sendDailyFoodSummaryToAllUsers();

  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].lineUserId, "U_hk_1234567890");
});

test("users with no food today receive nothing (and are dedup-marked)", async () => {
  const u1 = makeUser({ id: 1, lineUserId: "U_full___________", timezone: "Asia/Hong_Kong" });
  const u2 = makeUser({ id: 2, lineUserId: "U_empty__________", timezone: "Asia/Hong_Kong" });

  const pushed = [];
  setDeps({
    loadEnabledUsers: async () => [u1, u2],
    getTimeInTimezone: () => ({ hour: 21, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    getTodayMacroTotals: async (uid) =>
      uid === 1 ? makeTotals() : { calories: 0, protein: 0, carbs: 0, fat: 0, sodium: 0 },
    pushMessage: async (lineUserId, msg) => pushed.push({ lineUserId, msg }),
  });

  await sendDailyFoodSummaryToAllUsers();
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].lineUserId, "U_full___________");

  // Both users should be dedup-marked so nothing fires again on a second tick.
  assert.equal(getLastSent().get(1), "2026-1-15:21:0");
  assert.equal(getLastSent().get(2), "2026-1-15:21:0");
});

test("a user receives at most one summary per scheduled time per day across many ticks", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user__________1", timezone: "Asia/Hong_Kong", dailySummaryHour: 21, dailySummaryMinute: 0 });

  const pushed = [];
  setDeps({
    loadEnabledUsers: async () => [user],
    getTimeInTimezone: () => ({ hour: 21, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    getTodayMacroTotals: async () => makeTotals(),
    pushMessage: async (lineUserId, msg) => pushed.push({ lineUserId, msg }),
  });

  // Simulate scheduler firing 5 times within the same target minute.
  for (let i = 0; i < 5; i++) {
    await sendDailyFoodSummaryToAllUsers();
  }

  assert.equal(pushed.length, 1, "user should only receive one summary per scheduled time per day");
});

test("a user can receive again on the next day at the same scheduled time", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user__________1", timezone: "Asia/Hong_Kong", dailySummaryHour: 21, dailySummaryMinute: 0 });

  const pushed = [];
  let day = "2026-1-15";
  setDeps({
    loadEnabledUsers: async () => [user],
    getTimeInTimezone: () => ({ hour: 21, minute: 0, todayStr: day, yesterdayStr: "2026-1-14" }),
    getTodayMacroTotals: async () => makeTotals(),
    pushMessage: async (lineUserId, msg) => pushed.push({ lineUserId, day, msg }),
  });

  await sendDailyFoodSummaryToAllUsers();
  await sendDailyFoodSummaryToAllUsers(); // dedup
  assert.equal(pushed.length, 1);

  // Next day at the same hour:minute -> dedup key changes -> should fire again.
  day = "2026-1-16";
  await sendDailyFoodSummaryToAllUsers();
  assert.equal(pushed.length, 2);
  assert.equal(pushed[1].day, "2026-1-16");
});

test("changing dailySummaryHour takes effect after cache invalidation", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user__________1", timezone: "Asia/Hong_Kong", dailySummaryHour: 21, dailySummaryMinute: 0 });

  let dbUsers = [user];
  const pushed = [];
  setDeps({
    loadEnabledUsers: async () => dbUsers,
    getTimeInTimezone: () => ({ hour: 9, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    getTodayMacroTotals: async () => makeTotals(),
    pushMessage: async (lineUserId, msg) => pushed.push({ lineUserId, msg }),
  });

  // First tick: scheduled for 21:00, current time is 09:00 -> nothing.
  await sendDailyFoodSummaryToAllUsers();
  assert.equal(pushed.length, 0);

  // User changes their schedule to 09:00, but we have NOT invalidated the cache yet.
  dbUsers = [{ ...user, dailySummaryHour: 9 }];
  await sendDailyFoodSummaryToAllUsers();
  assert.equal(pushed.length, 0, "cached buckets still target 21:00 - nothing should fire");

  // After invalidation, the next tick reloads and fires.
  invalidateDailySummaryCache();
  await sendDailyFoodSummaryToAllUsers();
  assert.equal(pushed.length, 1);
});

test("changing dailySummaryMinute takes effect after cache invalidation", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user__________1", timezone: "Asia/Hong_Kong", dailySummaryHour: 9, dailySummaryMinute: 0 });

  let dbUsers = [user];
  const pushed = [];
  setDeps({
    loadEnabledUsers: async () => dbUsers,
    getTimeInTimezone: () => ({ hour: 9, minute: 30, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    getTodayMacroTotals: async () => makeTotals(),
    pushMessage: async (lineUserId, msg) => pushed.push({ lineUserId, msg }),
  });

  await sendDailyFoodSummaryToAllUsers();
  assert.equal(pushed.length, 0, "scheduled at 09:00 but it is 09:30 - nothing");

  dbUsers = [{ ...user, dailySummaryMinute: 30 }];
  invalidateDailySummaryCache();
  await sendDailyFoodSummaryToAllUsers();
  assert.equal(pushed.length, 1);
});

test("changing timezone takes effect after cache invalidation", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user__________1", timezone: "Asia/Hong_Kong", dailySummaryHour: 21, dailySummaryMinute: 0 });

  let dbUsers = [user];
  const pushed = [];
  // It is 21:00 in NY, but only 09:00 in HK.
  setDeps({
    loadEnabledUsers: async () => dbUsers,
    getTimeInTimezone: (tz) =>
      tz === "America/New_York"
        ? { hour: 21, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }
        : { hour: 9, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" },
    getTodayMacroTotals: async () => makeTotals(),
    pushMessage: async (lineUserId, msg) => pushed.push({ lineUserId, msg }),
  });

  await sendDailyFoodSummaryToAllUsers();
  assert.equal(pushed.length, 0);

  dbUsers = [{ ...user, timezone: "America/New_York" }];
  invalidateDailySummaryCache();
  await sendDailyFoodSummaryToAllUsers();
  assert.equal(pushed.length, 1);
});

test("changing dailySummaryEnabled takes effect after cache invalidation", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user__________1", timezone: "Asia/Hong_Kong", dailySummaryHour: 21, dailySummaryMinute: 0 });

  let dbUsers = [user];
  const pushed = [];
  setDeps({
    // Mirror real DB: only return users with dailySummaryEnabled=true.
    loadEnabledUsers: async () => dbUsers.filter((u) => u.dailySummaryEnabled),
    getTimeInTimezone: () => ({ hour: 21, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    getTodayMacroTotals: async () => makeTotals(),
    pushMessage: async (lineUserId, msg) => pushed.push({ lineUserId, msg }),
  });

  await sendDailyFoodSummaryToAllUsers();
  assert.equal(pushed.length, 1);

  // User opts out, but we don't invalidate yet -> dedup means no extra send anyway,
  // but the bucket still contains them. The real test is for the next day.
  dbUsers = [{ ...user, dailySummaryEnabled: false }];

  // Without invalidation, on a fresh day the user would still be in the cached bucket.
  resetState(); // simulate process restart / time-of-cache wipe to mimic "next day" cleanly
  setDeps({
    loadEnabledUsers: async () => dbUsers.filter((u) => u.dailySummaryEnabled),
    getTimeInTimezone: () => ({ hour: 21, minute: 0, todayStr: "2026-1-16", yesterdayStr: "2026-1-15" }),
    getTodayMacroTotals: async () => makeTotals(),
    pushMessage: async (lineUserId, msg) => pushed.push({ lineUserId, msg }),
  });
  invalidateDailySummaryCache();

  await sendDailyFoodSummaryToAllUsers();
  assert.equal(pushed.length, 1, "opted-out user should not receive anything on the next day");
});

test("PUT /api/user wires cache invalidation for scheduler-relevant fields", async () => {
  // Lightweight integration guard: confirms the route handler still calls
  // invalidateDailySummaryCache() and only when scheduler-relevant fields change.
  // Avoids spinning up Express + a real DB connection while still catching
  // accidental removal of the wiring.
  const src = await readFile(new URL("../server/routes.js", import.meta.url), "utf8");

  // Extract the PUT /api/user handler block.
  const start = src.indexOf('router.put("/api/user"');
  assert.notEqual(start, -1, "could not find PUT /api/user route");
  // Find the closing `});` of the handler by tracking braces from the first `{`.
  const openBrace = src.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = openBrace; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.notEqual(end, -1, "could not find end of PUT /api/user handler");
  const handler = src.slice(start, end + 1);

  assert.match(handler, /invalidateDailySummaryCache\(\)/);

  for (const field of [
    "dailySummaryEnabled",
    "dailySummaryHour",
    "dailySummaryMinute",
    "timezone",
  ]) {
    assert.match(
      handler,
      new RegExp(`updates\\.${field}\\s*!==\\s*undefined`),
      `handler should guard cache invalidation on updates.${field}`,
    );
  }
});

test("after a server restart within the same minute, no duplicate summary is sent", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user__________1", timezone: "Asia/Hong_Kong", dailySummaryHour: 21, dailySummaryMinute: 0 });

  // Simulated persistent dedup table: survives the in-memory state reset.
  const persisted = []; // [{ uid, dedupKey, sentAt }]
  const pushed = [];

  const baseDeps = {
    loadEnabledUsers: async () => [user],
    getTimeInTimezone: () => ({ hour: 21, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    getTodayMacroTotals: async () => makeTotals(),
    pushMessage: async (lineUserId, msg) => pushed.push({ lineUserId, msg }),
    loadRecentSent: async () =>
      [...persisted].sort((a, b) => a.sentAt - b.sentAt).map((r) => ({ uid: r.uid, dedupKey: r.dedupKey })),
    recordSent: async (uid, dedupKey) => {
      if (!persisted.some((r) => r.uid === uid && r.dedupKey === dedupKey)) {
        persisted.push({ uid, dedupKey, sentAt: new Date() });
      }
    },
    pruneOldSent: async () => {},
  };

  setDeps(baseDeps);

  // First tick: send the summary. Both in-memory map and persisted table get the dedup row.
  await sendDailyFoodSummaryToAllUsers();
  assert.equal(pushed.length, 1);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].dedupKey, "2026-1-15:21:0");

  // Simulate a server restart inside the same target minute:
  //   - in-memory dedup map is wiped
  //   - the bucket cache is wiped
  //   - the persisted dedup row survives
  resetState();
  invalidateDailySummaryCache();
  setDeps(baseDeps);

  // Second tick after "restart": should hydrate from persisted row and skip the user.
  await sendDailyFoodSummaryToAllUsers();
  assert.equal(pushed.length, 1, "no duplicate summary after restart");
  assert.equal(persisted.length, 1, "no duplicate persisted row after restart");
  assert.equal(getLastSent().get(1), "2026-1-15:21:0", "in-memory map rehydrated from persisted state");
});

test("hydration from persisted state prefers today's dedup key over yesterday's", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user__________1", timezone: "Asia/Hong_Kong", dailySummaryHour: 21, dailySummaryMinute: 0 });

  const pushed = [];
  // Persisted rows: yesterday FIRST, today SECOND. loadRecentSent must return them ordered by sentAt ASC,
  // so today's value overwrites yesterday's in the in-memory map -> next tick at 21:00 today is a no-op.
  setDeps({
    loadEnabledUsers: async () => [user],
    getTimeInTimezone: () => ({ hour: 21, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    getTodayMacroTotals: async () => makeTotals(),
    pushMessage: async (lineUserId, msg) => pushed.push({ lineUserId, msg }),
    loadRecentSent: async () => [
      { uid: 1, dedupKey: "2026-1-14:21:0" },
      { uid: 1, dedupKey: "2026-1-15:21:0" },
    ],
    recordSent: async () => {},
    pruneOldSent: async () => {},
  });

  await sendDailyFoodSummaryToAllUsers();
  assert.equal(pushed.length, 0, "today's dedup key wins on hydration -> no send");
});

test("pruneOldSent is invoked on first hydration", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user__________1", timezone: "Asia/Hong_Kong", dailySummaryHour: 21, dailySummaryMinute: 0 });

  let pruneCalls = 0;
  let prunePromiseResolve;
  const prunePromise = new Promise((res) => { prunePromiseResolve = res; });

  setDeps({
    loadEnabledUsers: async () => [user],
    getTimeInTimezone: () => ({ hour: 9, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    getTodayMacroTotals: async () => makeTotals(),
    pushMessage: async () => {},
    loadRecentSent: async () => [],
    recordSent: async () => {},
    pruneOldSent: async () => { pruneCalls++; prunePromiseResolve(); },
  });

  await sendDailyFoodSummaryToAllUsers();
  await prunePromise;
  assert.equal(pruneCalls, 1, "prune should fire once on hydration");

  // A subsequent tick within the same process should NOT re-hydrate or re-prune.
  await sendDailyFoodSummaryToAllUsers();
  assert.equal(pruneCalls, 1, "prune should not fire again until state is reset");
});

test("hydration retries on the next tick if loadRecentSent fails the first time", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user__________1", timezone: "Asia/Hong_Kong", dailySummaryHour: 21, dailySummaryMinute: 0 });

  // Simulated persistent dedup table that already contains today's row -
  // analogous to a server that just sent before crashing/restarting.
  const persisted = [{ uid: 1, dedupKey: "2026-1-15:21:0" }];
  const pushed = [];
  let loadAttempts = 0;

  setDeps({
    loadEnabledUsers: async () => [user],
    getTimeInTimezone: () => ({ hour: 21, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    getTodayMacroTotals: async () => makeTotals(),
    pushMessage: async (lineUserId, msg) => pushed.push({ lineUserId, msg }),
    loadRecentSent: async () => {
      loadAttempts++;
      if (loadAttempts === 1) throw new Error("transient DB error");
      return persisted;
    },
    recordSent: async () => {},
    pruneOldSent: async () => {},
  });

  // First tick: hydration fails -> in-memory map stays empty.
  // BUT we should NOT proceed to send unprotected; instead we leave the
  // hydrated flag false so the next tick retries.
  await sendDailyFoodSummaryToAllUsers();
  // Without hydrated state, the user looks unsent -> a duplicate would have
  // been pushed if we did not also retry. To assert retry behavior cleanly,
  // we check that loadAttempts is 1 and not stuck.
  assert.equal(loadAttempts, 1, "first tick attempted hydration");

  // Second tick: hydration succeeds, persisted row is loaded, no duplicate sent.
  await sendDailyFoodSummaryToAllUsers();
  assert.equal(loadAttempts, 2, "second tick retried hydration");
  // Total push count after both ticks: 1 (first) + 0 (second, deduped) = 1.
  // The first tick pushed because hydration failed, but the second tick
  // correctly recognizes the user as already sent.
  assert.equal(pushed.length, 1, "second tick after successful hydration is deduped");

  // Third tick: hydration is cached, no further loadRecentSent calls.
  await sendDailyFoodSummaryToAllUsers();
  assert.equal(loadAttempts, 2, "third tick uses cached hydration");
  assert.equal(pushed.length, 1);
});

test("if pushMessage throws for one user, other users still get their summary", async () => {
  const u1 = makeUser({ id: 1, email: "u1@x.com", lineUserId: "U_user__________1", timezone: "Asia/Hong_Kong" });
  const u2 = makeUser({ id: 2, email: "u2@x.com", lineUserId: "U_user__________2", timezone: "Asia/Hong_Kong" });

  const pushed = [];
  setDeps({
    loadEnabledUsers: async () => [u1, u2],
    getTimeInTimezone: () => ({ hour: 21, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    getTodayMacroTotals: async () => makeTotals(),
    pushMessage: async (lineUserId, msg) => {
      if (lineUserId === "U_user__________1") throw new Error("LINE down");
      pushed.push({ lineUserId, msg });
    },
  });

  await sendDailyFoodSummaryToAllUsers();

  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].lineUserId, "U_user__________2");
  // The failed user is NOT marked as sent and should retry on the next tick.
  assert.equal(getLastSent().get(1), undefined);
  assert.equal(getLastSent().get(2), "2026-1-15:21:0");
});

test("getStatsSnapshot exposes empty stats before any buckets are loaded", () => {
  const stats = getStatsSnapshot();
  assert.equal(stats.targetHour, null);
  assert.equal(stats.targetMinute, null);
  assert.deepEqual(stats.knownTimezones, []);
  assert.deepEqual(stats.buckets, []);
  assert.equal(stats.tickErrorCount, 0);
  assert.equal(stats.lastTickErrorMessage, null);
  assert.equal(stats.cacheLoadedAt, null);
});

test("getStatsSnapshot exposes known timezones grouped from per-schedule buckets", async () => {
  const userA = makeUser({ id: 1, timezone: "Asia/Hong_Kong", dailySummaryHour: 21, dailySummaryMinute: 0 });
  const userB = makeUser({ id: 2, timezone: "Asia/Hong_Kong", dailySummaryHour: 9, dailySummaryMinute: 0 });
  const userC = makeUser({ id: 3, timezone: "America/New_York", dailySummaryHour: 21, dailySummaryMinute: 0 });

  setDeps({ loadEnabledUsers: async () => [userA, userB, userC] });
  await loadDailySummaryUserBuckets();

  const stats = getStatsSnapshot();
  // Buckets: 3 (HK 21:0, HK 9:0, NY 21:0); knownTimezones is grouped by tz.
  assert.equal(stats.buckets.length, 3);
  assert.deepEqual(
    stats.knownTimezones,
    [
      { timezone: "America/New_York", userCount: 1 },
      { timezone: "Asia/Hong_Kong", userCount: 2 },
    ],
  );
  for (const b of stats.buckets) {
    assert.equal(b.lastRunAt, null);
    assert.equal(b.lastRunUserCount, 0);
    assert.equal(b.lastRunSentCount, 0);
    assert.equal(b.errorCount, 0);
  }
  assert.ok(stats.cacheLoadedAt, "cacheLoadedAt should be set after loading buckets");
});

test("a successful tick records lastRunAt, attempted user count, and sent count per bucket", async () => {
  const u1 = makeUser({ id: 1, lineUserId: "U_user__________1", timezone: "Asia/Hong_Kong" });
  const u2 = makeUser({ id: 2, lineUserId: "U_user__________2", timezone: "Asia/Hong_Kong" });
  setDeps({
    loadEnabledUsers: async () => [u1, u2],
    getTimeInTimezone: () => ({ hour: 21, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    getTodayMacroTotals: async () => makeTotals(),
    pushMessage: async () => {},
  });

  await sendDailyFoodSummaryToAllUsers();

  const stats = getStatsSnapshot();
  const hk = stats.buckets.find((b) => b.timezone === "Asia/Hong_Kong");
  assert.ok(hk);
  assert.equal(hk.hour, 21);
  assert.equal(hk.minute, 0);
  assert.ok(hk.lastRunAt);
  assert.equal(hk.lastRunUserCount, 2);
  assert.equal(hk.lastRunSentCount, 2);
  assert.equal(hk.errorCount, 0);
  assert.equal(hk.lastErrorMessage, null);
});

test("per-user push failures are surfaced in bucket errorCount/lastErrorMessage", async () => {
  const u1 = makeUser({ id: 1, lineUserId: "U_user__________1", timezone: "Asia/Hong_Kong" });
  const u2 = makeUser({ id: 2, lineUserId: "U_user__________2", timezone: "Asia/Hong_Kong" });
  setDeps({
    loadEnabledUsers: async () => [u1, u2],
    getTimeInTimezone: () => ({ hour: 21, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    getTodayMacroTotals: async () => makeTotals(),
    pushMessage: async (lineUserId) => {
      if (lineUserId === "U_user__________1") throw new Error("LINE down");
    },
  });

  await sendDailyFoodSummaryToAllUsers();

  const stats = getStatsSnapshot();
  const hk = stats.buckets.find((b) => b.timezone === "Asia/Hong_Kong");
  assert.ok(hk);
  assert.equal(hk.errorCount, 1);
  assert.match(hk.lastErrorMessage, /push failed/);
  // Sanitized error must not embed user email or id.
  assert.equal(/u\d+@x\.com|uid\s+\d+/i.test(hk.lastErrorMessage), false);
  // The successful user still counts as sent (1/2).
  assert.equal(hk.lastRunUserCount, 2);
  assert.equal(hk.lastRunSentCount, 1);
  assert.ok(hk.lastErrorAt);
});

test("recordDailySummaryBucketError accumulates across distinct error events", () => {
  recordDailySummaryBucketRun("Asia/Hong_Kong", 9, 0, 2, 2);
  recordDailySummaryBucketError("Asia/Hong_Kong", 9, 0, "push failed: timeout");
  recordDailySummaryBucketError("Asia/Hong_Kong", 9, 0, "push failed: 5xx");

  const stats = getStatsSnapshot();
  const hk = stats.buckets.find((b) => b.timezone === "Asia/Hong_Kong" && b.hour === 9);
  assert.ok(hk);
  assert.equal(hk.errorCount, 2);
  assert.equal(hk.lastErrorMessage, "push failed: 5xx");
  assert.ok(hk.lastErrorAt);
  // lastRunAt from the prior recorded run is retained across error records.
  assert.ok(hk.lastRunAt);
  assert.equal(hk.lastRunUserCount, 2);
  assert.equal(hk.lastRunSentCount, 2);
});

test("a tick that throws before reaching any bucket is recorded as a tick-level error", async () => {
  setDeps({
    loadEnabledUsers: async () => { throw new Error("DB down"); },
  });

  await sendDailyFoodSummaryToAllUsers();
  const stats = getStatsSnapshot();
  assert.equal(stats.tickErrorCount, 1);
  assert.match(stats.lastTickErrorMessage, /DB down/);
  assert.ok(stats.lastTickErrorAt);
  assert.deepEqual(stats.buckets, []);
});

test("an off-target tick does not record a run for the bucket", async () => {
  const u1 = makeUser({ id: 1, lineUserId: "U_user__________1", timezone: "Asia/Hong_Kong", dailySummaryHour: 21 });
  setDeps({
    loadEnabledUsers: async () => [u1],
    getTimeInTimezone: () => ({ hour: 9, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    getTodayMacroTotals: async () => makeTotals(),
    pushMessage: async () => {},
  });

  await sendDailyFoodSummaryToAllUsers();
  const stats = getStatsSnapshot();
  const hk = stats.buckets.find((b) => b.timezone === "Asia/Hong_Kong");
  assert.ok(hk);
  assert.equal(hk.lastRunAt, null);
  assert.equal(hk.lastRunUserCount, 0);
});
