import { randomUUID } from "crypto";

const PHASES = [
  { key: "discovery", label: "Discovery", count: 3,
    hints: "What this assistant is for, the problem it solves, who the user wants it to be in their life, when they imagine talking to it." },
  { key: "character", label: "Character", count: 3,
    hints: "Core values, attitude toward the user, what it cares about, how it reacts under stress, what it would push back on." },
  { key: "voice", label: "Voice", count: 2,
    hints: "Tone, formality, length, catchphrases, emoji/punctuation habits, language mix, signature phrases." },
  { key: "identity", label: "Identity", count: 2,
    hints: "A short name, vibe in one line, visual identity, hard boundaries, what it will refuse." },
];

const TOTAL_QUESTIONS = PHASES.reduce((s, p) => s + p.count, 0);
const SESSION_TTL_MS = 60 * 60 * 1000;
const sessions = new Map();

const gcTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (now - s.lastUsed > SESSION_TTL_MS) sessions.delete(k);
}, 10 * 60 * 1000);
gcTimer.unref?.();

const key = (uid, sid) => `${uid}:${sid}`;
function getSession(uid, sid) {
  const s = sessions.get(key(uid, sid));
  if (!s) return null;
  s.lastUsed = Date.now();
  return s;
}

const QUESTION_SYSTEM = `You are SoulCraft, a guided-interview engine helping a user design the personality of an AI assistant.

You will be told the current phase, the dimension hints, and the prior questions+answers. Generate ONE next question — and only the question.

Rules:
- Mirror the language the user has been answering in (English, 中文, 粵語). For the very first question, reply in English unless told otherwise.
- Be concrete, warm, short (≤ 2 sentences). Exactly one question.
- Build on prior answers — refer back when natural ("You said …, so …"). Never repeat a question already asked.
- Avoid generic prompts ("describe yourself"). Ask about specific scenarios, examples, reactions.
- Avoid leading questions that put words in the user's mouth.
- Do not give advice or summarize; you are interviewing.

Output strict JSON: {"question": "<your question>"}`;

const GAPS_SYSTEM = `You analyze an existing AI assistant persona and identify the 2-3 dimensions that are most underdeveloped, out of:
purpose, character, voice, boundaries, vibe, continuity, identity.

Output strict JSON: {"gaps": ["dimension1","dimension2"], "summary": "<1 short sentence: what's strongest and what's missing>"}`;

const SYNTHESIZE_SYSTEM = `You synthesize an AI assistant persona from a guided interview transcript.

Output strict JSON with these fields:
{
  "label": "<≤ 24 chars name>",
  "icon": "<one of: fa-user, fa-user-tie, fa-face-smile, fa-heart, fa-star, fa-comment, fa-comments, fa-message, fa-fire, fa-bolt, fa-crown, fa-gem, fa-ghost, fa-cat, fa-dog, fa-music, fa-palette, fa-code, fa-gamepad, fa-trophy>",
  "color": "<one of: text-purple-500, text-pink-500, text-rose-500, text-red-500, text-orange-500, text-amber-500, text-yellow-500, text-lime-500, text-green-500, text-emerald-500, text-teal-500, text-cyan-500, text-sky-500, text-blue-500, text-indigo-500, text-violet-500>",
  "description": "<≤ 60 chars one-line vibe>",
  "personalityTags": "<comma-separated short tags>",
  "persona": "<markdown doc with sections: ## Core truths, ## Boundaries, ## Vibe, ## Continuity>",
  "systemPrompt": "<complete system prompt for the LLM to roleplay this assistant. Start with identity, then voice rules, then boundaries, then continuity. Write in 2nd person ('You are …'). Use the dominant language the user spoke during the interview.>"
}

Rules:
- Match the language the user spoke during the interview.
- Use only details from the transcript; never fabricate facts the user didn't share.
- Do NOT mention the seven-dimension framework or the phases — that's scaffolding, not output.`;

