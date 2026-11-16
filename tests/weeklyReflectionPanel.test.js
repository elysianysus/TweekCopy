import { test } from "node:test";
import assert from "node:assert/strict";

import {
    splitReflectionBullets,
} from "../src/lib/memoTextTemplates.js";

test("splitReflectionBullets: empty / whitespace input yields []", () => {
    assert.deepEqual(splitReflectionBullets(""), []);
    assert.deepEqual(splitReflectionBullets(null), []);
    assert.deepEqual(splitReflectionBullets(undefined), []);
    assert.deepEqual(splitReflectionBullets("   \n\t\n  "), []);
});

test("splitReflectionBullets: dash bullets become separate entries", () => {
    const text = "- first thing\n- second thing\n- third thing";
    assert.deepEqual(splitReflectionBullets(text), [
        "first thing",
        "second thing",
        "third thing",
    ]);
});

test("splitReflectionBullets: supports `*`, `+`, and numbered bullets", () => {
    const text = [
        "* star one",
        "+ plus one",
        "1. numbered one",
        "2. numbered two",
    ].join("\n");
    assert.deepEqual(splitReflectionBullets(text), [
        "star one",
        "plus one",
        "numbered one",
        "numbered two",
    ]);
});

test("splitReflectionBullets: continuation lines stay attached to their bullet", () => {
    const text = [
        "- first bullet",
        "  continued on next line",
        "  and still continuing",
        "- second bullet",
    ].join("\n");
    const out = splitReflectionBullets(text);
    assert.equal(out.length, 2);
    assert.equal(out[0], "first bullet\ncontinued on next line\nand still continuing");
    assert.equal(out[1], "second bullet");
});

test("splitReflectionBullets: blank lines also separate entries", () => {
    const text = "- one\n\n- two\n\n\n- three";
    assert.deepEqual(splitReflectionBullets(text), ["one", "two", "three"]);
});

test("splitReflectionBullets: bare paragraphs split on blank lines", () => {
    const text = "first paragraph\n\nsecond paragraph\n\nthird";
    assert.deepEqual(splitReflectionBullets(text), [
        "first paragraph",
        "second paragraph",
        "third",
    ]);
});

test("splitReflectionBullets: single-line non-bullet text returns one entry", () => {
    assert.deepEqual(splitReflectionBullets("just a sentence."), ["just a sentence."]);
});

test("splitReflectionBullets: mixed bullets and prose splits cleanly", () => {
    const text = [
        "intro sentence",
        "",
        "- bullet a",
        "- bullet b",
        "",
        "trailing thought",
    ].join("\n");
    assert.deepEqual(splitReflectionBullets(text), [
        "intro sentence",
        "bullet a",
        "bullet b",
        "trailing thought",
    ]);
});

test("splitReflectionBullets: indented bullets are still recognized", () => {
    const text = "    - indented one\n    - indented two";
    assert.deepEqual(splitReflectionBullets(text), [
        "indented one",
        "indented two",
    ]);
});

test("splitReflectionBullets: handles CRLF line endings", () => {
    const text = "- alpha\r\n- beta\r\n- gamma";
    assert.deepEqual(splitReflectionBullets(text), ["alpha", "beta", "gamma"]);
});

test("splitReflectionBullets: ignores empty bullets / whitespace-only bullets", () => {
    const text = "- real\n-   \n- also real";
    const out = splitReflectionBullets(text);
    assert.deepEqual(out, ["real", "also real"]);
});

test("splitReflectionBullets: stringifies non-string input safely", () => {
    assert.deepEqual(splitReflectionBullets(0), []);
    assert.deepEqual(splitReflectionBullets(false), []);
});
