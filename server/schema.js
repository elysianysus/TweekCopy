import { pgTable, text, serial, boolean, integer, timestamp, uniqueIndex, index, vector, primaryKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  darkMode: boolean("dark_mode").default(false),
  pin: text("pin").default(null),
  lineUserId: text("line_user_id").default(null),
  proteinGoal: integer("protein_goal").default(null),
  carbsGoal: integer("carbs_goal").default(null),
  fatGoal: integer("fat_goal").default(null),
  sodiumGoal: integer("sodium_goal").default(null),
  sodiumIsMax: boolean("sodium_is_max").default(true),
  dailySummaryEnabled: boolean("daily_summary_enabled").default(true),
  dailySummaryHour: integer("daily_summary_hour").default(21),
  dailySummaryMinute: integer("daily_summary_minute").default(0),
  dailyWeatherEnabled: boolean("daily_weather_enabled").default(true),
  timezone: text("timezone").default("Asia/Hong_Kong"),
  timezoneAutoBackfillHandledAt: timestamp("timezone_auto_backfill_handled_at").default(null),
  tzExpandedGroups: text("tz_expanded_groups").default(null),
  tzExpandedGroupsUpdatedAt: timestamp("tz_expanded_groups_updated_at").default(null),
  journalNudgeEnabled: boolean("journal_nudge_enabled").default(true),
  sleepReminderEnabled: boolean("sleep_reminder_enabled").default(false),
  sleepReminderHour: integer("sleep_reminder_hour").default(23),
  sleepReminderMinute: integer("sleep_reminder_minute").default(0),
  sleepCleanReminderEnabled: boolean("sleep_clean_reminder_enabled").default(false),
  sleepCleanReminderDow: integer("sleep_clean_reminder_dow").default(0),
  sleepCleanReminderHour: integer("sleep_clean_reminder_hour").default(10),
  sleepCleanReminderMinute: integer("sleep_clean_reminder_minute").default(0),
  // Show High/Medium/Low confidence chips on Muse Office worker results.
  // Default ON; user can turn off in Account settings if it feels noisy.
  showConfidenceChips: boolean("show_confidence_chips").default(true),
  wikiAutoApplyIngest: boolean("wiki_auto_apply_ingest").default(false),
  wikiAutoApplySynthesize: boolean("wiki_auto_apply_synthesize").default(false),
  wikiAutoIngestRssDigest: boolean("wiki_auto_ingest_rss_digest").default(false),
  wikiAutoIngestVideoTranscript: boolean("wiki_auto_ingest_video_transcript").default(false),
  wikiAutoIngestLineLog: boolean("wiki_auto_ingest_line_log").default(false),
  wikiAutoIngestLast30days: boolean("wiki_auto_ingest_last30days").default(false),
  wikiLintEnabled: boolean("wiki_lint_enabled").default(false),
  wikiLintDow: integer("wiki_lint_dow").default(0),
  wikiLintHour: integer("wiki_lint_hour").default(9),
  wikiLintMinute: integer("wiki_lint_minute").default(0),
  // Per-user override for the Spec Builder skill's interview question list.
  // JSON-encoded array of strings; null means use DEFAULT_SPEC_BUILDER_QUESTIONS.
  specBuilderQuestions: text("spec_builder_questions").default(null),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("users_daily_summary_idx").on(table.dailySummaryEnabled, table.dailySummaryHour, table.dailySummaryMinute),
]);

export const journalEntries = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  body: text("body").notNull(),
  date: text("date").notNull(),
  source: text("source").default("manual"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sessions = pgTable("sessions", {
  sid: text("sid").primaryKey(),
  sess: text("sess").notNull(),
  expire: timestamp("expire").notNull(),
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  name: text("name").notNull(),
  color: text("color").default("white text-black dark:text-white dark:bg-black"),
  date: text("date").notNull(),
  done: boolean("done").default(false),
  order: integer("order").default(0),
  description: text("description").default(""),
  eisenhowerQuadrant: text("eisenhower_quadrant").default(null),
  reminder: text("reminder").default(null),
  startTime: text("start_time").default(null),
  endDate: text("end_date").default(null),
  endTime: text("end_time").default(null),
  repeatPattern: text("repeat_pattern").default(null),
  repeatInterval: integer("repeat_interval").default(null),
  repeatSeriesId: text("repeat_series_id").default(null),
  repeatAnchorDate: text("repeat_anchor_date").default(null),
  repeatEndedAt: text("repeat_ended_at").default(null),
  repeatTemplate: text("repeat_template").default(null),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("tasks_series_date_unique_idx")
    .on(table.uid, table.repeatSeriesId, table.date)
    .where(sql`${table.repeatSeriesId} IS NOT NULL`),
]);

export const subtasks = pgTable("subtasks", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  name: text("name").notNull(),
  done: boolean("done").default(false),
  order: integer("order").default(0),
});

