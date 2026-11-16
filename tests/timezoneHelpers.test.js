import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  userTimezone,
  getNowInTz,
  getUserNow,
  todayInTz,
  userToday,
  todayPaddedInTz,
  userTodayPadded,
  yesterdayInTz,
  userYesterday,
  getUserTimeParts,
  getTimePartsInTz,
  getNextOccurrenceInTz,
} from "../server/timezone.js";

const RealDate = globalThis.Date;

function freezeNow(isoUtc) {
  const fixed = new RealDate(isoUtc).getTime();
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(fixed);
      } else {
        super(...args);
      }
    }
    static now() {
      return fixed;
    }
  }
  globalThis.Date = FakeDate;
}

function restoreDate() {
  globalThis.Date = RealDate;
}

afterEach(() => {
  restoreDate();
});

// ---------- userTimezone ----------

test("userTimezone falls back to Asia/Hong_Kong when user is null/undefined", () => {
  assert.equal(userTimezone(null), "Asia/Hong_Kong");
  assert.equal(userTimezone(undefined), "Asia/Hong_Kong");
});

test("userTimezone falls back to default when user has no timezone", () => {
  assert.equal(userTimezone({}), "Asia/Hong_Kong");
  assert.equal(userTimezone({ timezone: "" }), "Asia/Hong_Kong");
  assert.equal(userTimezone({ timezone: null }), "Asia/Hong_Kong");
});

test("userTimezone returns the user's timezone when set", () => {
  assert.equal(userTimezone({ timezone: "Europe/London" }), "Europe/London");
  assert.equal(userTimezone({ timezone: "America/New_York" }), "America/New_York");
});

// ---------- getNowInTz across timezones ----------

test("getNowInTz returns the local hour in Asia/Hong_Kong (UTC+8)", () => {
  // 2025-06-15T03:30:00Z → Hong Kong is UTC+8 → 11:30 local
  freezeNow("2025-06-15T03:30:00Z");
  const d = getNowInTz("Asia/Hong_Kong");
  assert.equal(d.getHours(), 11);
  assert.equal(d.getMinutes(), 30);
  assert.equal(d.getFullYear(), 2025);
  assert.equal(d.getMonth(), 5); // June (0-indexed)
  assert.equal(d.getDate(), 15);
});

test("getNowInTz returns the local hour in America/New_York (winter, EST = UTC-5)", () => {
  // 2025-01-15T13:00:00Z → EST is UTC-5 → 08:00 local
  freezeNow("2025-01-15T13:00:00Z");
  const d = getNowInTz("America/New_York");
  assert.equal(d.getHours(), 8);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getDate(), 15);
});

test("getNowInTz returns the local hour in America/New_York (summer, EDT = UTC-4)", () => {
  // 2025-07-15T13:00:00Z → EDT is UTC-4 → 09:00 local
  freezeNow("2025-07-15T13:00:00Z");
  const d = getNowInTz("America/New_York");
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 0);
});

test("getNowInTz returns the local hour in Europe/London (winter, GMT = UTC+0)", () => {
  // 2025-01-15T09:30:00Z → London GMT → 09:30 local
  freezeNow("2025-01-15T09:30:00Z");
  const d = getNowInTz("Europe/London");
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 30);
});

test("getNowInTz returns the local hour in Europe/London (summer, BST = UTC+1)", () => {
  // 2025-07-15T09:30:00Z → London BST → 10:30 local
  freezeNow("2025-07-15T09:30:00Z");
  const d = getNowInTz("Europe/London");
  assert.equal(d.getHours(), 10);
  assert.equal(d.getMinutes(), 30);
});

test("getNowInTz crosses date boundaries: 23:00 UTC → next-day in Hong Kong", () => {
  // 2025-06-15T23:00:00Z → HK UTC+8 → 2025-06-16 07:00
  freezeNow("2025-06-15T23:00:00Z");
  const d = getNowInTz("Asia/Hong_Kong");
  assert.equal(d.getDate(), 16);
  assert.equal(d.getHours(), 7);
});

