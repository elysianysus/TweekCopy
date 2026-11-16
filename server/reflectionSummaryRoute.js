import { getOrGenerateReflectionSummary } from "./reflectionSummary.js";

// Shared by the application router and the isolated HTTP integration tests.
export async function reflectionSummaryHandler(req, res) {
  try {
    const uid = req.userId || req.session?.userId;
    const { weekStart, promptId, promptLabel, entries, regenerate } = req.body || {};
    if (!weekStart || !promptId) {
      return res.status(400).json({ error: "weekStart and promptId required" });
    }
    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: "entries must be an array" });
    }
    const result = await getOrGenerateReflectionSummary({
      uid, weekStart, promptId, promptLabel, entries, regenerate: regenerate === true,
    });
    res.json(result);
  } catch (err) {
    console.error("reflection-summary failed:", err.message);
    res.status(500).json({ error: err.message });
  }
}
