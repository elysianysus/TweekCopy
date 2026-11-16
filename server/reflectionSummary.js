// Server-side helper for generating and caching a one-line AI "theme"
// summary per (weekStart, promptId) for the Weekly Reflection panel.
//
// Cache key: (uid, week_start, prompt_id, content_hash). Re-opening the
// panel for the same week/prompt with the same entries returns the
// cached summary, avoiding repeat LLM calls.

/* eslint-env node */
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "./db.js";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const MIN_BULLETS_FOR_SUMMARY = 3;
const MAX_PROMPT_CHARS = 4000;
const MODEL = "gpt-4o-mini";

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(e => ({
      ds: String(e?.ds || "").trim(),
      text: String(e?.text || "").trim(),
    }))
    .filter(e => e.ds && e.text)
    .sort((a, b) => a.ds.localeCompare(b.ds));
}

function countBullets(text) {
  const lines = String(text || "").split(/\r?\n/);
  let n = 0;
  for (const raw of lines) {
    if (/^\s*(?:[-*+]|\d+\.)\s+\S/.test(raw)) n += 1;
  }
  if (n === 0 && text.trim()) n = 1;
  return n;
}

export function totalBulletsAcross(entries) {
  return normalizeEntries(entries).reduce((sum, e) => sum + countBullets(e.text), 0);
}

