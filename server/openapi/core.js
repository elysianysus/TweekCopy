import { s, i, b, obj, arr, strings, nullable, row, input, operation as op, query, upload, media, range, ok, success } from "./schema.js";

const fileFields = "id filename originalName url mimeType createdAt";
const taskFile = row("taskFiles", `${fileFields} taskId`);
const memoFile = row("memoFiles", `${fileFields} memoId`);
const memo = obj({ ...row("memos").properties, tags: arr(s), files: arr(memoFile) });
const task = row("tasks");
const taskInput = input("tasks", "name color date done order description eisenhowerQuadrant reminder startTime endDate endTime repeatPattern repeatInterval repeatEndedAt", ["name", "date"], {
  horizonDays: { ...nullable(i), description: "Series materialization horizon; normalized/clamped by the recurrence scheduler." },
});
const scope = { ...s, default: "one", description: "one, series or future; other values behave as one." };
const memoInput = input("memos", "title content date color noteType isHandMaintained", [], { tags: arr(s) });
const geometry = { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } };
const placement = obj({ placementId: i, ...geometry });
const boardBrief = row("whiteboards", "id name parentId updatedAt");
const userFields = "id email name darkMode proteinGoal carbsGoal fatGoal sodiumGoal sodiumIsMax dailySummaryEnabled dailySummaryHour dailySummaryMinute dailyWeatherEnabled timezone timezoneAutoBackfillHandledAt tzExpandedGroupsUpdatedAt showConfidenceChips";
const profile = obj({ ...row("users", userFields).properties, hasPin: b, lineLinked: b, tzExpandedGroups: nullable(arr(s)) });
const authProfile = obj({ ...profile.properties, token: s });
const safeUserFields = Object.keys(row("users").properties).filter(k => !["password", "pin"].includes(k)).join(" ");
const userSettings = input("users", "name darkMode proteinGoal carbsGoal fatGoal sodiumGoal sodiumIsMax dailySummaryEnabled dailySummaryHour dailySummaryMinute dailyWeatherEnabled wikiAutoIngestRssDigest wikiAutoIngestVideoTranscript wikiAutoIngestLineLog wikiAutoIngestLast30days wikiLintEnabled wikiLintDow wikiLintHour wikiLintMinute timezone journalNudgeEnabled sleepReminderEnabled sleepReminderHour sleepReminderMinute sleepCleanReminderEnabled sleepCleanReminderDow sleepCleanReminderHour sleepCleanReminderMinute showConfidenceChips", [], {
  timezone: { ...s, minLength: 1, maxLength: 64, description: "An Intl-supported IANA timezone identifier." },
  tzExpandedGroups: { ...arr({ ...s, maxLength: 64 }), description: "Trimmed, deduplicated; at most 64 non-empty groups." },
  timezoneAutoBackfillHandled: b,
});
for (const key of ["dailySummaryHour", "wikiLintHour", "sleepReminderHour", "sleepCleanReminderHour"]) userSettings.properties[key] = range(0, 23);
for (const key of ["dailySummaryMinute", "wikiLintMinute", "sleepReminderMinute", "sleepCleanReminderMinute"]) userSettings.properties[key] = range(0, 59);
for (const key of ["wikiLintDow", "sleepCleanReminderDow"]) userSettings.properties[key] = range(0, 6);

