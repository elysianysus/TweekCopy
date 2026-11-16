// In-process worker for Muse Office quick-action jobs.
//
// Jobs are persisted in `office_jobs` and executed via the SHARED Muse
// pipeline (`runMuseTurnNonStreaming` in ./museShared.js) so the office
// worker uses the exact same skill prompts, memory injection, provider
// routing, and `draft task:` / `draft memo:` parser as /api/muse/chat.
//
// Concurrency: cap MAX_GLOBAL jobs in flight; one job per (uid, skillKey)
// at a time so a long "draft tasks for tomorrow" by the *Planner* doesn't
// block the same user's *Brainstorm* job from running in parallel.

import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./db.js";
import {
  officeJobs,
  museConversations,
  museMessages,
  memos,
  memoTags,
} from "./schema.js";
import { runMuseTurnNonStreaming, __testHooks as museTestHooks, getProvider } from "./museShared.js";
import {
  listWorkerMemoriesForUser,
  addWorkerMemoryForUser,
  formatWorkerMemoryBlock,
  pickReactingWorker,
  resolveSkillInfo,
  BUILT_IN_SKILL_INFO,
  getBaselineConfidence,
  downgradeConfidence,
  normalizeConfidence,
  minConfidence,
  isValidConfidence,
  MANAGER_DELEGATE_SKILLS,
} from "./officeSkills.js";

// Probability that a successful action triggers a one-shot reaction job
// from a paired worker. Tunable via env so we can quiet things down if it
// gets noisy.
const REACTION_PROBABILITY = Math.max(0, Math.min(1,
  parseFloat(process.env.OFFICE_REACTION_PROBABILITY || "0.35"),
));

const MAX_GLOBAL = Math.max(1, parseInt(process.env.OFFICE_JOBS_MAX_GLOBAL || "3", 10));
const POLL_MS = 1500;

const inflight = new Set();
// Per (uid, skillKey) inflight count — different skills for the same user
// run concurrently up to MAX_GLOBAL.
const inflightByUserSkill = new Map();
let pollTimer = null;
let started = false;
let draining = false;

const stats = {
  startedAt: null,
  attempted: 0,
  succeeded: 0,
  failed: 0,
  lastErrorMessage: null,
  lastErrorAt: null,
};

const userSkillKey = (uid, skillKey) => `${uid}|${skillKey}`;

export const ACTION_TYPES = {
  draft_tasks: {
    label: "Draft tasks for tomorrow",
    instruction: (arg) =>
      `Draft 3-5 concrete tasks for tomorrow${arg ? ` related to: ${arg}` : ""}. ` +
      `Use the \`draft task: YYYY-MM-DD HH:MM Task name\` command for each one (you can ` +
      `omit the date and time). Add one short sentence after the tasks explaining your reasoning.`,
  },
  summarize_week: {
    label: "Summarize this week's memos",
    instruction: (arg) =>
      `Summarize this past week's notes and progress${arg ? ` (focus: ${arg})` : ""} ` +
      `in 4-6 short bullets. Then suggest one tiny next step.`,
  },
  quick_research: {
    label: "Quick research",
    instruction: (arg) =>
      `Give a tight 5-bullet briefing on: ${arg || "(no topic given — ask the user for one)"}. ` +
      `Cover what it is, why it matters, the main trade-offs, who to follow, and one open question.`,
  },
  draft_memo: {
    label: "Draft a memo",
    instruction: (arg) =>
      `Draft a memo about: ${arg || "(open prompt — pick something useful)"}. ` +
      `When finished, emit a single line beginning with \`draft memo: <title> — <body>\` ` +
      `so the planner saves it.`,
  },
  // Single-shot Spec Builder. Skips the interview and emits the full
  // structured spec immediately so it can be chained inside Manager
  // templates or fired as a quick action on the Spec Builder worker.
  draft_spec: {
    label: "Draft a spec",
    instruction: (arg) =>
      `Take this fuzzy idea and produce a complete drop-in spec WITHOUT ` +
      `interviewing the user — pick reasonable defaults for any unknowns. ` +
      `Idea: ${arg || "(open prompt — invent a small useful spec)"}. ` +
      `Output the spec EXACTLY in the format:\n` +
      `<!-- WRAPUP -->\n# <Title>\n\n## What & Why\n…\n\n## Done looks like\n- …\n\n## Out of scope\n- …\n\n## Notes for the implementing agent\n- …\n\n` +
      `Begin with the \`<!-- WRAPUP -->\` marker on its own line. No preamble, no questions.`,
  },
  // Internal action used only for auto-fired reactions from paired workers.
  // The runJob branch for kind === 'reaction' supplies the actual prompt
  // (which references the parent job's result), so this instruction is just
  // a fallback shown in UI labels. Marked `internal: true` so the public
  // /api/office/action-types route filters it out.
  reaction: {
    label: "Reaction",
    instruction: () => "React in 1–2 sentences to your colleague's recent work.",
    internal: true,
  },
  // C1 · Manager-only multi-step orchestration. The Manager AI plans 2–4
  // subtasks, dispatches each to a specialist worker (kind='subtask',
  // parent_job_id=manager.id), parks itself at status='waiting', and is
  // re-picked-up by maybeAggregateManager() when all children finish, which
  // runs the Phase B aggregation turn and writes the final summary.
  delegate: {
    label: "Plan & delegate",
    instruction: (arg) =>
      `As the team Manager, plan 2–4 subtasks for: ${arg || "(open goal — pick something useful for the user)"}. ` +
      `Reply with one short paragraph plan followed by the JSON subtasks block (see your system prompt).`,
    restrictedTo: ["manager"],
  },
};

// Subset of ACTION_TYPES safe to expose to end-users via the UI / API.
export const PUBLIC_ACTION_TYPES = Object.fromEntries(
  Object.entries(ACTION_TYPES).filter(([, def]) => !def.internal),
);

export function isValidActionType(t) {
  // Internal action types (e.g. 'reaction') are never user-pickable.
  if (!Object.prototype.hasOwnProperty.call(ACTION_TYPES, t)) return false;
  return !ACTION_TYPES[t]?.internal;
}

