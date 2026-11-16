// Parsers that normalize ChatGPT / Claude export JSON into the shape our
// muse_conversations + muse_messages tables expect.
//
// Both functions return an array of:
//   { title, createdAt: Date|null, messages: [{ role: 'user'|'assistant',
//     content: string, createdAt: Date|null }] }
// Empty conversations (no usable messages) are dropped.

export function parseChatGPT(json) {
  // ChatGPT exports come in several shapes:
  //   • top-level array of conversations (official export)
  //   • { conversations: [...] } (some 3rd-party tools wrap it)
  //   • single conversation object { mapping, current_node, ... }
  let rows = json;
  if (!Array.isArray(rows) && Array.isArray(json?.conversations)) rows = json.conversations;
  if (!Array.isArray(rows) && json && typeof json === "object" && json.mapping && typeof json.mapping === "object") {
    rows = [json];
  }
  if (!Array.isArray(rows)) {
    const seen = Array.isArray(json)
      ? "an array"
      : (json && typeof json === "object")
        ? `an object with keys: ${Object.keys(json).slice(0, 6).join(", ") || "(empty)"}`
        : `a ${typeof json}`;
    throw new Error(
      `ChatGPT export should be an array of conversations (or an object with a 'conversations' array, or a single chat with a 'mapping'). Got ${seen}. ` +
      `If this file came from Claude, pick "Claude". If it's a Markdown chat dump, pick "Markdown".`
    );
  }
  const out = [];
  for (const c of rows) {
    const mapping = c?.mapping || {};
    const messages = [];

    // Walk from current_node up to the root via parent links, then reverse
    // so messages are chronological. Fallback: iterate mapping in order and
    // sort by create_time if current_node is missing.
    let chain = [];
    if (c?.current_node && mapping[c.current_node]) {
      const seen = new Set();
      let nodeId = c.current_node;
      while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
        seen.add(nodeId);
        chain.unshift(mapping[nodeId]);
        nodeId = mapping[nodeId].parent;
      }
    } else {
      chain = Object.values(mapping).sort((a, b) => {
        const ta = a?.message?.create_time || 0;
        const tb = b?.message?.create_time || 0;
        return ta - tb;
      });
    }

    for (const node of chain) {
      const m = node?.message;
      if (!m) continue;
      const role = m?.author?.role;
      if (role !== "user" && role !== "assistant") continue;
      let text = "";
      const parts = m?.content?.parts;
      if (Array.isArray(parts)) {
        text = parts
          .map(p => {
            if (typeof p === "string") return p;
            if (p && typeof p === "object" && typeof p.text === "string") return p.text;
            return "";
          })
          .join("\n");
      } else if (typeof m?.content?.text === "string") {
        text = m.content.text;
      }
      text = (text || "").trim();
      if (!text) continue;
      messages.push({
        role,
        content: text,
        createdAt: m?.create_time ? new Date(m.create_time * 1000) : null,
      });
    }

    if (!messages.length) continue;
    out.push({
      title: (c?.title && String(c.title).trim()) || "Untitled chat",
      createdAt: c?.create_time ? new Date(c.create_time * 1000) : null,
      messages,
    });
  }
  return out;
}