test("getNowInTz crosses date boundaries: 02:00 UTC → previous-day in New York", () => {
  // 2025-06-15T02:00:00Z → EDT UTC-4 → 2025-06-14 22:00
  freezeNow("2025-06-15T02:00:00Z");
  const d = getNowInTz("America/New_York");
  assert.equal(d.getDate(), 14);
  assert.equal(d.getHours(), 22);
});

test("getNowInTz falls back to default when given an invalid timezone", () => {
  freezeNow("2025-06-15T03:30:00Z");
  const d = getNowInTz("Not/A_Real_Zone");
  // Should fall back to Asia/Hong_Kong → 11:30 local
  assert.equal(d.getHours(), 11);
  assert.equal(d.getMinutes(), 30);
});

test("getNowInTz uses default when tz is null/undefined/empty", () => {
  freezeNow("2025-06-15T03:30:00Z");
  assert.equal(getNowInTz(undefined).getHours(), 11);
  assert.equal(getNowInTz(null).getHours(), 11);
  assert.equal(getNowInTz("").getHours(), 11);
});

// ---------- getUserNow ----------

test("getUserNow uses the user's timezone", () => {
  freezeNow("2025-06-15T03:30:00Z");
  const d = getUserNow({ timezone: "America/New_York" }); // EDT → 23:30 prev day
  assert.equal(d.getDate(), 14);
  assert.equal(d.getHours(), 23);
  assert.equal(d.getMinutes(), 30);
});

test("getUserNow falls back to default for null user", () => {
  freezeNow("2025-06-15T03:30:00Z");
  const d = getUserNow(null); // HK → 11:30
  assert.equal(d.getHours(), 11);
});

// ---------- todayInTz / userToday ----------

test("todayInTz returns YYYY-M-D (no padding) in Asia/Hong_Kong", () => {
  freezeNow("2025-06-15T03:30:00Z");
  assert.equal(todayInTz("Asia/Hong_Kong"), "2025-6-15");
});

test("todayInTz returns the previous day's date in New York when UTC has rolled over", () => {
  // 2025-06-15T02:00:00Z → New York EDT 2025-06-14 22:00
  freezeNow("2025-06-15T02:00:00Z");
  assert.equal(todayInTz("America/New_York"), "2025-6-14");
});

test("todayInTz returns next-day in Hong Kong when UTC is late evening", () => {
  // 2025-06-15T23:00:00Z → HK 2025-06-16 07:00
  freezeNow("2025-06-15T23:00:00Z");
  assert.equal(todayInTz("Asia/Hong_Kong"), "2025-6-16");
});

test("userToday respects the user's timezone", () => {
  freezeNow("2025-06-15T23:00:00Z");
  assert.equal(userToday({ timezone: "Asia/Hong_Kong" }), "2025-6-16");
  assert.equal(userToday({ timezone: "America/New_York" }), "2025-6-15");
});

// ---------- todayPaddedInTz / userTodayPadded ----------

test("todayPaddedInTz returns zero-padded YYYY-MM-DD", () => {
  freezeNow("2025-01-05T03:30:00Z"); // HK 2025-01-05 11:30
  assert.equal(todayPaddedInTz("Asia/Hong_Kong"), "2025-01-05");
});

test("todayPaddedInTz pads single-digit month and day", () => {
  freezeNow("2025-09-09T03:30:00Z"); // HK 2025-09-09 11:30
  assert.equal(todayPaddedInTz("Asia/Hong_Kong"), "2025-09-09");
});

test("userTodayPadded uses the user's timezone with padding", () => {
  freezeNow("2025-01-05T03:30:00Z");
  assert.equal(userTodayPadded({ timezone: "Asia/Hong_Kong" }), "2025-01-05");
});

// ---------- yesterdayInTz / userYesterday ----------

test("yesterdayInTz returns the previous day in Asia/Hong_Kong", () => {
  freezeNow("2025-06-15T03:30:00Z"); // HK today is 2025-6-15
  assert.equal(yesterdayInTz("Asia/Hong_Kong"), "2025-6-14");
});

test("yesterdayInTz handles month boundary (Jul 1 → Jun 30)", () => {
  freezeNow("2025-07-01T03:30:00Z"); // HK today is 2025-7-1
  assert.equal(yesterdayInTz("Asia/Hong_Kong"), "2025-6-30");
});

