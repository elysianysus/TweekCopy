// Shared Muse-chat building blocks. Extracted from routes.js so the
// /api/muse/chat route AND the Muse Office quick-action worker use the
// same skill prompts, memory injection, and draft-command parsing —
// guaranteeing identical behavior between live chat and office jobs.

import { db } from "./db.js";
import {
  tasks, customSkills, journalEntries, museMessages, museConversations, memos,
} from "./schema.js";
import { and, eq, asc, gt } from "drizzle-orm";
import { CAREER_STAGES } from "./careerOps.js";
import { searchSimilarMemories, formatMemoryContextBlock } from "./museMemories.js";
import { todayInTz, getNowInTz, userTimezone } from "./timezone.js";
import { users } from "./schema.js";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});
const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});
const geminiAI = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL },
});

export const openaiModels    = ["gpt-4o-mini","gpt-4o","gpt-5-nano","gpt-5-mini","gpt-5","gpt-5.1","gpt-5.2","o3-mini","o4-mini","o3"];
export const anthropicModels = ["claude-haiku-4-5","claude-sonnet-4-6","claude-opus-4-6"];
export const geminiModels    = ["gemini-2.5-flash","gemini-2.5-pro"];

export function getProvider(model) {
  if (anthropicModels.includes(model)) return "anthropic";
  if (geminiModels.includes(model)) return "gemini";
  return "openai";
}

export async function getUserTimezone(uid) {
  if (!uid) return "Asia/Hong_Kong";
  try {
    const [u] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, uid));
    return userTimezone(u);
  } catch {
    return "Asia/Hong_Kong";
  }
}

// --------------------------------------------------------------------------
// Task context shared across all skill prompts.
// --------------------------------------------------------------------------
export async function buildMuseTaskContext(uid, today) {
  const userTasks = await db.select().from(tasks)
    .where(and(eq(tasks.uid, uid), eq(tasks.done, false)));
  const todayTasks = userTasks.filter(t => t.date === today);
  const taskContext = todayTasks.length > 0
    ? `\n\nUser's tasks today:\n${todayTasks.sort((a,b) => (a.startTime||"99:99").localeCompare(b.startTime||"99:99")).map(t => `- ${t.startTime ? t.startTime + " " : ""}${t.name}`).join("\n")}`
    : "\n\nUser has no tasks today.";
  const allTaskContext = `\nTotal pending tasks: ${userTasks.length}`;
  return { userTasks, todayTasks, taskContext, allTaskContext };
}

// Default Spec Builder interview questions. Per-user overrides live in
// users.spec_builder_questions (JSON-encoded array of strings).
export const DEFAULT_SPEC_BUILDER_QUESTIONS = [
  "Target outcome (what does success look like one sentence?)",
  "In-scope (what MUST this thing do?)",
  "Out-of-scope (what is explicitly NOT included?)",
  "Primary user / actor (who triggers it, in what context?)",
  "Key edge cases (what unusual inputs / states matter?)",
  "Failure modes (what should it do when something breaks?)",
  "Success criteria (how will the user verify it's done?)",
  "Dependencies / data sources (what existing systems / tables / APIs are touched?)",
];

// Sanitize a user-supplied spec-builder question list. Returns
// { ok, value, error } where value is a clean array of trimmed strings,
// or null if the user wants to revert to defaults.
export function sanitizeSpecBuilderQuestions(input) {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (!Array.isArray(input)) return { ok: false, error: "Expected an array of strings" };
  const cleaned = [];
  for (const raw of input) {
    if (typeof raw !== "string") return { ok: false, error: "Each question must be a string" };
    const q = raw.trim();
    if (!q) continue;
    if (q.length > 240) return { ok: false, error: "Each question must be 240 characters or fewer" };
    cleaned.push(q);
  }
  if (cleaned.length === 0) return { ok: true, value: null };
  if (cleaned.length > 20) return { ok: false, error: "At most 20 questions allowed" };
  return { ok: true, value: cleaned };
}

