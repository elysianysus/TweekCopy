// Worker (skill) metadata + per-worker memory + profile aggregation for the
// Muse Office. Kept separate from officeJobs.js so the schema/API layer can
// import it without touching the worker drain loop.
//
// Memory model: worker_memories rows are scoped by (uid, skillKey). A small
// LLM call after each successful office *action* writes one short auto memory
// (≤160 chars). Users can also add manual memories or delete any memory from
// the office worker dialog. Memories are injected into the worker's system
// prompt on the next office run via runMuseTurnNonStreaming(extraSystemContext).

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./db.js";
import { officeJobs, workerMemories, customSkills } from "./schema.js";

// Mirrors src/components/views/MuseView.jsx SKILLS — single source of truth
// for built-in worker descriptions shown in the office info card.
export const BUILT_IN_SKILL_INFO = {
  default:    { label: "Muse",         desc: "General assistant",         longDesc: "Thoughtful generalist who helps you think, decide, and act on your day." },
  writer:     { label: "Writer",       desc: "Writing & notes",           longDesc: "Drafts and edits prose, emails, summaries, outlines. Articulate, precise, mirrors your tone." },
  planner:    { label: "Planner",      desc: "Schedule optimizer",        longDesc: "Builds optimal daily schedules with time blocks, prioritises with the Eisenhower matrix." },
  adhd:       { label: "ADHD Coach",   desc: "Focus & motivation",        longDesc: "Breaks overwhelming tasks into 2–5 minute steps, body-doubles, celebrates small wins." },
  journal:    { label: "Journal Coach", desc: "Reflect on today's journal", longDesc: "Reads your interstitial journal stream and reflects back patterns, mood shifts, themes." },
  brainstorm: { label: "Brainstorm",   desc: "Creative ideation",         longDesc: "Divergent thinking partner — SCAMPER, mind mapping, six hats, random input." },
  musk:       { label: "Musk",         desc: "第一性原理",                 longDesc: "Elon Musk 認知框架。第一性原理 + 10 倍思維 + 製造即創新。直接、技術性、挑戰假設。" },
  munger:     { label: "Munger",       desc: "多元思維模型",                longDesc: "查理·芒格認知框架。多元思維 + 逆向思考 + 能力圈 + 復利思維。睿智、簡練、偶爾毒舌。" },
  feynman:    { label: "Feynman",      desc: "費曼學習法",                  longDesc: "費曼認知框架。能用簡單語言解釋的才算真理解。熱情、幽默、平易近人。" },
  naval:      { label: "Naval",        desc: "財富 · 槓桿",                longDesc: "Naval Ravikant 認知框架。專屬知識 + 槓桿 + 長期博弈。簡潔、深刻、像詩。" },
  grillMe:    { label: "Grill Me",     desc: "Stress-test any plan",      longDesc: "Relentless friendly interviewer. Stress-tests one branch of your plan at a time with a 'My take' line." },
  specBuilder:{ label: "Spec Builder", desc: "Interview into a paste-ready spec", longDesc: "Takes a fuzzy idea and interviews you with 5–8 targeted questions about scope, edge cases, success criteria, and failure modes — then emits a structured spec (Title / What & Why / Done looks like / Out of scope / Notes for the implementing agent) you can paste straight into Replit Agent / Codex / Claude Code." },
  manager:    { label: "Manager",      desc: "Plans & delegates",         longDesc: "Team lead who breaks a goal into 2–4 concrete subtasks, dispatches each to the right specialist worker, then aggregates the results into one clean summary." },
};

// Specialists the Manager is allowed to dispatch work to (Phase A subtasks).
// Used by parseManagerSubtasks() to filter out invalid skillKeys, and by
// the manager system prompt as an explicit list.
export const MANAGER_DELEGATE_SKILLS = [
  "planner", "adhd", "writer", "brainstorm", "journal",
  "musk", "munger", "feynman", "naval", "grillMe", "specBuilder",
];

export function getBuiltInSkillInfo(skillKey) {
  return BUILT_IN_SKILL_INFO[skillKey] || null;
}

