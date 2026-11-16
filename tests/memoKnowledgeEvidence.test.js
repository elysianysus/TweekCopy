import test from "node:test";
import assert from "node:assert/strict";
import { memoHash, currentEvidence } from "../server/memoKnowledgeEvidence.js";
const note = { id: 1, title: "Cedar", content: "Japanese notebook", date: null, episode: "one", status: "synced" };
note.hash = memoHash(note);
const fact = { fact: "Cedar is for Japanese", episodes: ["one"], validAt: null, invalidAt: null };
test("current facts return a source once", () => {
  assert.deepEqual(currentEvidence([note], [fact, fact]).sources, [{ id: 1, title: "Cedar" }]);
});
test("edits, deletes and incomplete indexing fail closed", () => {
  for (const rows of [[], [{ ...note, content: "Changed" }], [{ ...note, status: "pending" }], [{ ...note, status: "failed" }]]) {
    assert.equal(currentEvidence(rows, [fact]).facts.length, 0);
  }
});
test("facts with any unknown or other-tenant episode are excluded", () => {
  assert.equal(currentEvidence([note], [{ ...fact, episodes: ["one", "other-user"] }]).facts.length, 0);
  assert.equal(currentEvidence([note], [{ ...fact, episodes: [] }]).facts.length, 0);
});
test("related sources exclude the current note; timestamps preserved", () => {
  const result = currentEvidence([note], [{ ...fact, invalidAt: "2026-10-01" }], 1);
  assert.equal(result.sources.length, 0);
  assert.equal(result.facts[0].invalidAt, "2026-10-01");
});
