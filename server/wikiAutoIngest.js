// Auto-fire wiki Ingest runs for non-LLM-initiated capture events:
// RSS daily digests (top-N items, fanned out one ingest per item),
// video transcripts, LINE food/expense/medicine logs, Last 30 Days briefs.
//
// Per-user concurrency = 1 (in-memory queue) so a burst of LINE messages
// or a flood of RSS captures doesn't stack agent runs in parallel for the
// same user. Per-source toggles live on `users` (wikiAutoIngest*).
//
// Run metadata convention (matches task #164 spec):
//   agent_runs.source  = 'auto' | 'manual'
//   agent_runs.trigger = concrete origin enum, one of:
//                          'rss-digest', 'video-transcript', 'last30days',
//                          'line-food', 'line-expense', 'line-medicine',
//                          'scheduler', 'manual'

import { db } from "./db.js";
import { users } from "./schema.js";
import { eq } from "drizzle-orm";
import { runWikiOp } from "./wikiOps.js";

// trigger enum -> users.<column> name
const TRIGGER_TO_PREF = {
  "rss-digest": "wikiAutoIngestRssDigest",
  "video-transcript": "wikiAutoIngestVideoTranscript",
  "line-food": "wikiAutoIngestLineLog",
  "line-expense": "wikiAutoIngestLineLog",
  "line-medicine": "wikiAutoIngestLineLog",
  "last30days": "wikiAutoIngestLast30days",
};

const MAX_INPUT_CHARS = 4000;
const MAX_QUEUE_PER_USER = 5; // bound to avoid runaway memory under attack
const queues = new Map(); // uid -> [{trigger, input, key}]
const running = new Set(); // uids currently draining
const activeKey = new Map(); // uid -> dedupeKey of job currently executing
const stats = {
  enqueued: 0,
  skippedNoPref: 0,
  skippedQueueFull: 0,
  skippedDuplicate: 0,
  succeeded: 0,
  failed: 0,
  byTrigger: {},
  attemptedUsersByTrigger: {}, // trigger -> Set<uid>
  lastRunAtByTrigger: {},      // trigger -> ISO timestamp
  lastError: null,
  lastErrorAt: null,
  lastFinishedAt: null,
};

function bumpTrigger(trigger, key) {
  const s = stats.byTrigger[trigger] || (stats.byTrigger[trigger] = { enqueued: 0, succeeded: 0, failed: 0, skippedDuplicate: 0 });
  s[key] = (s[key] || 0) + 1;
}

function rememberAttempted(uid, trigger) {
  const s = stats.attemptedUsersByTrigger[trigger] || (stats.attemptedUsersByTrigger[trigger] = new Set());
  s.add(uid);
}

// Normalize a payload for dedupe purposes: lowercase, collapse whitespace,
// trim. Two enqueues with the same uid+trigger+normalized input that are
// still pending in the queue should drop the second.
function dedupeKey(trigger, input) {
  const norm = String(input).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 800);
  return `${trigger}::${norm}`;
}

const defaultPrefLoader = async (uid) => {
  const [u] = await db.select({
    rss: users.wikiAutoIngestRssDigest,
    video: users.wikiAutoIngestVideoTranscript,
    line: users.wikiAutoIngestLineLog,
    last30: users.wikiAutoIngestLast30days,
    tz: users.timezone,
  }).from(users).where(eq(users.id, uid));
  return u || null;
};
let prefLoader = defaultPrefLoader;
let runImpl = runWikiOp;

export function __setAutoIngestDeps({ prefLoader: pl, runImpl: ri } = {}) {
  if (pl) prefLoader = pl;
  if (ri) runImpl = ri;
}
export function __resetAutoIngestDeps() {
  prefLoader = defaultPrefLoader;
  runImpl = runWikiOp;
}
export function __resetAutoIngestState() {
  queues.clear();
  running.clear();
  activeKey.clear();
  Object.assign(stats, {
    enqueued: 0, skippedNoPref: 0, skippedQueueFull: 0, skippedDuplicate: 0,
    succeeded: 0, failed: 0,
    byTrigger: {}, attemptedUsersByTrigger: {}, lastRunAtByTrigger: {},
    lastError: null, lastErrorAt: null, lastFinishedAt: null,
  });
}

