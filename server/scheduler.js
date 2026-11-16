import { db } from "./db.js";
import { tasks, taskRepeatExceptions, users } from "./schema.js";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { userTimezone, getTimePartsInTz } from "./timezone.js";
import {
  generateOccurrences,
  parseDateStr,
  formatDateStr,
  compareDateStrings,
} from "./recurrence.js";

const FALLBACK_HORIZON_DAYS = 365;
export const MIN_HORIZON_DAYS = 14;
export const MAX_HORIZON_DAYS = 730;

function readPositiveIntEnv(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

export const DEFAULT_REPEAT_HORIZON_DAYS = readPositiveIntEnv(
  "RECURRING_HORIZON_DAYS",
  FALLBACK_HORIZON_DAYS,
  { min: MIN_HORIZON_DAYS, max: MAX_HORIZON_DAYS },
);

export const MATERIALIZE_TARGET_HOUR = readPositiveIntEnv(
  "RECURRING_MATERIALIZE_HOUR",
  2,
  { min: 0, max: 23 },
);

export const MATERIALIZE_TARGET_MINUTE = readPositiveIntEnv(
  "RECURRING_MATERIALIZE_MINUTE",
  0,
  { min: 0, max: 59 },
);

const TEMPLATE_FIELDS = [
  "name",
  "color",
  "description",
  "eisenhowerQuadrant",
  "startTime",
  "endTime",
];

function buildTemplateData(source) {
  const out = {};
  for (const f of TEMPLATE_FIELDS) {
    if (source[f] !== undefined) out[f] = source[f];
  }
  return out;
}

function parseTemplate(jsonStr) {
  if (!jsonStr) return null;
  try { return JSON.parse(jsonStr); } catch { return null; }
}

export function clampHorizonDays(value) {
  if (!Number.isFinite(value)) return null;
  const n = Math.floor(value);
  if (n < MIN_HORIZON_DAYS) return MIN_HORIZON_DAYS;
  if (n > MAX_HORIZON_DAYS) return MAX_HORIZON_DAYS;
  return n;
}

function resolveSeriesHorizonDays(template, override) {
  if (override != null) {
    const clamped = clampHorizonDays(Number(override));
    if (clamped != null) return clamped;
  }
  if (template && template.horizonDays != null) {
    const clamped = clampHorizonDays(Number(template.horizonDays));
    if (clamped != null) return clamped;
  }
  return DEFAULT_REPEAT_HORIZON_DAYS;
}

const recurrenceDeps = {
  loadUserTimezone: async (uid) => {
    if (!uid) return "Asia/Hong_Kong";
    try {
      const [u] = await db
        .select({ timezone: users.timezone })
        .from(users)
        .where(eq(users.id, uid));
      return userTimezone(u);
    } catch {
      return "Asia/Hong_Kong";
    }
  },
  loadAllUsersWithTimezone: async () => {
    const rows = await db
      .select({ id: users.id, timezone: users.timezone })
      .from(users);
    return rows.map((r) => ({ id: r.id, timezone: userTimezone(r) }));
  },
  loadUidsWithRecurringTasks: async () => {
    const rows = await db
      .selectDistinct({ uid: tasks.uid })
      .from(tasks)
      .where(isNotNull(tasks.repeatSeriesId));
    return rows.map((r) => r.uid);
  },
  getTimeInTimezone: (tz) => getTimePartsInTz(tz),
};

export async function materializeSeriesForUser(uid, daysAhead = null) {
  const seriesRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.uid, uid), sql`${tasks.repeatSeriesId} IS NOT NULL`));
  if (seriesRows.length === 0) return 0;

  const exceptionRows = await db
    .select()
    .from(taskRepeatExceptions)
    .where(eq(taskRepeatExceptions.uid, uid));
  const exceptionsBySeries = new Map();
  for (const ex of exceptionRows) {
    if (!exceptionsBySeries.has(ex.seriesId)) exceptionsBySeries.set(ex.seriesId, new Set());
    exceptionsBySeries.get(ex.seriesId).add(ex.date);
  }

  const tz = await recurrenceDeps.loadUserTimezone(uid);
  const { todayStr } = recurrenceDeps.getTimeInTimezone(tz);
  const today = parseDateStr(todayStr);
  if (!today) return 0;

  const seriesMap = new Map();
  for (const t of seriesRows) {
    if (!t.repeatSeriesId || !t.repeatPattern || !t.repeatAnchorDate) continue;
    let entry = seriesMap.get(t.repeatSeriesId);
    if (!entry) {
      entry = { template: t, latest: t, instances: new Set() };
      seriesMap.set(t.repeatSeriesId, entry);
    } else {
      if ((parseDateStr(t.date) || new Date(0)) < (parseDateStr(entry.template.date) || new Date(0))) {
        entry.template = t;
      }
      if ((parseDateStr(t.date) || new Date(0)) > (parseDateStr(entry.latest.date) || new Date(0))) {
        entry.latest = t;
      }
    }
    if (t.date) entry.instances.add(t.date);
  }

  let createdCount = 0;
  for (const [seriesId, { template, latest, instances }] of seriesMap.entries()) {
    if (template.repeatEndedAt && compareDateStrings(template.repeatEndedAt, todayStr) < 0) {
      continue;
    }

    const tplJson = parseTemplate(latest.repeatTemplate) || parseTemplate(template.repeatTemplate);
    const tpl = tplJson || buildTemplateData(template);
    const seriesHorizonDays = resolveSeriesHorizonDays(tpl, daysAhead);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + seriesHorizonDays);
    const horizonStr = formatDateStr(horizon);

    const fromStr = compareDateStrings(template.repeatAnchorDate, todayStr) > 0
      ? template.repeatAnchorDate
      : todayStr;
    const exceptions = exceptionsBySeries.get(seriesId) || new Set();
    const occurrences = [];
    // generateOccurrences caps at maxCount per call; for high-frequency
    // patterns (daily) the cap must scale with the horizon, otherwise a
    // configured horizon > 365 silently truncates at 365 occurrences.
    const occurrenceCap = seriesHorizonDays + 60;
    for (const occ of generateOccurrences(
      template.repeatPattern,
      template.repeatInterval,
      template.repeatAnchorDate,
      fromStr,
      horizonStr,
      occurrenceCap,
    )) {
      if (template.repeatEndedAt && compareDateStrings(occ, template.repeatEndedAt) > 0) break;
      if (instances.has(occ) || exceptions.has(occ)) continue;
      occurrences.push(occ);
    }
    if (occurrences.length === 0) continue;

    const newRows = occurrences.map((dateStr) => ({
      uid,
      name: tpl.name ?? template.name,
      color: tpl.color ?? template.color,
      date: dateStr,
      done: false,
      order: 0,
      description: tpl.description ?? template.description ?? "",
      eisenhowerQuadrant: tpl.eisenhowerQuadrant ?? template.eisenhowerQuadrant ?? null,
      reminder: null,
      startTime: tpl.startTime ?? template.startTime ?? null,
      endDate: null,
      endTime: tpl.endTime ?? template.endTime ?? null,
      repeatPattern: template.repeatPattern,
      repeatInterval: template.repeatInterval || null,
      repeatSeriesId: template.repeatSeriesId,
      repeatAnchorDate: template.repeatAnchorDate,
      repeatEndedAt: template.repeatEndedAt || null,
      repeatTemplate: JSON.stringify(tpl),
    }));
    if (newRows.length > 0) {
      await db.insert(tasks).values(newRows).onConflictDoNothing();
      createdCount += newRows.length;
    }
  }
  return createdCount;
}