test("yesterdayInTz handles March 1 → Feb 28 (non-leap year)", () => {
  freezeNow("2025-03-01T03:30:00Z"); // HK today is 2025-3-1
  assert.equal(yesterdayInTz("Asia/Hong_Kong"), "2025-2-28");
});

test("yesterdayInTz handles March 1 → Feb 29 in a leap year", () => {
  freezeNow("2024-03-01T03:30:00Z"); // HK today is 2024-3-1
  assert.equal(yesterdayInTz("Asia/Hong_Kong"), "2024-2-29");
});

test("yesterdayInTz handles year boundary (Jan 1 → Dec 31 prev year)", () => {
  // HK today is 2025-1-1 (UTC 2024-12-31 17:00 → HK 2025-1-1 01:00)
  freezeNow("2024-12-31T17:00:00Z");
  assert.equal(yesterdayInTz("Asia/Hong_Kong"), "2024-12-31");
});

test("userYesterday uses the user's timezone for Jan 1 boundary", () => {
  // HK 2025-1-1 01:00; New York 2024-12-31 12:00
  freezeNow("2024-12-31T17:00:00Z");
  assert.equal(
    userYesterday({ timezone: "Asia/Hong_Kong" }),
    "2024-12-31"
  );
  assert.equal(
    userYesterday({ timezone: "America/New_York" }),
    "2024-12-30"
  );
});

// ---------- DST transitions ----------

test("getNowInTz around US spring-forward DST: 06:30 UTC → 02:30 EDT (March 9, 2025)", () => {
  // March 9, 2025 06:30 UTC. At 07:00 UTC = 02:00 local clocks jump to 03:00 EDT.
  // Before the jump: 06:30 UTC = 01:30 EST.
  freezeNow("2025-03-09T06:30:00Z");
  const d = getNowInTz("America/New_York");
  assert.equal(d.getHours(), 1);
  assert.equal(d.getMinutes(), 30);
  assert.equal(d.getDate(), 9);
});

test("getNowInTz around US spring-forward DST: 07:30 UTC → 03:30 EDT (post-jump)", () => {
  // 07:30 UTC on March 9, 2025 = 03:30 local in EDT (post spring-forward)
  freezeNow("2025-03-09T07:30:00Z");
  const d = getNowInTz("America/New_York");
  assert.equal(d.getHours(), 3);
  assert.equal(d.getMinutes(), 30);
});

test("getNowInTz around US fall-back DST: 05:30 UTC → 01:30 EDT (Nov 2, 2025)", () => {
  // Before fall-back: Nov 2, 2025 05:30 UTC = 01:30 EDT (UTC-4)
  freezeNow("2025-11-02T05:30:00Z");
  const d = getNowInTz("America/New_York");
  assert.equal(d.getHours(), 1);
  assert.equal(d.getMinutes(), 30);
});

test("getNowInTz around US fall-back DST: 07:30 UTC → 02:30 EST (Nov 2, 2025, post fall-back)", () => {
  // After fall-back: Nov 2, 2025 07:30 UTC = 02:30 EST (UTC-5)
  freezeNow("2025-11-02T07:30:00Z");
  const d = getNowInTz("America/New_York");
  assert.equal(d.getHours(), 2);
  assert.equal(d.getMinutes(), 30);
});

test("DST: New York day flips correctly across spring-forward midnight", () => {
  // 04:30 UTC March 9, 2025 → 23:30 EST March 8 → still March 8 in NY
  freezeNow("2025-03-09T04:30:00Z");
  assert.equal(todayInTz("America/New_York"), "2025-3-8");
  assert.equal(yesterdayInTz("America/New_York"), "2025-3-7");
});

test("DST: London BST starts March 30, 2025 at 01:00 UTC", () => {
  // Just before BST starts: March 30, 2025 00:30 UTC = 00:30 GMT
  freezeNow("2025-03-30T00:30:00Z");
  let d = getNowInTz("Europe/London");
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 30);
  // Just after BST starts: March 30, 2025 01:30 UTC = 02:30 BST
  freezeNow("2025-03-30T01:30:00Z");
  d = getNowInTz("Europe/London");
  assert.equal(d.getHours(), 2);
  assert.equal(d.getMinutes(), 30);
});