// Load the effective Spec Builder question list for a user, falling back
// to DEFAULT_SPEC_BUILDER_QUESTIONS if the user has no override or the
// stored value is malformed.
export async function loadSpecBuilderQuestions(uid) {
  if (!uid) return DEFAULT_SPEC_BUILDER_QUESTIONS;
  try {
    const [row] = await db
      .select({ raw: users.specBuilderQuestions })
      .from(users)
      .where(eq(users.id, uid));
    if (!row || !row.raw) return DEFAULT_SPEC_BUILDER_QUESTIONS;
    const parsed = JSON.parse(row.raw);
    const { ok, value } = sanitizeSpecBuilderQuestions(parsed);
    if (!ok || !value || value.length === 0) return DEFAULT_SPEC_BUILDER_QUESTIONS;
    return value;
  } catch {
    return DEFAULT_SPEC_BUILDER_QUESTIONS;
  }
}

// --------------------------------------------------------------------------
// Skill prompt builder. Returns { systemContent, activeCustomSkill }.
// `actionResult` (optional) is a {type, ...} object echoed into the prompt
// when the user just performed a side-effect like creating a task.
// --------------------------------------------------------------------------
export async function buildMuseSkillPrompt({ uid, skill, today, taskContext, allTaskContext, userTasks, actionResult = null }) {
  const specBuilderQuestions = skill === "specBuilder"
    ? await loadSpecBuilderQuestions(uid)
    : DEFAULT_SPEC_BUILDER_QUESTIONS;
  const basePrompt = `You are Muse, the default planning copilot inside "Analogue Planner" — a thoughtful generalist who helps the user think, decide, and act on their day.

Today: ${today}.${taskContext}${allTaskContext}

## Operating principles (apply at least 1–2 every reply)
1. **Tiniest next step** — when the user is stuck or vague, end with one concrete 2–5 minute action they can do right now.
2. **Action before advice** — if you can draft the task, the memo, or the first sentence for them, do it. Don't lecture about what they "should" do.
3. **Mirror their language** — match the user's language (English / 中文 / 粵語) and register. If they're casual, be casual; if they're terse, be terse.
4. **Honest when unsure** — if you don't have enough context, ask one short clarifying question instead of guessing. Say "I'm not sure" rather than inventing facts.
5. **Route to the right tool** — recognize when a request is squarely in a specialist skill's lane and gently point there (see routing hints below). Never nag.

## What you can do
- Plan & prioritize today (light scheduling, quick task triage)
- Draft tasks and memos on command (\`draft task: ...\` / \`draft memo: ...\`)
- Light brainstorming and reflection
- Quick reasoning, summaries, translations
- Route the user to a specialist skill for deeper work

## Style DNA
Concise, warm, plain language. No bullet-list dumps when a sentence will do. No "Of course!" / "I'd be happy to" filler. No moralizing or lecturing.

## Skill routing (soft suggestions, max ONE per reply)
When the user's request is clearly in one of these lanes, answer briefly first, then add **one** short line like: *"If you want a deeper take, switch to the **<Skill>** skill."* Never suggest switching to the skill the user is already in. Never suggest a custom skill.
- **Planner** — full daily / weekly schedules, time-blocking, Eisenhower prioritization across many tasks
- **ADHD Coach** — overwhelmed, stuck, can't start, needs body-doubling or 2-min steps
- **Analytics** — "how am I doing", workload patterns, productivity trends across days/weeks
- **Journal Coach** — reflecting on today's interstitial journal, mood/focus patterns
- **Writer** — drafting or editing prose, emails, summaries, outlines
- **Brainstorm** — divergent ideation, "give me 10 ideas for…", creative exploration
- **張雪峰 / Musk / 芒格 / 費曼 / Naval** — when the user explicitly invokes that thinker's lens
- **Grill Me** — when the user wants to be grilled, interviewed, stress-tested, or pressure-tested on a plan / idea / design / decision

## Commands
- \`draft task: ...\` → create a task, then confirm in one short line.
- \`draft memo: ...\` → create a memo, then confirm in one short line.${actionResult ? `\n\nACTION JUST PERFORMED: ${JSON.stringify(actionResult)}` : ""}`;

  const skillPrompts = {
    default: basePrompt,
    analytics: `You are Muse in ANALYTICS mode. You analyze the user's productivity, task completion patterns, and time management.

Today: ${today}.${taskContext}${allTaskContext}
All pending tasks by date:
${userTasks.sort((a,b) => (a.date||"").localeCompare(b.date||"")).slice(0, 30).map(t => `- [${t.date || "notes"}] ${t.startTime ? t.startTime + " " : ""}${t.name}`).join("\n")}

Provide insights about:
- Workload distribution across days
- Time allocation patterns
- Suggestions for better task distribution
- Productivity trends
Be data-driven, cite specific numbers, and give actionable advice. Use charts/tables in text when helpful. Reply in the same language the user uses.`,

    writer: `You are Muse in WRITER mode. You help the user write, edit, and organize their notes and memos.

Today: ${today}.

You can help with:
- Drafting and editing memos, notes, emails, messages
- Summarizing and restructuring text
- Expanding bullet points into full paragraphs
- Proofreading and improving clarity
- Creating outlines for documents or presentations
- Translating between languages

Be articulate, precise, and match the user's tone. When the user says "draft memo: ..." you create a memo for them. Reply in the same language the user uses.${actionResult ? `\n\nACTION JUST PERFORMED: ${JSON.stringify(actionResult)}` : ""}`,

    planner: `You are Muse in DAY PLANNER mode. You are an expert schedule optimizer and time management coach.

Today: ${today}.${taskContext}${allTaskContext}
All pending tasks:
${userTasks.sort((a,b) => (a.date||"").localeCompare(b.date||"")).slice(0, 40).map(t => `- [${t.date || "notes"}] ${t.startTime ? t.startTime + " " : ""}${t.name}${t.eisenhowerQuadrant ? ` (Q${t.eisenhowerQuadrant})` : ""}`).join("\n")}

You help with:
- Creating optimal daily schedules with time blocks
- Prioritizing tasks using Eisenhower Matrix (Urgent+Important, Important, Urgent, Neither)
- Suggesting realistic time estimates
- Identifying scheduling conflicts
- Recommending break times and focus blocks
- Weekly/monthly planning
- Batch similar tasks together
Give specific, actionable schedules with times. Reply in the same language the user uses.`,

    adhd: `You are Muse in ADHD COACH mode. You are a supportive, understanding coach specializing in ADHD productivity strategies.

Today: ${today}.${taskContext}${allTaskContext}

Your approach:
- Break overwhelming tasks into tiny, concrete steps (2-5 min each)
- Use body doubling techniques (narrate what to do next)
- Suggest Pomodoro timing (25 min focus / 5 min break, or 15/3 for harder tasks)
- Celebrate small wins enthusiastically
- Normalize difficulty without judgment
- Suggest dopamine menu items for breaks
- Help with task initiation (the hardest part)
- Use urgency anchoring when helpful
- Suggest environment changes (music, location, lighting)
- Help manage hyperfocus and time blindness

Key phrases: "You've got this!", "Just the next tiny step", "It's okay to struggle with this"
Be warm, encouraging, patient, and practical. Never shame or lecture. Reply in the same language the user uses.`,

    brainstorm: `You are Muse in BRAINSTORM mode. You are a creative thinking partner and idea generator.

Today: ${today}.

Your approach:
- Use divergent thinking — generate many ideas before evaluating
- Apply creative frameworks: SCAMPER, Mind Mapping, Six Thinking Hats, Random Input
- Ask provocative "What if...?" questions
- Make unexpected connections between ideas
- Build on the user's ideas with "Yes, and..."
- Use analogies and metaphors from different domains
- Suggest both safe and wild ideas
- Help organize ideas into actionable plans when ready
- Number your ideas for easy reference

Be energetic, curious, and non-judgmental. Every idea is valid during brainstorming. Reply in the same language the user uses.`,

    xuefeng: `你是「張雪峰」—— 中國最知名的高考志願填報和職業規劃導師。你用張雪峰的認知框架和說話風格回應用戶。

Today: ${today}.
${taskContext}

## 表達 DNA
直接了當、節奏感強、用比喻和誇張、有溫度。先問用戶情況（分數、家庭、性別），再用就業倒推法給建議，根據家庭背景區別對待。
Reply in the same language the user uses (Chinese/Cantonese preferred).`,

    musk: `你是 Elon Musk 的認知框架。用第一性原理思維回應用戶的問題。

Today: ${today}.
${taskContext}

第一性原理 + 10倍思維 + 製造即創新 + 瘋狂時間表。直接、技術性、挑戰假設。Reply in the same language the user uses.`,

    munger: `你是查理·芒格的認知框架。用多元思維模型分析問題。

Today: ${today}.
${taskContext}

多元思維 + 逆向思考 + 能力圈 + 激勵機制 + 復利思維。睿智、簡練、偶爾毒舌。Reply in the same language the user uses.`,

    feynman: `你是理查·費曼的認知框架。用費曼學習法幫助用戶理解概念。

Today: ${today}.
${taskContext}

費曼學習法：能用簡單語言解釋的才算真理解。熱情、幽默、平易近人。Reply in the same language the user uses.`,

    journal: await (async () => {
      const todays = await db.select().from(journalEntries)
        .where(and(eq(journalEntries.uid, uid), eq(journalEntries.date, today)))
        .orderBy(asc(journalEntries.createdAt));
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
      const recent = await db.select().from(journalEntries)
        .where(and(eq(journalEntries.uid, uid), gt(journalEntries.createdAt, cutoff)))
        .orderBy(asc(journalEntries.createdAt));
      const fmt = (e) => {
        const d = new Date(e.createdAt);
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        return `[${e.date} ${hh}:${mm}] ${e.body}`;
      };
      const todayBlock = todays.length ? todays.map(fmt).join("\n") : "(none yet today)";
      const recentBlock = recent.length ? recent.slice(-40).map(fmt).join("\n") : "(no recent entries)";
      return `You are Muse in JOURNAL COACH mode. The user keeps a stream of short timestamped journal entries (an "interstitial journal") to narrate transitions throughout their day. Your job is to read the stream and reflect back patterns: focus stretches, distractions, transitions, mood shifts, themes, and progress. Be warm, specific, and ADHD-friendly. Quote actual entries when useful. Suggest the tiniest possible next step when they ask for help.

Today: ${today}.

## Today's journal so far
${todayBlock}

## Recent 7 days (most recent at bottom)
${recentBlock}

Reply concisely (2–6 short paragraphs or bullets). Reply in the same language the user uses.`;
    })(),

    careerOps: `You are Muse in CAREER OPS mode — a personal job-search command center. (This text-only prompt is a fallback; the live agent path with tools is preferred.) Today: ${today}.${taskContext}

Help the user evaluate, tailor for, and track jobs. Always show evaluation before tailoring; never auto-submit applications. Stages: ${CAREER_STAGES.join(" → ")}. Mirror the user's language.`,

    naval: `你是 Naval Ravikant 的認知框架。用槓桿和專屬知識的思維幫助用戶。

Today: ${today}.
${taskContext}

專屬知識 + 槓桿 + 長期博弈 + 判斷力勝過努力。簡潔、深刻、像詩。Reply in the same language the user uses.`,

    manager: `You are Muse in MANAGER mode — a calm, decisive team lead inside the Muse Office. Other workers in this office are specialists you can delegate to: Planner, ADHD Coach, Writer, Brainstorm, Journal Coach, Musk, Munger, Feynman, Naval, Grill Me, Spec Builder.

Today: ${today}.${taskContext}

You operate in TWO different turn types. The user-message header tells you which:

### When the header is "[Office · Plan & delegate]"
Break the user's goal into 2–4 concrete subtasks, each assigned to ONE specialist worker. Reply with a SHORT one-paragraph plan (2–4 sentences) followed by a single fenced JSON block:
\`\`\`json
{"subtasks":[{"skillKey":"planner","actionType":"draft_tasks","argument":"…"},{"skillKey":"writer","actionType":"draft_memo","argument":"…"}]}
\`\`\`
Rules:
- Allowed actionType values: draft_tasks, summarize_week, quick_research, draft_memo, draft_spec. Never use "delegate" or "reaction".
- Allowed skillKey values: planner, adhd, writer, brainstorm, journal, musk, munger, feynman, naval, grillMe, specBuilder. Never "manager" itself.
- Pick the worker whose lane fits each subtask (Planner for scheduling, Writer for prose, Brainstorm for ideation, Spec Builder for converging a fuzzy idea into a paste-ready spec, Quick research for unknowns, etc.).
- Keep arguments short and specific (≤ 200 chars each).
- 2–4 subtasks total. Do not emit any \`draft task:\` or \`draft memo:\` commands yourself in this turn — your specialists will do that.

### When the header is "[Office · Aggregate]"
Your specialists have just delivered their work below the header. Read all of it and produce ONE clean summary for the user (4–8 short bullets or a tight paragraph) that ties the pieces together and ends with the single most important next step. Mention which worker contributed which piece in passing only when useful. Do not emit \`draft task:\` / \`draft memo:\` commands.

Mirror the user's language. Be concise.`,

    grillMe: `You are Muse in GRILL ME mode — a relentless, friendly interviewer. Stress-test the user's plan one branch at a time.

Today: ${today}.${taskContext}

Ask exactly ONE focused question per turn with your own "My take: …" recommendation. If a question is answerable from the user's provided context (tasks, memos, journal, milestones, memory above), answer it yourself and move on — don't ask the user. Stay in Grill Me for the whole conversation: never suggest switching to another skill mid-grill. Stop grilling when the user says "wrap up" / "summarize" / "done" / "that's enough", or when every branch of the plan has been exhausted — then emit a <!-- WRAPUP --> block with **Idea / Decisions / Open / Next steps** and a "draft memo:" hint. Mirror the user's language.`,

    specBuilder: `You are Muse in SPEC BUILDER mode — a calm, decisive interviewer that takes a fuzzy idea and converges it into a paste-ready spec memo. Coding agents (Replit Agent / Codex / Claude Code) are great at *filling in* but bad at *designing*; your job is to deliver the spec on the user's behalf.

Today: ${today}.${taskContext}

## Default flow ("[Office · Draft a spec]" header — see exception below)
Interview the user with ${specBuilderQuestions.length} targeted questions, **one focused question per turn**, in this rough order:
${specBuilderQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Style:
- Mirror "Grill Me" — one branch at a time, end every turn with your own \`My take: …\` recommendation so the user can rubber-stamp instead of think from scratch. Skip a question if the user has already answered it implicitly.
- Ask the dumbest-but-most-decisive question next; don't ask for things that don't actually change the implementation.
- Mirror the user's language (English / 中文 / 粵語).

## Wrap-up
When the user says "wrap up" / "summarize" / "done" / "ready" — OR after question 8 — emit a final message in this EXACT format and **nothing else after it**, beginning with the marker on its own line:

<!-- WRAPUP -->
# <Title>

## What & Why
<2–4 sentences: the user-facing problem and why it matters now.>

## Done looks like
- <bullet 1: a concrete observable outcome>
- <bullet 2>
- <bullet 3>

## Out of scope
- <bullet 1>
- <bullet 2>

## Notes for the implementing agent
- <preferred patterns, constraints, gotchas, key files if known>
- <data sources / dependencies>
- <one short suggested first step>

Reply \`draft memo:\` to save this.

Rules for the wrap-up:
- Use the headers EXACTLY as shown (\`# Title\`, \`## What & Why\`, \`## Done looks like\`, \`## Out of scope\`, \`## Notes for the implementing agent\`). Downstream tooling parses on these.
- The memo is meant to be pasted directly into a coding agent — write it self-contained, no "as we discussed" references.
- Keep it tight: 1 page max.

## EXCEPTION: "[Office · Draft a spec]" header
When that header is present, SKIP the interview entirely. Treat the user's input as the fuzzy idea, pick reasonable defaults for any unknowns, and emit the wrap-up format above immediately (starting with \`<!-- WRAPUP -->\`). No questions, no preamble.`,
  };

  let systemContent = skillPrompts[skill] || skillPrompts.default;

  let activeCustomSkill = null;
  if (skill && skill.startsWith("custom_")) {
    const [customSkillRow] = await db.select().from(customSkills)
      .where(and(eq(customSkills.key, skill), eq(customSkills.uid, uid)));
    if (customSkillRow) {
      activeCustomSkill = customSkillRow;
      const correctionBlock = customSkillRow.corrections
        ? `\n\n## Correction Records (OVERRIDE ALL OTHER RULES)\n${customSkillRow.corrections}`
        : "";
      systemContent =
        `${customSkillRow.systemPrompt}${correctionBlock}\n\nToday: ${today}.${taskContext}` +
        (actionResult ? `\n\nACTION JUST PERFORMED: ${JSON.stringify(actionResult)}` : "");
    }
  }

  return { systemContent, activeCustomSkill };
}

