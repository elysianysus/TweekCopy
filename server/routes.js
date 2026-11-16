import { Router } from "express";
import { db } from "./db.js";
import { tasks, users, subtasks, taskFiles, monthFocus, cheers, memos, memoTags, memoFiles, whiteboards, whiteboardMemos, whiteboardConnections, whiteboardSections, memoLinks, museConversations, museMessages, shareTokens, pushSubscriptions, rssFeeds, youtubeAutoImports, emailInbox, gmailTokens, customSkills, lifeMilestones, graphConnections, expenses, expenseAuditLog, bloodPressure, steps, medicineLog, foodLog, foodAuditLog, webhookTokens, journalEntries, taskRepeatExceptions, dailyWeatherSent, digestPreferences, sleepLog, sleepSymptomLog, podcastShows, podcastEpisodes, podcastEpisodeNotes } from "./schema.js";
import { resolveYoutubeChannel, fetchChannelEpisodes } from "./podcasts.js";
import { google } from "googleapis";
import { eq, and, gt, sql, desc, asc, inArray } from "drizzle-orm";
import { isAuthenticated, isAdmin, parseTzExpandedGroups, sanitizeTzExpandedGroupsInput } from "./auth.js";
import { formatSleepSummaryForPrompt, formatSleepSymptomSummaryForPrompt } from "./sleepSummary.js";
import levenshtein from "js-levenshtein";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { getVapidPublicKey, saveSubscription, removeSubscription, sendPushToUser } from "./push.js";
import { invalidateDailySummaryCache, invalidateDailyWeatherCache, WEATHER_TARGET_HOUR, WEATHER_TARGET_MINUTE, getDailySummarySchedulerStats, getDailyWeatherSchedulerStats, invalidateWeeklyLintCache, getWeeklyLintSchedulerStats } from "./lineBot.js";
import {
  addMemory as addMuseMemory,
  searchSimilarMemories,
  listMemories as listMuseMemories,
  updateMemory as updateMuseMemory,
  deleteMemory as deleteMuseMemory,
  clearMemories as clearMuseMemories,
  clearMemoriesByConversation as clearMuseMemoriesByConversation,
  detectsManualRemember,
  distillManualRemember,
  extractMemoriesFromTurn,
  formatMemoryContextBlock,
} from "./museMemories.js";
import { parseExport as parseChatExport } from "./chatImporters.js";

// Hard limits on a single import to prevent runaway memory / cost / DB load.
const MUSE_IMPORT_MAX_CONVERSATIONS = 2000;
const MUSE_IMPORT_MAX_MESSAGES = 60000;
// Per-uid in-process mutex so a user can't fire a second import while the
// background extraction loop from the previous one is still draining.
const museImportInFlight = new Set();
import { todayInTz, todayPaddedInTz, userTimezone, getNowInTz, getNextOccurrenceInTz } from "./timezone.js";
import { loadVideo, summarizeTranscript, fetchYoutubeTranscript, VideoNoteError } from "./videoNotes.js";
import { startSession as soulcraftStart, submitAnswer as soulcraftSubmit, synthesize as soulcraftSynthesize, tweakField as soulcraftTweak, endSession as soulcraftEnd } from "./soulcraft.js";
import { isYoutubeChannelFeedUrl, runYoutubeAutoImportForUser, getYoutubeAutoImportStats } from "./youtubeAutoImport.js";
import {
  isValidPattern,
  newSeriesId,
  parseDateStr,
  formatDateStr,
  compareDateStrings,
} from "./recurrence.js";
import {
  materializeSeriesForUser,
  invalidateRecurrenceUserCache,
  clampHorizonDays,
  MIN_HORIZON_DAYS,
  MAX_HORIZON_DAYS,
  getRecurrenceSchedulerStats,
} from "./scheduler.js";
import { runWikiOp, listAgentRuns, getAgentRun, WIKI_OPS, getOpNames, approveAgentRunUpdate, rejectAgentRunUpdate, setWikiAutoApply, getWikiAutoApplyPrefs, getWikiAutoIngestPrefs, setWikiAutoIngest, getWikiLintSchedule, setWikiLintSchedule } from "./wikiOps.js";
import { getAutoIngestStats } from "./wikiAutoIngest.js";
import { runCareerOpsTurn, CAREER_STAGES } from "./careerOps.js";
import { jobOpportunities, jobStatusHistory, last30daysRuns, last30daysSubscriptions } from "./schema.js";
import { enqueueRun as enqueueLast30DaysRun, getLast30DaysSchedulerStats } from "./last30daysWorker.js";
import { enqueueOfficeJob, listOfficeJobsForUser, getOfficeStats, getOfficeSkillBreakdown, getOfficeConfidenceBreakdown, ACTION_TYPES as OFFICE_ACTION_TYPES, PUBLIC_ACTION_TYPES as OFFICE_PUBLIC_ACTION_TYPES, isValidActionType as isValidOfficeAction, listOfficeTemplates, isValidTemplateKey, startOfficeTemplate } from "./officeJobs.js";
import {
  getSkillProfile as getOfficeSkillProfile,
  addWorkerMemoryForUser as addOfficeWorkerMemory,
  deleteWorkerMemoryForUser as deleteOfficeWorkerMemory,
  recordJobFeedback as recordOfficeJobFeedback,
  listJobFeedbackForUser as listOfficeJobFeedback,
} from "./officeSkills.js";
import { buildMuseTaskContext, buildMuseSkillPrompt, DEFAULT_SPEC_BUILDER_QUESTIONS, loadSpecBuilderQuestions, sanitizeSpecBuilderQuestions } from "./museShared.js";
import { recordReflectionFeedback } from "./reflectionSummary.js";
import { reflectionSummaryHandler } from "./reflectionSummaryRoute.js";
import sanitizeHtml from "sanitize-html";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

const memoFileCols = { id: memoFiles.id, memoId: memoFiles.memoId, filename: memoFiles.filename, originalName: memoFiles.originalName, url: memoFiles.url, mimeType: memoFiles.mimeType, createdAt: memoFiles.createdAt };
const taskFileCols = { id: taskFiles.id, taskId: taskFiles.taskId, filename: taskFiles.filename, originalName: taskFiles.originalName, url: taskFiles.url, mimeType: taskFiles.mimeType, createdAt: taskFiles.createdAt };

function getUserId(req) {
  return req.userId || req.session?.userId;
}

function generateShortcutPlist(endpointUrl, shareToken) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const url = esc(endpointUrl);
  const token = esc(shareToken);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowClientVersion</key>
  <string>2302.0.4</string>
  <key>WFWorkflowClientRelease</key>
  <string>2302.0.4</string>
  <key>WFWorkflowMinimumClientVersionString</key>
  <string>900</string>
  <key>WFWorkflowMinimumClientVersion</key>
  <integer>900</integer>
  <key>WFWorkflowIcon</key>
  <dict>
    <key>WFWorkflowIconStartColor</key>
    <integer>4282601983</integer>
    <key>WFWorkflowIconGlyphNumber</key>
    <integer>61440</integer>
  </dict>
  <key>WFWorkflowTypes</key>
  <array>
    <string>ActionExtension</string>
  </array>
  <key>WFWorkflowInputContentItemClasses</key>
  <array>
    <string>WFStringContentItem</string>
    <string>WFURLContentItem</string>
    <string>WFImageContentItem</string>
    <string>WFGenericFileContentItem</string>
  </array>
  <key>WFWorkflowActions</key>
  <array>
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.setvariable</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFVariableName</key>
        <string>SharedInput</string>
        <key>WFInput</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>attachmentsByRange</key>
            <dict>
              <key>{0, 1}</key>
              <dict>
                <key>Type</key>
                <string>ExtensionInput</string>
              </dict>
            </dict>
            <key>string</key>
            <string>&#xFFFC;</string>
          </dict>
          <key>WFSerializationType</key>
          <string>WFTextTokenString</string>
        </dict>
        <key>UUID</key>
        <string>A1B2C3D4-0001-0001-0001-000000000001</string>
      </dict>
    </dict>
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.downloadurl</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFURL</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>string</key>
            <string>${url}</string>
          </dict>
          <key>WFSerializationType</key>
          <string>WFTextTokenString</string>
        </dict>
        <key>WFHTTPMethod</key>
        <string>POST</string>
        <key>WFHTTPHeaders</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFDictionaryFieldValueItems</key>
            <array>
              <dict>
                <key>WFItemType</key>
                <integer>0</integer>
                <key>WFKey</key>
                <dict>
                  <key>Value</key>
                  <dict>
                    <key>string</key>
                    <string>X-Share-Token</string>
                  </dict>
                  <key>WFSerializationType</key>
                  <string>WFTextTokenString</string>
                </dict>
                <key>WFValue</key>
                <dict>
                  <key>Value</key>
                  <dict>
                    <key>string</key>
                    <string>${token}</string>
                  </dict>
                  <key>WFSerializationType</key>
                  <string>WFTextTokenString</string>
                </dict>
              </dict>
            </array>
          </dict>
          <key>WFSerializationType</key>
          <string>WFDictionaryFieldValue</string>
        </dict>
        <key>WFHTTPBodyType</key>
        <string>Form</string>
        <key>WFFormValues</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFDictionaryFieldValueItems</key>
            <array>
              <dict>
                <key>WFItemType</key>
                <integer>0</integer>
                <key>WFKey</key>
                <dict>
                  <key>Value</key>
                  <dict>
                    <key>string</key>
                    <string>text</string>
                  </dict>
                  <key>WFSerializationType</key>
                  <string>WFTextTokenString</string>
                </dict>
                <key>WFValue</key>
                <dict>
                  <key>Value</key>
                  <dict>
                    <key>attachmentsByRange</key>
                    <dict>
                      <key>{0, 1}</key>
                      <dict>
                        <key>VariableName</key>
                        <string>SharedInput</string>
                        <key>Type</key>
                        <string>Variable</string>
                      </dict>
                    </dict>
                    <key>string</key>
                    <string>&#xFFFC;</string>
                  </dict>
                  <key>WFSerializationType</key>
                  <string>WFTextTokenString</string>
                </dict>
              </dict>
              <dict>
                <key>WFItemType</key>
                <integer>2</integer>
                <key>WFKey</key>
                <dict>
                  <key>Value</key>
                  <dict>
                    <key>string</key>
                    <string>file</string>
                  </dict>
                  <key>WFSerializationType</key>
                  <string>WFTextTokenString</string>
                </dict>
                <key>WFValue</key>
                <dict>
                  <key>Value</key>
                  <dict>
                    <key>attachmentsByRange</key>
                    <dict>
                      <key>{0, 1}</key>
                      <dict>
                        <key>VariableName</key>
                        <string>SharedInput</string>
                        <key>Type</key>
                        <string>Variable</string>
                      </dict>
                    </dict>
                    <key>string</key>
                    <string>&#xFFFC;</string>
                  </dict>
                  <key>WFSerializationType</key>
                  <string>WFTextTokenString</string>
                </dict>
              </dict>
            </array>
          </dict>
          <key>WFSerializationType</key>
          <string>WFDictionaryFieldValue</string>
        </dict>
        <key>UUID</key>
        <string>A1B2C3D4-0001-0001-0001-000000000002</string>
      </dict>
    </dict>
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.notification</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFNotificationActionBody</key>
        <string>Content saved to Analogue</string>
        <key>WFNotificationActionTitle</key>
        <string>Saved to Analogue</string>
      </dict>
    </dict>
  </array>
  <key>WFWorkflowImportQuestions</key>
  <array/>
  <key>WFWorkflowName</key>
  <string>Save to Analogue</string>
