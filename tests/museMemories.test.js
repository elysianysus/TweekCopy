import { test } from "node:test";
import assert from "node:assert/strict";
import { detectsManualRemember, MANUAL_REMEMBER_PATTERN } from "../server/museMemories.js";
import { cosineSimilarity, toPgvectorLiteral } from "../server/embeddings.js";

test("detectsManualRemember: English variants", () => {
  assert.equal(detectsManualRemember("Please remember that I love jazz"), true);
  assert.equal(detectsManualRemember("Remember: my dog's name is Mochi"), true);
  assert.equal(detectsManualRemember("Don't forget I have a meeting tomorrow"), true);
  assert.equal(detectsManualRemember("Note that I'm allergic to peanuts"), true);
});

test("detectsManualRemember: Chinese variants", () => {
  assert.equal(detectsManualRemember("記住我有高血壓"), true);
  assert.equal(detectsManualRemember("請記住我下午有meeting"), true);
  assert.equal(detectsManualRemember("幫我記住買牛奶"), true);
  assert.equal(detectsManualRemember("唔好忘記我食緊藥"), true);
});

test("detectsManualRemember: ignores chit-chat", () => {
  assert.equal(detectsManualRemember("How is the weather today?"), false);
  assert.equal(detectsManualRemember("hello"), false);
  assert.equal(detectsManualRemember(""), false);
  assert.equal(detectsManualRemember(null), false);
});

test("toPgvectorLiteral formats array as bracketed string", () => {
  assert.equal(toPgvectorLiteral([0.1, 0.2, 0.3]), "[0.1,0.2,0.3]");
  assert.equal(toPgvectorLiteral([]), "[]");
  assert.equal(toPgvectorLiteral(null), null);
});

test("cosineSimilarity: identical vectors == 1", () => {
  const v = [1, 2, 3, 4];
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-9);
});

test("cosineSimilarity: orthogonal vectors == 0", () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("cosineSimilarity: handles zero & length mismatch", () => {
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  assert.equal(cosineSimilarity([1, 1], [1, 1, 1]), 0);
});

test("MANUAL_REMEMBER_PATTERN exported", () => {
  assert.ok(MANUAL_REMEMBER_PATTERN instanceof RegExp);
});
