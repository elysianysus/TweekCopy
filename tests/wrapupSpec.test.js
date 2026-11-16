import { test } from "node:test";
import assert from "node:assert/strict";
import {
    isWrapUpMessage,
    isSpecWrapUp,
    isGrillWrapUp,
    extractWrapUpMemo,
    slugifyTitle,
} from "../src/lib/wrapup.js";

const SPEC_SAMPLE = `<!-- WRAPUP -->
# Add a Spec Builder Muse skill

## What & Why
Coding agents are good at filling in but bad at designing. Today the user has Grill Me but nothing that converges a fuzzy idea into a paste-ready spec.

## Done looks like
- New built-in skill \`specBuilder\` shows up in MuseView, OfficeView, LINE.
- Conversation flow asks 5–8 questions, ends with the structured spec block.
- "Save as memo" button appears on the final spec message.

## Out of scope
- New UI components.
- Auto-creating Replit project tasks.

## Notes for the implementing agent
- Reuse the existing wrap-up save path.
- Files: server/officeSkills.js, server/museShared.js, src/components/views/MuseView.jsx.
- Suggested first step: add the skill to BUILT_IN_SKILL_INFO.

Reply \`draft memo:\` to save this.`;

const GRILL_SAMPLE = `<!-- WRAPUP -->
**Idea**: Build a daily standup memo

**Decisions made**:
- Run at 7am
- Pull from yesterday's tasks

**Open questions parked**:
- Which channel?

**Recommended next steps**:
- Wire to scheduler

Reply \`draft memo: ...\` to save.`;

test("isSpecWrapUp matches the spec format", () => {
    assert.equal(isSpecWrapUp(SPEC_SAMPLE), true);
    assert.equal(isSpecWrapUp(GRILL_SAMPLE), false);
    assert.equal(isSpecWrapUp(""), false);
});

test("isGrillWrapUp matches the grill format only", () => {
    assert.equal(isGrillWrapUp(GRILL_SAMPLE), true);
    assert.equal(isGrillWrapUp(SPEC_SAMPLE), false);
});

test("isWrapUpMessage detects both flavours and the explicit marker", () => {
    assert.equal(isWrapUpMessage(SPEC_SAMPLE), true);
    assert.equal(isWrapUpMessage(GRILL_SAMPLE), true);
    assert.equal(isWrapUpMessage("just a normal message"), false);
    // Marker alone is enough.
    assert.equal(isWrapUpMessage("<!-- WRAPUP -->\nhi"), true);
});

test("extractWrapUpMemo on a spec returns kind=spec + the # Title", () => {
    const { title, content, kind } = extractWrapUpMemo(SPEC_SAMPLE);
    assert.equal(kind, "spec");
    assert.equal(title, "Add a Spec Builder Muse skill");
    assert.ok(content.includes("## What & Why"));
    assert.ok(!content.includes("draft memo:"), "trailing UX hint stripped");
    assert.ok(!content.includes("WRAPUP"), "marker stripped");
});

test("extractWrapUpMemo on a grill returns kind=grill + the Idea title", () => {
    const { title, content, kind } = extractWrapUpMemo(GRILL_SAMPLE);
    assert.equal(kind, "grill");
    assert.equal(title, "Build a daily standup memo");
    assert.ok(content.includes("**Decisions made**"));
});

test("slugifyTitle produces clean tag-friendly slugs", () => {
    assert.equal(slugifyTitle("Add a Spec Builder Muse skill"), "add-a-spec-builder-muse-skill");
    assert.equal(slugifyTitle("  Hello,  World!  "), "hello-world");
    assert.equal(slugifyTitle(""), "");
});
