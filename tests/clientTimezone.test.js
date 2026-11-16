import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  getNextOccurrenceInTz,
  isValidTimezone,
  tzOffsetMs,
} from "../src/scripts/timezone.js";

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

test("client getNextOccurrenceInTz: HK before 7:00 → today 7:00", () => {
  freezeNow("2025-06-15T22:00:00Z"); // HK 2025-06-16 06:00
  const next = getNextOccurrenceInTz("Asia/Hong_Kong", 7, 0);
  assert.equal(next.toISOString(), "2025-06-15T23:00:00.000Z");
});

test("client getNextOccurrenceInTz: HK after 7:00 → tomorrow 7:00", () => {
  freezeNow("2025-06-16T00:00:00Z"); // HK 2025-06-16 08:00
  const next = getNextOccurrenceInTz("Asia/Hong_Kong", 7, 0);
  assert.equal(next.toISOString(), "2025-06-16T23:00:00.000Z");
});

test("client getNextOccurrenceInTz: NY winter EST (UTC-5)", () => {
  freezeNow("2025-01-15T13:00:00Z"); // NY 08:00 EST
  const next = getNextOccurrenceInTz("America/New_York", 7, 0);
  assert.equal(next.toISOString(), "2025-01-16T12:00:00.000Z");
});

test("client getNextOccurrenceInTz: NY summer EDT (UTC-4)", () => {
  freezeNow("2025-07-15T13:00:00Z"); // NY 09:00 EDT
  const next = getNextOccurrenceInTz("America/New_York", 7, 0);
  assert.equal(next.toISOString(), "2025-07-16T11:00:00.000Z");
});

test("client getNextOccurrenceInTz: London BST", () => {
  freezeNow("2025-07-15T03:00:00Z"); // London 04:00 BST
  const next = getNextOccurrenceInTz("Europe/London", 7, 0);
  assert.equal(next.toISOString(), "2025-07-15T06:00:00.000Z");
});

test("client getNextOccurrenceInTz: spans US spring-forward DST", () => {
  freezeNow("2025-03-08T18:00:00Z"); // NY 13:00 EST, next 7:00 is post-DST
  const next = getNextOccurrenceInTz("America/New_York", 7, 0);
  assert.equal(next.toISOString(), "2025-03-09T11:00:00.000Z");
});

test("client getNextOccurrenceInTz: spans US fall-back DST", () => {
  freezeNow("2025-11-01T18:00:00Z"); // NY 14:00 EDT, next 7:00 is post-fallback EST
  const next = getNextOccurrenceInTz("America/New_York", 7, 0);
  assert.equal(next.toISOString(), "2025-11-02T12:00:00.000Z");
});

test("client getNextOccurrenceInTz: respects custom hour/minute", () => {
  freezeNow("2025-06-15T10:00:00Z"); // HK 18:00
  const next = getNextOccurrenceInTz("Asia/Hong_Kong", 21, 30);
  assert.equal(next.toISOString(), "2025-06-15T13:30:00.000Z");
});

test("client tzOffsetMs: HK UTC+8 returns +480 minutes", () => {
  freezeNow("2025-06-15T03:30:00Z");
  assert.equal(tzOffsetMs("Asia/Hong_Kong") / 60000, 480);
});

test("client tzOffsetMs: NY in EDT returns -240 minutes", () => {
  freezeNow("2025-07-15T13:00:00Z");
  assert.equal(tzOffsetMs("America/New_York") / 60000, -240);
});

test("client isValidTimezone: known IANA zone is valid", () => {
  assert.equal(isValidTimezone("Asia/Hong_Kong"), true);
  assert.equal(isValidTimezone("America/New_York"), true);
  assert.equal(isValidTimezone("Europe/London"), true);
});

test("client isValidTimezone: bogus / empty / non-string is invalid", () => {
  assert.equal(isValidTimezone("Not/A_Real_Zone"), false);
  assert.equal(isValidTimezone(""), false);
  assert.equal(isValidTimezone(null), false);
  assert.equal(isValidTimezone(undefined), false);
  assert.equal(isValidTimezone(42), false);
});
