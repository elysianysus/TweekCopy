import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";

import {
  __recurrenceSchedulerTesting,
  invalidateRecurrenceUserCache,
} from "../server/scheduler.js";

const {
  setDeps,
  resetDeps,
  resetState,
  loadRecurrenceUserBuckets,
  tickRecurrenceScheduler,
  getBuckets,
  getLastRunOn,
  getStatsSnapshot,
  recordBucketError,
  recordBucketRun,
  resolveSeriesHorizonDays,
  clampHorizonDays,
  MATERIALIZE_TARGET_HOUR,
  MATERIALIZE_TARGET_MINUTE,
  DEFAULT_REPEAT_HORIZON_DAYS,
  MIN_HORIZON_DAYS,
  MAX_HORIZON_DAYS,
} = __recurrenceSchedulerTesting;

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

beforeEach(() => {
  silenceConsole();
  resetState();
  invalidateRecurrenceUserCache();
});

afterEach(() => {
  resetDeps();
  resetState();
  invalidateRecurrenceUserCache();
  restoreConsole();
});

after(async () => {
  try {
    const { pool } = await import("../server/db.js");
    await pool.end();
  } catch {
    /* ignore */
  }
});

// -- Pure helpers ----------------------------------------------------------

test("DEFAULT_REPEAT_HORIZON_DAYS reaches at least the year view", () => {
  assert.ok(
    DEFAULT_REPEAT_HORIZON_DAYS >= 365,
    `default horizon should cover a year (got ${DEFAULT_REPEAT_HORIZON_DAYS})`,
  );
});

test("clampHorizonDays clamps inside [MIN, MAX] and rejects junk", () => {
  assert.equal(clampHorizonDays(MIN_HORIZON_DAYS - 1), MIN_HORIZON_DAYS);
  assert.equal(clampHorizonDays(MAX_HORIZON_DAYS + 1), MAX_HORIZON_DAYS);
  assert.equal(clampHorizonDays(60), 60);
  assert.equal(clampHorizonDays(60.7), 60);
  assert.equal(clampHorizonDays(NaN), null);
  assert.equal(clampHorizonDays(Infinity), null);
});

test("resolveSeriesHorizonDays prefers explicit override, then template, then default", () => {
  assert.equal(resolveSeriesHorizonDays({ horizonDays: 90 }, 30), 30);
  assert.equal(resolveSeriesHorizonDays({ horizonDays: 90 }, null), 90);
  assert.equal(resolveSeriesHorizonDays({}, null), DEFAULT_REPEAT_HORIZON_DAYS);
  assert.equal(resolveSeriesHorizonDays(null, null), DEFAULT_REPEAT_HORIZON_DAYS);
  // Out-of-range template value gets clamped to the safe range.
  assert.equal(
    resolveSeriesHorizonDays({ horizonDays: MAX_HORIZON_DAYS + 50 }, null),
    MAX_HORIZON_DAYS,
  );
});

// -- Scheduler / buckets ---------------------------------------------------

test("buckets only include users that actually have recurring tasks", async () => {
  setDeps({
    loadAllUsersWithTimezone: async () => [
      { id: 1, timezone: "Asia/Hong_Kong" },
      { id: 2, timezone: "Asia/Hong_Kong" },
      { id: 3, timezone: "America/New_York" },
    ],
    loadUidsWithRecurringTasks: async () => [1, 3],
  });
  await loadRecurrenceUserBuckets();
  const buckets = getBuckets();
  const allIds = [...buckets.values()].flatMap((b) => b.users.map((u) => u.id)).sort();
  assert.deepEqual(allIds, [1, 3]);
  assert.deepEqual([...buckets.keys()].sort(), ["America/New_York", "Asia/Hong_Kong"]);
});

test("users with null timezone fall back to Asia/Hong_Kong", async () => {
  setDeps({
    loadAllUsersWithTimezone: async () => [{ id: 1, timezone: null }],
    loadUidsWithRecurringTasks: async () => [1],
  });
  await loadRecurrenceUserBuckets();
  const buckets = getBuckets();
  assert.equal(buckets.size, 1);
  assert.ok(buckets.has("Asia/Hong_Kong"));
});

test("MATERIALIZE_TARGET_HOUR defaults to a quiet hour (overnight)", () => {
  assert.ok(
    MATERIALIZE_TARGET_HOUR >= 0 && MATERIALIZE_TARGET_HOUR <= 5,
    `target hour should be quiet/overnight (got ${MATERIALIZE_TARGET_HOUR})`,
  );
  assert.equal(MATERIALIZE_TARGET_MINUTE, 0);
});

