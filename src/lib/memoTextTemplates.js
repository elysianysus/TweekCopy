// Plain-markdown thinking-tool templates for the memo editor.
// Mirrors the 4 whiteboard templates (Mandala 9×9, Coordinate Axis,
// Concentric Chart, 4-Panel Memo) but emits searchable plain text that
// the user fills in directly inside the textarea — no HTML, no canvas.
// Markdown tables stay aligned because the memo textarea uses font-mono.

function mandala9x9() {
    const headerCells = Array(9).fill("      ").join(" | ");
    const sep = Array(9).fill("------").join("|");
    const blank = Array(9).fill("      ").join(" | ");
    const center = Array(9).fill("      ");
    center[4] = " main "; // centre cell hint
    const centerRow = center.join(" | ");

    const rows = [];
    for (let r = 0; r < 9; r++) {
        rows.push(`| ${r === 4 ? centerRow : blank} |`);
    }

    return [
        "## Mandala 9×9",
        "**Main goal:** _____",
        "",
        "_Centre = main goal · 8 surrounding cells = sub-goals · each sub-goal then anchors its own 3×3 block._",
        "",
        `| ${headerCells} |`,
        `|${sep}|`,
        ...rows,
        "",
    ].join("\n");
}

function coordinateAxis() {
    return [
        "## Coordinate Axis",
        "**X-axis (→):** _____ (low → high)",
        "**Y-axis (↑):** _____ (low → high)",
        "",
        "### ↖ Q2 — low x, high y",
        "- ",
        "",
        "### ↗ Q1 — high x, high y",
        "- ",
        "",
        "### ↙ Q3 — low x, low y",
        "- ",
        "",
        "### ↘ Q4 — high x, low y",
        "- ",
        "",
    ].join("\n");
}

function concentricChart() {
    return [
        "## Concentric Chart",
        "_3 concentric rings × 12 radial slices._",
        "",
        "### ◉ Inner ring — now / immediate",
        "1. ",
        "2. ",
        "3. ",
        "",
        "### ◎ Middle ring — this quarter",
        "1. ",
        "2. ",
        "3. ",
        "",
        "### ○ Outer ring — this year / long-term",
        "1. ",
        "2. ",
        "3. ",
        "",
    ].join("\n");
}

function fourPanelMemo() {
    const frames = [];
    for (let i = 1; i <= 8; i++) {
        frames.push(`### Frame ${i}`);
        frames.push("- ");
        frames.push("");
    }
    return [
        "## 4-Panel Memo (2×4 storyboard)",
        "_Eight sequential frames, read left-to-right, top-to-bottom._",
        "",
        ...frames,
    ].join("\n");
}

export const MEMO_TEMPLATES = [
    { key: "mandala", label: "Mandala 9×9",      icon: "fa-table-cells-large",         desc: "9×9 goal-decomposition table",      build: mandala9x9     },
    { key: "axis",    label: "Coordinate Axis",  icon: "fa-arrows-up-down-left-right", desc: "2D quadrant outline",               build: coordinateAxis },
    { key: "circle",  label: "Concentric Chart", icon: "fa-bullseye",                  desc: "Rings × slices priority outline",   build: concentricChart },
    { key: "4panel",  label: "4-Panel Memo",     icon: "fa-table-cells",               desc: "2×4 storyboard frames",             build: fourPanelMemo  },
];

// --------------------------------------------------------------------------
// Daily Self-Reflection (三省吾身) — fixed Markdown structure that the Day
// View's reflection column reads/writes. Stored as a single per-day memo,
// identified by REFLECTION_MARKER so we can find it among other memos for
// the same date without relying on title or position.
// --------------------------------------------------------------------------

export const REFLECTION_MARKER = "<!-- tweek:reflection -->";
export const REFLECTION_END_MARKER = "<!-- /tweek:reflection -->";
export const REFLECTION_TITLE = "三省吾身";

export const REFLECTION_PROMPTS = [
    { id: "change",   label: "想改變的事", heading: "想改變的事" },
    { id: "stop",     label: "想停止的事", heading: "想停止的事" },
    { id: "reduce",   label: "想減少的事", heading: "想減少的事" },
    { id: "start",    label: "想開始的事", heading: "想開始的事" },
    { id: "increase", label: "想增加的事", heading: "想增加的事" },
];

export function emptyReflectionAnswers() {
    const out = {};
    for (const p of REFLECTION_PROMPTS) out[p.id] = "";
    return out;
}

export function isReflectionMemo(content) {
    return typeof content === "string" && content.indexOf(REFLECTION_MARKER) !== -1;
}

// Locate the managed reflection block within `content`. Returns
// { prefix, suffix } around the block. When an explicit end marker is
// present (memos saved by the current serializer), suffix is everything
// after it. For legacy memos that only have the opening marker, the block
// extends to end-of-string and suffix is "".
function splitReflectionBlock(content) {
    if (!content || typeof content !== "string") return { prefix: "", suffix: "" };
    const startIdx = content.indexOf(REFLECTION_MARKER);
    if (startIdx === -1) return { prefix: content, suffix: "" };
    const prefix = content.slice(0, startIdx);
    const afterStart = startIdx + REFLECTION_MARKER.length;
    const endIdx = content.indexOf(REFLECTION_END_MARKER, afterStart);
    if (endIdx === -1) return { prefix, suffix: "" };
    return { prefix, suffix: content.slice(endIdx + REFLECTION_END_MARKER.length) };
}

