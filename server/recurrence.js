import { randomUUID } from "node:crypto";

export const REPEAT_PATTERNS = new Set([
  "daily",
  "weekly",
  "weekdays",
  "monthly",
  "every_n_days",
]);

export function isValidPattern(p) {
  return p == null || REPEAT_PATTERNS.has(p);
}

export function newSeriesId() {
  return randomUUID();
}

export function parseDateStr(s) {
  if (!s || typeof s !== "string") return null;
  const parts = s.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

export function formatDateStr(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function compareDateStrings(a, b) {
  const pa = parseDateStr(a);
  const pb = parseDateStr(b);
  if (!pa || !pb) return 0;
  if (pa < pb) return -1;
  if (pa > pb) return 1;
  return 0;
}

function clampDay(year, monthIdx, anchorDay) {
  const lastDay = new Date(year, monthIdx + 1, 0).getDate();
  return Math.min(anchorDay, lastDay);
}

export function nextOccurrence(pattern, interval, anchorDateStr, prevDateStr) {
  const anchor = parseDateStr(anchorDateStr);
  const prev = parseDateStr(prevDateStr);
  if (!anchor || !prev) return null;

  if (pattern === "daily") {
    const next = new Date(prev);
    next.setDate(next.getDate() + 1);
    return formatDateStr(next);
  }
  if (pattern === "weekly") {
    const next = new Date(prev);
    next.setDate(next.getDate() + 7);
    return formatDateStr(next);
  }
  if (pattern === "weekdays") {
    const next = new Date(prev);
    do {
      next.setDate(next.getDate() + 1);
    } while (next.getDay() === 0 || next.getDay() === 6);
    return formatDateStr(next);
  }
  if (pattern === "monthly") {
    const anchorDay = anchor.getDate();
    const candidate = new Date(prev.getFullYear(), prev.getMonth() + 1, 1);
    candidate.setDate(clampDay(candidate.getFullYear(), candidate.getMonth(), anchorDay));
    return formatDateStr(candidate);
  }
  if (pattern === "every_n_days") {
    const n = Math.max(1, parseInt(interval, 10) || 1);
    const next = new Date(prev);
    next.setDate(next.getDate() + n);
    return formatDateStr(next);
  }
  return null;
}

export function isOccurrenceOnDate(pattern, interval, anchorDateStr, dateStr) {
  const anchor = parseDateStr(anchorDateStr);
  const target = parseDateStr(dateStr);
  if (!anchor || !target) return false;
  if (target < anchor) return false;

  const a0 = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const t0 = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((t0 - a0) / dayMs);

  if (pattern === "daily") return diffDays >= 0;
  if (pattern === "weekly") return diffDays >= 0 && diffDays % 7 === 0;
  if (pattern === "weekdays") {
    const dow = target.getDay();
    return diffDays >= 0 && dow !== 0 && dow !== 6;
  }
  if (pattern === "monthly") {
    if (diffDays < 0) return false;
    const anchorDay = anchor.getDate();
    const lastDayOfTargetMonth = new Date(
      target.getFullYear(),
      target.getMonth() + 1,
      0,
    ).getDate();
    const expectedDay = Math.min(anchorDay, lastDayOfTargetMonth);
    return target.getDate() === expectedDay;
  }
  if (pattern === "every_n_days") {
    const n = Math.max(1, parseInt(interval, 10) || 1);
    return diffDays >= 0 && diffDays % n === 0;
  }
  return false;
}

export function* generateOccurrences(
  pattern,
  interval,
  anchorDateStr,
  fromDateStr,
  untilDateStr,
  maxCount = 365,
) {
  const anchor = parseDateStr(anchorDateStr);
  const from = parseDateStr(fromDateStr);
  const until = parseDateStr(untilDateStr);
  if (!anchor || !from || !until) return;
  if (until < anchor) return;

  let curStr = formatDateStr(anchor);
  let cur = anchor;
  let advanceGuard = 0;

  while (cur < from) {
    const nxt = nextOccurrence(pattern, interval, anchorDateStr, curStr);
    if (!nxt) return;
    curStr = nxt;
    cur = parseDateStr(curStr);
    advanceGuard++;
    if (advanceGuard > maxCount * 4) return;
  }

  let count = 0;
  while (cur <= until) {
    yield curStr;
    count++;
    if (count >= maxCount) return;
    const nxt = nextOccurrence(pattern, interval, anchorDateStr, curStr);
    if (!nxt) return;
    curStr = nxt;
    cur = parseDateStr(curStr);
  }
}

export function recurrenceLabel(pattern, interval) {
  if (!pattern) return "";
  if (pattern === "daily") return "Daily";
  if (pattern === "weekly") return "Weekly";
  if (pattern === "weekdays") return "Weekdays";
  if (pattern === "monthly") return "Monthly";
  if (pattern === "every_n_days") {
    const n = Math.max(1, parseInt(interval, 10) || 1);
    return n === 1 ? "Daily" : `Every ${n} days`;
  }
  return "";
}
