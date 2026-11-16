import { test } from "node:test";
import assert from "node:assert/strict";

import {
    REFLECTION_MARKER,
    REFLECTION_END_MARKER,
    REFLECTION_TITLE,
    REFLECTION_PROMPTS,
    emptyReflectionAnswers,
    isReflectionMemo,
    parseReflectionMemo,
    serializeReflectionMemo,
    hasAnyReflectionAnswer,
} from "../src/lib/memoTextTemplates.js";

function fullAnswers() {
    return {
        change: "exercise more",
        stop: "late-night snacking",
        reduce: "phone scrolling",
        start: "morning reading",
        increase: "deep work blocks",
    };
}

test("emptyReflectionAnswers: returns one key per prompt, all empty", () => {
    const empty = emptyReflectionAnswers();
    assert.equal(Object.keys(empty).length, REFLECTION_PROMPTS.length);
    for (const p of REFLECTION_PROMPTS) {
        assert.equal(empty[p.id], "");
    }
});

test("isReflectionMemo: detects the managed marker", () => {
    assert.equal(isReflectionMemo(""), false);
    assert.equal(isReflectionMemo(null), false);
    assert.equal(isReflectionMemo("just a regular memo"), false);
    assert.equal(isReflectionMemo(`hello\n${REFLECTION_MARKER}\nbody`), true);
});

test("parseReflectionMemo: returns empty answers for missing content / marker", () => {
    assert.deepEqual(parseReflectionMemo(""), emptyReflectionAnswers());
    assert.deepEqual(parseReflectionMemo(null), emptyReflectionAnswers());
    assert.deepEqual(parseReflectionMemo("# nothing here\nrandom body"), emptyReflectionAnswers());
});

test("serialize → parse round-trips every prompt", () => {
    const answers = fullAnswers();
    const text = serializeReflectionMemo(answers, "");
    const parsed = parseReflectionMemo(text);
    assert.deepEqual(parsed, answers);
});

test("serializeReflectionMemo: skips sections whose answer is empty / whitespace", () => {
    const answers = { ...emptyReflectionAnswers(), change: "ship the thing", stop: "   " };
    const text = serializeReflectionMemo(answers, "");
    assert.ok(text.includes("## 想改變的事"));
    assert.ok(text.includes("ship the thing"));
    // Empty / whitespace-only answers must not emit a heading
    assert.ok(!text.includes("## 想停止的事"));
    assert.ok(!text.includes("## 想減少的事"));
    assert.ok(!text.includes("## 想開始的事"));
    assert.ok(!text.includes("## 想增加的事"));

    const parsed = parseReflectionMemo(text);
    assert.equal(parsed.change, "ship the thing");
    assert.equal(parsed.stop, "");
    assert.equal(parsed.reduce, "");
});

test("serializeReflectionMemo: preserves user prefix and suffix around managed block", () => {
    const prefix = "My private notes for the day.\nstill mine\n";
    const suffix = "\n\nAnd a postscript outside the block.";
    const existing = `${prefix}${REFLECTION_MARKER}\n# old\n## 想改變的事\nold answer\n${REFLECTION_END_MARKER}${suffix}`;
    const answers = { ...emptyReflectionAnswers(), change: "new answer" };

    const out = serializeReflectionMemo(answers, existing);

    assert.ok(out.startsWith(prefix), "prefix preserved verbatim");
    assert.ok(out.includes("And a postscript outside the block."), "suffix preserved");
    assert.ok(!out.includes("old answer"), "old block content replaced");
    assert.equal(parseReflectionMemo(out).change, "new answer");
});

test("serializeReflectionMemo: idempotent — serialize twice yields same result", () => {
    const answers = fullAnswers();
    const first = serializeReflectionMemo(answers, "");
    const second = serializeReflectionMemo(answers, first);
    const third = serializeReflectionMemo(answers, second);
    assert.equal(second, third);
    // Parsing each iteration must give back the same answers.
    assert.deepEqual(parseReflectionMemo(first), answers);
    assert.deepEqual(parseReflectionMemo(second), answers);
});

test("parseReflectionMemo: legacy memo without end marker still parses correctly", () => {
    const legacy = [
        REFLECTION_MARKER,
        `# ${REFLECTION_TITLE}`,
        "",
        "## 想改變的事",
        "legacy change",
        "",
        "## 想開始的事",
        "legacy start",
        "",
    ].join("\n");
    const parsed = parseReflectionMemo(legacy);
    assert.equal(parsed.change, "legacy change");
    assert.equal(parsed.start, "legacy start");
    assert.equal(parsed.stop, "");
});

test("parseReflectionMemo: ignores headings outside the managed block", () => {
    const content = [
        "## 想改變的事",
        "this is outside the marker and must be ignored",
        "",
        REFLECTION_MARKER,
        `# ${REFLECTION_TITLE}`,
        "",
        "## 想停止的事",
        "real answer",
        "",
        REFLECTION_END_MARKER,
        "",
        "## 想開始的事",
        "also outside — ignored",
    ].join("\n");
    const parsed = parseReflectionMemo(content);
    assert.equal(parsed.change, "");
    assert.equal(parsed.stop, "real answer");
    assert.equal(parsed.start, "");
});

test("hasAnyReflectionAnswer: detects any non-blank answer", () => {
    assert.equal(hasAnyReflectionAnswer(null), false);
    assert.equal(hasAnyReflectionAnswer(emptyReflectionAnswers()), false);
    assert.equal(hasAnyReflectionAnswer({ ...emptyReflectionAnswers(), change: "   " }), false);
    assert.equal(hasAnyReflectionAnswer({ ...emptyReflectionAnswers(), change: "x" }), true);
});

test("serializeReflectionMemo: multi-line answers survive round-trip", () => {
    const answers = {
        ...emptyReflectionAnswers(),
        change: "line 1\nline 2\nline 3",
        increase: "- bullet a\n- bullet b",
    };
    const text = serializeReflectionMemo(answers, "");
    const parsed = parseReflectionMemo(text);
    assert.equal(parsed.change, answers.change);
    assert.equal(parsed.increase, answers.increase);
});
