// In-process job runner for Last 30 Days research runs.
//
// - Concurrency capped: 1 run per user, 2 globally (configurable via env).
// - Worker spawns scripts/run-last30days.py via the system Python; the wrapper
//   prints exactly one JSON line on stdout describing the result.
// - On boot, mark any rows still in queued/running as failed (interrupted by
//   restart) so the UI never sees a stuck spinner.
// - Maintains in-memory health stats consumed by /api/health/last30days.

import { spawn, spawnSync } from "node:child_process";
import { promises as fsp, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { marked } from "marked";
import { db } from "./db.js";
import { last30daysRuns, last30daysSubscriptions } from "./schema.js";

marked.setOptions({ gfm: true, breaks: false });

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const WRAPPER_SCRIPT = path.join(REPO_ROOT, "scripts", "run-last30days.py");
const UPLOAD_ROOT = path.join(REPO_ROOT, "uploads", "last30days");

function resolvePython312() {
  // Prefer explicit override; fall back to PATH; fall back to Nix store scan.
  const explicit = (process.env.LAST30DAYS_PYTHON || "").trim();
  if (explicit) return explicit;
  for (const name of ["python3.13", "python3.12"]) {
    const r = spawnSync(name, ["--version"], { stdio: "ignore" });
    if (r.status === 0) return name;
  }
  try {
    const entries = readdirSync("/nix/store");
    const matches = entries
      .filter((d) => /^.+python3-3\.(12|13)/.test(d))
      .map((d) => `/nix/store/${d}/bin/python3.12`)
      .concat(entries
        .filter((d) => /^.+python3-3\.13/.test(d))
        .map((d) => `/nix/store/${d}/bin/python3.13`))
      .filter((p) => existsSync(p));
    if (matches.length) return matches.sort().pop();
  } catch {}
  // Last resort: plain python3 (will fail engine version check loudly).
  return "python3";
}
const PYTHON_BIN = resolvePython312();

const MAX_GLOBAL = Math.max(1, parseInt(process.env.LAST30DAYS_MAX_GLOBAL || "2", 10));
const MAX_PER_USER = Math.max(1, parseInt(process.env.LAST30DAYS_MAX_PER_USER || "1", 10));
const POLL_MS = 1500;

const inflight = new Set(); // run ids currently executing
const inflightByUser = new Map(); // uid -> count
// Per-run options that aren't persisted on the row (e.g. transient `dryRun`
// opt-in from the route handler). Cleared when the job finishes.
const runOptions = new Map(); // runId -> { dryRun?: boolean }
let pollTimer = null;
let started = false;
let draining = false; // mutex: prevents re-entrant drain() from over-claiming caps

const stats = {
  startedAt: null,
  attempted: 0,
  succeeded: 0,
  failed: 0,
  lastRunId: null,
  lastFinishedAt: null,
  lastErrorMessage: null,
  lastErrorAt: null,
  inflight: 0,
};

export function getLast30DaysSchedulerStats() {
  return {
    startedAt: stats.startedAt,
    attempted: stats.attempted,
    succeeded: stats.succeeded,
    failed: stats.failed,
    lastRunId: stats.lastRunId,
    lastFinishedAt: stats.lastFinishedAt,
    lastErrorMessage: stats.lastErrorMessage,
    lastErrorAt: stats.lastErrorAt,
    inflight: inflight.size,
    capacity: { global: MAX_GLOBAL, perUser: MAX_PER_USER },
  };
}

export async function recoverInterruptedRuns() {
  // Mark any leftover queued/running rows as failed. Safe to call repeatedly.
  const result = await db
    .update(last30daysRuns)
    .set({
      status: "failed",
      errorMessage: "interrupted by restart",
      finishedAt: new Date(),
    })
    .where(inArray(last30daysRuns.status, ["queued", "running"]))
    .returning({ id: last30daysRuns.id });
  if (result.length) {
    console.log(`[last30days] recovered ${result.length} interrupted run(s)`);
  }
  return result.length;
}

export function startLast30DaysWorker() {
  if (started) return;
  started = true;
  stats.startedAt = new Date().toISOString();
  // Don't block boot on draining; tick on a timer.
  pollTimer = setInterval(() => {
    drain().catch((err) => console.error("[last30days] drain error:", err.message));
  }, POLL_MS);
  if (typeof pollTimer.unref === "function") pollTimer.unref();
  console.log("[last30days] worker started");
}

// ---- Weekly auto-refresh of subscribed topics -----------------------------
// Every hour, look for enabled subscriptions that haven't been enqueued in
// the last 7 days and enqueue a fresh run. Skips a topic if the user already
// has a queued/running run for it (avoids pile-ups when the engine is slow).

const AUTO_REFRESH_POLL_MS = 60 * 60 * 1000; // hourly
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
let autoRefreshTimer = null;

export async function autoRefreshDueSubscriptions() {
  const cutoff = new Date(Date.now() - WEEK_MS);
  const subs = await db
    .select()
    .from(last30daysSubscriptions)
    .where(eq(last30daysSubscriptions.enabled, true));
  let enqueued = 0;
  for (const sub of subs) {
    const last = sub.lastEnqueuedAt ? new Date(sub.lastEnqueuedAt) : null;
    if (last && last > cutoff) continue;
    // Skip if this user already has an active run for this topic.
    const active = await db
      .select({ id: last30daysRuns.id })
      .from(last30daysRuns)
      .where(and(
        eq(last30daysRuns.uid, sub.uid),
        eq(last30daysRuns.topic, sub.topic),
        inArray(last30daysRuns.status, ["queued", "running"]),
      ))
      .limit(1);
    if (active.length) continue;
    // Atomically claim the subscription for this week: the conditional
    // UPDATE succeeds for exactly one concurrent ticker, so overlapping
    // scheduler ticks (or multiple instances) can't double-enqueue.
    const claimed = await db
      .update(last30daysSubscriptions)
      .set({ lastEnqueuedAt: new Date() })
      .where(and(
        eq(last30daysSubscriptions.id, sub.id),
        eq(last30daysSubscriptions.enabled, true),
        sub.lastEnqueuedAt
          ? eq(last30daysSubscriptions.lastEnqueuedAt, sub.lastEnqueuedAt)
          : isNull(last30daysSubscriptions.lastEnqueuedAt),
      ))
      .returning({ id: last30daysSubscriptions.id });
    if (!claimed.length) continue;
    const [row] = await db
      .insert(last30daysRuns)
      .values({
        uid: sub.uid,
        topic: sub.topic,
        sourcesJson: sub.sourcesJson || "[]",
        status: "queued",
      })
      .returning();
    enqueueRun(row.id);
    enqueued += 1;
    console.log(`[last30days] auto-refresh enqueued run ${row.id} for topic "${sub.topic}" (sub ${sub.id})`);
  }
  return enqueued;
}

export function startLast30DaysAutoRefresh() {
  if (autoRefreshTimer) return;
  const tick = () => {
    autoRefreshDueSubscriptions().catch((err) =>
      console.error("[last30days] auto-refresh error:", err.message));
  };
  autoRefreshTimer = setInterval(tick, AUTO_REFRESH_POLL_MS);
  if (typeof autoRefreshTimer.unref === "function") autoRefreshTimer.unref();
  // First check a minute after boot so restarts don't hammer the engine.
  const boot = setTimeout(tick, 60 * 1000);
  if (typeof boot.unref === "function") boot.unref();
  console.log("[last30days] weekly auto-refresh scheduler started");
}

export function stopLast30DaysWorker() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  started = false;
}

