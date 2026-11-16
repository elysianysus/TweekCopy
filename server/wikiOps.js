import { db } from "./db.js";
import { agentRuns, agentRunUpdates, users, memos, memoTags } from "./schema.js";
import { eq, and, desc, asc } from "drizzle-orm";
import { runAgent, AgentKillSwitchError } from "./agentLoop.js";
import { buildWikiTools, makeRunState } from "./wikiTools.js";
import { unifiedDiff } from "./wikiDiff.js";

export const WIKI_OPS = {
  ingest: {
    label: "Ingest",
    description: "Capture a new piece of input as a fresh wiki memo, AND tighten 0-N related entity / concept memos by appending small references to them so the wiki compounds.",
    allowedTools: ["search_memos", "read_memo", "create_memo", "update_memo", "list_recent_memos", "append_to_log"],
    budget: { maxSteps: 8, maxToolCalls: 14 },
    systemPrompt: `You are the Ingest operator of a personal wiki agent.

GOAL: Take the user's raw input (a clipping, idea, observation, or note) and:
  1. search_memos for related existing notes (1-2 calls).
  2. read_memo on 1-3 of the most relevant entity / concept memos so you understand what's already there.
  3. create_memo to save the new source memo with 1-3 lowercase tags. Use [[Other Title]] wikilinks to connect it to the related notes you found.
  4. For up to 5 of those related entity / concept memos, call update_memo with \`appendContent\` to add ONE short paragraph (1-3 sentences) referencing the new source memo, e.g. "- Source: [[New Title]] — one-line takeaway." Always include the [[New Title]] wikilink. NEVER rewrite unrelated content. NEVER touch \`title\` or \`tags\` unless adding a new tag is clearly needed.
  5. append_to_log with one short line summarising what was added and updated.
  6. Reply with a one-line confirmation including the new memo id, its title, and the count of memos updated.

RULES:
- Hard caps: at most 5 update_memo calls and 1 create_memo call per run. Do not retry past these.
- Updates must be ADDITIVE: prefer \`appendContent\`. Preserve existing wikilinks. Do not delete or rewrite paragraphs you did not write.
- If a memo is hand-maintained, update_memo will refuse with a hand_maintained error. Skip it and move on — do not retry the same memo.
- Tags are lowercase, single words or hyphen-cased.
- Wikilinks must reference real titles you saw via search_memos / read_memo.
- If the input is too thin or duplicative, skip create_memo and explain briefly.
- The user's review-mode setting decides whether updates auto-apply or are staged for them to approve. Either way the diff is recorded — your job is just to propose good, small updates.`,
  },

  query: {
    label: "Query",
    description: "Answer a question by reading the user's wiki and citing memo titles.",
    allowedTools: ["search_memos", "read_memo", "list_backlinks", "today_context"],
    budget: { maxSteps: 6, maxToolCalls: 12 },
    systemPrompt: `You are the Query operator of a personal wiki agent.

GOAL: Answer the user's question using ONLY information you can find in their wiki and today_context. You may NOT invent facts.

PROCESS:
- search_memos to find relevant notes (run more than once with different phrasings if needed).
- read_memo on the most promising hits.
- Optionally list_backlinks to see what links to a memo.
- today_context only if the question is about today.

OUTPUT:
- A concise answer (3-8 sentences max), in the user's language.
- Cite memos inline as [[Title]] so the user can jump to them.
- If you cannot find a confident answer, say so and suggest 1 search query they could try.`,
  },

  synthesize: {
    label: "Synthesize",
    description: "Combine related memos into a fresh summary memo, OR refresh an existing 'Synthesis: <topic>' memo in place.",
    allowedTools: ["search_memos", "read_memo", "list_recent_memos", "create_memo", "update_memo", "append_to_log"],
    budget: { maxSteps: 8, maxToolCalls: 14 },
    systemPrompt: `You are the Synthesize operator of a personal wiki agent.

GOAL: Given the user's topic, find 3-6 related memos, read them, and produce a summary memo. Every claim in the body must end with a [[Title]] citation to the source memo.

PROCESS:
1. search_memos for "Synthesis: <topic>" or similar — if a previous synthesis memo on this topic already exists, plan to update it (read_memo on it first).
2. search_memos and list_recent_memos to gather source candidates.
3. read_memo on at least 3 source candidates.
4. EITHER call create_memo (title "Synthesis: <topic>") for a fresh synthesis, OR call update_memo on the existing synthesis with the full refreshed body in \`content\`. Pick exactly one.
5. append_to_log.
6. Reply with the resulting memo id and a one-line teaser.

RULES:
- Hard cap: exactly ONE mutation per run (one create_memo OR one update_memo). No more.
- Use [[Title]] citations liberally and preserve existing citations when refreshing an existing synthesis.
- If fewer than 2 useful sources exist, do not create or update; report what's missing.
- If the existing synthesis is hand-maintained, update_memo will refuse — fall back to creating a fresh "Synthesis: <topic> (v2)" instead.`,
  },

  lint: {
    label: "Lint",
    description: "Find structural problems in the wiki (orphans, broken links, untagged memos) and propose fixes.",
    allowedTools: ["list_orphans", "list_recent_memos", "search_memos", "read_memo", "append_to_log"],
    budget: { maxSteps: 6, maxToolCalls: 10 },
    systemPrompt: `You are the Lint operator of a personal wiki agent. READ-ONLY by default — never call create_memo or update_memo.

GOAL: Diagnose the wiki and produce a short report.
- Use list_orphans to find disconnected memos.
- Spot-check a few orphans with read_memo to see if they could be linked.
- Suggest concrete fixes ("Memo [[Foo]] could link to [[Bar]] because …").
- append_to_log a one-line summary of what you found.

OUTPUT a short markdown report grouped by issue type. Do not actually mutate any memos.`,
  },

  reindex: {
    label: "Reindex",
    description: "Rebuild the Wiki Index memo and append a log entry.",
    allowedTools: ["list_recent_memos", "search_memos", "rebuild_index", "append_to_log"],
    budget: { maxSteps: 5, maxToolCalls: 8 },
    systemPrompt: `You are the Reindex operator of a personal wiki agent.

GOAL: Rebuild the user's "Wiki Index" memo so it is a useful table of contents.

PROCESS:
1. list_recent_memos with limit=60 to see what exists.
2. Group memos sensibly (by note_type or by topic clusters you infer from titles).
3. Compose a markdown index with sections and bullet lists; every bullet uses a [[Title]] wikilink.
4. rebuild_index with that markdown.
5. append_to_log with a one-line summary (e.g. "Reindexed: 42 memos in 5 sections").
6. Reply with a one-line confirmation.

Keep the index under ~250 lines.`,
  },
};

