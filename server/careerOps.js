import { db } from "./db.js";
import { memos, memoTags, memoLinks, jobOpportunities, jobStatusHistory, lifeMilestones } from "./schema.js";
import { and, eq, sql, inArray, desc } from "drizzle-orm";
import { runAgent } from "./agentLoop.js";
import { todayInTz } from "./timezone.js";
import { promises as dns } from "dns";
import net from "net";

export const CAREER_STAGES = [
  "saved",
  "applied",
  "interviewing",
  "offer",
  "closed_won",
  "closed_lost",
];

export const CAREER_RUBRIC = [
  { key: "role_match", label: "Role match", weight: 0.25 },
  { key: "comp", label: "Comp", weight: 0.20 },
  { key: "growth", label: "Growth", weight: 0.20 },
  { key: "culture", label: "Culture", weight: 0.15 },
  { key: "location", label: "Location", weight: 0.10 },
  { key: "red_flags", label: "Red flags (lower = worse)", weight: 0.10 },
];

const MAX_JD_BYTES = 60_000;

async function rebuildLinks(uid, memoId, content) {
  await db.delete(memoLinks).where(eq(memoLinks.fromMemoId, memoId));
  if (!content) return;
  const matches = [...String(content).matchAll(/\[\[([^\]]+)\]\]/g)];
  if (!matches.length) return;
  const titles = [...new Set(matches.map((m) => m[1].trim()).filter(Boolean))];
  if (!titles.length) return;
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

async function setTags(memoId, tags) {
  await db.delete(memoTags).where(eq(memoTags.memoId, memoId));
  for (const t of tags || []) {
    if (!t) continue;
    await db.insert(memoTags).values({ memoId, tag: String(t).toLowerCase() });
  }
}

async function findMemoByTag(uid, tag) {
  const rows = await db
    .select({ id: memos.id, title: memos.title, content: memos.content, updatedAt: memos.updatedAt })
    .from(memos)
    .innerJoin(memoTags, eq(memoTags.memoId, memos.id))
    .where(and(eq(memos.uid, uid), eq(memoTags.tag, tag)))
    .orderBy(desc(memos.updatedAt))
    .limit(1);
  return rows[0] || null;
}

async function findMemoByTitleLike(uid, needle) {
  const pattern = `%${needle}%`;
  const [row] = await db
    .select({ id: memos.id, title: memos.title, content: memos.content })
    .from(memos)
    .where(and(eq(memos.uid, uid), sql`LOWER(${memos.title}) LIKE LOWER(${pattern})`))
    .orderBy(desc(memos.updatedAt))
    .limit(1);
  return row || null;
}

export async function loadCareerContext(uid) {
  let cv = await findMemoByTag(uid, "cv");
  if (!cv) cv = await findMemoByTitleLike(uid, "cv");
  if (!cv) cv = await findMemoByTitleLike(uid, "resume");
  let profile = await findMemoByTag(uid, "career-profile");
  if (!profile) profile = await findMemoByTitleLike(uid, "career profile");
  return { cv, profile };
}

function htmlToText(html) {
  if (!html) return "";
  let s = String(html);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<\/(p|div|li|h[1-6]|br|tr)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function isPrivateOrReservedIp(ip) {
  if (!ip) return true;
  const v = net.isIP(ip);
  if (v === 4) {
    const parts = ip.split(".").map((n) => parseInt(n, 10));
    if (parts.some((p) => Number.isNaN(p))) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local + AWS metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // multicast / reserved
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("ff")) return true; // multicast
    // IPv4-mapped (::ffff:a.b.c.d)
    const m = lower.match(/^::ffff:([0-9a-f.:]+)$/);
    if (m) {
      // Try to coerce embedded IPv4
      const v4 = m[1].includes(".") ? m[1] : null;
      if (v4 && net.isIP(v4) === 4) return isPrivateOrReservedIp(v4);
    }
    return false;
  }
  return true;
}