export function enqueueRun(runId, opts = {}) {
  // The run row is already inserted as "queued" by the route handler.
  // Nudge the drain loop so we pick it up immediately instead of waiting
  // for the next poll tick. Transient per-run options (e.g. `dryRun`) are
  // stashed in-memory; if the process restarts before the job runs, the
  // recovery path will mark the row as failed and the option is moot.
  if (opts && typeof opts === "object") {
    const cleaned = {};
    if (opts.dryRun) cleaned.dryRun = true;
    if (Object.keys(cleaned).length) runOptions.set(runId, cleaned);
  }
  setImmediate(() => {
    drain().catch((err) => console.error("[last30days] enqueue drain error:", err.message));
  });
  return runId;
}

async function drain() {
  // Mutex: only one drain may run at a time. Without this, the timer tick and
  // an enqueueRun()-triggered drain can interleave between the cap check and
  // the DB claim, briefly over-claiming the per-user / global caps.
  if (draining) return;
  draining = true;
  try {
    if (inflight.size >= MAX_GLOBAL) return;
    // Pick the oldest queued runs. We over-fetch so we can skip users at cap.
    const candidates = await db
      .select()
      .from(last30daysRuns)
      .where(eq(last30daysRuns.status, "queued"))
      .orderBy(last30daysRuns.id)
      .limit(MAX_GLOBAL * 4);

    for (const row of candidates) {
      if (inflight.size >= MAX_GLOBAL) break;
      if (inflight.has(row.id)) continue;
      const userCount = inflightByUser.get(row.uid) || 0;
      if (userCount >= MAX_PER_USER) continue;
      // Atomically claim the row by transitioning queued -> running.
      const claimed = await db
        .update(last30daysRuns)
        .set({ status: "running", startedAt: new Date() })
        .where(and(eq(last30daysRuns.id, row.id), eq(last30daysRuns.status, "queued")))
        .returning();
      if (!claimed.length) continue;
      inflight.add(row.id);
      inflightByUser.set(row.uid, userCount + 1);
      stats.attempted += 1;
      runJob(claimed[0]).finally(() => {
        inflight.delete(row.id);
        const c = inflightByUser.get(row.uid) || 0;
        if (c <= 1) inflightByUser.delete(row.uid);
        else inflightByUser.set(row.uid, c - 1);
        stats.inflight = inflight.size;
      });
    }
  } finally {
    draining = false;
  }
}

