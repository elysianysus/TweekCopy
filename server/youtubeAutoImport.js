import { db } from "./db.js";
import { rssFeeds, youtubeAutoImports, memos, memoTags } from "./schema.js";
import { eq, and } from "drizzle-orm";
import OpenAI from "openai";
import { loadVideo, summarizeTranscript, VideoNoteError } from "./videoNotes.js";

const YT_FEED_URL_RE = /^https?:\/\/(www\.)?youtube\.com\/feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/i;

export function isYoutubeChannelFeedUrl(url) {
  return typeof url === "string" && YT_FEED_URL_RE.test(url);
}

const POLL_INTERVAL_MS = parseInt(process.env.YT_AUTO_IMPORT_INTERVAL_MS || "", 10) > 0
  ? parseInt(process.env.YT_AUTO_IMPORT_INTERVAL_MS, 10)
  : 30 * 60 * 1000;

const FEED_CONCURRENCY = 3;
const VIDEO_CONCURRENCY_PER_TICK = 2;
const MAX_INITIAL_BACKFILL = 1;
const FEED_FETCH_TIMEOUT_MS = 8000;

function parseYoutubeAtomEntries(xml) {
  const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const out = [];
  for (const entry of entries.slice(0, 15)) {
    const idMatch = entry.match(/<yt:videoId>([\w-]{6,})<\/yt:videoId>/i);
    if (!idMatch) continue;
    const videoId = idMatch[1];
    const titleMatch = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pubMatch = entry.match(/<published>([\s\S]*?)<\/published>/i);
    out.push({
      videoId,
      title: titleMatch ? titleMatch[1].trim() : "",
      published: pubMatch ? pubMatch[1].trim() : "",
    });
  }
  return out;
}

async function fetchFeedXml(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Analogue-RSS/1.0 (auto-summarize)",
      "Accept": "application/atom+xml, application/xml, text/xml",
    },
    signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`feed HTTP ${r.status}`);
  return await r.text();
}

const stats = {
  lastTickAt: null,
  lastTickFeedCount: 0,
  lastTickProcessed: 0,
  lastTickErrors: 0,
  lastError: null,
  lastErrorAt: null,
  totalImported: 0,
  totalErrors: 0,
};

export function getYoutubeAutoImportStats() {
  return { ...stats, intervalMs: POLL_INTERVAL_MS };
}

async function processVideoForFeed(feed, entry, openai) {
  const { uid, id: feedId } = feed;
  const { videoId, title } = entry;

  let inserted;
  try {
    [inserted] = await db.insert(youtubeAutoImports).values({
      uid, feedId, videoId, status: "pending",
    }).onConflictDoNothing().returning();
  } catch (e) {
    return { skipped: true, reason: `db insert failed: ${e.message}` };
  }
  if (!inserted) return { skipped: true, reason: "already-tracked" };

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const loaded = await loadVideo(url, { openai });
    const body = await summarizeTranscript(openai, loaded);
    const memoTitle = loaded.meta.title || title || `YouTube ${videoId}`;
    const [memo] = await db.insert(memos).values({
      uid,
      title: memoTitle,
      content: body,
      color: "white",
      noteType: "video-note",
    }).returning();
    try {
      await db.insert(memoTags).values([
        { memoId: memo.id, tag: "video-note" },
        { memoId: memo.id, tag: "youtube" },
        { memoId: memo.id, tag: "auto-import" },
      ]);
    } catch {}
    await db.update(youtubeAutoImports)
      .set({ status: "done", memoId: memo.id, updatedAt: new Date() })
      .where(eq(youtubeAutoImports.id, inserted.id));
    try {
      const { enqueueAutoIngest } = await import("./wikiAutoIngest.js");
      enqueueAutoIngest({ uid, trigger: "video-transcript", input: `Video transcript: ${memoTitle}\n\n${body}` });
    } catch {}
    stats.totalImported += 1;
    return { ok: true, memoId: memo.id };
  } catch (err) {
    const code = err instanceof VideoNoteError ? err.code : "ERROR";
    const skip = err instanceof VideoNoteError && (code === "NO_CAPTIONS" || code === "TOO_LONG" || code === "PRIVATE" || code === "NOT_FOUND" || code === "BAD_URL");
    const status = skip ? "skipped" : "error";
    const msg = (err?.message || String(err)).slice(0, 500);
    await db.update(youtubeAutoImports)
      .set({ status, errorMessage: `${code}: ${msg}`, updatedAt: new Date() })
      .where(eq(youtubeAutoImports.id, inserted.id))
      .catch(() => {});
    if (!skip) stats.totalErrors += 1;
    return { error: true, code, message: msg };
  }
}