export function getAutoIngestStats() {
  // Materialize per-trigger metrics in the spec'd shape:
  //   trigger, attemptedUsers, enqueued, succeeded, failed, lastRunAt
  const triggers = new Set([
    ...Object.keys(stats.byTrigger),
    ...Object.keys(stats.attemptedUsersByTrigger),
    ...Object.keys(stats.lastRunAtByTrigger),
  ]);
  const perTrigger = [...triggers].sort().map((t) => ({
    trigger: t,
    attemptedUsers: stats.attemptedUsersByTrigger[t]?.size || 0,
    enqueued: stats.byTrigger[t]?.enqueued || 0,
    succeeded: stats.byTrigger[t]?.succeeded || 0,
    failed: stats.byTrigger[t]?.failed || 0,
    skippedDuplicate: stats.byTrigger[t]?.skippedDuplicate || 0,
    lastRunAt: stats.lastRunAtByTrigger[t] || null,
  }));
  return {
    ...stats,
    perTrigger,
    queueDepthByUser: [...queues.entries()].map(([uid, q]) => ({ uid, depth: q.length })),
    runningUserCount: running.size,
  };
}

function prefField(trigger) { return TRIGGER_TO_PREF[trigger] || null; }

async function isEnabled(uid, trigger) {
  const field = prefField(trigger);
  if (!field) return false;
  let prefs;
  try { prefs = await prefLoader(uid); } catch { return false; }
  if (!prefs) return false;
  const map = {
    wikiAutoIngestRssDigest: prefs.rss,
    wikiAutoIngestVideoTranscript: prefs.video,
    wikiAutoIngestLineLog: prefs.line,
    wikiAutoIngestLast30days: prefs.last30,
  };
  return !!map[field];
}

async function userTz(uid) {
  try { const prefs = await prefLoader(uid); return prefs?.tz || null; } catch { return null; }
}

async function drain(uid) {
  if (running.has(uid)) return;
  running.add(uid);
  try {
    while (queues.get(uid)?.length) {
      const job = queues.get(uid).shift();
      activeKey.set(uid, job.key);
      try {
        const tz = await userTz(uid);
        const result = await runImpl({
          uid,
          op: "ingest",
          input: job.input,
          tz,
          source: "auto",
          trigger: job.trigger,
        });
        if (result?.ok === false) {
          stats.failed += 1;
          bumpTrigger(job.trigger, "failed");
          stats.lastError = String(result?.error || "ingest failed").slice(0, 500);
          stats.lastErrorAt = new Date().toISOString();
        } else {
          stats.succeeded += 1;
          bumpTrigger(job.trigger, "succeeded");
        }
      } catch (err) {
        stats.failed += 1;
        bumpTrigger(job.trigger, "failed");
        stats.lastError = String(err?.message || err).slice(0, 500);
        stats.lastErrorAt = new Date().toISOString();
        // Swallow: an auto-ingest failure must NEVER crash the caller's path.
        console.error(`[auto-ingest] uid=${uid} trigger=${job.trigger} failed:`, err?.message || err);
      } finally {
        const now = new Date().toISOString();
        stats.lastFinishedAt = now;
        stats.lastRunAtByTrigger[job.trigger] = now;
        activeKey.delete(uid);
      }
    }
  } finally {
    running.delete(uid);
    if (!queues.get(uid)?.length) queues.delete(uid);
  }
}

/**
 * Best-effort fire-and-forget enqueue. Never throws.
 *  - Checks the user's per-trigger toggle.
 *  - Per-user serialization (queue depth capped at MAX_QUEUE_PER_USER).
 */
