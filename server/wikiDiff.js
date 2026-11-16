// Compact line-based unified-diff helper used by the wiki agent's update_memo
// tool. Tiny LCS implementation — no external deps. O(m*n) memory; memos are
// capped well under any size where this matters.

export function unifiedDiff(beforeText, afterText, beforeLabel = "before", afterLabel = "after") {
  const a = String(beforeText ?? "").split("\n");
  const b = String(afterText ?? "").split("\n");
  const m = a.length;
  const n = b.length;
  // dp[i][j] = LCS length of a[i..] vs b[j..]
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [`--- ${beforeLabel}`, `+++ ${afterLabel}`];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push(" " + a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push("-" + a[i]); i++; }
    else { out.push("+" + b[j]); j++; }
  }
  while (i < m) out.push("-" + a[i++]);
  while (j < n) out.push("+" + b[j++]);
  return out.join("\n");
}

export function summariseDiff(diff) {
  const lines = String(diff || "").split("\n");
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.startsWith("+++") || l.startsWith("---")) continue;
    if (l.startsWith("+")) added++;
    else if (l.startsWith("-")) removed++;
  }
  return { added, removed };
}