async function processFeed(feed, openai) {
  let xml;
  try {
    xml = await fetchFeedXml(feed.url);
  } catch (e) {
    return { feedId: feed.id, error: e.message, processed: 0 };
  }
  const entries = parseYoutubeAtomEntries(xml);
  if (!entries.length) return { feedId: feed.id, processed: 0 };

  const existingRows = await db.select({ videoId: youtubeAutoImports.videoId })
    .from(youtubeAutoImports)
    .where(and(eq(youtubeAutoImports.uid, feed.uid), eq(youtubeAutoImports.feedId, feed.id)));
  const known = new Set(existingRows.map(r => r.videoId));

  const candidates = entries.filter(e => !known.has(e.videoId));
  if (!candidates.length) return { feedId: feed.id, processed: 0 };

  const isFirstRun = known.size === 0;
  const toProcess = isFirstRun
    ? candidates.slice(0, MAX_INITIAL_BACKFILL)
    : candidates.slice(0, VIDEO_CONCURRENCY_PER_TICK);

  if (isFirstRun && candidates.length > MAX_INITIAL_BACKFILL) {
    const skipRows = candidates.slice(MAX_INITIAL_BACKFILL).map(e => ({
      uid: feed.uid, feedId: feed.id, videoId: e.videoId,
      status: "skipped", errorMessage: "initial-backfill-skip",
    }));
    if (skipRows.length) {
      try { await db.insert(youtubeAutoImports).values(skipRows).onConflictDoNothing(); } catch {}
    }
  }

  let processed = 0;
  let errors = 0;
  for (const entry of toProcess) {
    const r = await processVideoForFeed(feed, entry, openai);
    if (r.ok) processed += 1;
    if (r.error) errors += 1;
  }
  return { feedId: feed.id, processed, errors };
}

async function tickAutoImport({ uid = null } = {}) {
  const result = { feedCount: 0, processed: 0, errors: 0 };
  const isGlobal = !uid;
  if (isGlobal) {
    stats.lastTickAt = new Date().toISOString();
    stats.lastTickFeedCount = 0;
    stats.lastTickProcessed = 0;
    stats.lastTickErrors = 0;
  }
  let openai;
  try {
    openai = new OpenAI();
  } catch (e) {
    if (isGlobal) {
      stats.lastError = `openai init failed: ${e.message}`;
      stats.lastErrorAt = new Date().toISOString();
    }
    return result;
  }

  let feeds;
  try {
    const cond = uid
      ? and(eq(rssFeeds.autoSummarize, true), eq(rssFeeds.uid, uid))
      : eq(rssFeeds.autoSummarize, true);
    feeds = await db.select().from(rssFeeds).where(cond);
  } catch (e) {
    if (isGlobal) {
      stats.lastError = `feeds query failed: ${e.message}`;
      stats.lastErrorAt = new Date().toISOString();
    }
    return result;
  }
  feeds = feeds.filter(f => isYoutubeChannelFeedUrl(f.url));
  result.feedCount = feeds.length;
  if (isGlobal) stats.lastTickFeedCount = feeds.length;
  if (!feeds.length) return result;

  for (let i = 0; i < feeds.length; i += FEED_CONCURRENCY) {
    const batch = feeds.slice(i, i + FEED_CONCURRENCY);
    const results = await Promise.all(batch.map(f => processFeed(f, openai).catch(e => {
      if (isGlobal) {
        stats.lastError = `feed ${f.id}: ${e.message}`;
        stats.lastErrorAt = new Date().toISOString();
      }
      return { feedId: f.id, error: e.message, processed: 0, errors: 1 };
    })));
    for (const r of results) {
      result.processed += r.processed || 0;
      result.errors += r.errors || 0;
    }
  }

  if (isGlobal) {
    stats.lastTickProcessed = result.processed;
    stats.lastTickErrors = result.errors;
    if (result.processed > 0 || result.errors > 0) {
      console.log(
        `YT auto-import tick: ${result.feedCount} feeds, ` +
        `${result.processed} memos created, ${result.errors} errors`,
      );
    }
  }
  return result;
}

export async function runYoutubeAutoImportForUser(uid) {
  if (!uid) throw new Error("uid required");
  return await tickAutoImport({ uid });
}

export async function runYoutubeAutoImportNow() {
  await tickAutoImport();
  return getYoutubeAutoImportStats();
}

let interval = null;

export function startYoutubeAutoImportScheduler() {
  if (interval) return;
  interval = setInterval(() => {
    tickAutoImport().catch(e => {
      stats.lastError = e.message;
      stats.lastErrorAt = new Date().toISOString();
      console.error("YT auto-import tick error:", e.message);
    });
  }, POLL_INTERVAL_MS);
  console.log(`YouTube auto-import scheduler started (every ${Math.round(POLL_INTERVAL_MS / 60000)}m)`);
  setTimeout(() => {
    tickAutoImport().catch(e => console.error("YT auto-import initial tick:", e.message));
  }, 30 * 1000);
}

export const __testing = {
  parseYoutubeAtomEntries,
  isYoutubeChannelFeedUrl,
  processFeed,
  tickAutoImport,
  resetStats: () => {
    Object.assign(stats, {
      lastTickAt: null, lastTickFeedCount: 0, lastTickProcessed: 0,
      lastTickErrors: 0, lastError: null, lastErrorAt: null,
      totalImported: 0, totalErrors: 0,
    });
  },
};