export function parseClaude(json) {
  // Claude exports come in several shapes across versions:
  //   • top-level array of conversations
  //   • { conversations: [...] }
  //   • single conversation object { uuid, name, chat_messages: [...] }
  // Tolerate all of them.
  let rows = json;
  if (!Array.isArray(rows) && Array.isArray(json?.conversations)) rows = json.conversations;
  if (!Array.isArray(rows) && json && typeof json === "object" && Array.isArray(json.chat_messages)) {
    rows = [json];
  }
  if (!Array.isArray(rows)) {
    const seen = Array.isArray(json)
      ? "an array"
      : (json && typeof json === "object")
        ? `an object with keys: ${Object.keys(json).slice(0, 6).join(", ") || "(empty)"}`
        : `a ${typeof json}`;
    throw new Error(
      `Claude export should be an array of conversations (or an object with a 'conversations' array, or a single chat object). Got ${seen}. ` +
      `If this file came from ChatGPT, pick the "ChatGPT" source instead.`
    );
  }

  const out = [];
  for (const c of rows) {
    const raw = Array.isArray(c?.chat_messages) ? c.chat_messages : [];
    const messages = [];
    for (const m of raw) {
      const sender = m?.sender;
      const role = sender === "human" ? "user" : sender === "assistant" ? "assistant" : null;
      if (!role) continue;

      let text = "";
      if (typeof m?.text === "string" && m.text.trim()) {
        text = m.text;
      } else if (Array.isArray(m?.content)) {
        text = m.content
          .filter(p => p && p.type === "text" && typeof p.text === "string")
          .map(p => p.text)
          .join("\n");
      }
      text = (text || "").trim();
      if (!text) continue;

      messages.push({
        role,
        content: text,
        createdAt: m?.created_at ? new Date(m.created_at) : null,
      });
    }
    if (!messages.length) continue;
    out.push({
      title: (c?.name && String(c.name).trim()) || "Untitled chat",
      createdAt: c?.created_at ? new Date(c.created_at) : null,
      messages,
    });
  }
  return out;
}

// Parse a single Markdown chat export of the shape produced by community
// ChatGPT export tools, e.g.:
//
//   [optional title line]
//   **User:** Jane (jane@example.com)
//   **Created:** 6/13/2025 13:07
//   **Link:** [https://...](https://...)
//
//   ## Prompt:
//   Hello there
//
//   ## Response:
//   Hi! How can I help?
//
//   ## Prompt:
//   ...
//
// Returns the same `[{ title, createdAt, messages }]` shape as the JSON
// parsers, with at most one conversation per file.
export function parseMarkdownChat(text, { filename } = {}) {
  if (typeof text !== "string" || !text.trim()) return [];

  // Pull title: first non-empty, non-metadata line before the first heading.
  const lines = text.split(/\r?\n/);
  let title = "";
  let createdAt = null;
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) continue;
    if (t.startsWith("## ")) break;
    const metaMatch = t.match(/^\*\*([^*]+?):\*\*\s*(.*)$/);
    if (metaMatch) {
      const key = metaMatch[1].toLowerCase();
      const val = metaMatch[2].trim();
      if (key === "created" && val) {
        const d = new Date(val);
        if (!isNaN(d.getTime())) createdAt = d;
      }
      continue;
    }
    // First non-metadata line wins as title.
    if (!title) title = t.replace(/^#+\s*/, "").trim();
  }
  if (!title) {
    title = (filename || "").replace(/\.md$/i, "").trim() || "Imported chat";
  }

  // Split on `## Prompt:` / `## Response:` headings (case-insensitive,
  // tolerant of trailing whitespace).
  const sectionRe = /^##\s+(prompt|response)\s*:?\s*$/gim;
  const messages = [];
  const matches = [...text.matchAll(sectionRe)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const role = m[1].toLowerCase() === "prompt" ? "user" : "assistant";
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const content = text.slice(start, end).trim();
    if (!content) continue;
    messages.push({ role, content, createdAt: null });
  }

  if (!messages.length) return [];
  return [{ title, createdAt, messages }];
}

export function parseExport(source, payload) {
  if (source === "chatgpt") return parseChatGPT(payload);
  if (source === "claude") return parseClaude(payload);
  if (source === "markdown") {
    // payload may be a single { text, filename } or an array of them.
    const items = Array.isArray(payload) ? payload : [payload];
    const out = [];
    for (const item of items) {
      if (!item) continue;
      const text = typeof item === "string" ? item : item.text;
      const filename = typeof item === "object" ? item.filename : undefined;
      out.push(...parseMarkdownChat(text, { filename }));
    }
    return out;
  }
  throw new Error(`Unknown source: ${source}`);
}