export function getOpNames() {
  return Object.keys(WIKI_OPS);
}

async function getAutoApplyForOp(uid, op) {
  if (op !== "ingest" && op !== "synthesize") return true; // other ops never stage
  try {
    const [u] = await db.select({
      ingest: users.wikiAutoApplyIngest,
      synth: users.wikiAutoApplySynthesize,
    }).from(users).where(eq(users.id, uid));
    if (!u) return false;
    return op === "ingest" ? !!u.ingest : !!u.synth;
  } catch {
    return false;
  }
}

export async function runWikiOp({ uid, op, input, tz, dryRun = false, model = "gpt-4o-mini", autoApplyOverride = null, runAgentImpl = runAgent, source = "manual", trigger = "manual" }) {
  const recipe = WIKI_OPS[op];
  if (!recipe) throw new Error(`Unknown wiki op: ${op}`);

  // Run metadata convention (#164):
  //   source  = 'auto' | 'manual'
  //   trigger = concrete origin enum: 'rss-digest', 'video-transcript',
  //             'last30days', 'line-food', 'line-expense', 'line-medicine',
  //             'scheduler', 'manual'
  const persistedSource = source === "auto" ? "auto" : "manual";
  const persistedTrigger = trigger ? String(trigger).slice(0, 60) : "manual";

  // Persist the run row up front so we always have an id to return even on failure.
  const [runRow] = await db
    .insert(agentRuns)
    .values({
      uid, op, status: "running",
      input: String(input || "").slice(0, 4000),
      // NOTE: schema column names are kept (`trigger`, `source`); only the
      // semantic meaning of their values has been swapped to match #164.
      trigger: persistedTrigger,
      source: persistedSource,
    })
    .returning();

  const autoApply = autoApplyOverride !== null ? !!autoApplyOverride : await getAutoApplyForOp(uid, op);
  const runState = makeRunState(op);
  const allowedSet = new Set(recipe.allowedTools);
  const allTools = buildWikiTools({ uid, tz, dryRun, runId: runRow.id, runState, autoApply });
  const tools = allTools.map((t) => ({ ...t, allowed: allowedSet.has(t.name) }));

  const reviewNote = (op === "ingest" || op === "synthesize")
    ? `\n\nNOTE: For this run, update_memo is in ${autoApply ? "AUTO-APPLY" : "REVIEW (staged-for-approval)"} mode. ${autoApply ? "" : "Updates will be queued for the user to approve in the run viewer; the user has not opted into auto-apply yet."}`
    : "";

  let result;
  try {
    result = await runAgentImpl({
      model,
      systemPrompt: recipe.systemPrompt + reviewNote + (dryRun ? "\n\nNOTE: dryRun=true. Mutating tools will only describe their planned change, not commit it." : ""),
      userInput: input || "",
      tools,
      budget: recipe.budget,
    });
  } catch (err) {
    const msg = err instanceof AgentKillSwitchError ? "Muse agent is paused (kill switch)." : err.message;
    await db
      .update(agentRuns)
      .set({ status: "error", error: msg, output: "" })
      .where(eq(agentRuns.id, runRow.id));
    return { runId: runRow.id, ok: false, error: msg, output: "", trace: [], op };
  }

  await db
    .update(agentRuns)
    .set({
      status: result.ok ? "ok" : "error",
      output: String(result.finalText || "").slice(0, 8000),
      trace: JSON.stringify(result.trace || []).slice(0, 60000),
      error: result.error || null,
      toolCallCount: result.toolCallCount,
      durationMs: result.durationMs,
    })
    .where(eq(agentRuns.id, runRow.id));

  return {
    runId: runRow.id,
    ok: result.ok,
    output: result.finalText,
    trace: result.trace,
    error: result.error,
    op,
    toolCallCount: result.toolCallCount,
    durationMs: result.durationMs,
    autoApply,
    pendingUpdateCount: runState.pendingUpdates.length,
    appliedUpdateCount: runState.appliedUpdates.length,
  };
}