let recurrenceUserBuckets = null;
let recurrenceCacheLoadedAt = 0;
const RECURRENCE_CACHE_TTL_MS = 5 * 60 * 1000;
const recurrenceLastRunOn = new Map();
const recurrenceBucketStats = new Map();
const SCHEDULER_TICK_KEY = "__scheduler__";

function recordBucketRun(tz, userCount, createdCount) {
  const prev = recurrenceBucketStats.get(tz) || {};
  recurrenceBucketStats.set(tz, {
    lastRunAt: new Date().toISOString(),
    lastRunUserCount: userCount,
    lastRunCreatedCount: createdCount,
    errorCount: prev.errorCount || 0,
    lastErrorMessage: prev.lastErrorMessage || null,
    lastErrorAt: prev.lastErrorAt || null,
  });
}

function recordBucketError(tz, message) {
  const prev = recurrenceBucketStats.get(tz) || {};
  recurrenceBucketStats.set(tz, {
    lastRunAt: prev.lastRunAt || null,
    lastRunUserCount: prev.lastRunUserCount || 0,
    lastRunCreatedCount: prev.lastRunCreatedCount || 0,
    errorCount: (prev.errorCount || 0) + 1,
    lastErrorMessage: message ? String(message) : null,
    lastErrorAt: new Date().toISOString(),
  });
}