test("each bucket only fires when its local time matches the target", async () => {
  const fakeTimes = {
    "Asia/Hong_Kong":   { hour: MATERIALIZE_TARGET_HOUR, minute: MATERIALIZE_TARGET_MINUTE, todayStr: "2026-2-1" },
    "America/New_York": { hour: MATERIALIZE_TARGET_HOUR, minute: (MATERIALIZE_TARGET_MINUTE + 1) % 60, todayStr: "2026-2-1" },
    "Asia/Tokyo":       { hour: (MATERIALIZE_TARGET_HOUR + 1) % 24, minute: MATERIALIZE_TARGET_MINUTE, todayStr: "2026-2-1" },
  };

  const ranFor = [];
  setDeps({
    loadAllUsersWithTimezone: async () => [
      { id: 10, timezone: "Asia/Hong_Kong" },
      { id: 20, timezone: "America/New_York" },
      { id: 30, timezone: "Asia/Tokyo" },
    ],
    loadUidsWithRecurringTasks: async () => [10, 20, 30],
    getTimeInTimezone: (tz) => fakeTimes[tz],
    loadUserTimezone: async (uid) =>
      uid === 10 ? "Asia/Hong_Kong" : uid === 20 ? "America/New_York" : "Asia/Tokyo",
  });

  // Stub out the actual DB-touching materializer indirectly by recording
  // which uids the scheduler processes via getLastRunOn after the tick.
  // Replace materializeSeriesForUser via dep injection on the buckets' users
  // is not possible, but we can inspect getLastRunOn() to see who ran.
  // To keep this test free of DB calls, intercept the scheduler at the
  // dep boundary: provide a stub for getTimeInTimezone above.

  // We cannot easily stub materializeSeriesForUser without DI; instead,
  // run the tick and verify only the HK user got marked as run-today.
  // Wrap to swallow DB errors from the real materializer (no DB in tests).
  await tickRecurrenceScheduler().catch(() => {});

  // Only HK should have a recorded last-run; others should not because
  // their bucket was skipped before any DB work was attempted.
  const lastRun = getLastRunOn();
  ranFor.push(...lastRun.keys());
  assert.deepEqual(ranFor.sort(), [10]);
});

test("a user only runs once per local calendar day even across many ticks", async () => {
  const fakeTimes = {
    "Asia/Hong_Kong": {
      hour: MATERIALIZE_TARGET_HOUR,
      minute: MATERIALIZE_TARGET_MINUTE,
      todayStr: "2026-3-10",
    },
  };
  setDeps({
    loadAllUsersWithTimezone: async () => [{ id: 1, timezone: "Asia/Hong_Kong" }],
    loadUidsWithRecurringTasks: async () => [1],
    getTimeInTimezone: (tz) => fakeTimes[tz],
    loadUserTimezone: async () => "Asia/Hong_Kong",
  });

  for (let i = 0; i < 4; i++) {
    await tickRecurrenceScheduler().catch(() => {});
  }

  const lastRun = getLastRunOn();
  assert.equal(lastRun.size, 1);
  assert.equal(lastRun.get(1), "2026-3-10");
});

test("a user runs again on the next local calendar day", async () => {
  let day = "2026-4-1";
  setDeps({
    loadAllUsersWithTimezone: async () => [{ id: 1, timezone: "Asia/Hong_Kong" }],
    loadUidsWithRecurringTasks: async () => [1],
    getTimeInTimezone: () => ({
      hour: MATERIALIZE_TARGET_HOUR,
      minute: MATERIALIZE_TARGET_MINUTE,
      todayStr: day,
    }),
    loadUserTimezone: async () => "Asia/Hong_Kong",
  });

  await tickRecurrenceScheduler().catch(() => {});
  await tickRecurrenceScheduler().catch(() => {}); // dedup
  assert.equal(getLastRunOn().get(1), "2026-4-1");

  day = "2026-4-2";
  await tickRecurrenceScheduler().catch(() => {});
  assert.equal(getLastRunOn().get(1), "2026-4-2");
});

test("invalidateRecurrenceUserCache() forces the next tick to re-load buckets", async () => {
  let dbUsers = [{ id: 1, timezone: "Asia/Hong_Kong" }];
  let loadCount = 0;
  setDeps({
    loadAllUsersWithTimezone: async () => {
      loadCount++;
      return dbUsers;
    },
    loadUidsWithRecurringTasks: async () => dbUsers.map((u) => u.id),
    // Off-target hour so no actual materialization is attempted.
    getTimeInTimezone: () => ({
      hour: (MATERIALIZE_TARGET_HOUR + 5) % 24,
      minute: 30,
      todayStr: "2026-5-1",
    }),
    loadUserTimezone: async () => "Asia/Hong_Kong",
  });

  await tickRecurrenceScheduler();
  assert.equal(loadCount, 1, "first tick triggers a load");

  await tickRecurrenceScheduler();
  assert.equal(loadCount, 1, "still cached on second tick");

  invalidateRecurrenceUserCache();
  dbUsers = [
    { id: 1, timezone: "Asia/Hong_Kong" },
    { id: 2, timezone: "America/New_York" },
  ];
  await tickRecurrenceScheduler();
  assert.equal(loadCount, 2, "invalidation forces a re-load");
  const buckets = getBuckets();
  assert.equal([...buckets.values()].flatMap((b) => b.users).length, 2);
});

// -- Diagnostic stats ------------------------------------------------------

