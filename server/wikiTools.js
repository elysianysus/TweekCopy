import { db } from "./db.js";
import { memos, memoTags, memoLinks, tasks, foodLog, sleepLog, bloodPressure, rssFeeds, agentRunUpdates } from "./schema.js";
import { and, eq, sql, inArray, desc } from "drizzle-orm";
import { searchSimilarMemories } from "./museMemories.js";
import { todayInTz } from "./timezone.js";
import { unifiedDiff, summariseDiff } from "./wikiDiff.js";

// Per-op write caps. update_memo and create_memo count against these; the
// log/index helpers do not. Exceeding any cap aborts the op cleanly.
export const OP_CAPS = {
  ingest: { updates: 5, creates: 1 },
  synthesize: { updates: 1, creates: 1, totalMutations: 1 },
  query: { updates: 0, creates: 0 },
  lint: { updates: 0, creates: 0 },
  reindex: { updates: 0, creates: 1 },
};

export function makeRunState(opKey) {
  return {
    opKey,
    creates: 0,
    updates: 0,
    pendingUpdates: [],
    appliedUpdates: [],
  };
}

function capFor(opKey) {
  return OP_CAPS[opKey] || { updates: 0, creates: 0 };
}

const MAX_TEXT_RETURN = 3000;

function trim(s, n = MAX_TEXT_RETURN) {
  if (typeof s !== "string") return s;
  return s.length > n ? s.slice(0, n) + `…[+${s.length - n} chars]` : s;
}

async function rebuildMemoLinksLocal(uid, memoId, content) {
  await db.delete(memoLinks).where(eq(memoLinks.fromMemoId, memoId));
  if (!content) return;
  const matches = [...String(content).matchAll(/\[\[([^\]]+)\]\]/g)];
  if (matches.length === 0) return;
  const titles = [...new Set(matches.map((m) => m[1].trim()).filter(Boolean))];
  if (titles.length === 0) return;
  const targets = await db
    .select({ id: memos.id, title: memos.title })
    .from(memos)
    .where(and(eq(memos.uid, uid), inArray(memos.title, titles)));
  const seen = new Set();
  for (const t of targets) {
    if (t.id === memoId || seen.has(t.id)) continue;
    seen.add(t.id);
    try {
      await db.insert(memoLinks).values({ uid, fromMemoId: memoId, toMemoId: t.id });
    } catch {}
  }
}

async function getTagsFor(uid, memoIds) {
  if (!memoIds.length) return new Map();
  const rows = await db
    .select({ memoId: memoTags.memoId, tag: memoTags.tag })
    .from(memoTags)
    .innerJoin(memos, eq(memos.id, memoTags.memoId))
    .where(and(eq(memos.uid, uid), inArray(memoTags.memoId, memoIds)));
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.memoId)) map.set(r.memoId, []);
    map.get(r.memoId).push(r.tag);
  }
  return map;
}

async function setTags(memoId, tags) {
  await db.delete(memoTags).where(eq(memoTags.memoId, memoId));
  for (const t of tags || []) {
    if (!t) continue;
    await db.insert(memoTags).values({ memoId, tag: String(t).toLowerCase() });
  }
}

/**
 * Build a uid-scoped tool catalog. Each tool returns a JSON-serializable result.
 * Tools that mutate set `mutates: true`. The op recipe controls which tools are
 * actually allowed.
 */