export function getRecurrenceSchedulerStats() {
  const knownTimezones = recurrenceUserBuckets
    ? [...recurrenceUserBuckets.entries()]
        .map(([tz, b]) => ({ timezone: tz, userCount: b.users.length }))
        .sort((a, b) => a.timezone.localeCompare(b.timezone))
    : [];

  const seen = new Set();
  const buckets = [];
  for (const tz of recurrenceUserBuckets ? recurrenceUserBuckets.keys() : []) {
    seen.add(tz);
    const stats = recurrenceBucketStats.get(tz) || {};
    buckets.push({
      timezone: tz,
      userCount: recurrenceUserBuckets.get(tz).users.length,
      lastRunAt: stats.lastRunAt || null,
      lastRunUserCount: stats.lastRunUserCount || 0,
      lastRunCreatedCount: stats.lastRunCreatedCount || 0,
      errorCount: stats.errorCount || 0,
      lastErrorMessage: stats.lastErrorMessage || null,
      lastErrorAt: stats.lastErrorAt || null,
    });
  }
  // Surface stats for buckets that ran historically but are no longer cached
  // (e.g. a timezone whose users were removed since the last tick).
  for (const [tz, stats] of recurrenceBucketStats.entries()) {
    if (tz === SCHEDULER_TICK_KEY) continue;
    if (seen.has(tz)) continue;
    buckets.push({
      timezone: tz,
      userCount: 0,
      lastRunAt: stats.lastRunAt || null,
      lastRunUserCount: stats.lastRunUserCount || 0,
      lastRunCreatedCount: stats.lastRunCreatedCount || 0,
      errorCount: stats.errorCount || 0,
      lastErrorMessage: stats.lastErrorMessage || null,
      lastErrorAt: stats.lastErrorAt || null,
    });
  }
  buckets.sort((a, b) => a.timezone.localeCompare(b.timezone));

  const tickStats = recurrenceBucketStats.get(SCHEDULER_TICK_KEY) || {};
  return {
    targetHour: MATERIALIZE_TARGET_HOUR,
    targetMinute: MATERIALIZE_TARGET_MINUTE,
    horizonDays: DEFAULT_REPEAT_HORIZON_DAYS,
    knownTimezones,
    cacheLoadedAt: recurrenceCacheLoadedAt
      ? new Date(recurrenceCacheLoadedAt).toISOString()
      : null,
    tickErrorCount: tickStats.errorCount || 0,
    lastTickErrorMessage: tickStats.lastErrorMessage || null,
    lastTickErrorAt: tickStats.lastErrorAt || null,
    buckets,
  };
}

async function loadRecurrenceUserBuckets() {
  const [allUsers, uidsWithRecurring] = await Promise.all([
    recurrenceDeps.loadAllUsersWithTimezone(),
    recurrenceDeps.loadUidsWithRecurringTasks(),
  ]);
  const uidSet = new Set(uidsWithRecurring);
  const buckets = new Map();
  for (const u of allUsers) {
    if (!uidSet.has(u.id)) continue;
    const tz = u.timezone || "Asia/Hong_Kong";
    if (!buckets.has(tz)) buckets.set(tz, { timezone: tz, users: [] });
    buckets.get(tz).users.push(u);
  }
  recurrenceUserBuckets = buckets;
  recurrenceCacheLoadedAt = Date.now();
  return buckets;
}

async function ensureRecurrenceUserBuckets() {
  if (
    !recurrenceUserBuckets ||
    Date.now() - recurrenceCacheLoadedAt > RECURRENCE_CACHE_TTL_MS
  ) {
    await loadRecurrenceUserBuckets();
  }
  return recurrenceUserBuckets;
}

