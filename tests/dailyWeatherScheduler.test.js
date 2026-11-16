import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";

import {
  __dailyWeatherTesting,
  invalidateDailyWeatherCache,
} from "../server/lineBot.js";

const {
  setDeps,
  resetDeps,
  resetState,
  loadDailyWeatherUserBuckets,
  tickDailyWeatherScheduler,
  getBuckets,
  getLastSent,
  getStatsSnapshot,
  recordDailyWeatherBucketRun,
  recordDailyWeatherBucketError,
  WEATHER_TARGET_HOUR,
  WEATHER_TARGET_MINUTE,
} = __dailyWeatherTesting;

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
    ...overrides,
  };
}

beforeEach(() => {
  silenceConsole();
  resetState();
  invalidateDailyWeatherCache();
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
  invalidateDailyWeatherCache();
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

test("only LINE-linked users are loaded into the cache (short / missing IDs filtered)", async () => {
  const linked = makeUser({ id: 1, lineUserId: "U_linked_1234567890" });
  const tooShort = makeUser({ id: 2, lineUserId: "abc" });
  const empty = makeUser({ id: 3, lineUserId: "" });

  // The real loader only returns users with a non-null lineUserId; we still
  // include the short one to verify the in-memory length filter as well.
  setDeps({ loadLinkedUsers: async () => [linked, tooShort, empty] });
  await loadDailyWeatherUserBuckets();

  const allUsers = [...getBuckets().values()].flatMap((b) => b.users);
  assert.deepEqual(allUsers.map((u) => u.id), [1]);
});

test("buckets group LINE-linked users by timezone", async () => {
  const hk1 = makeUser({ id: 1, lineUserId: "U_hk_1____________", timezone: "Asia/Hong_Kong" });
  const hk2 = makeUser({ id: 2, lineUserId: "U_hk_2____________", timezone: "Asia/Hong_Kong" });
  const ny  = makeUser({ id: 3, lineUserId: "U_ny______________", timezone: "America/New_York" });
  const tk  = makeUser({ id: 4, lineUserId: "U_tk______________", timezone: "Asia/Tokyo" });

  setDeps({ loadLinkedUsers: async () => [hk1, hk2, ny, tk] });
  await loadDailyWeatherUserBuckets();

  const buckets = getBuckets();
  assert.equal(buckets.size, 3);
  assert.deepEqual(
    [...buckets.keys()].sort(),
    ["America/New_York", "Asia/Hong_Kong", "Asia/Tokyo"],
  );
  assert.deepEqual(buckets.get("Asia/Hong_Kong").users.map((u) => u.id).sort(), [1, 2]);
  assert.equal(buckets.get("America/New_York").users.length, 1);
  assert.equal(buckets.get("Asia/Tokyo").users.length, 1);
});

test("users with null timezone fall back to Asia/Hong_Kong", async () => {
  const noTz = makeUser({ id: 1, lineUserId: "U_no_tz___________", timezone: null });

  setDeps({ loadLinkedUsers: async () => [noTz] });
  await loadDailyWeatherUserBuckets();

  const buckets = getBuckets();
  assert.equal(buckets.size, 1);
  assert.ok(buckets.has("Asia/Hong_Kong"));
});

test("WEATHER_TARGET_HOUR is 7:00 local", () => {
  assert.equal(WEATHER_TARGET_HOUR, 7);
  assert.equal(WEATHER_TARGET_MINUTE, 0);
});

test("each bucket only fires when its local time is 7:00", async () => {
  const hkUser = makeUser({ id: 10, lineUserId: "U_hk______________", timezone: "Asia/Hong_Kong" });
  const nyUser = makeUser({ id: 20, lineUserId: "U_ny______________", timezone: "America/New_York" });
  const tkUser = makeUser({ id: 30, lineUserId: "U_tk______________", timezone: "Asia/Tokyo" });

  // Only HK is at 7:00; NY is 6:59 (off by 1 minute), Tokyo is 8:00 (off by 1 hour).
  const fakeTimes = {
    "Asia/Hong_Kong":   { hour: 7, minute: 0,  todayStr: "2026-1-15", yesterdayStr: "2026-1-14" },
    "America/New_York": { hour: 6, minute: 59, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" },
    "Asia/Tokyo":       { hour: 8, minute: 0,  todayStr: "2026-1-15", yesterdayStr: "2026-1-14" },
  };

  const sentBatches = [];
  setDeps({
    loadLinkedUsers: async () => [hkUser, nyUser, tkUser],
    getTimeInTimezone: (tz) => fakeTimes[tz],
    sendDailyWeatherToUsers: async (targetUsers) => {
      sentBatches.push(targetUsers.map((u) => u.id));
      return { forecastOk: true, sentUserIds: targetUsers.map((u) => u.id) };
    },
  });

  await tickDailyWeatherScheduler();

  assert.equal(sentBatches.length, 1, "only the HK bucket should fire");
  assert.deepEqual(sentBatches[0], [10]);
});

test("multiple timezones can fire on the same tick when each is at local 7:00", async () => {
  const hkUser = makeUser({ id: 1, lineUserId: "U_hk______________", timezone: "Asia/Hong_Kong" });
  const nyUser = makeUser({ id: 2, lineUserId: "U_ny______________", timezone: "America/New_York" });

  const fakeTimes = {
    "Asia/Hong_Kong":   { hour: 7, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" },
    "America/New_York": { hour: 7, minute: 0, todayStr: "2026-1-14", yesterdayStr: "2026-1-13" },
  };

  const recipients = [];
  setDeps({
    loadLinkedUsers: async () => [hkUser, nyUser],
    getTimeInTimezone: (tz) => fakeTimes[tz],
    sendDailyWeatherToUsers: async (targetUsers) => {
      for (const u of targetUsers) recipients.push(u.id);
      return { forecastOk: true, sentUserIds: targetUsers.map((u) => u.id) };
    },
  });

  await tickDailyWeatherScheduler();

  assert.deepEqual(recipients.sort(), [1, 2]);
});

test("a user receives at most one weather push per local calendar day", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user_1__________", timezone: "Asia/Hong_Kong" });

  let sendCount = 0;
  setDeps({
    loadLinkedUsers: async () => [user],
    getTimeInTimezone: () => ({ hour: 7, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    sendDailyWeatherToUsers: async (targetUsers) => {
      sendCount += targetUsers.length;
      return { forecastOk: true, sentUserIds: targetUsers.map((u) => u.id) };
    },
  });

  // Many ticks within the same target minute: should only send once.
  for (let i = 0; i < 5; i++) {
    await tickDailyWeatherScheduler();
  }

  assert.equal(sendCount, 1);
  assert.equal(getLastSent().get(1), "2026-1-15");
});

test("a user receives again on the next local calendar day", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user_1__________", timezone: "Asia/Hong_Kong" });

  let day = "2026-1-15";
  const days = [];
  setDeps({
    loadLinkedUsers: async () => [user],
    getTimeInTimezone: () => ({ hour: 7, minute: 0, todayStr: day, yesterdayStr: "2026-1-14" }),
    sendDailyWeatherToUsers: async (targetUsers) => {
      for (let i = 0; i < targetUsers.length; i++) days.push(day);
      return { forecastOk: true, sentUserIds: targetUsers.map((u) => u.id) };
    },
  });

  await tickDailyWeatherScheduler();
  await tickDailyWeatherScheduler(); // dedup
  assert.deepEqual(days, ["2026-1-15"]);

  day = "2026-1-16";
  await tickDailyWeatherScheduler();
  assert.deepEqual(days, ["2026-1-15", "2026-1-16"]);
});

test("dedup is keyed per local calendar day, not by elapsed wall-clock time", async () => {
  // Two users in different timezones, each at their own local 7:00 but on
  // different local-day strings. The HK user has already received today; the
  // NY user has not, so only NY should fire.
  const hkUser = makeUser({ id: 1, lineUserId: "U_hk______________", timezone: "Asia/Hong_Kong" });
  const nyUser = makeUser({ id: 2, lineUserId: "U_ny______________", timezone: "America/New_York" });

  const fakeTimes = {
    "Asia/Hong_Kong":   { hour: 7, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" },
    "America/New_York": { hour: 7, minute: 0, todayStr: "2026-1-14", yesterdayStr: "2026-1-13" },
  };

  const recipients = [];
  setDeps({
    loadLinkedUsers: async () => [hkUser, nyUser],
    getTimeInTimezone: (tz) => fakeTimes[tz],
    sendDailyWeatherToUsers: async (targetUsers) => {
      for (const u of targetUsers) recipients.push(u.id);
      return { forecastOk: true, sentUserIds: targetUsers.map((u) => u.id) };
    },
  });

  // Pre-mark HK user as already sent today.
  await loadDailyWeatherUserBuckets();
  getLastSent().set(1, "2026-1-15");

  await tickDailyWeatherScheduler();

  assert.deepEqual(recipients, [2]);
});

test("invalidateDailyWeatherCache() forces the next tick to re-read from the database", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user_1__________", timezone: "Asia/Hong_Kong" });

  let dbUsers = [user];
  let loadCount = 0;
  setDeps({
    loadLinkedUsers: async () => {
      loadCount++;
      return dbUsers;
    },
    // Pretend it's not 7:00 so nothing is actually pushed; we only care about
    // when the loader is called.
    getTimeInTimezone: () => ({ hour: 9, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    sendDailyWeatherToUsers: async () => ({ forecastOk: true, sentUserIds: [] }),
  });

  await tickDailyWeatherScheduler();
  assert.equal(loadCount, 1, "first tick triggers a load");

  // A second tick within the cache TTL should NOT re-load.
  await tickDailyWeatherScheduler();
  assert.equal(loadCount, 1, "still cached");

  // Add a brand-new linked user. Without invalidation the bucket is stale.
  const user2 = makeUser({ id: 2, lineUserId: "U_user_2__________", timezone: "Asia/Tokyo" });
  dbUsers = [user, user2];

  await tickDailyWeatherScheduler();
  assert.equal(loadCount, 1, "still cached - new DB user not yet visible");
  assert.equal(getBuckets().size, 1, "bucket still only has the original timezone");

  // After invalidation, the next tick must re-read.
  invalidateDailyWeatherCache();
  await tickDailyWeatherScheduler();
  assert.equal(loadCount, 2, "cache invalidation forced a reload");
  assert.equal(getBuckets().size, 2, "new timezone bucket is now present");
});

test("invalidateDailyWeatherCache() picks up timezone changes on the next tick", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user_1__________", timezone: "Asia/Hong_Kong" });

  let dbUsers = [user];
  // It is 7:00 in NY but 19:00 in HK.
  setDeps({
    loadLinkedUsers: async () => dbUsers,
    getTimeInTimezone: (tz) =>
      tz === "America/New_York"
        ? { hour: 7, minute: 0,  todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }
        : { hour: 19, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" },
    sendDailyWeatherToUsers: async (targetUsers) => ({ forecastOk: true, sentUserIds: targetUsers.map((u) => u.id) }),
  });

  await tickDailyWeatherScheduler();
  assert.equal(getLastSent().get(1), undefined, "HK at 19:00 is not 7:00 - nothing");

  // User changes to NY; without invalidation the cached bucket still says HK.
  dbUsers = [{ ...user, timezone: "America/New_York" }];
  await tickDailyWeatherScheduler();
  assert.equal(getLastSent().get(1), undefined, "stale HK bucket - still nothing");

  // Invalidate -> next tick reloads -> NY bucket fires at local 7:00.
  invalidateDailyWeatherCache();
  await tickDailyWeatherScheduler();
  assert.equal(getLastSent().get(1), "2026-1-15", "user now fires under NY tz at local 7:00");
});

test("invalidateDailyWeatherCache() removes a newly unlinked user", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user_1__________", timezone: "Asia/Hong_Kong" });

  let dbUsers = [user];
  let pushedCount = 0;
  setDeps({
    // Mirror the real DB behaviour: only return rows where lineUserId IS NOT NULL.
    loadLinkedUsers: async () => dbUsers.filter((u) => u.lineUserId),
    getTimeInTimezone: () => ({ hour: 7, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    sendDailyWeatherToUsers: async (targetUsers) => {
      pushedCount += targetUsers.length;
      return { forecastOk: true, sentUserIds: targetUsers.map((u) => u.id) };
    },
  });

  await tickDailyWeatherScheduler();
  assert.equal(pushedCount, 1);

  // User unlinks LINE; jump to the next day so the dedup key changes.
  dbUsers = [{ ...user, lineUserId: null }];
  resetState();
  setDeps({
    loadLinkedUsers: async () => dbUsers.filter((u) => u.lineUserId),
    getTimeInTimezone: () => ({ hour: 7, minute: 0, todayStr: "2026-1-16", yesterdayStr: "2026-1-15" }),
    sendDailyWeatherToUsers: async (targetUsers) => {
      pushedCount += targetUsers.length;
      return { forecastOk: true, sentUserIds: targetUsers.map((u) => u.id) };
    },
  });
  invalidateDailyWeatherCache();

  await tickDailyWeatherScheduler();
  assert.equal(pushedCount, 1, "unlinked user should not receive a push the next day");
  assert.equal(getBuckets().size, 0, "no buckets after unlink + reload");
});

test("changing dailyWeatherEnabled takes effect after cache invalidation", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user_1__________", timezone: "Asia/Hong_Kong", dailyWeatherEnabled: true });

  let dbUsers = [user];
  let pushedCount = 0;
  setDeps({
    // Mirror real DB: only return users with lineUserId set AND dailyWeatherEnabled=true.
    loadLinkedUsers: async () => dbUsers.filter((u) => u.lineUserId && u.dailyWeatherEnabled),
    getTimeInTimezone: () => ({ hour: 7, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    sendDailyWeatherToUsers: async (targetUsers) => {
      pushedCount += targetUsers.length;
      return { forecastOk: true, sentUserIds: targetUsers.map((u) => u.id) };
    },
  });

  await tickDailyWeatherScheduler();
  assert.equal(pushedCount, 1, "opted-in user receives today");

  // User opts out of weather push.
  dbUsers = [{ ...user, dailyWeatherEnabled: false }];
  resetState(); // simulate fresh next-day state
  setDeps({
    loadLinkedUsers: async () => dbUsers.filter((u) => u.lineUserId && u.dailyWeatherEnabled),
    getTimeInTimezone: () => ({ hour: 7, minute: 0, todayStr: "2026-1-16", yesterdayStr: "2026-1-15" }),
    sendDailyWeatherToUsers: async (targetUsers) => {
      pushedCount += targetUsers.length;
      return { forecastOk: true, sentUserIds: targetUsers.map((u) => u.id) };
    },
  });
  invalidateDailyWeatherCache();

  await tickDailyWeatherScheduler();
  assert.equal(pushedCount, 1, "opted-out user should not receive a push the next day");
  assert.equal(getBuckets().size, 0, "no buckets after opt-out + reload");
});

test("if sendDailyWeatherToUsers throws, the tick logs and does not crash", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user_1__________", timezone: "Asia/Hong_Kong" });

  setDeps({
    loadLinkedUsers: async () => [user],
    getTimeInTimezone: () => ({ hour: 7, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    sendDailyWeatherToUsers: async () => {
      throw new Error("HKO down");
    },
  });

  await tickDailyWeatherScheduler();
  // The user should NOT be marked as sent, so a later successful tick can
  // still deliver today.
  assert.equal(getLastSent().get(1), undefined);
});

test("forecast fetch failure leaves all users unmarked so the next tick retries", async () => {
  const u1 = makeUser({ id: 1, lineUserId: "U_user_1__________", timezone: "Asia/Hong_Kong" });
  const u2 = makeUser({ id: 2, lineUserId: "U_user_2__________", timezone: "Asia/Hong_Kong" });

  let callCount = 0;
  const sentBatches = [];
  setDeps({
    loadLinkedUsers: async () => [u1, u2],
    getTimeInTimezone: () => ({ hour: 7, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    sendDailyWeatherToUsers: async (targetUsers) => {
      callCount++;
      if (callCount === 1) {
        // Forecast fetch failed on the first tick - nobody should be marked.
        return { forecastOk: false, sentUserIds: [] };
      }
      sentBatches.push(targetUsers.map((u) => u.id));
      return { forecastOk: true, sentUserIds: targetUsers.map((u) => u.id) };
    },
  });

  await tickDailyWeatherScheduler();
  assert.equal(getLastSent().get(1), undefined, "user 1 not marked when forecast failed");
  assert.equal(getLastSent().get(2), undefined, "user 2 not marked when forecast failed");

  // Next tick within the same minute should retry both users.
  await tickDailyWeatherScheduler();
  assert.deepEqual(sentBatches, [[1, 2]], "second tick retries the same users");
  assert.equal(getLastSent().get(1), "2026-1-15");
  assert.equal(getLastSent().get(2), "2026-1-15");
});

test("a per-user push failure leaves only that user unmarked for retry", async () => {
  const u1 = makeUser({ id: 1, lineUserId: "U_user_1__________", timezone: "Asia/Hong_Kong" });
  const u2 = makeUser({ id: 2, lineUserId: "U_user_2__________", timezone: "Asia/Hong_Kong" });
  const u3 = makeUser({ id: 3, lineUserId: "U_user_3__________", timezone: "Asia/Hong_Kong" });

  let callCount = 0;
  const sentBatches = [];
  setDeps({
    loadLinkedUsers: async () => [u1, u2, u3],
    getTimeInTimezone: () => ({ hour: 7, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    sendDailyWeatherToUsers: async (targetUsers) => {
      callCount++;
      sentBatches.push(targetUsers.map((u) => u.id));
      if (callCount === 1) {
        // Forecast OK, but user 2's push failed - only 1 and 3 succeeded.
        return { forecastOk: true, sentUserIds: [1, 3] };
      }
      // Retry tick: user 2 succeeds this time.
      return { forecastOk: true, sentUserIds: targetUsers.map((u) => u.id) };
    },
  });

  await tickDailyWeatherScheduler();
  assert.equal(getLastSent().get(1), "2026-1-15", "successful user 1 marked");
  assert.equal(getLastSent().get(2), undefined, "failed user 2 NOT marked");
  assert.equal(getLastSent().get(3), "2026-1-15", "successful user 3 marked");

  // Next tick should only retry user 2 (the others are already marked).
  await tickDailyWeatherScheduler();
  assert.deepEqual(sentBatches[1], [2], "only the previously failed user is retried");
  assert.equal(getLastSent().get(2), "2026-1-15", "retried user is now marked");
});

test("forecast unavailable (empty message) leaves users unmarked for retry", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user_1__________", timezone: "Asia/Hong_Kong" });

  let callCount = 0;
  setDeps({
    loadLinkedUsers: async () => [user],
    getTimeInTimezone: () => ({ hour: 7, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    sendDailyWeatherToUsers: async (targetUsers) => {
      callCount++;
      // Simulate "forecast returned but produced an empty message" - same retry
      // semantics as a fetch failure.
      if (callCount === 1) return { forecastOk: false, sentUserIds: [] };
      return { forecastOk: true, sentUserIds: targetUsers.map((u) => u.id) };
    },
  });

  await tickDailyWeatherScheduler();
  assert.equal(getLastSent().get(1), undefined);

  await tickDailyWeatherScheduler();
  assert.equal(getLastSent().get(1), "2026-1-15");
});

test("a server restart between two ticks within the same minute does not re-push", async () => {
  // First "boot": no persisted history, send normally and verify the dedup
  // marker is recorded both in memory and in the persisted store.
  const user = makeUser({ id: 1, lineUserId: "U_user_1__________", timezone: "Asia/Hong_Kong" });

  const persisted = []; // simulates the daily_weather_sent table
  let sendCount = 0;

  setDeps({
    loadLinkedUsers: async () => [user],
    getTimeInTimezone: () => ({ hour: 7, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    sendDailyWeatherToUsers: async (targetUsers) => {
      sendCount += targetUsers.length;
      return { forecastOk: true, sentUserIds: targetUsers.map((u) => u.id) };
    },
    loadRecentSent: async () => persisted.map((r) => ({ ...r })),
    recordSent: async (uid, dedupKey) => {
      if (!persisted.some((r) => r.uid === uid && r.dedupKey === dedupKey)) {
        persisted.push({ uid, dedupKey });
      }
    },
    pruneOldSent: async () => {},
  });

  await tickDailyWeatherScheduler();
  assert.equal(sendCount, 1, "first tick sends once");
  assert.equal(getLastSent().get(1), "2026-1-15");
  assert.deepEqual(persisted, [{ uid: 1, dedupKey: "2026-1-15" }]);

  // Simulate a server restart in the middle of the target minute: in-memory
  // state is wiped (Map cleared, hydrated flag reset, bucket cache reset),
  // but the persisted table survives.
  resetState();
  invalidateDailyWeatherCache();

  // Re-install the same fakes (resetState does not clear deps, but be explicit).
  setDeps({
    loadLinkedUsers: async () => [user],
    getTimeInTimezone: () => ({ hour: 7, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    sendDailyWeatherToUsers: async (targetUsers) => {
      sendCount += targetUsers.length;
      return { forecastOk: true, sentUserIds: targetUsers.map((u) => u.id) };
    },
    loadRecentSent: async () => persisted.map((r) => ({ ...r })),
    recordSent: async (uid, dedupKey) => {
      if (!persisted.some((r) => r.uid === uid && r.dedupKey === dedupKey)) {
        persisted.push({ uid, dedupKey });
      }
    },
    pruneOldSent: async () => {},
  });

  await tickDailyWeatherScheduler();

  // The crucial assertion: even though local time is still 07:00 on the same
  // local day, the persisted dedup marker prevents a duplicate push.
  assert.equal(sendCount, 1, "no extra push after restart within the same minute");
  assert.equal(getLastSent().get(1), "2026-1-15", "in-memory marker re-hydrated from store");
  assert.deepEqual(persisted, [{ uid: 1, dedupKey: "2026-1-15" }]);
});

test("hydration loads the latest dedup key per user across multiple persisted rows", async () => {
  // Simulates a process that has been running for >1 day: the persisted store
  // contains an old marker (yesterday) and a new marker (today). Hydration
  // should pick the latest (rows are ordered by sentAt ASC).
  const user = makeUser({ id: 7, lineUserId: "U_user_7__________", timezone: "Asia/Hong_Kong" });

  let sendCount = 0;
  setDeps({
    loadLinkedUsers: async () => [user],
    getTimeInTimezone: () => ({ hour: 7, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    sendDailyWeatherToUsers: async (targetUsers) => {
      sendCount += targetUsers.length;
      return { forecastOk: true, sentUserIds: targetUsers.map((u) => u.id) };
    },
    loadRecentSent: async () => [
      { uid: 7, dedupKey: "2026-1-14" }, // yesterday (older)
      { uid: 7, dedupKey: "2026-1-15" }, // today    (newer)
    ],
    recordSent: async () => {},
    pruneOldSent: async () => {},
  });

  await tickDailyWeatherScheduler();
  assert.equal(sendCount, 0, "today's marker was hydrated; no push");
  assert.equal(getLastSent().get(7), "2026-1-15");
});

test("if hydration fails, the next tick retries hydration instead of running unprotected", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user_1__________", timezone: "Asia/Hong_Kong" });

  let loadCount = 0;
  let sendCount = 0;
  setDeps({
    loadLinkedUsers: async () => [user],
    getTimeInTimezone: () => ({ hour: 7, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    sendDailyWeatherToUsers: async (targetUsers) => {
      sendCount += targetUsers.length;
      return { forecastOk: true, sentUserIds: targetUsers.map((u) => u.id) };
    },
    loadRecentSent: async () => {
      loadCount++;
      if (loadCount === 1) throw new Error("DB blip");
      // Second attempt: hydration succeeds and reports today's marker, so a
      // second tick should NOT re-push even though the in-memory map was
      // never written by the first (hydration-failed) tick.
      return [{ uid: 1, dedupKey: "2026-1-15" }];
    },
    recordSent: async () => {},
    pruneOldSent: async () => {},
  });

  // First tick: hydration fails -> in-memory map is empty -> the user gets a
  // push. (We accept that one push happens; the contract is that the next
  // tick must NOT pile a second one on top.)
  await tickDailyWeatherScheduler();
  assert.equal(sendCount, 1);

  // Second tick: hydration succeeds and reads back today's marker (which was
  // written via persistDailyWeatherSent during the first tick in production;
  // here we hard-code it in the fake store to focus on the retry semantic).
  await tickDailyWeatherScheduler();
  assert.equal(loadCount, 2, "hydration was retried after the first failure");
  assert.equal(sendCount, 1, "no duplicate push on the second tick");
});

test("getStatsSnapshot exposes target hour/minute and empty stats before any tick", () => {
  const stats = getStatsSnapshot();
  assert.equal(stats.targetHour, WEATHER_TARGET_HOUR);
  assert.equal(stats.targetMinute, WEATHER_TARGET_MINUTE);
  assert.deepEqual(stats.knownTimezones, []);
  assert.deepEqual(stats.buckets, []);
  assert.equal(stats.tickErrorCount, 0);
  assert.equal(stats.lastTickErrorMessage, null);
  assert.equal(stats.cacheLoadedAt, null);
});

test("getStatsSnapshot exposes known timezones once buckets are loaded", async () => {
  const hkUser = makeUser({ id: 1, lineUserId: "U_hk______________", timezone: "Asia/Hong_Kong" });
  const nyUser = makeUser({ id: 2, lineUserId: "U_ny______________", timezone: "America/New_York" });
  setDeps({ loadLinkedUsers: async () => [hkUser, nyUser] });
  await loadDailyWeatherUserBuckets();

  const stats = getStatsSnapshot();
  assert.deepEqual(
    stats.knownTimezones,
    [
      { timezone: "America/New_York", userCount: 1 },
      { timezone: "Asia/Hong_Kong", userCount: 1 },
    ],
  );
  assert.equal(stats.buckets.length, 2);
  for (const b of stats.buckets) {
    assert.equal(b.lastRunAt, null);
    assert.equal(b.errorCount, 0);
  }
  assert.ok(stats.cacheLoadedAt);
});

test("a successful tick records lastRunAt, attempted user count, and sent count per bucket", async () => {
  const u1 = makeUser({ id: 1, lineUserId: "U_user_1__________", timezone: "Asia/Hong_Kong" });
  const u2 = makeUser({ id: 2, lineUserId: "U_user_2__________", timezone: "Asia/Hong_Kong" });
  setDeps({
    loadLinkedUsers: async () => [u1, u2],
    getTimeInTimezone: () => ({ hour: 7, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    sendDailyWeatherToUsers: async (users) => ({
      forecastOk: true, sentUserIds: users.map((u) => u.id),
    }),
  });

  await tickDailyWeatherScheduler();

  const stats = getStatsSnapshot();
  const hk = stats.buckets.find((b) => b.timezone === "Asia/Hong_Kong");
  assert.ok(hk);
  assert.ok(hk.lastRunAt);
  assert.equal(hk.lastRunUserCount, 2);
  assert.equal(hk.lastRunSentCount, 2);
  assert.equal(hk.errorCount, 0);
  assert.equal(hk.lastErrorMessage, null);
});

test("forecast unavailable surfaces as a bucket error and zero-sent run", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user_1__________", timezone: "Asia/Hong_Kong" });
  setDeps({
    loadLinkedUsers: async () => [user],
    getTimeInTimezone: () => ({ hour: 7, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    sendDailyWeatherToUsers: async () => ({ forecastOk: false, sentUserIds: [] }),
  });

  await tickDailyWeatherScheduler();
  const stats = getStatsSnapshot();
  const hk = stats.buckets.find((b) => b.timezone === "Asia/Hong_Kong");
  assert.ok(hk);
  assert.equal(hk.errorCount, 1);
  assert.match(hk.lastErrorMessage, /forecast unavailable/);
  assert.equal(hk.lastRunUserCount, 1);
  assert.equal(hk.lastRunSentCount, 0);
});

test("partial per-user failures surface as a bucket error", async () => {
  const u1 = makeUser({ id: 1, lineUserId: "U_user_1__________", timezone: "Asia/Hong_Kong" });
  const u2 = makeUser({ id: 2, lineUserId: "U_user_2__________", timezone: "Asia/Hong_Kong" });
  setDeps({
    loadLinkedUsers: async () => [u1, u2],
    getTimeInTimezone: () => ({ hour: 7, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    sendDailyWeatherToUsers: async () => ({ forecastOk: true, sentUserIds: [1] }),
  });

  await tickDailyWeatherScheduler();
  const stats = getStatsSnapshot();
  const hk = stats.buckets.find((b) => b.timezone === "Asia/Hong_Kong");
  assert.ok(hk);
  assert.equal(hk.lastRunUserCount, 2);
  assert.equal(hk.lastRunSentCount, 1);
  assert.equal(hk.errorCount, 1);
  assert.match(hk.lastErrorMessage, /partial push: 1\/2/);
  // Sanitized message must not embed user IDs.
  assert.equal(/uid\s+\d+/i.test(hk.lastErrorMessage), false);
});

test("a sender exception is recorded as both a bucket error and a tick-level error", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user_1__________", timezone: "Asia/Hong_Kong" });
  setDeps({
    loadLinkedUsers: async () => [user],
    getTimeInTimezone: () => ({ hour: 7, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    sendDailyWeatherToUsers: async () => { throw new Error("HKO down"); },
  });

  await tickDailyWeatherScheduler();
  const stats = getStatsSnapshot();
  const hk = stats.buckets.find((b) => b.timezone === "Asia/Hong_Kong");
  assert.ok(hk);
  assert.equal(hk.errorCount, 1);
  assert.match(hk.lastErrorMessage, /send failed.*HKO down/);
  assert.equal(stats.tickErrorCount, 1);
  assert.match(stats.lastTickErrorMessage, /HKO down/);
});

test("recordDailyWeatherBucketError accumulates across distinct error events", () => {
  recordDailyWeatherBucketRun("Asia/Hong_Kong", 3, 3);
  recordDailyWeatherBucketError("Asia/Hong_Kong", "forecast unavailable");
  recordDailyWeatherBucketError("Asia/Hong_Kong", "partial push: 2/3 succeeded");
  const stats = getStatsSnapshot();
  const hk = stats.buckets.find((b) => b.timezone === "Asia/Hong_Kong");
  assert.ok(hk);
  assert.equal(hk.errorCount, 2);
  assert.equal(hk.lastErrorMessage, "partial push: 2/3 succeeded");
  assert.ok(hk.lastErrorAt);
  assert.ok(hk.lastRunAt, "lastRunAt should be retained across error records");
  assert.equal(hk.lastRunUserCount, 3);
  assert.equal(hk.lastRunSentCount, 3);
});

test("an off-target tick does not record a run for the bucket", async () => {
  const user = makeUser({ id: 1, lineUserId: "U_user_1__________", timezone: "Asia/Hong_Kong" });
  setDeps({
    loadLinkedUsers: async () => [user],
    getTimeInTimezone: () => ({ hour: 9, minute: 0, todayStr: "2026-1-15", yesterdayStr: "2026-1-14" }),
    sendDailyWeatherToUsers: async () => ({ forecastOk: true, sentUserIds: [1] }),
  });

  await tickDailyWeatherScheduler();
  const stats = getStatsSnapshot();
  const hk = stats.buckets.find((b) => b.timezone === "Asia/Hong_Kong");
  assert.ok(hk);
  assert.equal(hk.lastRunAt, null);
  assert.equal(hk.lastRunUserCount, 0);
});
