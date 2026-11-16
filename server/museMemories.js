import { db } from "./db.js";
import { museMemories } from "./schema.js";
import { and, eq, desc, sql } from "drizzle-orm";
import { embedText, toPgvectorLiteral, cosineSimilarity } from "./embeddings.js";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const DUPE_THRESHOLD = 0.92;
const SEARCH_TOP_K = 5;
// text-embedding-3-small returns ~0.3-0.5 cosine sim for loosely related text
// and 0.6+ for tightly related. Keep this floor permissive enough for recall.
const SEARCH_MIN_SIMILARITY = 0.35;

// "remember that I…", "記住我…", "don't forget…", etc.
// Two halves: ASCII (with \b) and CJK (no \b — boundaries don't work for CJK).
const REMEMBER_ASCII = /(?:^|\s)(?:please\s+)?(?:remember(?:\s+that)?|don'?t\s+forget|note(?:\s+that)?|keep\s+in\s+mind)\b/i;
const REMEMBER_CJK = /(?:記住|請記住|記得|別忘了|不要忘記|幫我記|幫我記住|唔好忘記)/;
export const MANUAL_REMEMBER_PATTERN = new RegExp(
  `${REMEMBER_ASCII.source}|${REMEMBER_CJK.source}`,
  "i",
);

export function detectsManualRemember(message) {
  if (!message || typeof message !== "string") return false;
  return MANUAL_REMEMBER_PATTERN.test(message);
}

export async function findSimilarRecent(uid, embedding, limit = 50) {
  if (!embedding) return [];
  const literal = toPgvectorLiteral(embedding);
  const rows = await db.execute(sql`
    SELECT id, content, kind, created_at,
           1 - (embedding <=> ${literal}::vector) AS similarity
    FROM muse_memories
    WHERE uid = ${uid} AND embedding IS NOT NULL
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${limit}
  `);
  return rows.rows || rows; // pg returns { rows }
}

export async function isDuplicate(uid, embedding) {
  const matches = await findSimilarRecent(uid, embedding, 5);
  if (!matches.length) return false;
  return Number(matches[0].similarity) >= DUPE_THRESHOLD;
}

export async function addMemory({
  uid,
  content,
  rawExcerpt = null,
  kind = "manual",
  sourceConversationId = null,
  sourceMessageId = null,
  skipDedupe = false,
}) {
  if (!uid || !content) return null;
  const trimmed = String(content).trim();
  if (!trimmed) return null;

  const embedding = await embedText(trimmed);

  if (!skipDedupe && embedding) {
    try {
      if (await isDuplicate(uid, embedding)) return null;
    } catch (err) {
      console.warn("[museMemories] dedupe check failed:", err.message);
    }
  }

  // Use raw SQL to insert with pgvector literal cast.
  const literal = embedding ? toPgvectorLiteral(embedding) : null;
  const result = await db.execute(sql`
    INSERT INTO muse_memories
      (uid, source_conversation_id, source_message_id, kind, content, raw_excerpt, embedding, created_at, updated_at)
    VALUES
      (${uid}, ${sourceConversationId}, ${sourceMessageId}, ${kind}, ${trimmed}, ${rawExcerpt},
       ${literal ? sql`${literal}::vector` : sql`NULL`}, NOW(), NOW())
    RETURNING id, uid, source_conversation_id, source_message_id, kind, content, raw_excerpt, created_at, updated_at
  `);
  const row = (result.rows || result)[0];
  return row || null;
}

export async function searchSimilarMemories(uid, queryText, {
  limit = SEARCH_TOP_K,
  minSimilarity = SEARCH_MIN_SIMILARITY,
} = {}) {
  if (!uid || !queryText) return [];
  const embedding = await embedText(queryText);
  if (!embedding) return [];
  const literal = toPgvectorLiteral(embedding);
  const result = await db.execute(sql`
    SELECT id, content, kind, raw_excerpt, created_at, source_conversation_id, source_message_id,
           1 - (embedding <=> ${literal}::vector) AS similarity
    FROM muse_memories
    WHERE uid = ${uid} AND embedding IS NOT NULL
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${limit}
  `);
  const rows = result.rows || result;
  return rows.filter(r => Number(r.similarity) >= minSimilarity);
}

export async function listMemories(uid, { q = "", limit = 100, offset = 0, kind = null, sourceConversationId = null } = {}) {
  if (!uid) return [];
  const kindFilter = kind && ["auto", "manual", "correction"].includes(kind) ? kind : null;
  const convoFilter = sourceConversationId ? parseInt(sourceConversationId) : null;
  if (q && q.trim()) {
    // User-facing search: recall over precision. Show top semantic matches
    // with a very low floor, then merge with keyword hits not already present.
    let semantic = await searchSimilarMemories(uid, q, { limit, minSimilarity: 0.05 });
    if (kindFilter) semantic = semantic.filter(r => r.kind === kindFilter);
    if (convoFilter) semantic = semantic.filter(r => r.source_conversation_id === convoFilter);
    if (semantic.length >= limit) return semantic;
    // Fallback / supplement with ILIKE keyword search.
    const result = await db.execute(sql`
      SELECT id, content, kind, raw_excerpt, created_at, source_conversation_id, source_message_id
      FROM muse_memories
      WHERE uid = ${uid} AND content ILIKE ${"%" + q + "%"}
        ${kindFilter ? sql`AND kind = ${kindFilter}` : sql``}
        ${convoFilter ? sql`AND source_conversation_id = ${convoFilter}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    const keyword = result.rows || result;
    if (!semantic.length) return keyword;
    const seen = new Set(semantic.map(r => r.id));
    return [...semantic, ...keyword.filter(r => !seen.has(r.id))];
  }
  // Use raw SQL so column names stay snake_case and match the search/keyword
  // paths and the UI bindings.
  const result = await db.execute(sql`
    SELECT id, content, kind, raw_excerpt, created_at, source_conversation_id, source_message_id
    FROM muse_memories
    WHERE uid = ${uid}
      ${kindFilter ? sql`AND kind = ${kindFilter}` : sql``}
      ${convoFilter ? sql`AND source_conversation_id = ${convoFilter}` : sql``}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
  return result.rows || result;
}

export async function clearMemoriesByConversation(uid, conversationId) {
  if (!uid || !conversationId) return 0;
  const cid = parseInt(conversationId);
  if (!cid) return 0;
  const result = await db.execute(sql`
    DELETE FROM muse_memories
    WHERE uid = ${uid} AND source_conversation_id = ${cid}
  `);
  return result.rowCount ?? 0;
}

export async function updateMemory(uid, id, { content }) {
  if (!uid || !id || !content) return null;
  const trimmed = String(content).trim();
  if (!trimmed) return null;
  const embedding = await embedText(trimmed);
  const literal = embedding ? toPgvectorLiteral(embedding) : null;
  const result = await db.execute(sql`
    UPDATE muse_memories
    SET content = ${trimmed},
        embedding = ${literal ? sql`${literal}::vector` : sql`embedding`},
        updated_at = NOW()
    WHERE id = ${id} AND uid = ${uid}
    RETURNING id, uid, kind, content, raw_excerpt, created_at, updated_at
  `);
  const row = (result.rows || result)[0];
  return row || null;
}

export async function deleteMemory(uid, id) {
  if (!uid || !id) return false;
  const r = await db.delete(museMemories).where(and(eq(museMemories.uid, uid), eq(museMemories.id, id)));
  return true;
}

export async function clearMemories(uid) {
  if (!uid) return 0;
  await db.delete(museMemories).where(eq(museMemories.uid, uid));
  return true;
}

// --- LLM-driven extraction --------------------------------------------------

const AUTO_EXTRACT_SYSTEM = `You distill long-term, durable facts about the USER from a chat snippet so an assistant can recall them later.

Extract ONLY:
- stable preferences, recurring routines, goals, beliefs, values
- people / places / pets that matter to the user
- health conditions, allergies, constraints
- ongoing projects, jobs, schools, deadlines
- explicit "remember that …" statements

DO NOT extract:
- one-off task additions, small talk, jokes, weather, dates
- anything ephemeral ("today I am tired")
- assistant suggestions the user did not confirm

Respond with strict JSON: {"memories": [{"content": "User …", "raw": "<short quote>"}]}.
Each "content" MUST start with "User " and be ONE concise sentence in the user's language.
Return {"memories": []} if nothing qualifies. NEVER fabricate.`;

export async function extractMemoriesFromTurn({ uid, conversationId, recentMessages, assistantMessageId }) {
  if (!uid || !Array.isArray(recentMessages) || recentMessages.length === 0) return [];
  try {
    const transcript = recentMessages
      .slice(-6)
      .map(m => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content}`)
      .join("\n");
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: AUTO_EXTRACT_SYSTEM },
        { role: "user", content: `Snippet:\n${transcript}` },
      ],
      response_format: { type: "json_object" },
      max_tokens: 400,
    });
    const raw = res.choices?.[0]?.message?.content?.trim();
    if (!raw) return [];
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return []; }
    const items = Array.isArray(parsed?.memories) ? parsed.memories : [];
    const saved = [];
    for (const item of items.slice(0, 5)) {
      const content = (item?.content || "").trim();
      if (!content || content.length < 6 || content.length > 500) continue;
      const row = await addMemory({
        uid,
        content,
        rawExcerpt: (item?.raw || "").trim().slice(0, 500) || null,
        kind: "auto",
        sourceConversationId: conversationId || null,
        sourceMessageId: assistantMessageId || null,
      });
      if (row) saved.push(row);
    }
    return saved;
  } catch (err) {
    console.error("[museMemories] extractMemoriesFromTurn failed:", err.message);
    return [];
  }
}

const MANUAL_DISTILL_SYSTEM = `The USER asked the assistant to remember something. Distill the durable fact into ONE concise sentence starting with "User ", in the user's language. Strip the request phrasing ("please remember", "記住"). Output ONLY the sentence, no JSON, no quotes.`;

export async function distillManualRemember(message) {
  if (!message) return null;
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: MANUAL_DISTILL_SYSTEM },
        { role: "user", content: message },
      ],
      max_tokens: 120,
    });
    const out = res.choices?.[0]?.message?.content?.trim();
    if (!out) return null;
    // Strip surrounding quotes/whitespace.
    return out.replace(/^["「『]+|["」』]+$/g, "").trim().slice(0, 500) || null;
  } catch (err) {
    console.error("[museMemories] distillManualRemember failed:", err.message);
    return null;
  }
}

export function formatMemoryContextBlock(memories) {
  if (!memories || !memories.length) return "";
  const lines = memories.map(m => `- ${m.content}`).join("\n");
  return `\n\nRelevant long-term memory about the user (recall, do not repeat verbatim):\n${lines}`;
}