async function rebuildMemoLinksFor(uid, memoId, content) {
  const { memoLinks } = await import("./schema.js");
  await db.delete(memoLinks).where(eq(memoLinks.fromMemoId, memoId));
  const matches = [...String(content || "").matchAll(/\[\[([^\]]+)\]\]/g)];
  if (matches.length === 0) return;
  const titles = [...new Set(matches.map((m) => m[1].trim()).filter(Boolean))];
  if (!titles.length) return;
  const { inArray } = await import("drizzle-orm");
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

export async function approveAgentRunUpdate(uid, updateId) {
  const [row] = await db.select().from(agentRunUpdates).where(and(eq(agentRunUpdates.id, updateId), eq(agentRunUpdates.uid, uid)));
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "pending") return { ok: false, error: `already_${row.status}` };
  const [memo] = await db.select().from(memos).where(and(eq(memos.id, row.memoId), eq(memos.uid, uid)));
  if (!memo) {
    await db.update(agentRunUpdates)
      .set({ status: "rejected", errorMessage: "memo no longer exists", decidedAt: new Date() })
      .where(eq(agentRunUpdates.id, updateId));
    return { ok: false, error: "memo_missing" };
  }
  if (memo.isHandMaintained) {
    await db.update(agentRunUpdates)
      .set({ status: "rejected", errorMessage: "memo is hand-maintained", decidedAt: new Date() })
      .where(eq(agentRunUpdates.id, updateId));
    return { ok: false, error: "hand_maintained" };
  }
  const updates = { updatedAt: new Date() };
  if (row.afterTitle !== row.beforeTitle) updates.title = row.afterTitle;
  if (row.afterContent !== row.beforeContent) updates.content = row.afterContent;
  await db.update(memos).set(updates).where(eq(memos.id, row.memoId));
  let beforeTags = []; let afterTags = [];
  try { beforeTags = JSON.parse(row.beforeTags || "[]"); } catch {}
  try { afterTags = JSON.parse(row.afterTags || "[]"); } catch {}
  if (JSON.stringify(beforeTags) !== JSON.stringify(afterTags)) {
    await db.delete(memoTags).where(eq(memoTags.memoId, row.memoId));
    for (const t of afterTags) {
      if (!t) continue;
      await db.insert(memoTags).values({ memoId: row.memoId, tag: String(t).toLowerCase() });
    }
  }
  if (updates.content !== undefined) {
    await rebuildMemoLinksFor(uid, row.memoId, row.afterContent);
  }
  await db.update(agentRunUpdates)
    .set({ status: "applied", decidedAt: new Date() })
    .where(eq(agentRunUpdates.id, updateId));
  return { ok: true };
}

export async function rejectAgentRunUpdate(uid, updateId) {
  const [row] = await db.select().from(agentRunUpdates).where(and(eq(agentRunUpdates.id, updateId), eq(agentRunUpdates.uid, uid)));
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "pending") return { ok: false, error: `already_${row.status}` };
  await db.update(agentRunUpdates)
    .set({ status: "rejected", decidedAt: new Date() })
    .where(eq(agentRunUpdates.id, updateId));
  return { ok: true };
}