const REFINE_SYSTEM = `You synthesize an UPDATE to an existing AI assistant persona, based on a focused interview about previously-underdeveloped dimensions.

You receive: the current persona doc, the current systemPrompt, the gaps the interview targeted, and the new interview transcript.

Output strict JSON with these fields:
{
  "label": "<keep existing unless the user asked to change it>",
  "icon": "<keep existing unless the user asked to change it>",
  "color": "<keep existing unless the user asked to change it>",
  "description": "<≤ 60 chars one-line vibe — refine if needed>",
  "personalityTags": "<comma-separated tags — refine>",
  "persona": "<full updated markdown persona doc — sections ## Core truths, ## Boundaries, ## Vibe, ## Continuity. Preserve everything still true; rewrite the targeted gaps with new detail.>",
  "systemPrompt": "<full updated system prompt — preserve the existing structure, integrate the new detail. Same language as before.>",
  "changeSummary": "<2-3 short bullet points (each starting with '- ') summarizing what changed and why>"
}

Use ONLY details from the new transcript and the existing persona; never fabricate.`;

async function callJSON(openai, system, user, { model = "gpt-4o-mini", maxTokens = 800 } = {}) {
  const res = await openai.chat.completions.create({
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    response_format: { type: "json_object" },
    max_tokens: maxTokens,
  });
  const raw = res.choices?.[0]?.message?.content?.trim() || "{}";
  try { return JSON.parse(raw); } catch { return {}; }
}

function transcriptText(qa) {
  return qa
    .filter(t => !t.skipped && (t.a || "").trim())
    .map((t, i) => `Q${i + 1} (${t.phase}): ${t.q}\nA${i + 1}: ${t.a}`)
    .join("\n\n");
}

function progressFor(session) {
  const asked = session.qa.length;
  let curIdx = 0;
  for (const [i, p] of PHASES.entries()) {
    const inPhase = session.qa.filter(q => q.phase === p.key).length;
    if (inPhase < p.count) { curIdx = i; break; }
    curIdx = Math.min(i + 1, PHASES.length - 1);
  }
  return { asked, phaseIdx: curIdx };
}

async function generateNextQuestion(openai, session) {
  const phase = PHASES[session.phaseIdx];
  const focus = session.mode === "refine" && session.gaps?.length
    ? `Focus the question on these underdeveloped dimensions: ${session.gaps.join(", ")}.`
    : "";
  const priorBlock = session.qa.length
    ? `Prior Q&A so far:\n${session.qa.map((t, i) => `Q${i + 1} (${t.phase}): ${t.q}\nA${i + 1}: ${t.skipped ? "(skipped)" : t.a}`).join("\n\n")}`
    : "(No prior answers yet — this is the opening question.)";
  const user = `Current phase: ${phase.label} (${phase.key})
Phase hints: ${phase.hints}
Question ${session.qa.length + 1} of ~${TOTAL_QUESTIONS} total.
${focus}

${priorBlock}

Generate the next question only.`;
  const out = await callJSON(openai, QUESTION_SYSTEM, user, { maxTokens: 200 });
  const q = (out.question || "").toString().trim();
  return q || "Tell me one thing about this assistant that you wish more AIs understood.";
}

function formatStep(session, done = false) {
  const prog = progressFor(session);
  const phase = PHASES[Math.min(prog.phaseIdx, PHASES.length - 1)];
  return {
    sessionId: session.sessionId,
    mode: session.mode,
    phase: phase.key,
    phaseLabel: phase.label,
    phaseIdx: prog.phaseIdx,
    totalPhases: PHASES.length,
    questionsAsked: prog.asked,
    totalQuestions: TOTAL_QUESTIONS,
    question: session.pendingQ,
    done,
    gaps: session.gaps,
    gapsSummary: session.gapsSummary,
  };
}