// ---------- getUserTimeParts ----------

test("getUserTimeParts returns hour/minute/today/yesterday for a user (Asia/Hong_Kong)", () => {
  freezeNow("2025-06-15T03:30:00Z"); // HK 2025-06-15 11:30
  const parts = getUserTimeParts({ timezone: "Asia/Hong_Kong" });
  assert.deepEqual(parts, {
    hour: 11,
    minute: 30,
    todayStr: "2025-6-15",
    yesterdayStr: "2025-6-14",
  });
});

test("getUserTimeParts uses default timezone when user has none", () => {
  freezeNow("2025-06-15T03:30:00Z");
  const parts = getUserTimeParts({});
  assert.equal(parts.hour, 11);
  assert.equal(parts.todayStr, "2025-6-15");
  assert.equal(parts.yesterdayStr, "2025-6-14");
});

test("getUserTimeParts handles year boundary in user's timezone", () => {
  // 2024-12-31 17:00 UTC → HK 2025-1-1 01:00
  freezeNow("2024-12-31T17:00:00Z");
  const parts = getUserTimeParts({ timezone: "Asia/Hong_Kong" });
  assert.deepEqual(parts, {
    hour: 1,
    minute: 0,
    todayStr: "2025-1-1",
    yesterdayStr: "2024-12-31",
  });
});

test("getUserTimeParts handles month boundary in New York", () => {
  // 2025-03-01 04:00 UTC → NY EST 2025-02-28 23:00
  freezeNow("2025-03-01T04:00:00Z");
  const parts = getUserTimeParts({ timezone: "America/New_York" });
  assert.deepEqual(parts, {
    hour: 23,
    minute: 0,
    todayStr: "2025-2-28",
    yesterdayStr: "2025-2-27",
  });
});

test("getUserTimeParts during US spring-forward DST transition", () => {
  // 2025-03-09 07:30 UTC = 03:30 EDT (post spring-forward), still March 9
  freezeNow("2025-03-09T07:30:00Z");
  const parts = getUserTimeParts({ timezone: "America/New_York" });
  assert.deepEqual(parts, {
    hour: 3,
    minute: 30,
    todayStr: "2025-3-9",
    yesterdayStr: "2025-3-8",
  });
});

// ---------- getTimePartsInTz ----------
//
// `getTimePartsInTz(tz)` is the per-tz variant used by every per-user
// scheduler in lineBot.js. It must produce the same hour/minute/today/yesterday
// shape as `getUserTimeParts` but keyed by a raw timezone string.

test("getTimePartsInTz matches getUserTimeParts for the same tz (Asia/Hong_Kong)", () => {
  freezeNow("2025-06-15T03:30:00Z");
  const fromBot = getTimePartsInTz("Asia/Hong_Kong");
  const fromUser = getUserTimeParts({ timezone: "Asia/Hong_Kong" });
  assert.deepEqual(fromBot, fromUser);
});

test("getTimePartsInTz returns expected parts for Europe/London in winter", () => {
  // 2025-01-15 09:30 UTC → London GMT 09:30
  freezeNow("2025-01-15T09:30:00Z");
  const parts = getTimePartsInTz("Europe/London");
  assert.deepEqual(parts, {
    hour: 9,
    minute: 30,
    todayStr: "2025-1-15",
    yesterdayStr: "2025-1-14",
  });
});

test("getTimePartsInTz returns expected parts for Europe/London in BST (summer)", () => {
  // 2025-07-15 09:30 UTC → London BST 10:30
  freezeNow("2025-07-15T09:30:00Z");
  const parts = getTimePartsInTz("Europe/London");
  assert.deepEqual(parts, {
    hour: 10,
    minute: 30,
    todayStr: "2025-7-15",
    yesterdayStr: "2025-7-14",
  });
});