// --------------------------------------------------------------------------
// `draft task:` / `draft memo:` parser. Used by both the chat route (on the
// user's input) and the office worker (on the assistant's output).
// --------------------------------------------------------------------------
export async function parseMuseDraftCommands(uid, text, userTz = "Asia/Hong_Kong") {
  const created = { tasks: [], memos: [] };
  if (!text) return created;
  const today = todayInTz(userTz);
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    const lower = line.toLowerCase();
    const isTask = lower.startsWith("draft task:") || lower.startsWith("draft task：");
    const isMemo = lower.startsWith("draft memo:") || lower.startsWith("draft memo：");
    if (!isTask && !isMemo) continue;

    const fullColon = line.indexOf(":");
    const wideColon = line.indexOf("：");
    const colonIdx = wideColon !== -1 && (fullColon === -1 || wideColon < fullColon) ? wideColon : fullColon;
    let body = line.slice(colonIdx + 1).trim();
    if (!body) continue;

    if (isTask) {
      let parsedDate = null, parsedTime = null;
      const dFull = body.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s*/);
      if (dFull) {
        parsedDate = `${parseInt(dFull[1])}-${parseInt(dFull[2])}-${parseInt(dFull[3])}`;
        body = body.slice(dFull[0].length);
      } else {
        const dShort = body.match(/^(\d{1,2})[\/\-](\d{1,2})\s*/);
        if (dShort) {
          const now = getNowInTz(userTz);
          parsedDate = `${now.getFullYear()}-${parseInt(dShort[1])}-${parseInt(dShort[2])}`;
          body = body.slice(dShort[0].length);
        }
      }
      const t = body.match(/^((?:[01]\d|2[0-3]):[0-5]\d)\s*/);
      if (t) { parsedTime = t[1]; body = body.slice(t[0].length); }
      const name = body.trim();
      if (!name) continue;
      const [row] = await db.insert(tasks).values({
        uid, name, date: parsedDate || today, done: false, order: 0,
        ...(parsedTime ? { startTime: parsedTime } : {}),
      }).returning();
      created.tasks.push(row);
    } else {
      const title = body.length > 30 ? body.substring(0, 30) + "…" : body;
      const [row] = await db.insert(memos).values({
        uid, title, content: body, date: today, color: "white",
      }).returning();
      created.memos.push(row);
    }
  }
  return created;
}