</dict>
</plist>`;
}

const RECURRENCE_FIELDS = [
  "name",
  "color",
  "description",
  "eisenhowerQuadrant",
  "reminder",
  "startTime",
  "endDate",
  "endTime",
  "done",
];

const TEMPLATE_FIELDS = [
  "name",
  "color",
  "description",
  "eisenhowerQuadrant",
  "startTime",
  "endTime",
  "horizonDays",
];

// Fields that live ONLY inside the JSON repeatTemplate blob and must never
// be passed straight to db.update() on the tasks row (they aren't columns).
const TEMPLATE_ONLY_FIELDS = new Set(["horizonDays"]);

function buildTemplateData(source) {
  const out = {};
  for (const f of TEMPLATE_FIELDS) {
    if (source[f] !== undefined) out[f] = source[f];
  }
  return out;
}

function parseTemplate(jsonStr) {
  if (!jsonStr) return null;
  try { return JSON.parse(jsonStr); } catch { return null; }
}

// Returns { ok, value, error }. `value` is either a clamped integer (within
// [MIN_HORIZON_DAYS, MAX_HORIZON_DAYS]) or null when the user is clearing
// the per-series override to fall back to the global default.
function normalizeHorizonDays(raw) {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }
  const n = typeof raw === "number" ? raw : parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    return { ok: false, error: "horizonDays must be a number" };
  }
  return { ok: true, value: clampHorizonDays(n) };
}

async function getSeriesRowIdsAtOrAfter(uid, seriesId, cutoffDateStr) {
  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.repeatSeriesId, seriesId), eq(tasks.uid, uid)));
  return rows
    .filter((r) => r.date && compareDateStrings(r.date, cutoffDateStr) >= 0)
    .map((r) => r.id);
}

router.get("/api/tasks", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    try {
      await materializeSeriesForUser(uid);
    } catch (e) {
      console.error("Materialize series error:", e.message);
    }
    const userTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.uid, uid))
      .orderBy(tasks.order);
    const allSubtasks = await db.select().from(subtasks).orderBy(subtasks.order);
    const allFiles = await db.select(taskFileCols).from(taskFiles);
    const subMap = {};
    for (const s of allSubtasks) {
      if (!subMap[s.taskId]) subMap[s.taskId] = [];
      subMap[s.taskId].push(s);
    }
    const fileMap = {};
    for (const f of allFiles) {
      if (!fileMap[f.taskId]) fileMap[f.taskId] = [];
      fileMap[f.taskId].push(f);
    }
    const result = userTasks.map(t => ({ ...t, subtasks: subMap[t.id] || [], files: fileMap[t.id] || [] }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/tasks", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { name, color, date, done, order, description, eisenhowerQuadrant, reminder, startTime, endDate, endTime, repeatPattern, repeatInterval, repeatEndedAt, horizonDays } = req.body;

    let seriesId = null;
    let anchorDate = null;
    let normalizedPattern = null;
    let normalizedInterval = null;
    if (repeatPattern !== undefined && repeatPattern !== null && repeatPattern !== "") {
      if (!isValidPattern(repeatPattern)) {
        return res.status(400).json({ error: "Invalid repeat pattern" });
      }
      if (!date || typeof date !== "string" || !parseDateStr(date)) {
        return res.status(400).json({ error: "Cannot set repeat on a task without a calendar date" });
      }
      normalizedPattern = repeatPattern;
      normalizedInterval = repeatPattern === "every_n_days"
        ? Math.max(1, parseInt(repeatInterval, 10) || 1)
        : null;
      seriesId = newSeriesId();
      anchorDate = date;
    }

    let normalizedHorizonDays = null;
    if (seriesId && horizonDays !== undefined) {
      const result = normalizeHorizonDays(horizonDays);
      if (!result.ok) return res.status(400).json({ error: result.error });
      normalizedHorizonDays = result.value;
    }

    let normalizedRepeatEndedAt = null;
    if (seriesId && repeatEndedAt) {
      if (typeof repeatEndedAt !== "string" || !parseDateStr(repeatEndedAt)) {
        return res.status(400).json({ error: "Invalid end date" });
      }
      if (compareDateStrings(repeatEndedAt, anchorDate) < 0) {
        return res.status(400).json({ error: "End date cannot be before the start of the series" });
      }
      normalizedRepeatEndedAt = repeatEndedAt;
    }

    const templateJson = seriesId
      ? JSON.stringify(buildTemplateData({
          name,
          color: color || "white text-black dark:text-white dark:bg-black",
          description: description || "",
          eisenhowerQuadrant: eisenhowerQuadrant || null,
          startTime: startTime || null,
          endTime: endTime || null,
          ...(normalizedHorizonDays != null ? { horizonDays: normalizedHorizonDays } : {}),
        }))
      : null;

    const [task] = await db
      .insert(tasks)
      .values({
        uid,
        name,
        color: color || "white text-black dark:text-white dark:bg-black",
        date,
        done: done || false,
        order: order || 0,
        description: description || "",
        eisenhowerQuadrant: eisenhowerQuadrant || null,
        reminder: reminder || null,
        startTime: startTime || null,
        endDate: endDate || null,
        endTime: endTime || null,
        repeatPattern: normalizedPattern,
        repeatInterval: normalizedInterval,
        repeatSeriesId: seriesId,
        repeatAnchorDate: anchorDate,
        repeatEndedAt: normalizedRepeatEndedAt,
        repeatTemplate: templateJson,
      })
      .returning();

    if (seriesId) {
      try {
        await materializeSeriesForUser(uid);
      } catch (e) {
        console.error("Materialize after create error:", e.message);
      }
      invalidateRecurrenceUserCache();
    }
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/tasks/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const taskId = parseInt(req.params.id);
    const [existing] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.uid, uid)));
    if (!existing) return res.status(404).json({ error: "Task not found" });

    const body = { ...req.body };
    const applyTo = body.applyTo || (req.query && req.query.applyTo) || "one";
    delete body.applyTo;

    const horizonDaysProvided = Object.prototype.hasOwnProperty.call(body, "horizonDays");
    let normalizedHorizonDays;
    if (horizonDaysProvided) {
      const result = normalizeHorizonDays(body.horizonDays);
      if (!result.ok) return res.status(400).json({ error: result.error });
      normalizedHorizonDays = result.value;
      // Canonicalize the value so the template-patch loop below sees the
      // clamped form, and so the value never reaches db.update on a column
      // that doesn't exist (we strip it from singleSet later).
      body.horizonDays = normalizedHorizonDays;
    }

    const repeatPatternProvided = Object.prototype.hasOwnProperty.call(body, "repeatPattern");
    if (repeatPatternProvided) {
      const newPattern = body.repeatPattern;
      if (!isValidPattern(newPattern)) {
        return res.status(400).json({ error: "Invalid repeat pattern" });
      }
      if (newPattern && !existing.repeatSeriesId) {
        const baseDate = body.date || existing.date;
        if (!baseDate || !parseDateStr(baseDate)) {
          return res.status(400).json({ error: "Cannot set repeat on a task without a calendar date" });
        }
        body.repeatSeriesId = newSeriesId();
        body.repeatAnchorDate = baseDate;
        body.repeatInterval = newPattern === "every_n_days"
          ? Math.max(1, parseInt(body.repeatInterval ?? existing.repeatInterval, 10) || 1)
          : null;
        body.repeatEndedAt = null;
        body.repeatTemplate = JSON.stringify(buildTemplateData({ ...existing, ...body }));
      } else if (!newPattern && existing.repeatSeriesId) {
        body.repeatPattern = null;
        body.repeatInterval = null;
        body.repeatSeriesId = null;
        body.repeatAnchorDate = null;
        body.repeatEndedAt = null;
        body.repeatTemplate = null;
      } else if (newPattern && existing.repeatSeriesId) {
        body.repeatInterval = newPattern === "every_n_days"
          ? Math.max(1, parseInt(body.repeatInterval ?? existing.repeatInterval, 10) || 1)
          : null;
      }
    }

    const repeatEndedAtProvided =
      Object.prototype.hasOwnProperty.call(body, "repeatEndedAt") && !repeatPatternProvided;
    if (repeatEndedAtProvided) {
      const v = body.repeatEndedAt;
      if (v === "" || v === null || v === undefined) {
        body.repeatEndedAt = null;
      } else if (typeof v !== "string" || !parseDateStr(v)) {
        return res.status(400).json({ error: "Invalid end date" });
      } else if (existing.repeatAnchorDate && compareDateStrings(v, existing.repeatAnchorDate) < 0) {
        return res.status(400).json({ error: "End date cannot be before the start of the series" });
      }
    }

    const isSeries = !!existing.repeatSeriesId;
    const dateChanged = Object.prototype.hasOwnProperty.call(body, "date") && body.date !== existing.date;

    if (isSeries && (applyTo === "series" || applyTo === "future")) {
      const propagated = {};
      for (const f of RECURRENCE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(body, f)) propagated[f] = body[f];
      }
      if (repeatPatternProvided) {
        for (const f of ["repeatPattern", "repeatInterval", "repeatAnchorDate", "repeatEndedAt", "repeatSeriesId", "repeatTemplate"]) {
          if (Object.prototype.hasOwnProperty.call(body, f)) propagated[f] = body[f];
        }
      } else if (repeatEndedAtProvided) {
        propagated.repeatEndedAt = body.repeatEndedAt;
      }
      const templatePatch = {};
      for (const f of TEMPLATE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(body, f)) templatePatch[f] = body[f];
      }
      if (Object.keys(templatePatch).length > 0) {
        const existingTpl = parseTemplate(existing.repeatTemplate) || buildTemplateData(existing);
        const mergedTpl = { ...existingTpl, ...templatePatch };
        propagated.repeatTemplate = JSON.stringify(mergedTpl);
      }
      let runUpdate = true;
      const conditions = [eq(tasks.repeatSeriesId, existing.repeatSeriesId), eq(tasks.uid, uid)];
      if (applyTo === "future") {
        const tz = await getUserTimezone(uid);
        const todayStr = todayInTz(tz);
        const cutoff = compareDateStrings(existing.date, todayStr) > 0 ? existing.date : todayStr;
        const ids = await getSeriesRowIdsAtOrAfter(uid, existing.repeatSeriesId, cutoff);
        if (ids.length === 0) runUpdate = false;
        else conditions.push(inArray(tasks.id, ids));
      }
      if (runUpdate && Object.keys(propagated).length > 0) {
        await db.update(tasks).set(propagated).where(and(...conditions));
      }
    }

    // Horizon edits only make sense at the series level (they control how
    // far ahead the scheduler materializes future occurrences). If the
    // caller sent horizonDays with applyTo='one' on a series, fold the
    // change into the series template so the scheduler picks it up; for a
    // non-series task we silently drop it.
    if (horizonDaysProvided && isSeries && applyTo === "one") {
      const existingTpl = parseTemplate(existing.repeatTemplate) || buildTemplateData(existing);
      const mergedTpl = { ...existingTpl };
      if (normalizedHorizonDays == null) delete mergedTpl.horizonDays;
      else mergedTpl.horizonDays = normalizedHorizonDays;
      await db
        .update(tasks)
        .set({ repeatTemplate: JSON.stringify(mergedTpl) })
        .where(and(eq(tasks.repeatSeriesId, existing.repeatSeriesId), eq(tasks.uid, uid)));
    }

    const singleSet = { ...body };
    if (isSeries && (applyTo === "series" || applyTo === "future") && !dateChanged) {
      for (const f of RECURRENCE_FIELDS) delete singleSet[f];
    }
    // Template-only fields (e.g. horizonDays) live inside repeatTemplate JSON,
    // not as columns on the tasks row — drop them before the row update.
    for (const f of TEMPLATE_ONLY_FIELDS) delete singleSet[f];
    if (Object.keys(singleSet).length > 0) {
      await db.update(tasks).set(singleSet).where(eq(tasks.id, taskId));
    }

    let [refreshed] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId));

    // When a series end date is set (or shortened) with series scope,
    // prune any future instances that fall strictly after that date so
    // the visible series matches the new bound. Pruning is intentionally
    // gated on applyTo === 'series' to avoid destructive cross-scope
    // side effects when the caller is editing only one row or "future".
    const seriesIdForPrune = existing.repeatSeriesId || refreshed?.repeatSeriesId;
    const endedAtForPrune = repeatEndedAtProvided
      ? body.repeatEndedAt
      : (repeatPatternProvided && Object.prototype.hasOwnProperty.call(body, "repeatEndedAt")
          ? body.repeatEndedAt
          : undefined);
    if (seriesIdForPrune && endedAtForPrune && applyTo === "series") {
      const seriesRows = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.repeatSeriesId, seriesIdForPrune), eq(tasks.uid, uid)));
      const idsAfter = seriesRows
        .filter((r) => r.date && compareDateStrings(r.date, endedAtForPrune) > 0)
        .map((r) => r.id);
      if (idsAfter.length > 0) {
        await db.delete(tasks).where(and(eq(tasks.uid, uid), inArray(tasks.id, idsAfter)));
        if (idsAfter.includes(taskId)) {
          refreshed = undefined;
        }
      }
    }

    if (refreshed && refreshed.repeatSeriesId) {
      try {
        await materializeSeriesForUser(uid);
      } catch (e) {
        console.error("Materialize after update error:", e.message);
      }
    }
    // If the recurrence pattern was added or removed, this user's bucket
    // membership may have changed — let the scheduler re-discover it.
    if (repeatPatternProvided && (!!existing.repeatSeriesId !== !!refreshed?.repeatSeriesId)) {
      invalidateRecurrenceUserCache();
    }
    res.json(refreshed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/tasks/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const taskId = parseInt(req.params.id);
    const [existing] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.uid, uid)));
    if (!existing) return res.status(404).json({ error: "Task not found" });

    const scope = (req.query && req.query.scope) || "one";

    if (existing.repeatSeriesId && (scope === "series" || scope === "future")) {
      if (scope === "future") {
        const ids = await getSeriesRowIdsAtOrAfter(uid, existing.repeatSeriesId, existing.date);
        if (ids.length > 0) {
          await db.delete(tasks).where(and(eq(tasks.uid, uid), inArray(tasks.id, ids)));
        }
        const remaining = await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.repeatSeriesId, existing.repeatSeriesId), eq(tasks.uid, uid)));
        if (remaining.length > 0) {
          const yesterday = parseDateStr(existing.date);
          if (yesterday) {
            yesterday.setDate(yesterday.getDate() - 1);
            const endStr = formatDateStr(yesterday);
            await db
              .update(tasks)
              .set({ repeatEndedAt: endStr })
              .where(and(eq(tasks.repeatSeriesId, existing.repeatSeriesId), eq(tasks.uid, uid)));
          }
        }
      } else {
        await db
          .delete(tasks)
          .where(and(eq(tasks.repeatSeriesId, existing.repeatSeriesId), eq(tasks.uid, uid)));
      }
      // The user's recurring-task footprint changed; let the scheduler
      // re-discover whether they still belong in the bucket.
      invalidateRecurrenceUserCache();
      return res.json({ success: true });
    }

    await db
      .update(tasks)
      .set({ order: sql`${tasks.order} - 1` })
      .where(
        and(
          eq(tasks.date, existing.date),
          eq(tasks.uid, uid),
          gt(tasks.order, existing.order)
        )
      );

    if (existing.repeatSeriesId && existing.date) {
      try {
        await db
          .insert(taskRepeatExceptions)
          .values({ uid, seriesId: existing.repeatSeriesId, date: existing.date })
          .onConflictDoNothing();
      } catch (e) {
        console.error("Repeat exception insert error:", e.message);
      }
    }
    await db.delete(tasks).where(eq(tasks.id, taskId));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List per-series skip dates ("exceptions"). The route accepts any task id
// from a recurring series; we look up the series via that row.
router.get("/api/tasks/:id/repeat-exceptions", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const taskId = parseInt(req.params.id);
    const [existing] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.uid, uid)));
    if (!existing) return res.status(404).json({ error: "Task not found" });
    if (!existing.repeatSeriesId) return res.json([]);
    const rows = await db
      .select()
      .from(taskRepeatExceptions)
      .where(and(
        eq(taskRepeatExceptions.uid, uid),
        eq(taskRepeatExceptions.seriesId, existing.repeatSeriesId),
      ));
    rows.sort((a, b) => compareDateStrings(a.date, b.date));
    res.json(rows.map((r) => ({ id: r.id, date: r.date, createdAt: r.createdAt })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a skip date for the series; also delete any already-materialized row
// on that date so the scheduler doesn't re-create it.
router.post("/api/tasks/:id/repeat-exceptions", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const taskId = parseInt(req.params.id);
    const [existing] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.uid, uid)));
    if (!existing) return res.status(404).json({ error: "Task not found" });
    if (!existing.repeatSeriesId) return res.status(400).json({ error: "Task is not part of a recurring series" });
    const dateStr = req.body && req.body.date;
    if (!dateStr || typeof dateStr !== "string" || !parseDateStr(dateStr)) {
      return res.status(400).json({ error: "Invalid date" });
    }
    await db
      .insert(taskRepeatExceptions)
      .values({ uid, seriesId: existing.repeatSeriesId, date: dateStr })
      .onConflictDoNothing();
    await db
      .delete(tasks)
      .where(and(
        eq(tasks.uid, uid),
        eq(tasks.repeatSeriesId, existing.repeatSeriesId),
        eq(tasks.date, dateStr),
      ));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a skip date so the series re-materializes that occurrence on the
// next scheduler tick (or immediately, since we trigger materialization).
router.delete("/api/tasks/:id/repeat-exceptions/:date", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const taskId = parseInt(req.params.id);
    const dateStr = req.params.date;
    const [existing] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.uid, uid)));
    if (!existing) return res.status(404).json({ error: "Task not found" });
    if (!existing.repeatSeriesId) return res.status(400).json({ error: "Task is not part of a recurring series" });
    if (!parseDateStr(dateStr)) return res.status(400).json({ error: "Invalid date" });
    await db
      .delete(taskRepeatExceptions)
      .where(and(
        eq(taskRepeatExceptions.uid, uid),
        eq(taskRepeatExceptions.seriesId, existing.repeatSeriesId),
        eq(taskRepeatExceptions.date, dateStr),
      ));
    try {
      await materializeSeriesForUser(uid);
    } catch (e) {
      console.error("Materialize after un-skip error:", e.message);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change the series anchor date. Updates repeatAnchorDate on all rows in
// the series and removes any not-done future occurrences (date >= today)
// so they re-materialize from the new cadence. Past and done occurrences
// are preserved.
router.put("/api/tasks/:id/repeat-anchor", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const taskId = parseInt(req.params.id);
    const [existing] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.uid, uid)));
    if (!existing) return res.status(404).json({ error: "Task not found" });
    if (!existing.repeatSeriesId) return res.status(400).json({ error: "Task is not part of a recurring series" });
    const newAnchor = req.body && req.body.repeatAnchorDate;
    if (!newAnchor || typeof newAnchor !== "string" || !parseDateStr(newAnchor)) {
      return res.status(400).json({ error: "Invalid anchor date" });
    }
    if (existing.repeatEndedAt && compareDateStrings(newAnchor, existing.repeatEndedAt) > 0) {
      return res.status(400).json({ error: "Anchor date cannot be after the series end date" });
    }

    await db
      .update(tasks)
      .set({ repeatAnchorDate: newAnchor })
      .where(and(eq(tasks.repeatSeriesId, existing.repeatSeriesId), eq(tasks.uid, uid)));

    const tz = await getUserTimezone(uid);
    const todayStr = todayInTz(tz);
    const seriesRows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.repeatSeriesId, existing.repeatSeriesId), eq(tasks.uid, uid)));
    const futureUndoneIds = seriesRows
      .filter((r) => r.date && !r.done && compareDateStrings(r.date, todayStr) >= 0)
      .map((r) => r.id);
    if (futureUndoneIds.length > 0) {
      await db.delete(tasks).where(and(eq(tasks.uid, uid), inArray(tasks.id, futureUndoneIds)));
    }

    try {
      await materializeSeriesForUser(uid);
    } catch (e) {
      console.error("Materialize after anchor change error:", e.message);
    }
    res.json({ success: true, repeatAnchorDate: newAnchor });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/tasks/:id/toggle", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const taskId = parseInt(req.params.id);
    const [existing] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.uid, uid)));
    if (!existing) return res.status(404).json({ error: "Task not found" });

    const scope = (req.query && req.query.scope) || (req.body && req.body.scope) || "one";
    const newDone = !existing.done;

    if (existing.repeatSeriesId && (scope === "series" || scope === "future")) {
      let runUpdate = true;
      const conditions = [eq(tasks.repeatSeriesId, existing.repeatSeriesId), eq(tasks.uid, uid)];
      if (scope === "future") {
        const tz = await getUserTimezone(uid);
        const todayStr = todayInTz(tz);
        const cutoff = compareDateStrings(existing.date, todayStr) > 0 ? existing.date : todayStr;
        const ids = await getSeriesRowIdsAtOrAfter(uid, existing.repeatSeriesId, cutoff);
        if (ids.length === 0) runUpdate = false;
        else conditions.push(inArray(tasks.id, ids));
      }
      if (runUpdate) {
        await db.update(tasks).set({ done: newDone }).where(and(...conditions));
      }
    } else {
      await db.update(tasks).set({ done: newDone }).where(eq(tasks.id, taskId));
    }

    const [updated] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/tasks/reorder", isAuthenticated, async (req, res) => {
  try {
    const { tasks: reordered } = req.body;
    for (let i = 0; i < reordered.length; i++) {
      await db
        .update(tasks)
        .set({ order: i })
        .where(and(eq(tasks.id, reordered[i].id), eq(tasks.uid, getUserId(req))));
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/tasks", isAuthenticated, async (req, res) => {
  try {
    await db.delete(tasks).where(eq(tasks.uid, getUserId(req)));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/tasks/search", isAuthenticated, async (req, res) => {
  try {
    const query = req.query.q || "";
    if (!query) return res.json([]);

    const userTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.uid, getUserId(req)));

    const filtered = userTasks
      .filter((task) => levenshtein(task.name, query) <= 3)
      .slice(0, 10);
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/tasks/:id/subtasks", isAuthenticated, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const result = await db.select().from(subtasks).where(eq(subtasks.taskId, taskId)).orderBy(subtasks.order);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/tasks/:id/subtasks", isAuthenticated, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const { name, order } = req.body;
    const [sub] = await db.insert(subtasks).values({ taskId, name, done: false, order: order || 0 }).returning();
    res.json(sub);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/subtasks/:id", isAuthenticated, async (req, res) => {
  try {
    const subId = parseInt(req.params.id);
    const [updated] = await db.update(subtasks).set(req.body).where(eq(subtasks.id, subId)).returning();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/subtasks/:id", isAuthenticated, async (req, res) => {
  try {
    const subId = parseInt(req.params.id);
    await db.delete(subtasks).where(eq(subtasks.id, subId));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/tasks/:id/files", isAuthenticated, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const result = await db.select(taskFileCols).from(taskFiles).where(eq(taskFiles.taskId, taskId)).orderBy(taskFiles.createdAt);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/tasks/:id/files", isAuthenticated, upload.single("file"), async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });
    const filename = `${crypto.randomUUID()}${path.extname(file.originalname)}`;
    const dataBase64 = file.buffer.toString("base64");
    const url = `/api/file-data/${filename}`;
    const [saved] = await db.insert(taskFiles).values({
      taskId, filename, originalName: file.originalname, url,
      mimeType: file.mimetype || "", data: dataBase64,
    }).returning();
    res.json({ id: saved.id, taskId: saved.taskId, filename: saved.filename, originalName: saved.originalName, url: saved.url, mimeType: saved.mimeType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/files/:id", isAuthenticated, async (req, res) => {
  try {
    const fileId = parseInt(req.params.id);
    await db.delete(taskFiles).where(eq(taskFiles.id, fileId));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/month-focus/:yearMonth", isAuthenticated, async (req, res) => {
  try {
    const ym = req.params.yearMonth;
    const [existing] = await db.select().from(monthFocus)
      .where(and(eq(monthFocus.uid, getUserId(req)), eq(monthFocus.yearMonth, ym)));
    res.json(existing || { line1: "", line2: "", line3: "" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/month-focus/:yearMonth", isAuthenticated, async (req, res) => {
  try {
    const ym = req.params.yearMonth;
    const { line1, line2, line3 } = req.body;
    const [existing] = await db.select().from(monthFocus)
      .where(and(eq(monthFocus.uid, getUserId(req)), eq(monthFocus.yearMonth, ym)));
    if (existing) {
      const [updated] = await db.update(monthFocus)
        .set({ line1: line1 || "", line2: line2 || "", line3: line3 || "" })
        .where(eq(monthFocus.id, existing.id)).returning();
      res.json(updated);
    } else {
      const [created] = await db.insert(monthFocus)
        .values({ uid: getUserId(req), yearMonth: ym, line1: line1 || "", line2: line2 || "", line3: line3 || "" })
        .returning();
      res.json(created);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/cheers", isAuthenticated, async (req, res) => {
  try {
    const result = await db.select().from(cheers).where(eq(cheers.uid, getUserId(req)));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/cheers", isAuthenticated, async (req, res) => {
  try {
    const { text, color, size, x, y } = req.body;
    const [created] = await db.insert(cheers).values({
      uid: getUserId(req), text, color: color || "blue", size: size || "md",
      x: x ?? 50, y: y ?? 50,
    }).returning();
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/cheers/:id", isAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(cheers).where(and(eq(cheers.id, id), eq(cheers.uid, getUserId(req))));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/memos", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const userMemos = await db.select().from(memos).where(eq(memos.uid, uid)).orderBy(sql`${memos.pinned} DESC, ${memos.updatedAt} DESC`);
    const allTags = await db.select().from(memoTags);
    const allFiles = await db.select(memoFileCols).from(memoFiles);
    const tagMap = {};
    for (const t of allTags) {
      if (!tagMap[t.memoId]) tagMap[t.memoId] = [];
      tagMap[t.memoId].push(t);
    }
    const fileMap = {};
    for (const f of allFiles) {
      if (!fileMap[f.memoId]) fileMap[f.memoId] = [];
      fileMap[f.memoId].push(f);
    }
    const result = userMemos.map(m => ({
      ...m,
      tags: (tagMap[m.id] || []).map(t => t.tag),
      files: fileMap[m.id] || [],
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function rebuildMemoLinks(uid, memoId, content) {
  await db.delete(memoLinks).where(eq(memoLinks.fromMemoId, memoId));
  if (!content) return;
  const matches = [...String(content).matchAll(/\[\[([^\]]+)\]\]/g)];
  if (matches.length === 0) return;
  const titles = [...new Set(matches.map(m => m[1].trim()).filter(Boolean))];
  if (titles.length === 0) return;
  const targets = await db.select({ id: memos.id, title: memos.title }).from(memos)
    .where(and(eq(memos.uid, uid), inArray(memos.title, titles)));
  const seen = new Set();
  for (const t of targets) {
    if (t.id === memoId || seen.has(t.id)) continue;
    seen.add(t.id);
    try {
      await db.insert(memoLinks).values({ uid, fromMemoId: memoId, toMemoId: t.id });
    } catch {}
  }
}

router.post("/api/memos", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { title, content, date, color, tags, noteType, isHandMaintained } = req.body;
    const [memo] = await db.insert(memos).values({
      uid,
      title: title || "",
      content: content || "",
      date: date || null,
      color: color || "white",
      noteType: noteType || null,
      isHandMaintained: !!isHandMaintained,
    }).returning();
    if (tags && tags.length > 0) {
      for (const tag of tags) {
        await db.insert(memoTags).values({ memoId: memo.id, tag });
      }
    }
    await rebuildMemoLinks(uid, memo.id, memo.content);
    const memoTagsList = await db.select().from(memoTags).where(eq(memoTags.memoId, memo.id));
    if (noteType === "digest") {
      try {
        const { enqueueRssDigestAutoIngest } = await import("./wikiAutoIngest.js");
        enqueueRssDigestAutoIngest({ uid, title: memo.title || "(untitled digest)", content: memo.content || "" });
      } catch {}
    }
    res.json({ ...memo, tags: memoTagsList.map(t => t.tag), files: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/video-notes/import", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const url = String(req.body?.url || "").trim();
    if (!url) return res.status(400).json({ error: "url is required" });

    let loaded;
    try {
      const acceptLang = String(req.headers["accept-language"] || "")
        .split(",")[0]
        .split(";")[0]
        .trim();
      loaded = await loadVideo(url, { openai, uiLang: acceptLang || undefined });
    } catch (e) {
      if (e instanceof VideoNoteError) {
        const friendly = {
          BAD_URL: "Unsupported link. Paste a YouTube or Bilibili video URL.",
          NO_CAPTIONS: "This video has no captions and audio transcription failed.",
          TOO_LONG: "This video is over 30 minutes and has no captions, so we skipped audio transcription. Try a shorter clip.",
          PRIVATE: "This video is private or restricted, so we can't read it.",
          NOT_FOUND: "Couldn't find that video.",
          FETCH_FAILED: "Couldn't reach the video service. Please try again.",
        }[e.code] || e.message;
        return res.status(400).json({ error: friendly, code: e.code });
      }
      throw e;
    }

    let body;
    try {
      body = await summarizeTranscript(openai, loaded);
    } catch (e) {
      const msg = e instanceof VideoNoteError ? e.message : "Summarization failed.";
      // Upstream/AI failures: surface as 502 so the client can retry, not as a user-correctable 400.
      return res.status(502).json({ error: msg });
    }

    const [memo] = await db.insert(memos).values({
      uid,
      title: loaded.meta.title || `${loaded.platform} ${loaded.id}`,
      content: body,
      color: "white",
      noteType: "video-note",
    }).returning();

    await db.insert(memoTags).values({ memoId: memo.id, tag: "video-note" });
    await db.insert(memoTags).values({ memoId: memo.id, tag: loaded.platform });
    await rebuildMemoLinks(uid, memo.id, memo.content);

    try {
      const { enqueueAutoIngest } = await import("./wikiAutoIngest.js");
      enqueueAutoIngest({ uid, trigger: "video-transcript", input: `Video transcript: ${memo.title}\n\n${memo.content}` });
    } catch {}

    res.json({ memoId: memo.id, memoTitle: memo.title, platform: loaded.platform });
  } catch (err) {
    console.error("video-notes/import error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/memos/:id", isAuthenticated, async (req, res) => {
  try {
    const memoId = parseInt(req.params.id);
    const [existing] = await db.select().from(memos)
      .where(and(eq(memos.id, memoId), eq(memos.uid, getUserId(req))));
    if (!existing) return res.status(404).json({ error: "Memo not found" });

    const { title, content, date, color, pinned, tags, noteType, isHandMaintained } = req.body;
    const updates = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (date !== undefined) updates.date = date;
    if (color !== undefined) updates.color = color;
    if (pinned !== undefined) updates.pinned = pinned;
    if (noteType !== undefined) updates.noteType = noteType;
    if (isHandMaintained !== undefined) updates.isHandMaintained = !!isHandMaintained;

    const [updated] = await db.update(memos).set(updates).where(eq(memos.id, memoId)).returning();

    if (tags !== undefined) {
      await db.delete(memoTags).where(eq(memoTags.memoId, memoId));
      for (const tag of tags) {
        await db.insert(memoTags).values({ memoId, tag });
      }
    }

    if (content !== undefined) {
      await rebuildMemoLinks(getUserId(req), memoId, updated.content);
    }

    const memoTagsList = await db.select().from(memoTags).where(eq(memoTags.memoId, memoId));
    const memoFilesList = await db.select(memoFileCols).from(memoFiles).where(eq(memoFiles.memoId, memoId));
    res.json({ ...updated, tags: memoTagsList.map(t => t.tag), files: memoFilesList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/memos/:id", isAuthenticated, async (req, res) => {
  try {
    const memoId = parseInt(req.params.id);
    const [existing] = await db.select().from(memos)
      .where(and(eq(memos.id, memoId), eq(memos.uid, getUserId(req))));
    if (!existing) return res.status(404).json({ error: "Memo not found" });
    await db.delete(memoTags).where(eq(memoTags.memoId, memoId));
    await db.delete(memoFiles).where(eq(memoFiles.memoId, memoId));
    await db.delete(memoLinks).where(sql`${memoLinks.fromMemoId} = ${memoId} OR ${memoLinks.toMemoId} = ${memoId}`);
    await db.delete(memos).where(eq(memos.id, memoId));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/memos/:id/files", isAuthenticated, upload.single("file"), async (req, res) => {
  try {
    const memoId = parseInt(req.params.id);
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });
    const filename = `${crypto.randomUUID()}${path.extname(file.originalname)}`;
    const dataBase64 = file.buffer.toString("base64");
    const url = `/api/file-data/${filename}`;
    const [saved] = await db.insert(memoFiles).values({
      memoId, filename, originalName: file.originalname,
      url, mimeType: file.mimetype || "", data: dataBase64,
    }).returning();
    res.json({ id: saved.id, memoId: saved.memoId, filename: saved.filename, originalName: saved.originalName, url: saved.url, mimeType: saved.mimeType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/memo-files/:id", isAuthenticated, async (req, res) => {
  try {
    const fileId = parseInt(req.params.id);
    await db.delete(memoFiles).where(eq(memoFiles.id, fileId));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/memos/search", isAuthenticated, async (req, res) => {
  try {
    const query = (req.query.q || "").trim();
    if (!query) return res.json([]);
    const uid = getUserId(req);
    const pattern = `%${query}%`;
    const userMemos = await db.select().from(memos)
      .where(and(
        eq(memos.uid, uid),
        sql`(LOWER(${memos.title}) LIKE LOWER(${pattern}) OR LOWER(${memos.content}) LIKE LOWER(${pattern}))`
      ))
      .orderBy(sql`${memos.pinned} DESC, ${memos.updatedAt} DESC`);
    const memoIds = userMemos.map(m => m.id);
    if (memoIds.length === 0) return res.json([]);
    const allTags = await db.select().from(memoTags).where(sql`${memoTags.memoId} IN (${sql.join(memoIds.map(id => sql`${id}`), sql`, `)})`);
    const allFiles = await db.select(memoFileCols).from(memoFiles).where(sql`${memoFiles.memoId} IN (${sql.join(memoIds.map(id => sql`${id}`), sql`, `)})`);
    const tagMap = {};
    for (const t of allTags) {
      if (!tagMap[t.memoId]) tagMap[t.memoId] = [];
      tagMap[t.memoId].push(t);
    }
    const fileMap = {};
    for (const f of allFiles) {
      if (!fileMap[f.memoId]) fileMap[f.memoId] = [];
      fileMap[f.memoId].push(f);
    }
    const result = userMemos.map(m => ({
      ...m,
      tags: (tagMap[m.id] || []).map(t => t.tag),
      files: fileMap[m.id] || [],
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/memos/titles", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const userMemos = await db.select({ id: memos.id, title: memos.title }).from(memos)
      .where(eq(memos.uid, uid))
      .orderBy(sql`${memos.updatedAt} DESC`);
    res.json(userMemos.filter(m => m.title && m.title.trim()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/memos/:id/backlinks", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const memoId = parseInt(req.params.id);
    const [targetMemo] = await db.select({ id: memos.id, title: memos.title }).from(memos)
      .where(and(eq(memos.id, memoId), eq(memos.uid, uid)));
    if (!targetMemo) return res.json([]);
    const linkRows = await db.select({ fromMemoId: memoLinks.fromMemoId }).from(memoLinks)
      .where(and(eq(memoLinks.uid, uid), eq(memoLinks.toMemoId, memoId)));
    const idSet = new Set(linkRows.map(r => r.fromMemoId));
    if (targetMemo.title) {
      const escapedTitle = targetMemo.title.replace(/[%_\\]/g, '\\$&');
      const pattern = `%[[${escapedTitle}]]%`;
      const likeRows = await db.select({ id: memos.id }).from(memos)
        .where(and(
          eq(memos.uid, uid),
          sql`${memos.content} LIKE ${pattern}`,
          sql`${memos.id} != ${memoId}`
        ));
      for (const r of likeRows) idSet.add(r.id);
    }
    const allIds = [...idSet].filter(id => id !== memoId);
    let result = [];
    if (allIds.length > 0) {
      result = await db.select({ id: memos.id, title: memos.title, color: memos.color }).from(memos)
        .where(and(eq(memos.uid, uid), inArray(memos.id, allIds)))
        .orderBy(sql`${memos.updatedAt} DESC`);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/memos/whiteboards-map", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const userMemoIds = await db.select({ id: memos.id }).from(memos).where(eq(memos.uid, uid));
    if (userMemoIds.length === 0) return res.json({});
    const ids = userMemoIds.map(m => m.id);
    const placements = await db.select({
      memoId: whiteboardMemos.memoId,
      whiteboardId: whiteboardMemos.whiteboardId,
    }).from(whiteboardMemos)
      .where(sql`${whiteboardMemos.memoId} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);
    if (placements.length === 0) return res.json({});
    const wbIds = [...new Set(placements.map(p => p.whiteboardId))];
    const boards = await db.select({ id: whiteboards.id, name: whiteboards.name }).from(whiteboards)
      .where(sql`${whiteboards.id} IN (${sql.join(wbIds.map(id => sql`${id}`), sql`, `)})`);
    const boardMap = {};
    for (const b of boards) boardMap[b.id] = b.name;
    const result = {};
    for (const p of placements) {
      if (!result[p.memoId]) result[p.memoId] = [];
      const name = boardMap[p.whiteboardId];
      if (name && !result[p.memoId].includes(name)) result[p.memoId].push(name);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/memos/graph", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const userMemos = await db.select({
      id: memos.id, title: memos.title, content: memos.content,
      color: memos.color, noteType: memos.noteType,
    }).from(memos).where(eq(memos.uid, uid));
    const userMemoIds = userMemos.map(m => m.id);
    const userTags = userMemoIds.length > 0
      ? await db.select().from(memoTags).where(inArray(memoTags.memoId, userMemoIds))
      : [];
    const tagMap = {};
    for (const t of userTags) {
      if (!tagMap[t.memoId]) tagMap[t.memoId] = [];
      tagMap[t.memoId].push(t.tag);
    }
    const titleToId = {};
    for (const m of userMemos) {
      if (m.title) titleToId[m.title] = m.id;
    }
    const nodes = userMemos.map(m => ({
      id: m.id,
      title: m.title || '(untitled)',
      color: m.color,
      noteType: m.noteType,
      tags: tagMap[m.id] || [],
    }));
    const edges = [];
    const edgeSet = new Set();
    for (const m of userMemos) {
      if (!m.content) continue;
      const linkRegex = /\[\[([^\]]+)\]\]/g;
      let match;
      while ((match = linkRegex.exec(m.content)) !== null) {
        const targetTitle = match[1];
        const targetId = titleToId[targetTitle];
        if (targetId && targetId !== m.id) {
          const key = [Math.min(m.id, targetId), Math.max(m.id, targetId)].join('-');
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push({ source: m.id, target: targetId });
          }
        }
      }
    }
    res.json({ nodes, edges });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/memos/by-date/:date", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const date = req.params.date;
    const dateMemos = await db.select().from(memos)
      .where(and(eq(memos.uid, uid), eq(memos.date, date)))
      .orderBy(memos.createdAt);
    if (dateMemos.length === 0) return res.json([]);
    const memoIds = dateMemos.map(m => m.id);
    const allTags = await db.select().from(memoTags);
    const allFiles = await db.select(memoFileCols).from(memoFiles);
    const tagMap = {};
    for (const t of allTags) {
      if (!tagMap[t.memoId]) tagMap[t.memoId] = [];
      tagMap[t.memoId].push(t.tag);
    }
    const fileMap = {};
    for (const f of allFiles) {
      if (!fileMap[f.memoId]) fileMap[f.memoId] = [];
      fileMap[f.memoId].push(f);
    }
    const result = dateMemos.map(m => ({
      ...m,
      tags: tagMap[m.id] || [],
      files: fileMap[m.id] || [],
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/user", isAuthenticated, async (req, res) => {
  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, getUserId(req)));
    const { password, pin, ...safeUser } = user;
    res.json({
      ...safeUser,
      hasPin: !!pin,
      tzExpandedGroups: parseTzExpandedGroups(user.tzExpandedGroups),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/user", isAuthenticated, async (req, res) => {
  try {
    const { name, darkMode, proteinGoal, carbsGoal, fatGoal, sodiumGoal, sodiumIsMax, dailySummaryEnabled, dailySummaryHour, dailySummaryMinute, dailyWeatherEnabled, wikiAutoIngestRssDigest, wikiAutoIngestVideoTranscript, wikiAutoIngestLineLog, wikiAutoIngestLast30days, wikiLintEnabled, wikiLintDow, wikiLintHour, wikiLintMinute } = req.body;
    const updates = {};
    let weeklyLintTouched = false;
    for (const [k, col] of [
      ["wikiAutoIngestRssDigest", "wikiAutoIngestRssDigest"],
      ["wikiAutoIngestVideoTranscript", "wikiAutoIngestVideoTranscript"],
      ["wikiAutoIngestLineLog", "wikiAutoIngestLineLog"],
      ["wikiAutoIngestLast30days", "wikiAutoIngestLast30days"],
    ]) {
      const v = { wikiAutoIngestRssDigest, wikiAutoIngestVideoTranscript, wikiAutoIngestLineLog, wikiAutoIngestLast30days }[k];
      if (v !== undefined) updates[col] = !!v;
    }
    if (wikiLintEnabled !== undefined) { updates.wikiLintEnabled = !!wikiLintEnabled; weeklyLintTouched = true; }
    if (wikiLintDow !== undefined) {
      const n = Number(wikiLintDow);
      if (!Number.isInteger(n) || n < 0 || n > 6) return res.status(400).json({ error: "Invalid wikiLintDow (0=Sun..6=Sat)" });
      updates.wikiLintDow = n; weeklyLintTouched = true;
    }
    if (wikiLintHour !== undefined) {
      const n = Number(wikiLintHour);
      if (!Number.isInteger(n) || n < 0 || n > 23) return res.status(400).json({ error: "Invalid wikiLintHour (0-23)" });
      updates.wikiLintHour = n; weeklyLintTouched = true;
    }
    if (wikiLintMinute !== undefined) {
      const n = Number(wikiLintMinute);
      if (!Number.isInteger(n) || n < 0 || n > 59) return res.status(400).json({ error: "Invalid wikiLintMinute (0-59)" });
      updates.wikiLintMinute = n; weeklyLintTouched = true;
    }
    if (name !== undefined) updates.name = name;
    if (darkMode !== undefined) updates.darkMode = darkMode;
    const macroFields = { proteinGoal, carbsGoal, fatGoal, sodiumGoal };
    for (const [k, v] of Object.entries(macroFields)) {
      if (v === undefined) continue;
      if (v === null || v === '') { updates[k] = null; continue; }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: `Invalid ${k}` });
      }
      updates[k] = Math.round(n);
    }
    if (sodiumIsMax !== undefined) updates.sodiumIsMax = !!sodiumIsMax;
    if (dailySummaryEnabled !== undefined) updates.dailySummaryEnabled = !!dailySummaryEnabled;
    if (dailyWeatherEnabled !== undefined) updates.dailyWeatherEnabled = !!dailyWeatherEnabled;
    if (dailySummaryHour !== undefined) {
      const n = Number(dailySummaryHour);
      if (!Number.isInteger(n) || n < 0 || n > 23) {
        return res.status(400).json({ error: 'Invalid dailySummaryHour (0-23)' });
      }
      updates.dailySummaryHour = n;
    }
    if (dailySummaryMinute !== undefined) {
      const m = Number(dailySummaryMinute);
      if (!Number.isInteger(m) || m < 0 || m > 59) {
        return res.status(400).json({ error: 'Invalid dailySummaryMinute (0-59)' });
      }
      updates.dailySummaryMinute = m;
    }
    if (req.body.timezone !== undefined) {
      const tz = req.body.timezone;
      if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) {
        return res.status(400).json({ error: 'Invalid timezone' });
      }
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
      } catch (e) {
        return res.status(400).json({ error: 'Invalid timezone identifier' });
      }
      updates.timezone = tz;
    }
    if (req.body.journalNudgeEnabled !== undefined) updates.journalNudgeEnabled = !!req.body.journalNudgeEnabled;
    if (req.body.sleepReminderEnabled !== undefined) updates.sleepReminderEnabled = !!req.body.sleepReminderEnabled;
    if (req.body.sleepReminderHour !== undefined) {
      const n = Number(req.body.sleepReminderHour);
      if (!Number.isInteger(n) || n < 0 || n > 23) return res.status(400).json({ error: "Invalid sleepReminderHour" });
      updates.sleepReminderHour = n;
    }
    if (req.body.sleepReminderMinute !== undefined) {
      const n = Number(req.body.sleepReminderMinute);
      if (!Number.isInteger(n) || n < 0 || n > 59) return res.status(400).json({ error: "Invalid sleepReminderMinute" });
      updates.sleepReminderMinute = n;
    }
    if (req.body.sleepCleanReminderEnabled !== undefined) updates.sleepCleanReminderEnabled = !!req.body.sleepCleanReminderEnabled;
    if (req.body.sleepCleanReminderDow !== undefined) {
      const n = Number(req.body.sleepCleanReminderDow);
      if (!Number.isInteger(n) || n < 0 || n > 6) return res.status(400).json({ error: "Invalid sleepCleanReminderDow (0=Sun..6=Sat)" });
      updates.sleepCleanReminderDow = n;
    }
    if (req.body.sleepCleanReminderHour !== undefined) {
      const n = Number(req.body.sleepCleanReminderHour);
      if (!Number.isInteger(n) || n < 0 || n > 23) return res.status(400).json({ error: "Invalid sleepCleanReminderHour" });
      updates.sleepCleanReminderHour = n;
    }
    if (req.body.sleepCleanReminderMinute !== undefined) {
      const n = Number(req.body.sleepCleanReminderMinute);
      if (!Number.isInteger(n) || n < 0 || n > 59) return res.status(400).json({ error: "Invalid sleepCleanReminderMinute" });
      updates.sleepCleanReminderMinute = n;
    }
    if (req.body.timezoneAutoBackfillHandled !== undefined) {
      updates.timezoneAutoBackfillHandledAt = req.body.timezoneAutoBackfillHandled === true ? new Date() : null;
    }
    if (req.body.showConfidenceChips !== undefined) {
      updates.showConfidenceChips = !!req.body.showConfidenceChips;
    }
    if (req.body.tzExpandedGroups !== undefined) {
      const sanitized = sanitizeTzExpandedGroupsInput(req.body.tzExpandedGroups);
      if (sanitized.error) {
        return res.status(400).json({ error: sanitized.error });
      }
      updates.tzExpandedGroups = JSON.stringify(sanitized.value);
      updates.tzExpandedGroupsUpdatedAt = new Date();
    }
    updates.updatedAt = new Date();

    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, getUserId(req)))
      .returning();

    if (
      updates.dailySummaryEnabled !== undefined ||
      updates.dailySummaryHour !== undefined ||
      updates.dailySummaryMinute !== undefined ||
      updates.timezone !== undefined
    ) {
      invalidateDailySummaryCache();
    }
    if (
      updates.dailyWeatherEnabled !== undefined ||
      updates.timezone !== undefined
    ) {
      invalidateDailyWeatherCache();
    }
    if (weeklyLintTouched || updates.timezone !== undefined) {
      invalidateWeeklyLintCache();
    }

    res.json({
      ...updated,
      lineLinked: !!updated?.lineUserId,
      tzExpandedGroups: parseTzExpandedGroups(updated?.tzExpandedGroups),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/user/last-weather-push", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const [user] = await db
      .select({ timezone: users.timezone, dailyWeatherEnabled: users.dailyWeatherEnabled })
      .from(users)
      .where(eq(users.id, uid))
      .limit(1);
    const tz = userTimezone(user);
    const dailyWeatherEnabled = user?.dailyWeatherEnabled ?? true;
    const [row] = await db
      .select({ sentAt: dailyWeatherSent.sentAt, dedupKey: dailyWeatherSent.dedupKey })
      .from(dailyWeatherSent)
      .where(eq(dailyWeatherSent.uid, uid))
      .orderBy(desc(dailyWeatherSent.sentAt))
      .limit(1);
    const nextPushAt = dailyWeatherEnabled
      ? getNextOccurrenceInTz(tz, WEATHER_TARGET_HOUR, WEATHER_TARGET_MINUTE).toISOString()
      : null;
    res.json({
      sentAt: row?.sentAt ? new Date(row.sentAt).toISOString() : null,
      dedupKey: row?.dedupKey || null,
      dailyWeatherEnabled,
      timezone: tz,
      targetHour: WEATHER_TARGET_HOUR,
      targetMinute: WEATHER_TARGET_MINUTE,
      nextPushAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/file-data/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    let file = await db.select().from(memoFiles).where(eq(memoFiles.filename, filename)).then(r => r[0]);
    if (!file) {
      file = await db.select().from(taskFiles).where(eq(taskFiles.filename, filename)).then(r => r[0]);
    }
    if (!file || !file.data) return res.status(404).send("Not found");
    const buffer = Buffer.from(file.data, "base64");
    res.set("Content-Type", file.mimeType || "application/octet-stream");
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.send(buffer);
  } catch (err) {
    res.status(500).send("Error");
  }
});

router.get("/api/whiteboard", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const [wb] = await db.select().from(whiteboards)
      .where(and(eq(whiteboards.userId, uid), eq(whiteboards.name, "default")));
    if (!wb) return res.json({ data: "{}" });
    res.json({ data: wb.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/whiteboard", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { data } = req.body;
    const [existing] = await db.select().from(whiteboards)
      .where(and(eq(whiteboards.userId, uid), eq(whiteboards.name, "default")));
    if (existing) {
      await db.update(whiteboards).set({ data, updatedAt: new Date() })
        .where(eq(whiteboards.id, existing.id));
    } else {
      await db.insert(whiteboards).values({ userId: uid, name: "default", data });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/whiteboards/overview", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const boards = await db.select({
      id: whiteboards.id, name: whiteboards.name, parentId: whiteboards.parentId,
      updatedAt: whiteboards.updatedAt, createdAt: whiteboards.createdAt,
    }).from(whiteboards).where(eq(whiteboards.userId, uid)).orderBy(whiteboards.createdAt);
    const boardIds = boards.map(b => b.id);
    const placements = boardIds.length === 0 ? [] : await db.select({
      id: whiteboardMemos.id, whiteboardId: whiteboardMemos.whiteboardId, memoId: whiteboardMemos.memoId,
      x: whiteboardMemos.x, y: whiteboardMemos.y, width: whiteboardMemos.width, height: whiteboardMemos.height,
    }).from(whiteboardMemos).where(inArray(whiteboardMemos.whiteboardId, boardIds));
    const sectionRows = boardIds.length === 0 ? [] : await db.select({
      id: whiteboardSections.id, whiteboardId: whiteboardSections.whiteboardId,
      x: whiteboardSections.x, y: whiteboardSections.y, width: whiteboardSections.width, height: whiteboardSections.height,
      color: whiteboardSections.color, title: whiteboardSections.title,
    }).from(whiteboardSections).where(inArray(whiteboardSections.whiteboardId, boardIds));
    const connRows = boardIds.length === 0 ? [] : await db.select({
      id: whiteboardConnections.id, whiteboardId: whiteboardConnections.whiteboardId,
      fromMemoId: whiteboardConnections.fromMemoId, toMemoId: whiteboardConnections.toMemoId,
    }).from(whiteboardConnections).where(inArray(whiteboardConnections.whiteboardId, boardIds));

    const memoIds = [...new Set(placements.map(p => p.memoId))];
    const userMemos = memoIds.length === 0 ? [] : await db.select({
      id: memos.id, color: memos.color, title: memos.title,
    }).from(memos).where(and(eq(memos.uid, uid), inArray(memos.id, memoIds)));
    const memoMap = {};
    for (const m of userMemos) memoMap[m.id] = m;

    // memoId -> [boardIds] (a memo can be placed on multiple boards)
    const memoBoardsMap = {};
    for (const p of placements) {
      (memoBoardsMap[p.memoId] ||= new Set()).add(p.whiteboardId);
    }

    // cross-board memo links: emit an edge between every pair of distinct boards
    // where one hosts the from-memo and another hosts the to-memo.
    const linkRows = memoIds.length === 0 ? [] : await db.select({
      fromMemoId: memoLinks.fromMemoId, toMemoId: memoLinks.toMemoId,
    }).from(memoLinks).where(and(
      eq(memoLinks.uid, uid),
      inArray(memoLinks.fromMemoId, memoIds),
      inArray(memoLinks.toMemoId, memoIds),
    ));
    const crossLinkSet = new Set();
    const crossLinks = [];
    for (const l of linkRows) {
      const froms = memoBoardsMap[l.fromMemoId];
      const tos = memoBoardsMap[l.toMemoId];
      if (!froms || !tos) continue;
      for (const fb of froms) for (const tb of tos) {
        if (fb === tb) continue;
        const key = `${fb}->${tb}`;
        if (crossLinkSet.has(key)) continue;
        crossLinkSet.add(key);
        crossLinks.push({ fromBoardId: fb, toBoardId: tb });
      }
    }

    // Group rows by board id in a single pass to avoid repeated filters per board.
    const placementsByBoard = {};
    const placementByBoardMemo = {};
    for (const p of placements) {
      (placementsByBoard[p.whiteboardId] ||= []).push(p);
      (placementByBoardMemo[p.whiteboardId] ||= {})[p.memoId] = p;
    }
    const sectionsByBoard = {};
    for (const s of sectionRows) (sectionsByBoard[s.whiteboardId] ||= []).push(s);
    const connsByBoard = {};
    for (const c of connRows) (connsByBoard[c.whiteboardId] ||= []).push(c);

    const boardOut = boards.map(b => {
      const ps = (placementsByBoard[b.id] || []).map(p => ({
        x: p.x, y: p.y, w: p.width, h: p.height,
        color: (memoMap[p.memoId] && memoMap[p.memoId].color) || 'white',
      }));
      const ss = (sectionsByBoard[b.id] || []).map(s => ({
        x: s.x, y: s.y, w: s.width, h: s.height, color: s.color,
      }));
      const placementById = placementByBoardMemo[b.id] || {};
      const cs = (connsByBoard[b.id] || []).map(c => {
        const a = placementById[c.fromMemoId], z = placementById[c.toMemoId];
        if (!a || !z) return null;
        return {
          x1: a.x + a.width / 2, y1: a.y + a.height / 2,
          x2: z.x + z.width / 2, y2: z.y + z.height / 2,
        };
      }).filter(Boolean);
      return {
        id: b.id, name: b.name, parentId: b.parentId,
        updatedAt: b.updatedAt, createdAt: b.createdAt,
        memoCount: ps.length,
        sectionCount: ss.length,
        connectionCount: cs.length,
        snapshot: { memos: ps, sections: ss, connections: cs },
      };
    });

    res.json({ boards: boardOut, crossLinks });
  } catch (err) {
    console.error("overview error", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/whiteboards", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const wbs = await db.select({ id: whiteboards.id, name: whiteboards.name, parentId: whiteboards.parentId, updatedAt: whiteboards.updatedAt })
      .from(whiteboards).where(eq(whiteboards.userId, uid)).orderBy(whiteboards.createdAt);
    if (wbs.length === 0) {
      const [created] = await db.insert(whiteboards).values({ userId: uid, name: "default", data: "{}" }).returning();
      return res.json([{ id: created.id, name: created.name, updatedAt: created.updatedAt }]);
    }
    res.json(wbs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/whiteboards", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { name, parentId } = req.body;
    const [created] = await db.insert(whiteboards).values({ userId: uid, name: name || "Untitled", parentId: parentId || null, data: "{}" }).returning();
    res.json({ id: created.id, name: created.name, parentId: created.parentId, updatedAt: created.updatedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/whiteboards/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const wbId = parseInt(req.params.id);
    const [existing] = await db.select().from(whiteboards)
      .where(and(eq(whiteboards.id, wbId), eq(whiteboards.userId, uid)));
    if (!existing) return res.status(404).json({ error: "Not found" });
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.data !== undefined) updates.data = req.body.data;
    if (req.body.parentId !== undefined) {
      const newParentId = req.body.parentId;
      if (newParentId === null) {
        updates.parentId = null;
      } else {
        if (newParentId === wbId) return res.status(400).json({ error: "Cannot set board as its own parent" });
        const [parent] = await db.select({ id: whiteboards.id }).from(whiteboards)
          .where(and(eq(whiteboards.id, newParentId), eq(whiteboards.userId, uid)));
        if (!parent) return res.status(400).json({ error: "Parent board not found" });
        const allBoards = await db.select({ id: whiteboards.id, parentId: whiteboards.parentId }).from(whiteboards)
          .where(eq(whiteboards.userId, uid));
        const parentMap = {};
        allBoards.forEach(b => { parentMap[b.id] = b.parentId; });
        parentMap[wbId] = newParentId;
        let cur = newParentId;
        const visited = new Set([wbId]);
        while (cur) {
          if (visited.has(cur)) return res.status(400).json({ error: "Cannot create circular hierarchy" });
          visited.add(cur);
          cur = parentMap[cur];
        }
        updates.parentId = newParentId;
      }
    }
    updates.updatedAt = new Date();
    await db.update(whiteboards).set(updates).where(eq(whiteboards.id, wbId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/whiteboards/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const wbId = parseInt(req.params.id);
    const [existing] = await db.select().from(whiteboards)
      .where(and(eq(whiteboards.id, wbId), eq(whiteboards.userId, uid)));
    if (!existing) return res.status(404).json({ error: "Not found" });
    await db.update(whiteboards).set({ parentId: null }).where(and(eq(whiteboards.parentId, wbId), eq(whiteboards.userId, uid)));
    await db.delete(whiteboardConnections).where(eq(whiteboardConnections.whiteboardId, wbId));
    await db.delete(whiteboardSections).where(eq(whiteboardSections.whiteboardId, wbId));
    await db.delete(whiteboardMemos).where(eq(whiteboardMemos.whiteboardId, wbId));
    await db.delete(whiteboards).where(eq(whiteboards.id, wbId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/whiteboards/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const wbId = parseInt(req.params.id);
    const [wb] = await db.select().from(whiteboards)
      .where(and(eq(whiteboards.id, wbId), eq(whiteboards.userId, uid)));
    if (!wb) return res.status(404).json({ error: "Not found" });
    res.json(wb);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/whiteboards/:id/memos", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const wbId = parseInt(req.params.id);
    const [wb] = await db.select({ id: whiteboards.id }).from(whiteboards)
      .where(and(eq(whiteboards.id, wbId), eq(whiteboards.userId, uid)));
    if (!wb) return res.status(404).json({ error: "Not found" });
    const placements = await db.select().from(whiteboardMemos)
      .where(eq(whiteboardMemos.whiteboardId, wbId));
    const memoIds = placements.map(p => p.memoId);
    if (memoIds.length === 0) return res.json([]);
    const userMemos = await db.select().from(memos).where(eq(memos.uid, uid));
    const allTags = await db.select().from(memoTags);
    const tagMap = {};
    for (const t of allTags) { if (!tagMap[t.memoId]) tagMap[t.memoId] = []; tagMap[t.memoId].push(t.tag); }
    const memoMap = {};
    for (const m of userMemos) memoMap[m.id] = m;
    const result = placements.filter(p => memoMap[p.memoId]).map(p => ({
      placementId: p.id,
      x: p.x, y: p.y, width: p.width, height: p.height,
      sectionId: p.sectionId,
      memo: { ...memoMap[p.memoId], tags: tagMap[p.memoId] || [] },
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/whiteboards/:id/memos", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const wbId = parseInt(req.params.id);
    const { memoId, x, y } = req.body;
    const [wb] = await db.select({ id: whiteboards.id }).from(whiteboards)
      .where(and(eq(whiteboards.id, wbId), eq(whiteboards.userId, uid)));
    if (!wb) return res.status(404).json({ error: "Whiteboard not found" });
    const [memo] = await db.select({ id: memos.id }).from(memos)
      .where(and(eq(memos.id, memoId), eq(memos.uid, uid)));
    if (!memo) return res.status(404).json({ error: "Memo not found" });
    const [existing] = await db.select().from(whiteboardMemos)
      .where(and(eq(whiteboardMemos.whiteboardId, wbId), eq(whiteboardMemos.memoId, memoId)));
    if (existing) return res.json({ placementId: existing.id, x: existing.x, y: existing.y, width: existing.width, height: existing.height });
    const [placement] = await db.insert(whiteboardMemos)
      .values({ whiteboardId: wbId, memoId, x: Math.round(x ?? 100), y: Math.round(y ?? 100) }).returning();
    res.json({ placementId: placement.id, x: placement.x, y: placement.y, width: placement.width, height: placement.height });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/whiteboard-memos/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const pId = parseInt(req.params.id);
    const [placement] = await db.select({ id: whiteboardMemos.id, whiteboardId: whiteboardMemos.whiteboardId })
      .from(whiteboardMemos).where(eq(whiteboardMemos.id, pId));
    if (!placement) return res.status(404).json({ error: "Not found" });
    const [wb] = await db.select({ id: whiteboards.id }).from(whiteboards)
      .where(and(eq(whiteboards.id, placement.whiteboardId), eq(whiteboards.userId, uid)));
    if (!wb) return res.status(403).json({ error: "Forbidden" });
    const updates = {};
    if (req.body.x !== undefined) updates.x = Math.round(req.body.x);
    if (req.body.y !== undefined) updates.y = Math.round(req.body.y);
    if (req.body.width !== undefined) updates.width = Math.round(req.body.width);
    if (req.body.height !== undefined) updates.height = Math.round(req.body.height);
    await db.update(whiteboardMemos).set(updates).where(eq(whiteboardMemos.id, pId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/whiteboard-memos/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const pId = parseInt(req.params.id);
    const [placement] = await db.select({ id: whiteboardMemos.id, whiteboardId: whiteboardMemos.whiteboardId, memoId: whiteboardMemos.memoId })
      .from(whiteboardMemos).where(eq(whiteboardMemos.id, pId));
    if (!placement) return res.status(404).json({ error: "Not found" });
    const [wb] = await db.select({ id: whiteboards.id }).from(whiteboards)
      .where(and(eq(whiteboards.id, placement.whiteboardId), eq(whiteboards.userId, uid)));
    if (!wb) return res.status(403).json({ error: "Forbidden" });
    await db.delete(whiteboardConnections).where(and(
      eq(whiteboardConnections.whiteboardId, placement.whiteboardId),
      sql`(${whiteboardConnections.fromMemoId} = ${placement.memoId} OR ${whiteboardConnections.toMemoId} = ${placement.memoId})`
    ));
    await db.delete(whiteboardMemos).where(eq(whiteboardMemos.id, pId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/whiteboards/:id/memos/bulk-move", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const wbId = parseInt(req.params.id);
    const { placementIds, targetWhiteboardId } = req.body;
    if (!Array.isArray(placementIds) || !targetWhiteboardId) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    const [target] = await db.select({ id: whiteboards.id }).from(whiteboards)
      .where(and(eq(whiteboards.id, parseInt(targetWhiteboardId)), eq(whiteboards.userId, uid)));
    if (!target) return res.status(404).json({ error: "Target board not found" });
    const [src] = await db.select({ id: whiteboards.id }).from(whiteboards)
      .where(and(eq(whiteboards.id, wbId), eq(whiteboards.userId, uid)));
    if (!src) return res.status(404).json({ error: "Source board not found" });
    const ids = placementIds.map(n => parseInt(n)).filter(Boolean);
    if (ids.length === 0) return res.json({ ok: true, moved: 0 });
    const placements = await db.select().from(whiteboardMemos)
      .where(and(eq(whiteboardMemos.whiteboardId, wbId), inArray(whiteboardMemos.id, ids)));
    const memoIds = placements.map(p => p.memoId);
    if (memoIds.length === 0) return res.json({ ok: true, moved: 0 });
    const existingOnTarget = await db.select({ memoId: whiteboardMemos.memoId }).from(whiteboardMemos)
      .where(and(eq(whiteboardMemos.whiteboardId, target.id), inArray(whiteboardMemos.memoId, memoIds)));
    const existingSet = new Set(existingOnTarget.map(r => r.memoId));
    const movable = placements.filter(p => !existingSet.has(p.memoId));
    if (movable.length > 0) {
      await db.update(whiteboardMemos).set({ whiteboardId: target.id, sectionId: null })
        .where(inArray(whiteboardMemos.id, movable.map(p => p.id)));
    }
    const dupIds = placements.filter(p => existingSet.has(p.memoId)).map(p => p.id);
    if (dupIds.length > 0) {
      await db.delete(whiteboardMemos).where(inArray(whiteboardMemos.id, dupIds));
    }
    await db.delete(whiteboardConnections).where(and(
      eq(whiteboardConnections.whiteboardId, wbId),
      sql`(${whiteboardConnections.fromMemoId} IN (${sql.join(memoIds.map(id => sql`${id}`), sql`, `)})
       OR ${whiteboardConnections.toMemoId} IN (${sql.join(memoIds.map(id => sql`${id}`), sql`, `)}))`
    ));
    res.json({ ok: true, moved: movable.length, removedDuplicates: dupIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function ensureBoardOwned(uid, wbId) {
  const [wb] = await db.select({ id: whiteboards.id }).from(whiteboards)
    .where(and(eq(whiteboards.id, wbId), eq(whiteboards.userId, uid)));
  return !!wb;
}

router.get("/api/whiteboards/:id/connections", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const wbId = parseInt(req.params.id);
    if (!await ensureBoardOwned(uid, wbId)) return res.status(404).json({ error: "Not found" });
    const rows = await db.select().from(whiteboardConnections).where(eq(whiteboardConnections.whiteboardId, wbId));
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/api/whiteboards/:id/connections", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const wbId = parseInt(req.params.id);
    if (!await ensureBoardOwned(uid, wbId)) return res.status(404).json({ error: "Not found" });
    const { fromMemoId, toMemoId, label, style } = req.body;
    if (!fromMemoId || !toMemoId || fromMemoId === toMemoId) {
      return res.status(400).json({ error: "Invalid memo ids" });
    }
    const placements = await db.select({ memoId: whiteboardMemos.memoId }).from(whiteboardMemos)
      .where(and(eq(whiteboardMemos.whiteboardId, wbId),
        inArray(whiteboardMemos.memoId, [parseInt(fromMemoId), parseInt(toMemoId)])));
    if (placements.length < 2) return res.status(400).json({ error: "Both memos must be on the board" });
    const [created] = await db.insert(whiteboardConnections).values({
      whiteboardId: wbId,
      fromMemoId: parseInt(fromMemoId),
      toMemoId: parseInt(toMemoId),
      label: label || "",
      style: style || "solid",
    }).returning();
    res.json(created);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/api/whiteboard-connections/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const cId = parseInt(req.params.id);
    const [conn] = await db.select().from(whiteboardConnections).where(eq(whiteboardConnections.id, cId));
    if (!conn) return res.status(404).json({ error: "Not found" });
    if (!await ensureBoardOwned(uid, conn.whiteboardId)) return res.status(403).json({ error: "Forbidden" });
    const updates = {};
    if (req.body.label !== undefined) updates.label = req.body.label;
    if (req.body.style !== undefined) updates.style = req.body.style;
    await db.update(whiteboardConnections).set(updates).where(eq(whiteboardConnections.id, cId));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/api/whiteboard-connections/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const cId = parseInt(req.params.id);
    const [conn] = await db.select().from(whiteboardConnections).where(eq(whiteboardConnections.id, cId));
    if (!conn) return res.status(404).json({ error: "Not found" });
    if (!await ensureBoardOwned(uid, conn.whiteboardId)) return res.status(403).json({ error: "Forbidden" });
    await db.delete(whiteboardConnections).where(eq(whiteboardConnections.id, cId));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/api/whiteboards/:id/sections", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const wbId = parseInt(req.params.id);
    if (!await ensureBoardOwned(uid, wbId)) return res.status(404).json({ error: "Not found" });
    const rows = await db.select().from(whiteboardSections).where(eq(whiteboardSections.whiteboardId, wbId));
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/api/whiteboards/:id/sections", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const wbId = parseInt(req.params.id);
    if (!await ensureBoardOwned(uid, wbId)) return res.status(404).json({ error: "Not found" });
    const { title, x, y, width, height, color } = req.body;
    const [created] = await db.insert(whiteboardSections).values({
      whiteboardId: wbId,
      title: title || "",
      x: Math.round(x ?? 0),
      y: Math.round(y ?? 0),
      width: Math.round(width ?? 400),
      height: Math.round(height ?? 300),
      color: color || "blue",
    }).returning();
    res.json(created);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/api/whiteboard-sections/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const sId = parseInt(req.params.id);
    const [sec] = await db.select().from(whiteboardSections).where(eq(whiteboardSections.id, sId));
    if (!sec) return res.status(404).json({ error: "Not found" });
    if (!await ensureBoardOwned(uid, sec.whiteboardId)) return res.status(403).json({ error: "Forbidden" });
    const updates = {};
    for (const k of ["title", "color"]) if (req.body[k] !== undefined) updates[k] = req.body[k];
    for (const k of ["x", "y", "width", "height"]) if (req.body[k] !== undefined) updates[k] = Math.round(req.body[k]);
    if (Array.isArray(req.body.containedMemoIds)) {
      await db.update(whiteboardMemos)
        .set({ sectionId: null })
        .where(and(eq(whiteboardMemos.whiteboardId, sec.whiteboardId), eq(whiteboardMemos.sectionId, sId)));
      const ids = req.body.containedMemoIds.map(n => parseInt(n)).filter(Boolean);
      if (ids.length > 0) {
        await db.update(whiteboardMemos)
          .set({ sectionId: sId })
          .where(and(eq(whiteboardMemos.whiteboardId, sec.whiteboardId), inArray(whiteboardMemos.memoId, ids)));
      }
    }
    if (Object.keys(updates).length > 0) {
      await db.update(whiteboardSections).set(updates).where(eq(whiteboardSections.id, sId));
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/api/whiteboard-sections/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const sId = parseInt(req.params.id);
    const [sec] = await db.select().from(whiteboardSections).where(eq(whiteboardSections.id, sId));
    if (!sec) return res.status(404).json({ error: "Not found" });
    if (!await ensureBoardOwned(uid, sec.whiteboardId)) return res.status(403).json({ error: "Forbidden" });
    await db.update(whiteboardMemos).set({ sectionId: null })
      .where(and(eq(whiteboardMemos.whiteboardId, sec.whiteboardId), eq(whiteboardMemos.sectionId, sId)));
    await db.delete(whiteboardSections).where(eq(whiteboardSections.id, sId));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/api/memos/:id/links", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const memoId = parseInt(req.params.id);
    const [m] = await db.select({ id: memos.id }).from(memos)
      .where(and(eq(memos.id, memoId), eq(memos.uid, uid)));
    if (!m) return res.status(404).json({ error: "Not found" });
    const links = await db.select({ toMemoId: memoLinks.toMemoId }).from(memoLinks)
      .where(and(eq(memoLinks.uid, uid), eq(memoLinks.fromMemoId, memoId)));
    if (links.length === 0) return res.json([]);
    const toIds = [...new Set(links.map(l => l.toMemoId))];
    const targets = await db.select({ id: memos.id, title: memos.title, color: memos.color }).from(memos)
      .where(and(eq(memos.uid, uid), inArray(memos.id, toIds)));
    res.json(targets);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const geminiAI = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

const openaiModels = ["gpt-4o-mini","gpt-4o","gpt-5-nano","gpt-5-mini","gpt-5","gpt-5.1","gpt-5.2","o3-mini","o4-mini","o3"];
const anthropicModels = ["claude-haiku-4-5","claude-sonnet-4-6","claude-opus-4-6"];
const geminiModels = ["gemini-2.5-flash","gemini-2.5-pro"];

function getProvider(model) {
  if (anthropicModels.includes(model)) return "anthropic";
  if (geminiModels.includes(model)) return "gemini";
  return "openai";
}

async function getUserTimezone(uid) {
  if (!uid) return "Asia/Hong_Kong";
  try {
    const [u] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, uid));
    return userTimezone(u);
  } catch {
    return "Asia/Hong_Kong";
  }
}

router.get("/api/muse/conversations", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const convos = await db.select().from(museConversations)
      .where(eq(museConversations.uid, uid))
      .orderBy(desc(museConversations.updatedAt));
    res.json(convos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/muse/conversations", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const [convo] = await db.insert(museConversations).values({
      uid, title: req.body.title || "New chat",
    }).returning();
    res.json(convo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/muse/conversations/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    await db.delete(museMessages).where(and(eq(museMessages.uid, uid), eq(museMessages.conversationId, id)));
    await db.delete(museConversations).where(and(eq(museConversations.id, id), eq(museConversations.uid, uid)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/muse/conversations/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    await db.update(museConversations).set({ title: req.body.title })
      .where(and(eq(museConversations.id, id), eq(museConversations.uid, uid)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/muse/conversations/:id/messages", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const msgs = await db.select().from(museMessages)
      .where(and(eq(museMessages.uid, uid), eq(museMessages.conversationId, id)))
      .orderBy(asc(museMessages.createdAt));
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk-import previous conversations from a ChatGPT or Claude data export.
// Body: { source: 'chatgpt'|'claude', data: <parsed export JSON>,
//         extractMemories?: boolean }
// Inserts every conversation + its messages synchronously and returns counts
// immediately. If extractMemories is true (default), kicks off a background
// pass that runs extractMemoriesFromTurn on every USER message (assistant
// messages are skipped — per user's cost-conscious preference) and stores the
// distilled facts in muse_memories. The pass is fire-and-forget; failures are
// logged but don't fail the import.
router.post("/api/muse/import", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { source, data, extractMemories = true } = req.body || {};
    if (!source || (source !== "chatgpt" && source !== "claude" && source !== "markdown")) {
      return res.status(400).json({ error: "source must be 'chatgpt', 'claude', or 'markdown'" });
    }
    if (data == null) {
      return res.status(400).json({ error: "data is required" });
    }

    let normalized;
    try {
      normalized = parseChatExport(source, data);
    } catch (e) {
      return res.status(400).json({ error: `Could not parse export: ${e.message}` });
    }

    if (!normalized.length) {
      return res.json({ conversations: 0, messages: 0, userMessages: 0, memoryJobQueued: false });
    }

    // Cap the import so a 500MB export can't take the server down.
    let truncated = false;
    if (normalized.length > MUSE_IMPORT_MAX_CONVERSATIONS) {
      normalized = normalized.slice(0, MUSE_IMPORT_MAX_CONVERSATIONS);
      truncated = true;
    }
    let totalMsgs = 0;
    const capped = [];
    for (const conv of normalized) {
      if (totalMsgs >= MUSE_IMPORT_MAX_MESSAGES) { truncated = true; break; }
      const remaining = MUSE_IMPORT_MAX_MESSAGES - totalMsgs;
      if (conv.messages.length > remaining) {
        conv.messages = conv.messages.slice(0, remaining);
        truncated = true;
      }
      totalMsgs += conv.messages.length;
      capped.push(conv);
    }
    normalized = capped;

    // Refuse if this user already has an import (foreground or background
    // extraction) running — avoids OpenAI rate-limit pile-up.
    if (museImportInFlight.has(uid)) {
      return res.status(409).json({ error: "Another import is still running for this account. Please wait until it finishes." });
    }
    museImportInFlight.add(uid);

    // Insert conversations one-by-one so we can capture the new id and bind
    // its messages. Bulk-inserting messages per-conversation keeps round-trips
    // reasonable even for large exports.
    let convCount = 0;
    let msgCount = 0;
    let userMsgCount = 0;
    const userMsgRefs = []; // for background extraction pass

    for (const conv of normalized) {
      const convCreated = conv.createdAt instanceof Date && !isNaN(conv.createdAt) ? conv.createdAt : new Date();
      const lastMsg = conv.messages[conv.messages.length - 1];
      const convUpdated = lastMsg?.createdAt instanceof Date && !isNaN(lastMsg.createdAt) ? lastMsg.createdAt : convCreated;

      const [row] = await db.insert(museConversations).values({
        uid,
        title: conv.title.slice(0, 500),
        source,
        createdAt: convCreated,
        updatedAt: convUpdated,
      }).returning();

      convCount++;

      // Batch-insert messages. drizzle handles arrays.
      const msgRows = conv.messages.map(m => ({
        uid,
        conversationId: row.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt instanceof Date && !isNaN(m.createdAt) ? m.createdAt : convCreated,
      }));
      if (msgRows.length) {
        const inserted = await db.insert(museMessages).values(msgRows).returning({ id: museMessages.id, role: museMessages.role, content: museMessages.content });
        msgCount += inserted.length;
        for (const r of inserted) {
          if (r.role === "user") {
            userMsgCount++;
            userMsgRefs.push({ conversationId: row.id, messageId: r.id, content: r.content });
          }
        }
      }
    }

    // Fire-and-forget memory extraction pass. The in-flight flag stays set
    // until the background loop finishes, so a second import won't pile on
    // top of an unfinished one.
    if (extractMemories && userMsgRefs.length) {
      setImmediate(async () => {
        try {
          console.log(`[muse-import] uid=${uid} extracting memories from ${userMsgRefs.length} user messages…`);
          let memCount = 0;
          for (const ref of userMsgRefs) {
            try {
              const saved = await extractMemoriesFromTurn({
                uid,
                conversationId: ref.conversationId,
                recentMessages: [{ role: "user", content: ref.content }],
                assistantMessageId: ref.messageId,
              });
              if (saved?.length) memCount += saved.length;
            } catch (e) {
              console.error("[muse-import] extract failed:", e.message);
            }
            // Gentle rate limit so we don't hammer OpenAI on huge imports.
            await new Promise(r => setTimeout(r, 120));
          }
          console.log(`[muse-import] uid=${uid} done. Stored ${memCount} memories.`);
        } finally {
          museImportInFlight.delete(uid);
        }
      });
    } else {
      museImportInFlight.delete(uid);
    }

    res.json({
      conversations: convCount,
      messages: msgCount,
      userMessages: userMsgCount,
      memoryJobQueued: !!(extractMemories && userMsgRefs.length),
      truncated,
    });
  } catch (err) {
    museImportInFlight.delete(getUserId(req));
    console.error("[/api/muse/import]", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Podcast Notebook (Phase 1): YouTube-channel-backed shows + episode tracking
// ---------------------------------------------------------------------------

async function syncPodcastShowEpisodes(uid, show) {
  const { entries, title } = await fetchChannelEpisodes(show.feedUrl);
  let added = 0;
  for (const ep of entries) {
    const inserted = await db
      .insert(podcastEpisodes)
      .values({
        uid,
        showId: show.id,
        videoId: ep.videoId,
        title: ep.title,
        url: ep.url,
        thumbnail: ep.thumbnail,
        publishedAt: ep.publishedAt,
      })
      .onConflictDoNothing()
      .returning({ id: podcastEpisodes.id });
    if (inserted.length) added++;
  }
  // Backfill title if we didn't have one yet.
  if (title && !show.title) {
    await db.update(podcastShows).set({ title }).where(eq(podcastShows.id, show.id));
  }
  return { added, feedTitle: title };
}

router.get("/api/podcasts/shows", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const shows = await db.select().from(podcastShows).where(eq(podcastShows.uid, uid)).orderBy(asc(podcastShows.title));
    const counts = await db
      .select({
        showId: podcastEpisodes.showId,
        total: sql`count(*)::int`,
        listened: sql`count(*) FILTER (WHERE ${podcastEpisodes.listened})::int`,
      })
      .from(podcastEpisodes)
      .where(eq(podcastEpisodes.uid, uid))
      .groupBy(podcastEpisodes.showId);
    const countMap = Object.fromEntries(counts.map(c => [c.showId, c]));
    res.json(shows.map(s => ({
      ...s,
      episodeCount: countMap[s.id]?.total || 0,
      listenedCount: countMap[s.id]?.listened || 0,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/podcasts/shows", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { channel } = req.body || {};
    if (!channel || typeof channel !== "string") {
      return res.status(400).json({ error: "channel is required (YouTube URL, @handle, or UC… id)" });
    }
    const { channelId, feedUrl } = await resolveYoutubeChannel(channel);
    const existing = await db.select().from(podcastShows)
      .where(and(eq(podcastShows.uid, uid), eq(podcastShows.feedUrl, feedUrl)));
    if (existing.length) {
      return res.status(409).json({ error: "You're already subscribed to this channel.", show: existing[0] });
    }
    const [show] = await db.insert(podcastShows).values({
      uid,
      channelId,
      feedUrl,
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
    }).returning();
    let sync = { added: 0, feedTitle: "" };
    try {
      sync = await syncPodcastShowEpisodes(uid, show);
    } catch (e) {
      console.error("[podcasts] initial sync failed:", e.message);
    }
    const [fresh] = await db.select().from(podcastShows).where(eq(podcastShows.id, show.id));
    res.json({ show: fresh, added: sync.added });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const SAVED_VIDEOS_FEED = "saved:videos";

function extractYoutubeVideoId(input) {
  const raw = String(input || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "music.youtube.com") {
    const v = u.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    const m = u.pathname.match(/^\/(shorts|live|embed)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[2];
  }
  return null;
}

router.post("/api/podcasts/videos", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { url } = req.body || {};
    const videoId = extractYoutubeVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: "唔認得呢條連結 — 請貼 YouTube 影片連結（youtube.com/watch?v=… 或 youtu.be/…）" });
    }

    // Ensure the per-user "Saved videos" show exists
    let [show] = await db.select().from(podcastShows)
      .where(and(eq(podcastShows.uid, uid), eq(podcastShows.feedUrl, SAVED_VIDEOS_FEED)));
    if (!show) {
      [show] = await db.insert(podcastShows).values({
        uid,
        title: "📎 Saved videos",
        channelId: "",
        feedUrl: SAVED_VIDEOS_FEED,
        channelUrl: "",
      }).onConflictDoNothing().returning();
      if (!show) {
        [show] = await db.select().from(podcastShows)
          .where(and(eq(podcastShows.uid, uid), eq(podcastShows.feedUrl, SAVED_VIDEOS_FEED)));
      }
    }

    // Already saved?
    const [existing] = await db.select().from(podcastEpisodes)
      .where(and(eq(podcastEpisodes.uid, uid), eq(podcastEpisodes.showId, show.id), eq(podcastEpisodes.videoId, videoId)));
    if (existing) {
      return res.json({ show, episode: existing, duplicate: true });
    }

    // Fetch title via oEmbed (no API key needed)
    let title = "";
    try {
      const oe = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`);
      if (oe.ok) {
        const data = await oe.json();
        title = data.title || "";
      }
    } catch { /* title stays empty */ }
    if (!title) {
      return res.status(404).json({ error: "揾唔到呢條影片 — 請確認連結正確，同埋影片係公開嘅。" });
    }

    const [episode] = await db.insert(podcastEpisodes).values({
      uid,
      showId: show.id,
      videoId,
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      publishedAt: new Date(),
    }).onConflictDoNothing().returning();
    if (!episode) {
      const [dup] = await db.select().from(podcastEpisodes)
        .where(and(eq(podcastEpisodes.uid, uid), eq(podcastEpisodes.showId, show.id), eq(podcastEpisodes.videoId, videoId)));
      return res.json({ show, episode: dup, duplicate: true });
    }
    res.json({ show, episode, duplicate: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/podcasts/shows/:id/refresh", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const showId = parseInt(req.params.id, 10);
    const [show] = await db.select().from(podcastShows)
      .where(and(eq(podcastShows.id, showId), eq(podcastShows.uid, uid)));
    if (!show) return res.status(404).json({ error: "Show not found" });
    if (show.feedUrl === SAVED_VIDEOS_FEED) return res.json({ added: 0 });
    const sync = await syncPodcastShowEpisodes(uid, show);
    res.json({ added: sync.added });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/podcasts/shows/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const showId = parseInt(req.params.id, 10);
    const epRows = await db.select({ id: podcastEpisodes.id }).from(podcastEpisodes)
      .where(and(eq(podcastEpisodes.uid, uid), eq(podcastEpisodes.showId, showId)));
    const epIds = epRows.map(r => r.id);
    if (epIds.length) {
      await db.delete(podcastEpisodeNotes)
        .where(and(eq(podcastEpisodeNotes.uid, uid), inArray(podcastEpisodeNotes.episodeId, epIds)));
    }
    await db.delete(podcastEpisodes).where(and(eq(podcastEpisodes.uid, uid), eq(podcastEpisodes.showId, showId)));
    await db.delete(podcastShows).where(and(eq(podcastShows.id, showId), eq(podcastShows.uid, uid)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/podcasts/shows/:id/episodes", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const showId = parseInt(req.params.id, 10);
    const episodes = await db.select().from(podcastEpisodes)
      .where(and(eq(podcastEpisodes.uid, uid), eq(podcastEpisodes.showId, showId)))
      .orderBy(desc(podcastEpisodes.publishedAt));
    res.json(episodes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Phase 2: AI transcript summary for one episode (reuses videoNotes pipeline).
const podcastSummarizeInFlight = new Set();

router.post("/api/podcasts/episodes/:id/summarize", isAuthenticated, async (req, res) => {
  const uid = getUserId(req);
  const epId = parseInt(req.params.id, 10);
  const flightKey = `${uid}:${epId}`;
  try {
    const [ep] = await db.select().from(podcastEpisodes)
      .where(and(eq(podcastEpisodes.id, epId), eq(podcastEpisodes.uid, uid)));
    if (!ep) return res.status(404).json({ error: "Episode not found" });
    if (ep.summary && !req.body?.force) return res.json({ summary: ep.summary, cached: true });
    if (podcastSummarizeInFlight.has(flightKey)) {
      return res.status(409).json({ error: "Summary already in progress for this episode." });
    }
    podcastSummarizeInFlight.add(flightKey);
    try {
      // Prefer the transcript already cached on the episode (same data the
      // detail page shows) — re-fetching via loadVideo often gets blocked by YouTube.
      let loaded = null;
      if (ep.transcript) {
        try {
          const t = JSON.parse(ep.transcript);
          if (Array.isArray(t.segments) && t.segments.length) {
            const segments = t.segments.map(s => ({ startSec: s.sec ?? s.startSec ?? 0, text: s.text || "" }));
            loaded = {
              platform: "youtube",
              id: ep.videoId,
              meta: {
                title: ep.title || ep.videoId,
                url: ep.url,
                durationSec: segments[segments.length - 1]?.startSec || 0,
              },
              transcript: { segments, lang: t.lang, langName: t.langName },
            };
          }
        } catch { /* corrupted cache — fall through to full fetch */ }
      }
      if (!loaded) {
        // No cached transcript yet: fetch captions directly (lighter than loadVideo's meta fetch).
        const t = await fetchYoutubeTranscript(ep.videoId);
        const payload = {
          segments: t.segments.map(s => ({ sec: Math.round(s.startSec), text: s.text })),
          lang: t.lang,
          langName: t.langName,
          isAutoGenerated: t.isAutoGenerated,
        };
        await db.update(podcastEpisodes)
          .set({ transcript: JSON.stringify(payload) })
          .where(and(eq(podcastEpisodes.id, epId), eq(podcastEpisodes.uid, uid)));
        loaded = {
          platform: "youtube",
          id: ep.videoId,
          meta: {
            title: ep.title || ep.videoId,
            url: ep.url,
            durationSec: t.segments[t.segments.length - 1]?.startSec || 0,
          },
          transcript: t,
        };
      }
      const body = await summarizeTranscript(openai, loaded);
      const [row] = await db.update(podcastEpisodes)
        .set({ summary: body })
        .where(and(eq(podcastEpisodes.id, epId), eq(podcastEpisodes.uid, uid)))
        .returning();
      if (!row) return res.status(404).json({ error: "Episode was deleted while summarizing." });
      res.json({ summary: row.summary, cached: false });
    } finally {
      podcastSummarizeInFlight.delete(flightKey);
    }
  } catch (err) {
    podcastSummarizeInFlight.delete(flightKey);
    if (err instanceof VideoNoteError) {
      const friendly = {
        NO_CAPTIONS: "This video has no captions and is too long for audio transcription.",
        TOO_LONG: "This video is too long to transcribe.",
        PRIVATE: "This video is private or unavailable.",
        NOT_FOUND: "Video not found.",
        BAD_URL: "Invalid video URL.",
      }[err.code] || err.message;
      return res.status(400).json({ error: friendly, code: err.code });
    }
    console.error("[podcasts] summarize failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// v2: fetch (and cache) the full CC transcript for an episode.
router.post("/api/podcasts/episodes/:id/transcript", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const epId = parseInt(req.params.id, 10);
    const [ep] = await db.select().from(podcastEpisodes)
      .where(and(eq(podcastEpisodes.id, epId), eq(podcastEpisodes.uid, uid)));
    if (!ep) return res.status(404).json({ error: "Episode not found" });
    if (ep.transcript && !req.body?.force) {
      try {
        return res.json({ ...JSON.parse(ep.transcript), cached: true });
      } catch { /* corrupted cache — refetch */ }
    }
    const t = await fetchYoutubeTranscript(ep.videoId);
    const payload = {
      segments: t.segments.map(s => ({ sec: Math.round(s.startSec), text: s.text })),
      lang: t.lang,
      langName: t.langName,
      isAutoGenerated: t.isAutoGenerated,
    };
    await db.update(podcastEpisodes)
      .set({ transcript: JSON.stringify(payload) })
      .where(and(eq(podcastEpisodes.id, epId), eq(podcastEpisodes.uid, uid)));
    res.json({ ...payload, cached: false });
  } catch (err) {
    if (err instanceof VideoNoteError) {
      const friendly = {
        NO_CAPTIONS: "This video has no captions (CC) available.",
        PRIVATE: "This video is private or unavailable.",
        NOT_FOUND: "Video not found.",
      }[err.code] || err.message;
      return res.status(400).json({ error: friendly, code: err.code });
    }
    console.error("[podcasts] transcript failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// v2: timestamped + overall notes per episode.
// All notes across episodes (timestamped notes + overall episode notes), grouped by episode
router.get("/api/podcasts/notes", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const timedNotes = await db.select({
      id: podcastEpisodeNotes.id,
      episodeId: podcastEpisodeNotes.episodeId,
      sec: podcastEpisodeNotes.sec,
      content: podcastEpisodeNotes.content,
      createdAt: podcastEpisodeNotes.createdAt,
    }).from(podcastEpisodeNotes)
      .where(eq(podcastEpisodeNotes.uid, uid))
      .orderBy(asc(podcastEpisodeNotes.episodeId), asc(podcastEpisodeNotes.sec));
    const episodesWithNotes = await db.select().from(podcastEpisodes)
      .where(and(eq(podcastEpisodes.uid, uid), sql`(coalesce(${podcastEpisodes.notes}, '') <> '' OR ${podcastEpisodes.id} IN (SELECT episode_id FROM podcast_episode_notes WHERE uid = ${uid}))`))
      .orderBy(desc(podcastEpisodes.publishedAt));
    const notesByEp = {};
    for (const n of timedNotes) {
      (notesByEp[n.episodeId] ||= []).push(n);
    }
    res.json(episodesWithNotes.map(ep => ({
      episode: ep,
      overallNotes: ep.notes || "",
      timedNotes: notesByEp[ep.id] || [],
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/podcasts/episodes/:id/notes", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const epId = parseInt(req.params.id, 10);
    const rows = await db.select().from(podcastEpisodeNotes)
      .where(and(eq(podcastEpisodeNotes.uid, uid), eq(podcastEpisodeNotes.episodeId, epId)))
      .orderBy(asc(podcastEpisodeNotes.sec), asc(podcastEpisodeNotes.createdAt));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/podcasts/episodes/:id/notes", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const epId = parseInt(req.params.id, 10);
    const { sec, content } = req.body || {};
    if (!content || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "content is required" });
    }
    const [ep] = await db.select({ id: podcastEpisodes.id }).from(podcastEpisodes)
      .where(and(eq(podcastEpisodes.id, epId), eq(podcastEpisodes.uid, uid)));
    if (!ep) return res.status(404).json({ error: "Episode not found" });
    const secVal = Number.isFinite(sec) && sec >= 0 ? Math.round(sec) : null;
    const [row] = await db.insert(podcastEpisodeNotes).values({
      uid, episodeId: epId, sec: secVal, content: content.trim(),
    }).returning();
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/podcasts/notes/:noteId", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const noteId = parseInt(req.params.noteId, 10);
    const { content } = req.body || {};
    if (!content || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "content is required" });
    }
    const [row] = await db.update(podcastEpisodeNotes)
      .set({ content: content.trim() })
      .where(and(eq(podcastEpisodeNotes.id, noteId), eq(podcastEpisodeNotes.uid, uid)))
      .returning();
    if (!row) return res.status(404).json({ error: "Note not found" });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/podcasts/notes/:noteId", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const noteId = parseInt(req.params.noteId, 10);
    await db.delete(podcastEpisodeNotes)
      .where(and(eq(podcastEpisodeNotes.id, noteId), eq(podcastEpisodeNotes.uid, uid)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Phase 3: save an episode's summary + notes into Muse memory.
router.post("/api/podcasts/episodes/:id/memorize", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const epId = parseInt(req.params.id, 10);
    const [ep] = await db.select().from(podcastEpisodes)
      .where(and(eq(podcastEpisodes.id, epId), eq(podcastEpisodes.uid, uid)));
    if (!ep) return res.status(404).json({ error: "Episode not found" });
    if (!ep.notes && !ep.summary) {
      return res.status(400).json({ error: "Nothing to remember yet — add notes or generate a summary first." });
    }
    const [show] = await db.select().from(podcastShows)
      .where(and(eq(podcastShows.id, ep.showId), eq(podcastShows.uid, uid)));
    const parts = [
      `Podcast episode: ${ep.title || ep.videoId}${show?.title ? ` (from ${show.title})` : ""}`,
    ];
    if (ep.notes) parts.push(`My notes: ${ep.notes}`);
    if (ep.summary) {
      // Keep the memory compact: first ~600 chars of the summary.
      parts.push(`Summary: ${ep.summary.slice(0, 600)}`);
    }
    const memory = await addMuseMemory({
      uid,
      content: parts.join("\n"),
      kind: "podcast",
      skipDedupe: false,
    });
    if (!memory) {
      return res.json({ ok: true, duplicate: true, message: "Already remembered (similar memory exists)." });
    }
    res.json({ ok: true, memoryId: memory.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/podcasts/episodes/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const epId = parseInt(req.params.id, 10);
    const { listened, notes } = req.body || {};
    const patch = {};
    if (typeof listened === "boolean") patch.listened = listened;
    if (typeof notes === "string") patch.notes = notes;
    if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to update" });
    const [row] = await db.update(podcastEpisodes)
      .set(patch)
      .where(and(eq(podcastEpisodes.id, epId), eq(podcastEpisodes.uid, uid)))
      .returning();
    if (!row) return res.status(404).json({ error: "Episode not found" });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/muse/chat", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { message, model, conversationId, skill } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });
    const userTz = await getUserTimezone(uid);
    const today = todayInTz(userTz);
    const allModels = [...openaiModels, ...anthropicModels, ...geminiModels];
    const useModel = allModels.includes(model) ? model : "gpt-4o-mini";
    const provider = getProvider(useModel);

    let convoId = conversationId;
    if (convoId) {
      const [owned] = await db.select().from(museConversations)
        .where(and(eq(museConversations.id, convoId), eq(museConversations.uid, uid)));
      if (!owned) return res.status(403).json({ error: "Not your conversation" });
    } else {
      const [convo] = await db.insert(museConversations).values({
        uid, title: message.length > 30 ? message.substring(0, 30) + "..." : message,
      }).returning();
      convoId = convo.id;
    }

    await db.insert(museMessages).values({ uid, conversationId: convoId, role: "user", content: message });

    const lower = message.toLowerCase().trim();
    let actionResult = null;

    // --- Wiki agent slash commands -----------------------------------------
    // /ingest <text> | /query <text> | /synth <text> | /lint | /reindex
    const slashMatch = message.match(/^\/(ingest|query|synth(?:esize)?|lint|reindex)\b\s*([\s\S]*)$/i);
    if (slashMatch) {
      const slashRaw = slashMatch[1].toLowerCase();
      const opKey = slashRaw === "synth" || slashRaw === "synthesize" ? "synthesize" : slashRaw;
      const opInput = (slashMatch[2] || "").trim();
      const tz = await getUserTimezone(uid);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ content: `_Running ${WIKI_OPS[opKey].label}…_\n\n` })}\n\n`);
      try {
        const result = await runWikiOp({
          uid, op: opKey, input: opInput || "(no input)", tz, dryRun: false, model: "gpt-4o-mini",
        });
        const reply = result.ok
          ? `**${WIKI_OPS[opKey].label}** → ${result.output || "(done)"}\n\n_Run #${result.runId} · ${result.toolCallCount} tool calls · ${result.durationMs}ms_`
          : `**${WIKI_OPS[opKey].label}** failed: ${result.error || "unknown error"}\n\n_Run #${result.runId}_`;
        await db.insert(museMessages).values({
          uid, conversationId: convoId, role: "assistant", content: reply,
        });
        res.write(`data: ${JSON.stringify({ content: reply })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true, conversationId: convoId, agentRunId: result.runId, agentOp: opKey })}\n\n`);
      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      }
      return res.end();
    }

    // --- Career Ops skill: agent loop with tool calling -------------------
    if (skill === "careerOps") {
      const tz = await getUserTimezone(uid);
      const history = await db.select().from(museMessages)
        .where(and(eq(museMessages.uid, uid), eq(museMessages.conversationId, convoId)))
        .orderBy(asc(museMessages.createdAt));
      // Drop the just-inserted user message from the historical context (we send it as userInput).
      const historyForCtx = history.slice(0, -1);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ content: "_Career Ops working…_\n\n" })}\n\n`);
      try {
        // Career Ops uses tool-calling via runAgent which is OpenAI-only,
        // so we ignore the user's model selection and pin to a tool-calling-capable model.
        const result = await runCareerOpsTurn({
          uid, message, history: historyForCtx, tz, model: "gpt-4o-mini",
        });
        const text = result.finalText || (result.error ? `Career Ops error: ${result.error}` : "(no reply)");
        const [assistantRow] = await db.insert(museMessages).values({
          uid, conversationId: convoId, role: "assistant", content: text,
        }).returning();
        await db.update(museConversations).set({ updatedAt: new Date() })
          .where(and(eq(museConversations.id, convoId), eq(museConversations.uid, uid)));
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true, conversationId: convoId, agentToolCalls: result.toolCallCount })}\n\n`);
        res.end();
        // Fire-and-forget memory extraction.
        (async () => {
          try {
            await extractMemoriesFromTurn({
              uid,
              conversationId: convoId,
              recentMessages: [
                ...historyForCtx.slice(-4).map(m => ({ role: m.role, content: m.content })),
                { role: "user", content: message },
                { role: "assistant", content: text },
              ],
              assistantMessageId: assistantRow?.id || null,
            });
          } catch (e) { console.warn("careerOps auto-extract failed:", e.message); }
        })();
      } catch (err) {
        console.error("careerOps turn failed:", err);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
      return;
    }

    if (lower.startsWith("draft task:") || lower.startsWith("draft task：")) {
      const colonIdx = message.indexOf("：") !== -1 && message.indexOf("：") < (message.indexOf(":") === -1 ? Infinity : message.indexOf(":"))
        ? message.indexOf("：") : message.indexOf(":");
      let rawText = message.slice(colonIdx + 1).trim();
      if (rawText) {
        let parsedDate = null;
        let parsedTime = null;

        const dateFullMatch = rawText.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s*/);
        if (dateFullMatch) {
          const [, y, m, d] = dateFullMatch;
          parsedDate = `${parseInt(y)}-${parseInt(m)}-${parseInt(d)}`;
          rawText = rawText.slice(dateFullMatch[0].length);
        } else {
          const dateShortMatch = rawText.match(/^(\d{1,2})[\/\-](\d{1,2})\s*/);
          if (dateShortMatch) {
            const [, m, d] = dateShortMatch;
            parsedDate = `${getNowInTz(userTz).getFullYear()}-${parseInt(m)}-${parseInt(d)}`;
            rawText = rawText.slice(dateShortMatch[0].length);
          }
        }

        const timeMatch = rawText.match(/^((?:[01]\d|2[0-3]):[0-5]\d)\s*/);
        if (timeMatch) {
          parsedTime = timeMatch[1];
          rawText = rawText.slice(timeMatch[0].length);
        }

        const taskName = rawText.trim();
        if (taskName) {
          const [newTask] = await db.insert(tasks).values({
            uid, name: taskName, date: parsedDate || today, done: false, order: 0,
            ...(parsedTime ? { startTime: parsedTime } : {}),
          }).returning();
          actionResult = { type: "task_created", task: newTask };
        }
      }
    } else if (lower.startsWith("draft memo:") || lower.startsWith("draft memo：")) {
      const memoContent = message.slice(message.indexOf(":") + 1).trim() || message.slice(message.indexOf("：") + 1).trim();
      if (memoContent) {
        const title = memoContent.length > 30 ? memoContent.substring(0, 30) + "..." : memoContent;
        const [newMemo] = await db.insert(memos).values({
          uid, title, content: memoContent, date: today, color: "white",
        }).returning();
        actionResult = { type: "memo_created", memo: newMemo };
      }
    }

    // Manual "remember that …" detection — runs BEFORE the LLM call so
    // Muse can mention it in the reply if it wants to. Fire-and-forget
    // so a slow LLM never blocks the chat stream.
    let manualMemorySaved = null;
    if (detectsManualRemember(message)) {
      try {
        const distilled = await distillManualRemember(message);
        if (distilled) {
          manualMemorySaved = await addMuseMemory({
            uid,
            content: distilled,
            rawExcerpt: message.slice(0, 500),
            kind: "manual",
            sourceConversationId: convoId,
          });
        }
      } catch (e) { console.warn("manual-remember failed:", e.message); }
    }

    const history = await db.select().from(museMessages)
      .where(and(eq(museMessages.uid, uid), eq(museMessages.conversationId, convoId)))
      .orderBy(asc(museMessages.createdAt));

    // Semantic search: pull top-K memories relevant to the latest turn.
    // Embed the current message together with the last 1-2 user turns so
    // pronouns/follow-ups recall the right memory.
    let memoryContext = "";
    try {
      const recentUserMsgs = history.filter(m => m.role === "user").slice(-2).map(m => m.content);
      const searchQuery = [...recentUserMsgs, message].join("\n").slice(0, 4000);
      const memSearch = await searchSimilarMemories(uid, searchQuery, { limit: 5 });
      memoryContext = formatMemoryContextBlock(memSearch);
    } catch (e) { console.warn("memory search failed:", e.message); }

    const { userTasks, taskContext, allTaskContext } = await buildMuseTaskContext(uid, today);
    const { systemContent: __sysFromShared, activeCustomSkill } = await buildMuseSkillPrompt({
      uid, skill, today, taskContext, allTaskContext, userTasks, actionResult,
    });
    let systemContent = __sysFromShared;

    // Inject long-term memory context (after task/skill prompt, before history).
    if (memoryContext) systemContent += memoryContext;
    if (manualMemorySaved) {
      systemContent += `\n\nThe user just asked you to remember: "${manualMemorySaved.content}". Briefly acknowledge that you've noted it.`;
    }

    const correctionPatterns = /^((?:she|he|they)\s+(?:wouldn't|won't|doesn't|didn't|never|would never)|(?:that'?s\s+(?:not right|wrong|incorrect))|(?:不對|唔啱|唔係咁|佢唔會|她不會|他不會|不是這樣|應該是|其實是|感覺不像|不太像))/i;
    if (activeCustomSkill && correctionPatterns.test(message)) {
      const recentHistory = history.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n');
      (async () => {
        try {
          const corrRes = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: `Extract a correction record from: "${message}"\nRecent context:\n${recentHistory}\n\nOutput ONLY the correction in format: [場景：{scenario}] 不應該 {wrong}，應該 {correct}` }],
            max_tokens: 200,
          });
          const corrRecord = corrRes.choices[0]?.message?.content?.trim();
          if (corrRecord) {
            const existing = activeCustomSkill.corrections || "";
            await db.update(customSkills).set({
              corrections: (existing ? existing + "\n- " + corrRecord : "- " + corrRecord).substring(0, 10000),
              version: (activeCustomSkill.version || 1) + 1,
              updatedAt: new Date(),
            }).where(eq(customSkills.id, activeCustomSkill.id));
          }
        } catch (e) { console.error("Auto-correction failed:", e.message); }
      })();
    }

    const chatMessages = [
      { role: "system", content: systemContent },
      ...history.slice(-30).map(m => ({ role: m.role, content: m.content })),
    ];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullResponse = "";

    if (provider === "openai") {
      const stream = await openai.chat.completions.create({
        model: useModel,
        messages: chatMessages,
        stream: true,
        max_tokens: 1024,
      });
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }
    } else if (provider === "anthropic") {
      const anthropicMessages = chatMessages.filter(m => m.role !== "system");
      const systemContent = chatMessages.find(m => m.role === "system")?.content || "";
      const stream = anthropic.messages.stream({
        model: useModel,
        max_tokens: 1024,
        system: systemContent,
        messages: anthropicMessages.map(m => ({ role: m.role, content: m.content })),
      });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          const content = event.delta.text;
          if (content) {
            fullResponse += content;
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        }
      }
    } else if (provider === "gemini") {
      const geminiHistory = chatMessages.filter(m => m.role !== "system").map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
      const systemInstruction = chatMessages.find(m => m.role === "system")?.content || "";
      const lastMsg = geminiHistory.pop();
      const stream = await geminiAI.models.generateContentStream({
        model: useModel,
        contents: [...geminiHistory, lastMsg],
        config: {
          maxOutputTokens: 1024,
          systemInstruction: systemInstruction,
        },
      });
      for await (const chunk of stream) {
        const content = chunk.text || "";
        if (content) {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }
    }

    const [assistantRow] = await db.insert(museMessages).values({ uid, conversationId: convoId, role: "assistant", content: fullResponse }).returning();
    await db.update(museConversations).set({ updatedAt: new Date() })
      .where(and(eq(museConversations.id, convoId), eq(museConversations.uid, uid)));

    res.write(`data: ${JSON.stringify({ done: true, action: actionResult, conversationId: convoId })}\n\n`);
    res.end();

    // Fire-and-forget: distill durable memories from this turn.
    (async () => {
      try {
        const recent = [
          ...history.slice(-4).map(m => ({ role: m.role, content: m.content })),
          { role: "user", content: message },
          { role: "assistant", content: fullResponse },
        ];
        await extractMemoriesFromTurn({
          uid,
          conversationId: convoId,
          recentMessages: recent,
          assistantMessageId: assistantRow?.id || null,
        });
      } catch (e) { console.warn("auto-extract failed:", e.message); }
    })();
  } catch (err) {
    console.error("Muse chat error:", err);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

router.get("/api/muse/memories", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const q = (req.query.q || "").toString();
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const kind = req.query.kind ? String(req.query.kind) : null;
    const sourceConversationId = req.query.source_conversation_id || req.query.sourceConversationId || null;
    const rows = await listMuseMemories(uid, { q, limit, offset, kind, sourceConversationId });
    res.json(rows);
  } catch (err) {
    console.error("list memories failed:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/muse/memories", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { content, kind } = req.body || {};
    if (!content || !content.trim()) return res.status(400).json({ error: "content required" });
    const row = await addMuseMemory({
      uid,
      content: content.trim(),
      kind: kind === "auto" ? "auto" : "manual",
      skipDedupe: true,
    });
    if (!row) return res.status(409).json({ error: "duplicate or empty" });
    res.json(row);
  } catch (err) {
    console.error("create memory failed:", err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/muse/memories/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const { content } = req.body || {};
    if (!content || !content.trim()) return res.status(400).json({ error: "content required" });
    const row = await updateMuseMemory(uid, id, { content });
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Spec also accepts bare DELETE /api/muse/memories — alias to clear-all.
router.delete("/api/muse/memories", isAuthenticated, async (req, res) => {
  try {
    await clearMuseMemories(getUserId(req));
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/muse/memories failed:", e);
    res.status(500).json({ error: "Failed to clear memories" });
  }
});

router.delete("/api/muse/memories/all", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    await clearMuseMemories(uid);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/muse/memories/conversation/:conversationId", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const conversationId = parseInt(req.params.conversationId);
    if (!conversationId) return res.status(400).json({ error: "invalid conversationId" });
    const deleted = await clearMuseMemoriesByConversation(uid, conversationId);
    res.json({ ok: true, deleted });
  } catch (err) {
    console.error("delete memories by conversation failed:", err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/muse/memories/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    await deleteMuseMemory(uid, id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Wiki agent (5 ops) ----------------------------------------------------

router.get("/api/muse/agent/ops", isAuthenticated, (req, res) => {
  const ops = getOpNames().map((k) => ({
    key: k,
    label: WIKI_OPS[k].label,
    description: WIKI_OPS[k].description,
    allowedTools: WIKI_OPS[k].allowedTools,
  }));
  res.json({ ops, killSwitch: String(process.env.MUSE_AGENT_KILL_SWITCH || "").toLowerCase() === "true" });
});

router.post("/api/muse/agent/run", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { op, input, dryRun, model } = req.body || {};
    if (!op || !WIKI_OPS[op]) return res.status(400).json({ error: "Unknown op" });
    if (typeof input !== "string" || !input.trim()) {
      // Reindex/Lint accept empty input — substitute a default.
      if (!["reindex", "lint"].includes(op)) {
        return res.status(400).json({ error: "input required" });
      }
    }
    const tz = await getUserTimezone(uid);
    const useModel = openaiModels.includes(model) ? model : "gpt-4o-mini";
    const result = await runWikiOp({
      uid, op, input: input || "(no input)", tz, dryRun: !!dryRun, model: useModel,
    });
    res.json(result);
  } catch (err) {
    console.error("muse/agent/run failed:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/muse/agent/runs", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    // Accept either ?source= (preferred, matches data model) or legacy ?trigger=.
    const raw = req.query.source ?? req.query.trigger;
    const src = raw === "manual" || raw === "auto" ? raw : null;
    const rows = await listAgentRuns(uid, { limit, source: src });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/muse/agent/runs/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const row = await getAgentRun(uid, id);
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/muse/agent/updates/:updateId/approve", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const updateId = parseInt(req.params.updateId);
    const r = await approveAgentRunUpdate(uid, updateId);
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/muse/agent/updates/:updateId/reject", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const updateId = parseInt(req.params.updateId);
    const r = await rejectAgentRunUpdate(uid, updateId);
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/muse/agent/auto-apply", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    res.json(await getWikiAutoApplyPrefs(uid));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/muse/agent/auto-apply", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { op, value } = req.body || {};
    if (op !== "ingest" && op !== "synthesize") return res.status(400).json({ error: "op must be ingest or synthesize" });
    const r = await setWikiAutoApply(uid, op, !!value);
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/muse/agent/auto-ingest", isAuthenticated, async (req, res) => {
  try {
    res.json(await getWikiAutoIngestPrefs(getUserId(req)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/muse/agent/auto-ingest", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { key, value } = req.body || {};
    if (!["rssDigest", "videoTranscript", "lineLog", "last30days"].includes(key)) {
      return res.status(400).json({ error: "invalid key" });
    }
    res.json(await setWikiAutoIngest(uid, key, !!value));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/muse/agent/lint-schedule", isAuthenticated, async (req, res) => {
  try {
    res.json(await getWikiLintSchedule(getUserId(req)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/muse/agent/lint-schedule", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { enabled, dow, hour, minute } = req.body || {};
    const out = await setWikiLintSchedule(uid, { enabled, dow, hour, minute });
    invalidateWeeklyLintCache();
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Per-user override for the Spec Builder skill's interview question list.
// GET returns { questions, defaults, isCustom } so the UI can show both the
// user's current list and the shipped defaults (for reset / comparison).
router.get("/api/muse/spec-builder-questions", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const [row] = await db.select({ raw: users.specBuilderQuestions })
      .from(users).where(eq(users.id, uid));
    const questions = await loadSpecBuilderQuestions(uid);
    res.json({
      questions,
      defaults: DEFAULT_SPEC_BUILDER_QUESTIONS,
      isCustom: !!row?.raw,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT replaces the user's question list. Send `{ questions: null }` (or an
// empty array) to reset back to DEFAULT_SPEC_BUILDER_QUESTIONS.
router.put("/api/muse/spec-builder-questions", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { ok, value, error } = sanitizeSpecBuilderQuestions(req.body?.questions);
    if (!ok) return res.status(400).json({ error });
    await db.update(users)
      .set({ specBuilderQuestions: value === null ? null : JSON.stringify(value), updatedAt: new Date() })
      .where(eq(users.id, uid));
    res.json({
      questions: value || DEFAULT_SPEC_BUILDER_QUESTIONS,
      defaults: DEFAULT_SPEC_BUILDER_QUESTIONS,
      isCustom: value !== null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function sampleChatLogText(chatLog) {
  if (chatLog.length <= 12000) return chatLog;
  const chunkSize = 4000;
  const start = chatLog.substring(0, chunkSize);
  const midPoint = Math.floor(chatLog.length / 2);
  const middle = chatLog.substring(midPoint - chunkSize / 2, midPoint + chunkSize / 2);
  const end = chatLog.substring(chatLog.length - chunkSize);
  return `[=== EARLY MESSAGES ===]\n${start}\n\n[=== MIDDLE MESSAGES ===]\n${middle}\n\n[=== RECENT MESSAGES ===]\n${end}`;
}

router.post("/api/skills/generate", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { name, chatLog, icon, color, relationshipInfo, personalityTags } = req.body;
    if (!name || !chatLog) return res.status(400).json({ error: "name and chatLog required" });
    if (name.length > 100) return res.status(400).json({ error: "Name too long" });

    const sampledLog = sampleChatLogText(chatLog);
    const sizeNote = chatLog.length > 12000 ? `\nNote: The original chat log is ${(chatLog.length / 1024).toFixed(0)}KB. Below is a representative sample from the beginning, middle, and end.\n` : "";

    const contextBlock = (relationshipInfo || personalityTags) ? `
User-provided context:
${relationshipInfo ? `Relationship info: ${relationshipInfo}` : ""}
${personalityTags ? `Personality tags: ${personalityTags}` : ""}
` : "";

    const analysisPrompt = `You are an expert at distilling real people into AI Skill personas from chat logs. You will analyze the following chat log for "${name}" and produce a structured, deeply authentic character profile.
${sizeNote}${contextBlock}
## Analysis Framework (ex-skill 5-Layer Persona + Memories)

Analyze along TWO tracks:

### TRACK A — Memories & Relationship Context
Extract from the chat log:
- Relationship timeline (key dates, milestones, turning points)
- Shared routines & rituals (inside jokes, pet names, daily habits)
- Preferences (food, activities, gifts, travel style)
- Conflict & repair patterns (common triggers, escalation, cold war patterns, how they make up)
- Emotional dynamics (what makes them happy/sad/angry, how they express missing someone)

### TRACK B — 5-Layer Persona
Extract from the chat log + user-provided tags:

**Layer 0 — Core Rules (HIGHEST PRIORITY, never violate)**
Translate personality tags into specific, actionable behavior rules.
NOT "she's sensitive" but "when he replies slowly, she checks her phone repeatedly; after 30 min she sends '你在幹嘛？'; after 2 hours she goes cold"
Each rule must describe: [situation] → [specific behavior/exact words she would say]

**Layer 1 — Identity**
Who she is: occupation, MBTI, attachment style, how you met, relationship duration

**Layer 2 — Expression Style**
- Catchphrases & high-frequency words (with quotes)
- Message habits (short bursts vs long paragraphs, voice messages, emoji patterns)
- Language mix (which languages, code-switching rules, formality level 1-5)
- Punctuation & emoji personality (!!!, ..., ～, specific emoji)
- Example responses for: "how was your day", "I miss you", "what should we eat", being ignored, being happy, being angry

**Layer 3 — Emotional Logic**
- Emotional priorities (security/freedom/being understood/attention)
- What triggers affection vs withdrawal
- How she expresses unhappiness (direct/cold war/passive aggressive/explosion)
- How she responds to criticism

**Layer 4 — Relationship Behavior**
- With partner: intimacy level, clinginess, daily rhythm
- Under stress: behavior changes, support needed
- Boundaries & dealbreakers

## Output Format

You MUST output exactly these sections, each on its own line:

DESCRIPTION: (1 sentence, max 30 chars, summarizing this person's vibe)

MEMORIES:
(The Track A analysis as markdown — relationship context, shared memories, preferences, conflict patterns, emotional dynamics. Write with vivid, specific details. Use her actual words in quotes when possible. If info is insufficient for a section, write "（原材料不足）")

PERSONA:
(The Track B analysis as a complete 5-layer persona markdown. Layer 0 rules must be concrete behavioral rules, not adjectives. Include example dialogue in Layer 2. Write in the same language(s) the person uses.)

SYSTEM_PROMPT:
(A complete system prompt combining Memories + Persona that instructs the AI to roleplay as this person. Start with Layer 0 rules as absolute constraints, then weave in identity, expression style, emotional logic, and relationship behavior. Include the memories as context the AI "remembers". The prompt should be in the same language(s) the person primarily uses. End with: "Correction records override all other rules when applicable.")

Chat log to analyze:
${sampledLog}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: analysisPrompt }],
      max_tokens: 4096,
    });

    const result = completion.choices[0]?.message?.content || "";
    const descMatch = result.match(/DESCRIPTION:\s*(.+)/);
    const memoriesMatch = result.match(/MEMORIES:\s*\n([\s\S]*?)(?=\nPERSONA:)/);
    const personaMatch = result.match(/PERSONA:\s*\n([\s\S]*?)(?=\nSYSTEM_PROMPT:)/);
    const promptMatch = result.match(/SYSTEM_PROMPT:\s*\n?([\s\S]+)/);

    const description = descMatch ? descMatch[1].trim() : `${name}'s style`;
    const memories = memoriesMatch ? memoriesMatch[1].trim() : "";
    const persona = personaMatch ? personaMatch[1].trim() : "";
    const systemPrompt = promptMatch ? promptMatch[1].trim() : result;

    res.json({
      preview: true,
      label: name,
      icon: icon || "fa-user",
      color: color || "text-purple-500",
      description,
      systemPrompt,
      memories,
      persona,
      sampleChatLog: chatLog.substring(0, 50000),
      relationshipInfo: relationshipInfo || "",
      personalityTags: personalityTags || "",
    });
  } catch (err) {
    console.error("Generate skill error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/skills/soulcraft/start", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { skillId } = req.body || {};
    let currentSkill = null;
    if (skillId) {
      const sid = parseInt(skillId);
      if (!sid) return res.status(400).json({ error: "invalid skillId" });
      const [s] = await db.select().from(customSkills)
        .where(and(eq(customSkills.id, sid), eq(customSkills.uid, uid)));
      if (!s) return res.status(404).json({ error: "skill not found" });
      currentSkill = s;
    }
    const out = await soulcraftStart({
      openai, uid,
      skillId: currentSkill ? currentSkill.id : null,
      currentSkill,
    });
    res.json(out);
  } catch (err) {
    console.error("soulcraft/start error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/skills/soulcraft/answer", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { sessionId, answer, skip, back } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });
    const out = await soulcraftSubmit({ openai, uid, sessionId, answer, skip, back });
    res.json(out);
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ error: err.message });
    if (err.code === "BAD_REQUEST") return res.status(400).json({ error: err.message });
    console.error("soulcraft/answer error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/skills/soulcraft/synthesize", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });
    const draft = await soulcraftSynthesize({ openai, uid, sessionId });
    res.json(draft);
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ error: err.message });
    if (err.code === "BAD_REQUEST") return res.status(400).json({ error: err.message });
    console.error("soulcraft/synthesize error:", err);
    res.status(502).json({ error: err.message });
  }
});

router.post("/api/skills/soulcraft/tweak", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { sessionId, field, draft } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });
    if (!field) return res.status(400).json({ error: "field required" });
    const out = await soulcraftTweak({ openai, uid, sessionId, field, currentDraft: draft });
    res.json(out);
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ error: err.message });
    if (err.code === "BAD_REQUEST") return res.status(400).json({ error: err.message });
    console.error("soulcraft/tweak error:", err);
    res.status(502).json({ error: err.message });
  }
});

router.post("/api/skills/soulcraft/end", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { sessionId } = req.body || {};
    if (sessionId) soulcraftEnd(uid, sessionId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/skills", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { label, icon, color, description, systemPrompt, sampleChatLog, memories, persona, relationshipInfo, personalityTags } = req.body;
    if (!label || !systemPrompt) return res.status(400).json({ error: "label and systemPrompt required" });

    const key = `custom_${label.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff\u3400-\u4dbf]/gi, '_')}_${Date.now()}`;

    const [skill] = await db.insert(customSkills).values({
      uid,
      key,
      label,
      icon: icon || "fa-user",
      color: color || "text-purple-500",
      description: description || "",
      systemPrompt,
      sampleChatLog: (sampleChatLog || "").substring(0, 50000),
      memories: (memories || "").substring(0, 50000),
      persona: (persona || "").substring(0, 50000),
      relationshipInfo: relationshipInfo || "",
      personalityTags: personalityTags || "",
    }).returning();

    res.json(skill);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/skills", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const skills = await db.select().from(customSkills)
      .where(eq(customSkills.uid, uid))
      .orderBy(desc(customSkills.createdAt));
    res.json(skills);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/skills/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const { label, icon, color, description, systemPrompt, memories, persona, personalityTags } = req.body;
    const updates = {};
    if (label !== undefined) updates.label = label;
    if (icon !== undefined) updates.icon = icon;
    if (color !== undefined) updates.color = color;
    if (description !== undefined) updates.description = description;
    if (systemPrompt !== undefined) updates.systemPrompt = systemPrompt;
    if (memories !== undefined) updates.memories = memories;
    if (persona !== undefined) updates.persona = persona;
    if (personalityTags !== undefined) updates.personalityTags = String(personalityTags).slice(0, 200);
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No updates" });
    updates.updatedAt = new Date();
    const [updated] = await db.update(customSkills).set(updates)
      .where(and(eq(customSkills.id, id), eq(customSkills.uid, uid)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Skill not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/skills/:id/correct", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const { correction, context } = req.body;
    if (!correction) return res.status(400).json({ error: "correction required" });

    const [skill] = await db.select().from(customSkills)
      .where(and(eq(customSkills.id, id), eq(customSkills.uid, uid)));
    if (!skill) return res.status(404).json({ error: "Skill not found" });

    const correctionPrompt = `You are a persona correction handler. A user has been chatting with an AI skill that roleplays as "${skill.label}" and noticed something wrong.

Current persona:
${(skill.persona || "").substring(0, 3000)}

Current system prompt (first 2000 chars):
${skill.systemPrompt.substring(0, 2000)}

The user said: "${correction}"
${context ? `Context of the conversation: ${context}` : ""}

Generate:
1. A correction record in this format: [場景：{scenario}] 不應該 {wrong behavior}，應該 {correct behavior}
2. An updated system prompt that incorporates this correction as a high-priority rule (Layer 0 override). Keep everything else the same, just add the correction rule near the top.

Output format:
CORRECTION_RECORD: (the correction record line)
UPDATED_PROMPT: (the full updated system prompt)`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: correctionPrompt }],
      max_tokens: 3000,
    });

    const result = completion.choices[0]?.message?.content || "";
    const corrRecord = result.match(/CORRECTION_RECORD:\s*(.+)/)?.[1]?.trim() || correction;
    const updatedPrompt = result.match(/UPDATED_PROMPT:\s*\n?([\s\S]+)/)?.[1]?.trim() || skill.systemPrompt;

    const existingCorrections = skill.corrections || "";
    const newCorrections = existingCorrections
      ? `${existingCorrections}\n- ${corrRecord}`
      : `- ${corrRecord}`;

    const [updated] = await db.update(customSkills).set({
      systemPrompt: updatedPrompt,
      corrections: newCorrections.substring(0, 10000),
      version: (skill.version || 1) + 1,
      updatedAt: new Date(),
    }).where(and(eq(customSkills.id, id), eq(customSkills.uid, uid)))
      .returning();

    res.json({ correctionRecord: corrRecord, skill: updated });
  } catch (err) {
    console.error("Skill correction error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/skills/:id/evolve", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const { chatLog } = req.body;
    if (!chatLog) return res.status(400).json({ error: "chatLog required" });

    const [skill] = await db.select().from(customSkills)
      .where(and(eq(customSkills.id, id), eq(customSkills.uid, uid)));
    if (!skill) return res.status(404).json({ error: "Skill not found" });

    const sampledLog = sampleChatLogText(chatLog);

    const mergePrompt = `You are an incremental persona merger. A user has provided NEW chat log data for an existing AI skill persona "${skill.label}".

EXISTING MEMORIES:
${(skill.memories || "").substring(0, 3000)}

EXISTING PERSONA:
${(skill.persona || "").substring(0, 3000)}

EXISTING SYSTEM PROMPT (first 2000 chars):
${skill.systemPrompt.substring(0, 2000)}

NEW CHAT LOG TO ANALYZE:
${sampledLog}

Rules:
- Only ADD incremental findings. Do NOT remove or overwrite existing conclusions.
- If new data CONFIRMS existing info, skip it (don't duplicate).
- If new data CONTRADICTS existing info, note the conflict but keep both.
- Preserve all existing corrections.

Output exactly:
MEMORIES_UPDATE: (new findings to append to memories, or "NONE" if nothing new)
PERSONA_UPDATE: (new findings to append to persona, or "NONE" if nothing new)
UPDATED_PROMPT: (the complete updated system prompt incorporating new findings)
SUMMARY: (1-2 sentence summary of what was added)`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: mergePrompt }],
      max_tokens: 4096,
    });

    const result = completion.choices[0]?.message?.content || "";
    const memUpdate = result.match(/MEMORIES_UPDATE:\s*\n?([\s\S]*?)(?=\nPERSONA_UPDATE:)/)?.[1]?.trim();
    const perUpdate = result.match(/PERSONA_UPDATE:\s*\n?([\s\S]*?)(?=\nUPDATED_PROMPT:)/)?.[1]?.trim();
    const updatedPrompt = result.match(/UPDATED_PROMPT:\s*\n?([\s\S]*?)(?=\nSUMMARY:)/)?.[1]?.trim();
    const summary = result.match(/SUMMARY:\s*(.+)/)?.[1]?.trim() || "Updated with new data";

    const updates = {
      version: (skill.version || 1) + 1,
      updatedAt: new Date(),
      sampleChatLog: ((skill.sampleChatLog || "") + "\n\n[=== APPENDED ===]\n" + chatLog.substring(0, 10000)).substring(0, 50000),
    };
    if (memUpdate && memUpdate !== "NONE") {
      updates.memories = ((skill.memories || "") + "\n\n## Appended (v" + updates.version + ")\n" + memUpdate).substring(0, 50000);
    }
    if (perUpdate && perUpdate !== "NONE") {
      updates.persona = ((skill.persona || "") + "\n\n## Appended (v" + updates.version + ")\n" + perUpdate).substring(0, 50000);
    }
    if (updatedPrompt) {
      updates.systemPrompt = updatedPrompt;
    }

    const [updated] = await db.update(customSkills).set(updates)
      .where(and(eq(customSkills.id, id), eq(customSkills.uid, uid)))
      .returning();

    res.json({ summary, skill: updated });
  } catch (err) {
    console.error("Skill evolution error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/skills/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const [deleted] = await db.delete(customSkills)
      .where(and(eq(customSkills.id, id), eq(customSkills.uid, uid)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Skill not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/dump/ai-sort", isAuthenticated, async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No items provided" });
    }

    const itemList = items.map((t, i) => `${i + 1}. ${t}`).join("\n");
    const prompt = `You are an ADHD productivity assistant. The user did a brain dump. For each item below, suggest one category:
- "trash" = not actionable, random thought, noise, just venting
- "later" = can wait, not urgent today, schedule for someday
- "memo" = not a task but worth noting down (idea, thought, reference, inspiration)
- "now" = should do today, actionable, important, urgent

For items categorized as "now" or "later", also assign an Eisenhower Matrix quadrant:
- "q1" = Urgent & Important (Do First)
- "q2" = Not Urgent & Important (Schedule)
- "q3" = Urgent & Not Important (Delegate)
- "q4" = Not Urgent & Not Important (Eliminate)

For ALL items (including trash and memo), also estimate difficulty:
- "easy" = quick win, simple, under 10 minutes, no thinking required
- "medium" = moderate effort, 10-30 minutes, some focus needed
- "hard" = significant effort, over 30 minutes, complex, requires deep focus

Items:
${itemList}

Reply ONLY with a JSON array of objects like: [{"index":1,"category":"now","quadrant":"q1","difficulty":"easy","reason":"short reason"}]
For "trash" and "memo" items, omit the quadrant field but still include difficulty.
No other text.`;

    const chatMessages = [
      { role: "system", content: "You are a concise productivity classifier. Reply only with valid JSON." },
      { role: "user", content: prompt },
    ];

    let fullResponse = "";
    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: chatMessages,
      max_tokens: 512,
    });
    fullResponse = stream.choices[0]?.message?.content || "";

    try {
      const cleaned = fullResponse.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      res.json({ suggestions: parsed });
    } catch {
      res.json({ suggestions: [], raw: fullResponse });
    }
  } catch (err) {
    console.error("AI sort error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/memos/ai-organize", isAuthenticated, async (req, res) => {
  try {
    const { memos: memoItems } = req.body;
    if (!memoItems || !Array.isArray(memoItems) || memoItems.length === 0) {
      return res.status(400).json({ error: "No memos provided" });
    }

    const memoList = memoItems
      .map((m, i) => `${i + 1}. [ID:${m.id}] Title: "${m.title || '(untitled)'}"\nContent: "${(m.content || '').slice(0, 300)}"`)
      .join("\n\n");

    const existingTags = [...new Set(memoItems.flatMap(m => m.tags || []))];
    const existingTagsHint = existingTags.length > 0
      ? `\nExisting tags in this collection: ${existingTags.join(", ")}. Reuse these when appropriate for consistency, but also create new tags when needed.`
      : "";

    const prompt = `You are an intelligent note organizer. Analyze the following memos and suggest 1-3 relevant tags for each one.

Tags should be short (1-2 words), lowercase, and describe the topic or category of the memo (e.g., "work", "ideas", "shopping", "health", "project", "finance", "personal", "recipe", "travel", "learning").
${existingTagsHint}

Memos:
${memoList}

Reply ONLY with a JSON array of objects like: [{"id":123,"tags":["tag1","tag2"]}]
No other text.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a concise note organizer. Reply only with valid JSON." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1024,
    });

    const fullResponse = response.choices[0]?.message?.content || "";

    try {
      const cleaned = fullResponse.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      res.json({ suggestions: parsed });
    } catch {
      res.json({ suggestions: [], raw: fullResponse });
    }
  } catch (err) {
    console.error("AI memo organize error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/ocr", isAuthenticated, upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No image provided" });

    const base64 = file.buffer.toString("base64");
    const mimeType = file.mimetype || "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an OCR assistant. Extract all readable text from the image. If it contains a list of tasks or items, return each one on a separate line. If handwritten, try your best to read it. Reply only with the extracted text, nothing else. Preserve the original language."
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Please extract all text from this image:" },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 1024,
    });

    const extracted = response.choices[0]?.message?.content || "";
    const lines = extracted.split("\n").map(l => l.replace(/^[\d\.\)\-\*\s]+/, "").trim()).filter(l => l.length > 0);

    res.json({ text: extracted, lines, imageBase64: dataUrl });
  } catch (err) {
    console.error("OCR error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/muse/chat-with-image", isAuthenticated, upload.single("image"), async (req, res) => {
  try {
    const uid = getUserId(req);
    const today = todayInTz(await getUserTimezone(uid));
    const file = req.file;
    const message = req.body.message || "What's in this image?";
    const model = req.body.model || "gpt-4o-mini";
    const conversationId = req.body.conversationId || null;

    if (!file) return res.status(400).json({ error: "No image provided" });

    const base64 = file.buffer.toString("base64");
    const mimeType = file.mimetype || "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${base64}`;

    let convoId = conversationId;
    if (convoId) {
      const [owned] = await db.select().from(museConversations)
        .where(and(eq(museConversations.id, parseInt(convoId)), eq(museConversations.uid, uid)));
      if (!owned) return res.status(403).json({ error: "Not your conversation" });
    } else {
      const title = message.length > 30 ? message.substring(0, 30) + "..." : message;
      const [convo] = await db.insert(museConversations).values({ uid, title }).returning();
      convoId = convo.id;
    }

    const history = await db.select().from(museMessages)
      .where(and(eq(museMessages.uid, uid), eq(museMessages.conversationId, convoId)))
      .orderBy(asc(museMessages.createdAt));

    const chatMessages = [
      {
        role: "system",
        content: `You are Muse, a friendly and creative AI assistant inside "Analogue Planner". You help the user plan their day, brainstorm ideas, and stay organized. Be concise, warm, and helpful. Reply in the same language the user uses.\n\nToday's date: ${today}.`
      },
      ...history.slice(-28).map(m => ({ role: m.role, content: m.content })),
      {
        role: "user",
        content: [
          { type: "text", text: message },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullResponse = "";
    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: chatMessages,
      stream: true,
      max_tokens: 1024,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    await db.insert(museMessages).values({ uid, conversationId: convoId, role: "user", content: `[Image attached]\n${message}` });
    await db.insert(museMessages).values({ uid, conversationId: convoId, role: "assistant", content: fullResponse });
    await db.update(museConversations).set({ updatedAt: new Date() })
      .where(and(eq(museConversations.id, convoId), eq(museConversations.uid, uid)));

    res.write(`data: ${JSON.stringify({ done: true, conversationId: convoId })}\n\n`);
    res.end();
  } catch (err) {
    console.error("Muse image chat error:", err);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

router.get("/api/share-token", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    let [existing] = await db.select().from(shareTokens).where(eq(shareTokens.uid, uid));
    if (!existing) {
      const token = crypto.randomUUID();
      [existing] = await db.insert(shareTokens).values({ uid, token }).returning();
    }
    res.json({ token: existing.token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/share-token/regenerate", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const newToken = crypto.randomUUID();
    await db.delete(shareTokens).where(eq(shareTokens.uid, uid));
    const [created] = await db.insert(shareTokens).values({ uid, token: newToken }).returning();
    res.json({ token: created.token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/share-shortcut", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    let [existing] = await db.select().from(shareTokens).where(eq(shareTokens.uid, uid));
    if (!existing) {
      const token = crypto.randomUUID();
      [existing] = await db.insert(shareTokens).values({ uid, token }).returning();
    }
    const shareToken = existing.token;
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const appUrl = `${protocol}://${host}`;
    const endpointUrl = `${appUrl}/api/share-receive`;

    const plist = generateShortcutPlist(endpointUrl, shareToken);

    res.setHeader("Content-Type", "application/x-apple-shortcut");
    res.setHeader("Content-Disposition", 'attachment; filename="Save to Analogue.shortcut"');
    res.send(plist);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/share-receive", upload.single("file"), async (req, res) => {
  try {
    const shareToken = req.headers["x-share-token"];
    if (!shareToken) {
      return res.status(401).json({ error: "Share token required" });
    }
    const [tokenRecord] = await db.select().from(shareTokens).where(eq(shareTokens.token, shareToken));
    if (!tokenRecord) {
      return res.status(401).json({ error: "Invalid share token" });
    }
    const uid = tokenRecord.uid;

    const title = req.body?.title || "";
    const text = req.body?.text || "";
    const url = req.body?.url || "";

    const parts = [];
    if (text) parts.push(text);
    if (url) parts.push(url);
    const content = parts.join("\n\n") || "(shared content)";

    const [memo] = await db.insert(memos).values({
      uid,
      title: title || (url || "Shared from iOS"),
      content,
      color: "white",
    }).returning();

    if (req.file) {
      const file = req.file;
      const filename = `${crypto.randomUUID()}${path.extname(file.originalname)}`;
      const dataBase64 = file.buffer.toString("base64");
      const fileUrl = `/api/file-data/${filename}`;
      await db.insert(memoFiles).values({
        memoId: memo.id,
        filename,
        originalName: file.originalname,
        url: fileUrl,
        mimeType: file.mimetype || "",
        data: dataBase64,
      });
    }

    res.json({ success: true, memoId: memo.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/rize/sessions", isAuthenticated, async (req, res) => {
  const apiKey = process.env.RIZE_API_KEY;
  if (!apiKey) return res.status(404).json({ error: "Rize not configured" });
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "date required (YYYY-MM-DD)" });
    const startTime = `${date}T00:00:00+08:00`;
    const endTime = `${date}T23:59:59+08:00`;

    const query = `{
      sessions(startTime: "${startTime}", endTime: "${endTime}") {
        id startTime endTime title description type source
      }
      timeEntries(startTime: "${startTime}", endTime: "${endTime}", first: 50) {
        edges {
          node {
            id startTime endTime duration title description source status
          }
        }
      }
      categories(startTime: "${startTime}", endTime: "${endTime}") {
        category { name key focus work } timeSpent
      }
    }`;

    const rizeRes = await fetch("https://api.rize.io/api/v1/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query }),
    });
    const data = await rizeRes.json();
    if (data.errors) {
      return res.status(500).json({ error: data.errors[0].message });
    }

    const sessions = data.data?.sessions || [];
    const timeEntries = (data.data?.timeEntries?.edges || []).map(e => e.node);
    const categories = (data.data?.categories || []).map(c => ({
      name: c.category.name,
      key: c.category.key,
      focus: c.category.focus,
      work: c.category.work,
      timeSpent: c.timeSpent,
    }));

    res.json({ sessions, timeEntries, categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/push/vapid-key", (req, res) => {
  const key = getVapidPublicKey();
  if (!key) return res.status(404).json({ error: "Push not configured" });
  res.json({ publicKey: key });
});

router.post("/api/push/subscribe", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: "Invalid subscription" });
    }
    await saveSubscription(uid, subscription);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/push/unsubscribe", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: "Missing endpoint" });
    await removeSubscription(uid, endpoint);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/rss/feeds", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const feeds = await db.select().from(rssFeeds).where(eq(rssFeeds.uid, uid)).orderBy(rssFeeds.createdAt);
    res.json(feeds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/rss/feeds", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { url, title } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });
    const [feed] = await db.insert(rssFeeds).values({
      uid, url, title: title || url, siteUrl: "",
    }).returning();
    res.json(feed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/rss/feeds/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const feedId = parseInt(req.params.id);
    if (!Number.isFinite(feedId)) return res.status(400).json({ error: "Invalid feed id" });
    const updates = {};
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "autoSummarize")) {
      updates.autoSummarize = !!req.body.autoSummarize;
    }
    if (req.body && typeof req.body.title === "string") {
      updates.title = req.body.title.slice(0, 200);
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No updatable fields" });

    const [existing] = await db.select().from(rssFeeds)
      .where(and(eq(rssFeeds.id, feedId), eq(rssFeeds.uid, uid)));
    if (!existing) return res.status(404).json({ error: "Feed not found" });

    if (updates.autoSummarize === true && !isYoutubeChannelFeedUrl(existing.url)) {
      return res.status(400).json({ error: "Auto-summarize is only available for YouTube channel feeds" });
    }

    const [updated] = await db.update(rssFeeds)
      .set(updates)
      .where(and(eq(rssFeeds.id, feedId), eq(rssFeeds.uid, uid)))
      .returning();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/rss/auto-import/run", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const result = await runYoutubeAutoImportForUser(uid);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/rss/auto-import/stats", isAdmin, async (_req, res) => {
  res.json(getYoutubeAutoImportStats());
});

router.delete("/api/rss/feeds/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const feedId = parseInt(req.params.id);
    await db.delete(rssFeeds).where(and(eq(rssFeeds.id, feedId), eq(rssFeeds.uid, uid)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const HK_NEWS_PACK = [
  { key: "rthk-zh", title: "RTHK 即時新聞 (中)", url: "https://rthk.hk/rthk/news/rss/c_expressnews_clocal.xml", language: "zh", category: "news" },
  { key: "rthk-en", title: "RTHK Express News (EN)", url: "https://rthk.hk/rthk/news/rss/e_expressnews_elocal.xml", language: "en", category: "news" },
  { key: "tvb-news", title: "TVB News (best-effort)", url: "analogue-source:tvb-news", language: "zh", category: "news", bestEffort: true },
  { key: "cr881", title: "商業電台 881903 (best-effort)", url: "analogue-source:cr881", language: "zh", category: "news", bestEffort: true },
  { key: "line-today-hk", title: "LINE Today HK (best-effort)", url: "analogue-source:line-today-hk", language: "zh", category: "news", bestEffort: true },
];

function isPrivateHostname(hostname) {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" ||
    h.startsWith("10.") || h.startsWith("192.168.") || h.startsWith("172.") ||
    h === "[::1]" || h.endsWith(".local") || h.endsWith(".internal");
}

async function safeFetch(url, opts = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error("Invalid URL"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Only http/https URLs allowed");
  if (isPrivateHostname(parsed.hostname)) throw new Error("Private/local URLs not allowed");
  return await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(opts.timeoutMs || 10000),
    headers: { "User-Agent": "Mozilla/5.0 Analogue-RSS/1.0", ...(opts.headers || {}) },
  });
}

async function fetchTvbNewsAdapter() {
  try {
    const r = await safeFetch("https://news.tvb.com/sitemap-news.xml", {
      headers: { Accept: "application/xml, text/xml" },
    });
    if (!r.ok) throw new Error("TVB News sitemap unreachable");
    const xml = await r.text();
    const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].slice(0, 30);
    const items = urls.map(([, block]) => {
      const loc = block.match(/<loc>([\s\S]*?)<\/loc>/i);
      const title = block.match(/<news:title>([\s\S]*?)<\/news:title>/i);
      const date = block.match(/<news:publication_date>([\s\S]*?)<\/news:publication_date>/i)
        || block.match(/<lastmod>([\s\S]*?)<\/lastmod>/i);
      return {
        title: title ? decodeXmlEntities(title[1].trim()) : "",
        link: loc ? loc[1].trim() : "",
        pubDate: date ? date[1].trim() : "",
        description: "",
      };
    }).filter(i => i.link);
    return { title: "TVB News", siteUrl: "https://news.tvb.com/", items };
  } catch (err) {
    throw new Error(`Source temporarily unavailable: ${err.message}`);
  }
}

async function fetchCr881Adapter() {
  try {
    const r = await safeFetch("https://www.881903.com/news/realtime");
    if (!r.ok) throw new Error("881903 news page unreachable");
    const html = await r.text();
    const items = [];
    const linkRe = /<a[^>]+href="(\/news\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const seen = new Set();
    let m;
    while ((m = linkRe.exec(html)) && items.length < 30) {
      const href = m[1];
      if (!/\/news\/(realtime|local|hongkong|china|world|finance|entertainment|sport)\/[\w\-]+/i.test(href)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      const text = m[2].replace(/<[^>]+>/g, "").trim();
      if (!text) continue;
      items.push({
        title: decodeXmlEntities(text).slice(0, 200),
        link: new URL(href, "https://www.881903.com").toString(),
        pubDate: "",
        description: "",
      });
    }
    if (items.length === 0) throw new Error("881903 layout changed (no items parsed)");
    return { title: "商業電台 881903", siteUrl: "https://www.881903.com/", items };
  } catch (err) {
    throw new Error(`Source temporarily unavailable: ${err.message}`);
  }
}

async function fetchLineTodayHkAdapter() {
  try {
    const r = await safeFetch("https://today.line.me/hk/v2/tab/recommend", {
      headers: { Accept: "application/json,text/html" },
    });
    if (!r.ok) throw new Error("LINE Today HK endpoint unreachable");
    const ct = r.headers.get("content-type") || "";
    let items = [];
    if (ct.includes("json")) {
      const data = await r.json();
      const articles = (data?.articles || data?.result?.articles || data?.feed?.items || []).slice(0, 30);
      items = articles.map(a => ({
        title: a.title || a.name || "",
        link: a.url || a.link || (a.hash ? `https://today.line.me/hk/v2/article/${a.hash}` : ""),
        pubDate: a.publishTimeUnix ? new Date(a.publishTimeUnix * 1000).toISOString()
          : (a.publishTime ? new Date(a.publishTime).toISOString() : ""),
        description: a.summary || "",
      })).filter(i => i.title && i.link);
    } else {
      const html = await r.text();
      const seen = new Set();
      const re = /<a[^>]+href="(\/hk\/v2\/article\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(html)) && items.length < 30) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        const text = m[2].replace(/<[^>]+>/g, "").trim();
        if (!text) continue;
        items.push({
          title: decodeXmlEntities(text).slice(0, 200),
          link: `https://today.line.me${m[1]}`,
          pubDate: "",
          description: "",
        });
      }
    }
    if (items.length === 0) throw new Error("LINE Today HK layout changed (no items parsed)");
    return { title: "LINE Today HK", siteUrl: "https://today.line.me/hk", items };
  } catch (err) {
    throw new Error(`Source temporarily unavailable: ${err.message}`);
  }
}

async function fetchAdapterFeed(adapterId) {
  if (adapterId === "tvb-news") return await fetchTvbNewsAdapter();
  if (adapterId === "cr881") return await fetchCr881Adapter();
  if (adapterId === "line-today-hk") return await fetchLineTodayHkAdapter();
  throw new Error(`Unknown adapter: ${adapterId}`);
}

async function resolveYoutubeChannelId(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) throw new Error("YouTube channel input required");
  if (/^UC[A-Za-z0-9_-]{22}$/.test(trimmed)) return trimmed;
  let urlStr = trimmed;
  if (urlStr.startsWith("@")) urlStr = "https://www.youtube.com/" + urlStr;
  else if (!/^https?:\/\//i.test(urlStr)) urlStr = "https://www.youtube.com/" + urlStr.replace(/^\//, "");
  let parsed;
  try { parsed = new URL(urlStr); } catch { throw new Error("Invalid YouTube channel URL or handle"); }
  if (!/(^|\.)youtube\.com$/i.test(parsed.hostname) && parsed.hostname !== "youtu.be") {
    throw new Error("Not a YouTube URL");
  }
  const m1 = parsed.pathname.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/);
  if (m1) return m1[1];
  const resp = await safeFetch(urlStr, { headers: { Accept: "text/html" } });
  if (!resp.ok) throw new Error("Failed to fetch YouTube page");
  const html = await resp.text();
  const m2 = html.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/)
    || html.match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/)
    || html.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/);
  if (!m2) throw new Error("Could not resolve YouTube channel ID");
  return m2[1];
}

router.get("/api/rss/hk-pack", isAuthenticated, async (req, res) => {
  res.json(HK_NEWS_PACK.map(({ key, title, url, language, category, bestEffort }) => ({
    key, title, url, language, category, bestEffort: !!bestEffort,
  })));
});

router.post("/api/rss/feeds/hk-pack", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const existing = await db.select().from(rssFeeds).where(eq(rssFeeds.uid, uid));
    const existingUrls = new Set(existing.map(f => f.url));
    const toAdd = HK_NEWS_PACK.filter(p => !existingUrls.has(p.url));
    const added = [];
    for (const p of toAdd) {
      const [feed] = await db.insert(rssFeeds).values({
        uid, url: p.url, title: p.title, siteUrl: "",
      }).returning();
      added.push(feed);
    }
    res.json({
      added: added.length,
      skipped: HK_NEWS_PACK.length - added.length,
      feeds: added,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/rss/feeds/youtube", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { input, title } = req.body || {};
    const channelId = await resolveYoutubeChannelId(input);
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const existing = await db.select().from(rssFeeds)
      .where(and(eq(rssFeeds.uid, uid), eq(rssFeeds.url, url)));
    if (existing.length > 0) {
      return res.json({ feed: existing[0], created: false, channelId });
    }
    const [feed] = await db.insert(rssFeeds).values({
      uid, url, title: title || `YouTube · ${channelId}`, siteUrl: `https://www.youtube.com/channel/${channelId}`,
    }).returning();
    res.json({ feed, created: true, channelId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/api/digest/preferences", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const [pref] = await db.select().from(digestPreferences).where(eq(digestPreferences.uid, uid));
    if (!pref) {
      const userFeeds = await db.select().from(rssFeeds).where(eq(rssFeeds.uid, uid));
      const hkUrls = new Set(HK_NEWS_PACK.map(p => p.url));
      const defaultIds = userFeeds.filter(f => hkUrls.has(f.url)).map(f => f.id);
      return res.json({
        selectedFeedIds: defaultIds,
        windowHours: 24,
        keyword: "",
      });
    }
    let ids = [];
    try { ids = JSON.parse(pref.selectedFeedIds || "[]"); } catch {}
    if (!Array.isArray(ids)) ids = [];
    res.json({
      selectedFeedIds: ids.map(Number).filter(n => Number.isFinite(n)),
      windowHours: pref.windowHours ?? 24,
      keyword: pref.keyword ?? "",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/digest/preferences", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { selectedFeedIds, windowHours, keyword } = req.body || {};
    const ids = Array.isArray(selectedFeedIds)
      ? selectedFeedIds.map(Number).filter(n => Number.isFinite(n))
      : [];
    const win = Number.isFinite(Number(windowHours)) ? Math.max(1, Math.min(24 * 30, parseInt(windowHours))) : 24;
    const kw = typeof keyword === "string" ? keyword.slice(0, 200) : "";
    const values = {
      uid,
      selectedFeedIds: JSON.stringify(ids),
      windowHours: win,
      keyword: kw,
      updatedAt: new Date(),
    };
    await db.insert(digestPreferences).values(values)
      .onConflictDoUpdate({
        target: digestPreferences.uid,
        set: { selectedFeedIds: values.selectedFeedIds, windowHours: values.windowHours, keyword: values.keyword, updatedAt: values.updatedAt },
      });
    res.json({ ok: true, selectedFeedIds: ids, windowHours: win, keyword: kw });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/rss/fetch", isAuthenticated, async (req, res) => {
  try {
    const feedUrl = req.query.url;
    if (!feedUrl) return res.status(400).json({ error: "url param required" });
    if (typeof feedUrl === "string" && feedUrl.startsWith("analogue-source:")) {
      const adapterId = feedUrl.slice("analogue-source:".length);
      try {
        const result = await fetchAdapterFeed(adapterId);
        return res.json(result);
      } catch (err) {
        return res.json({ title: "", siteUrl: "", items: [], error: err.message || "Source temporarily unavailable" });
      }
    }
    let parsed;
    try { parsed = new URL(feedUrl); } catch { return res.status(400).json({ error: "Invalid URL" }); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return res.status(400).json({ error: "Only http/https URLs allowed" });
    }
    if (isPrivateHostname(parsed.hostname)) {
      return res.status(400).json({ error: "Private/local URLs not allowed" });
    }
    const response = await fetch(feedUrl, {
      headers: { "User-Agent": "Analogue-RSS/1.0", "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!response.ok) return res.status(502).json({ error: "Failed to fetch feed" });
    const text = await response.text();
    const items = parseRssFeed(text);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function parseRssFeed(xml) {
  const result = { title: "", siteUrl: "", items: [] };
  const channelTitleMatch = xml.match(/<channel[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i);
  if (channelTitleMatch) result.title = decodeXmlEntities(channelTitleMatch[1].trim());
  const channelLinkMatch = xml.match(/<channel[^>]*>[\s\S]*?<link[^>]*>([\s\S]*?)<\/link>/i);
  if (channelLinkMatch) result.siteUrl = decodeXmlEntities(channelLinkMatch[1].trim());
  const isAtom = /<feed[\s>]/i.test(xml);
  if (isAtom) {
    const feedTitleMatch = xml.match(/<feed[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i);
    if (feedTitleMatch) result.title = decodeXmlEntities(feedTitleMatch[1].trim());
    const feedLinkMatch = xml.match(/<feed[^>]*>[\s\S]*?<link[^>]*href="([^"]+)"/i);
    if (feedLinkMatch) result.siteUrl = feedLinkMatch[1];
    const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    for (const entry of entries.slice(0, 50)) {
      const t = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const l = entry.match(/<link[^>]*href="([^"]+)"/i);
      const d = entry.match(/<published[^>]*>([\s\S]*?)<\/published>/i) || entry.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);
      const s = entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || entry.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
      result.items.push({
        title: t ? decodeXmlEntities(t[1].trim()) : "",
        link: l ? l[1] : "",
        pubDate: d ? d[1].trim() : "",
        description: s ? decodeXmlEntities(s[1].trim()).replace(/<[^>]+>/g, '').slice(0, 300) : "",
      });
    }
  } else {
    const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
    for (const item of items.slice(0, 50)) {
      const t = item.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const l = item.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
      const d = item.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || item.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i);
      const s = item.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
      result.items.push({
        title: t ? decodeXmlEntities(t[1].trim()) : "",
        link: l ? decodeXmlEntities(l[1].trim()) : "",
        pubDate: d ? d[1].trim() : "",
        description: s ? decodeXmlEntities(s[1].trim()).replace(/<[^>]+>/g, '').slice(0, 300) : "",
      });
    }
  }
  return result;
}

function extractTldrFromMemoBody(body) {
  if (!body) return "";
  const lines = String(body).split("\n");
  for (const ln of lines) {
    const t = ln.trim();
    if (t.startsWith("> ")) return t.slice(2).trim().slice(0, 200);
  }
  return lines.find(l => l.trim() && !l.trim().startsWith("*"))?.trim().slice(0, 200) || "";
}

function decodeXmlEntities(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
}

router.post("/api/email/webhook", async (req, res) => {
  try {
    const token = req.headers["x-webhook-secret"] || req.query.secret;
    const expected = process.env.EMAIL_WEBHOOK_SECRET;
    if (!expected || token !== expected) return res.status(401).json({ error: "Unauthorized" });
    const { from, subject, body, userEmail } = req.body;
    if (!subject && !body) return res.status(400).json({ error: "Email content required" });
    const targetEmail = userEmail || from;
    if (!targetEmail) return res.status(400).json({ error: "No target user email" });
    const [user] = await db.select().from(users).where(eq(users.email, targetEmail)).limit(1);
    if (!user) return res.status(404).json({ error: "User not found" });
    const uid = user.id;
    const [saved] = await db.insert(emailInbox).values({
      uid, fromAddress: from || "", subject: subject || "", body: body || "",
    }).returning();
    let resultType = "memo";
    let resultId = null;
    try {
      const openai = new OpenAI();
      const emailText = `From: ${from || 'unknown'}\nSubject: ${subject || ''}\n\n${(body || '').slice(0, 2000)}`;
      const classification = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: `You classify forwarded emails. Respond in JSON format:
{"type": "task" or "memo", "title": "...", "content": "...", "date": "YYYY-M-D or null", "tags": ["..."]}
- If email contains action items, deadlines, or to-dos → type: "task"
- If email is informational, reference, or FYI → type: "memo"
- Extract key info into concise title and content
- If you find a date/deadline, format as YYYY-M-D (non-padded)
- Add relevant tags` },
          { role: "user", content: emailText },
        ],
        response_format: { type: "json_object" },
        max_tokens: 500,
      });
      const parsed = JSON.parse(classification.choices[0].message.content);
      if (parsed.type === "task") {
        const now = getNowInTz(await getUserTimezone(uid));
        const [task] = await db.insert(tasks).values({
          uid, name: parsed.title || subject || "Email task",
          color: "blue-200 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
          date: parsed.date || `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`,
          done: false, order: 0,
          description: parsed.content || body?.slice(0, 500) || "",
        }).returning();
        resultType = "task";
        resultId = task.id;
      } else {
        const [memo] = await db.insert(memos).values({
          uid, title: parsed.title || subject || "Email memo",
          content: parsed.content || body?.slice(0, 2000) || "",
          color: "blue", noteType: "literature",
        }).returning();
        if (parsed.tags && parsed.tags.length > 0) {
          for (const tag of parsed.tags.slice(0, 5)) {
            await db.insert(memoTags).values({ memoId: memo.id, tag: String(tag).toLowerCase() });
          }
        }
        await db.insert(memoTags).values({ memoId: memo.id, tag: "email" });
        resultType = "memo";
        resultId = memo.id;
      }
    } catch (aiErr) {
      const [memo] = await db.insert(memos).values({
        uid, title: subject || "Forwarded email",
        content: `From: ${from || 'unknown'}\n\n${body?.slice(0, 2000) || ''}`,
        color: "blue", noteType: "literature",
      }).returning();
      await db.insert(memoTags).values({ memoId: memo.id, tag: "email" });
      resultType = "memo";
      resultId = memo.id;
    }
    await db.update(emailInbox).set({ processed: true, resultType, resultId }).where(eq(emailInbox.id, saved.id));
    res.json({ ok: true, resultType, resultId, id: saved.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/email/inbound", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { from, subject, body } = req.body;
    if (!subject && !body) return res.status(400).json({ error: "Email content required" });
    const [saved] = await db.insert(emailInbox).values({
      uid, fromAddress: from || "", subject: subject || "", body: body || "",
    }).returning();
    let resultType = "memo";
    let resultId = null;
    try {
      const openai = new OpenAI();
      const emailText = `From: ${from || 'unknown'}\nSubject: ${subject || ''}\n\n${(body || '').slice(0, 2000)}`;
      const classification = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: `You classify forwarded emails. Respond in JSON format:
{"type": "task" or "memo", "title": "...", "content": "...", "date": "YYYY-M-D or null", "tags": ["..."]}
- If email contains action items, deadlines, or to-dos → type: "task"
- If email is informational, reference, or FYI → type: "memo"
- Extract key info into concise title and content
- If you find a date/deadline, format as YYYY-M-D (non-padded)
- Add relevant tags` },
          { role: "user", content: emailText },
        ],
        response_format: { type: "json_object" },
        max_tokens: 500,
      });
      const parsed = JSON.parse(classification.choices[0].message.content);
      if (parsed.type === "task") {
        const now = getNowInTz(await getUserTimezone(uid));
        const [task] = await db.insert(tasks).values({
          uid, name: parsed.title || subject || "Email task",
          color: "blue-200 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
          date: parsed.date || `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`,
          done: false, order: 0,
          description: parsed.content || body?.slice(0, 500) || "",
        }).returning();
        resultType = "task";
        resultId = task.id;
      } else {
        const [memo] = await db.insert(memos).values({
          uid, title: parsed.title || subject || "Email memo",
          content: parsed.content || body?.slice(0, 2000) || "",
          color: "blue", noteType: "literature",
        }).returning();
        if (parsed.tags && parsed.tags.length > 0) {
          for (const tag of parsed.tags.slice(0, 5)) {
            await db.insert(memoTags).values({ memoId: memo.id, tag: String(tag).toLowerCase() });
          }
        }
        await db.insert(memoTags).values({ memoId: memo.id, tag: "email" });
        resultType = "memo";
        resultId = memo.id;
      }
    } catch (aiErr) {
      const [memo] = await db.insert(memos).values({
        uid, title: subject || "Forwarded email",
        content: `From: ${from || 'unknown'}\n\n${body?.slice(0, 2000) || ''}`,
        color: "blue", noteType: "literature",
      }).returning();
      await db.insert(memoTags).values({ memoId: memo.id, tag: "email" });
      resultType = "memo";
      resultId = memo.id;
    }
    await db.update(emailInbox).set({ processed: true, resultType, resultId }).where(eq(emailInbox.id, saved.id));
    res.json({ ok: true, resultType, resultId, id: saved.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/email/inbox", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const items = await db.select().from(emailInbox).where(eq(emailInbox.uid, uid)).orderBy(desc(emailInbox.createdAt)).limit(50);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/email/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    await db.delete(emailInbox).where(and(eq(emailInbox.id, id), eq(emailInbox.uid, uid)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getGmailOAuth2Client() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = (process.env.REPLIT_DOMAINS || "localhost:3001").split(",")[0];
  const protocol = redirectUri.includes("localhost") ? "http" : "https";
  return new google.auth.OAuth2(clientId, clientSecret, `${protocol}://${redirectUri}/api/gmail/callback`);
}

router.get("/api/gmail/auth-url", isAuthenticated, (req, res) => {
  try {
    const oauth2 = getGmailOAuth2Client();
    const uid = getUserId(req);
    const url = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.modify"],
      state: String(uid),
    });
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/gmail/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    const uid = parseInt(state);
    if (!code || !uid) return res.status(400).send("Missing code or state");
    const oauth2 = getGmailOAuth2Client();
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);
    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    const profile = await gmail.users.getProfile({ userId: "me" });
    const gmailEmail = profile.data.emailAddress || "";
    const existing = await db.select().from(gmailTokens).where(eq(gmailTokens.uid, uid)).limit(1);
    if (existing.length > 0) {
      await db.update(gmailTokens).set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || existing[0].refreshToken,
        expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        gmailEmail, enabled: true,
      }).where(eq(gmailTokens.uid, uid));
    } else {
      await db.insert(gmailTokens).values({
        uid, accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || "",
        expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        gmailEmail, enabled: true,
      });
    }
    res.send(`<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#111;color:#fff"><div style="text-align:center"><h2>Gmail Connected!</h2><p>${gmailEmail}</p><p>You can close this window.</p><script>setTimeout(()=>window.close(),2000)</script></div></body></html>`);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

router.get("/api/gmail/status", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const [token] = await db.select().from(gmailTokens).where(eq(gmailTokens.uid, uid)).limit(1);
    if (!token) return res.json({ connected: false });
    res.json({ connected: true, email: token.gmailEmail, label: token.labelName, enabled: token.enabled, lastChecked: token.lastChecked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/gmail/disconnect", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    await db.delete(gmailTokens).where(eq(gmailTokens.uid, uid));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/gmail/settings", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { labelName, enabled } = req.body;
    const updates = {};
    if (labelName !== undefined) updates.labelName = labelName;
    if (enabled !== undefined) updates.enabled = enabled;
    await db.update(gmailTokens).set(updates).where(eq(gmailTokens.uid, uid));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/gmail/check-now", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const results = await checkGmailForUser(uid);
    res.json({ ok: true, processed: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function checkGmailForUser(uid) {
  const [token] = await db.select().from(gmailTokens).where(and(eq(gmailTokens.uid, uid), eq(gmailTokens.enabled, true))).limit(1);
  if (!token) return [];
  const oauth2 = getGmailOAuth2Client();
  oauth2.setCredentials({ access_token: token.accessToken, refresh_token: token.refreshToken, expiry_date: token.expiry ? token.expiry.getTime() : 0 });
  oauth2.on("tokens", async (newTokens) => {
    const updates = { accessToken: newTokens.access_token };
    if (newTokens.expiry_date) updates.expiry = new Date(newTokens.expiry_date);
    if (newTokens.refresh_token) updates.refreshToken = newTokens.refresh_token;
    await db.update(gmailTokens).set(updates).where(eq(gmailTokens.uid, uid));
  });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });
  const labelName = token.labelName || "ToAnalogue";
  let labelId = null;
  try {
    const labelsRes = await gmail.users.labels.list({ userId: "me" });
    const found = labelsRes.data.labels?.find(l => l.name === labelName);
    if (found) {
      labelId = found.id;
    } else {
      const created = await gmail.users.labels.create({ userId: "me", requestBody: { name: labelName, labelListVisibility: "labelShow", messageListVisibility: "show" } });
      labelId = created.data.id;
    }
  } catch (e) {
    console.error("Gmail label error:", e.message);
    return [];
  }
  let messages = [];
  try {
    const listRes = await gmail.users.messages.list({ userId: "me", labelIds: [labelId], maxResults: 10 });
    messages = listRes.data.messages || [];
  } catch (e) {
    console.error("Gmail list error:", e.message);
    return [];
  }
  const results = [];
  for (const msg of messages) {
    try {
      const full = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "full" });
      const headers = full.data.payload?.headers || [];
      const getH = (n) => headers.find(h => h.name.toLowerCase() === n.toLowerCase())?.value || "";
      const from = getH("From");
      const subject = getH("Subject");
      let body = "";
      const extractBody = (part) => {
        if (part.mimeType === "text/plain" && part.body?.data) {
          body = Buffer.from(part.body.data, "base64url").toString("utf8");
        } else if (part.parts) {
          for (const p of part.parts) { if (!body) extractBody(p); }
        }
      };
      if (full.data.payload) extractBody(full.data.payload);
      if (!body && full.data.snippet) body = full.data.snippet;
      const [saved] = await db.insert(emailInbox).values({ uid, fromAddress: from, subject, body: body.slice(0, 5000) }).returning();
      let resultType = "memo";
      let resultId = null;
      try {
        const openai = new OpenAI();
        const emailText = `From: ${from}\nSubject: ${subject}\n\n${body.slice(0, 2000)}`;
        const classification = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: `You classify forwarded emails. Respond in JSON format:
{"type": "task" or "memo", "title": "...", "content": "...", "date": "YYYY-M-D or null", "tags": ["..."]}
- If email contains action items, deadlines, or to-dos → type: "task"
- If email is informational, reference, or FYI → type: "memo"
- Extract key info into concise title and content
- If you find a date/deadline, format as YYYY-M-D (non-padded)
- Add relevant tags` },
            { role: "user", content: emailText },
          ],
          response_format: { type: "json_object" },
          max_tokens: 500,
        });
        const parsed = JSON.parse(classification.choices[0].message.content);
        if (parsed.type === "task") {
          const now = getNowInTz(await getUserTimezone(uid));
          const [task] = await db.insert(tasks).values({
            uid, name: parsed.title || subject || "Email task",
            color: "blue-200 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
            date: parsed.date || `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`,
            done: false, order: 0,
            description: parsed.content || body.slice(0, 500),
          }).returning();
          resultType = "task";
          resultId = task.id;
        } else {
          const [memo] = await db.insert(memos).values({
            uid, title: parsed.title || subject || "Email memo",
            content: parsed.content || body.slice(0, 2000),
            color: "blue", noteType: "literature",
          }).returning();
          if (parsed.tags?.length) {
            for (const tag of parsed.tags.slice(0, 5)) {
              await db.insert(memoTags).values({ memoId: memo.id, tag: String(tag).toLowerCase() });
            }
          }
          await db.insert(memoTags).values({ memoId: memo.id, tag: "email" });
          resultType = "memo";
          resultId = memo.id;
        }
      } catch (aiErr) {
        const [memo] = await db.insert(memos).values({
          uid, title: subject || "Forwarded email",
          content: `From: ${from}\n\n${body.slice(0, 2000)}`,
          color: "blue", noteType: "literature",
        }).returning();
        await db.insert(memoTags).values({ memoId: memo.id, tag: "email" });
        resultType = "memo";
        resultId = memo.id;
      }
      await db.update(emailInbox).set({ processed: true, resultType, resultId }).where(eq(emailInbox.id, saved.id));
      results.push({ id: saved.id, subject, resultType, resultId });
      await gmail.users.messages.modify({ userId: "me", id: msg.id, requestBody: { removeLabelIds: [labelId] } });
    } catch (msgErr) {
      console.error("Gmail message processing error:", msgErr.message);
    }
  }
  await db.update(gmailTokens).set({ lastChecked: new Date() }).where(eq(gmailTokens.uid, uid));
  return results;
}

async function gmailPollingLoop() {
  const INTERVAL = 5 * 60 * 1000;
  setInterval(async () => {
    try {
      const allTokens = await db.select().from(gmailTokens).where(eq(gmailTokens.enabled, true));
      for (const t of allTokens) {
        try {
          await checkGmailForUser(t.uid);
        } catch (e) {
          console.error(`Gmail poll error for uid ${t.uid}:`, e.message);
        }
      }
    } catch (e) {
      console.error("Gmail polling loop error:", e.message);
    }
  }, INTERVAL);
}

if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET) {
  gmailPollingLoop();
  console.log("Gmail polling started (every 5 minutes)");
}

router.get("/api/expenses", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const rows = await db.select().from(expenses)
      .where(eq(expenses.uid, uid))
      .orderBy(desc(expenses.createdAt));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/expenses", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { store, date, currency, total, items, notes, category } = req.body;
    const [row] = await db.insert(expenses).values({
      uid,
      store: store || "",
      date: date || todayPaddedInTz(await getUserTimezone(uid)),
      currency: currency || "HKD",
      total: String(total || 0),
      items: typeof items === 'string' ? items : JSON.stringify(items || []),
      notes: notes || "",
      category: category || "other",
      source: "web",
    }).returning();
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const autoCaptureRateLimit = new Map();
router.post("/api/expenses/auto-capture", async (req, res) => {
  try {
    const shareToken = req.headers["x-share-token"];
    if (!shareToken) {
      return res.status(401).json({ error: "Share token required" });
    }
    const [tokenRecord] = await db.select().from(shareTokens).where(eq(shareTokens.token, shareToken));
    if (!tokenRecord) {
      return res.status(401).json({ error: "Invalid share token" });
    }
    const uid = tokenRecord.uid;

    const now = Date.now();
    const rateKey = `${uid}`;
    const lastCalls = autoCaptureRateLimit.get(rateKey) || [];
    const recentCalls = lastCalls.filter(t => now - t < 60000);
    if (recentCalls.length >= 10) {
      return res.status(429).json({ error: "Too many requests. Max 10 per minute." });
    }
    recentCalls.push(now);
    autoCaptureRateLimit.set(rateKey, recentCalls);

    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "No notification text provided" });
    }
    if (text.length > 1000) {
      return res.status(400).json({ error: "Text too long. Max 1000 characters." });
    }

    const userTz = await getUserTimezone(uid);
    const today = getNowInTz(userTz);
    const todayStr = todayPaddedInTz(userTz);
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You parse payment notification text from Android phones into structured expense data. Today is ${todayStr} (${dayNames[today.getDay()]}).

These notifications come from payment apps like Google Pay, Octopus (八達通), HSBC, Hang Seng Bank (恒生), Bank of China (中銀), WeChat Pay, Alipay HK, PayMe, Tap & Go, etc.

Common notification formats:
- Google Pay: "You paid HK$45.00 at McDonald's with Visa •••1234"
- Octopus: "八達通消費 HK$12.50 餘額 HK$150.00" or "Octopus payment HK$12.50"
- HSBC: "HSBC: Your credit card ending 1234 was charged HKD 280.00 at AEON"
- Hang Seng: "恒生信用卡 尾號1234 消費 HKD500.00 商戶: 百佳超級市場"
- Bank of China: "中銀信用卡消費通知 金額:HKD$188.00 商戶:UNIQLO"
- PayMe: "You paid $100.00 to John"
- Tap & Go: "Tap & Go 消費 HK$35.00"
- Generic: "已付款 $200"

Return ONLY valid JSON:
{
  "store": "merchant/store name extracted from notification",
  "date": "YYYY-MM-DD format, default today ${todayStr}",
  "currency": "HKD (or other if clearly stated)",
  "items": [{"name": "payment description", "price": number}],
  "total": number,
  "notes": "original notification text (truncated if very long)",
  "category": "food|grocery|transport|shopping|entertainment|health|bills|telecom|other"
}

Category hints:
- McDonald's, KFC, restaurants = food
- 百佳, 惠康, ParknShop, Wellcome, AEON = grocery
- MTR, bus, taxi, Uber, DiDi = transport
- UNIQLO, H&M, ZARA, Apple Store = shopping
- 7-Eleven, OK便利店 = grocery
- If amount is very small (<$5) and from Octopus, likely transport

Extract the amount carefully. Parse HK$, HKD, $, ¥ prefixes. The total should be a number without currency symbols.
If no date in the notification, use today ${todayStr}.`
        },
        { role: "user", content: text },
      ],
      temperature: 0,
      max_tokens: 300,
    });

    const aiText = response.choices[0]?.message?.content?.trim();
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(422).json({ error: "Could not parse notification" });
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      return res.status(422).json({ error: "Could not parse notification" });
    }

    const validCategories = ["food", "grocery", "transport", "shopping", "entertainment", "health", "bills", "telecom", "other"];
    const safeTotal = parseFloat(parsed.total);
    const dateMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(parsed.date);
    const safeDate = dateMatch
      ? `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`
      : todayStr;
    const safeCategory = validCategories.includes(parsed.category) ? parsed.category : "other";

    const [row] = await db.insert(expenses).values({
      uid,
      store: String(parsed.store || "").slice(0, 200),
      date: safeDate,
      currency: String(parsed.currency || "HKD").slice(0, 10),
      total: String(isNaN(safeTotal) ? 0 : safeTotal),
      items: JSON.stringify(Array.isArray(parsed.items) ? parsed.items.slice(0, 20) : []),
      notes: String(parsed.notes || text.slice(0, 200)).slice(0, 500),
      category: safeCategory,
      source: "notification",
    }).returning();

    res.json(row);
  } catch (err) {
    console.error("Auto-capture error:", err.message);
    res.status(500).json({ error: "Failed to process notification" });
  }
});

router.post("/api/expenses/parse", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "No text provided" });

    const userTz = await getUserTimezone(uid);
    const today = getNowInTz(userTz);
    const todayStr = todayPaddedInTz(userTz);
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You parse expense/spending messages into structured data. Today is ${todayStr} (${dayNames[today.getDay()]}).
Return ONLY valid JSON:
{
  "store": "store/restaurant name or description",
  "date": "YYYY-MM-DD format date, default today ${todayStr}",
  "currency": "HKD",
  "items": [{"name": "item description", "price": number}],
  "total": number,
  "notes": "any extra details or null",
  "category": "food|grocery|transport|shopping|entertainment|health|bills|telecom|other"
}

Date parsing examples:
- "今日"/"today" = ${todayStr}
- "昨天"/"尋日"/"yesterday" = yesterday's date
- "4月13日" = ${today.getFullYear()}-04-13
- If no date, use ${todayStr}

Amount: "133蚊"/"$133"/"133" = 133. Parse Chinese/Cantonese amounts.
Strip prefixes like "記帳","記賬","expense" before parsing.`
        },
        { role: "user", content: text },
      ],
      temperature: 0,
      max_tokens: 300,
    });

    const aiText = response.choices[0]?.message?.content?.trim();
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      res.json(JSON.parse(jsonMatch[0]));
    } else {
      res.status(422).json({ error: "Could not parse expense" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/expenses/import-text", isAuthenticated, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "No text provided" });
    const userTz = await getUserTimezone(getUserId(req));
    const today = getNowInTz(userTz);
    const todayStr = todayPaddedInTz(userTz);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You extract ALL expense/transaction records from text data (CSV, tab-separated, plain text lists, bank statements, Octopus card records, etc.). Today is ${todayStr}.

Return ONLY valid JSON array of transactions:
[
  {
    "store": "store/merchant name or description",
    "date": "YYYY-MM-DD",
    "currency": "HKD",
    "total": number (positive, use absolute value),
    "category": "food|grocery|transport|shopping|entertainment|health|bills|telecom|other",
    "notes": "optional extra info"
  }
]

RULES:
- Extract EVERY transaction/line from the text
- Dates: convert all formats to YYYY-MM-DD. If year missing, use ${today.getFullYear()}
- Amounts: always positive numbers
- Category: transport (MTR/巴士/小巴/的士/Uber), food (restaurants/食), grocery (百佳/惠康/7-11), health (醫/clinic), etc.
- "增值"/"top-up" = category "other", notes "top-up"
- Be thorough — do NOT skip any line`
        },
        { role: "user", content: text },
      ],
      temperature: 0,
      max_tokens: 4096,
    });

    const aiText = response.choices[0]?.message?.content?.trim();
    const jsonMatch = aiText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const records = JSON.parse(jsonMatch[0]);
      res.json({ records });
    } else {
      res.status(422).json({ error: "Could not parse transactions from text" });
    }
  } catch (err) {
    console.error("Expense text import error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/expenses/import-image", isAuthenticated, upload.single("image"), async (req, res) => {
  try {
    const base64 = req.file.buffer.toString("base64");
    const mime = req.file.mimetype;
    const userTz = await getUserTimezone(getUserId(req));
    const today = getNowInTz(userTz);
    const todayStr = todayPaddedInTz(userTz);

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You extract ALL expense/transaction records from images (receipts, bank statements, Octopus card history, payment app screenshots, etc.). Today is ${todayStr}.

Return ONLY valid JSON array of transactions:
[
  {
    "store": "store/merchant name or description",
    "date": "YYYY-MM-DD",
    "currency": "HKD",
    "total": number (positive, use absolute value),
    "category": "food|grocery|transport|shopping|entertainment|health|bills|telecom|other",
    "notes": "optional extra info"
  }
]

IMPORTANT RULES:
- Extract EVERY single transaction visible in the image, even if there are 50+
- For Octopus/八達通 records: each line is a separate transaction. The merchant/location name is the store.
- For bank statements: each debit/transaction line is a separate entry
- Dates: convert all date formats to YYYY-MM-DD. If year is missing, use ${today.getFullYear()}
- Amounts: always positive numbers. Convert negative amounts to positive.
- Category guessing: transport companies (MTR/巴士/小巴/的士/Uber) = transport, restaurants/食 = food, supermarkets/百佳/惠康/AEON = grocery, 7-11/OK便利店 = grocery, clinics/醫 = health, etc.
- If a transaction shows "增值"/"top-up"/"充值", category = "other" with notes "top-up"
- Be thorough — do NOT skip any transaction line`
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract ALL transactions from this image. Be thorough and extract every single line item." },
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}`, detail: "high" } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 4096,
    });

    const aiText = response.choices[0]?.message?.content?.trim();
    const jsonMatch = aiText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const records = JSON.parse(jsonMatch[0]);
      res.json({ records });
    } else {
      res.status(422).json({ error: "Could not parse transactions from image" });
    }
  } catch (err) {
    console.error("Expense image import error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/expenses/bulk", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { records } = req.body;
    if (!Array.isArray(records)) return res.status(400).json({ error: "records array required" });
    const fallbackDate = todayPaddedInTz(await getUserTimezone(uid));
    const inserted = [];
    for (const rec of records) {
      const [row] = await db.insert(expenses).values({
        uid,
        store: rec.store || "Unknown",
        total: String(rec.total || 0),
        category: rec.category || "other",
        date: rec.date || fallbackDate,
        currency: rec.currency || "HKD",
        notes: rec.notes || "",
        items: JSON.stringify(rec.items || []),
        source: "import",
      }).returning();
      inserted.push(row);
    }
    res.json(inserted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/blood-pressure/import-text", isAuthenticated, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "No text provided" });
    const userTz = await getUserTimezone(getUserId(req));
    const today = getNowInTz(userTz);
    const todayStr = todayPaddedInTz(userTz);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You extract ALL blood pressure readings from text data (CSV, tab-separated, plain text tables, medical records). Today is ${todayStr}.

Return ONLY valid JSON array:
[
  {
    "date": "YYYY-MM-DD",
    "time": "HH:MM" (24-hour format, or null if not provided),
    "sys": number (systolic),
    "dia": number (diastolic),
    "pulse": number (heart rate)
  }
]

RULES:
- Extract EVERY reading from the text
- Dates must be YYYY-MM-DD with zero-padding
- Convert AM/PM times to 24-hour format
- SYS is typically 80-200, DIA is typically 40-120, Pulse is typically 40-120
- If no date, use ${todayStr}
- Handle various formats: CSV, tab-separated, space-separated, tables
- Be thorough — do NOT skip any line with BP data`
        },
        { role: "user", content: text },
      ],
      temperature: 0,
      max_tokens: 4096,
    });

    const aiText = response.choices[0]?.message?.content?.trim();
    const jsonMatch = aiText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const records = JSON.parse(jsonMatch[0]);
      res.json({ records });
    } else {
      res.status(422).json({ error: "Could not parse BP readings from text" });
    }
  } catch (err) {
    console.error("BP text import error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/blood-pressure/import-image", isAuthenticated, upload.single("image"), async (req, res) => {
  try {
    const base64 = req.file.buffer.toString("base64");
    const mime = req.file.mimetype;
    const userTz = await getUserTimezone(getUserId(req));
    const today = getNowInTz(userTz);
    const todayStr = todayPaddedInTz(userTz);

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You extract ALL blood pressure readings from images (BP monitor photos, medical records, tables, screenshots). Today is ${todayStr}.

Return ONLY valid JSON array:
[
  {
    "date": "YYYY-MM-DD",
    "time": "HH:MM" (24-hour format, or null if not shown),
    "sys": number (systolic, the higher number),
    "dia": number (diastolic, the lower number),
    "pulse": number (heart rate)
  }
]

RULES:
- Extract EVERY reading visible
- SYS is typically 80-200, DIA is typically 40-120, Pulse is typically 40-120
- Convert AM/PM times to 24-hour format
- If multiple readings on one device screen, extract each one
- If it's a table/list of readings, extract ALL rows
- Dates must be YYYY-MM-DD with zero-padding (e.g. 2025-07-06)
- If no date is visible, use ${todayStr}`
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract ALL blood pressure readings from this image." },
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}`, detail: "high" } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 4096,
    });

    const aiText = response.choices[0]?.message?.content?.trim();
    const jsonMatch = aiText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const records = JSON.parse(jsonMatch[0]);
      res.json({ records });
    } else {
      res.status(422).json({ error: "Could not parse BP readings from image" });
    }
  } catch (err) {
    console.error("BP image import error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/blood-pressure/bulk", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { records } = req.body;
    if (!Array.isArray(records)) return res.status(400).json({ error: "records array required" });
    const inserted = [];
    for (const rec of records) {
      const sys = parseInt(rec.sys);
      const dia = parseInt(rec.dia);
      const pulse = parseInt(rec.pulse);
      if (isNaN(sys) || isNaN(dia) || isNaN(pulse)) continue;
      if (sys < 40 || sys > 300 || dia < 20 || dia > 200 || pulse < 20 || pulse > 250) continue;
      const [row] = await db.insert(bloodPressure).values({
        uid, date: rec.date, time: rec.time || null,
        sys, dia, pulse, source: "import",
      }).returning();
      inserted.push(row);
    }
    res.json(inserted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/expenses/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const [deleted] = await db.delete(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.uid, uid)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/expenses/audit-log", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const rows = await db.select().from(expenseAuditLog)
      .where(eq(expenseAuditLog.uid, uid))
      .orderBy(desc(expenseAuditLog.createdAt))
      .limit(limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/expenses/audit-log/:id/undo", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const [entry] = await db.select().from(expenseAuditLog)
      .where(and(eq(expenseAuditLog.id, id), eq(expenseAuditLog.uid, uid)));
    if (!entry) return res.status(404).json({ error: "Audit entry not found" });

    if (entry.action === "update") {
      if (!entry.expenseId || !entry.field) {
        return res.status(400).json({ error: "Cannot undo this entry" });
      }
      const [exp] = await db.select().from(expenses)
        .where(and(eq(expenses.id, entry.expenseId), eq(expenses.uid, uid)));
      if (!exp) return res.status(404).json({ error: "Original expense no longer exists" });

      const allowed = new Set(["store", "total", "category", "date", "notes", "currency"]);
      if (!allowed.has(entry.field)) {
        return res.status(400).json({ error: "Field not undoable" });
      }
      const update = {};
      if (entry.oldValue == null) {
        update[entry.field] = null;
      } else if (entry.field === "total") {
        const n = parseFloat(entry.oldValue);
        update.total = String(Number.isFinite(n) ? n : 0);
      } else {
        update[entry.field] = String(entry.oldValue);
      }
      const [updated] = await db.update(expenses).set(update)
        .where(and(eq(expenses.id, entry.expenseId), eq(expenses.uid, uid)))
        .returning();
      await db.delete(expenseAuditLog).where(eq(expenseAuditLog.id, id));
      return res.json({ ok: true, kind: "update", expense: updated });
    }

    if (entry.action === "delete") {
      let snap = null;
      if (entry.snapshot) {
        try { snap = JSON.parse(entry.snapshot); } catch (e) { snap = null; }
      }
      const fallbackTotal = parseFloat(entry.total);
      const totalRaw = snap?.total != null ? snap.total : (Number.isFinite(fallbackTotal) ? fallbackTotal : 0);
      const totalNum = parseFloat(totalRaw);
      let itemsStr = "[]";
      if (snap?.items != null) {
        try {
          itemsStr = typeof snap.items === "string" ? snap.items : JSON.stringify(snap.items);
        } catch (e) { itemsStr = "[]"; }
      }
      const values = {
        uid,
        store: snap?.store ?? entry.store ?? "",
        currency: snap?.currency ?? entry.currency ?? "HKD",
        total: String(Number.isFinite(totalNum) ? totalNum : 0),
        date: snap?.date ?? null,
        items: itemsStr,
        notes: snap?.notes ?? "",
        category: snap?.category ?? "other",
        memoId: snap?.memoId ?? null,
        source: snap?.source ?? entry.source ?? "line",
      };
      const [restored] = await db.insert(expenses).values(values).returning();
      await db.delete(expenseAuditLog).where(eq(expenseAuditLog.id, id));
      return res.json({ ok: true, kind: "restore", expense: restored });
    }

    return res.status(400).json({ error: "Action not undoable" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/food/audit-log", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const rows = await db.select().from(foodAuditLog)
      .where(eq(foodAuditLog.uid, uid))
      .orderBy(desc(foodAuditLog.createdAt))
      .limit(limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/food/audit-log/:id/undo", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const [entry] = await db.select().from(foodAuditLog)
      .where(and(eq(foodAuditLog.id, id), eq(foodAuditLog.uid, uid)));
    if (!entry) return res.status(404).json({ error: "Audit entry not found" });

    if (entry.action === "update") {
      if (!entry.foodId || !entry.field) {
        return res.status(400).json({ error: "Cannot undo this entry" });
      }
      const [existing] = await db.select().from(foodLog)
        .where(and(eq(foodLog.id, entry.foodId), eq(foodLog.uid, uid)));
      if (!existing) return res.status(404).json({ error: "Original food log no longer exists" });

      const allowed = new Set(["items", "totalCalories", "mealType", "date", "time"]);
      if (!allowed.has(entry.field)) {
        return res.status(400).json({ error: "Field not undoable" });
      }
      const update = {};
      if (entry.field === "totalCalories") {
        const n = parseFloat(entry.oldValue);
        update.totalCalories = Math.round(Number.isFinite(n) ? n : 0);
      } else if (entry.field === "time") {
        update.time = entry.oldValue ? String(entry.oldValue) : null;
      } else if (entry.field === "items") {
        let prevItems = null;
        try { prevItems = entry.oldValue ? JSON.parse(entry.oldValue) : null; } catch (e) { prevItems = null; }
        if (!Array.isArray(prevItems)) {
          return res.status(400).json({ error: "Cannot undo items: missing previous value" });
        }
        update.items = JSON.stringify(prevItems);
        update.totalCalories = Math.round(prevItems.reduce((s, it) => s + (Number(it?.calories) || 0), 0));
      } else {
        if (entry.oldValue == null || entry.oldValue === "") {
          return res.status(400).json({ error: "Cannot undo to empty value" });
        }
        update[entry.field] = String(entry.oldValue);
      }
      const [updated] = await db.update(foodLog).set(update)
        .where(and(eq(foodLog.id, entry.foodId), eq(foodLog.uid, uid)))
        .returning();
      await db.delete(foodAuditLog).where(eq(foodAuditLog.id, id));
      return res.json({ ok: true, kind: "update", food: updated });
    }

    if (entry.action === "delete") {
      let snap = null;
      if (entry.snapshot) {
        try { snap = JSON.parse(entry.snapshot); } catch (e) { snap = null; }
      }
      if (!snap) {
        return res.status(400).json({ error: "No snapshot available to restore" });
      }
      let itemsStr = "[]";
      if (snap.items != null) {
        try {
          itemsStr = typeof snap.items === "string" ? snap.items : JSON.stringify(snap.items);
        } catch (e) { itemsStr = "[]"; }
      }
      const totalNum = parseFloat(snap.totalCalories);
      const healthNum = parseInt(snap.healthScore);
      const values = {
        uid,
        date: snap.date || todayPaddedInTz(await getUserTimezone(uid)),
        time: snap.time || null,
        items: itemsStr,
        totalCalories: Math.round(Number.isFinite(totalNum) ? totalNum : 0),
        mealType: snap.mealType || "unknown",
        suggestion: snap.suggestion || "",
        healthScore: Number.isFinite(healthNum) ? healthNum : 0,
        source: snap.source || "line",
      };
      const [restored] = await db.insert(foodLog).values(values).returning();
      await db.delete(foodAuditLog).where(eq(foodAuditLog.id, id));
      return res.json({ ok: true, kind: "restore", food: restored });
    }

    return res.status(400).json({ error: "Action not undoable" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/blood-pressure", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const month = req.query.month;
    let rows;
    if (month) {
      rows = await db.select().from(bloodPressure)
        .where(and(eq(bloodPressure.uid, uid), sql`${bloodPressure.date} LIKE ${month + '%'}`))
        .orderBy(desc(bloodPressure.date), desc(bloodPressure.time));
    } else {
      rows = await db.select().from(bloodPressure)
        .where(eq(bloodPressure.uid, uid))
        .orderBy(desc(bloodPressure.date), desc(bloodPressure.time));
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.post("/api/blood-pressure", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { date, time, sys, dia, pulse, source } = req.body;
    if (!date || sys == null || dia == null || pulse == null) {
      return res.status(400).json({ error: "date, sys, dia, pulse are required" });
    }
    const sysVal = parseInt(sys);
    const diaVal = parseInt(dia);
    const pulseVal = parseInt(pulse);
    if (isNaN(sysVal) || isNaN(diaVal) || isNaN(pulseVal)) {
      return res.status(400).json({ error: "sys, dia, pulse must be valid numbers" });
    }
    if (sysVal < 40 || sysVal > 300 || diaVal < 20 || diaVal > 200 || pulseVal < 20 || pulseVal > 250) {
      return res.status(400).json({ error: "Values out of range" });
    }
    const [row] = await db.insert(bloodPressure).values({
      uid, date, time: time || null,
      sys: sysVal, dia: diaVal, pulse: pulseVal,
      source: source || "web",
    }).returning();
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/blood-pressure/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const { date, time, sys, dia, pulse } = req.body;
    const updates = {};
    if (date !== undefined) updates.date = date;
    if (time !== undefined) updates.time = time;
    if (sys !== undefined) {
      const v = parseInt(sys);
      if (isNaN(v) || v < 40 || v > 300) return res.status(400).json({ error: "SYS out of range" });
      updates.sys = v;
    }
    if (dia !== undefined) {
      const v = parseInt(dia);
      if (isNaN(v) || v < 20 || v > 200) return res.status(400).json({ error: "DIA out of range" });
      updates.dia = v;
    }
    if (pulse !== undefined) {
      const v = parseInt(pulse);
      if (isNaN(v) || v < 20 || v > 250) return res.status(400).json({ error: "Pulse out of range" });
      updates.pulse = v;
    }
    const [updated] = await db.update(bloodPressure)
      .set(updates)
      .where(and(eq(bloodPressure.id, id), eq(bloodPressure.uid, uid)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/blood-pressure/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const [deleted] = await db.delete(bloodPressure)
      .where(and(eq(bloodPressure.id, id), eq(bloodPressure.uid, uid)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/weather", async (req, res) => {
  try {
    async function fetchHKO(dataType) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const r = await fetch(`https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=${dataType}&lang=tc`, { signal: controller.signal });
        if (!r.ok) throw new Error(`HKO ${dataType} returned ${r.status}`);
        return await r.json();
      } finally {
        clearTimeout(timeout);
      }
    }
    const [current, forecast, local, warnsum, warningInfo, swt] = await Promise.all([
      fetchHKO('rhrread'), fetchHKO('fnd'), fetchHKO('flw'),
      fetchHKO('warnsum'), fetchHKO('warningInfo'), fetchHKO('swt'),
    ]);
    let tctrack = null;
    try {
      tctrack = await fetchHKO('tctrack');
    } catch (e) {}
    res.json({ current, forecast, local, warnsum, warningInfo, swt, tctrack });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Career Ops job pipeline -------------------------------------------------
router.get("/api/career/jobs", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const status = req.query.status ? String(req.query.status) : null;
    const where = status
      ? and(eq(jobOpportunities.uid, uid), eq(jobOpportunities.status, status))
      : eq(jobOpportunities.uid, uid);
    const rows = await db.select().from(jobOpportunities).where(where).orderBy(desc(jobOpportunities.updatedAt));
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/api/career/jobs/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const [row] = await db.select().from(jobOpportunities)
      .where(and(eq(jobOpportunities.id, id), eq(jobOpportunities.uid, uid)));
    if (!row) return res.status(404).json({ error: "Not found" });
    const history = await db.select().from(jobStatusHistory)
      .where(eq(jobStatusHistory.jobId, id)).orderBy(asc(jobStatusHistory.createdAt));
    res.json({ ...row, history });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/api/career/jobs", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { company, role, location, comp, sourceUrl, jdText, score, evaluation, notes, status } = req.body || {};
    if (!company && !role) return res.status(400).json({ error: "company or role required" });
    const st = CAREER_STAGES.includes(status) ? status : "saved";
    const [row] = await db.insert(jobOpportunities).values({
      uid,
      company: String(company || "").slice(0, 200),
      role: String(role || "").slice(0, 200),
      location: String(location || "").slice(0, 200),
      comp: String(comp || "").slice(0, 200),
      sourceUrl: String(sourceUrl || "").slice(0, 1000),
      jdText: String(jdText || "").slice(0, 20_000),
      status: st,
      score: String(score || "").slice(0, 8),
      evaluationJson: evaluation ? JSON.stringify(evaluation).slice(0, 20_000) : "",
      notes: String(notes || "").slice(0, 4000),
    }).returning();
    await db.insert(jobStatusHistory).values({ jobId: row.id, uid, fromStatus: "", toStatus: st, note: "Created" });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch("/api/career/jobs/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(jobOpportunities)
      .where(and(eq(jobOpportunities.id, id), eq(jobOpportunities.uid, uid)));
    if (!existing) return res.status(404).json({ error: "Not found" });
    const updates = { updatedAt: new Date() };
    const allowed = ["company", "role", "location", "comp", "sourceUrl", "jdText", "score", "notes"];
    for (const k of allowed) if (req.body?.[k] !== undefined) updates[k] = String(req.body[k]).slice(0, 20_000);
    if (req.body?.evaluation !== undefined) updates.evaluationJson = JSON.stringify(req.body.evaluation).slice(0, 20_000);
    let statusChanged = false;
    if (req.body?.status !== undefined) {
      if (!CAREER_STAGES.includes(req.body.status)) {
        return res.status(400).json({ error: `Invalid status. Allowed: ${CAREER_STAGES.join(", ")}` });
      }
      if (req.body.status !== existing.status) {
        updates.status = req.body.status;
        statusChanged = true;
      }
    }
    const [updated] = await db.update(jobOpportunities).set(updates).where(eq(jobOpportunities.id, id)).returning();
    if (statusChanged) {
      await db.insert(jobStatusHistory).values({
        jobId: id, uid, fromStatus: existing.status, toStatus: updated.status,
        note: String(req.body?.statusNote || "").slice(0, 1000),
      });
    }
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/api/career/jobs/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(jobOpportunities)
      .where(and(eq(jobOpportunities.id, id), eq(jobOpportunities.uid, uid)));
    if (!existing) return res.status(404).json({ error: "Not found" });
    await db.delete(jobStatusHistory).where(eq(jobStatusHistory.jobId, id));
    await db.delete(jobOpportunities).where(eq(jobOpportunities.id, id));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/api/milestones", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const result = await db.select().from(lifeMilestones).where(eq(lifeMilestones.uid, uid)).orderBy(lifeMilestones.date);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/milestones", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { title, date, endDate, color, icon, notes } = req.body;
    if (!title || !date) return res.status(400).json({ error: "Title and date are required" });
    const [m] = await db.insert(lifeMilestones).values({
      uid, title, date, endDate: endDate || null, color: color || "blue", icon: icon || "fa-solid fa-star", notes: notes || "",
    }).returning();
    res.json(m);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/milestones/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(lifeMilestones).where(and(eq(lifeMilestones.id, id), eq(lifeMilestones.uid, uid)));
    if (!existing) return res.status(404).json({ error: "Not found" });
    const { title, date, endDate, color, icon, notes } = req.body;
    if (!title || !date) return res.status(400).json({ error: "Title and date are required" });
    const [updated] = await db.update(lifeMilestones).set({ title, date, endDate: endDate || null, color: color || "blue", icon: icon || "fa-solid fa-star", notes: notes || "", updatedAt: new Date() }).where(and(eq(lifeMilestones.id, id), eq(lifeMilestones.uid, uid))).returning();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/milestones/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(lifeMilestones).where(and(eq(lifeMilestones.id, id), eq(lifeMilestones.uid, uid)));
    if (!existing) return res.status(404).json({ error: "Not found" });
    await db.delete(lifeMilestones).where(and(eq(lifeMilestones.id, id), eq(lifeMilestones.uid, uid)));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/life-activity", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const userMemos = await db.select({ id: memos.id, date: memos.date, createdAt: memos.createdAt, title: memos.title }).from(memos).where(eq(memos.uid, uid));
    const userTasks = await db.select({ id: tasks.id, name: tasks.name, date: tasks.date, done: tasks.done, createdAt: tasks.createdAt }).from(tasks).where(eq(tasks.uid, uid));

    const activity = {};
    for (const m of userMemos) {
      const d = m.createdAt ? m.createdAt.toISOString().split('T')[0] : null;
      if (d) {
        if (!activity[d]) activity[d] = { memos: 0, tasks: 0 };
        activity[d].memos++;
      }
    }
    for (const t of userTasks) {
      const d = t.createdAt ? t.createdAt.toISOString().split('T')[0] : null;
      if (d) {
        if (!activity[d]) activity[d] = { memos: 0, tasks: 0 };
        activity[d].tasks++;
      }
    }

    const memoTimeline = userMemos
      .filter(m => m.title)
      .map(m => ({
        id: m.id,
        title: m.title,
        date: m.date || (m.createdAt ? m.createdAt.toISOString().split('T')[0] : null),
      }))
      .filter(m => m.date);

    const taskTimeline = userTasks
      .filter(t => t.name)
      .map(t => ({
        id: t.id,
        title: t.name,
        date: t.date || (t.createdAt ? t.createdAt.toISOString().split('T')[0] : null),
        done: t.done,
      }))
      .filter(t => t.date);

    res.json({ activity, memoTimeline, taskTimeline });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/graph-connections", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const conns = await db.select().from(graphConnections).where(eq(graphConnections.uid, uid));
    res.json(conns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/graph-connections", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { sourceType, sourceId, targetType, targetId, label, color } = req.body;
    const allowed = ['task', 'memo', 'milestone'];
    if (!allowed.includes(sourceType) || !allowed.includes(targetType)) return res.status(400).json({ error: "Invalid type" });
    if (!sourceId || !targetId) return res.status(400).json({ error: "Missing IDs" });
    const sId = parseInt(sourceId);
    const tId = parseInt(targetId);
    const tableMap = { task: tasks, memo: memos, milestone: lifeMilestones };
    const uidCol = { task: tasks.uid, memo: memos.uid, milestone: lifeMilestones.uid };
    const idCol = { task: tasks.id, memo: memos.id, milestone: lifeMilestones.id };
    const [sOwner] = await db.select({ id: idCol[sourceType] }).from(tableMap[sourceType]).where(and(eq(idCol[sourceType], sId), eq(uidCol[sourceType], uid)));
    const [tOwner] = await db.select({ id: idCol[targetType] }).from(tableMap[targetType]).where(and(eq(idCol[targetType], tId), eq(uidCol[targetType], uid)));
    if (!sOwner || !tOwner) return res.status(403).json({ error: "Item not found or not owned" });
    const [conn] = await db.insert(graphConnections).values({ uid, sourceType, sourceId: sId, targetType, targetId: tId, label: label || "", color: color || "#6b7280" }).returning();
    res.json(conn);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/graph-connections/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    await db.delete(graphConnections).where(and(eq(graphConnections.id, id), eq(graphConnections.uid, uid)));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/steps", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const month = req.query.month;
    let rows;
    if (month) {
      rows = await db.select().from(steps)
        .where(and(eq(steps.uid, uid), sql`${steps.date} LIKE ${month + '%'}`))
        .orderBy(desc(steps.date));
    } else {
      rows = await db.select().from(steps)
        .where(eq(steps.uid, uid))
        .orderBy(desc(steps.date));
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/steps", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { date, steps: stepsVal, distance, calories, walkTime, remarks, source } = req.body;
    if (!date || stepsVal == null) {
      return res.status(400).json({ error: "date and steps are required" });
    }
    const sv = parseInt(stepsVal);
    if (isNaN(sv) || sv < 0 || sv > 200000) {
      return res.status(400).json({ error: "steps must be 0-200000" });
    }
    const cal = calories != null ? parseInt(calories) : null;
    const [row] = await db.insert(steps).values({
      uid, date, steps: sv,
      distance: distance || null,
      calories: (cal != null && !isNaN(cal)) ? cal : null,
      walkTime: walkTime || null,
      remarks: remarks || null,
      source: source || "web",
    }).returning();
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/steps/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const { date, steps: stepsVal, distance, calories, walkTime, remarks } = req.body;
    const updates = {};
    if (date !== undefined) updates.date = date;
    if (stepsVal !== undefined) {
      const v = parseInt(stepsVal);
      if (isNaN(v) || v < 0 || v > 200000) return res.status(400).json({ error: "steps out of range" });
      updates.steps = v;
    }
    if (distance !== undefined) updates.distance = distance;
    if (calories !== undefined) {
      const v = parseInt(calories);
      updates.calories = (!isNaN(v)) ? v : null;
    }
    if (walkTime !== undefined) updates.walkTime = walkTime || null;
    if (remarks !== undefined) updates.remarks = remarks || null;
    const [updated] = await db.update(steps)
      .set(updates)
      .where(and(eq(steps.id, id), eq(steps.uid, uid)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/steps/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const [deleted] = await db.delete(steps)
      .where(and(eq(steps.id, id), eq(steps.uid, uid)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/steps/import-image", isAuthenticated, upload.single("image"), async (req, res) => {
  try {
    const base64 = req.file.buffer.toString("base64");
    const mime = req.file.mimetype;
    const userTz = await getUserTimezone(getUserId(req));
    const today = getNowInTz(userTz);
    const todayStr = todayPaddedInTz(userTz);

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You extract step count data from screenshots of fitness apps (Samsung Health, Google Fit, Apple Health, Sweatcoin, etc.). Today is ${todayStr}.

Return ONLY valid JSON array:
[
  {
    "date": "YYYY-MM-DD",
    "steps": number,
    "distance": "X.XX km" or null,
    "calories": number or null
  }
]

RULES:
- Extract EVERY day's data visible in the screenshot
- Steps is the main number (e.g. 8,234 steps → 8234)
- Distance in km (convert from miles if needed: 1 mile = 1.609 km)
- Calories as integer (kcal)
- Dates must be YYYY-MM-DD with zero-padding
- If no date visible, use ${todayStr}
- Handle various formats: daily summary, weekly chart, history list`
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract ALL step count data from this fitness app screenshot." },
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}`, detail: "high" } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 4096,
    });

    const aiText = response.choices[0]?.message?.content?.trim();
    const jsonMatch = aiText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const records = JSON.parse(jsonMatch[0]);
      res.json({ records });
    } else {
      res.status(422).json({ error: "Could not parse step data from image" });
    }
  } catch (err) {
    console.error("Steps image import error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/steps/import-text", isAuthenticated, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "No text provided" });
    const userTz = await getUserTimezone(getUserId(req));
    const today = getNowInTz(userTz);
    const todayStr = todayPaddedInTz(userTz);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You extract step count data from text (CSV, tables, plain text). Today is ${todayStr}.

Return ONLY valid JSON array:
[
  {
    "date": "YYYY-MM-DD",
    "steps": number,
    "distance": "X.XX km" or null,
    "calories": number or null
  }
]

RULES:
- Extract EVERY entry
- Dates must be YYYY-MM-DD
- If no date, use ${todayStr}
- Steps as integer
- Distance in km if available
- Calories as integer if available`
        },
        { role: "user", content: text },
      ],
      temperature: 0,
      max_tokens: 4096,
    });

    const aiText = response.choices[0]?.message?.content?.trim();
    const jsonMatch = aiText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const records = JSON.parse(jsonMatch[0]);
      res.json({ records });
    } else {
      res.status(422).json({ error: "Could not parse step data from text" });
    }
  } catch (err) {
    console.error("Steps text import error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/steps/bulk", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { records } = req.body;
    if (!Array.isArray(records)) return res.status(400).json({ error: "records array required" });
    const inserted = [];
    for (const rec of records) {
      const sv = parseInt(rec.steps);
      if (isNaN(sv) || sv < 0 || sv > 200000) continue;
      const cal = rec.calories != null ? parseInt(rec.calories) : null;
      const [row] = await db.insert(steps).values({
        uid, date: rec.date, steps: sv,
        distance: rec.distance || null,
        calories: (cal != null && !isNaN(cal)) ? cal : null,
        walkTime: rec.walkTime || null,
        remarks: rec.remarks || null,
        source: "import",
      }).returning();
      inserted.push(row);
    }
    res.json(inserted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Last 30 Days research panel
// ---------------------------------------------------------------------------

const LAST30_ALLOWED_SOURCES = new Set([
  "reddit", "hn", "github", "youtube", "x", "tiktok", "polymarket", "web",
]);

export function sanitizeBriefHtml(html) {
  return sanitizeHtml(html || "", {
    allowedTags: [
      "h1","h2","h3","h4","h5","h6","p","br","hr","div","span","a","strong","b","em","i","u","s","del",
      "ul","ol","li","blockquote","pre","code","table","thead","tbody","tr","th","td",
      "img","figure","figcaption","sub","sup","mark","details","summary","abbr","small","section","article","header","footer","nav","main","aside",
    ],
    allowedAttributes: {
      "*": ["class","style","id","title"],
      a: ["href","name","target","rel","class","style","title"],
      img: ["src","alt","width","height","class","style","title"],
      td: ["colspan","rowspan","class","style"],
      th: ["colspan","rowspan","class","style","scope"],
    },
    allowedSchemes: ["http","https","mailto","data"],
    allowedSchemesByTag: { img: ["http","https","data"] },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          target: attribs.target || "_blank",
          rel: "noopener noreferrer",
        },
      }),
    },
  });
}

function publicLast30Row(row) {
  if (!row) return null;
  let sources = [];
  try { sources = JSON.parse(row.sourcesJson || "[]"); } catch {}
  return {
    id: row.id,
    topic: row.topic,
    sources,
    status: row.status,
    errorMessage: row.errorMessage || null,
    missingKey: row.missingKey || null,
    engineVersion: row.engineVersion || null,
    hasHtml: !!row.htmlPath && row.status === "succeeded",
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

function normalizeSourcesInput(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const s of input) {
    if (typeof s !== "string") continue;
    const norm = s.trim().toLowerCase();
    if (LAST30_ALLOWED_SOURCES.has(norm) && !out.includes(norm)) out.push(norm);
  }
  return out;
}

// --- Muse Office quick-action jobs -----------------------------------------

router.get("/api/office/action-types", isAuthenticated, (_req, res) => {
  // Hide internal action types (e.g. 'reaction') so the office UI can never
  // surface them as user-pickable quick actions.
  const out = Object.entries(OFFICE_PUBLIC_ACTION_TYPES).map(([key, def]) => ({
    key, label: def.label,
    // restrictedTo (optional) lists the only skillKeys allowed to pick this
    // action. UI filters by this; backend currently doesn't enforce.
    ...(def.restrictedTo ? { restrictedTo: def.restrictedTo } : {}),
  }));
  // C2 · Surface multi-step templates as additional manager-only actions.
  // The frontend posts them through the same /api/office/jobs path with
  // actionType=`template:<key>`, which the POST handler routes to
  // startOfficeTemplate().
  for (const t of listOfficeTemplates()) {
    out.push({
      key: `template:${t.key}`,
      label: `▶ ${t.label}`,
      desc: t.desc,
      steps: t.steps,
      restrictedTo: ["manager"],
      kind: "template",
    });
  }
  res.json(out);
});

router.get("/api/office/templates", isAuthenticated, (_req, res) => {
  res.json(listOfficeTemplates());
});

router.post("/api/office/jobs", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { skillKey, actionType, argument } = req.body || {};
    if (!skillKey || typeof skillKey !== "string") {
      return res.status(400).json({ error: "skillKey required" });
    }
    // C2 · Template chain shortcut. UI posts actionType="template:<key>";
    // we kick off the multi-step parent + first child here and short-circuit
    // the normal single-action path.
    if (typeof actionType === "string" && actionType.startsWith("template:")) {
      const templateKey = actionType.slice("template:".length);
      if (!isValidTemplateKey(templateKey)) {
        return res.status(400).json({ error: "invalid template" });
      }
      const parent = await startOfficeTemplate({
        uid,
        templateKey,
        userInput: (argument || "").toString().slice(0, 1500),
      });
      return res.json(parent);
    }
    if (!isValidOfficeAction(actionType)) {
      return res.status(400).json({ error: "invalid actionType" });
    }
    const row = await enqueueOfficeJob({
      uid,
      skillKey,
      actionType,
      argument: (argument || "").toString().slice(0, 2000),
    });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/office/jobs", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const limit = Math.min(parseInt(req.query.limit) || 80, 200);
    const rows = await listOfficeJobsForUser(uid, { limit });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----- A · Worker info card -------------------------------------------------
router.get("/api/office/workers/:key/profile", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const key = String(req.params.key || "").slice(0, 80);
    if (!key) return res.status(400).json({ error: "key required" });
    const profile = await getOfficeSkillProfile(uid, key);
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----- F · Per-worker memories CRUD ----------------------------------------
router.post("/api/office/workers/:key/memories", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const key = String(req.params.key || "").slice(0, 80);
    const content = String(req.body?.content || "").trim();
    if (!key) return res.status(400).json({ error: "key required" });
    if (!content) return res.status(400).json({ error: "content required" });
    const row = await addOfficeWorkerMemory(uid, key, content);
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ----- E · Live preview + rating ------------------------------------------
router.get("/api/office/jobs/feedback", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const map = await listOfficeJobFeedback(uid);
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/office/jobs/:id/feedback", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid id" });
    const { kind, note } = req.body || {};
    const row = await recordOfficeJobFeedback(uid, id, { kind, note });
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/api/office/memories/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid id" });
    const removed = await deleteOfficeWorkerMemory(uid, id);
    if (!removed) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pure helper: decides whether a request opts into the per-request dry-run
// path. Exported for unit testing so the deny-by-default semantics are
// covered without spinning up the worker. Returns true only when the request
// asks for dry-run AND the operator has explicitly set
// LAST30DAYS_ALLOW_DRY_RUN_HEADER=1 on the server.
export function shouldHonorLast30DaysDryRunRequest(req) {
  const requested = req?.body?.dryRun === true
    || (typeof req?.get === "function" && req.get("x-last30days-dry-run") === "1");
  const allowed = process.env.LAST30DAYS_ALLOW_DRY_RUN_HEADER === "1";
  return Boolean(requested && allowed);
}

router.post("/api/last30days/runs", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const topic = String(req.body?.topic || "").trim();
    if (!topic) return res.status(400).json({ error: "topic is required" });
    if (topic.length > 280) return res.status(400).json({ error: "topic must be <= 280 chars" });
    const sources = normalizeSourcesInput(req.body?.sources);

    // Per-request dry-run opt-in: only honored when the operator has set
    // LAST30DAYS_ALLOW_DRY_RUN_HEADER=1 on the server. Lets e2e tests skip
    // the real Python engine without poisoning normal dev requests.
    const dryRun = shouldHonorLast30DaysDryRunRequest(req);

    const [row] = await db
      .insert(last30daysRuns)
      .values({
        uid,
        topic,
        sourcesJson: JSON.stringify(sources),
        status: "queued",
      })
      .returning();
    enqueueLast30DaysRun(row.id, { dryRun });
    res.json(publicLast30Row(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Weekly auto-refresh subscriptions ----
router.get("/api/last30days/subscriptions", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const rows = await db
      .select()
      .from(last30daysSubscriptions)
      .where(eq(last30daysSubscriptions.uid, uid))
      .orderBy(desc(last30daysSubscriptions.id));
    res.json(rows.map((r) => ({
      id: r.id,
      topic: r.topic,
      sources: JSON.parse(r.sourcesJson || "[]"),
      enabled: r.enabled,
      lastEnqueuedAt: r.lastEnqueuedAt,
      createdAt: r.createdAt,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upsert by topic: subscribing an existing topic re-enables it and refreshes
// its sources instead of creating a duplicate row.
router.post("/api/last30days/subscriptions", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const topic = String(req.body?.topic || "").trim();
    if (!topic) return res.status(400).json({ error: "topic is required" });
    if (topic.length > 280) return res.status(400).json({ error: "topic must be <= 280 chars" });
    const sources = normalizeSourcesInput(req.body?.sources);
    // Atomic upsert on the (uid, topic) unique index: re-subscribing an
    // existing topic re-enables it and refreshes its sources instead of
    // creating a duplicate row (safe under concurrent requests).
    const [row] = await db
      .insert(last30daysSubscriptions)
      .values({
        uid,
        topic,
        sourcesJson: JSON.stringify(sources),
        enabled: true,
        // Treat the run the user just did as this week's refresh; the first
        // auto run happens ~7 days from now.
        lastEnqueuedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [last30daysSubscriptions.uid, last30daysSubscriptions.topic],
        set: { enabled: true, sourcesJson: JSON.stringify(sources) },
      })
      .returning();
    res.json({ id: row.id, topic: row.topic, enabled: row.enabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/last30days/subscriptions/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid id" });
    const result = await db
      .delete(last30daysSubscriptions)
      .where(and(eq(last30daysSubscriptions.id, id), eq(last30daysSubscriptions.uid, uid)))
      .returning({ id: last30daysSubscriptions.id });
    if (!result.length) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/last30days/runs", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const rows = await db
      .select()
      .from(last30daysRuns)
      .where(eq(last30daysRuns.uid, uid))
      .orderBy(desc(last30daysRuns.id))
      .limit(limit);
    res.json(rows.map(publicLast30Row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/last30days/runs/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid id" });
    const [row] = await db
      .select()
      .from(last30daysRuns)
      .where(and(eq(last30daysRuns.id, id), eq(last30daysRuns.uid, uid)));
    if (!row) return res.status(404).json({ error: "not found" });
    const includeHtml = String(req.query.include || "").includes("html");
    const payload = publicLast30Row(row);
    if (includeHtml && row.status === "succeeded" && row.htmlPath) {
      try {
        const abs = path.resolve(__dirname, "..", row.htmlPath);
        const repoRoot = path.resolve(__dirname, "..");
        if (!abs.startsWith(repoRoot + path.sep)) throw new Error("path escape");
        const raw = await fs.promises.readFile(abs, "utf-8");
        payload.html = sanitizeBriefHtml(raw);
      } catch (e) {
        payload.htmlError = e.message;
      }
    }
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Raw HTML straight from disk (engine-rendered, NOT sanitized) - intended for
// "Download raw .html" so users get the exact file the engine produced. We do
// strict ownership + path-escape checks before serving.
router.get("/api/last30days/runs/:id/raw", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid id" });
    const [row] = await db
      .select()
      .from(last30daysRuns)
      .where(and(eq(last30daysRuns.id, id), eq(last30daysRuns.uid, uid)));
    if (!row) return res.status(404).json({ error: "not found" });
    if (row.status !== "succeeded" || !row.htmlPath) {
      return res.status(400).json({ error: "run did not succeed yet" });
    }
    const abs = path.resolve(__dirname, "..", row.htmlPath);
    const repoRoot = path.resolve(__dirname, "..");
    if (!abs.startsWith(repoRoot + path.sep)) {
      return res.status(500).json({ error: "invalid html path" });
    }
    const slug = String(row.topic || "brief")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brief";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="last30days-${slug}.html"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    fs.createReadStream(abs).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/last30days/runs/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid id" });
    const [row] = await db
      .select()
      .from(last30daysRuns)
      .where(and(eq(last30daysRuns.id, id), eq(last30daysRuns.uid, uid)));
    if (!row) return res.status(404).json({ error: "not found" });
    if (row.htmlPath) {
      const abs = path.resolve(__dirname, "..", row.htmlPath);
      const repoRoot = path.resolve(__dirname, "..");
      if (abs.startsWith(repoRoot + path.sep)) {
        await fs.promises.unlink(abs).catch(() => {});
      }
    }
    await db.delete(last30daysRuns).where(and(eq(last30daysRuns.id, id), eq(last30daysRuns.uid, uid)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/last30days/runs/:id/save-as-memo", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid id" });
    const [row] = await db
      .select()
      .from(last30daysRuns)
      .where(and(eq(last30daysRuns.id, id), eq(last30daysRuns.uid, uid)));
    if (!row) return res.status(404).json({ error: "not found" });
    if (row.status !== "succeeded" || !row.htmlPath) {
      return res.status(400).json({ error: "run did not succeed yet" });
    }
    const abs = path.resolve(__dirname, "..", row.htmlPath);
    const repoRoot = path.resolve(__dirname, "..");
    if (!abs.startsWith(repoRoot + path.sep)) {
      return res.status(500).json({ error: "invalid html path" });
    }
    const raw = await fs.promises.readFile(abs, "utf-8");
    const safeHtml = sanitizeBriefHtml(raw);
    const [memo] = await db.insert(memos).values({
      uid,
      title: (row.topic || "Untitled brief").slice(0, 200),
      content: safeHtml,
      color: "white",
      noteType: "last30days",
    }).returning();
    // Note: last30days auto-ingest is fired at brief-completion in
    // last30daysWorker.runJob, not here. Saving the brief as a memo no longer
    // re-triggers ingest to avoid duplicate runs.
    res.json({ memoId: memo.id, memo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/health/office", isAdmin, async (req, res) => {
  try {
    const raw = getOfficeStats();
    const sanitize = (msg) => {
      if (!msg) return null;
      return String(msg)
        .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "<uid>")
        .replace(/uid[=:]\s*\S+/gi, "uid=<redacted>")
        .slice(0, 500);
    };
    const hours = Math.min(Math.max(1, parseInt(req.query.hours, 10) || 24), 24 * 30);
    let breakdown = [];
    try {
      const rows = await getOfficeSkillBreakdown({ hours });
      breakdown = rows.map((r) => ({
        ...r,
        lastErrorMessage: sanitize(r.lastErrorMessage),
      }));
    } catch (e) {
      console.error("[health/office] breakdown failed:", e.message);
    }
    const confidenceDays = Math.min(Math.max(1, parseInt(req.query.confidenceDays, 10) || 7), 90);
    let confidenceBreakdown = [];
    try {
      confidenceBreakdown = await getOfficeConfidenceBreakdown({ days: confidenceDays });
    } catch (e) {
      console.error("[health/office] confidence breakdown failed:", e.message);
    }
    res.json({
      ...raw,
      lastErrorMessage: sanitize(raw.lastErrorMessage),
      breakdown,
      breakdownWindowHours: hours,
      confidenceBreakdown,
      confidenceWindowDays: confidenceDays,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/health/last30days", isAdmin, async (req, res) => {
  try {
    res.json(getLast30DaysSchedulerStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/health/recurrence", isAdmin, async (req, res) => {
  try {
    const stats = getRecurrenceSchedulerStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/health/daily-summary", isAdmin, async (req, res) => {
  try {
    const stats = getDailySummarySchedulerStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/health/daily-weather", isAdmin, async (req, res) => {
  try {
    const stats = getDailyWeatherSchedulerStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/health/wiki-agent", isAdmin, async (req, res) => {
  try {
    const sanitize = (msg) => {
      if (!msg) return null;
      return String(msg)
        .replace(/uid[=:]\s*\S+/gi, "uid=<redacted>")
        .slice(0, 500);
    };
    const auto = getAutoIngestStats();
    const lint = getWeeklyLintSchedulerStats();
    const days = Math.min(Math.max(1, parseInt(req.query.days, 10) || 7), 30);
    let runsBySourceTrigger = [];
    try {
      const r = await db.execute(sql`
        SELECT COALESCE(source, 'manual') AS source,
               COALESCE(trigger, 'manual') AS trigger,
               status, COUNT(*)::int AS n,
               COALESCE(AVG(duration_ms), 0)::int AS avg_ms,
               COALESCE(AVG(tool_call_count), 0)::float AS avg_tool_calls
        FROM agent_runs
        WHERE created_at > now() - (${days}::int || ' days')::interval
        GROUP BY COALESCE(source, 'manual'), COALESCE(trigger, 'manual'), status
        ORDER BY source, trigger, status
      `);
      runsBySourceTrigger = (r.rows || r).map((row) => ({
        source: row.source,
        trigger: row.trigger,
        status: row.status,
        count: Number(row.n) || 0,
        avgDurationMs: Number(row.avg_ms) || 0,
        avgToolCalls: Number(row.avg_tool_calls) || 0,
      }));
    } catch (e) {
      console.error("[health/wiki-agent] runs breakdown failed:", e.message);
    }
    // Spec'd shape: per-trigger metrics (attempted users, succeeded, failed,
    // last-run timestamp, last error message). We materialize this from the
    // in-memory auto-ingest stats and the (lighter) weekly-lint stats so an
    // operator can answer "did the rss-digest auto-fire today?" in one call.
    const triggerMetrics = [
      ...auto.perTrigger.map((t) => ({
        trigger: t.trigger,
        source: "auto",
        attemptedUsers: t.attemptedUsers,
        succeeded: t.succeeded,
        failed: t.failed,
        lastRunAt: t.lastRunAt,
        lastError: t.failed > 0 ? sanitize(auto.lastError) : null,
      })),
      {
        trigger: "scheduler",
        source: "auto",
        attemptedUsers: lint.buckets ? lint.buckets.reduce((n, b) => n + (b.userCount || 0), 0) : 0,
        succeeded: lint.fired || 0,
        failed: lint.failed || 0,
        lastRunAt: lint.lastFiredAt || null,
        lastError: sanitize(lint.lastTickError),
      },
    ];
    res.json({
      autoIngest: { ...auto, lastError: sanitize(auto.lastError) },
      weeklyLint: { ...lint, lastTickError: sanitize(lint.lastTickError) },
      triggerMetrics,
      runsBySourceTrigger,
      runsWindowDays: days,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/health/overview", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const userTz = await getUserTimezone(uid);
    const todayLocal = getNowInTz(userTz);
    const thirtyDaysAgoDate = new Date(todayLocal);
    thirtyDaysAgoDate.setDate(thirtyDaysAgoDate.getDate() - 30);
    const thirtyDaysAgo = `${thirtyDaysAgoDate.getFullYear()}-${String(thirtyDaysAgoDate.getMonth() + 1).padStart(2, "0")}-${String(thirtyDaysAgoDate.getDate()).padStart(2, "0")}`;
    const todayStr = todayPaddedInTz(userTz);

    const [recentSteps, recentBP, recentMeds, recentSleep, recentSymptoms] = await Promise.all([
      db.select().from(steps)
        .where(and(eq(steps.uid, uid), sql`${steps.date} >= ${thirtyDaysAgo}`))
        .orderBy(desc(steps.date)),
      db.select().from(bloodPressure)
        .where(and(eq(bloodPressure.uid, uid), sql`${bloodPressure.date} >= ${thirtyDaysAgo}`))
        .orderBy(desc(bloodPressure.date)),
      db.select().from(medicineLog)
        .where(and(eq(medicineLog.uid, uid), sql`${medicineLog.date} >= ${thirtyDaysAgo}`))
        .orderBy(desc(medicineLog.date)),
      db.select().from(sleepLog)
        .where(and(eq(sleepLog.uid, uid), sql`${sleepLog.date} >= ${thirtyDaysAgo}`))
        .orderBy(desc(sleepLog.date)),
      db.select().from(sleepSymptomLog)
        .where(and(eq(sleepSymptomLog.uid, uid), sql`${sleepSymptomLog.date} >= ${thirtyDaysAgo}`))
        .orderBy(desc(sleepSymptomLog.date)),
    ]);

    res.json({
      steps: recentSteps,
      bp: recentBP,
      medicine: recentMeds,
      sleep: recentSleep,
      sleepSymptoms: recentSymptoms,
      period: { from: thirtyDaysAgo, to: todayStr },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/health/ai-summary", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const userTz = await getUserTimezone(uid);
    const todayLocal = getNowInTz(userTz);
    const thirtyDaysAgoDate = new Date(todayLocal);
    thirtyDaysAgoDate.setDate(thirtyDaysAgoDate.getDate() - 30);
    const thirtyDaysAgo = `${thirtyDaysAgoDate.getFullYear()}-${String(thirtyDaysAgoDate.getMonth() + 1).padStart(2, "0")}-${String(thirtyDaysAgoDate.getDate()).padStart(2, "0")}`;

    const [recentSteps, recentBP, recentMeds, recentSleep, recentSymptoms, recentFood] = await Promise.all([
      db.select().from(steps)
        .where(and(eq(steps.uid, uid), sql`${steps.date} >= ${thirtyDaysAgo}`))
        .orderBy(desc(steps.date)),
      db.select().from(bloodPressure)
        .where(and(eq(bloodPressure.uid, uid), sql`${bloodPressure.date} >= ${thirtyDaysAgo}`))
        .orderBy(desc(bloodPressure.date)),
      db.select().from(medicineLog)
        .where(and(eq(medicineLog.uid, uid), sql`${medicineLog.date} >= ${thirtyDaysAgo}`))
        .orderBy(desc(medicineLog.date)),
      db.select().from(sleepLog)
        .where(and(eq(sleepLog.uid, uid), sql`${sleepLog.date} >= ${thirtyDaysAgo}`))
        .orderBy(desc(sleepLog.date)),
      db.select().from(sleepSymptomLog)
        .where(and(eq(sleepSymptomLog.uid, uid), sql`${sleepSymptomLog.date} >= ${thirtyDaysAgo}`))
        .orderBy(desc(sleepSymptomLog.date)),
      db.select().from(foodLog)
        .where(and(eq(foodLog.uid, uid), sql`${foodLog.date} >= ${thirtyDaysAgo}`))
        .orderBy(desc(foodLog.date)),
    ]);

    const stepsSum = recentSteps.length > 0
      ? `${recentSteps.length} days tracked. Avg: ${Math.round(recentSteps.reduce((s,r)=>s+r.steps,0)/recentSteps.length)} steps/day. Best: ${Math.max(...recentSteps.map(r=>r.steps))}. Total distance: ${recentSteps.reduce((s,r)=>s+parseFloat(r.distance||0),0).toFixed(1)}km.`
      : "No steps data.";

    const bpSum = recentBP.length > 0
      ? `${recentBP.length} readings. Avg SYS/DIA/Pulse: ${Math.round(recentBP.reduce((s,r)=>s+r.sys,0)/recentBP.length)}/${Math.round(recentBP.reduce((s,r)=>s+r.dia,0)/recentBP.length)}/${Math.round(recentBP.reduce((s,r)=>s+r.pulse,0)/recentBP.length)}. Latest: ${recentBP[0].sys}/${recentBP[0].dia} pulse ${recentBP[0].pulse} on ${recentBP[0].date}.`
      : "No blood pressure data.";

    const medSum = recentMeds.length > 0
      ? `${recentMeds.length} logs. Symptoms: ${[...new Set(recentMeds.map(r=>r.symptom))].join(', ')}. Medicines used: ${[...new Set(recentMeds.filter(r=>r.medicine).map(r=>r.medicine))].join(', ') || 'none recorded'}. Avg severity: ${(recentMeds.reduce((s,r)=>s+(r.severity||3),0)/recentMeds.length).toFixed(1)}/5.`
      : "No medicine/symptom data.";

    const sleepSum = formatSleepSummaryForPrompt(recentSleep);
    const symptomSum = formatSleepSymptomSummaryForPrompt(recentSymptoms);

    const foodSum = recentFood.length > 0
      ? (() => {
          const byDate = new Map();
          let alcoholDays = 0;
          let lateDinnerDays = 0;
          for (const f of recentFood) {
            byDate.set(f.date, (byDate.get(f.date) || 0) + (f.totalCalories || 0));
            const items = (() => { try { return JSON.parse(f.items || "[]"); } catch { return []; } })();
            const text = JSON.stringify(items).toLowerCase();
            if (/(beer|wine|whisky|whiskey|vodka|sake|cocktail|啤酒|紅酒|白酒|清酒|烈酒|威士忌|酒精|alcohol)/.test(text)) alcoholDays++;
            if (f.mealType === "dinner" && f.time && f.time >= "21:00") lateDinnerDays++;
          }
          return `${recentFood.length} food log entries across ${byDate.size} days. Alcohol-tagged entries: ${alcoholDays}. Late dinners (>=21:00): ${lateDinnerDays}.`;
        })()
      : "No food log data.";

    const userQ = req.body.question || "";

    const systemPrompt = `You are Muse, a personal health assistant. Analyze the user's health data (steps, BP, medicine, food, SLEEP/SNORE) from the past 30 days and look explicitly for cross-module patterns relevant to obstructive sleep apnea (OSA), such as:
- alcohol days vs snore duration / SpO2 min
- late dinner vs effective intervention rate
- weight or steps trend vs snore duration
- snore-heavy nights vs next-day BP, steps, or symptom severity
Use both English and Traditional Chinese (繁體中文) naturally mixed. Structure your response with clear sections. Be encouraging but honest. If asked a specific question, focus on answering it. Keep response concise (under 350 words).`;

    const dataPrompt = `Here is my health data for the past 30 days (${thirtyDaysAgo} to today):

**Steps & Activity:** ${stepsSum}
**Blood Pressure:** ${bpSum}  
**Medicine & Symptoms:** ${medSum}
**Sleep & Snore:** ${sleepSum}
**Sleep Symptom Diary:** ${symptomSum}
**Food / Diet:** ${foodSum}

${userQ ? `My question: ${userQ}` : 'Please give me a health overview summary with key insights and suggestions, including sleep apnea correlations if data supports them.'}`;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: dataPrompt },
      ],
      stream: true,
      max_tokens: 800,
    });

    for await (const chunk of stream) {
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }
    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

router.get("/api/medicine", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const month = req.query.month;
    let rows;
    if (month) {
      rows = await db.select().from(medicineLog)
        .where(and(eq(medicineLog.uid, uid), sql`${medicineLog.date} LIKE ${month + '%'}`))
        .orderBy(desc(medicineLog.date), desc(medicineLog.time));
    } else {
      rows = await db.select().from(medicineLog)
        .where(eq(medicineLog.uid, uid))
        .orderBy(desc(medicineLog.date), desc(medicineLog.time));
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/medicine", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { date, time, symptom, medicine, dosage, severity, notes } = req.body;
    if (!date || !symptom) {
      return res.status(400).json({ error: "date and symptom are required" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    }
    const sev = severity != null ? Math.min(5, Math.max(1, parseInt(severity) || 3)) : 3;
    const [row] = await db.insert(medicineLog).values({
      uid, date, time: time || null,
      symptom, medicine: medicine || null,
      dosage: dosage || null, severity: sev,
      notes: notes || null,
    }).returning();
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/medicine/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const { date, time, symptom, medicine, dosage, severity, notes } = req.body;
    const updates = {};
    if (date !== undefined) updates.date = date;
    if (time !== undefined) updates.time = time || null;
    if (symptom !== undefined) updates.symptom = symptom;
    if (medicine !== undefined) updates.medicine = medicine || null;
    if (dosage !== undefined) updates.dosage = dosage || null;
    if (severity !== undefined) updates.severity = Math.min(5, Math.max(1, parseInt(severity) || 3));
    if (notes !== undefined) updates.notes = notes || null;
    const [updated] = await db.update(medicineLog)
      .set(updates)
      .where(and(eq(medicineLog.id, id), eq(medicineLog.uid, uid)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/medicine/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const [deleted] = await db.delete(medicineLog)
      .where(and(eq(medicineLog.id, id), eq(medicineLog.uid, uid)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const SLEEP_INT_FIELDS = [
  "totalSleepMin", "deepSleepMin", "remSleepMin", "wakeCount",
  "snoreMin", "effectiveInterventionPct", "snoreIntensityDropDb",
  "offPillowCount", "interventionMin", "spo2Min", "spo2Avg", "hrAvg",
];
const SLEEP_TEXT_FIELDS = ["bedTime", "wakeTime", "source", "notes"];

function buildSleepValues(body) {
  const values = {};
  for (const f of SLEEP_INT_FIELDS) {
    if (body[f] !== undefined) {
      const v = body[f];
      if (v === null || v === "") { values[f] = null; continue; }
      const n = parseInt(v);
      if (Number.isFinite(n)) values[f] = n;
    }
  }
  for (const f of SLEEP_TEXT_FIELDS) {
    if (body[f] !== undefined) values[f] = body[f] || null;
  }
  return values;
}

router.get("/api/sleep", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { from, to } = req.query;
    const conds = [eq(sleepLog.uid, uid)];
    if (from) conds.push(sql`${sleepLog.date} >= ${from}`);
    if (to) conds.push(sql`${sleepLog.date} <= ${to}`);
    const rows = await db.select().from(sleepLog)
      .where(and(...conds))
      .orderBy(desc(sleepLog.date));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/sleep", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { date } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "date (YYYY-MM-DD) is required" });
    }
    const values = { uid, date, ...buildSleepValues(req.body) };
    if (!values.source) values.source = "manual";
    const [row] = await db.insert(sleepLog).values(values).returning();
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/sleep/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const updates = buildSleepValues(req.body);
    if (req.body.date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.date)) {
        return res.status(400).json({ error: "date must be YYYY-MM-DD" });
      }
      updates.date = req.body.date;
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "no fields to update" });
    const [updated] = await db.update(sleepLog).set(updates)
      .where(and(eq(sleepLog.id, id), eq(sleepLog.uid, uid)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/sleep/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const [deleted] = await db.delete(sleepLog)
      .where(and(eq(sleepLog.id, id), eq(sleepLog.uid, uid)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/sleep/symptoms", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { from, to } = req.query;
    const conds = [eq(sleepSymptomLog.uid, uid)];
    if (from) conds.push(sql`${sleepSymptomLog.date} >= ${from}`);
    if (to) conds.push(sql`${sleepSymptomLog.date} <= ${to}`);
    const rows = await db.select().from(sleepSymptomLog)
      .where(and(...conds))
      .orderBy(desc(sleepSymptomLog.date));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const SYMPTOM_INT_FIELDS = ["morningHeadache", "daytimeFatigue", "concentration", "nightWakeCount"];

function buildSymptomValues(body) {
  const values = {};
  for (const f of SYMPTOM_INT_FIELDS) {
    if (body[f] !== undefined) {
      const v = body[f];
      if (v === null || v === "") { values[f] = null; continue; }
      const n = parseInt(v);
      if (Number.isFinite(n)) {
        values[f] = Math.min(5, Math.max(1, n));
      }
    }
  }
  if (body.notes !== undefined) values.notes = body.notes || null;
  return values;
}

router.post("/api/sleep/symptoms", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { date } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "date (YYYY-MM-DD) is required" });
    }
    const values = { uid, date, ...buildSymptomValues(req.body) };
    const [row] = await db.insert(sleepSymptomLog).values(values).returning();
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/sleep/symptoms/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const updates = buildSymptomValues(req.body);
    if (req.body.date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.date)) {
        return res.status(400).json({ error: "date must be YYYY-MM-DD" });
      }
      updates.date = req.body.date;
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "no fields to update" });
    const [updated] = await db.update(sleepSymptomLog).set(updates)
      .where(and(eq(sleepSymptomLog.id, id), eq(sleepSymptomLog.uid, uid)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/sleep/symptoms/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const [deleted] = await db.delete(sleepSymptomLog)
      .where(and(eq(sleepSymptomLog.id, id), eq(sleepSymptomLog.uid, uid)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/sleep/import-image", isAuthenticated, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "image is required" });
    const uid = getUserId(req);
    const base64 = req.file.buffer.toString("base64");
    const mime = req.file.mimetype;
    const userTz = await getUserTimezone(uid);
    const todayStr = todayPaddedInTz(userTz);

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You extract sleep & snore data from screenshots. Today is ${todayStr}.

Auto-detect which app the screenshot is from:
- "添眠" (Tianmian / Tian Mian / 添眠 anti-snore pillow) — Chinese UI, shows fields like 有效干預率%, 打鼾時長, 干預時長, 鼾聲強度平均降低, 離枕記錄, 干預記錄, 鼾聲&記錄, 報告, 日報.
- "samsung" — Samsung Health sleep detail. Shows total sleep, deep sleep, REM, awake, sleep score, optionally SpO2, heart rate.
- If neither pattern matches, set source to "unknown" and return {"error":"unrecognized","app":"unknown"}.

Return ONLY valid JSON. Two shapes:
- On success:
{
  "source": "添眠" | "samsung",
  "date": "YYYY-MM-DD",
  "bedTime": "HH:MM" or null,
  "wakeTime": "HH:MM" or null,
  "totalSleepMin": integer or null,
  "deepSleepMin": integer or null,
  "remSleepMin": integer or null,
  "wakeCount": integer or null,
  "snoreMin": integer or null,
  "effectiveInterventionPct": integer 0-100 or null,
  "snoreIntensityDropDb": integer or null,
  "offPillowCount": integer or null,
  "interventionMin": integer or null,
  "spo2Min": integer or null,
  "spo2Avg": integer or null,
  "hrAvg": integer or null
}
- On failure: {"error":"unrecognized"}

RULES:
- Convert "1h 1min" → 61 minutes; "0h 49min" → 49 minutes.
- "有效干預率 84%" → effectiveInterventionPct 84.
- "鼾聲強度平均降低 14" → snoreIntensityDropDb 14.
- "打鼾時長" → snoreMin. "干預時長" → interventionMin. "離枕記錄 N次" → offPillowCount N (0 if absent).
- "日報 5月3日 星期日" without year → use current year ${todayStr.slice(0,4)}.
- Date must be YYYY-MM-DD with zero-padding. If no date visible, use ${todayStr}.
- For 添眠 daily report you usually CANNOT see total/deep/rem sleep — leave them null.
- For Samsung Health you usually CANNOT see snore data — leave snore* / interventionPct / offPillow* / intervention* null.
- Never invent numbers. Use null when not visible.`
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract sleep data from this screenshot." },
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}`, detail: "high" } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 800,
    });

    const aiText = response.choices[0]?.message?.content?.trim() || "";
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(422).json({ error: "Could not parse sleep data from image" });
    }
    let parsed;
    try { parsed = JSON.parse(jsonMatch[0]); } catch { return res.status(422).json({ error: "Invalid JSON from vision model" }); }
    if (parsed.error) {
      return res.status(422).json({ error: "Unrecognized screenshot. Only 添眠 daily report and Samsung Health sleep detail are supported." });
    }
    if (!parsed.date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
      parsed.date = todayStr;
    }
    res.json({ parsed });
  } catch (err) {
    console.error("Sleep image import error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/food", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const month = req.query.month;
    const limit = parseInt(req.query.limit) || 100;
    let rows;
    if (month) {
      rows = await db.select().from(foodLog)
        .where(and(eq(foodLog.uid, uid), sql`${foodLog.date} LIKE ${month + '%'}`))
        .orderBy(desc(foodLog.date), desc(foodLog.time))
        .limit(limit);
    } else {
      rows = await db.select().from(foodLog)
        .where(eq(foodLog.uid, uid))
        .orderBy(desc(foodLog.date), desc(foodLog.time))
        .limit(limit);
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/nutrition/usage", isAuthenticated, async (req, res) => {
  try {
    const { getUsage } = await import("./nutrition.js");
    res.json(getUsage());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/nutrition/lookup", isAuthenticated, async (req, res) => {
  try {
    const name = String(req.query.name || "").trim();
    if (!name) return res.status(400).json({ error: "Missing name" });
    const { lookupByName } = await import("./nutrition.js");

    const hit = await lookupByName(name);
    if (hit && hit.calories > 0) {
      return res.json({
        source: hit.source,
        name: hit.name,
        matchedName: hit.name,
        calories: Math.round(hit.calories),
        servingDescription: hit.servingDescription || null,
        protein: hit.protein ?? null,
        carbs: hit.carbs ?? null,
        fat: hit.fat ?? null,
        sodium: hit.sodium ?? null,
        cached: !!hit.cached,
      });
    }

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You estimate nutrition for a single food item. Respond with strict JSON only: " +
              '{"name": string, "servingDescription": string, "calories": number, "protein": number, "carbs": number, "fat": number, "sodium": number}. ' +
              "Calories are kcal. Protein/carbs/fat are grams. Sodium is milligrams. " +
              "Use a sensible default serving size (one typical portion as commonly eaten). " +
              "If the input is not a recognizable food, return calories: 0.",
          },
          { role: "user", content: `Food: ${name}` },
        ],
      });
      const raw = completion.choices?.[0]?.message?.content || "{}";
      const parsed = JSON.parse(raw);
      const calories = Math.round(Number(parsed.calories) || 0);
      if (calories <= 0) return res.status(404).json({ error: "Not found" });
      return res.json({
        source: "ai",
        name: parsed.name || name,
        matchedName: parsed.name || name,
        calories,
        servingDescription: parsed.servingDescription || null,
        protein: Number.isFinite(Number(parsed.protein)) ? Number(parsed.protein) : null,
        carbs: Number.isFinite(Number(parsed.carbs)) ? Number(parsed.carbs) : null,
        fat: Number.isFinite(Number(parsed.fat)) ? Number(parsed.fat) : null,
        sodium: Number.isFinite(Number(parsed.sodium)) ? Number(parsed.sodium) : null,
        cached: false,
      });
    } catch (e) {
      console.error("[nutrition/lookup] AI fallback error:", e.message);
      return res.status(404).json({ error: "Not found" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/food/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const [existing] = await db.select().from(foodLog)
      .where(and(eq(foodLog.id, id), eq(foodLog.uid, uid)));
    if (!existing) return res.status(404).json({ error: "Not found" });

    const updates = {};

    if (req.body.totalCalories !== undefined) {
      const tc = Number(req.body.totalCalories);
      if (!Number.isFinite(tc) || tc < 0) return res.status(400).json({ error: "Invalid totalCalories" });
      updates.totalCalories = Math.round(tc);
    }

    if (req.body.mealType !== undefined) {
      const allowed = ["breakfast", "lunch", "dinner", "snack", "unknown"];
      const mt = String(req.body.mealType);
      if (!allowed.includes(mt)) return res.status(400).json({ error: "Invalid mealType" });
      updates.mealType = mt;
    }

    if (req.body.date !== undefined) {
      const d = String(req.body.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: "Invalid date" });
      updates.date = d;
    }

    if (req.body.time !== undefined) {
      const t = req.body.time;
      if (t === null || t === "") {
        updates.time = null;
      } else {
        const ts = String(t);
        if (!/^\d{2}:\d{2}(:\d{2})?$/.test(ts)) return res.status(400).json({ error: "Invalid time" });
        updates.time = ts;
      }
    }

    if (req.body.items !== undefined) {
      let nextItems = req.body.items;
      if (typeof nextItems === "string") {
        try { nextItems = JSON.parse(nextItems); } catch { return res.status(400).json({ error: "Invalid items JSON" }); }
      }
      if (!Array.isArray(nextItems)) return res.status(400).json({ error: "items must be an array" });

      let prevItems = [];
      try { prevItems = JSON.parse(existing.items || "[]"); } catch {}

      const merged = nextItems.map((it, i) => {
        const cal = Number(it?.calories);
        if (!Number.isFinite(cal) || cal < 0) {
          throw Object.assign(new Error("Invalid item calories"), { status: 400 });
        }
        const base = prevItems[i] && typeof prevItems[i] === "object" ? prevItems[i] : {};
        return { ...base, ...it, calories: Math.round(cal) };
      });
      updates.items = JSON.stringify(merged);

      if (updates.totalCalories === undefined) {
        updates.totalCalories = merged.reduce((s, it) => s + (Number(it.calories) || 0), 0);
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No updatable fields" });
    }

    const [updated] = await db.update(foodLog)
      .set(updates)
      .where(and(eq(foodLog.id, id), eq(foodLog.uid, uid)))
      .returning();

    try {
      await sendPushToUser(uid, {
        title: "🍽️ 食物記錄已更新",
        body: `${updated.totalCalories || 0} kcal`,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { type: "food-updated", foodId: updated.id, date: updated.date },
      });
    } catch (e) {
      console.error("Failed to send food-updated push:", e.message);
    }

    res.json(updated);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete("/api/food/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const [deleted] = await db.delete(foodLog)
      .where(and(eq(foodLog.id, id), eq(foodLog.uid, uid)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/dashboard/today", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const now = new Date();
    const userTz = await getUserTimezone(uid);
    const todayStr = todayPaddedInTz(userTz);
    const since = new Date(now.getTime() - 24 * 3600 * 1000);

    const [todayTasks, recentEmails, recentMemos, recentExpenses, recentFood, todayFood, currentUserRow, recentBp, recentSteps, recentMedicine, feeds] = await Promise.all([
      db.select().from(tasks)
        .where(and(eq(tasks.uid, uid), eq(tasks.date, todayStr)))
        .orderBy(asc(tasks.order)),
      db.select().from(emailInbox)
        .where(and(eq(emailInbox.uid, uid), eq(emailInbox.processed, false)))
        .orderBy(desc(emailInbox.createdAt))
        .limit(20),
      db.select().from(memos)
        .where(and(eq(memos.uid, uid), gt(memos.createdAt, since)))
        .orderBy(desc(memos.createdAt))
        .limit(20),
      db.select().from(expenses)
        .where(and(eq(expenses.uid, uid), gt(expenses.createdAt, since)))
        .orderBy(desc(expenses.createdAt))
        .limit(10),
      db.select().from(foodLog)
        .where(and(eq(foodLog.uid, uid), gt(foodLog.createdAt, since)))
        .orderBy(desc(foodLog.createdAt))
        .limit(10),
      db.select().from(foodLog)
        .where(and(eq(foodLog.uid, uid), eq(foodLog.date, todayStr))),
      db.select().from(users).where(eq(users.id, uid)),
      db.select().from(bloodPressure)
        .where(and(eq(bloodPressure.uid, uid), gt(bloodPressure.createdAt, since)))
        .orderBy(desc(bloodPressure.createdAt))
        .limit(5),
      db.select().from(steps)
        .where(and(eq(steps.uid, uid), gt(steps.createdAt, since)))
        .orderBy(desc(steps.createdAt))
        .limit(5),
      db.select().from(medicineLog)
        .where(and(eq(medicineLog.uid, uid), gt(medicineLog.createdAt, since)))
        .orderBy(desc(medicineLog.createdAt))
        .limit(5),
      db.select().from(rssFeeds).where(eq(rssFeeds.uid, uid)),
    ]);

    let videoSummaries = [];
    try {
      const recentVideoMemos = await db.select({
        id: memos.id,
        title: memos.title,
        content: memos.content,
        createdAt: memos.createdAt,
      })
        .from(memos)
        .where(and(
          eq(memos.uid, uid),
          eq(memos.noteType, "video-note"),
          gt(memos.createdAt, since),
        ))
        .orderBy(desc(memos.createdAt))
        .limit(50);
      if (recentVideoMemos.length > 0) {
        const ids = recentVideoMemos.map(m => m.id);
        const tagRows = await db.select().from(memoTags).where(inArray(memoTags.memoId, ids));
        const tagsByMemo = new Map();
        for (const t of tagRows) {
          if (!tagsByMemo.has(t.memoId)) tagsByMemo.set(t.memoId, []);
          tagsByMemo.get(t.memoId).push(t.tag);
        }
        videoSummaries = recentVideoMemos
          .filter(m => (tagsByMemo.get(m.id) || []).includes("auto-import"))
          .map(m => ({
            id: m.id,
            title: m.title,
            createdAt: m.createdAt,
            tldr: extractTldrFromMemoBody(m.content),
          }));
      }
    } catch (e) {
      console.warn("dashboard videoSummaries failed:", e.message);
    }

    let rssItems = [];
    const feedFetches = feeds.slice(0, 10).map(async (feed) => {
      try {
        const r = await fetch(feed.url, {
          headers: { "User-Agent": "Analogue-RSS/1.0", "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml" },
          signal: AbortSignal.timeout(6000),
          redirect: "follow",
        });
        if (!r.ok) return [];
        const text = await r.text();
        const parsed = parseRssFeed(text);
        return parsed.items.map(it => ({
          ...it,
          feedTitle: feed.title || parsed.title || feed.url,
          feedId: feed.id,
        }));
      } catch { return []; }
    });
    const fetched = await Promise.all(feedFetches);
    const cutoff = since.getTime();
    rssItems = fetched.flat()
      .filter(it => {
        if (!it.pubDate) return false;
        const t = new Date(it.pubDate).getTime();
        return !isNaN(t) && t >= cutoff;
      })
      .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
      .slice(0, 30);

    const macroTotals = { protein: 0, carbs: 0, fat: 0, sodium: 0 };
    let macroAny = false;
    for (const r of todayFood) {
      let items = [];
      try { items = JSON.parse(r.items || "[]"); } catch {}
      for (const it of items) {
        for (const k of ["protein", "carbs", "fat", "sodium"]) {
          const v = it?.[k];
          const n = typeof v === "string" ? parseFloat(v) : v;
          if (Number.isFinite(n)) { macroTotals[k] += n; macroAny = true; }
        }
      }
    }
    const u = currentUserRow?.[0] || {};
    const macroGoals = {
      proteinGoal: u.proteinGoal ?? null,
      carbsGoal: u.carbsGoal ?? null,
      fatGoal: u.fatGoal ?? null,
      sodiumGoal: u.sodiumGoal ?? null,
      sodiumIsMax: u.sodiumIsMax ?? true,
    };

    res.json({
      date: todayStr,
      tasks: todayTasks,
      emails: recentEmails,
      memos: recentMemos,
      expenses: recentExpenses,
      food: recentFood,
      bloodPressure: recentBp,
      steps: recentSteps,
      medicine: recentMedicine,
      rss: rssItems,
      videoSummaries,
      macros: {
        totals: macroAny ? macroTotals : null,
        goals: macroGoals,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/webhooks", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const rows = await db.select().from(webhookTokens).where(eq(webhookTokens.uid, uid)).orderBy(desc(webhookTokens.createdAt));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/webhooks", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { name, defaultType } = req.body || {};
    const token = crypto.randomBytes(24).toString("base64url");
    const [row] = await db.insert(webhookTokens).values({
      uid,
      name: (name || "Webhook").slice(0, 60),
      token,
      defaultType: ["memo", "task"].includes(defaultType) ? defaultType : "memo",
    }).returning();
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/webhooks/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const [del] = await db.delete(webhookTokens)
      .where(and(eq(webhookTokens.id, id), eq(webhookTokens.uid, uid)))
      .returning();
    if (!del) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function processWebhookPayload(hook, payload) {
  const type = payload.type || hook.defaultType || "memo";
  const title = (payload.title || payload.subject || "").toString().slice(0, 500);
  const content = (payload.content || payload.body || payload.text || payload.message || "").toString();
  const tags = Array.isArray(payload.tags) ? payload.tags.slice(0, 10).map(t => String(t).toLowerCase()) : [];

  const todayStr = todayPaddedInTz(await getUserTimezone(hook.uid));

  if (type === "task") {
    const taskName = title || content.slice(0, 200) || "Webhook task";
    const [t] = await db.insert(tasks).values({
      uid: hook.uid,
      name: taskName,
      date: payload.date || todayStr,
      description: content || "",
    }).returning();
    return { type: "task", id: t.id };
  } else {
    const memoTitle = title || `🔔 Webhook (${hook.name || "in"})`;
    const [m] = await db.insert(memos).values({
      uid: hook.uid,
      title: memoTitle,
      content: content || JSON.stringify(payload).slice(0, 2000),
      color: payload.color || "white",
      noteType: "fleeting",
    }).returning();
    if (tags.length > 0) {
      try {
        await db.insert(memoTags).values(tags.map(tag => ({ memoId: m.id, tag })));
      } catch {}
    }
    return { type: "memo", id: m.id };
  }
}

router.all("/api/webhook/in/:token", async (req, res) => {
  try {
    const token = req.params.token;
    const [hook] = await db.select().from(webhookTokens).where(eq(webhookTokens.token, token)).limit(1);
    if (!hook) return res.status(404).json({ error: "Invalid webhook token" });

    let payload = {};
    if (req.method === "GET") {
      payload = { ...req.query };
    } else {
      payload = req.body && Object.keys(req.body).length > 0
        ? req.body
        : { ...req.query };
    }

    const result = await processWebhookPayload(hook, payload);

    await db.update(webhookTokens)
      .set({ callCount: (hook.callCount || 0) + 1, lastUsedAt: new Date() })
      .where(eq(webhookTokens.id, hook.id));

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("Webhook in error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/journal", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { date, days } = req.query;
    if (date) {
      const rows = await db.select().from(journalEntries)
        .where(and(eq(journalEntries.uid, uid), eq(journalEntries.date, date)))
        .orderBy(asc(journalEntries.createdAt));
      return res.json(rows);
    }
    if (days) {
      const n = Math.min(Math.max(parseInt(days) || 7, 1), 60);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - n);
      const rows = await db.select().from(journalEntries)
        .where(and(eq(journalEntries.uid, uid), gt(journalEntries.createdAt, cutoff)))
        .orderBy(asc(journalEntries.createdAt));
      return res.json(rows);
    }
    const today = todayInTz(await getUserTimezone(uid));
    const rows = await db.select().from(journalEntries)
      .where(and(eq(journalEntries.uid, uid), eq(journalEntries.date, today)))
      .orderBy(asc(journalEntries.createdAt));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/journal/dates", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const rows = await db.execute(sql`SELECT DISTINCT date FROM journal_entries WHERE uid = ${uid} ORDER BY date DESC LIMIT 90`);
    res.json((rows.rows || rows).map(r => r.date));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/journal", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { body, source, date } = req.body;
    const trimmed = (body || "").toString().trim();
    if (!trimmed) return res.status(400).json({ error: "body required" });
    const [entry] = await db.insert(journalEntries).values({
      uid,
      body: trimmed.slice(0, 2000),
      date: date || todayInTz(await getUserTimezone(uid)),
      source: source || "manual",
    }).returning();
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/journal/:id", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(journalEntries)
      .where(and(eq(journalEntries.id, id), eq(journalEntries.uid, uid)));
    if (!existing) return res.status(404).json({ error: "Not found" });
    await db.delete(journalEntries).where(eq(journalEntries.id, id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/journal/stuck", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { goal } = req.body;
    const trimmed = (goal || "").toString().trim();
    if (!trimmed) return res.status(400).json({ error: "goal required" });
    const today = todayInTz(await getUserTimezone(uid));
    const recent = await db.select().from(journalEntries)
      .where(and(eq(journalEntries.uid, uid), eq(journalEntries.date, today)))
      .orderBy(asc(journalEntries.createdAt));
    const recentCtx = recent.slice(-8).map(r => `- ${r.body}`).join("\n") || "(no entries today)";
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `You are an ADHD coach helping someone get unstuck. Given what they're trying to do and recent journal context, return 3-5 of the TINIEST possible next steps (each doable in 30s-2min). Each step must be a concrete physical or mental action, not an outcome. Reply ONLY with valid JSON: {"steps": ["step 1", "step 2", ...]}. Reply in the same language the user used.` },
        { role: "user", content: `Goal: ${trimmed}\n\nToday's journal so far:\n${recentCtx}` },
      ],
      temperature: 0.4,
      max_tokens: 300,
    });
    const text = response.choices[0]?.message?.content?.trim() || "";
    const match = text.match(/\{[\s\S]*\}/);
    let steps = [];
    if (match) {
      try { steps = JSON.parse(match[0]).steps || []; } catch (e) { /* */ }
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      return res.status(500).json({ error: "Could not generate steps" });
    }
    res.json({ steps: steps.slice(0, 5).map(s => String(s).trim()).filter(Boolean) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/reflection-summary", isAuthenticated, reflectionSummaryHandler);

router.post("/api/reflection-summary/feedback", isAuthenticated, async (req, res) => {
  try {
    const uid = getUserId(req);
    const { weekStart, promptId, entries, rating } = req.body || {};
    if (!weekStart || !promptId) {
      return res.status(400).json({ error: "weekStart and promptId required" });
    }
    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: "entries must be an array" });
    }
    if (rating !== "up" && rating !== "down") {
      return res.status(400).json({ error: "rating must be 'up' or 'down'" });
    }
    const result = await recordReflectionFeedback({ uid, weekStart, promptId, entries, rating });
    res.json(result);
  } catch (err) {
    console.error("reflection-summary feedback failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