export async function startSession({ openai, uid, skillId, currentSkill }) {
  const sessionId = randomUUID();
  const session = {
    sessionId, uid,
    mode: skillId ? "refine" : "create",
    skillId: skillId || null,
    currentSkill: currentSkill || null,
    phaseIdx: 0,
    qa: [],
    gaps: null,
    gapsSummary: "",
    pendingQ: null,
    createdAt: Date.now(),
    lastUsed: Date.now(),
  };

  if (session.mode === "refine" && currentSkill) {
    try {
      const out = await callJSON(
        openai, GAPS_SYSTEM,
        `Persona doc:\n${(currentSkill.persona || "(empty)").slice(0, 4000)}\n\nSystem prompt:\n${(currentSkill.systemPrompt || "").slice(0, 4000)}`,
        { maxTokens: 300 },
      );
      session.gaps = Array.isArray(out.gaps) ? out.gaps.slice(0, 3) : null;
      session.gapsSummary = (out.summary || "").toString().slice(0, 300);
    } catch (e) {
      console.warn("[soulcraft] gaps analysis failed:", e.message);
    }
  }

  session.pendingQ = await generateNextQuestion(openai, session);
  sessions.set(key(uid, sessionId), session);
  return formatStep(session);
}

export async function submitAnswer({ openai, uid, sessionId, answer, skip, back }) {
  const session = getSession(uid, sessionId);
  if (!session) { const err = new Error("session not found"); err.code = "NOT_FOUND"; throw err; }

  if (back) {
    if (session.qa.length === 0) { const err = new Error("nothing to go back to"); err.code = "BAD_REQUEST"; throw err; }
    const last = session.qa.pop();
    session.pendingQ = last.q;
    // Restore phaseIdx to whatever phase the popped question belonged to so the
    // re-answered question is recorded under the correct phase if the user
    // re-submits it.
    const lastPhaseIdx = PHASES.findIndex(p => p.key === last.phase);
    if (lastPhaseIdx >= 0) session.phaseIdx = lastPhaseIdx;
    return formatStep(session);
  }

  if (!session.pendingQ) { const err = new Error("no pending question"); err.code = "BAD_REQUEST"; throw err; }

  session.qa.push({
    phase: PHASES[session.phaseIdx].key,
    q: session.pendingQ,
    a: skip ? "" : (answer || "").toString().trim(),
    skipped: !!skip,
  });
  session.pendingQ = null;

  const inPhase = session.qa.filter(q => q.phase === PHASES[session.phaseIdx].key).length;
  if (inPhase >= PHASES[session.phaseIdx].count && session.phaseIdx < PHASES.length - 1) {
    session.phaseIdx += 1;
  }

  const prog = progressFor(session);
  if (prog.asked >= TOTAL_QUESTIONS) {
    return { ...formatStep(session, true), question: null };
  }

  session.pendingQ = await generateNextQuestion(openai, session);
  return formatStep(session);
}

const VALID_ICONS = new Set([
  'fa-user','fa-user-tie','fa-face-smile','fa-heart','fa-star','fa-comment','fa-comments','fa-message','fa-fire','fa-bolt',
  'fa-crown','fa-gem','fa-ghost','fa-cat','fa-dog','fa-music','fa-palette','fa-code','fa-gamepad','fa-trophy',
]);
const VALID_COLORS = new Set([
  'text-purple-500','text-pink-500','text-rose-500','text-red-500','text-orange-500','text-amber-500','text-yellow-500',
  'text-lime-500','text-green-500','text-emerald-500','text-teal-500','text-cyan-500','text-sky-500','text-blue-500',
  'text-indigo-500','text-violet-500',
]);

function normalizeDraft(d, existing) {
  const o = { ...d };
  o.label = (o.label || existing?.label || "New persona").toString().slice(0, 80);
  o.icon = VALID_ICONS.has(o.icon) ? o.icon : (existing?.icon || "fa-user");
  o.color = VALID_COLORS.has(o.color) ? o.color : (existing?.color || "text-purple-500");
  o.description = (o.description || existing?.description || "").toString().slice(0, 120);
  o.personalityTags = (o.personalityTags || existing?.personalityTags || "").toString().slice(0, 200);
  // In refine mode, never let a missing/empty model field wipe the existing persona/systemPrompt.
  const personaIn = (o.persona || "").toString().trim();
  o.persona = (personaIn || existing?.persona || "").toString().slice(0, 50000);
  const promptIn = (o.systemPrompt || "").toString().trim();
  o.systemPrompt = (promptIn || existing?.systemPrompt || "").toString().slice(0, 50000);
  if (existing) o.changeSummary = (d.changeSummary || "").toString().slice(0, 800);
  return o;
}