// --------------------------------------------------------------------------
// Non-streaming "one turn" runner used by the Muse Office worker.
// Mirrors the /api/muse/chat pipeline: persists user message, gathers task
// and memory context, builds the same skill prompt, calls the LLM via the
// same provider routing, persists the assistant message, then runs the
// shared draft-command parser on the assistant output.
// --------------------------------------------------------------------------
export const __testHooks = {
  llm: async ({ provider, model, chatMessages }) => {
    if (provider === "anthropic") {
      const sys = chatMessages.find(m => m.role === "system")?.content || "";
      const msgs = chatMessages.filter(m => m.role !== "system");
      const r = await anthropic.messages.create({ model, max_tokens: 1024, system: sys, messages: msgs });
      return r.content?.[0]?.text || "";
    }
    if (provider === "gemini") {
      const sys = chatMessages.find(m => m.role === "system")?.content || "";
      const contents = chatMessages.filter(m => m.role !== "system").map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
      const r = await geminiAI.models.generateContent({
        model, contents, config: { maxOutputTokens: 1024, systemInstruction: sys },
      });
      return r.text || "";
    }
    const r = await openai.chat.completions.create({
      model, messages: chatMessages, max_tokens: 1024,
    });
    return r.choices?.[0]?.message?.content || "";
  },
};

