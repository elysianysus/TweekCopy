import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { setupAuth } from "./auth.js";
import routes from "./routes.js";
import { startReminderChecker } from "./push.js";
import { setupLineBot, startWeeklyLintScheduler } from "./lineBot.js";
import { startRecurrenceScheduler } from "./scheduler.js";
import { startYoutubeAutoImportScheduler } from "./youtubeAutoImport.js";
import { startLast30DaysWorker, startLast30DaysAutoRefresh, recoverInterruptedRuns } from "./last30daysWorker.js";
import { startOfficeJobsWorker, recoverInterruptedOfficeJobs } from "./officeJobs.js";
import { runStartupMigrations } from "./migrations.js";
import { setupApiDocs } from "./openapi.js";
import memoKnowledgeRoutes, { startKnowledgeWorker } from "./memoKnowledge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const isProd = process.env.NODE_ENV === "production";

app.use(express.json({
  limit: '50mb',
  verify: (req, res, buf) => { req.rawBody = buf.toString(); },
}));
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

setupAuth(app);
setupLineBot(app);
app.use(routes);
app.use(memoKnowledgeRoutes);
setupApiDocs(app);

if (isProd) {
  const distPath = path.join(__dirname, "..", "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

const PORT = isProd ? 5000 : 3001;
const HOST = isProd ? "0.0.0.0" : "127.0.0.1";

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
  startKnowledgeWorker();
  runStartupMigrations().catch((err) => console.error("[migrations] failed:", err.message));
  // Weekly wiki lint is decoupled from LINE bot setup so it runs even
  // when LINE credentials are missing — users without a linked LINE
  // account still get a Lint report memo each week (just no LINE push).
  startWeeklyLintScheduler();
  startReminderChecker();
  startRecurrenceScheduler();
  startYoutubeAutoImportScheduler();
  recoverInterruptedRuns()
    .catch((err) => console.error("[last30days] recovery failed:", err.message))
    .finally(() => {
      startLast30DaysWorker();
      startLast30DaysAutoRefresh();
    });
  recoverInterruptedOfficeJobs()
    .catch((err) => console.error("[office] recovery failed:", err.message))
    .finally(() => startOfficeJobsWorker());
});
