import OpenAI from "openai";

// Embeddings need a REAL OpenAI key — the Replit AI proxy only exposes
// chat/audio/image/batch and rejects /embeddings. Prefer a user-supplied
// OPENAI_API_KEY secret; if missing, embedText() returns null and the
// memory system gracefully falls back to keyword-only search.
const directKey = process.env.OPENAI_API_KEY;
const embeddingsClient = directKey
  ? new OpenAI({ apiKey: directKey })
  : null;

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
export const embeddingsAvailable = !!embeddingsClient;

if (!embeddingsClient) {
  console.warn(
    "[embeddings] OPENAI_API_KEY not set — Muse memories will be saved " +
    "without vectors and semantic search will be disabled (keyword fallback only).",
  );
}

export async function embedText(text) {
  if (!embeddingsClient) return null;
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim().slice(0, 8000);
  if (!trimmed) return null;
  // Retry transient failures (rate-limit 429 + 5xx) with exponential backoff.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await embeddingsClient.embeddings.create({
        model: EMBEDDING_MODEL,
        input: trimmed,
      });
      return res.data?.[0]?.embedding || null;
    } catch (err) {
      const status = err?.status || err?.response?.status;
      const retriable = status === 429 || (status >= 500 && status < 600);
      if (!retriable || attempt === MAX_ATTEMPTS) {
        console.error(`[embeddings] embedText failed (attempt ${attempt}):`, err.message);
        return null;
      }
      const delayMs = 250 * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return null;
}

// pgvector wants the literal "[v1,v2,...]" string when bound as a parameter.
export function toPgvectorLiteral(arr) {
  if (!Array.isArray(arr)) return null;
  return `[${arr.join(",")}]`;
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
