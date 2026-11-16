import { test } from "node:test";
import assert from "node:assert/strict";

import { formatSleepSummaryForPrompt, formatSleepSymptomSummaryForPrompt } from "../server/sleepSummary.js";

test("formatSleepSummaryForPrompt returns 'No sleep data.' when empty", () => {
  assert.equal(formatSleepSummaryForPrompt([]), "No sleep data.");
  assert.equal(formatSleepSummaryForPrompt(null), "No sleep data.");
  assert.equal(formatSleepSummaryForPrompt(undefined), "No sleep data.");
});

test("formatSleepSummaryForPrompt includes nights count, avg snore, eff %, total, deep, SpO2", () => {
  const rows = [
    { date: "2026-05-01", snoreMin: 60, effectiveInterventionPct: 80, totalSleepMin: 420, deepSleepMin: 90, spo2Min: 92 },
    { date: "2026-05-02", snoreMin: 90, effectiveInterventionPct: 70, totalSleepMin: 400, deepSleepMin: 80, spo2Min: 88 },
  ];
  const out = formatSleepSummaryForPrompt(rows);
  assert.match(out, /2 nights tracked/);
  assert.match(out, /Avg snore: 75 min/);
  assert.match(out, /Avg effective intervention rate: 75%/);
  assert.match(out, /Avg sleep: 410 min/);
  assert.match(out, /Avg deep sleep: 85 min/);
  assert.match(out, /Avg SpO2 min: 90%/);
  assert.match(out, /Snore-heavy nights \(>=60min\): 2026-05-01, 2026-05-02/);
  assert.match(out, /Per-night detail:/);
  assert.match(out, /2026-05-01: snore=60m, eff=80%, total=420m, spo2min=92/);
});

test("formatSleepSummaryForPrompt handles partial fields without crashing", () => {
  const out = formatSleepSummaryForPrompt([{ date: "2026-05-01", snoreMin: 30 }]);
  assert.match(out, /1 nights tracked/);
  assert.match(out, /Avg snore: 30 min/);
  assert.doesNotMatch(out, /Avg effective intervention/);
  assert.doesNotMatch(out, /Snore-heavy nights/);
});

test("formatSleepSymptomSummaryForPrompt returns empty message when no rows", () => {
  assert.equal(formatSleepSymptomSummaryForPrompt([]), "No sleep symptom data.");
  assert.equal(formatSleepSymptomSummaryForPrompt(null), "No sleep symptom data.");
});

test("formatSleepSymptomSummaryForPrompt averages 1-5 severity fields including night-wake", () => {
  const rows = [
    { morningHeadache: 2, daytimeFatigue: 4, concentration: 3, nightWakeCount: 5 },
    { morningHeadache: 4, daytimeFatigue: 4, concentration: 1, nightWakeCount: 3 },
  ];
  const out = formatSleepSymptomSummaryForPrompt(rows);
  assert.match(out, /2 symptom diary entries/);
  assert.match(out, /morning headache: 3\.0\/5/);
  assert.match(out, /daytime fatigue: 4\.0\/5/);
  assert.match(out, /concentration: 2\.0\/5/);
  assert.match(out, /night-wake severity: 4\.0\/5/);
});
