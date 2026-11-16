import { s, i, n, b, obj, arr, strings, nullable, row, input, operation as op, query, range, enumString, ok, success } from "./schema.js";
import { rss } from "./integrations.js";

const career = input("jobOpportunities", "company role location comp sourceUrl jdText score notes status", [], { evaluation: {} });
const stages = enumString("saved", "applied", "interviewing", "offer", "closed_won", "closed_lost");
const milestone = input("lifeMilestones", "title date endDate color icon notes", ["title", "date"]);
const graphType = enumString("task", "memo", "milestone");
const template = obj({ ...strings("key label desc"), steps: arr(obj(strings("skillKey actionType"))) });
const job = row("officeJobs");
const feedback = obj({ kind: enumString("positive", "negative", "correction"), note: s });
const snapshotBox = obj({ x: n, y: n, w: n, h: n, color: s });
const macro = obj({ protein: n, carbs: n, fat: n, sodium: n });
const schedulerBucket = obj({
  timezone: s, hour: i, minute: i, userCount: i,
  lastRunAt: nullable(s), lastRunUserCount: i, lastRunSentCount: i,
  errorCount: i, lastErrorMessage: nullable(s), lastErrorAt: nullable(s),
});
const scheduler = obj({
  targetHour: nullable(i), targetMinute: nullable(i), cacheLoadedAt: nullable(s),
  knownTimezones: arr(obj({ timezone: s, userCount: i })),
  tickErrorCount: i, lastTickErrorMessage: nullable(s), lastTickErrorAt: nullable(s),
  buckets: arr(schedulerBucket),
});
const workerStats = obj({
  startedAt: nullable(s), attempted: i, succeeded: i, failed: i,
  lastErrorMessage: nullable(s), lastErrorAt: nullable(s), inflight: i,
  capacity: obj({ global: i }),
});
const trigger = obj({ trigger: s, attemptedUsers: i, enqueued: i, succeeded: i, failed: i, skippedDuplicate: i, lastRunAt: nullable(s) });
const auto = obj({
  enqueued: i, skippedNoPref: i, skippedQueueFull: i, skippedDuplicate: i,
  succeeded: i, failed: i, byTrigger: { type: "object", additionalProperties: obj({ enqueued: i, succeeded: i, failed: i, skippedDuplicate: i }) },
  attemptedUsersByTrigger: { type: "object", additionalProperties: obj() },
  lastRunAtByTrigger: { type: "object", additionalProperties: s },
  lastError: nullable(s), lastErrorAt: nullable(s), lastFinishedAt: nullable(s),
  perTrigger: arr(trigger), queueDepthByUser: arr(obj({ uid: i, depth: i })), runningUserCount: i,
});
const lint = obj({
  ticks: i, lastTickAt: nullable(s), lastTickError: nullable(s), bucketCount: i,
  fired: i, failed: i, lastFiredAt: nullable(s), cacheLoadedAt: nullable(s),
  buckets: arr(obj({ timezone: s, dow: i, hour: i, minute: i, userCount: i })),
});
export const operations = {
  "GET /api/memos/whiteboards-map": op({ type: "object", additionalProperties: arr(s) }),
  "GET /api/memos/graph": op(obj({ nodes: arr(obj({ ...row("memos", "id title color noteType").properties, tags: arr(s) })), edges: arr(obj({ source: i, target: i })) })),
  "GET /api/whiteboards/overview": op(obj({
    boards: arr(obj({
      ...row("whiteboards", "id name parentId updatedAt createdAt").properties,
      memoCount: i, sectionCount: i, connectionCount: i,
      snapshot: obj({ memos: arr(snapshotBox), sections: arr(snapshotBox), connections: arr(obj({ x1: n, y1: n, x2: n, y2: n })) }),
    })),
    crossLinks: arr(obj({ fromBoardId: i, toBoardId: i })),
  })),
  "GET /api/career/jobs": op(arr(row("jobOpportunities")), null, [query("status")]),
  "GET /api/career/jobs/:id": op(obj({ ...row("jobOpportunities").properties, history: arr(row("jobStatusHistory")) })),
  "POST /api/career/jobs": op(row("jobOpportunities"), { ...career, anyOf: [{ required: ["company"] }, { required: ["role"] }] }),
  "PATCH /api/career/jobs/:id": op(row("jobOpportunities"), obj({ ...career.properties, status: stages, statusNote: s })),
  "DELETE /api/career/jobs/:id": op(success),
  "GET /api/milestones": op(arr(row("lifeMilestones"))),
  "POST /api/milestones": op(row("lifeMilestones"), milestone),
  "PUT /api/milestones/:id": op(row("lifeMilestones"), milestone),
  "DELETE /api/milestones/:id": op(success),
  "GET /api/life-activity": op(obj({
    activity: { type: "object", additionalProperties: obj({ memos: i, tasks: i }) },
    memoTimeline: arr(obj({ id: i, title: s, date: s })),
    taskTimeline: arr(obj({ id: i, title: s, date: s, done: b })),
  })),
  "GET /api/graph-connections": op(arr(row("graphConnections"))),
  "POST /api/graph-connections": op(row("graphConnections"), obj({ sourceType: graphType, sourceId: i, targetType: graphType, targetId: i, label: s, color: s }, ["sourceType", "sourceId", "targetType", "targetId"])),
  "DELETE /api/graph-connections/:id": op(success),
  "GET /api/office/action-types": op(arr(obj({ ...template.properties, restrictedTo: arr(s), kind: s }))),
  "GET /api/office/templates": op(arr(template)),
  "POST /api/office/jobs": op(job, obj({ skillKey: s, actionType: s, argument: s }, ["skillKey", "actionType"]), [], "actionType must be a supported action or template:<key>; use GET /api/office/action-types and GET /api/office/templates to discover current choices."),
  "GET /api/office/jobs": op(arr(job), null, [query("limit", { ...i, maximum: 200, default: 80 })]),
  "GET /api/office/workers/:key/profile": op(obj({
    info: obj({ ...strings("key label desc longDesc"), isCustom: b }),
    recentJobs: arr(row("officeJobs", "id actionType argument status result confidence conversationId assistantMessageId createdAt finishedAt")),
    memories: arr(row("workerMemories")), stats: obj({ totalJobs: i, last7dJobs: i }),
  })),
  "POST /api/office/workers/:key/memories": op(row("workerMemories"), obj({ content: s }, ["content"])),
  "GET /api/office/jobs/feedback": op({ type: "object", additionalProperties: feedback }),
  "POST /api/office/jobs/:id/feedback": op(row("workerMemories"), {
    ...feedback, required: ["kind"],
    anyOf: [{ properties: { kind: enumString("positive", "negative") } }, { properties: { kind: enumString("correction"), note: { ...s, minLength: 1 } }, required: ["note"] }],
  }),
  "DELETE /api/office/memories/:id": op(ok),
  "GET /api/health/office": op(obj({
    ...workerStats.properties,
    breakdown: arr(obj({ skillKey: s, queued: i, running: i, done: i, failed: i, lastErrorMessage: nullable(s), lastErrorAt: nullable(s) })),
    breakdownWindowHours: i, confidenceWindowDays: i,
    confidenceBreakdown: arr(obj({ skillKey: s, high: i, medium: i, low: i, total: i, lowPct: i })),
  }), null, [query("hours", { ...range(1, 720), default: 24 }), query("confidenceDays", { ...range(1, 90), default: 7 })]),
  "GET /api/health/last30days": op(obj({ ...workerStats.properties, lastRunId: nullable(i), lastFinishedAt: nullable(s), capacity: obj({ global: i, perUser: i }) })),
  "GET /api/health/recurrence": op(obj({ ...scheduler.properties, horizonDays: i, buckets: arr(obj({ ...schedulerBucket.properties, lastRunCreatedCount: i })) })),
  "GET /api/health/daily-summary": op(scheduler),
  "GET /api/health/daily-weather": op(scheduler),
  "GET /api/health/wiki-agent": op(obj({
    autoIngest: auto, weeklyLint: lint,
    triggerMetrics: arr(obj({ ...trigger.properties, source: s, lastError: nullable(s) })),
    runsBySourceTrigger: arr(obj({ source: s, trigger: s, status: s, count: i, avgDurationMs: n, avgToolCalls: n })),
    runsWindowDays: i,
  }), null, [query("days", { ...range(1, 30), default: 7 })]),
  "GET /api/dashboard/today": op(obj({
    date: s, tasks: arr(row("tasks")), emails: arr(row("emailInbox")), memos: arr(row("memos")),
    expenses: arr(row("expenses")), food: arr(row("foodLog")), bloodPressure: arr(row("bloodPressure")),
    steps: arr(row("steps")), medicine: arr(row("medicineLog")),
    rss: arr(obj({ ...rss.properties.items.items.properties, feedTitle: s, feedId: i })),
    videoSummaries: arr(obj({ id: i, title: s, createdAt: nullable(s), tldr: s })),
    macros: obj({ totals: nullable(macro), goals: obj({ proteinGoal: nullable(i), carbsGoal: nullable(i), fatGoal: nullable(i), sodiumGoal: nullable(i), sodiumIsMax: b }) }),
  })),
};