export function computeContentHash(entries) {
  const norm = normalizeEntries(entries);
  const payload = norm.map(e => `${e.ds}\n${e.text}`).join("\n---\n");
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

function buildPrompt(promptLabel, entries) {
  const norm = normalizeEntries(entries);
  const parts = [];
  let used = 0;
  for (const e of norm) {
    const block = `[${e.ds}] ${e.text}`;
    if (used + block.length > MAX_PROMPT_CHARS) break;
    parts.push(block);
    used += block.length + 1;
  }
  return parts.join("\n");
}

function buildTasteBlock(feedbackRows) {
  if (!Array.isArray(feedbackRows) || feedbackRows.length === 0) return "";
  const liked = feedbackRows.filter(r => r.rating === "up").slice(0, 3);
  const disliked = feedbackRows.filter(r => r.rating === "down").slice(0, 3);
  const lines = [];
  if (liked.length) {
    lines.push("Summaries the user LIKED in the past (match this style):");
    for (const r of liked) lines.push(`- ${r.summary}`);
  }
  if (disliked.length) {
    lines.push("Summaries the user DISLIKED in the past (avoid this style):");
    for (const r of disliked) lines.push(`- ${r.summary}`);
  }
  return lines.join("\n");
}

async function callLLM(promptLabel, entries, feedbackRows) {
  const body = buildPrompt(promptLabel, entries);
  if (!body) return "";
  const system =
    "You read a user's weekly self-reflection journal entries and write " +
    "ONE short natural-language sentence (max 20 words) capturing the " +
    "overall mood and recurring theme of the week. Write in the same " +
    "language the entries use (Chinese or English). No preamble, no " +
    "quotes, no bullet points — just the single sentence.";
  const taste = buildTasteBlock(feedbackRows);
  const user =
    `Reflection prompt: "${promptLabel}"\n\n` +
    `This week's entries:\n${body}\n\n` +
    (taste ? `${taste}\n\n` : "") +
    `Write the one-sentence theme summary now.`;
  const resp = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: 80,
    temperature: 0.4,
  });
  const text = (resp.choices?.[0]?.message?.content || "").trim();
  // Strip surrounding quotes / trailing periods spam, collapse whitespace.
  return text.replace(/^["“”']+|["“”']+$/g, "").replace(/\s+/g, " ").trim();
}

async function ensureCacheTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS reflection_summary_cache (
      id SERIAL PRIMARY KEY,
      uid INTEGER NOT NULL,
      week_start TEXT NOT NULL,
      prompt_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS reflection_summary_cache_key_idx
      ON reflection_summary_cache (uid, week_start, prompt_id, content_hash)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS reflection_summary_feedback (
      id SERIAL PRIMARY KEY,
      uid INTEGER NOT NULL,
      week_start TEXT NOT NULL,
      prompt_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      rating TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS reflection_summary_feedback_key_idx
      ON reflection_summary_feedback (uid, week_start, prompt_id, content_hash)
  `);
}

let tableReady = null;
function ensureTableOnce() {
  if (!tableReady) tableReady = ensureCacheTable().catch(e => {
    tableReady = null;
    throw e;
  });
  return tableReady;
}

async function loadFeedbackForPrompt(uid, promptId) {
  const res = await db.execute(sql`
    SELECT rating, summary FROM reflection_summary_feedback
    WHERE uid = ${uid} AND prompt_id = ${promptId} AND summary <> ''
    ORDER BY created_at DESC
    LIMIT 10
  `);
  return res.rows || [];
}

export async function recordReflectionFeedback({
  uid, weekStart, promptId, entries, rating,
}) {
  if (!uid || !weekStart || !promptId) {
    throw new Error("uid, weekStart, promptId required");
  }
  if (rating !== "up" && rating !== "down") {
    throw new Error("rating must be 'up' or 'down'");
  }
  const norm = normalizeEntries(entries);
  const contentHash = computeContentHash(norm);
  await ensureTableOnce();

  // Capture the summary being rated (from cache) so future prompts can
  // learn the user's taste.
  const cached = await db.execute(sql`
    SELECT summary FROM reflection_summary_cache
    WHERE uid = ${uid} AND week_start = ${weekStart}
      AND prompt_id = ${promptId} AND content_hash = ${contentHash}
    LIMIT 1
  `);
  const summary = cached.rows?.[0]?.summary || "";

  await db.execute(sql`
    INSERT INTO reflection_summary_feedback (uid, week_start, prompt_id, content_hash, rating, summary)
    VALUES (${uid}, ${weekStart}, ${promptId}, ${contentHash}, ${rating}, ${summary})
    ON CONFLICT (uid, week_start, prompt_id, content_hash)
      DO UPDATE SET rating = EXCLUDED.rating, summary = EXCLUDED.summary, created_at = NOW()
  `);

  // A thumbs-down invalidates the cached summary so the next fetch regenerates.
  if (rating === "down") {
    await db.execute(sql`
      DELETE FROM reflection_summary_cache
      WHERE uid = ${uid} AND week_start = ${weekStart}
        AND prompt_id = ${promptId} AND content_hash = ${contentHash}
    `);
  }
  return { ok: true, rating };
}

export async function getOrGenerateReflectionSummary({
  uid, weekStart, promptId, promptLabel, entries, regenerate = false,
}) {
  if (!uid || !weekStart || !promptId) {
    throw new Error("uid, weekStart, promptId required");
  }
  const norm = normalizeEntries(entries);
  if (norm.length === 0) return { summary: "", cached: false, skipped: "empty" };
  const bullets = norm.reduce((s, e) => s + countBullets(e.text), 0);
  if (bullets < MIN_BULLETS_FOR_SUMMARY) {
    return { summary: "", cached: false, skipped: "sparse" };
  }
  const contentHash = computeContentHash(norm);

  await ensureTableOnce();

  if (regenerate) {
    await db.execute(sql`
      DELETE FROM reflection_summary_cache
      WHERE uid = ${uid} AND week_start = ${weekStart}
        AND prompt_id = ${promptId} AND content_hash = ${contentHash}
    `);
  } else {
    const cached = await db.execute(sql`
      SELECT summary FROM reflection_summary_cache
      WHERE uid = ${uid} AND week_start = ${weekStart}
        AND prompt_id = ${promptId} AND content_hash = ${contentHash}
      LIMIT 1
    `);
    const row = cached.rows?.[0];
    if (row?.summary) {
      return { summary: row.summary, cached: true };
    }
  }

  let feedbackRows = [];
  try {
    feedbackRows = await loadFeedbackForPrompt(uid, promptId);
  } catch (e) {
    // Taste steering is best-effort.
  }

  let summary = "";
  try {
    summary = await callLLM(promptLabel || promptId, norm, feedbackRows);
  } catch (e) {
    return { summary: "", cached: false, error: e.message };
  }
  if (!summary) return { summary: "", cached: false, skipped: "empty_response" };

  try {
    await db.execute(sql`
      INSERT INTO reflection_summary_cache (uid, week_start, prompt_id, content_hash, summary)
      VALUES (${uid}, ${weekStart}, ${promptId}, ${contentHash}, ${summary})
      ON CONFLICT (uid, week_start, prompt_id, content_hash)
        DO UPDATE SET summary = EXCLUDED.summary, created_at = NOW()
    `);
  } catch (e) {
    // Cache write failure is non-fatal — still return the summary.
    console.warn("[reflectionSummary] cache write failed:", e.message);
  }
  return { summary, cached: false };
}

export const __testHooks = {
  countBullets,
  normalizeEntries,
  buildPrompt,
};