test("getTimePartsInTz handles year boundary in Asia/Hong_Kong", () => {
  // 2024-12-31 17:00 UTC → HK 2025-1-1 01:00
  freezeNow("2024-12-31T17:00:00Z");
  const parts = getTimePartsInTz("Asia/Hong_Kong");
  assert.deepEqual(parts, {
    hour: 1,
    minute: 0,
    todayStr: "2025-1-1",
    yesterdayStr: "2024-12-31",
  });
});

test("getTimePartsInTz handles month boundary on Mar 1 in non-leap year (NY)", () => {
  // 2025-03-01 04:00 UTC → NY EST 2025-02-28 23:00
  freezeNow("2025-03-01T04:00:00Z");
  const parts = getTimePartsInTz("America/New_York");
  assert.deepEqual(parts, {
    hour: 23,
    minute: 0,
    todayStr: "2025-2-28",
    yesterdayStr: "2025-2-27",
  });
});

test("getTimePartsInTz handles Mar 1 in a leap year (NY → Feb 29)", () => {
  // 2024-03-01 04:00 UTC → NY EST 2024-02-29 23:00
  freezeNow("2024-03-01T04:00:00Z");
  const parts = getTimePartsInTz("America/New_York");
  assert.deepEqual(parts, {
    hour: 23,
    minute: 0,
    todayStr: "2024-2-29",
    yesterdayStr: "2024-2-28",
  });
});

test("getTimePartsInTz during US spring-forward DST (post-jump)", () => {
  // 2025-03-09 07:30 UTC → 03:30 EDT
  freezeNow("2025-03-09T07:30:00Z");
  const parts = getTimePartsInTz("America/New_York");
  assert.deepEqual(parts, {
    hour: 3,
    minute: 30,
    todayStr: "2025-3-9",
    yesterdayStr: "2025-3-8",
  });
});

test("getTimePartsInTz during US fall-back DST (post-fallback 02:30 EST)", () => {
  // 2025-11-02 07:30 UTC → 02:30 EST
  freezeNow("2025-11-02T07:30:00Z");
  const parts = getTimePartsInTz("America/New_York");
  assert.deepEqual(parts, {
    hour: 2,
    minute: 30,
    todayStr: "2025-11-2",
    yesterdayStr: "2025-11-1",
  });
});

test("getTimePartsInTz falls back to default tz on invalid input", () => {
  // 2025-06-15 03:30 UTC → HK (fallback) 11:30
  freezeNow("2025-06-15T03:30:00Z");
  const parts = getTimePartsInTz("Not/A_Real_Zone");
  assert.deepEqual(parts, {
    hour: 11,
    minute: 30,
    todayStr: "2025-6-15",
    yesterdayStr: "2025-6-14",
  });
});

// ---------- getNextOccurrenceInTz ----------

test("getNextOccurrenceInTz: HK 06:00 local → next 7:00 same day", () => {
  // 2025-06-15 22:00 UTC → HK 2025-06-16 06:00
  freezeNow("2025-06-15T22:00:00Z");
  const next = getNextOccurrenceInTz("Asia/Hong_Kong", 7, 0);
  // Next 7:00 HKT = 2025-06-16 07:00 HKT = 2025-06-15 23:00 UTC
  assert.equal(next.toISOString(), "2025-06-15T23:00:00.000Z");
});

test("getNextOccurrenceInTz: HK 08:00 local → next 7:00 tomorrow", () => {
  // 2025-06-16 00:00 UTC → HK 2025-06-16 08:00
  freezeNow("2025-06-16T00:00:00Z");
  const next = getNextOccurrenceInTz("Asia/Hong_Kong", 7, 0);
  // Next 7:00 HKT = 2025-06-17 07:00 HKT = 2025-06-16 23:00 UTC
  assert.equal(next.toISOString(), "2025-06-16T23:00:00.000Z");
});

test("getNextOccurrenceInTz: exactly at 7:00 local → advances to next day", () => {
  // 2025-06-15 23:00 UTC → HK 2025-06-16 07:00 exactly
  freezeNow("2025-06-15T23:00:00Z");
  const next = getNextOccurrenceInTz("Asia/Hong_Kong", 7, 0);
  // Should be next day's 7:00, not "now"
  assert.equal(next.toISOString(), "2025-06-16T23:00:00.000Z");
});