export function buildWikiTools({ uid, tz = "Asia/Hong_Kong", dryRun = false, runId = null, runState = null, autoApply = false }) {
  const today = todayInTz(tz);

  const tools = [
    {
      name: "search_memos",
      description:
        "Search the user's memo wiki by semantic similarity + keyword. Returns up to N memos with id, title, snippet, tags. Use this to find existing notes BEFORE creating new ones.",
      mutates: false,
      schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language query." },
          tag: { type: "string", description: "Optional tag filter (lowercase)." },
          noteType: { type: "string", description: "Optional note_type filter (e.g. 'wiki-index', 'wiki-log', 'video-note')." },
          limit: { type: "integer", default: 8 },
        },
        required: ["query"],
      },
      handler: async ({ query, tag, noteType, limit = 8 }) => {
        const lim = Math.min(Math.max(parseInt(limit) || 8, 1), 20);
        // Semantic candidates (embeddings).
        let semantic = [];
        try {
          semantic = await searchSimilarMemories(uid, query, { limit: lim, minSimilarity: 0.2 });
        } catch {}
        // Keyword fallback over memos.
        const pattern = `%${query}%`;
        const kwRows = await db
          .select({ id: memos.id, title: memos.title, content: memos.content, noteType: memos.noteType, color: memos.color, updatedAt: memos.updatedAt })
          .from(memos)
          .where(
            and(
              eq(memos.uid, uid),
              sql`(LOWER(${memos.title}) LIKE LOWER(${pattern}) OR LOWER(${memos.content}) LIKE LOWER(${pattern}))`,
              noteType ? eq(memos.noteType, noteType) : sql`true`,
            ),
          )
          .orderBy(desc(memos.updatedAt))
          .limit(lim);
        // Merge: prefer keyword (which has full memo rows), then attach memory hits as extra context only.
        const memoIds = kwRows.map((m) => m.id);
        const tagMap = await getTagsFor(uid, memoIds);
        let result = kwRows.map((m) => ({
          id: m.id,
          title: m.title || "(untitled)",
          snippet: trim(m.content || "", 300),
          noteType: m.noteType,
          color: m.color,
          tags: tagMap.get(m.id) || [],
          updatedAt: m.updatedAt,
        }));
        if (tag) {
          const t = String(tag).toLowerCase();
          result = result.filter((r) => r.tags.includes(t));
        }
        return {
          memos: result.slice(0, lim),
          semanticHints: (semantic || []).slice(0, 5).map((m) => ({
            content: trim(m.content, 200),
            kind: m.kind,
            similarity: Number(m.similarity || 0),
          })),
        };
      },
    },

    {
      name: "read_memo",
      description: "Read the full content of one memo by id or by exact title. Use this to inspect a memo before linking or editing it.",
      mutates: false,
      schema: {
        type: "object",
        properties: {
          id: { type: "integer" },
          title: { type: "string" },
        },
      },
      handler: async ({ id, title }) => {
        let row;
        if (id) {
          [row] = await db.select().from(memos).where(and(eq(memos.id, id), eq(memos.uid, uid)));
        } else if (title) {
          [row] = await db.select().from(memos).where(and(eq(memos.title, title), eq(memos.uid, uid)));
        } else {
          return { error: "Provide id or title." };
        }
        if (!row) return { error: "Memo not found." };
        const tagRows = await db
          .select({ tag: memoTags.tag })
          .from(memoTags)
          .innerJoin(memos, eq(memos.id, memoTags.memoId))
          .where(and(eq(memos.uid, uid), eq(memoTags.memoId, row.id)));
        return {
          id: row.id,
          title: row.title,
          content: trim(row.content || "", 4000),
          noteType: row.noteType,
          color: row.color,
          tags: tagRows.map((t) => t.tag),
          date: row.date,
          updatedAt: row.updatedAt,
        };
      },
    },

    {
      name: "create_memo",
      description:
        "Create a new memo in the user's wiki. Use [[Other Title]] inside content to wikilink to other memos. Returns the new memo id.",
      mutates: true,
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          color: { type: "string", description: "white|blue|green|yellow|red|purple|orange" },
          noteType: { type: "string", description: "Optional. Use 'wiki-index' for the index page, 'wiki-log' for the agent log." },
        },
        required: ["title", "content"],
      },
      handler: async ({ title, content, tags = [], color = "white", noteType = null }) => {
        if (runState) {
          const cap = capFor(runState.opKey);
          if (runState.creates >= (cap.creates ?? 0)) {
            return { error: `cap_exceeded: ${runState.opKey} allows at most ${cap.creates ?? 0} new memo per run.` };
          }
          if (cap.totalMutations !== undefined &&
              runState.creates + runState.updates >= cap.totalMutations) {
            return { error: `cap_exceeded: ${runState.opKey} allows ${cap.totalMutations} mutation per run.` };
          }
          runState.creates += 1;
        }
        if (dryRun) return { dryRun: true, wouldCreate: { title, contentPreview: trim(content, 200), tags, color, noteType } };
        const [m] = await db
          .insert(memos)
          .values({ uid, title: String(title).slice(0, 200), content: String(content), color, noteType, date: today })
          .returning();
        await setTags(m.id, tags);
        await rebuildMemoLinksLocal(uid, m.id, m.content);
        return { id: m.id, title: m.title, noteType: m.noteType };
      },
    },

    {
      name: "update_memo",
      description:
        "Update an existing memo by id. Use this to ADD a small reference (e.g. a one-paragraph 'Source: …' or a [[New Title]] link) to entity / concept memos surfaced via search_memos. Prefer `appendContent` for additive updates and preserve existing wikilinks. Never wholesale-rewrite unrelated content. Returns whether the change was auto-applied or staged for the user to approve.",
      mutates: true,
      schema: {
        type: "object",
        properties: {
          id: { type: "integer" },
          title: { type: "string" },
          content: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          appendContent: { type: "string", description: "If set, append this text to the existing content (with a newline) instead of replacing." },
        },
        required: ["id"],
      },
      handler: async ({ id, title, content, tags, appendContent }) => {
        const [existing] = await db.select().from(memos).where(and(eq(memos.id, id), eq(memos.uid, uid)));
        if (!existing) return { error: "Memo not found." };
        if (existing.isHandMaintained) {
          return { error: `hand_maintained: memo #${id} ("${existing.title}") is hand-maintained. Skip it and find another memo to update, or just create a new memo instead.` };
        }
        if (runState) {
          const cap = capFor(runState.opKey);
          if (runState.updates >= (cap.updates ?? 0)) {
            return { error: `cap_exceeded: ${runState.opKey} allows at most ${cap.updates ?? 0} memo updates per run.` };
          }
          if (cap.totalMutations !== undefined &&
              runState.creates + runState.updates >= cap.totalMutations) {
            return { error: `cap_exceeded: ${runState.opKey} allows ${cap.totalMutations} mutation per run.` };
          }
          runState.updates += 1;
        }

        const beforeTitle = existing.title || "";
        const beforeContent = existing.content || "";
        const beforeTagRows = await db
          .select({ tag: memoTags.tag })
          .from(memoTags)
          .where(eq(memoTags.memoId, id));
        const beforeTags = beforeTagRows.map((r) => r.tag);

        let newContent = content !== undefined ? content : beforeContent;
        if (appendContent) newContent = `${beforeContent}\n${appendContent}`;
        const newTitle = title !== undefined ? String(title).slice(0, 200) : beforeTitle;
        const newTags = tags !== undefined ? tags.map((t) => String(t).toLowerCase()) : beforeTags;

        const diff = unifiedDiff(beforeContent, newContent, `memo#${id} before`, `memo#${id} after`);
        const tagDiff = JSON.stringify(beforeTags) === JSON.stringify(newTags)
          ? null
          : `tags: ${JSON.stringify(beforeTags)} → ${JSON.stringify(newTags)}`;
        const titleDiff = beforeTitle === newTitle ? null : `title: ${JSON.stringify(beforeTitle)} → ${JSON.stringify(newTitle)}`;
        const summary = summariseDiff(diff);

        if (dryRun) {
          return {
            dryRun: true,
            wouldUpdate: { id, title: newTitle, contentPreview: trim(newContent, 300), tags: newTags },
            diff,
            titleDiff,
            tagDiff,
            summary,
          };
        }

        // Persist the proposed update on the run record so the trace viewer
        // can render and (if review mode) approve / reject it.
        let updateRowId = null;
        if (runId) {
          try {
            const [u] = await db
              .insert(agentRunUpdates)
              .values({
                runId, uid, memoId: id, op: runState?.opKey || "unknown",
                beforeTitle, beforeContent,
                beforeTags: JSON.stringify(beforeTags),
                afterTitle: newTitle, afterContent: newContent,
                afterTags: JSON.stringify(newTags),
                diff,
                status: autoApply ? "auto_applied" : "pending",
              })
              .returning();
            updateRowId = u.id;
          } catch (e) {
            // Don't block the agent on a recording failure, but surface it.
            console.error("agentRunUpdates insert failed:", e.message);
          }
        }

        if (!autoApply) {
          if (runState) runState.pendingUpdates.push({ updateId: updateRowId, memoId: id, title: newTitle });
          return {
            staged: true,
            updateId: updateRowId,
            memoId: id,
            title: newTitle,
            diff,
            titleDiff,
            tagDiff,
            summary,
            note: "Review mode is on for this op — change is staged and waiting for the user to Approve or Reject in the run viewer.",
          };
        }

        const updates = { updatedAt: new Date() };
        if (title !== undefined) updates.title = newTitle;
        if (content !== undefined || appendContent) updates.content = newContent;
        const [updated] = await db.update(memos).set(updates).where(eq(memos.id, id)).returning();
        if (tags !== undefined) await setTags(id, newTags);
        if (content !== undefined || appendContent) await rebuildMemoLinksLocal(uid, id, updated.content);
        if (updateRowId) {
          await db.update(agentRunUpdates)
            .set({ status: "auto_applied", decidedAt: new Date() })
            .where(eq(agentRunUpdates.id, updateRowId));
        }
        if (runState) runState.appliedUpdates.push({ updateId: updateRowId, memoId: id, title: newTitle });
        return {
          applied: true,
          updateId: updateRowId,
          id: updated.id,
          title: updated.title,
          noteType: updated.noteType,
          diff,
          summary,
        };
      },
    },

    {
      name: "list_backlinks",
      description: "List memos that link TO the given memo (via [[Title]]).",
      mutates: false,
      schema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      handler: async ({ id }) => {
        const linkRows = await db
          .select({ fromMemoId: memoLinks.fromMemoId })
          .from(memoLinks)
          .where(and(eq(memoLinks.uid, uid), eq(memoLinks.toMemoId, id)));
        const ids = [...new Set(linkRows.map((r) => r.fromMemoId))];
        if (!ids.length) return { backlinks: [] };
        const rows = await db
          .select({ id: memos.id, title: memos.title })
          .from(memos)
          .where(and(eq(memos.uid, uid), inArray(memos.id, ids)));
        return { backlinks: rows };
      },
    },

    {
      name: "list_orphans",
      description: "List memos that have no incoming links and no outgoing wikilinks (orphans). Useful for the Lint op.",
      mutates: false,
      schema: { type: "object", properties: { limit: { type: "integer", default: 20 } } },
      handler: async ({ limit = 20 }) => {
        const lim = Math.min(parseInt(limit) || 20, 100);
        const all = await db
          .select({ id: memos.id, title: memos.title, content: memos.content, updatedAt: memos.updatedAt })
          .from(memos)
          .where(eq(memos.uid, uid))
          .orderBy(desc(memos.updatedAt))
          .limit(500);
        if (!all.length) return { orphans: [] };
        const ids = all.map((m) => m.id);
        const linkRows = await db
          .select()
          .from(memoLinks)
          .where(and(eq(memoLinks.uid, uid), inArray(memoLinks.fromMemoId, ids)));
        const fromSet = new Set(linkRows.map((r) => r.fromMemoId));
        const toSet = new Set(linkRows.map((r) => r.toMemoId));
        const orphans = all
          .filter((m) => !fromSet.has(m.id) && !toSet.has(m.id))
          .filter((m) => !/\[\[[^\]]+\]\]/.test(m.content || ""))
          .slice(0, lim)
          .map((m) => ({ id: m.id, title: m.title || "(untitled)" }));
        return { orphans, totalScanned: all.length };
      },
    },

    {
      name: "list_recent_memos",
      description: "List the user's most recently updated memos. Useful for Synthesize and Index ops.",
      mutates: false,
      schema: {
        type: "object",
        properties: {
          limit: { type: "integer", default: 25 },
          noteType: { type: "string", description: "Optional filter by note_type." },
        },
      },
      handler: async ({ limit = 25, noteType }) => {
        const lim = Math.min(parseInt(limit) || 25, 100);
        const where = and(
          eq(memos.uid, uid),
          noteType ? eq(memos.noteType, noteType) : sql`true`,
        );
        const rows = await db
          .select({ id: memos.id, title: memos.title, noteType: memos.noteType, updatedAt: memos.updatedAt })
          .from(memos)
          .where(where)
          .orderBy(desc(memos.updatedAt))
          .limit(lim);
        return { memos: rows };
      },
    },

    {
      name: "today_context",
      description: "Get a snapshot of the user's day: today's tasks, recent food log entries, recent sleep, recent BP. Read-only.",
      mutates: false,
      schema: { type: "object", properties: {} },
      handler: async () => {
        const t = await db
          .select({ id: tasks.id, name: tasks.name, startTime: tasks.startTime, done: tasks.done })
          .from(tasks)
          .where(and(eq(tasks.uid, uid), eq(tasks.date, today)))
          .limit(50);
        const f = await db
          .select({ id: foodLog.id, mealType: foodLog.mealType, items: foodLog.items, totalCalories: foodLog.totalCalories, date: foodLog.date, time: foodLog.time })
          .from(foodLog)
          .where(and(eq(foodLog.uid, uid), eq(foodLog.date, today)))
          .limit(50);
        const s = await db
          .select()
          .from(sleepLog)
          .where(eq(sleepLog.uid, uid))
          .orderBy(desc(sleepLog.date))
          .limit(3);
        const bp = await db
          .select()
          .from(bloodPressure)
          .where(eq(bloodPressure.uid, uid))
          .orderBy(desc(bloodPressure.date))
          .limit(3);
        return { today, tasks: t, food: f, recentSleep: s, recentBP: bp };
      },
    },

    {
      name: "list_feeds",
      description: "List the user's saved RSS feeds (id, title, url). Use as the ingestion source list for the Ingest op.",
      mutates: false,
      schema: { type: "object", properties: {} },
      handler: async () => {
        const rows = await db.select().from(rssFeeds).where(eq(rssFeeds.uid, uid));
        return { feeds: rows.map((r) => ({ id: r.id, title: r.title || r.url, url: r.url, siteUrl: r.siteUrl })) };
      },
    },

    {
      name: "append_to_log",
      description:
        "Append a single dated entry to the user's wiki log memo (title='Wiki Log', note_type='wiki-log'). Creates the log memo if it does not exist. Use after every meaningful op to keep an audit trail.",
      mutates: true,
      schema: {
        type: "object",
        properties: {
          entry: { type: "string", description: "Short one-line summary of what the op did." },
        },
        required: ["entry"],
      },
      handler: async ({ entry }) => {
        if (dryRun) return { dryRun: true, wouldAppend: entry };
        const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
        const line = `- ${stamp}  ${String(entry).slice(0, 400)}`;
        const [existing] = await db
          .select()
          .from(memos)
          .where(and(eq(memos.uid, uid), eq(memos.noteType, "wiki-log")))
          .limit(1);
        if (existing) {
          const newContent = `${existing.content || ""}\n${line}`.trim();
          await db
            .update(memos)
            .set({ content: newContent, updatedAt: new Date() })
            .where(eq(memos.id, existing.id));
          return { id: existing.id, appended: true };
        }
        const [m] = await db
          .insert(memos)
          .values({
            uid,
            title: "Wiki Log",
            content: `# Muse Wiki Log\n\nAuto-maintained by the Muse agent. One line per op.\n\n${line}`,
            noteType: "wiki-log",
            color: "yellow",
            date: today,
          })
          .returning();
        return { id: m.id, created: true };
      },
    },

    {
      name: "rebuild_index",
      description:
        "Rebuild the wiki index memo (title='Wiki Index', note_type='wiki-index'). Replaces its content with a fresh table-of-contents listing the user's memos grouped by tag. Creates it if missing.",
      mutates: true,
      schema: {
        type: "object",
        properties: {
          markdown: { type: "string", description: "Pre-rendered markdown body for the index. Should contain wikilinks like [[Title]]." },
        },
        required: ["markdown"],
      },
      handler: async ({ markdown }) => {
        if (dryRun) return { dryRun: true, wouldWriteBytes: (markdown || "").length };
        const [existing] = await db
          .select()
          .from(memos)
          .where(and(eq(memos.uid, uid), eq(memos.noteType, "wiki-index")))
          .limit(1);
        const content = String(markdown || "").slice(0, 30000);
        if (existing) {
          await db
            .update(memos)
            .set({ content, updatedAt: new Date() })
            .where(eq(memos.id, existing.id));
          await rebuildMemoLinksLocal(uid, existing.id, content);
          return { id: existing.id, updated: true };
        }
        const [m] = await db
          .insert(memos)
          .values({ uid, title: "Wiki Index", content, noteType: "wiki-index", color: "blue", date: today, pinned: true })
          .returning();
        await rebuildMemoLinksLocal(uid, m.id, content);
        return { id: m.id, created: true };
      },
    },
  ];

  return tools;
}