export function invalidateRecurrenceUserCache() {
  recurrenceUserBuckets = null;
  recurrenceCacheLoadedAt = 0;
}

async function tickRecurrenceScheduler() {
  try {
    const buckets = await ensureRecurrenceUserBuckets();
    let totalUsers = 0;
    let totalCreated = 0;
    for (const bucket of buckets.values()) {
      const { timezone: tz, users: bucketUsers } = bucket;
      const { hour, minute, todayStr } = recurrenceDeps.getTimeInTimezone(tz);
      if (hour !== MATERIALIZE_TARGET_HOUR || minute !== MATERIALIZE_TARGET_MINUTE) continue;
      const dueUsers = bucketUsers.filter((u) => recurrenceLastRunOn.get(u.id) !== todayStr);
      if (dueUsers.length === 0) continue;
      let bucketCreated = 0;
      let bucketRan = 0;
      for (const u of dueUsers) {
        try {
          const created = await materializeSeriesForUser(u.id);
          bucketCreated += created;
          totalCreated += created;
          recurrenceLastRunOn.set(u.id, todayStr);
          totalUsers += 1;
          bucketRan += 1;
        } catch (e) {
          // Do not include uid in the surfaced (API-facing) error message;
          // the full uid is still logged to the server console for ops.
          recordBucketError(tz, `materialize failed: ${e.message}`);
          console.error(`Recurrence materialize error for uid ${u.id} (${tz}):`, e.message);
        }
      }
      // lastRunUserCount = users this bucket *attempted* this tick, regardless of
      // success. Per-user failures show up in errorCount / lastErrorMessage so
      // operators can spot underreporting without inferring it from the gap.
      recordBucketRun(tz, dueUsers.length, bucketCreated);
      console.log(
        `Recurrence materialize ran for ${bucketRan}/${dueUsers.length} users in ${tz} at ` +
          `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ` +
          `(created ${bucketCreated} new occurrences)`,
      );
    }
    if (totalUsers > 0) {
      console.log(
        `Recurrence materialize tick complete: ${totalUsers} users, ` +
          `${totalCreated} new occurrences total`,
      );
    }
  } catch (e) {
    recordBucketError(SCHEDULER_TICK_KEY, e.message);
    console.error("Recurrence scheduler tick error:", e.message);
  }
}

let recurrenceSchedulerInterval = null;

export function startRecurrenceScheduler() {
  if (recurrenceSchedulerInterval) return;
  const CHECK_INTERVAL = 60 * 1000;
  recurrenceSchedulerInterval = setInterval(() => {
    tickRecurrenceScheduler().catch((e) =>
      console.error("Recurrence tick error:", e.message),
    );
  }, CHECK_INTERVAL);
  console.log(
    `Recurrence materialization scheduler started ` +
      `(per-user timezone, ${String(MATERIALIZE_TARGET_HOUR).padStart(2, "0")}:` +
      `${String(MATERIALIZE_TARGET_MINUTE).padStart(2, "0")} local, ` +
      `horizon ${DEFAULT_REPEAT_HORIZON_DAYS} days)`,
  );
}

const __defaultRecurrenceDeps = { ...recurrenceDeps };

export const __recurrenceSchedulerTesting = {
  setDeps(overrides) {
    Object.assign(recurrenceDeps, overrides);
  },
  resetDeps() {
    Object.assign(recurrenceDeps, __defaultRecurrenceDeps);
  },
  resetState() {
    recurrenceUserBuckets = null;
    recurrenceCacheLoadedAt = 0;
    recurrenceLastRunOn.clear();
    recurrenceBucketStats.clear();
  },
  loadRecurrenceUserBuckets,
  tickRecurrenceScheduler,
  getBuckets: () => recurrenceUserBuckets,
  getLastRunOn: () => recurrenceLastRunOn,
  getBucketStats: () => recurrenceBucketStats,
  getStatsSnapshot: () => getRecurrenceSchedulerStats(),
  recordBucketError,
  recordBucketRun,
  resolveSeriesHorizonDays,
  clampHorizonDays,
  MATERIALIZE_TARGET_HOUR,
  MATERIALIZE_TARGET_MINUTE,
  DEFAULT_REPEAT_HORIZON_DAYS,
  MIN_HORIZON_DAYS,
  MAX_HORIZON_DAYS,
};