export function enqueueAutoIngest({ uid, trigger, input }) {
  try {
    if (!uid || !trigger || !input) return { queued: false, reason: "missing_args" };
    if (!prefField(trigger)) return { queued: false, reason: "unknown_trigger" };
    const trimmed = String(input).slice(0, MAX_INPUT_CHARS);
    (async () => {
      const enabled = await isEnabled(uid, trigger);
      if (!enabled) {
        stats.skippedNoPref += 1;
        return;
      }
      let q = queues.get(uid);
      if (!q) { q = []; queues.set(uid, q); }
      // Dedupe: same uid + trigger + normalized payload already pending OR
      // currently executing for this user? drop the duplicate.
      const key = dedupeKey(trigger, trimmed);
      if (activeKey.get(uid) === key || q.some((j) => j.key === key)) {
        stats.skippedDuplicate += 1;
        bumpTrigger(trigger, "skippedDuplicate");
        return;
      }
      if (q.length >= MAX_QUEUE_PER_USER) {
        stats.skippedQueueFull += 1;
        return;
      }
      q.push({ trigger, input: trimmed, key });
      stats.enqueued += 1;
      bumpTrigger(trigger, "enqueued");
      rememberAttempted(uid, trigger);
      drain(uid).catch((e) => console.error("[auto-ingest] drain crashed:", e?.message || e));
    })().catch((e) => console.error("[auto-ingest] enqueue path crashed:", e?.message || e));
    return { queued: true };
  } catch (err) {
    console.error("[auto-ingest] enqueue threw (swallowed):", err?.message || err);
    return { queued: false, reason: "threw" };
  }
}

// Parse the top-N items out of a daily RSS digest memo body. Items are
// recognized as bulleted lines starting with "- " (the format produced by
// FeedView). Returns up to `n` strings, each combining the bullet line and
// any indented description below it. Empty array if nothing parseable.
export function extractRssDigestTopN(content, n = 3) {
  if (!content || typeof content !== "string") return [];
  const lines = content.split(/\r?\n/);
  const items = [];
  for (let i = 0; i < lines.length && items.length < n; i++) {
    const line = lines[i];
    const m = line.match(/^\s*-\s+(.+)$/);
    if (!m) continue;
    let chunk = m[1].trim();
    // Pull in the next line if it's an indented description.
    const next = lines[i + 1];
    if (next && /^\s{2,}\S/.test(next)) {
      chunk += "\n" + next.trim();
      i += 1;
    }
    items.push(chunk);
  }
  return items;
}

// Convenience helper for RSS digests: top-N fanout. N comes from
// RSS_AUTO_INGEST_TOPN env (default 3).
export function enqueueRssDigestAutoIngest({ uid, title, content }) {
  const n = Math.max(1, Math.min(10, parseInt(process.env.RSS_AUTO_INGEST_TOPN || "3", 10) || 3));
  const items = extractRssDigestTopN(content, n);
  if (items.length === 0) {
    // Fallback: ingest the whole digest as a single item so we never silently drop captures.
    return [enqueueAutoIngest({
      uid, trigger: "rss-digest",
      input: `RSS daily digest: ${title}\n\n${String(content || "").slice(0, MAX_INPUT_CHARS)}`,
    })];
  }
  return items.map((item, idx) => enqueueAutoIngest({
    uid, trigger: "rss-digest",
    input: `RSS digest highlight ${idx + 1}/${items.length} from "${title}":\n\n${item}`,
  }));
}

export const __autoIngestTesting = {
  setDeps: __setAutoIngestDeps,
  resetDeps: __resetAutoIngestDeps,
  resetState: __resetAutoIngestState,
  getQueues: () => queues,
  getRunning: () => running,
  getStats: () => stats,
  drain,
  extractRssDigestTopN,
};
