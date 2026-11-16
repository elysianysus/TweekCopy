import { test } from "node:test";
import assert from "node:assert/strict";

import {
  nextOccurrence,
  generateOccurrences,
  isOccurrenceOnDate,
  isValidPattern,
  recurrenceLabel,
} from "../server/recurrence.js";

test("nextOccurrence: daily adds one day", () => {
  assert.equal(nextOccurrence("daily", null, "2026-1-1", "2026-1-1"), "2026-1-2");
  assert.equal(nextOccurrence("daily", null, "2026-1-1", "2026-1-31"), "2026-2-1");
});

test("nextOccurrence: weekly adds seven days", () => {
  assert.equal(nextOccurrence("weekly", null, "2026-3-2", "2026-3-2"), "2026-3-9");
  assert.equal(nextOccurrence("weekly", null, "2026-3-2", "2026-3-30"), "2026-4-6");
});

test("nextOccurrence: weekdays skips Sat/Sun", () => {
  assert.equal(nextOccurrence("weekdays", null, "2026-5-1", "2026-5-1"), "2026-5-4");
  assert.equal(nextOccurrence("weekdays", null, "2026-5-1", "2026-5-4"), "2026-5-5");
  assert.equal(nextOccurrence("weekdays", null, "2026-5-1", "2026-5-8"), "2026-5-11");
});

test("nextOccurrence: monthly clamps to last day in shorter months", () => {
  assert.equal(nextOccurrence("monthly", null, "2026-1-31", "2026-1-31"), "2026-2-28");
  assert.equal(nextOccurrence("monthly", null, "2026-1-31", "2026-2-28"), "2026-3-31");
  assert.equal(nextOccurrence("monthly", null, "2026-1-15", "2026-1-15"), "2026-2-15");
});

test("nextOccurrence: every_n_days uses interval", () => {
  assert.equal(nextOccurrence("every_n_days", 3, "2026-1-1", "2026-1-1"), "2026-1-4");
  assert.equal(nextOccurrence("every_n_days", 3, "2026-1-1", "2026-1-10"), "2026-1-13");
  assert.equal(nextOccurrence("every_n_days", 1, "2026-1-1", "2026-1-1"), "2026-1-2");
});

test("nextOccurrence: invalid pattern returns null", () => {
  assert.equal(nextOccurrence("yearly", null, "2026-1-1", "2026-1-1"), null);
  assert.equal(nextOccurrence("daily", null, "bad", "2026-1-1"), null);
});

test("generateOccurrences: daily within window", () => {
  const occs = [...generateOccurrences("daily", null, "2026-4-1", "2026-4-1", "2026-4-5")];
  assert.deepEqual(occs, ["2026-4-1", "2026-4-2", "2026-4-3", "2026-4-4", "2026-4-5"]);
});

test("generateOccurrences: skips dates before fromDate", () => {
  const occs = [...generateOccurrences("daily", null, "2026-4-1", "2026-4-3", "2026-4-5")];
  assert.deepEqual(occs, ["2026-4-3", "2026-4-4", "2026-4-5"]);
});

test("generateOccurrences: weekly skips off-days", () => {
  const occs = [...generateOccurrences("weekly", null, "2026-4-6", "2026-4-1", "2026-4-30")];
  assert.deepEqual(occs, ["2026-4-6", "2026-4-13", "2026-4-20", "2026-4-27"]);
});

test("generateOccurrences: weekdays only Mon-Fri", () => {
  const occs = [...generateOccurrences("weekdays", null, "2026-4-6", "2026-4-6", "2026-4-12")];
  assert.deepEqual(occs, ["2026-4-6", "2026-4-7", "2026-4-8", "2026-4-9", "2026-4-10"]);
});

test("generateOccurrences: returns empty when until before anchor", () => {
  const occs = [...generateOccurrences("daily", null, "2026-4-10", "2026-4-1", "2026-4-5")];
  assert.deepEqual(occs, []);
});

test("isOccurrenceOnDate: daily true for any later date", () => {
  assert.equal(isOccurrenceOnDate("daily", null, "2026-1-1", "2026-1-5"), true);
  assert.equal(isOccurrenceOnDate("daily", null, "2026-1-5", "2026-1-1"), false);
});

test("isOccurrenceOnDate: weekly only same weekday", () => {
  assert.equal(isOccurrenceOnDate("weekly", null, "2026-4-6", "2026-4-13"), true);
  assert.equal(isOccurrenceOnDate("weekly", null, "2026-4-6", "2026-4-14"), false);
});

test("isOccurrenceOnDate: weekdays excludes weekends", () => {
  assert.equal(isOccurrenceOnDate("weekdays", null, "2026-4-6", "2026-4-7"), true);
  assert.equal(isOccurrenceOnDate("weekdays", null, "2026-4-6", "2026-4-11"), false);
  assert.equal(isOccurrenceOnDate("weekdays", null, "2026-4-6", "2026-4-12"), false);
});

test("isOccurrenceOnDate: monthly clamps to last day", () => {
  assert.equal(isOccurrenceOnDate("monthly", null, "2026-1-31", "2026-2-28"), true);
  assert.equal(isOccurrenceOnDate("monthly", null, "2026-1-31", "2026-3-31"), true);
  assert.equal(isOccurrenceOnDate("monthly", null, "2026-1-15", "2026-2-15"), true);
  assert.equal(isOccurrenceOnDate("monthly", null, "2026-1-15", "2026-2-14"), false);
});

test("isOccurrenceOnDate: every_n_days respects interval", () => {
  assert.equal(isOccurrenceOnDate("every_n_days", 3, "2026-1-1", "2026-1-4"), true);
  assert.equal(isOccurrenceOnDate("every_n_days", 3, "2026-1-1", "2026-1-5"), false);
});

test("isValidPattern: accepts known patterns", () => {
  for (const p of ["daily", "weekly", "weekdays", "monthly", "every_n_days"]) {
    assert.equal(isValidPattern(p), true);
  }
  assert.equal(isValidPattern(null), true);
  assert.equal(isValidPattern("yearly"), false);
});

test("recurrenceLabel: produces friendly labels", () => {
  assert.equal(recurrenceLabel("daily"), "Daily");
  assert.equal(recurrenceLabel("weekly"), "Weekly");
  assert.equal(recurrenceLabel("weekdays"), "Weekdays");
  assert.equal(recurrenceLabel("monthly"), "Monthly");
  assert.equal(recurrenceLabel("every_n_days", 3), "Every 3 days");
  assert.equal(recurrenceLabel("every_n_days", 1), "Daily");
  assert.equal(recurrenceLabel(null), "");
});
