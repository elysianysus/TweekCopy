import { test, after } from "node:test";
import assert from "node:assert/strict";

import { formatNextWeatherPushReply } from "../server/lineBot.js";

after(async () => {
  try {
    const { pool } = await import("../server/db.js");
    await pool.end();
  } catch {
    /* ignore */
  }
});

test("disabled weather push returns the off copy", () => {
  const user = { timezone: "Asia/Hong_Kong", dailyWeatherEnabled: false };
  const reply = formatNextWeatherPushReply(user, new Date("2026-05-02T03:00:00Z"));
  assert.match(reply, /Daily weather push is turned off/);
});

test("HK user before 7am sees today's push time with HK timezone label", () => {
  // 2026-05-01 21:00 UTC == 05:00 HKT on 2026-05-02 (before 07:00).
  const user = { timezone: "Asia/Hong_Kong", dailyWeatherEnabled: true };
  const now = new Date("2026-05-01T21:00:00Z");
  const reply = formatNextWeatherPushReply(user, now);
  assert.match(reply, /Next weather push:/);
  assert.match(reply, /today/);
  assert.match(reply, /7:00/);
  // Different ICU builds emit either "HKT" or the offset form "GMT+8".
  assert.match(reply, /HKT|GMT\+8/);
});

test("HK user after 7am sees tomorrow's push time", () => {
  // 03:00 UTC == 11:00 HKT (after 07:00).
  const user = { timezone: "Asia/Hong_Kong", dailyWeatherEnabled: true };
  const now = new Date("2026-05-02T03:00:00Z");
  const reply = formatNextWeatherPushReply(user, now);
  assert.match(reply, /tomorrow/);
  assert.match(reply, /7:00/);
  assert.match(reply, /HKT|GMT\+8/);
});

test("non-HK timezone formats time and abbreviation in user's local zone", () => {
  // 03:00 UTC == 23:00 EDT on 2026-05-01 (before 07:00 next morning).
  const user = { timezone: "America/New_York", dailyWeatherEnabled: true };
  const now = new Date("2026-05-02T03:00:00Z");
  const reply = formatNextWeatherPushReply(user, now);
  assert.match(reply, /Next weather push:/);
  assert.match(reply, /7:00/);
  // Either named (EDT/EST) or offset (GMT-4/-5) form.
  assert.match(reply, /EDT|EST|GMT-4|GMT-5/);
});

test("missing timezone falls back to Asia/Hong_Kong", () => {
  const user = { dailyWeatherEnabled: true };
  const reply = formatNextWeatherPushReply(user, new Date("2026-05-01T21:00:00Z"));
  assert.match(reply, /HKT|GMT\+8/);
});

test("dailyWeatherEnabled defaulting (undefined) is treated as enabled", () => {
  const user = { timezone: "Asia/Hong_Kong" };
  const reply = formatNextWeatherPushReply(user, new Date("2026-05-01T21:00:00Z"));
  assert.match(reply, /Next weather push:/);
});
