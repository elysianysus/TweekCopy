// Lightweight, idempotent startup migrations.
//
// We don't have a full drizzle migration pipeline wired up at boot, so for
// small additive changes (column defaults, backfills, NOT NULL tightening)
// we run them here once on server start. Every statement is written so it
// can run repeatedly without harm.

import { sql } from "drizzle-orm";
import { db } from "./db.js";

export async function runStartupMigrations() {
  try {
    // #164: agent_runs.source is the auto/manual flag. Older rows predate the
    // column and persisted as NULL; backfill them so the manual/auto filter
    // and the /api/health/wiki-agent grouping report consistent counts.
    await db.execute(sql`UPDATE agent_runs SET source = 'manual' WHERE source IS NULL`);
    await db.execute(sql`ALTER TABLE agent_runs ALTER COLUMN source SET DEFAULT 'manual'`);
    // SET NOT NULL is safe now that all rows are populated.
    try {
      await db.execute(sql`ALTER TABLE agent_runs ALTER COLUMN source SET NOT NULL`);
    } catch (e) {
      // Already NOT NULL on a previous boot — ignore.
      if (!/already|cannot/.test(e.message)) throw e;
    }
    console.log("[migrations] agent_runs.source backfill OK");
  } catch (e) {
    console.error("[migrations] agent_runs.source backfill failed:", e.message);
  }

  // muse_conversations.source: provenance tag for imported chats
  // ('chatgpt' | 'claude'); NULL means a native Muse chat.
  try {
    await db.execute(sql`ALTER TABLE muse_conversations ADD COLUMN IF NOT EXISTS source text`);
    console.log("[migrations] muse_conversations.source column OK");
  } catch (e) {
    console.error("[migrations] muse_conversations.source migration failed:", e.message);
  }

  // Last 30 Days weekly auto-refresh subscriptions.
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS last30days_subscriptions (
      id serial PRIMARY KEY,
      uid integer NOT NULL,
      topic text NOT NULL,
      sources_json text DEFAULT '[]',
      enabled boolean NOT NULL DEFAULT true,
      last_enqueued_at timestamp DEFAULT NULL,
      created_at timestamp DEFAULT now()
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS last30days_subs_uid_idx ON last30days_subscriptions (uid)`);
    // Dedupe any (uid, topic) duplicates before enforcing uniqueness.
    await db.execute(sql`DELETE FROM last30days_subscriptions a
      USING last30days_subscriptions b
      WHERE a.uid = b.uid AND a.topic = b.topic AND a.id < b.id`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS last30days_subs_uid_topic_idx ON last30days_subscriptions (uid, topic)`);
    console.log("[migrations] last30days_subscriptions OK");
  } catch (e) {
    console.error("[migrations] last30days_subscriptions failed:", e.message);
  }

  // Podcast Notebook (Phase 1): shows + episodes.
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS podcast_shows (
      id serial PRIMARY KEY,
      uid integer NOT NULL,
      title text DEFAULT '',
      channel_id text DEFAULT '',
      feed_url text NOT NULL,
      channel_url text DEFAULT '',
      thumbnail text DEFAULT '',
      created_at timestamp DEFAULT now()
    )`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS podcast_shows_uid_feed_idx ON podcast_shows (uid, feed_url)`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS podcast_episodes (
      id serial PRIMARY KEY,
      uid integer NOT NULL,
      show_id integer NOT NULL,
      video_id text NOT NULL,
      title text DEFAULT '',
      url text DEFAULT '',
      thumbnail text DEFAULT '',
      published_at timestamp DEFAULT NULL,
      listened boolean DEFAULT false,
      notes text DEFAULT '',
      summary text DEFAULT NULL,
      created_at timestamp DEFAULT now()
    )`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS podcast_episodes_uid_video_idx ON podcast_episodes (uid, show_id, video_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS podcast_episodes_show_idx ON podcast_episodes (show_id, published_at)`);
    console.log("[migrations] podcast tables OK");
  } catch (e) {
    console.error("[migrations] podcast tables migration failed:", e.message);
  }

  // Podcast Notebook v2: cached transcript + timestamped notes.
  try {
    await db.execute(sql`ALTER TABLE podcast_episodes ADD COLUMN IF NOT EXISTS transcript text`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS podcast_episode_notes (
      id serial PRIMARY KEY,
      uid integer NOT NULL,
      episode_id integer NOT NULL,
      sec integer DEFAULT NULL,
      content text NOT NULL,
      created_at timestamp DEFAULT now()
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS podcast_episode_notes_ep_idx ON podcast_episode_notes (episode_id, sec)`);
    console.log("[migrations] podcast v2 (transcript + timestamped notes) OK");
  } catch (e) {
    console.error("[migrations] podcast v2 migration failed:", e.message);
  }
}