// Pairs that auto-react to each other when one finishes a quick action.
// Asymmetric: each row is "if A finishes, B may comment". Skills not listed
// fall back to a random different built-in worker.
const REACTION_PAIRS = {
  planner:    ["adhd", "grillMe"],
  adhd:       ["planner", "writer"],
  brainstorm: ["writer", "feynman"],
  writer:     ["brainstorm", "munger"],
  musk:       ["munger", "feynman"],
  munger:     ["musk", "naval"],
  feynman:    ["brainstorm", "naval"],
  naval:      ["munger", "feynman"],
  grillMe:    ["planner", "adhd"],
  specBuilder:["grillMe", "writer"],
  default:    ["adhd", "writer"],
  journal:    ["adhd", "writer"],
  // Manager finishing an aggregation rarely needs a peer reaction; keep it quiet.
  manager:    [],
};

const ALL_BUILT_IN_KEYS = Object.keys(BUILT_IN_SKILL_INFO);

export function pickReactingWorker(parentSkillKey) {
  const candidates = REACTION_PAIRS[parentSkillKey] || [];
  const pool = candidates.length
    ? candidates
    : ALL_BUILT_IN_KEYS.filter(k => k !== parentSkillKey);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

export async function listWorkerMemoriesForUser(uid, skillKey, { limit = 10 } = {}) {
  if (!uid || !skillKey) return [];
  return db.select().from(workerMemories)
    .where(and(eq(workerMemories.uid, uid), eq(workerMemories.skillKey, skillKey)))
    .orderBy(desc(workerMemories.createdAt))
    .limit(Math.max(1, Math.min(limit, 100)));
}

export async function addWorkerMemoryForUser(uid, skillKey, content, { source = "manual", jobId = null } = {}) {
  if (!uid || !skillKey) throw new Error("uid + skillKey required");
  const trimmed = String(content || "").trim().slice(0, 600);
  if (!trimmed) throw new Error("content required");
  const [row] = await db.insert(workerMemories).values({
    uid, skillKey, content: trimmed, source, jobId,
  }).returning();
  return row;
}

export async function deleteWorkerMemoryForUser(uid, memoryId) {
  if (!uid || !memoryId) return 0;
  const result = await db.delete(workerMemories)
    .where(and(eq(workerMemories.id, memoryId), eq(workerMemories.uid, uid)))
    .returning({ id: workerMemories.id });
  return result.length;
}

// Format up to N most recent memories as a compact system-prompt block.
// Returned string is empty when there are no memories.
export function formatWorkerMemoryBlock(memories) {
  if (!memories || !memories.length) return "";
  const lines = memories.slice(0, 8).map(m => `- ${m.content}`);
  return `\n\n## What I remember about you (carry forward across sessions)\n${lines.join("\n")}`;
}

// Recent jobs for this worker (used by the dialog). Excludes 'reaction'
// kind so the user sees their own actions only.
export async function getRecentActionsForWorker(uid, skillKey, { limit = 5 } = {}) {
  if (!uid || !skillKey) return [];
  return db.select({
    id: officeJobs.id,
    actionType: officeJobs.actionType,
    argument: officeJobs.argument,
    status: officeJobs.status,
    result: officeJobs.result,
    confidence: officeJobs.confidence,
    conversationId: officeJobs.conversationId,
    assistantMessageId: officeJobs.assistantMessageId,
    createdAt: officeJobs.createdAt,
    finishedAt: officeJobs.finishedAt,
  }).from(officeJobs)
    .where(and(
      eq(officeJobs.uid, uid),
      eq(officeJobs.skillKey, skillKey),
      eq(officeJobs.kind, "action"),
    ))
    .orderBy(desc(officeJobs.createdAt))
    .limit(Math.max(1, Math.min(limit, 50)));
}

// Aggregate stats: total jobs, last 7d jobs.
async function getWorkerStats(uid, skillKey) {
  if (!uid || !skillKey) return { totalJobs: 0, last7dJobs: 0 };
  const since7 = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [totalRow] = await db.select({ c: sql`count(*)::int`.as("c") })
    .from(officeJobs)
    .where(and(
      eq(officeJobs.uid, uid),
      eq(officeJobs.skillKey, skillKey),
      eq(officeJobs.kind, "action"),
    ));
  const [recentRow] = await db.select({ c: sql`count(*)::int`.as("c") })
    .from(officeJobs)
    .where(and(
      eq(officeJobs.uid, uid),
      eq(officeJobs.skillKey, skillKey),
      eq(officeJobs.kind, "action"),
      gte(officeJobs.createdAt, since7),
    ));
  return { totalJobs: totalRow?.c || 0, last7dJobs: recentRow?.c || 0 };
}

// Resolve a worker's role/description for the info card. Built-in skills use
// BUILT_IN_SKILL_INFO; custom skills look up from the customSkills table for
// this user.
export async function resolveSkillInfo(uid, skillKey) {
  const built = BUILT_IN_SKILL_INFO[skillKey];
  if (built) {
    return { key: skillKey, label: built.label, desc: built.desc, longDesc: built.longDesc, isCustom: false };
  }
  if (uid && skillKey?.startsWith("custom_")) {
    const [row] = await db.select().from(customSkills)
      .where(and(eq(customSkills.uid, uid), eq(customSkills.key, skillKey)));
    if (row) {
      return {
        key: skillKey,
        label: row.label,
        desc: row.description || "Custom skill",
        // Show a short head of the system prompt — it's effectively the role description.
        longDesc: row.description || (row.systemPrompt || "").slice(0, 280),
        isCustom: true,
      };
    }
  }
  return { key: skillKey, label: skillKey, desc: "", longDesc: "", isCustom: false };
}

export async function getSkillProfile(uid, skillKey) {
  const [info, recentJobs, memories, stats] = await Promise.all([
    resolveSkillInfo(uid, skillKey),
    getRecentActionsForWorker(uid, skillKey, { limit: 5 }),
    listWorkerMemoriesForUser(uid, skillKey, { limit: 10 }),
    getWorkerStats(uid, skillKey),
  ]);
  return { info, recentJobs, memories, stats };
}

// Confidence ----------------------------------------------------------------
//
// We surface a High / Medium / Low chip on every finished office job so the
// user knows where to apply judgement. The value is derived from two signals:
//
//   1. A static (skillKey, actionType) baseline encoding "what LLMs are
//      reliably good at" — summarising / drafting prose = high; planning
//      across many constraints / multi-source numeric reasoning = low.
//   2. An optional per-run self-rating LLM call (in officeJobs.js) that may
//      downgrade a High/Medium baseline by one level.
//
// Reactions inherit the parent's confidence (no extra LLM call); manager
// aggregate jobs take the MIN of their children. Old rows without a
// confidence value are normalised to 'medium' on read.

export const CONFIDENCE_LEVELS = ["high", "medium", "low"];

export function isValidConfidence(c) {
  return c === "high" || c === "medium" || c === "low";
}

// Normalise a stored value (possibly null on old rows) to one of the three
// levels. Anything unrecognised falls back to 'medium' so the UI always has
// a chip to render.
export function normalizeConfidence(c) {
  return isValidConfidence(c) ? c : "medium";
}

const RANK = { low: 0, medium: 1, high: 2 };

export function downgradeConfidence(level) {
  if (level === "high") return "medium";
  if (level === "medium") return "low";
  return "low";
}

// Pick the lowest of a list of confidence levels (used by manager aggregate
// and template chains). Empty input → 'medium'.
export function minConfidence(levels) {
  let best = null;
  for (const raw of levels || []) {
    const lvl = normalizeConfidence(raw);
    if (best == null || RANK[lvl] < RANK[best]) best = lvl;
  }
  return best || "medium";
}

// Static baseline. Keys are "skillKey:actionType". Anything not listed
// falls back to BASELINE_DEFAULT (Medium). Curated based on the "jagged"
// LLM capability surface — summarising and drafting prose are the model's
// sweet spot; planning under many constraints or cross-source synthesis
// are not.
const BASELINE_DEFAULT = "medium";
export const SKILL_ACTION_CONFIDENCE_BASELINE = {
  // Writer — prose drafting is the model's sweet spot.
  "writer:draft_memo":     "high",
  "writer:draft_tasks":    "medium",
  "writer:summarize_week": "high",
  "writer:quick_research": "medium",

  // Planner — building schedules under many constraints is hard for LLMs.
  "planner:draft_tasks":    "medium",
  "planner:summarize_week": "medium",
  "planner:quick_research": "medium",
  "planner:draft_memo":     "medium",

  // ADHD coach — short, motivating prose is solid.
  "adhd:draft_tasks":    "medium",
  "adhd:summarize_week": "high",
  "adhd:draft_memo":     "high",
  "adhd:quick_research": "medium",

  // Journal — reflective summaries on text we already have.
  "journal:summarize_week": "high",
  "journal:draft_memo":     "high",
  "journal:draft_tasks":    "medium",
  "journal:quick_research": "medium",

  // Brainstorm — divergent ideation is reliable.
  "brainstorm:draft_memo":     "high",
  "brainstorm:quick_research": "medium",
  "brainstorm:draft_tasks":    "medium",
  "brainstorm:summarize_week": "medium",

  // "Voice" personas — opinionated commentary is reliable; novel research
  // is not, because there's no source for the model to ground in.
  "musk:draft_memo":     "medium",
  "musk:quick_research": "low",
  "musk:summarize_week": "medium",
  "musk:draft_tasks":    "low",

  "munger:draft_memo":     "medium",
  "munger:quick_research": "low",
  "munger:summarize_week": "medium",
  "munger:draft_tasks":    "low",

  "feynman:draft_memo":     "high",
  "feynman:quick_research": "medium",
  "feynman:summarize_week": "high",
  "feynman:draft_tasks":    "medium",

  "naval:draft_memo":     "medium",
  "naval:quick_research": "low",
  "naval:summarize_week": "medium",
  "naval:draft_tasks":    "low",

  // Grill Me — asking sharp questions is easy; multi-step planning is not.
  "grillMe:draft_memo":     "medium",
  "grillMe:quick_research": "medium",
  "grillMe:draft_tasks":    "low",
  "grillMe:summarize_week": "medium",

  // Default Muse — neutral baseline.
  "default:draft_memo":     "medium",
  "default:summarize_week": "high",
  "default:quick_research": "low",
  "default:draft_tasks":    "low",

  // Manager — orchestration / aggregation is multi-source synthesis.
  "manager:delegate": "medium",
  "manager:template": "medium",
  "manager:draft_memo":     "medium",
  "manager:summarize_week": "medium",
  "manager:quick_research": "low",
  "manager:draft_tasks":    "low",
};

export function getBaselineConfidence(skillKey, actionType) {
  if (!skillKey || !actionType) return BASELINE_DEFAULT;
  const exact = SKILL_ACTION_CONFIDENCE_BASELINE[`${skillKey}:${actionType}`];
  if (exact) return exact;
  return BASELINE_DEFAULT;
}

// Short tooltip explaining the basis of a chip. `wasDowngraded` flips the
// copy to mention the self-rating fired.
export function describeConfidence(level, { actionType, wasDowngraded } = {}) {
  const lvl = normalizeConfidence(level);
  if (wasDowngraded) {
    return "The worker self-rated this run and flagged uncertainty — review before acting on it.";
  }
  if (lvl === "high") {
    if (actionType === "draft_memo" || actionType === "summarize_week") {
      return "Summarising and drafting prose is in the model's sweet spot.";
    }
    return "This kind of task is in the model's sweet spot.";
  }
  if (lvl === "low") {
    if (actionType === "quick_research") {
      return "Cross-source research can be wrong — verify the facts.";
    }
    if (actionType === "draft_tasks") {
      return "Multi-step planning under constraints — review the schedule.";
    }
    return "LLMs are unreliable on this kind of task — review carefully.";
  }
  return "Decent baseline for this task — skim, then trust your gut.";
}

// E · Live preview + rating ----------------------------------------------
//
// Feedback is stored as worker_memories rows with source 'feedback_positive',
// 'feedback_negative', or 'feedback_correction'. This way feedback ALSO gets
// auto-injected into the worker's system prompt on the next office run (via
// formatWorkerMemoryBlock), closing the loop F + E together.

const FEEDBACK_SOURCES = new Set(["feedback_positive", "feedback_negative", "feedback_correction"]);

function feedbackKindToSource(kind) {
  if (kind === "positive") return "feedback_positive";
  if (kind === "negative") return "feedback_negative";
  if (kind === "correction") return "feedback_correction";
  return null;
}

function sourceToFeedbackKind(source) {
  if (source === "feedback_positive") return "positive";
  if (source === "feedback_negative") return "negative";
  if (source === "feedback_correction") return "correction";
  return null;
}

export async function recordJobFeedback(uid, jobId, { kind, note = "" } = {}) {
  if (!uid) throw new Error("uid required");
  if (!Number.isInteger(jobId)) throw new Error("jobId required");
  const source = feedbackKindToSource(kind);
  if (!source) throw new Error("invalid kind");
  if (kind === "correction" && !note.trim()) {
    throw new Error("correction note required");
  }
  // Verify job belongs to this user.
  const [job] = await db.select().from(officeJobs)
    .where(and(eq(officeJobs.id, jobId), eq(officeJobs.uid, uid)));
  if (!job) throw new Error("job not found");

  // Replace any existing feedback for this job (one feedback per job).
  await db.delete(workerMemories).where(and(
    eq(workerMemories.uid, uid),
    eq(workerMemories.jobId, jobId),
    inArray(workerMemories.source, ["feedback_positive", "feedback_negative", "feedback_correction"]),
  ));

  const skillInfo = await resolveSkillInfo(uid, job.skillKey);
  const dateStr = new Date(job.createdAt).toISOString().slice(0, 10);
  const actionLabel = job.actionType;
  let content;
  if (kind === "positive") {
    content = `User liked your "${actionLabel}" on ${dateStr} — keep this approach when ${skillInfo.label} is asked again.`;
  } else if (kind === "negative") {
    content = `User disliked your "${actionLabel}" on ${dateStr} — avoid this approach next time.`;
  } else {
    content = `User correction on "${actionLabel}" (${dateStr}): ${note.trim().slice(0, 400)}`;
  }
  const [row] = await db.insert(workerMemories).values({
    uid, skillKey: job.skillKey, content, source, jobId,
  }).returning();
  return row;
}

// Map of jobId → feedback kind ('positive' | 'negative' | 'correction') for
// every office job this user has rated. Used by the UI to show the active
// rating button on each row.
// Extract the raw user-typed note out of a correction memory's templated
// content. Memory content is `User correction on "<label>" (<date>): <note>`
// so we split on the first occurrence of `): `. Returns "" if not parseable.
function extractCorrectionNote(content) {
  if (typeof content !== "string") return "";
  const i = content.indexOf("): ");
  if (i < 0) return "";
  return content.slice(i + 3).trim();
}

export async function listJobFeedbackForUser(uid, { limit = 500 } = {}) {
  if (!uid) return {};
  const rows = await db.select({
    jobId: workerMemories.jobId,
    source: workerMemories.source,
    content: workerMemories.content,
  }).from(workerMemories)
    .where(and(
      eq(workerMemories.uid, uid),
      inArray(workerMemories.source, ["feedback_positive", "feedback_negative", "feedback_correction"]),
    ))
    .orderBy(desc(workerMemories.createdAt))
    .limit(Math.max(1, Math.min(limit, 2000)));
  const out = {};
  for (const r of rows) {
    if (r.jobId == null) continue;
    if (out[r.jobId]) continue; // most recent wins (orderBy desc)
    const kind = sourceToFeedbackKind(r.source);
    if (!kind) continue;
    // For correction, expose the raw user-typed note (not the templated
    // sentence) so the UI can show / edit it cleanly.
    const note = kind === "correction" ? extractCorrectionNote(r.content) : "";
    out[r.jobId] = { kind, note };
  }
  return out;
}