export async function setWikiAutoApply(uid, op, value) {
  const v = !!value;
  if (op === "ingest") {
    await db.update(users).set({ wikiAutoApplyIngest: v }).where(eq(users.id, uid));
  } else if (op === "synthesize") {
    await db.update(users).set({ wikiAutoApplySynthesize: v }).where(eq(users.id, uid));
  } else {
    throw new Error("auto-apply only configurable for ingest/synthesize");
  }
  return { ok: true, op, value: v };
}

export async function listAgentRuns(uid, { limit = 25, source = null } = {}) {
  const conds = [eq(agentRuns.uid, uid)];
  if (source === "manual" || source === "auto") {
    conds.push(eq(agentRuns.source, source));
  }
  return db
    .select({
      id: agentRuns.id,
      op: agentRuns.op,
      status: agentRuns.status,
      input: agentRuns.input,
      output: agentRuns.output,
      error: agentRuns.error,
      toolCallCount: agentRuns.toolCallCount,
      durationMs: agentRuns.durationMs,
      trigger: agentRuns.trigger,
      source: agentRuns.source,
      createdAt: agentRuns.createdAt,
    })
    .from(agentRuns)
    .where(conds.length > 1 ? and(...conds) : conds[0])
    .orderBy(desc(agentRuns.createdAt))
    .limit(Math.min(limit, 100));
}

export async function getAgentRun(uid, id) {
  const [row] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, id), eq(agentRuns.uid, uid)));
  if (!row) return null;
  let trace = [];
  try { trace = JSON.parse(row.trace || "[]"); } catch {}
  const updates = await db
    .select()
    .from(agentRunUpdates)
    .where(and(eq(agentRunUpdates.runId, id), eq(agentRunUpdates.uid, uid)))
    .orderBy(asc(agentRunUpdates.id));
  return { ...row, trace, updates };
}

export async function getWikiAutoApplyPrefs(uid) {
  const [u] = await db.select({
    ingest: users.wikiAutoApplyIngest,
    synth: users.wikiAutoApplySynthesize,
  }).from(users).where(eq(users.id, uid));
  return { ingest: !!u?.ingest, synthesize: !!u?.synth };
}

export async function getWikiAutoIngestPrefs(uid) {
  const [u] = await db.select({
    rss: users.wikiAutoIngestRssDigest,
    video: users.wikiAutoIngestVideoTranscript,
    line: users.wikiAutoIngestLineLog,
    last30: users.wikiAutoIngestLast30days,
  }).from(users).where(eq(users.id, uid));
  return {
    rssDigest: !!u?.rss,
    videoTranscript: !!u?.video,
    lineLog: !!u?.line,
    last30days: !!u?.last30,
  };
}

export async function setWikiAutoIngest(uid, key, value) {
  const v = !!value;
  const map = {
    rssDigest: "wikiAutoIngestRssDigest",
    videoTranscript: "wikiAutoIngestVideoTranscript",
    lineLog: "wikiAutoIngestLineLog",
    last30days: "wikiAutoIngestLast30days",
  };
  const col = map[key];
  if (!col) throw new Error(`unknown auto-ingest key: ${key}`);
  await db.update(users).set({ [col]: v }).where(eq(users.id, uid));
  return { ok: true, key, value: v };
}

export async function getWikiLintSchedule(uid) {
  const [u] = await db.select({
    enabled: users.wikiLintEnabled,
    dow: users.wikiLintDow,
    hour: users.wikiLintHour,
    minute: users.wikiLintMinute,
  }).from(users).where(eq(users.id, uid));
  return {
    enabled: !!u?.enabled,
    dow: u?.dow ?? 0,
    hour: u?.hour ?? 9,
    minute: u?.minute ?? 0,
  };
}

export async function setWikiLintSchedule(uid, { enabled, dow, hour, minute }) {
  const updates = {};
  if (enabled !== undefined) updates.wikiLintEnabled = !!enabled;
  if (dow !== undefined) {
    const n = Number(dow);
    if (!Number.isInteger(n) || n < 0 || n > 6) throw new Error("invalid dow (0=Sun..6=Sat)");
    updates.wikiLintDow = n;
  }
  if (hour !== undefined) {
    const n = Number(hour);
    if (!Number.isInteger(n) || n < 0 || n > 23) throw new Error("invalid hour");
    updates.wikiLintHour = n;
  }
  if (minute !== undefined) {
    const n = Number(minute);
    if (!Number.isInteger(n) || n < 0 || n > 59) throw new Error("invalid minute");
    updates.wikiLintMinute = n;
  }
  if (Object.keys(updates).length === 0) return getWikiLintSchedule(uid);
  await db.update(users).set(updates).where(eq(users.id, uid));
  return getWikiLintSchedule(uid);
}