export async function synthesize({ openai, uid, sessionId }) {
  const session = getSession(uid, sessionId);
  if (!session) { const err = new Error("session not found"); err.code = "NOT_FOUND"; throw err; }
  if (session.qa.filter(q => !q.skipped && q.a).length === 0) {
    const err = new Error("no answers to synthesize"); err.code = "BAD_REQUEST"; throw err;
  }

  if (session.mode === "refine" && session.currentSkill) {
    const user = `Current persona doc:
${(session.currentSkill.persona || "(empty)").slice(0, 4000)}

Current system prompt:
${(session.currentSkill.systemPrompt || "").slice(0, 4000)}

Targeted gaps: ${(session.gaps || []).join(", ") || "(none specified)"}

New interview transcript:
${transcriptText(session.qa)}`;
    const draft = await callJSON(openai, REFINE_SYSTEM, user, { model: "gpt-4o", maxTokens: 2500 });
    return normalizeDraft(draft, session.currentSkill);
  }

  const user = `Interview transcript:\n\n${transcriptText(session.qa)}`;
  const draft = await callJSON(openai, SYNTHESIZE_SYSTEM, user, { model: "gpt-4o", maxTokens: 2500 });
  return normalizeDraft(draft, null);
}

const FIELD_LABELS = {
  label: "the assistant's name (≤ 24 chars)",
  description: "the one-line vibe (≤ 60 chars)",
  personalityTags: "comma-separated personality tags",
  persona: "the markdown persona doc with sections ## Core truths, ## Boundaries, ## Vibe, ## Continuity",
  systemPrompt: "the full system prompt (2nd person, 'You are …')",
  icon: `the icon, one of: ${Array.from(VALID_ICONS).join(", ")}`,
  color: `the color, one of: ${Array.from(VALID_COLORS).join(", ")}`,
};

const TWEAK_SYSTEM = `You regenerate ONE field of an AI-assistant persona, given the interview transcript and the current draft. Keep all other fields unchanged. Mirror the language used by the user during the interview.

Output strict JSON with exactly the requested field as the only key.`;

export async function tweakField({ openai, uid, sessionId, field, currentDraft }) {
  const session = getSession(uid, sessionId);
  if (!session) { const err = new Error("session not found"); err.code = "NOT_FOUND"; throw err; }
  if (!FIELD_LABELS[field]) { const err = new Error("invalid field"); err.code = "BAD_REQUEST"; throw err; }
  if (session.qa.filter(q => !q.skipped && q.a).length === 0) {
    const err = new Error("no answers to tweak from"); err.code = "BAD_REQUEST"; throw err;
  }
  const draft = currentDraft || {};
  const otherFields = Object.entries(draft)
    .filter(([k]) => k !== field && ["label","description","personalityTags","persona","systemPrompt","icon","color"].includes(k))
    .map(([k, v]) => `${k}: ${(v || "").toString().slice(0, 800)}`)
    .join("\n");

  const user = `Interview transcript:
${transcriptText(session.qa)}

Current draft (other fields, for context — do not change them):
${otherFields}

Regenerate ONLY ${FIELD_LABELS[field]}.

Output strict JSON: {"${field}": <new value as a string>}`;

  const out = await callJSON(openai, TWEAK_SYSTEM, user, { model: "gpt-4o-mini", maxTokens: 1500 });
  const value = (out?.[field] ?? "").toString();
  // Re-normalize the single field through the same allowlists/length caps used by full synthesis.
  const merged = normalizeDraft({ ...draft, [field]: value }, session.mode === "refine" ? session.currentSkill : null);
  return { [field]: merged[field] };
}

export function endSession(uid, sessionId) {
  sessions.delete(key(uid, sessionId));
}