test("getStatsSnapshot exposes config and known timezones once buckets are loaded", async () => {
  setDeps({
    loadAllUsersWithTimezone: async () => [
      { id: 1, timezone: "Asia/Hong_Kong" },
      { id: 2, timezone: "Asia/Hong_Kong" },
      { id: 3, timezone: "America/New_York" },
    ],
    loadUidsWithRecurringTasks: async () => [1, 3],
  });
  await loadRecurrenceUserBuckets();
  const stats = getStatsSnapshot();
  assert.equal(stats.targetHour, MATERIALIZE_TARGET_HOUR);
  assert.equal(stats.targetMinute, MATERIALIZE_TARGET_MINUTE);
  assert.equal(stats.horizonDays, DEFAULT_REPEAT_HORIZON_DAYS);
  assert.deepEqual(
    stats.knownTimezones.map((b) => b.timezone),
    ["America/New_York", "Asia/Hong_Kong"],
  );
  assert.deepEqual(
    stats.buckets.map((b) => b.timezone).sort(),
    ["America/New_York", "Asia/Hong_Kong"],
  );
  for (const b of stats.buckets) {
    assert.equal(b.lastRunAt, null);
    assert.equal(b.errorCount, 0);
  }
  assert.equal(stats.tickErrorCount, 0);
  assert.equal(stats.lastTickErrorMessage, null);
});

test("a tick records lastRunAt, user count, and created count per bucket", async () => {
  // Use a uid that almost certainly has no recurring tasks so the real
  // materializer just returns 0 quickly without inserting anything.
  setDeps({
    loadAllUsersWithTimezone: async () => [
      { id: -987654321, timezone: "Asia/Hong_Kong" },
    ],
    loadUidsWithRecurringTasks: async () => [-987654321],
    getTimeInTimezone: () => ({
      hour: MATERIALIZE_TARGET_HOUR,
      minute: MATERIALIZE_TARGET_MINUTE,
      todayStr: "2026-6-1",
    }),
    loadUserTimezone: async () => "Asia/Hong_Kong",
  });

  await tickRecurrenceScheduler();

  const stats = getStatsSnapshot();
  const hk = stats.buckets.find((b) => b.timezone === "Asia/Hong_Kong");
  assert.ok(hk, "expected Asia/Hong_Kong bucket in stats");
  assert.ok(hk.lastRunAt, "lastRunAt should be set after a tick");
  assert.equal(hk.lastRunUserCount, 1);
  assert.equal(hk.lastRunCreatedCount, 0);
  assert.equal(hk.errorCount, 0);
  assert.equal(hk.lastErrorMessage, null);
});

test("per-user materialize errors are surfaced in bucket stats", async () => {
  // Seed a bucket so the timezone is "known" in the stats snapshot.
  setDeps({
    loadAllUsersWithTimezone: async () => [{ id: 1, timezone: "Asia/Hong_Kong" }],
    loadUidsWithRecurringTasks: async () => [1],
  });
  await loadRecurrenceUserBuckets();

  // Simulate two distinct per-user materialize failures inside the bucket.
  recordBucketRun("Asia/Hong_Kong", 2, 0);
  recordBucketError("Asia/Hong_Kong", "materialize failed: db connection lost");
  recordBucketError("Asia/Hong_Kong", "materialize failed: timeout after 30s");

  const stats = getStatsSnapshot();
  const hk = stats.buckets.find((b) => b.timezone === "Asia/Hong_Kong");
  assert.ok(hk);
  assert.equal(hk.errorCount, 2, "errorCount should accumulate across errors");
  assert.equal(
    hk.lastErrorMessage,
    "materialize failed: timeout after 30s",
    "lastErrorMessage should hold the most recent error",
  );
  assert.ok(hk.lastErrorAt, "lastErrorAt should be populated when an error is recorded");
  // lastRunAt from the run we recorded earlier should still be present.
  assert.ok(hk.lastRunAt, "lastRunAt should be retained across error records");
  assert.equal(hk.lastRunUserCount, 2);
  assert.equal(hk.lastRunCreatedCount, 0);
  // Surfaced error string must not embed user IDs.
  assert.equal(/uid\s+\d+/i.test(hk.lastErrorMessage), false);
});

test("scheduler stats survive across many no-op ticks (off-target hour)", async () => {
  setDeps({
    loadAllUsersWithTimezone: async () => [{ id: 1, timezone: "Asia/Hong_Kong" }],
    loadUidsWithRecurringTasks: async () => [1],
    // Off-target hour so no bucket actually fires
    getTimeInTimezone: () => ({
      hour: (MATERIALIZE_TARGET_HOUR + 7) % 24,
      minute: 15,
      todayStr: "2026-7-1",
    }),
    loadUserTimezone: async () => "Asia/Hong_Kong",
  });

  await tickRecurrenceScheduler();
  await tickRecurrenceScheduler();

  const stats = getStatsSnapshot();
  // Bucket is known but never fired -> lastRunAt remains null
  const hk = stats.buckets.find((b) => b.timezone === "Asia/Hong_Kong");
  assert.ok(hk);
  assert.equal(hk.lastRunAt, null);
  assert.equal(hk.errorCount, 0);
  assert.equal(stats.tickErrorCount, 0);
  assert.ok(stats.cacheLoadedAt, "cacheLoadedAt should be set once buckets are loaded");
});