test("getNextOccurrenceInTz: NY in EST winter (UTC-5)", () => {
  // 2025-01-15 13:00 UTC → NY 08:00 EST. Next 7:00 → tomorrow.
  freezeNow("2025-01-15T13:00:00Z");
  const next = getNextOccurrenceInTz("America/New_York", 7, 0);
  // 2025-01-16 07:00 EST = 2025-01-16 12:00 UTC
  assert.equal(next.toISOString(), "2025-01-16T12:00:00.000Z");
});

test("getNextOccurrenceInTz: NY in EDT summer (UTC-4)", () => {
  // 2025-07-15 13:00 UTC → NY 09:00 EDT. Next 7:00 → tomorrow.
  freezeNow("2025-07-15T13:00:00Z");
  const next = getNextOccurrenceInTz("America/New_York", 7, 0);
  // 2025-07-16 07:00 EDT = 2025-07-16 11:00 UTC
  assert.equal(next.toISOString(), "2025-07-16T11:00:00.000Z");
});

test("getNextOccurrenceInTz: London winter GMT", () => {
  // 2025-01-15 09:30 UTC → London 09:30 GMT. Next 7:00 → tomorrow.
  freezeNow("2025-01-15T09:30:00Z");
  const next = getNextOccurrenceInTz("Europe/London", 7, 0);
  // 2025-01-16 07:00 GMT = 2025-01-16 07:00 UTC
  assert.equal(next.toISOString(), "2025-01-16T07:00:00.000Z");
});

test("getNextOccurrenceInTz: London summer BST", () => {
  // 2025-07-15 03:00 UTC → London 04:00 BST. Next 7:00 → today.
  freezeNow("2025-07-15T03:00:00Z");
  const next = getNextOccurrenceInTz("Europe/London", 7, 0);
  // 2025-07-15 07:00 BST = 2025-07-15 06:00 UTC
  assert.equal(next.toISOString(), "2025-07-15T06:00:00.000Z");
});

test("getNextOccurrenceInTz: spans US spring-forward DST transition", () => {
  // March 8, 2025 18:00 UTC → NY 13:00 EST. Next 7:00 is March 9 morning,
  // which is AFTER the DST jump (clocks spring forward at 02:00→03:00 EDT).
  freezeNow("2025-03-08T18:00:00Z");
  const next = getNextOccurrenceInTz("America/New_York", 7, 0);
  // 2025-03-09 07:00 EDT (UTC-4) = 2025-03-09 11:00 UTC
  assert.equal(next.toISOString(), "2025-03-09T11:00:00.000Z");
});

test("getNextOccurrenceInTz: spans US fall-back DST transition", () => {
  // Nov 1, 2025 18:00 UTC → NY 14:00 EDT. Next 7:00 is Nov 2 morning,
  // which is AFTER the fall-back (clocks fall back at 02:00→01:00 EST).
  freezeNow("2025-11-01T18:00:00Z");
  const next = getNextOccurrenceInTz("America/New_York", 7, 0);
  // 2025-11-02 07:00 EST (UTC-5) = 2025-11-02 12:00 UTC
  assert.equal(next.toISOString(), "2025-11-02T12:00:00.000Z");
});

test("getNextOccurrenceInTz: falls back to default tz on invalid input", () => {
  // 2025-06-15 22:00 UTC → HK 2025-06-16 06:00
  freezeNow("2025-06-15T22:00:00Z");
  const next = getNextOccurrenceInTz("Not/A_Real_Zone", 7, 0);
  assert.equal(next.toISOString(), "2025-06-15T23:00:00.000Z");
});

test("getNextOccurrenceInTz: respects custom hour/minute (e.g., 21:30)", () => {
  // 2025-06-15 10:00 UTC → HK 18:00. Next 21:30 → today HK.
  freezeNow("2025-06-15T10:00:00Z");
  const next = getNextOccurrenceInTz("Asia/Hong_Kong", 21, 30);
  // 2025-06-15 21:30 HKT = 2025-06-15 13:30 UTC
  assert.equal(next.toISOString(), "2025-06-15T13:30:00.000Z");
});
