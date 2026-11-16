import { test } from "node:test";
import assert from "node:assert/strict";

import {
    computeContentHash,
    totalBulletsAcross,
    __testHooks,
} from "../server/reflectionSummary.js";

test("computeContentHash: stable across reorder of entries", () => {
    const a = [
        { ds: "2026-05-12", text: "- foo\n- bar" },
        { ds: "2026-05-10", text: "- baz" },
    ];
    const b = [
        { ds: "2026-05-10", text: "- baz" },
        { ds: "2026-05-12", text: "- foo\n- bar" },
    ];
    assert.equal(computeContentHash(a), computeContentHash(b));
});

test("computeContentHash: changes when text changes", () => {
    const a = [{ ds: "2026-05-10", text: "- foo" }];
    const b = [{ ds: "2026-05-10", text: "- foo!" }];
    assert.notEqual(computeContentHash(a), computeContentHash(b));
});

test("totalBulletsAcross: counts list markers across entries", () => {
    const entries = [
        { ds: "2026-05-10", text: "- a\n- b\n- c" },
        { ds: "2026-05-11", text: "* d\n1. e" },
    ];
    assert.equal(totalBulletsAcross(entries), 5);
});

test("totalBulletsAcross: counts non-bulleted entry as one bullet", () => {
    const entries = [{ ds: "2026-05-10", text: "free-form thought without list markers" }];
    assert.equal(totalBulletsAcross(entries), 1);
});

test("__testHooks.normalizeEntries: drops empty + sorts by date", () => {
    const cleaned = __testHooks.normalizeEntries([
        { ds: "2026-05-12", text: "y" },
        { ds: "", text: "drop" },
        { ds: "2026-05-10", text: "x" },
        { ds: "2026-05-11", text: "" },
    ]);
    assert.deepEqual(cleaned.map(e => e.ds), ["2026-05-10", "2026-05-12"]);
});
