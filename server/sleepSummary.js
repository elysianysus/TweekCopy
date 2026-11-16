export function formatSleepSummaryForPrompt(rows) {
  if (!rows || rows.length === 0) return "No sleep data.";
  const withSnore = rows.filter(r => r.snoreMin != null);
  const withInt = rows.filter(r => r.effectiveInterventionPct != null);
  const withSpo2 = rows.filter(r => r.spo2Min != null);
  const withTotal = rows.filter(r => r.totalSleepMin != null);
  const withDeep = rows.filter(r => r.deepSleepMin != null);
  const heavy = rows.filter(r => (r.snoreMin || 0) >= 60).map(r => r.date);
  const parts = [`${rows.length} nights tracked.`];
  if (withSnore.length) parts.push(`Avg snore: ${Math.round(withSnore.reduce((s,r)=>s+r.snoreMin,0)/withSnore.length)} min/night.`);
  if (withInt.length) parts.push(`Avg effective intervention rate: ${Math.round(withInt.reduce((s,r)=>s+r.effectiveInterventionPct,0)/withInt.length)}%.`);
  if (withTotal.length) parts.push(`Avg sleep: ${Math.round(withTotal.reduce((s,r)=>s+r.totalSleepMin,0)/withTotal.length)} min.`);
  if (withDeep.length) parts.push(`Avg deep sleep: ${Math.round(withDeep.reduce((s,r)=>s+r.deepSleepMin,0)/withDeep.length)} min.`);
  if (withSpo2.length) parts.push(`Avg SpO2 min: ${Math.round(withSpo2.reduce((s,r)=>s+r.spo2Min,0)/withSpo2.length)}%.`);
  if (heavy.length) parts.push(`Snore-heavy nights (>=60min): ${heavy.slice(0,7).join(', ')}.`);
  parts.push(`Per-night detail: ${rows.slice(0,14).map(r=>`${r.date}: snore=${r.snoreMin ?? '-'}m, eff=${r.effectiveInterventionPct ?? '-'}%, total=${r.totalSleepMin ?? '-'}m, spo2min=${r.spo2Min ?? '-'}`).join(' | ')}`);
  return parts.join(' ');
}

export function formatSleepSymptomSummaryForPrompt(rows) {
  if (!rows || rows.length === 0) return "No sleep symptom data.";
  const avg = (key) => {
    const xs = rows.filter(r => r[key] != null);
    return xs.length ? (xs.reduce((s,r)=>s+r[key],0)/xs.length).toFixed(1) : "n/a";
  };
  return `${rows.length} symptom diary entries. Avg morning headache: ${avg("morningHeadache")}/5; daytime fatigue: ${avg("daytimeFatigue")}/5; concentration: ${avg("concentration")}/5; night-wake severity: ${avg("nightWakeCount")}/5.`;
}