export const core = {
  "POST /api/signup": { ...op(authProfile, obj({ email: { ...s, format: "email" }, password: { ...s, minLength: 6 }, name: s, timezone: s }, ["email", "password", "name"])), security: [] },
  "POST /api/login": { ...op(authProfile, obj({ email: s, password: { ...s, format: "password" } }, ["email", "password"])), security: [] },
  "POST /api/logout": { ...op(success), security: [] },
  "GET /api/auth/user": { ...op(obj({ ...profile.properties, journalNudgeEnabled: b })), security: [{ bearerAuth: [] }, { sessionCookie: [] }] },
  "POST /api/access-code": { ...op(ok, obj({ code: s }), [], "If no access code is configured, any request succeeds; otherwise code must match."), security: [] },
  "GET /api/user": op(obj({ ...row("users", safeUserFields).properties, hasPin: b, tzExpandedGroups: nullable(arr(s)) })),
  "PUT /api/user": op(obj({ ...row("users").properties, lineLinked: b, tzExpandedGroups: nullable(arr(s)) }), userSettings),
  "GET /api/user/last-weather-push": op(obj({ sentAt: nullable(s), dedupKey: nullable(s), dailyWeatherEnabled: b, timezone: s, targetHour: i, targetMinute: i, nextPushAt: nullable(s) })),
  "GET /api/tasks": op(arr(obj({ ...task.properties, subtasks: arr(row("subtasks")), files: arr(taskFile) }))),
  "POST /api/tasks": op(task, taskInput),
  "PUT /api/tasks/:id": op(task, obj({ ...taskInput.properties, applyTo: scope }), [query("applyTo", scope)], "Body applyTo takes precedence over query. A series end-date edit can delete the addressed occurrence and return an empty body."),
  "DELETE /api/tasks/:id": op(success, null, [query("scope", scope)]),
  "GET /api/tasks/:id/repeat-exceptions": op(arr(row("taskRepeatExceptions", "id date createdAt"))),
  "POST /api/tasks/:id/repeat-exceptions": op(success, obj({ date: s }, ["date"])),
  "DELETE /api/tasks/:id/repeat-exceptions/:date": op(success),
  "PUT /api/tasks/:id/repeat-anchor": op(obj({ success: b, repeatAnchorDate: s }), obj({ repeatAnchorDate: s }, ["repeatAnchorDate"])),
  "PUT /api/tasks/:id/toggle": op(task, obj({ scope }), [query("scope", scope)], "Query scope takes precedence over body scope."),
  "PUT /api/tasks/reorder": op(success, obj({ tasks: arr(obj({ id: i }, ["id"])) }, ["tasks"])),
  "DELETE /api/tasks": op(success),
  "GET /api/tasks/search": op(arr(task), null, [query("q", s)]),
  "GET /api/tasks/:id/subtasks": op(arr(row("subtasks"))),
  "POST /api/tasks/:id/subtasks": op(row("subtasks"), input("subtasks", "name order", ["name"])),
  "PUT /api/subtasks/:id": op(row("subtasks"), row("subtasks")),
  "DELETE /api/subtasks/:id": op(success),
  "GET /api/tasks/:id/files": op(arr(taskFile)),
  "POST /api/tasks/:id/files": { ...op(row("taskFiles", "id taskId filename originalName url mimeType")), requestBody: upload("file") },
  "DELETE /api/files/:id": op(success),
  "GET /api/month-focus/:yearMonth": op(row("monthFocus")),
  "PUT /api/month-focus/:yearMonth": op(row("monthFocus"), obj(strings("line1 line2 line3"))),
  "GET /api/cheers": op(arr(row("cheers"))),
  "POST /api/cheers": op(row("cheers"), input("cheers", "text color size x y")),
  "DELETE /api/cheers/:id": op(success),
  "GET /api/memos": op(arr(memo)),
  "POST /api/memos": op(memo, memoInput),
  "PUT /api/memos/:id": op(memo, obj({ ...memoInput.properties, pinned: b })),
  "DELETE /api/memos/:id": op(success),
  "POST /api/memos/:id/files": { ...op(row("memoFiles", "id memoId filename originalName url mimeType")), requestBody: upload("file") },
  "DELETE /api/memo-files/:id": op(success),
  "GET /api/memos/search": op(arr(memo), null, [query("q")]),
  "GET /api/memos/titles": op(arr(row("memos", "id title"))),
  "GET /api/memos/:id/backlinks": op(arr(row("memos", "id title color"))),
  "GET /api/memos/:id/links": op(arr(row("memos", "id title color"))),
  "GET /api/memos/by-date/:date": op(arr(obj({ ...row("memos").properties, tags: arr(row("memoTags")), files: arr(memoFile) }))),
  "GET /api/file-data/:filename": { responses: { 200: media("*/*", { ...s, format: "binary" }, "Stored bytes using the original MIME type, or application/octet-stream."), 404: media("text/html", s, "Not found"), 500: media("text/html", s, "Error") }, security: [] },
  "GET /api/whiteboard": op(obj({ data: s })),
  "PUT /api/whiteboard": op(ok, obj({ data: s })),
  "GET /api/whiteboards": op(arr(boardBrief)),
  "POST /api/whiteboards": op(boardBrief, obj({ name: s, parentId: nullable(i) })),
  "PUT /api/whiteboards/:id": op(ok, obj({ name: s, data: s, parentId: nullable(i) })),
  "DELETE /api/whiteboards/:id": op(ok),
  "GET /api/whiteboards/:id": op(row("whiteboards")),
  "GET /api/whiteboards/:id/memos": op(arr(obj({ ...placement.properties, sectionId: nullable(i), memo: obj({ ...row("memos").properties, tags: arr(s) }) }))),
  "POST /api/whiteboards/:id/memos": op(placement, obj({ memoId: i, x: geometry.x, y: geometry.y }, ["memoId"])),
  "PUT /api/whiteboard-memos/:id": op(ok, obj(geometry)),
  "DELETE /api/whiteboard-memos/:id": op(ok),
  "POST /api/whiteboards/:id/memos/bulk-move": op(obj({ ok: b, moved: i, removedDuplicates: i }), obj({ placementIds: arr(i), targetWhiteboardId: i }, ["placementIds", "targetWhiteboardId"])),
  "GET /api/whiteboards/:id/connections": op(arr(row("whiteboardConnections"))),
  "POST /api/whiteboards/:id/connections": op(row("whiteboardConnections"), input("whiteboardConnections", "fromMemoId toMemoId label style", ["fromMemoId", "toMemoId"])),
  "PUT /api/whiteboard-connections/:id": op(ok, obj(strings("label style"))),
  "DELETE /api/whiteboard-connections/:id": op(ok),
  "GET /api/whiteboards/:id/sections": op(arr(row("whiteboardSections"))),
  "POST /api/whiteboards/:id/sections": op(row("whiteboardSections"), obj({ title: s, color: s, ...geometry })),
  "PUT /api/whiteboard-sections/:id": op(ok, obj({ title: s, color: s, ...geometry, containedMemoIds: arr(i) })),
  "DELETE /api/whiteboard-sections/:id": op(ok),
  "GET /api/journal": op(arr(row("journalEntries")), null, [query("date"), query("days", { ...range(1, 60), default: 7 })]),
  "GET /api/journal/dates": op(arr(s)),
  "POST /api/journal": op(row("journalEntries"), obj(strings("body source date"), ["body"])),
  "DELETE /api/journal/:id": op(success),
  "POST /api/journal/stuck": op(obj({ steps: arr(s) }), obj({ goal: s }, ["goal"])),
};

export { memo };