async function runJob(row) {
  const userDir = path.join(UPLOAD_ROOT, String(row.uid));
  await fsp.mkdir(userDir, { recursive: true }).catch(() => {});

  const sources = safeParseSources(row.sourcesJson);
  const opts = runOptions.get(row.id) || {};
  runOptions.delete(row.id);
  const params = {
    topic: row.topic,
    sources,
    outDir: userDir,
    runId: String(row.id),
  };
  if (opts.dryRun) params.dryRun = true;

  let result;
  try {
    result = await spawnWrapper(params);
  } catch (err) {
    result = { status: "failed", error: err.message || String(err), stderrTail: "" };
  }

  // Wrapper emits {mdPath} for real engine + dry-run paths; we render md -> html
  // here in Node so Python only needs the engine's own deps.
  let mdForIngest = null;
  if (result.status === "ok" && result.mdPath && !result.htmlPath) {
    try {
      const md = await fsp.readFile(result.mdPath, "utf-8");
      mdForIngest = md;
      const body = marked.parse(md);
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(row.topic).slice(0, 200)}</title></head><body><article class="last30days-brief">${body}</article></body></html>`;
      const htmlPath = path.join(userDir, `${row.id}.html`);
      await fsp.writeFile(htmlPath, html, "utf-8");
      result.htmlPath = htmlPath;
      // Drop the intermediate md so we don't keep two copies on disk.
      await fsp.unlink(result.mdPath).catch(() => {});
    } catch (err) {
      result = {
        status: "failed",
        error: `markdown render failed: ${err.message}`,
        stderrTail: result.stderrTail || "",
        engineVersion: result.engineVersion,
      };
    }
  }

  const finishedAt = new Date();
  if (result.status === "ok") {
    const relPath = path.relative(REPO_ROOT, result.htmlPath || "");
    await db
      .update(last30daysRuns)
      .set({
        status: "succeeded",
        htmlPath: relPath,
        stderrTail: result.stderrTail || "",
        engineVersion: result.engineVersion || null,
        finishedAt,
        errorMessage: null,
        missingKey: null,
      })
      .where(eq(last30daysRuns.id, row.id));
    stats.succeeded += 1;
    // Auto-fire wiki Ingest once the brief is fully written (per #164:
    // "ingest when brief finishes", not at save-as-memo). Best-effort,
    // never throws, gated on the user's wikiAutoIngestLast30days toggle.
    try {
      const { enqueueAutoIngest } = await import("./wikiAutoIngest.js");
      enqueueAutoIngest({
        uid: row.uid,
        trigger: "last30days",
        input: `Last 30 Days brief: "${row.topic}"\n\n${(mdForIngest || "").slice(0, 4000)}`,
      });
    } catch {}
  } else {
    await db
      .update(last30daysRuns)
      .set({
        status: "failed",
        errorMessage: result.error || "engine failed",
        missingKey: result.missingKey || null,
        stderrTail: result.stderrTail || "",
        engineVersion: result.engineVersion || null,
        finishedAt,
      })
      .where(eq(last30daysRuns.id, row.id));
    stats.failed += 1;
    stats.lastErrorMessage = sanitizeError(result.error || "engine failed");
    stats.lastErrorAt = finishedAt.toISOString();
  }
  stats.lastRunId = row.id;
  stats.lastFinishedAt = finishedAt.toISOString();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeParseSources(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === "string");
  } catch {}
  return [];
}

function sanitizeError(msg) {
  // Strip absolute paths under the repo so we don't leak the runner layout
  // through the admin health endpoint.
  return String(msg).replaceAll(REPO_ROOT, "<repo>").slice(0, 500);
}

function spawnWrapper(params) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let killed = false;
    const child = spawn(PYTHON_BIN, [WRAPPER_SCRIPT], {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    const timeoutMs = 22 * 60 * 1000;
    const timer = setTimeout(() => {
      killed = true;
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ status: "failed", error: `spawn failed: ${err.message}`, stderrTail: stderr.slice(-4000) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) {
        return resolve({ status: "failed", error: "wrapper killed (timeout)", stderrTail: stderr.slice(-4000) });
      }
      const lastLine = stdout.split("\n").reverse().find((l) => l.trim().startsWith("{"));
      if (!lastLine) {
        return resolve({
          status: "failed",
          error: code === 0 ? "wrapper produced no JSON output" : `wrapper exited ${code}`,
          stderrTail: stderr.slice(-4000),
        });
      }
      try {
        resolve(JSON.parse(lastLine));
      } catch (e) {
        resolve({
          status: "failed",
          error: `wrapper JSON parse failed: ${e.message}`,
          stderrTail: stderr.slice(-4000),
        });
      }
    });

    try {
      child.stdin.end(JSON.stringify(params));
    } catch (err) {
      try { child.kill("SIGKILL"); } catch {}
      resolve({ status: "failed", error: `stdin write failed: ${err.message}`, stderrTail: "" });
    }
  });
}

// Helpers exposed for tests.
export const __test__ = {
  inflight,
  inflightByUser,
  runOptions,
  stats,
  WRAPPER_SCRIPT,
  UPLOAD_ROOT,
  REPO_ROOT,
  drain,
};