// Parse a reflection memo's Markdown into { promptId: answer }. Missing
// sections come back as "". Unknown sections are ignored. Only content
// inside the managed block (between start and optional end marker) is
// considered, so unrelated `##` headings the user added outside the block
// won't be mis-parsed as answers.
export function parseReflectionMemo(content) {
    const out = emptyReflectionAnswers();
    if (!content) return out;
    const startIdx = content.indexOf(REFLECTION_MARKER);
    if (startIdx === -1) return out;
    const afterStart = startIdx + REFLECTION_MARKER.length;
    const endIdx = content.indexOf(REFLECTION_END_MARKER, afterStart);
    const body = endIdx === -1 ? content.slice(afterStart) : content.slice(afterStart, endIdx);
    for (const p of REFLECTION_PROMPTS) {
        const escaped = p.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`);
        const m = body.match(re);
        if (m) out[p.id] = m[1].replace(/\s+$/, "");
    }
    return out;
}

// Serialize the current answers back to Markdown. Sections with empty answers
// are skipped (UI still shows all prompts). Any user-authored content sitting
// BEFORE or AFTER the managed block in `existingContent` is preserved verbatim
// so edits made from the Memo column aren't clobbered.
export function serializeReflectionMemo(answers, existingContent) {
    const { prefix, suffix } = splitReflectionBlock(existingContent);
    const lines = [REFLECTION_MARKER, `# ${REFLECTION_TITLE}`, ""];
    for (const p of REFLECTION_PROMPTS) {
        const v = (answers?.[p.id] || "").trim();
        if (!v) continue;
        lines.push(`## ${p.heading}`);
        lines.push(v);
        lines.push("");
    }
    lines.push(REFLECTION_END_MARKER);
    const block = lines.join("\n");

    // Glue: ensure a blank-line gap between prefix/suffix and the block
    // without introducing one when the neighbour is empty.
    const leftGap = prefix.length === 0 ? "" : (prefix.endsWith("\n\n") ? "" : (prefix.endsWith("\n") ? "\n" : "\n\n"));
    const trimmedSuffix = suffix.replace(/^\s+/, "");
    const rightGap = trimmedSuffix.length === 0 ? "\n" : "\n\n";
    return (prefix + leftGap + block + rightGap + trimmedSuffix).replace(/\s+$/, "") + "\n";
}

// Split a reflection answer's freeform text into individual bullets for the
// Weekly Reflection rollup. Markdown-style bullets (`-`, `*`, `+`, `1.`) start
// new entries; blank lines also separate entries; continuation lines stay
// attached to their bullet. When the text contains no recognizable bullets,
// the entire trimmed text is returned as a single entry. Empty / whitespace
// input yields `[]`.
export function splitReflectionBullets(text) {
    const lines = String(text || "").split(/\r?\n/);
    const bullets = [];
    let buf = [];
    const flush = () => {
        const j = buf.join("\n").trim();
        if (j) bullets.push(j);
        buf = [];
    };
    for (const raw of lines) {
        const m = raw.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
        if (m) {
            flush();
            buf.push(m[1]);
        } else if (raw.trim() === "") {
            flush();
        } else if (buf.length > 0) {
            buf.push(raw.trim());
        } else {
            buf.push(raw.trim());
            flush();
        }
    }
    flush();
    if (bullets.length > 0) return bullets;
    const trimmed = String(text || "").trim();
    return trimmed ? [trimmed] : [];
}

export function hasAnyReflectionAnswer(answers) {
    if (!answers) return false;
    return REFLECTION_PROMPTS.some(p => (answers[p.id] || "").trim().length > 0);
}

// Insert a snippet at the textarea's caret. Falls back to appending when
// the ref is unavailable. Keeps cursor positioned right after the inserted
// block so the user can immediately start filling it in.
export function insertSnippetAtCaret(textareaRef, value, setValue, snippet) {
    const ta = textareaRef?.current;
    if (!ta) { setValue((value || "") + (value ? "\n\n" : "") + snippet); return; }
    const start = ta.selectionStart ?? value.length;
    const end   = ta.selectionEnd   ?? value.length;
    const before = value.slice(0, start);
    const after  = value.slice(end);
    const leadGap  = before.length === 0 ? "" : (before.endsWith("\n\n") ? "" : (before.endsWith("\n") ? "\n" : "\n\n"));
    const trailGap = after.length === 0 ? "\n" : (after.startsWith("\n") ? "" : "\n\n");
    const insertion = leadGap + snippet + trailGap;
    const newVal = before + insertion + after;
    setValue(newVal);
    setTimeout(() => {
        try {
            ta.focus();
            const pos = before.length + insertion.length;
            ta.setSelectionRange(pos, pos);
        } catch {}
    }, 0);
}
