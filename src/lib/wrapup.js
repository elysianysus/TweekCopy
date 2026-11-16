// Shared wrap-up detection + extraction used by MuseView's "Save as memo"
// button. Two structured wrap-up flavours are recognized:
//
//   1. Grill Me: bold-headers (**Idea / Decisions / Open / Next steps**)
//   2. Spec Builder: markdown-headers (`# Title` + `## What & Why` +
//      `## Done looks like` + `## Out of scope` + `## Notes for the
//      implementing agent`)
//
// In both cases the server prompt also emits the `<!-- WRAPUP -->` marker
// so detection is 100% reliable across language switches.

export const WRAPUP_EXPLICIT_MARKER = /<!--\s*WRAPUP\s*-->/i;

// Grill Me flavour — four bold-header pattern.
const GRILL_HEADER_PATTERNS = [
    /\*\*\s*Idea\s*\*\*\s*[:：]/i,
    /\*\*\s*Decisions(?:\s+made)?\s*\*\*\s*[:：]/i,
    /\*\*\s*Open\s+questions(?:\s+parked)?\s*\*\*\s*[:：]/i,
    /\*\*\s*(?:Recommended\s+)?next\s+steps\s*\*\*\s*[:：]/i,
];

// Spec Builder flavour — five markdown-header pattern. We require the
// four ## sub-headers (the # Title is part of the contract but optional
// for detection so the LLM can sometimes drop it).
const SPEC_HEADER_PATTERNS = [
    /^#{2}\s+What\s*&\s*Why\b/im,
    /^#{2}\s+Done\s+looks\s+like\b/im,
    /^#{2}\s+Out\s+of\s+scope\b/im,
    /^#{2}\s+Notes\s+for\s+the\s+implementing\s+agent\b/im,
];

export function isGrillWrapUp(text) {
    if (!text) return false;
    return GRILL_HEADER_PATTERNS.every(re => re.test(text));
}

export function isSpecWrapUp(text) {
    if (!text) return false;
    return SPEC_HEADER_PATTERNS.every(re => re.test(text));
}

export function isWrapUpMessage(text) {
    if (!text || typeof text !== 'string') return false;
    if (WRAPUP_EXPLICIT_MARKER.test(text)) return true;
    return isGrillWrapUp(text) || isSpecWrapUp(text);
}

// Strip trailing UX hints + the explicit marker.
function stripWrapUpChrome(text) {
    return text
        .replace(WRAPUP_EXPLICIT_MARKER, '')
        .replace(/\n+[^\n]*`?draft\s*memo\b[\s\S]*$/i, '')
        .replace(/\n+\s*[*_"“”']?\s*(?:回覆|回复|輸入|输入|Reply)[^\n]*(?:儲存|储存|save)[\s\S]*$/i, '')
        .trim();
}

export function extractWrapUpMemo(text) {
    const cleaned = stripWrapUpChrome(text);

    // Spec format wins when present — it carries an explicit `# <Title>`.
    if (isSpecWrapUp(cleaned)) {
        let title = "Spec";
        const titleMatch = cleaned.match(/^#\s+(.+?)\s*$/m);
        if (titleMatch && titleMatch[1]) {
            const t = titleMatch[1].trim().replace(/^[<](.+)[>]$/, '$1').trim();
            if (t) title = t.length > 80 ? t.slice(0, 80) + "…" : t;
        }
        return { title, content: cleaned, kind: "spec" };
    }

    // Fall back to Grill Me's **Idea: ...** line.
    let title = "Grill Me wrap-up";
    const ideaMatch = cleaned.match(/\*\*\s*Idea\s*\*\*\s*[:：]\s*(.+)/i);
    if (ideaMatch && ideaMatch[1]) {
        const ideaText = ideaMatch[1].trim().replace(/^[<](.+)[>]$/, '$1').trim();
        if (ideaText) {
            title = ideaText.length > 60 ? ideaText.substring(0, 60) + "…" : ideaText;
        }
    }
    return { title, content: cleaned, kind: "grill" };
}

// Slugify a title for tag use: lowercase, alphanumeric + hyphens, ≤ 40 chars.
export function slugifyTitle(title) {
    if (!title || typeof title !== "string") return "";
    return title
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
}
