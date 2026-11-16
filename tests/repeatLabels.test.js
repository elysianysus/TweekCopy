import { test } from "node:test";
import assert from "node:assert/strict";

import {
    repeatLabel,
    formatRepeatTooltip,
    formatRepeatEndShort,
    horizonLabel,
    getHorizonDaysFromTemplate,
    isFinalRecurringOccurrence,
} from "../src/scripts/utils.js";

test("repeatLabel: pattern strings", () => {
    assert.equal(repeatLabel("daily"), "Daily");
    assert.equal(repeatLabel("weekdays"), "Weekdays");
    assert.equal(repeatLabel("weekly"), "Weekly");
    assert.equal(repeatLabel("monthly"), "Monthly");
    assert.equal(repeatLabel("every_n_days", 1), "Daily");
    assert.equal(repeatLabel("every_n_days", 3), "Every 3 days");
    assert.equal(repeatLabel(""), "");
    assert.equal(repeatLabel(null), "");
});

test("formatRepeatTooltip: appends 'until <date>' when repeatEndedAt is set", () => {
    const open = { repeatPattern: "weekly", repeatInterval: 1 };
    const bounded = { repeatPattern: "weekly", repeatInterval: 1, repeatEndedAt: "2026-06-05" };
    assert.equal(formatRepeatTooltip(open), "Repeats: Weekly");
    assert.equal(formatRepeatTooltip(bounded), "Repeats: Weekly (until 2026-06-05)");
    assert.equal(formatRepeatTooltip({}), "");
});

test("formatRepeatEndShort: returns empty string for missing input", () => {
    assert.equal(formatRepeatEndShort(""), "");
    assert.equal(formatRepeatEndShort(null), "");
    assert.equal(formatRepeatEndShort(undefined), "");
});

test("formatRepeatEndShort: same-year date renders without year", () => {
    const thisYear = new Date().getFullYear();
    const result = formatRepeatEndShort(`${thisYear}-06-05`);
    assert.equal(result, "5 Jun");
});

test("formatRepeatEndShort: different-year date includes the year", () => {
    const otherYear = new Date().getFullYear() + 5;
    const result = formatRepeatEndShort(`${otherYear}-12-31`);
    assert.equal(result, `31 Dec ${otherYear}`);
});

test("formatRepeatEndShort: invalid input falls back to the raw string", () => {
    assert.equal(formatRepeatEndShort("not-a-date"), "not-a-date");
});

test("horizonLabel: matches the editor presets", () => {
    assert.equal(horizonLabel(30), "1 month");
    assert.equal(horizonLabel(90), "3 months");
    assert.equal(horizonLabel(180), "6 months");
    assert.equal(horizonLabel(365), "1 year");
    assert.equal(horizonLabel(730), "2 years");
});

test("horizonLabel: arbitrary values fall back to '<n> days'", () => {
    assert.equal(horizonLabel(45), "45 days");
    assert.equal(horizonLabel(200), "200 days");
});

test("horizonLabel: invalid or non-positive input returns empty string", () => {
    assert.equal(horizonLabel(0), "");
    assert.equal(horizonLabel(-30), "");
    assert.equal(horizonLabel(null), "");
    assert.equal(horizonLabel(undefined), "");
    assert.equal(horizonLabel("abc"), "");
});

test("getHorizonDaysFromTemplate: extracts horizonDays from JSON string and object", () => {
    assert.equal(getHorizonDaysFromTemplate(JSON.stringify({ horizonDays: 180 })), 180);
    assert.equal(getHorizonDaysFromTemplate({ horizonDays: 90 }), 90);
});

test("isFinalRecurringOccurrence: false for non-recurring or open-ended series", () => {
    assert.equal(isFinalRecurringOccurrence(null), false);
    assert.equal(isFinalRecurringOccurrence({}), false);
    assert.equal(isFinalRecurringOccurrence({
        repeatSeriesId: "s", repeatPattern: "weekly", repeatInterval: 1,
        repeatAnchorDate: "2026-1-5", date: "2026-1-5",
    }), false);
});

test("isFinalRecurringOccurrence: true on the last weekly occurrence whose date matches repeatEndedAt", () => {
    const task = {
        repeatSeriesId: "s", repeatPattern: "weekly", repeatInterval: 1,
        repeatAnchorDate: "2026-1-5", repeatEndedAt: "2026-2-2",
        date: "2026-2-2",
    };
    assert.equal(isFinalRecurringOccurrence(task), true);
});

test("isFinalRecurringOccurrence: false on earlier occurrences in the same series", () => {
    const earlier = {
        repeatSeriesId: "s", repeatPattern: "weekly", repeatInterval: 1,
        repeatAnchorDate: "2026-1-5", repeatEndedAt: "2026-2-2",
        date: "2026-1-26",
    };
    assert.equal(isFinalRecurringOccurrence(earlier), false);
});

test("isFinalRecurringOccurrence: true when end date doesn't land on a recurrence", () => {
    const task = {
        repeatSeriesId: "s", repeatPattern: "weekly", repeatInterval: 1,
        repeatAnchorDate: "2026-1-5", repeatEndedAt: "2026-2-5",
        date: "2026-2-2",
    };
    assert.equal(isFinalRecurringOccurrence(task), true);
});

test("isFinalRecurringOccurrence: handles every_n_days, weekdays, monthly", () => {
    assert.equal(isFinalRecurringOccurrence({
        repeatSeriesId: "s", repeatPattern: "every_n_days", repeatInterval: 3,
        repeatAnchorDate: "2026-1-1", repeatEndedAt: "2026-1-10",
        date: "2026-1-10",
    }), true);
    assert.equal(isFinalRecurringOccurrence({
        repeatSeriesId: "s", repeatPattern: "weekdays",
        repeatAnchorDate: "2026-3-2", repeatEndedAt: "2026-3-6",
        date: "2026-3-6",
    }), true);
    assert.equal(isFinalRecurringOccurrence({
        repeatSeriesId: "s", repeatPattern: "weekdays",
        repeatAnchorDate: "2026-3-2", repeatEndedAt: "2026-3-6",
        date: "2026-3-5",
    }), false);
    assert.equal(isFinalRecurringOccurrence({
        repeatSeriesId: "s", repeatPattern: "monthly",
        repeatAnchorDate: "2026-1-15", repeatEndedAt: "2026-4-15",
        date: "2026-4-15",
    }), true);
    assert.equal(isFinalRecurringOccurrence({
        repeatSeriesId: "s", repeatPattern: "monthly",
        repeatAnchorDate: "2026-1-15", repeatEndedAt: "2026-4-15",
        date: "2026-3-15",
    }), false);
});

test("getHorizonDaysFromTemplate: missing/null/invalid horizonDays returns null", () => {
    assert.equal(getHorizonDaysFromTemplate(null), null);
    assert.equal(getHorizonDaysFromTemplate(""), null);
    assert.equal(getHorizonDaysFromTemplate("not-json"), null);
    assert.equal(getHorizonDaysFromTemplate(JSON.stringify({ name: "foo" })), null);
    assert.equal(getHorizonDaysFromTemplate(JSON.stringify({ horizonDays: null })), null);
    assert.equal(getHorizonDaysFromTemplate(JSON.stringify({ horizonDays: 0 })), null);
});