export function getActionLabel(t) {
  return ACTION_TYPES[t]?.label || t;
}

export function getOfficeStats() {
  return {
    startedAt: stats.startedAt,
    attempted: stats.attempted,
    succeeded: stats.succeeded,
    failed: stats.failed,
    lastErrorMessage: stats.lastErrorMessage,
    lastErrorAt: stats.lastErrorAt,
    inflight: inflight.size,
    capacity: { global: MAX_GLOBAL },
  };
}

// Per-skillKey breakdown of jobs over the last `hours` window. Returns an
// array of { skillKey, queued, running, done, failed, lastErrorMessage,
// lastErrorAt }. Used by the admin health endpoint so operators can spot
// which workers are queuing up or failing repeatedly.
export async function getOfficeSkillBreakdown({ hours = 24 } = {}) {
  const windowHours = Math.min(Math.max(1, Number(hours) || 24), 24 * 30);
  const since = new Date(Date.now() - windowHours * 3600 * 1000);

  const counts = await db
    .select({
      skillKey: officeJobs.skillKey,
      status: officeJobs.status,
      cnt: sql`count(*)::int`.as("cnt"),
    })
    .from(officeJobs)
    .where(gte(officeJobs.createdAt, since))
    .groupBy(officeJobs.skillKey, officeJobs.status);

  const errorRows = await db
    .select({
      skillKey: officeJobs.skillKey,
      errorMessage: officeJobs.errorMessage,
      finishedAt: officeJobs.finishedAt,
    })
    .from(officeJobs)
    .where(and(eq(officeJobs.status, "failed"), gte(officeJobs.createdAt, since)))
    .orderBy(desc(officeJobs.finishedAt));

  const map = new Map();
  const ensure = (key) => {
    let e = map.get(key);
    if (!e) {
      e = {
        skillKey: key,
        queued: 0,
        running: 0,
        done: 0,
        failed: 0,
        total: 0,
        lastErrorMessage: null,
        lastErrorAt: null,
      };
      map.set(key, e);
    }
    return e;
  };

  for (const r of counts) {
    const e = ensure(r.skillKey);
    if (r.status === "queued") e.queued = r.cnt;
    else if (r.status === "running") e.running = r.cnt;
    else if (r.status === "done") e.done = r.cnt;
    else if (r.status === "failed") e.failed = r.cnt;
    e.total += r.cnt;
  }
  // errorRows is ordered by finishedAt desc, so the first row per skillKey
  // is the most recent failure. Track which skills we've filled so an empty
  // errorMessage on the most-recent row doesn't get overwritten by an older
  // non-empty one (preserves strict recency).
  const filledLastError = new Set();
  for (const er of errorRows) {
    const e = map.get(er.skillKey);
    if (e && !filledLastError.has(er.skillKey)) {
      e.lastErrorMessage = er.errorMessage || null;
      e.lastErrorAt = er.finishedAt || null;
      filledLastError.add(er.skillKey);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export async function recoverInterruptedOfficeJobs() {
  // 1) Fail any in-flight jobs (queued is included so a restart while
  //    nothing was running still clears stale rows from the worker view).
  const result = await db
    .update(officeJobs)
    .set({
      status: "failed",
      errorMessage: "interrupted by restart",
      finishedAt: new Date(),
    })
    .where(inArray(officeJobs.status, ["queued", "running"]))
    .returning({ id: officeJobs.id });
  if (result.length) {
    console.log(`[office] recovered ${result.length} interrupted job(s)`);
  }
  // 2) Any 'waiting' managers whose children are now all terminal would
  //    otherwise sit forever (the only trigger is a child finishing via
  //    runJob). Kick aggregation for each so they finalize on the next tick.
  const stuckParents = await db
    .selectDistinct({ id: officeJobs.parentJobId })
    .from(officeJobs)
    .where(and(eq(officeJobs.kind, "subtask"), inArray(officeJobs.status, ["done", "failed"])));
  for (const row of stuckParents) {
    if (row.id != null) dispatchSubtaskCompletion(row.id).catch(() => {});
  }
  return result.length;
}

export function startOfficeJobsWorker() {
  if (started) return;
  started = true;
  stats.startedAt = new Date();
  pollTimer = setInterval(() => { drain().catch(() => {}); }, POLL_MS);
  if (typeof pollTimer.unref === "function") pollTimer.unref();
  drain().catch(() => {});
}

export function stopOfficeJobsWorker() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  started = false;
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (inflight.size < MAX_GLOBAL) {
      const free = MAX_GLOBAL - inflight.size;
      const candidates = await db
        .select()
        .from(officeJobs)
        .where(eq(officeJobs.status, "queued"))
        .orderBy(asc(officeJobs.createdAt))
        .limit(free * 4);
      let claimedAny = false;
      for (const row of candidates) {
        if (inflight.size >= MAX_GLOBAL) break;
        if (inflight.has(row.id)) continue;
        // Per (uid, skillKey) cap of 1 — different skills for the same
        // user can still run concurrently up to MAX_GLOBAL.
        const key = userSkillKey(row.uid, row.skillKey);
        if ((inflightByUserSkill.get(key) || 0) >= 1) continue;
        const claimed = await db
          .update(officeJobs)
          .set({ status: "running", startedAt: new Date() })
          .where(and(eq(officeJobs.id, row.id), eq(officeJobs.status, "queued")))
          .returning({ id: officeJobs.id });
        if (!claimed.length) continue;
        inflight.add(row.id);
        inflightByUserSkill.set(key, (inflightByUserSkill.get(key) || 0) + 1);
        claimedAny = true;
        runJob(row).catch(() => {}).finally(() => {
          inflight.delete(row.id);
          const cur = inflightByUserSkill.get(key) || 1;
          if (cur <= 1) inflightByUserSkill.delete(key);
          else inflightByUserSkill.set(key, cur - 1);
        });
      }
      if (!claimedAny) break;
    }
  } finally {
    draining = false;
  }
}

async function getOrCreateOfficeConversation(uid, skillKey) {
  const title = `Office · ${skillKey}`;
  const existing = await db
    .select()
    .from(museConversations)
    .where(and(eq(museConversations.uid, uid), eq(museConversations.title, title)))
    .limit(1);
  if (existing.length) return existing[0];
  const [created] = await db
    .insert(museConversations)
    .values({ uid, title })
    .returning();
  return created;
}

// Re-export the shared LLM hook so existing tests that stub
// `office.__testHooks.llm` keep working AND any direct stub of
// `museShared.__testHooks.llm` is also honoured. Both point at the
// same object on the shared module.
export const __testHooks = museTestHooks;

async function runJob(row) {
  stats.attempted += 1;
  try {
    const isReaction = row.kind === "reaction";
    const isSubtask  = row.kind === "subtask";
    const isDelegate = !isReaction && !isSubtask && row.actionType === "delegate";

    // Build the user-visible instruction + LLM message. For reactions we
    // load the parent job's result so the reacting worker has something
    // concrete to comment on.
    let labeledMessage;
    let actionLabel;
    if (isDelegate) {
      const goal = (row.argument || "").trim() || "(no explicit goal — propose a small useful plan for today)";
      actionLabel = "Plan & delegate";
      labeledMessage =
        `[Office · Plan & delegate] Goal: ${goal}\n\n` +
        `Plan 2–4 subtasks and emit the JSON \`subtasks\` block exactly as ` +
        `described in your system prompt. Pick the right specialist worker for ` +
        `each piece. Do NOT do the work yourself in this turn.`;
    } else if (isReaction) {
      const parentId = row.parentJobId;
      const [parent] = parentId ? await db.select().from(officeJobs)
        .where(eq(officeJobs.id, parentId)) : [];
      if (!parent || !parent.result) {
        // Nothing to react to — mark done with an empty result.
        await db.update(officeJobs).set({
          status: "done", result: "", finishedAt: new Date(),
        }).where(eq(officeJobs.id, row.id));
        stats.succeeded += 1;
        return;
      }
      const [parentInfo, myInfo] = await Promise.all([
        resolveSkillInfo(row.uid, parent.skillKey),
        resolveSkillInfo(row.uid, row.skillKey),
      ]);
      const parentResult = (parent.result || "").slice(0, 1200);
      actionLabel = "Reaction";
      labeledMessage =
        `[Office · Reaction] Your colleague ${parentInfo.label} just delivered the ` +
        `following piece of work for ${ACTION_TYPES[parent.actionType]?.label || parent.actionType}. ` +
        `As ${myInfo.label}, react in EXACTLY 1–2 sentences with a useful comment, ` +
        `disagreement, or compliment from your perspective. No greeting, no caveats, no ` +
        `bullet list. Plain prose.\n\n--- ${parentInfo.label}'s work ---\n${parentResult}`;
    } else {
      const action = ACTION_TYPES[row.actionType];
      if (!action) throw new Error(`unknown action: ${row.actionType}`);
      const userInstruction = action.instruction(row.argument || "");
      actionLabel = action.label;
      labeledMessage =
        `[Office · ${action.label}]${row.argument ? ` ${row.argument}` : ""}\n\n${userInstruction}`;
    }

    const convo = await getOrCreateOfficeConversation(row.uid, row.skillKey);

    // F · Per-worker long-term memory injection. Pull recent memories for
    // (uid, skillKey) and append them to the system prompt so the worker
    // remembers prior context across sessions.
    let extraSystemContext = "";
    try {
      const mems = await listWorkerMemoriesForUser(row.uid, row.skillKey, { limit: 8 });
      extraSystemContext = formatWorkerMemoryBlock(mems);
    } catch { /* non-fatal */ }

    const { text, assistantMessage } = await runMuseTurnNonStreaming({
      uid: row.uid,
      conversationId: convo.id,
      message: labeledMessage,
      skill: row.skillKey,
      // Office quick actions intentionally use a fast/cheap default; the
      // user can still chat the same skill at any model in MuseView.
      model: "gpt-4o-mini",
      // Reactions and the delegate Phase A turn are commentary / planning,
      // not draft commands.
      parseOutputDrafts: !isReaction && !isDelegate,
      extraSystemContext,
    });

    // C1 Phase A — manager dispatches subtasks and parks itself at 'waiting'.
    if (isDelegate) {
      const parsed = parseManagerSubtasks(text);
      const valid = parsed.filter(s =>
        s && typeof s.skillKey === "string" &&
        MANAGER_DELEGATE_SKILLS.includes(s.skillKey) &&
        isValidActionType(s.actionType) && s.actionType !== "delegate"
      ).slice(0, 6);
      if (!valid.length) {
        // Nothing usable parsed — finish like a regular action. Grade the
        // confidence too so this surface stays consistent with normal
        // action runs (otherwise the chip would default to medium on read).
        const baseline = getBaselineConfidence(row.skillKey, row.actionType);
        const confidence = await gradeJobConfidence({ row, baseline, text });
        await db.update(officeJobs).set({
          status: "done",
          result: text || "(no subtasks parsed)",
          conversationId: convo.id,
          assistantMessageId: assistantMessage?.id || null,
          confidence,
          finishedAt: new Date(),
        }).where(eq(officeJobs.id, row.id));
        stats.succeeded += 1;
        return;
      }
      await db.insert(officeJobs).values(valid.map(s => ({
        uid: row.uid,
        skillKey: s.skillKey,
        actionType: s.actionType,
        argument: (s.argument || "").toString().slice(0, 2000),
        status: "queued",
        kind: "subtask",
        parentJobId: row.id,
      })));
      await db.update(officeJobs).set({
        status: "waiting",
        result: text,
        conversationId: convo.id,
        assistantMessageId: assistantMessage?.id || null,
        // Note: do NOT set finishedAt — manager is parked, not finished.
      }).where(eq(officeJobs.id, row.id));
      stats.succeeded += 1;
      drain().catch(() => {});
      return;
    }

    // Compute confidence for this finished row.
    //   - Reactions inherit the parent's confidence (no extra LLM call).
    //   - All other action/subtask rows get the static baseline, optionally
    //     downgraded by a tiny self-rating LLM call (skipped when baseline
    //     is already 'low', when text is empty, or when the kill switch is
    //     on via OFFICE_CONFIDENCE_DISABLED=1).
    let confidence;
    if (isReaction) {
      confidence = await inheritReactionConfidence(row);
    } else {
      const baseline = getBaselineConfidence(row.skillKey, row.actionType);
      confidence = await gradeJobConfidence({ row, baseline, text });
    }

    await db.update(officeJobs).set({
      status: "done",
      result: text,
      conversationId: convo.id,
      assistantMessageId: assistantMessage?.id || null,
      confidence,
      finishedAt: new Date(),
    }).where(eq(officeJobs.id, row.id));
    stats.succeeded += 1;

    // Post-success side effects.
    if (!isReaction && !isSubtask) {
      // F · Auto-write one short memory line distilled from the result.
      writeAutoMemoryFromResult(row, text).catch(() => {});
      // D · Maybe trigger a one-shot reaction from a paired worker.
      maybeEnqueueReaction(row).catch(() => {});
    }
    // Subtask finished — route to the right parent completion handler
    // (template chain advance OR manager LLM aggregation).
    if (isSubtask && row.parentJobId) {
      dispatchSubtaskCompletion(row.parentJobId).catch(() => {});
    }
  } catch (err) {
    stats.failed += 1;
    stats.lastErrorMessage = err.message;
    stats.lastErrorAt = new Date();
    await db.update(officeJobs).set({
      status: "failed",
      errorMessage: err.message,
      finishedAt: new Date(),
    }).where(eq(officeJobs.id, row.id));
    // Failed subtask still releases the parent (template fails the chain;
    // manager-delegate aggregates with whatever we have) — never deadlock
    // a 'waiting' parent.
    if (row.kind === "subtask" && row.parentJobId) {
      dispatchSubtaskCompletion(row.parentJobId).catch(() => {});
    }
  }
}

// C2 · Multi-step plan templates. Sequential chains where each step's output
// is fed to the next as context. Triggered via POST /api/office/jobs with
// actionType = `template:<key>`. The parent row sits at status='waiting',
// kind='action', actionType='template', skillKey='manager' (used as the
// container worker), with argument = JSON {templateKey, userInput}. Each
// step runs as a normal kind='subtask' child; when the last child finishes,
// `advanceTemplateChain()` folds the chain into a single done parent row —
// no LLM aggregation needed (the last step is the deliverable).
export const OFFICE_TEMPLATES = {
  weeklyPrepKit: {
    label: "Weekly Prep Kit",
    desc: "Planner drafts the week → Writer drafts a kickoff memo",
    steps: [
      { skillKey: "planner", actionType: "draft_tasks",
        buildArgument: ({ userInput }) => userInput || "the upcoming week" },
      { skillKey: "writer", actionType: "draft_memo",
        buildArgument: ({ userInput, prevResult }) =>
          `Kickoff memo "Week ahead${userInput ? ": " + userInput : ""}". ` +
          `Reference these planned items:\n\n${(prevResult || "").slice(0, 800)}` },
    ],
  },
  ideaPressureTest: {
    label: "Idea Pressure Test",
    desc: "Brainstorm → Grill Me → Writer (final brief)",
    steps: [
      { skillKey: "brainstorm", actionType: "draft_memo",
        buildArgument: ({ userInput }) =>
          `Brainstorm 5–7 angles on: ${userInput || "an open product idea"}.` },
      { skillKey: "grillMe", actionType: "draft_memo",
        buildArgument: ({ prevResult }) =>
          `Stress-test these angles in ONE sharp question + your "My take":\n\n${(prevResult || "").slice(0, 800)}` },
      { skillKey: "writer", actionType: "draft_memo",
        buildArgument: ({ userInput, prevResult }) =>
          `One-page brief titled "${userInput || "Idea brief"}". Synthesize the brainstorm and grill below into the final recommendation:\n\n${(prevResult || "").slice(0, 800)}` },
    ],
  },
  // Idea → Spec → Save. Brainstorm widens the fuzzy idea, Spec Builder
  // converges it into a structured wrap-up, and the chain finalizer
  // auto-saves the spec as a memo tagged `#spec` + a slug derived from
  // the spec title (mirrors MuseView's "Save as memo" path so users get
  // a paste-ready spec memo without touching MuseView).
  ideaToSpec: {
    label: "Idea → Spec → Save",
    desc: "Brainstorm widens it → Spec Builder converges → auto-saved as a #spec memo",
    autoSaveSpec: true,
    steps: [
      { skillKey: "brainstorm", actionType: "draft_memo",
        buildArgument: ({ userInput }) =>
          `Brainstorm 5–7 angles on this idea: ${userInput || "an open product idea"}. ` +
          `Cover scope, risks, alternative shapes, and what "done" might look like. Keep it tight.` },
      { skillKey: "specBuilder", actionType: "draft_spec",
        buildArgument: ({ userInput, prevResult }) =>
          `${userInput || "(open prompt — invent a small useful spec)"}\n\n` +
          `Use the brainstorm below to inform reasonable defaults:\n\n${(prevResult || "").slice(0, 800)}` },
    ],
  },
  dailyStandup: {
    label: "Daily Standup",
    desc: "Planner drafts today → Writer drafts a standup memo",
    steps: [
      { skillKey: "planner", actionType: "draft_tasks",
        buildArgument: ({ userInput }) => userInput || "today" },
      { skillKey: "writer", actionType: "draft_memo",
        buildArgument: ({ prevResult }) =>
          `Standup memo "Today's plan". Reference:\n\n${(prevResult || "").slice(0, 800)}` },
    ],
  },
};

export function listOfficeTemplates() {
  return Object.entries(OFFICE_TEMPLATES).map(([key, t]) => ({
    key,
    label: t.label,
    desc: t.desc,
    steps: t.steps.map(s => ({ skillKey: s.skillKey, actionType: s.actionType })),
  }));
}

export function isValidTemplateKey(key) {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(OFFICE_TEMPLATES, key);
}

export async function startOfficeTemplate({ uid, templateKey, userInput }) {
  if (!uid) throw new Error("uid required");
  if (!isValidTemplateKey(templateKey)) throw new Error(`unknown template: ${templateKey}`);
  const parentArgument = JSON.stringify({ templateKey, userInput: (userInput || "").toString().slice(0, 1500) });
  const [parent] = await db.insert(officeJobs).values({
    uid,
    skillKey: "manager",
    actionType: "template",
    argument: parentArgument,
    status: "waiting",
    kind: "action",
  }).returning();
  await enqueueTemplateStep(parent, 0, "");
  drain().catch(() => {});
  return parent;
}

async function enqueueTemplateStep(parent, stepIndex, prevResult) {
  let parsed;
  try { parsed = JSON.parse(parent.argument || "{}"); } catch { parsed = {}; }
  const template = OFFICE_TEMPLATES[parsed.templateKey];
  if (!template) return;
  const step = template.steps[stepIndex];
  if (!step) return;
  let arg = "";
  try { arg = step.buildArgument({ userInput: parsed.userInput || "", prevResult: prevResult || "" }) || ""; }
  catch { arg = parsed.userInput || ""; }
  await db.insert(officeJobs).values({
    uid: parent.uid,
    skillKey: step.skillKey,
    actionType: step.actionType,
    argument: arg.toString().slice(0, 2000),
    status: "queued",
    kind: "subtask",
    parentJobId: parent.id,
  });
}

// Per-parent in-process guard to short-circuit obvious double-fires before
// they hit the DB. The DB atomic claim below is the authoritative cross-
// process lock; this is just a fast-path latency optimization.
const advancing = new Set();

async function advanceTemplateChain(parentId) {
  if (!parentId || advancing.has(parentId)) return;
  advancing.add(parentId);
  try {
    // Atomic CAS: waiting → running. Only ONE concurrent caller wins; the
    // others see no claimed row and bail out. We hold the 'running' lock
    // while we decide what to do, then either release back to 'waiting'
    // (next step) or finalize the parent (done/failed) — both one-way
    // transitions guarded against stale overwrites.
    const claimed = await db.update(officeJobs)
      .set({ status: "running", startedAt: sql`COALESCE(${officeJobs.startedAt}, NOW())` })
      .where(and(
        eq(officeJobs.id, parentId),
        eq(officeJobs.status, "waiting"),
        eq(officeJobs.actionType, "template"),
      ))
      .returning();
    if (!claimed.length) return;
    const parent = claimed[0];

    let parsed;
    try { parsed = JSON.parse(parent.argument || "{}"); } catch { parsed = {}; }
    const template = OFFICE_TEMPLATES[parsed.templateKey];
    if (!template) {
      await db.update(officeJobs).set({
        status: "failed",
        errorMessage: `unknown template: ${parsed.templateKey}`,
        finishedAt: new Date(),
      }).where(and(eq(officeJobs.id, parentId), eq(officeJobs.status, "running")));
      return;
    }
    const children = await db.select().from(officeJobs)
      .where(and(eq(officeJobs.parentJobId, parentId), eq(officeJobs.kind, "subtask")))
      .orderBy(asc(officeJobs.createdAt));
    // Some step still in flight — release the lock back to 'waiting' and
    // let the next child completion re-trigger us.
    if (children.some(c => c.status !== "done" && c.status !== "failed")) {
      await db.update(officeJobs).set({ status: "waiting" })
        .where(and(eq(officeJobs.id, parentId), eq(officeJobs.status, "running")));
      return;
    }
    const last = children[children.length - 1];
    // Fail-fast: most recent step failed → fail the whole chain rather than
    // feeding garbage to the next worker.
    if (last && last.status === "failed") {
      await db.update(officeJobs).set({
        status: "failed",
        errorMessage: `chain step ${children.length}/${template.steps.length} failed: ${last.errorMessage || "unknown"}`,
        finishedAt: new Date(),
      }).where(and(eq(officeJobs.id, parentId), eq(officeJobs.status, "running")));
      return;
    }
    // More steps to run — enqueue the next subtask FIRST (so it's safely
    // recorded), then release the lock. Any late completion that fires in
    // this tiny window will lose the CAS and bail; the next-step's own
    // completion will re-fire us.
    if (children.length < template.steps.length) {
      await enqueueTemplateStep(parent, children.length, last ? last.result || "" : "");
      await db.update(officeJobs).set({ status: "waiting" })
        .where(and(eq(officeJobs.id, parentId), eq(officeJobs.status, "running")));
      drain().catch(() => {});
      return;
    }
    // All steps done — fold the chain into one done row whose result is a
    // breadcrumb + the final step's deliverable. No LLM call needed.
    const breadcrumbs = template.steps.map((s, i) => {
      const c = children[i];
      const info = BUILT_IN_SKILL_INFO[s.skillKey] || { label: s.skillKey };
      const actionLbl = ACTION_TYPES[s.actionType]?.label || s.actionType;
      const status = c.status === "done" ? "✓" : "✗";
      return `${i + 1}. ${status} **${info.label}** · ${actionLbl}`;
    }).join("\n");
    const lastInfo = BUILT_IN_SKILL_INFO[last.skillKey] || { label: last.skillKey };
    const finalText =
      `**${template.label}** — chain complete.\n\n${breadcrumbs}\n\n` +
      `--- Final output (${lastInfo.label}) ---\n\n` +
      (last.result || "(empty)");
    // Template confidence = min of all children (a single shaky step poisons
    // the whole chain).
    const childConfidence = minConfidence(children.map(c => c.confidence));
    // Idea-to-spec style templates auto-save the final spec as a memo
    // (mirrors MuseView's "Save as memo" path: title from the `# Title`
    // line, tags = ['spec', <slug>]). Best-effort; failures don't poison
    // the chain. Run BEFORE finalizing so we can mention the saved memo
    // in the parent's result breadcrumb.
    let autoSavedMemo = null;
    if (template.autoSaveSpec && last && last.status === "done") {
      try {
        autoSavedMemo = await autoSaveSpecMemo({ uid: parent.uid, text: last.result || "" });
      } catch (e) {
        // Surface the failure in logs but don't fail the chain.
        console.error("[office] ideaToSpec auto-save failed:", e?.message || e);
      }
    }
    const savedLine = autoSavedMemo
      ? `\n\n📝 Saved as memo **${autoSavedMemo.title}** (id ${autoSavedMemo.id}, tags: ${autoSavedMemo.tags.map(t => "#" + t).join(" ")})`
      : "";
    await db.update(officeJobs).set({
      status: "done",
      result: finalText + savedLine,
      confidence: childConfidence,
      finishedAt: new Date(),
    }).where(and(eq(officeJobs.id, parentId), eq(officeJobs.status, "running")));
    writeAutoMemoryFromResult(parent, finalText).catch(() => {});
  } finally {
    advancing.delete(parentId);
  }
}

// Server-side mirror of `src/lib/wrapup.js#slugifyTitle` — keep in sync.
function slugifyTitleForTag(title) {
  if (!title || typeof title !== "string") return "";
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// Pull the spec title out of a draft_spec wrap-up. The Spec Builder always
// emits `<!-- WRAPUP -->\n# <Title>\n\n## What & Why...`, so we just look
// for the first `# ` heading line. Falls back to "Spec".
function extractSpecTitle(text) {
  if (!text || typeof text !== "string") return "Spec";
  const cleaned = text.replace(/<!--\s*WRAPUP\s*-->/gi, "").trim();
  const m = cleaned.match(/^#\s+(.+?)\s*$/m);
  if (!m || !m[1]) return "Spec";
  const t = m[1].trim().replace(/^[<](.+)[>]$/, "$1").trim();
  if (!t) return "Spec";
  return t.length > 80 ? t.slice(0, 80) + "…" : t;
}

// Strip the invisible <!-- WRAPUP --> marker before persisting the memo
// (matches MuseView's createMemo payload — the marker is a UI signal, not
// memo content).
function stripWrapupMarker(text) {
  return (text || "").replace(/^\s*<!--\s*WRAPUP\s*-->\s*\n?/i, "")
                     .replace(/<!--\s*WRAPUP\s*-->/gi, "")
                     .trim();
}

// Auto-save a spec wrap-up as a memo with `#spec` + slug tags. Mirrors
// the POST /api/memos path in routes.js so the spec lands the same way as
// when a user clicks "Save as memo" in MuseView. Returns { id, title, tags }
// or null when the text doesn't look like a spec.
async function autoSaveSpecMemo({ uid, text }) {
  const content = stripWrapupMarker(text);
  if (!content) return null;
  const title = extractSpecTitle(text);
  const slug = slugifyTitleForTag(title);
  const tags = slug && slug !== "spec" ? ["spec", slug] : ["spec"];
  const today = new Date().toISOString().slice(0, 10);
  const [memo] = await db.insert(memos).values({
    uid,
    title,
    content,
    date: today,
    color: "white",
  }).returning();
  for (const tag of tags) {
    try { await db.insert(memoTags).values({ memoId: memo.id, tag }); } catch {}
  }
  return { id: memo.id, title: memo.title, tags };
}

// Dispatch a finished/failed subtask to the right parent-completion path.
// Templates advance step-by-step; manager-delegate parents aggregate via LLM
// once all children are terminal.
async function dispatchSubtaskCompletion(parentId) {
  if (!parentId) return;
  const [parent] = await db.select({ actionType: officeJobs.actionType })
    .from(officeJobs).where(eq(officeJobs.id, parentId));
  if (!parent) return;
  if (parent.actionType === "template") {
    await advanceTemplateChain(parentId);
  } else {
    await maybeAggregateManager(parentId);
  }
}

// C1 · Parse the manager AI's reply into [{skillKey, actionType, argument}].
// Accepts a fenced ```json ... ``` block first; falls back to the first JSON
// object containing "subtasks". Returns [] on any parse failure.
function parseManagerSubtasks(text) {
  if (!text) return [];
  // Try a fenced ```json ... ``` block first.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fence) candidates.push(fence[1]);
  // Bare-JSON fallback: walk the string and extract every balanced {...}
  // block whose payload mentions "subtasks". A naive non-greedy regex would
  // stop at the first inner '}' (inside a subtasks item), so we balance
  // braces manually while honouring strings + escapes.
  const idx = text.indexOf('"subtasks"');
  if (idx >= 0) {
    let start = -1;
    for (let i = idx; i >= 0; i--) {
      if (text[i] === '{') { start = i; break; }
    }
    if (start >= 0) {
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (esc) { esc = false; continue; }
        if (inStr) {
          if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            candidates.push(text.slice(start, i + 1));
            break;
          }
        }
      }
    }
  }
  for (const raw of candidates) {
    try {
      const obj = JSON.parse(raw);
      if (Array.isArray(obj?.subtasks)) return obj.subtasks;
    } catch { /* try next candidate */ }
  }
  return [];
}

// C1 · Phase B — when all subtasks of a waiting manager have terminated
// (done OR failed), claim the manager atomically (waiting → running), build
// an aggregation prompt that quotes each child's result, and let the manager
// LLM produce a single tied-together summary that becomes the manager's
// final result. In-process aggregating set guards against double-fire from
// concurrent child completions.
const aggregating = new Set();

async function maybeAggregateManager(parentId) {
  if (!parentId || aggregating.has(parentId)) return;
  aggregating.add(parentId);
  try {
    const [parent] = await db.select().from(officeJobs)
      .where(and(eq(officeJobs.id, parentId), eq(officeJobs.status, "waiting")));
    if (!parent) return;
    const children = await db.select().from(officeJobs)
      .where(and(eq(officeJobs.parentJobId, parentId), eq(officeJobs.kind, "subtask")))
      .orderBy(asc(officeJobs.createdAt));
    if (!children.length) return;
    if (children.some(c => c.status !== "done" && c.status !== "failed")) return;

    // Atomic claim: only one drain wins the waiting → running transition.
    const claimed = await db.update(officeJobs)
      .set({ status: "running", startedAt: parent.startedAt || new Date() })
      .where(and(eq(officeJobs.id, parentId), eq(officeJobs.status, "waiting")))
      .returning({ id: officeJobs.id });
    if (!claimed.length) return;

    const blocks = [];
    for (const c of children) {
      const info = await resolveSkillInfo(parent.uid, c.skillKey);
      const actionLbl = ACTION_TYPES[c.actionType]?.label || c.actionType;
      const head = `--- ${info.label} · ${actionLbl}${c.argument ? ` · "${c.argument}"` : ""} ---`;
      const body = c.status === "failed"
        ? `(failed: ${c.errorMessage || "unknown error"})`
        : (c.result || "(empty)").slice(0, 1500);
      blocks.push(`${head}\n${body}`);
    }
    const goal = (parent.argument || "").trim() || "(no explicit goal)";
    const labeledMessage =
      `[Office · Aggregate] Goal: ${goal}\n\n` +
      `Your specialists have just delivered the following pieces of work. ` +
      `Tie them into ONE clean summary for the user per your system prompt.\n\n` +
      blocks.join("\n\n");

    const convo = await getOrCreateOfficeConversation(parent.uid, parent.skillKey);
    let extraSystemContext = "";
    try {
      const mems = await listWorkerMemoriesForUser(parent.uid, parent.skillKey, { limit: 8 });
      extraSystemContext = formatWorkerMemoryBlock(mems);
    } catch { /* non-fatal */ }

    try {
      const { text, assistantMessage } = await runMuseTurnNonStreaming({
        uid: parent.uid,
        conversationId: convo.id,
        message: labeledMessage,
        skill: parent.skillKey,
        model: "gpt-4o-mini",
        // The aggregate turn is a summary, not a draft-task batch.
        parseOutputDrafts: false,
        extraSystemContext,
      });
      // Manager aggregate confidence = MIN of children. Failed children are
      // ignored (they have no signal); if no usable children, fall back to
      // the manager baseline.
      const childLevels = children
        .filter(c => c.status === "done")
        .map(c => normalizeConfidence(c.confidence));
      const aggConfidence = childLevels.length
        ? minConfidence(childLevels)
        : getBaselineConfidence(parent.skillKey, parent.actionType);
      await db.update(officeJobs).set({
        status: "done",
        result: text,
        conversationId: convo.id,
        assistantMessageId: assistantMessage?.id || null,
        confidence: aggConfidence,
        finishedAt: new Date(),
      }).where(eq(officeJobs.id, parentId));
      stats.succeeded += 1;
      writeAutoMemoryFromResult(parent, text).catch(() => {});
    } catch (err) {
      stats.failed += 1;
      stats.lastErrorMessage = err.message;
      stats.lastErrorAt = new Date();
      await db.update(officeJobs).set({
        status: "failed",
        errorMessage: `aggregation: ${err.message}`,
        finishedAt: new Date(),
      }).where(eq(officeJobs.id, parentId));
    }
  } finally {
    aggregating.delete(parentId);
  }
}

// Small LLM call that distils ONE short memory line (<=160 chars) from a
// finished action result. Best-effort: any failure is swallowed. Skipped
// when result is empty/very short.
async function writeAutoMemoryFromResult(row, text) {
  const body = (text || "").trim();
  if (body.length < 80) return; // too short to be worth remembering
  const skillInfo = await resolveSkillInfo(row.uid, row.skillKey);
  const actionLabel = ACTION_TYPES[row.actionType]?.label || row.actionType;
  const prompt =
    `You are summarising a piece of office work into ONE short note (max 160 ` +
    `chars) that the worker should remember about the user across future ` +
    `sessions. Capture a fact, preference, or decision — not the work itself. ` +
    `If nothing memorable, output the single word NONE.\n\n` +
    `Worker: ${skillInfo.label}\nAction: ${actionLabel}\n` +
    `Argument: ${row.argument || "(none)"}\n\n--- Result ---\n${body.slice(0, 1500)}\n\n` +
    `One line memory:`;
  try {
    const model = "gpt-4o-mini";
    const provider = getProvider(model);
    const memoryText = await museTestHooks.llm({
      provider, model,
      chatMessages: [
        { role: "system", content: "You output a single short memorable line, or the word NONE." },
        { role: "user", content: prompt },
      ],
    });
    const cleaned = String(memoryText || "").trim().replace(/^["'`\-•\s]+|["'`\s]+$/g, "");
    if (!cleaned || /^none$/i.test(cleaned)) return;
    await addWorkerMemoryForUser(row.uid, row.skillKey, cleaned.slice(0, 160), {
      source: "auto", jobId: row.id,
    });
  } catch { /* swallow */ }
}

// D · After a successful action, with REACTION_PROBABILITY pick a paired
// worker and enqueue a single 'reaction' kind job. Reactions never chain.
// The DB has a UNIQUE index on parent_job_id so concurrent drains can't
// duplicate-enqueue for the same parent — we use onConflictDoNothing as the
// authoritative guard and treat a no-op insert as "another worker beat us
// to it".
async function maybeEnqueueReaction(parentRow) {
  if (Math.random() > REACTION_PROBABILITY) return;
  const reactor = pickReactingWorker(parentRow.skillKey);
  if (!reactor || reactor === parentRow.skillKey) return;
  // Pre-check: with a PARTIAL unique index (only WHERE kind='reaction'),
  // postgres ON CONFLICT inference can't match without a predicate clause —
  // so onConflictDoNothing() alone won't dedupe. Do an explicit existence
  // check first; the partial unique index is still our last-line guard
  // against the (rare) inter-check race.
  const existing = await db.select({ id: officeJobs.id }).from(officeJobs)
    .where(and(eq(officeJobs.parentJobId, parentRow.id), eq(officeJobs.kind, "reaction")))
    .limit(1);
  if (existing.length) return;
  try {
    const [inserted] = await db.insert(officeJobs).values({
      uid: parentRow.uid,
      skillKey: reactor,
      actionType: "reaction",
      argument: "",
      status: "queued",
      kind: "reaction",
      parentJobId: parentRow.id,
    }).returning({ id: officeJobs.id });
    if (inserted) drain().catch(() => {});
  } catch (err) {
    // Partial unique index hit on race — silently swallow.
    if (!/duplicate key|unique/i.test(String(err?.message))) throw err;
  }
}

export async function enqueueOfficeJob({ uid, skillKey, actionType, argument }) {
  if (!uid) throw new Error("uid required");
  if (!skillKey) throw new Error("skillKey required");
  if (!isValidActionType(actionType)) throw new Error("invalid actionType");
  // 'reaction' is internal — never accept it from the user-facing enqueue path.
  if (actionType === "reaction") throw new Error("invalid actionType");
  const arg = (argument || "").toString().slice(0, 2000);
  const [row] = await db.insert(officeJobs).values({
    uid, skillKey, actionType, argument: arg, status: "queued",
  }).returning();
  // Kick the worker (non-blocking) so the bubble appears quickly.
  drain().catch(() => {});
  return row;
}

export async function listOfficeJobsForUser(uid, { limit = 60 } = {}) {
  if (!uid) return [];
  const rows = await db.select().from(officeJobs)
    .where(eq(officeJobs.uid, uid))
    .orderBy(desc(officeJobs.createdAt))
    .limit(limit);
  // Normalise nullable confidence on read so the UI always has a chip.
  // Only applied to finished rows — queued/running rows show no chip.
  return rows.map(r => (
    r.status === "done" && !isValidConfidence(r.confidence)
      ? { ...r, confidence: "medium" }
      : r
  ));
}

// Per-skill confidence distribution for the admin health page. Counts
// 'done' rows in the last `days` window and returns one entry per skill
// sorted by % low desc (most worrying first).
export async function getOfficeConfidenceBreakdown({ days = 7 } = {}) {
  const windowDays = Math.min(Math.max(1, Number(days) || 7), 90);
  const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000);
  const rows = await db
    .select({
      skillKey: officeJobs.skillKey,
      confidence: officeJobs.confidence,
      cnt: sql`count(*)::int`.as("cnt"),
    })
    .from(officeJobs)
    .where(and(eq(officeJobs.status, "done"), gte(officeJobs.createdAt, since)))
    .groupBy(officeJobs.skillKey, officeJobs.confidence);

  const map = new Map();
  for (const r of rows) {
    let e = map.get(r.skillKey);
    if (!e) {
      e = { skillKey: r.skillKey, high: 0, medium: 0, low: 0, total: 0 };
      map.set(r.skillKey, e);
    }
    const lvl = normalizeConfidence(r.confidence);
    e[lvl] += r.cnt;
    e.total += r.cnt;
  }
  return Array.from(map.values())
    .map(e => ({
      ...e,
      lowPct: e.total ? Math.round((e.low / e.total) * 100) : 0,
    }))
    .sort((a, b) => (b.lowPct - a.lowPct) || (b.total - a.total));
}

// --------------------------------------------------------------------------
// Confidence helpers
// --------------------------------------------------------------------------

// Reactions get the parent's chip — they're a short comment ON top of the
// parent's work, so we don't burn a fresh LLM call. Falls back to the
// reaction's own baseline if the parent is missing/unrated.
async function inheritReactionConfidence(reactionRow) {
  if (!reactionRow?.parentJobId) {
    return getBaselineConfidence(reactionRow.skillKey, reactionRow.actionType);
  }
  const [parent] = await db.select({ confidence: officeJobs.confidence })
    .from(officeJobs)
    .where(eq(officeJobs.id, reactionRow.parentJobId))
    .limit(1);
  return normalizeConfidence(parent?.confidence);
}

// Tiny self-rating LLM call. Asks the worker to grade ITS OWN output as
// likely-correct or shaky, and downgrades the baseline by one level on
// "shaky". Skipped when:
//   * baseline is already 'low' (nowhere to go)
//   * result text is too short to evaluate
//   * env kill switch OFFICE_CONFIDENCE_DISABLED=1 is set
// Any error is swallowed → baseline is returned. Reactions never reach
// here (they go through inheritReactionConfidence).
async function gradeJobConfidence({ row, baseline, text }) {
  const lvl = normalizeConfidence(baseline);
  if (process.env.OFFICE_CONFIDENCE_DISABLED === "1") return lvl;
  if (lvl === "low") return lvl;
  const body = (text || "").trim();
  if (body.length < 80) return lvl;
  try {
    const skillInfo = await resolveSkillInfo(row.uid, row.skillKey);
    const actionLabel = ACTION_TYPES[row.actionType]?.label || row.actionType;
    const model = "gpt-4o-mini";
    const provider = getProvider(model);
    const reply = await museTestHooks.llm({
      provider, model,
      chatMessages: [
        { role: "system", content:
          "You self-rate a piece of work for the user. Output exactly one " +
          "word: OK if the work looks solid and you'd stand behind it, or " +
          "SHAKY if you're guessing, missing context, or it likely contains " +
          "errors the user should double-check. No other output." },
        { role: "user", content:
          `Worker: ${skillInfo.label}\nAction: ${actionLabel}\n` +
          `Argument: ${row.argument || "(none)"}\n\n` +
          `--- Your output ---\n${body.slice(0, 1500)}\n\n` +
          `One word — OK or SHAKY:` },
      ],
    });
    const verdict = String(reply || "").trim().toUpperCase();
    if (verdict.startsWith("SHAKY")) return downgradeConfidence(lvl);
    return lvl;
  } catch {
    return lvl;
  }
}

// Confidence test hooks — exposed on the same `__testHooks` object as the
// shared LLM stub so unit tests can call them directly. Mutating the
// shared object is OK here because tests already swap `__testHooks.llm`.
__testHooks.gradeJobConfidence = gradeJobConfidence;
__testHooks.inheritReactionConfidence = inheritReactionConfidence;
