import { createHash } from "node:crypto";
export const memoHash = m => createHash("sha256").update(JSON.stringify([m.title, m.content, m.date])).digest("hex");

export function currentEvidence(rows, facts, excludeId) {
  const current = new Map(rows.filter(n => n.status === "synced" && n.hash === memoHash(n)).map(n => [n.episode, n]));
  const valid = facts.filter(f => f.episodes.length && f.episodes.every(id => current.has(id)));
  const sources = [...new Map(valid.flatMap(f => f.episodes.map(id => current.get(id))).filter(n => n.id !== excludeId).map(n => [n.id, { id: n.id, title: n.title || "Untitled" }])).values()];
  return { facts: valid.map(f => ({ fact: f.fact, validAt: f.validAt, invalidAt: f.invalidAt })), sources };
}