async function resolveAndCheckHost(hostname) {
  // Reject literal IPs that resolve into private space.
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) return { ok: false, reason: "Hostname resolves to a private/reserved address." };
    return { ok: true, ips: [hostname] };
  }
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".internal") || lower.endsWith(".local")) {
    return { ok: false, reason: "Internal hostname is not allowed." };
  }
  let addrs;
  try {
    addrs = await dns.lookup(hostname, { all: true });
  } catch (e) {
    return { ok: false, reason: `DNS lookup failed: ${e.code || e.message}` };
  }
  if (!addrs || !addrs.length) return { ok: false, reason: "DNS lookup returned no addresses." };
  for (const a of addrs) {
    if (isPrivateOrReservedIp(a.address)) {
      return { ok: false, reason: "Hostname resolves to a private/reserved address." };
    }
  }
  return { ok: true, ips: addrs.map((a) => a.address) };
}

async function fetchJdFromUrl(url) {
  try {
    let u;
    try { u = new URL(url); } catch { return { error: "Invalid URL." }; }
    if (!["http:", "https:"].includes(u.protocol)) {
      return { error: "Only http(s) URLs are supported." };
    }
    if (u.username || u.password) {
      return { error: "URLs with embedded credentials are not allowed." };
    }
    const port = u.port ? parseInt(u.port, 10) : (u.protocol === "https:" ? 443 : 80);
    const allowedPorts = new Set([80, 443, 8080, 8443]);
    if (!allowedPorts.has(port)) {
      return { error: `Port ${port} is not allowed. Paste the JD text instead.` };
    }
    const guard = await resolveAndCheckHost(u.hostname);
    if (!guard.ok) return { error: `${guard.reason} Paste the JD text instead.` };

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    let res;
    try {
      // redirect: "manual" so a 30x to a private host can't bypass our DNS check.
      res = await fetch(url, {
        headers: { "User-Agent": "AnaloguePlanner/CareerOps", Accept: "text/html,text/plain,*/*;q=0.1" },
        signal: ctrl.signal,
        redirect: "manual",
      });
    } finally {
      clearTimeout(t);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      return { error: `Fetch returned a redirect (${res.status}) to ${loc || "(unknown)"}. Paste the JD text instead.` };
    }
    if (!res.ok) return { error: `Fetch failed: HTTP ${res.status}` };
    const ct = res.headers.get("content-type") || "";
    if (ct && !/^(text\/|application\/(xhtml|json|xml))/i.test(ct)) {
      return { error: `Unsupported content-type: ${ct}. Paste the JD text instead.` };
    }
    // Stream-cap the body.
    const reader = res.body?.getReader?.();
    let body = "";
    if (reader) {
      const decoder = new TextDecoder();
      let received = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.byteLength;
        body += decoder.decode(value, { stream: true });
        if (received >= MAX_JD_BYTES) {
          try { await reader.cancel(); } catch {}
          break;
        }
      }
      body += decoder.decode();
    } else {
      body = await res.text();
    }
    if (body.length > MAX_JD_BYTES) body = body.slice(0, MAX_JD_BYTES);
    const text = ct.includes("html") ? htmlToText(body) : body;
    return { url, contentType: ct, text: text.slice(0, 12_000) };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

export function buildCareerTools({ uid, tz }) {
  const today = todayInTz(tz || "Asia/Hong_Kong");

  return [
    {
      name: "find_cv_memo",
      description: "Find the user's CV memo (tagged #cv, or title containing 'cv'/'resume'). Returns full content.",
      schema: { type: "object", properties: {} },
      handler: async () => {
        const cv = await findMemoByTag(uid, "cv") || await findMemoByTitleLike(uid, "cv") || await findMemoByTitleLike(uid, "resume");
        if (!cv) return { error: "No CV memo found. Ask the user to create a memo with their CV and tag it #cv." };
        return { id: cv.id, title: cv.title, content: String(cv.content || "").slice(0, 8000) };
      },
    },
    {
      name: "find_career_profile_memo",
      description: "Find the user's career profile memo (tagged #career-profile). Optional preferences: target roles, comp, location, deal-breakers.",
      schema: { type: "object", properties: {} },
      handler: async () => {
        const p = await findMemoByTag(uid, "career-profile") || await findMemoByTitleLike(uid, "career profile");
        if (!p) return { found: false };
        return { found: true, id: p.id, title: p.title, content: String(p.content || "").slice(0, 4000) };
      },
    },
    {
      name: "fetch_jd_from_url",
      description: "Fetch a job-description URL and return the visible text. Use only when the user gives a URL.",
      schema: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
      handler: async ({ url }) => fetchJdFromUrl(url),
    },
    {
      name: "save_job",
      description: "Save a job opportunity to the pipeline. Pass the structured evaluation as evaluation (object). Returns the new job id.",
      schema: {
        type: "object",
        properties: {
          company: { type: "string" },
          role: { type: "string" },
          location: { type: "string" },
          comp: { type: "string" },
          sourceUrl: { type: "string" },
          jdText: { type: "string" },
          score: { type: "string", description: "Letter grade A-F." },
          evaluation: { type: "object", description: "Structured rubric scores, strengths, gaps, recommendation." },
          notes: { type: "string" },
        },
        required: ["company", "role"],
      },
      handler: async ({ company, role, location, comp, sourceUrl, jdText, score, evaluation, notes }) => {
        const [row] = await db.insert(jobOpportunities).values({
          uid,
          company: String(company || "").slice(0, 200),
          role: String(role || "").slice(0, 200),
          location: String(location || "").slice(0, 200),
          comp: String(comp || "").slice(0, 200),
          sourceUrl: String(sourceUrl || "").slice(0, 1000),
          jdText: String(jdText || "").slice(0, 20_000),
          status: "saved",
          score: String(score || "").slice(0, 8),
          evaluationJson: evaluation ? JSON.stringify(evaluation).slice(0, 20_000) : "",
          notes: String(notes || "").slice(0, 4000),
        }).returning();
        await db.insert(jobStatusHistory).values({
          jobId: row.id, uid, fromStatus: "", toStatus: "saved", note: "Created via Career Ops",
        });
        return { id: row.id, status: row.status };
      },
    },
    {
      name: "update_job_status",
      description: `Move a job through the pipeline. Allowed statuses: ${CAREER_STAGES.join(", ")}. Optional note.`,
      schema: {
        type: "object",
        properties: {
          id: { type: "integer" },
          status: { type: "string" },
          note: { type: "string" },
        },
        required: ["id", "status"],
      },
      handler: async ({ id, status, note }) => {
        if (!CAREER_STAGES.includes(status)) {
          return { error: `Invalid status. Allowed: ${CAREER_STAGES.join(", ")}` };
        }
        const [existing] = await db.select().from(jobOpportunities)
          .where(and(eq(jobOpportunities.id, id), eq(jobOpportunities.uid, uid)));
        if (!existing) return { error: "Job not found." };
        await db.update(jobOpportunities)
          .set({ status, updatedAt: new Date() })
          .where(eq(jobOpportunities.id, id));
        await db.insert(jobStatusHistory).values({
          jobId: id, uid, fromStatus: existing.status, toStatus: status, note: String(note || "").slice(0, 1000),
        });
        return { id, fromStatus: existing.status, toStatus: status };
      },
    },
    {
      name: "list_jobs",
      description: "List the user's saved jobs. Optional status filter.",
      schema: {
        type: "object",
        properties: {
          status: { type: "string", description: "Optional. One of saved, applied, interviewing, offer, closed_won, closed_lost." },
          limit: { type: "integer", default: 20 },
        },
      },
      handler: async ({ status, limit = 20 }) => {
        const lim = Math.min(parseInt(limit) || 20, 100);
        const where = status
          ? and(eq(jobOpportunities.uid, uid), eq(jobOpportunities.status, status))
          : eq(jobOpportunities.uid, uid);
        const rows = await db
          .select({ id: jobOpportunities.id, company: jobOpportunities.company, role: jobOpportunities.role,
                    location: jobOpportunities.location, status: jobOpportunities.status, score: jobOpportunities.score,
                    sourceUrl: jobOpportunities.sourceUrl, updatedAt: jobOpportunities.updatedAt })
          .from(jobOpportunities)
          .where(where)
          .orderBy(desc(jobOpportunities.updatedAt))
          .limit(lim);
        return { jobs: rows };
      },
    },
    {
      name: "create_tailored_cv_memo",
      description: "Create a tailored CV memo (markdown) and link it to a job. Auto-tagged #career-ops, #cv-tailored, #job-{id}.",
      schema: {
        type: "object",
        properties: {
          jobId: { type: "integer" },
          title: { type: "string" },
          markdown: { type: "string" },
        },
        required: ["jobId", "markdown"],
      },
      handler: async ({ jobId, title, markdown }) => {
        const [job] = await db.select().from(jobOpportunities)
          .where(and(eq(jobOpportunities.id, jobId), eq(jobOpportunities.uid, uid)));
        if (!job) return { error: "Job not found." };
        const t = title || `CV for ${job.company} — ${job.role}`;
        const [m] = await db.insert(memos).values({
          uid, title: t.slice(0, 200), content: String(markdown).slice(0, 30_000),
          color: "blue", noteType: null, date: today,
        }).returning();
        await setTags(m.id, ["career-ops", "cv-tailored", `job-${jobId}`]);
        await rebuildLinks(uid, m.id, m.content);
        await db.update(jobOpportunities)
          .set({ tailoredCvMemoId: m.id, updatedAt: new Date() })
          .where(eq(jobOpportunities.id, jobId));
        return { id: m.id, title: m.title, jobId };
      },
    },
    {
      name: "create_cover_letter_memo",
      description: "Create a cover letter memo (markdown) and link it to a job. Auto-tagged #career-ops, #cover-letter, #job-{id}.",
      schema: {
        type: "object",
        properties: {
          jobId: { type: "integer" },
          title: { type: "string" },
          markdown: { type: "string" },
        },
        required: ["jobId", "markdown"],
      },
      handler: async ({ jobId, title, markdown }) => {
        const [job] = await db.select().from(jobOpportunities)
          .where(and(eq(jobOpportunities.id, jobId), eq(jobOpportunities.uid, uid)));
        if (!job) return { error: "Job not found." };
        const t = title || `Cover letter — ${job.company}`;
        const [m] = await db.insert(memos).values({
          uid, title: t.slice(0, 200), content: String(markdown).slice(0, 20_000),
          color: "green", noteType: null, date: today,
        }).returning();
        await setTags(m.id, ["career-ops", "cover-letter", `job-${jobId}`]);
        await rebuildLinks(uid, m.id, m.content);
        await db.update(jobOpportunities)
          .set({ coverLetterMemoId: m.id, updatedAt: new Date() })
          .where(eq(jobOpportunities.id, jobId));
        return { id: m.id, title: m.title, jobId };
      },
    },
    {
      name: "create_milestone_for_job",
      description: "After a confirmed offer acceptance, create a Life Milestone for joining a company. Only call after the user explicitly accepts an offer.",
      schema: {
        type: "object",
        properties: {
          jobId: { type: "integer" },
          startDate: { type: "string", description: "YYYY-MM-DD; defaults to today." },
          title: { type: "string", description: "Optional override; defaults to 'Joined {company} as {role}'." },
        },
        required: ["jobId"],
      },
      handler: async ({ jobId, startDate, title }) => {
        const [job] = await db.select().from(jobOpportunities)
          .where(and(eq(jobOpportunities.id, jobId), eq(jobOpportunities.uid, uid)));
        if (!job) return { error: "Job not found." };
        const date = startDate || today;
        const t = title || `Joined ${job.company || "company"}${job.role ? ` as ${job.role}` : ""}`;
        const [m] = await db.insert(lifeMilestones).values({
          uid,
          title: t.slice(0, 200),
          date,
          color: "blue",
          icon: "fa-solid fa-briefcase",
          notes: job.sourceUrl ? `Source: ${job.sourceUrl}` : "",
        }).returning();
        await db.update(jobOpportunities)
          .set({ milestoneId: m.id, status: "closed_won", updatedAt: new Date() })
          .where(eq(jobOpportunities.id, jobId));
        await db.insert(jobStatusHistory).values({
          jobId, uid, fromStatus: job.status, toStatus: "closed_won", note: `Milestone #${m.id} created`,
        });
        return { milestoneId: m.id, title: t, date };
      },
    },
  ];
}

export const CAREER_OPS_PROMPT = `You are Muse in CAREER OPS mode — a personal job-search command center. You are an honest filter, never a spray-and-pray cheerleader. You help the user evaluate, tailor for, and track job opportunities.

## Five-step workflow
When the user pastes a job URL or job description text, run this sequence:

1. **Extract** — If a URL is given, call fetch_jd_from_url. Parse the JD to identify: company, role, level, location, comp (if listed), key requirements, red flags.
2. **Evaluate** — Score the job on this rubric and grade A–F overall. Be specific about strengths, gaps, and red flags. End with a clear recommendation: pursue / pursue-with-caution / pass.
   Rubric: ${CAREER_RUBRIC.map(r => `${r.label} (${Math.round(r.weight * 100)}%)`).join(", ")}.
3. **Tailor** — ONLY after the user sees the evaluation and asks to proceed: use create_tailored_cv_memo and create_cover_letter_memo to draft each as markdown memos. Read the user's CV via find_cv_memo first; reuse their voice and concrete achievements; do not invent experience.
4. **Track** — Use save_job to persist the opportunity early in the flow (right after Evaluate). Use update_job_status to move it through stages: saved → applied → interviewing → offer → closed_won → closed_lost.
5. **Prep** — On request, generate 3–5 likely interview questions for the role and 1–2 STAR-style talking points the user can pull from their CV.

## Hard rules
- NEVER auto-submit applications. You are read/draft only on external systems.
- ALWAYS show the evaluation before tailoring. The user must see and consent.
- ALWAYS surface red flags (vague comp, unrealistic scope, opaque culture, churn signals) bluntly.
- If no CV memo exists, your first response must walk the user through tagging one (create a memo with their CV, tag it #cv).
- When the user moves a job to 'offer' AND explicitly confirms they accept, OFFER (don't auto-execute) to call create_milestone_for_job. Confirm the title/date with them first.
- For pipeline questions ("show my open applications", "what did I score X at", "move Y to interviewing"), use list_jobs / update_job_status directly.

## Tone
Concise, candid, plain language. Mirror the user's language (English / 中文 / 粵語). No corporate filler. Treat this as a peer review, not cheerleading.`;

function formatHistoryAsTranscript(history, message) {
  const lines = [];
  for (const h of (history || []).slice(-10)) {
    lines.push(`${h.role === "user" ? "USER" : "ASSISTANT"}: ${h.content}`);
  }
  lines.push(`USER: ${message}`);
  return lines.join("\n\n");
}

export async function runCareerOpsTurn({ uid, message, history, tz, model = "gpt-4o-mini" }) {
  const ctx = await loadCareerContext(uid);
  const today = todayInTz(tz || "Asia/Hong_Kong");
  const ctxBlock = [
    `Today: ${today}.`,
    ctx.cv
      ? `\n## User CV (memo #${ctx.cv.id}: ${ctx.cv.title})\n${String(ctx.cv.content || "").slice(0, 4000)}`
      : `\n## User CV\n(not found — first response must instruct the user to create a memo with their CV and tag it #cv)`,
    ctx.profile
      ? `\n## Career profile (memo #${ctx.profile.id}: ${ctx.profile.title})\n${String(ctx.profile.content || "").slice(0, 2000)}`
      : "",
  ].filter(Boolean).join("\n");

  const systemPrompt = `${CAREER_OPS_PROMPT}\n\n${ctxBlock}`;
  const userInput = formatHistoryAsTranscript(history, message);
  const tools = buildCareerTools({ uid, tz });

  const result = await runAgent({
    model,
    systemPrompt,
    userInput,
    tools,
    budget: { maxSteps: 8, maxToolCalls: 12, maxWallMs: 60_000, maxTokens: 2000 },
  });

  return result;
}