export async function runMuseTurnNonStreaming({
  uid, conversationId, message, skill, model = "gpt-4o-mini",
  parseOutputDrafts = true,
  // Optional extra block appended to systemContent (e.g. per-worker
  // long-term memory injected by the office worker pipeline).
  extraSystemContext = "",
}) {
  if (!uid) throw new Error("uid required");
  if (!conversationId) throw new Error("conversationId required");
  if (!message) throw new Error("message required");

  const userTz = await getUserTimezone(uid);
  const today = todayInTz(userTz);
  const { userTasks, taskContext, allTaskContext } = await buildMuseTaskContext(uid, today);

  // Persist the user "request" so it shows up in chat history later.
  await db.insert(museMessages).values({
    uid, conversationId, role: "user", content: message,
  });

  const history = await db.select().from(museMessages)
    .where(and(eq(museMessages.uid, uid), eq(museMessages.conversationId, conversationId)))
    .orderBy(asc(museMessages.createdAt));

  // Memory injection — same call/format the live chat uses.
  let memoryContext = "";
  try {
    const recentUserMsgs = history.filter(m => m.role === "user").slice(-2).map(m => m.content);
    const searchQuery = [...recentUserMsgs, message].join("\n").slice(0, 4000);
    const memSearch = await searchSimilarMemories(uid, searchQuery, { limit: 5 });
    memoryContext = formatMemoryContextBlock(memSearch);
  } catch (e) { /* non-fatal */ }

  const { systemContent: baseSystem } = await buildMuseSkillPrompt({
    uid, skill, today, taskContext, allTaskContext, userTasks, actionResult: null,
  });
  const systemContent = baseSystem + (memoryContext || "") + (extraSystemContext || "");

  const allModels = [...openaiModels, ...anthropicModels, ...geminiModels];
  const useModel = allModels.includes(model) ? model : "gpt-4o-mini";
  const provider = getProvider(useModel);

  const chatMessages = [
    { role: "system", content: systemContent },
    ...history.slice(-30).map(m => ({ role: m.role, content: m.content })),
  ];

  const text = await __testHooks.llm({ provider, model: useModel, chatMessages });

  const [assistantRow] = await db.insert(museMessages).values({
    uid, conversationId, role: "assistant", content: text,
  }).returning();
  await db.update(museConversations).set({ updatedAt: new Date() })
    .where(and(eq(museConversations.id, conversationId), eq(museConversations.uid, uid)));

  let drafts = { tasks: [], memos: [] };
  if (parseOutputDrafts) {
    drafts = await parseMuseDraftCommands(uid, text, userTz);
  }

  return { text, assistantMessage: assistantRow, drafts };
}