export const taskRepeatExceptions = pgTable("task_repeat_exceptions", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  seriesId: text("series_id").notNull(),
  date: text("date").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("task_repeat_exceptions_unique_idx").on(table.uid, table.seriesId, table.date),
  index("task_repeat_exceptions_series_idx").on(table.seriesId),
]);

export const monthFocus = pgTable("month_focus", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  yearMonth: text("year_month").notNull(),
  line1: text("line1").default(""),
  line2: text("line2").default(""),
  line3: text("line3").default(""),
});

export const cheers = pgTable("cheers", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  text: text("text").notNull(),
  color: text("color").default("blue"),
  size: text("size").default("md"),
  x: integer("x").default(50),
  y: integer("y").default(50),
  createdAt: timestamp("created_at").defaultNow(),
});

export const memos = pgTable("memos", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  title: text("title").default(""),
  content: text("content").default(""),
  date: text("date").default(null),
  color: text("color").default("white"),
  noteType: text("note_type").default(null),
  pinned: boolean("pinned").default(false),
  isHandMaintained: boolean("is_hand_maintained").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const memoKnowledgeUsers = pgTable("memo_knowledge_users", {
  uid: integer("uid").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
});

export const memoKnowledgeIndex = pgTable("memo_knowledge_index", {
  uid: integer("uid").notNull(),
  memoId: integer("memo_id").notNull(),
  hash: text("hash").notNull(),
  episode: text("episode").notNull(),
  status: text("status").notNull(),
  error: text("error"),
}, t => [primaryKey({ columns: [t.uid, t.memoId] })]);

export const memoTags = pgTable("memo_tags", {
  id: serial("id").primaryKey(),
  memoId: integer("memo_id").notNull(),
  tag: text("tag").notNull(),
});

export const memoFiles = pgTable("memo_files", {
  id: serial("id").primaryKey(),
  memoId: integer("memo_id").notNull(),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  url: text("url").notNull(),
  mimeType: text("mime_type").default(""),
  data: text("data"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const whiteboards = pgTable("whiteboards", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").default("default"),
  parentId: integer("parent_id").default(null),
  data: text("data").default("{}"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const museConversations = pgTable("muse_conversations", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  title: text("title").default("New chat"),
  // Provenance: 'chatgpt' | 'claude' for imported chats, null for native Muse.
  source: text("source"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const museMessages = pgTable("muse_messages", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  conversationId: integer("conversation_id"),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const museMemories = pgTable("muse_memories", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  sourceConversationId: integer("source_conversation_id"),
  sourceMessageId: integer("source_message_id"),
  kind: text("kind").notNull().default("auto"),
  content: text("content").notNull(),
  rawExcerpt: text("raw_excerpt"),
  embedding: vector("embedding", { dimensions: 1536 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("muse_memories_uid_idx").on(table.uid),
]);

export const taskFiles = pgTable("task_files", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  url: text("url").notNull(),
  mimeType: text("mime_type").default(""),
  data: text("data"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const whiteboardMemos = pgTable("whiteboard_memos", {
  id: serial("id").primaryKey(),
  whiteboardId: integer("whiteboard_id").notNull(),
  memoId: integer("memo_id").notNull(),
  x: integer("x").default(100),
  y: integer("y").default(100),
  width: integer("width").default(320),
  height: integer("height").default(280),
  sectionId: integer("section_id").default(null),
}, (table) => [
  index("whiteboard_memos_wb_idx").on(table.whiteboardId),
]);

export const whiteboardConnections = pgTable("whiteboard_connections", {
  id: serial("id").primaryKey(),
  whiteboardId: integer("whiteboard_id").notNull(),
  fromMemoId: integer("from_memo_id").notNull(),
  toMemoId: integer("to_memo_id").notNull(),
  label: text("label").default(""),
  style: text("style").default("solid"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("whiteboard_connections_wb_idx").on(table.whiteboardId),
]);

export const whiteboardSections = pgTable("whiteboard_sections", {
  id: serial("id").primaryKey(),
  whiteboardId: integer("whiteboard_id").notNull(),
  title: text("title").default(""),
  x: integer("x").default(0),
  y: integer("y").default(0),
  width: integer("width").default(400),
  height: integer("height").default(300),
  color: text("color").default("blue"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("whiteboard_sections_wb_idx").on(table.whiteboardId),
]);

export const memoLinks = pgTable("memo_links", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  fromMemoId: integer("from_memo_id").notNull(),
  toMemoId: integer("to_memo_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("memo_links_unique_idx").on(table.fromMemoId, table.toMemoId),
  index("memo_links_to_idx").on(table.toMemoId),
  index("memo_links_uid_idx").on(table.uid),
]);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const rssFeeds = pgTable("rss_feeds", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  url: text("url").notNull(),
  title: text("title").default(""),
  siteUrl: text("site_url").default(""),
  autoSummarize: boolean("auto_summarize").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const youtubeAutoImports = pgTable("youtube_auto_imports", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  feedId: integer("feed_id").notNull(),
  videoId: text("video_id").notNull(),
  status: text("status").notNull().default("pending"),
  memoId: integer("memo_id").default(null),
  errorMessage: text("error_message").default(null),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  uniqUserVideo: uniqueIndex("youtube_auto_imports_uid_video_idx").on(t.uid, t.videoId),
  feedIdx: index("youtube_auto_imports_feed_idx").on(t.feedId),
}));

export const digestPreferences = pgTable("digest_preferences", {
  uid: integer("uid").primaryKey(),
  selectedFeedIds: text("selected_feed_ids").default("[]"),
  windowHours: integer("window_hours").default(24),
  keyword: text("keyword").default(""),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const emailInbox = pgTable("email_inbox", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  fromAddress: text("from_address").default(""),
  subject: text("subject").default(""),
  body: text("body").default(""),
  processed: boolean("processed").default(false),
  resultType: text("result_type").default(null),
  resultId: integer("result_id").default(null),
  createdAt: timestamp("created_at").defaultNow(),
});

export const gmailTokens = pgTable("gmail_tokens", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull().unique(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiry: timestamp("expiry"),
  gmailEmail: text("gmail_email").default(""),
  labelName: text("label_name").default("ToAnalogue"),
  lastChecked: timestamp("last_checked"),
  enabled: boolean("enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const shareTokens = pgTable("share_tokens", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull().unique(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const agentRuns = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  op: text("op").notNull(),
  status: text("status").notNull().default("running"),
  input: text("input").default(""),
  output: text("output").default(""),
  trace: text("trace").default("[]"),
  error: text("error").default(null),
  toolCallCount: integer("tool_call_count").default(0),
  durationMs: integer("duration_ms").default(0),
  trigger: text("trigger").notNull().default("manual"),
  // 'auto' | 'manual'. Defaults to 'manual' so any future row inserted
  // without an explicit source is unambiguously human-initiated.
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("agent_runs_uid_created_idx").on(table.uid, table.createdAt),
  index("agent_runs_uid_trigger_idx").on(table.uid, table.trigger),
]);

export const wikiLintSent = pgTable("wiki_lint_sent", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  dedupKey: text("dedup_key").notNull(),
  sentAt: timestamp("sent_at").defaultNow(),
}, (t) => [
  uniqueIndex("wiki_lint_sent_uid_key_idx").on(t.uid, t.dedupKey),
]);

export const agentRunUpdates = pgTable("agent_run_updates", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull(),
  uid: integer("uid").notNull(),
  memoId: integer("memo_id").notNull(),
  op: text("op").notNull(),
  beforeTitle: text("before_title").default(""),
  beforeContent: text("before_content").default(""),
  beforeTags: text("before_tags").default("[]"),
  afterTitle: text("after_title").default(""),
  afterContent: text("after_content").default(""),
  afterTags: text("after_tags").default("[]"),
  diff: text("diff").default(""),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message").default(null),
  createdAt: timestamp("created_at").defaultNow(),
  decidedAt: timestamp("decided_at").default(null),
}, (table) => [
  index("agent_run_updates_run_idx").on(table.runId),
  index("agent_run_updates_uid_idx").on(table.uid),
]);

export const customSkills = pgTable("custom_skills", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  icon: text("icon").default("fa-user"),
  color: text("color").default("text-purple-500"),
  description: text("description").default(""),
  systemPrompt: text("system_prompt").notNull(),
  sampleChatLog: text("sample_chat_log").default(""),
  memories: text("memories").default(""),
  persona: text("persona").default(""),
  corrections: text("corrections").default(""),
  relationshipInfo: text("relationship_info").default(""),
  personalityTags: text("personality_tags").default(""),
  version: integer("version").default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("custom_skills_uid_key_idx").on(table.uid, table.key),
]);

export const lifeMilestones = pgTable("life_milestones", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  title: text("title").notNull(),
  date: text("date").notNull(),
  endDate: text("end_date").default(null),
  color: text("color").default("blue"),
  icon: text("icon").default("fa-solid fa-star"),
  notes: text("notes").default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const graphConnections = pgTable("graph_connections", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id").notNull(),
  targetType: text("target_type").notNull(),
  targetId: integer("target_id").notNull(),
  label: text("label").default(""),
  color: text("color").default("#6b7280"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const bloodPressure = pgTable("blood_pressure", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  date: text("date").notNull(),
  time: text("time").default(null),
  sys: integer("sys").notNull(),
  dia: integer("dia").notNull(),
  pulse: integer("pulse").notNull(),
  source: text("source").default("web"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const steps = pgTable("steps", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  date: text("date").notNull(),
  steps: integer("steps").notNull(),
  distance: text("distance").default(null),
  calories: integer("calories").default(null),
  walkTime: text("walk_time").default(null),
  remarks: text("remarks").default(null),
  source: text("source").default("web"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const foodLog = pgTable("food_log", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  date: text("date").notNull(),
  time: text("time").default(null),
  items: text("items").default("[]"),
  totalCalories: integer("total_calories").default(0),
  mealType: text("meal_type").default("unknown"),
  suggestion: text("suggestion").default(""),
  healthScore: integer("health_score").default(0),
  source: text("source").default("web"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const foodNutritionCache = pgTable("food_nutrition_cache", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  lookupKey: text("lookup_key").notNull(),
  name: text("name").default(""),
  caloriesPerServing: integer("calories_per_serving").default(0),
  servingDescription: text("serving_description").default(""),
  protein: text("protein").default(null),
  carbs: text("carbs").default(null),
  fat: text("fat").default(null),
  sodium: text("sodium").default(null),
  raw: text("raw").default(""),
  fetchedAt: timestamp("fetched_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("food_nutrition_cache_src_key").on(t.source, t.lookupKey),
}));

export const webhookTokens = pgTable("webhook_tokens", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  name: text("name").default("Webhook"),
  token: text("token").notNull().unique(),
  defaultType: text("default_type").default("memo"),
  callCount: integer("call_count").default(0),
  lastUsedAt: timestamp("last_used_at").default(null),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sleepLog = pgTable("sleep_log", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  date: text("date").notNull(),
  bedTime: text("bed_time").default(null),
  wakeTime: text("wake_time").default(null),
  totalSleepMin: integer("total_sleep_min").default(null),
  deepSleepMin: integer("deep_sleep_min").default(null),
  remSleepMin: integer("rem_sleep_min").default(null),
  wakeCount: integer("wake_count").default(null),
  snoreMin: integer("snore_min").default(null),
  effectiveInterventionPct: integer("effective_intervention_pct").default(null),
  snoreIntensityDropDb: integer("snore_intensity_drop_db").default(null),
  offPillowCount: integer("off_pillow_count").default(null),
  interventionMin: integer("intervention_min").default(null),
  spo2Min: integer("spo2_min").default(null),
  spo2Avg: integer("spo2_avg").default(null),
  hrAvg: integer("hr_avg").default(null),
  source: text("source").default("manual"),
  notes: text("notes").default(null),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("sleep_log_uid_date_idx").on(table.uid, table.date),
]);

export const sleepSymptomLog = pgTable("sleep_symptom_log", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  date: text("date").notNull(),
  morningHeadache: integer("morning_headache").default(null),
  daytimeFatigue: integer("daytime_fatigue").default(null),
  concentration: integer("concentration").default(null),
  nightWakeCount: integer("night_wake_count").default(null),
  notes: text("notes").default(null),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("sleep_symptom_log_uid_date_idx").on(table.uid, table.date),
]);

export const medicineLog = pgTable("medicine_log", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  date: text("date").notNull(),
  time: text("time").default(null),
  symptom: text("symptom").notNull(),
  medicine: text("medicine").default(null),
  dosage: text("dosage").default(null),
  severity: integer("severity").default(3),
  notes: text("notes").default(null),
  createdAt: timestamp("created_at").defaultNow(),
});

export const expenseAuditLog = pgTable("expense_audit_log", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  expenseId: integer("expense_id").default(null),
  action: text("action").notNull(),
  field: text("field").default(null),
  oldValue: text("old_value").default(null),
  newValue: text("new_value").default(null),
  store: text("store").default(""),
  currency: text("currency").default("HKD"),
  total: text("total").default("0"),
  source: text("source").default("line"),
  snapshot: text("snapshot").default(null),
  createdAt: timestamp("created_at").defaultNow(),
});

export const foodAuditLog = pgTable("food_audit_log", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  foodId: integer("food_id").default(null),
  action: text("action").notNull(),
  field: text("field").default(null),
  oldValue: text("old_value").default(null),
  newValue: text("new_value").default(null),
  summary: text("summary").default(""),
  mealType: text("meal_type").default("unknown"),
  totalCalories: integer("total_calories").default(0),
  source: text("source").default("line"),
  snapshot: text("snapshot").default(null),
  createdAt: timestamp("created_at").defaultNow(),
});

export const dailySummarySent = pgTable("daily_summary_sent", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  dedupKey: text("dedup_key").notNull(),
  sentAt: timestamp("sent_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("daily_summary_sent_uid_key").on(t.uid, t.dedupKey),
}));

export const dailyWeatherSent = pgTable("daily_weather_sent", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  dedupKey: text("dedup_key").notNull(),
  sentAt: timestamp("sent_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("daily_weather_sent_uid_key").on(t.uid, t.dedupKey),
}));

export const jobOpportunities = pgTable("job_opportunities", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  company: text("company").default(""),
  role: text("role").default(""),
  location: text("location").default(""),
  comp: text("comp").default(""),
  sourceUrl: text("source_url").default(""),
  jdText: text("jd_text").default(""),
  status: text("status").notNull().default("saved"),
  score: text("score").default(""),
  evaluationJson: text("evaluation_json").default(""),
  tailoredCvMemoId: integer("tailored_cv_memo_id").default(null),
  coverLetterMemoId: integer("cover_letter_memo_id").default(null),
  milestoneId: integer("milestone_id").default(null),
  notes: text("notes").default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("job_opportunities_uid_idx").on(table.uid),
]);

export const jobStatusHistory = pgTable("job_status_history", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull(),
  uid: integer("uid").notNull(),
  fromStatus: text("from_status").default(""),
  toStatus: text("to_status").notNull(),
  note: text("note").default(""),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("job_status_history_job_idx").on(table.jobId),
]);

export const last30daysRuns = pgTable("last30days_runs", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  topic: text("topic").notNull(),
  sourcesJson: text("sources_json").default("[]"),
  status: text("status").notNull().default("queued"),
  htmlPath: text("html_path").default(null),
  errorMessage: text("error_message").default(null),
  missingKey: text("missing_key").default(null),
  stderrTail: text("stderr_tail").default(""),
  engineVersion: text("engine_version").default(null),
  createdAt: timestamp("created_at").defaultNow(),
  startedAt: timestamp("started_at").default(null),
  finishedAt: timestamp("finished_at").default(null),
}, (table) => [
  index("last30days_runs_uid_created_idx").on(table.uid, table.createdAt),
]);

// Weekly auto-refresh subscriptions for Last 30 Days topics. When enabled,
// the scheduler enqueues a fresh research run every 7 days.
export const last30daysSubscriptions = pgTable("last30days_subscriptions", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  topic: text("topic").notNull(),
  sourcesJson: text("sources_json").default("[]"),
  enabled: boolean("enabled").notNull().default(true),
  lastEnqueuedAt: timestamp("last_enqueued_at").default(null),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("last30days_subs_uid_idx").on(table.uid),
  uniqueIndex("last30days_subs_uid_topic_idx").on(table.uid, table.topic),
]);

export const officeJobs = pgTable("office_jobs", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  skillKey: text("skill_key").notNull(),
  actionType: text("action_type").notNull(),
  argument: text("argument").default(""),
  status: text("status").notNull().default("queued"),
  result: text("result").default(""),
  errorMessage: text("error_message").default(null),
  conversationId: integer("conversation_id").default(null),
  assistantMessageId: integer("assistant_message_id").default(null),
  // 'action'   = user-initiated quick action
  // 'reaction' = auto-fired short comment from another worker (D)
  // 'subtask'  = child job dispatched by a 'delegate' manager (C1).
  // Status 'waiting' is used for a manager job parked between dispatch and
  // aggregation while its children run.
  kind: text("kind").notNull().default("action"),
  parentJobId: integer("parent_job_id").default(null),
  // 'high' | 'medium' | 'low' — surfaced as a confidence chip in the UI so
  // the user knows where to apply judgement on a worker's output. Derived
  // from a static (skillKey, actionType) baseline + an optional per-run
  // self-rating. Nullable for old rows; the read paths normalize null to
  // 'medium'.
  confidence: text("confidence").default(null),
  createdAt: timestamp("created_at").defaultNow(),
  startedAt: timestamp("started_at").default(null),
  finishedAt: timestamp("finished_at").default(null),
}, (table) => [
  index("office_jobs_uid_skill_idx").on(table.uid, table.skillKey, table.createdAt),
  index("office_jobs_status_idx").on(table.status),
  // Partial unique on (parent_job_id) — only enforces for reactions so a
  // single parent can never spawn two reactions even under a drain race. For
  // 'subtask' children a manager dispatches MANY rows with the same parent,
  // so they must NOT be deduped here.
  uniqueIndex("office_jobs_parent_reaction_unique_idx")
    .on(table.parentJobId)
    .where(sql`kind = 'reaction'`),
  index("office_jobs_parent_idx").on(table.parentJobId),
]);

// Per-worker long-term memory. Auto-populated after each successful office
// action and injected into the worker's system prompt on subsequent runs so
// each worker "remembers" you across sessions. Users can also add manual
// memories or delete any memory from the office worker dialog.
export const workerMemories = pgTable("worker_memories", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  skillKey: text("skill_key").notNull(),
  content: text("content").notNull(),
  source: text("source").notNull().default("auto"), // 'auto' | 'manual'
  jobId: integer("job_id").default(null),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("worker_memories_uid_skill_idx").on(table.uid, table.skillKey, table.createdAt),
]);

export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  store: text("store").default(""),
  date: text("date").default(null),
  currency: text("currency").default("HKD"),
  total: text("total").default("0"),
  items: text("items").default("[]"),
  notes: text("notes").default(""),
  category: text("category").default("other"),
  memoId: integer("memo_id").default(null),
  source: text("source").default("line"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const podcastShows = pgTable("podcast_shows", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  title: text("title").default(""),
  channelId: text("channel_id").default(""),
  feedUrl: text("feed_url").notNull(),
  channelUrl: text("channel_url").default(""),
  thumbnail: text("thumbnail").default(""),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("podcast_shows_uid_feed_idx").on(t.uid, t.feedUrl),
]);

export const podcastEpisodes = pgTable("podcast_episodes", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  showId: integer("show_id").notNull(),
  videoId: text("video_id").notNull(),
  title: text("title").default(""),
  url: text("url").default(""),
  thumbnail: text("thumbnail").default(""),
  publishedAt: timestamp("published_at").default(null),
  listened: boolean("listened").default(false),
  notes: text("notes").default(""),
  summary: text("summary").default(null),
  transcript: text("transcript").default(null),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("podcast_episodes_uid_video_idx").on(t.uid, t.showId, t.videoId),
  index("podcast_episodes_show_idx").on(t.showId, t.publishedAt),
]);

export const podcastEpisodeNotes = pgTable("podcast_episode_notes", {
  id: serial("id").primaryKey(),
  uid: integer("uid").notNull(),
  episodeId: integer("episode_id").notNull(),
  sec: integer("sec").default(null),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("podcast_episode_notes_ep_idx").on(t.episodeId, t.sec),
]);
