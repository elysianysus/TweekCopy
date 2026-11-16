import crypto from "crypto";
import nodeCrypto from "node:crypto";
import { db } from "./db.js";
import { users, tasks, memos, memoFiles, expenses, expenseAuditLog, bloodPressure, steps, medicineLog, foodLog, foodAuditLog, journalEntries, dailySummarySent, dailyWeatherSent } from "./schema.js";
import { eq, and, isNotNull, sql, asc } from "drizzle-orm";
import { formatCategoryForLine } from "../shared/expenseCategories.js";
import OpenAI from "openai";
import { createRequire } from "module";
import { sendPushToUser } from "./push.js";
import { enrichItems, lookupByBarcode, sourceEmoji, sourcesFooter, adjustHealthScoreForCalories, formatMacroSummary, sumMacros, getTodayMacroTotals, buildGoalContext, formatGoalsForPrompt, formatGoalCoachingForReply, formatGoalSummaryForReply } from "./nutrition.js";
import { getUserNow, userToday, userTodayPadded, userYesterday, getUserTimeParts, getNowInTz, todayInTz, userTimezone, getTimePartsInTz, getNextOccurrenceInTz } from "./timezone.js";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const LINE_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const chatHistory = new Map();
const activeSkills = new Map();
const MAX_HISTORY = 20;

const SKILL_TRIGGERS = {
  analytics: ["analytics", "分析", "數據", "stats", "productivity"],
  writer: ["writer", "寫嘢", "寫作", "writing", "幫我寫"],
  planner: ["planner", "排schedule", "計劃", "planning", "排日程", "plan my day"],
  adhd: ["adhd", "專注", "focus", "集中", "adhd coach"],
  journal: ["journal", "日誌", "日记", "journal coach", "journaling", "interstitial"],
  brainstorm: ["brainstorm", "腦暴", "brainstorming", "諗idea", "ideas"],
  xuefeng: ["張雪峰", "张雪峰", "雪峰", "xuefeng", "志願", "志愿", "選科", "选科", "填志願", "填志愿", "高考", "考研"],
  musk: ["musk", "馬斯克", "马斯克", "elon", "第一性原理", "first principles", "spacex", "tesla"],
  munger: ["munger", "芒格", "查理芒格", "投資", "投资", "多元思維", "逆向思考"],
  feynman: ["feynman", "費曼", "费曼", "學習法", "学习法", "教學", "教学"],
  naval: ["naval", "納瓦爾", "纳瓦尔", "財富", "财富", "槓桿", "杠杆", "specific knowledge"],
  specBuilder: ["spec", "specbuilder", "spec builder", "寫spec", "写spec", "規格", "规格"],
};

const SKILL_LABELS = {
  default: { icon: "🪄", label: "Muse" },
  analytics: { icon: "📊", label: "Analytics" },
  writer: { icon: "✍️", label: "Writer" },
  planner: { icon: "📅", label: "Planner" },
  adhd: { icon: "🧠", label: "ADHD Coach" },
  journal: { icon: "🪶", label: "Journal Coach" },
  brainstorm: { icon: "💡", label: "Brainstorm" },
  xuefeng: { icon: "🎓", label: "張雪峰" },
  musk: { icon: "🚀", label: "Elon Musk" },
  munger: { icon: "📊", label: "查理芒格" },
  feynman: { icon: "🔬", label: "費曼" },
  naval: { icon: "⚓", label: "Naval" },
  specBuilder: { icon: "📋", label: "Spec Builder" },
};

const customSkills = new Map();
const colleagueProfiles = new Map();
const pendingExpenses = new Map();
const PENDING_EXPENSE_TTL_MS = 5 * 60 * 1000;
const lastExpenses = new Map();
const LAST_EXPENSE_TTL_MS = 5 * 60 * 1000;
const lastFoodLogs = new Map();
const LAST_FOOD_LOG_TTL_MS = 5 * 60 * 1000;

function rememberLastExpense(lineUserId, expenseId, snapshot) {
  if (!lineUserId || !expenseId) return;
  lastExpenses.set(lineUserId, {
    expenseId,
    expense: { ...snapshot },
    savedAt: Date.now(),
  });
}

async function logExpenseAudit(uid, expenseId, action, snapshot, fieldChanges) {
  try {
    const baseRow = {
      uid,
      expenseId: expenseId || null,
      action,
      store: snapshot?.store || "",
      currency: snapshot?.currency || "HKD",
      total: String(snapshot?.total ?? 0),
      source: "line",
    };
    let snapshotJson = null;
    try { snapshotJson = snapshot ? JSON.stringify(snapshot) : null; } catch (e) { snapshotJson = null; }
    if (action === "delete") {
      await db.insert(expenseAuditLog).values({ ...baseRow, field: null, oldValue: null, newValue: null, snapshot: snapshotJson });
      return;
    }
    if (Array.isArray(fieldChanges) && fieldChanges.length > 0) {
      const rows = fieldChanges.map((c) => ({
        ...baseRow,
        field: c.field,
        oldValue: c.oldValue == null ? null : String(c.oldValue),
        newValue: c.newValue == null ? null : String(c.newValue),
        snapshot: snapshotJson,
      }));
      await db.insert(expenseAuditLog).values(rows);
    }
  } catch (e) {
    console.error("Failed to log expense audit:", e.message);
  }
}

function foodSummary(snapshot) {
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  const names = items.map((i) => i?.name).filter(Boolean);
  if (names.length === 0) return "餐點";
  return names.slice(0, 3).join("、") + (names.length > 3 ? "…" : "");
}

async function logFoodAudit(uid, foodId, action, snapshot, fieldChanges) {
  try {
    const baseRow = {
      uid,
      foodId: foodId || null,
      action,
      summary: foodSummary(snapshot),
      mealType: snapshot?.mealType || "unknown",
      totalCalories: Math.round(Number(snapshot?.totalCalories) || 0),
      source: "line",
    };
    let snapshotJson = null;
    try { snapshotJson = snapshot ? JSON.stringify(snapshot) : null; } catch (e) { snapshotJson = null; }
    if (action === "delete") {
      await db.insert(foodAuditLog).values({ ...baseRow, field: null, oldValue: null, newValue: null, snapshot: snapshotJson });
      return;
    }
    if (Array.isArray(fieldChanges) && fieldChanges.length > 0) {
      const rows = fieldChanges.map((c) => ({
        ...baseRow,
        field: c.field,
        oldValue: c.oldValue == null ? null : String(c.oldValue),
        newValue: c.newValue == null ? null : String(c.newValue),
        snapshot: snapshotJson,
      }));
      await db.insert(foodAuditLog).values(rows);
    }
  } catch (e) {
    console.error("Failed to log food audit:", e.message);
  }
}

function rememberLastFoodLog(lineUserId, foodId, snapshot) {
  if (!lineUserId || !foodId) return;
  lastFoodLogs.set(lineUserId, {
    foodId,
    food: { ...snapshot },
    savedAt: Date.now(),
  });
}

const MACRO_TREND_FIELDS = [
  { key: "protein", label: "蛋白質", unit: "g" },
  { key: "carbs", label: "碳水", unit: "g" },
  { key: "fat", label: "脂肪", unit: "g" },
  { key: "sodium", label: "鈉", unit: "mg" },
];

function formatYesterdayTrend(todayTotals, yesterdayTotals, ctx) {
  if (!yesterdayTotals) return "";
  const hasYData =
    (Number(yesterdayTotals.calories) || 0) > 0 ||
    (Number(yesterdayTotals.protein) || 0) > 0 ||
    (Number(yesterdayTotals.carbs) || 0) > 0 ||
    (Number(yesterdayTotals.fat) || 0) > 0 ||
    (Number(yesterdayTotals.sodium) || 0) > 0;
  if (!hasYData) return "";

  let trackedKeys = null;
  if (ctx && ctx.goals) {
    trackedKeys = Object.entries(ctx.goals)
      .filter(([, g]) => g && g.goal != null && g.goal > 0)
      .map(([k]) => k);
    if (trackedKeys.length === 0) trackedKeys = null;
  }

  const lines = [];
  for (const f of MACRO_TREND_FIELDS) {
    if (trackedKeys && !trackedKeys.includes(f.key)) continue;
    const t = Math.round(Number(todayTotals?.[f.key]) || 0);
    const y = Math.round(Number(yesterdayTotals?.[f.key]) || 0);
    if (t === 0 && y === 0) continue;
    const diff = t - y;
    const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "•";
    const sign = diff > 0 ? "+" : diff < 0 ? "-" : "±";
    const diffStr = diff === 0 ? `持平 ${y}${f.unit}` : `${sign}${Math.abs(diff)}${f.unit} vs 昨日 ${y}${f.unit}`;
    lines.push(`${arrow} ${f.label}：${diffStr}`);
  }
  if (lines.length === 0) return "";
  return `\n\n📈 同昨日比較：\n${lines.join("\n")}`;
}

function verifySignature(body, signature) {
  if (!LINE_SECRET) return false;
  const hash = crypto
    .createHmac("SHA256", LINE_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

async function replyMessage(replyToken, text, options = {}) {
  const maxLen = 5000;
  const truncated = text.length > maxLen ? text.substring(0, maxLen - 3) + "..." : text;
  const messageObj = { type: "text", text: truncated };
  if (options && options.quickReply) messageObj.quickReply = options.quickReply;
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [messageObj],
    }),
  });
}

const NEXT_WEATHER_COMMAND_TEXT = "/weather next";

const WEATHER_NEXT_QUICK_REPLY = {
  items: [
    {
      type: "action",
      action: { type: "message", label: "🌤 Next push", text: NEXT_WEATHER_COMMAND_TEXT },
    },
  ],
};

export function formatNextWeatherPushReply(user, now = new Date()) {
  const enabled = user?.dailyWeatherEnabled !== false;
  if (!enabled) {
    return "🌤 Daily weather push is turned off.\n\n打開 Account 設定嘅「LINE Weather Push」就會每朝再推送。";
  }
  const tz = userTimezone(user);
  let next;
  try {
    next = getNextOccurrenceInTz(tz, WEATHER_TARGET_HOUR, WEATHER_TARGET_MINUTE, now);
  } catch {
    next = null;
  }
  if (!next || Number.isNaN(next.getTime())) {
    return "🌤 Next weather push time unavailable.";
  }
  const dayKey = (d) => new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
  const todayKey = dayKey(now);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowKey = dayKey(tomorrow);
  const nextKey = dayKey(next);
  let dayLabel;
  if (nextKey === todayKey) dayLabel = "today";
  else if (nextKey === tomorrowKey) dayLabel = "tomorrow";
  else dayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", month: "short", day: "numeric",
  }).format(next);
  const timeStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit",
  }).format(next);
  let tzAbbr = "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "numeric", timeZoneName: "short",
    }).formatToParts(next);
    tzAbbr = parts.find((p) => p.type === "timeZoneName")?.value || "";
  } catch {}
  return `🌤 Next weather push: ${dayLabel} at ${timeStr}${tzAbbr ? " " + tzAbbr : ""}`;
}

async function findOrLinkUser(lineUserId) {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.lineUserId, lineUserId));
  if (existing) return existing;

  const allUsers = await db.select().from(users);
  if (allUsers.length === 1) {
    await db
      .update(users)
      .set({ lineUserId: lineUserId })
      .where(eq(users.id, allUsers[0].id));
    invalidateDailySummaryCache(); invalidateDailyWeatherCache();
    return allUsers[0];
  }

  return null;
}

function getChatHistory(lineUserId) {
  if (!chatHistory.has(lineUserId)) {
    chatHistory.set(lineUserId, []);
  }
  return chatHistory.get(lineUserId);
}

function addChatHistory(lineUserId, role, content) {
  const history = getChatHistory(lineUserId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

async function classifyIntent(message, user) {
  const today = getUserNow(user);
  const todayStr = userToday(user);
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You classify user messages into intents. Return ONLY valid JSON.
Today is ${todayStr} (${dayNames[today.getDay()]}).

Intents:
1. "add_task" - User wants to add a task/event/reminder/todo. Examples: "聽日開會", "買牛奶", "4月20號交報告", "下午3點見客", "add meeting tomorrow"
2. "check_tasks" - User wants to see/check their tasks/schedule/plans. Examples: "今日有咩做", "我嘅tasks", "今個禮拜schedule", "what's on my plate"
3. "add_memo" - User wants to save a note/memo/idea. Examples: "記住...", "memo: ...", "筆記：...", "save this idea", "note down..."
4. "add_expense" - User wants to record spending/expense/purchase, OR is describing a real-world spending action (going to a vendor, taking transport, buying something) even without explicitly saying "記帳" and even when the amount is missing. Examples: "記帳 lunch 133", "花了100蚊", "使左50蚊搭車", "買左杯咖啡35蚊", "expense taxi 45", "搭uber去機場 80蚊", "搭uber去機場", "搭的士返屋企", "打車50蚊", "去咗 starbucks 飲咖啡", "去咗7-11買嘢", "去咗萬寧買野", "去apple store買iphone", "grab 45蚊", "Uber Eats 90蚊", "尋日去咗超市買餸"
5. "add_steps" - User wants to record steps/walking/exercise. Examples: "今日行左8000步", "steps 12000", "步數 6500", "走了一萬步", "今日行咗5km"
6. "add_medicine" - User wants to record symptoms or medicine taken. Examples: "頭痛食左panadol", "肚痛", "食咗止痛藥", "今日發燒", "medicine headache"
7. "add_food" - User describes what they ate or drank (a meal, snack, or drink — NOT a purchase, NOT medicine). Examples: "昨晚吃晚飯 吃了一碗鮮蝦雲吞", "lunch 食左叉燒飯", "今朝食咗碗皮蛋瘦肉粥同油炸鬼", "snack: 一杯珍珠奶茶", "晚餐食咗壽司", "had pasta for dinner", "早餐食咗多士同奶茶"
8. "chat" - General conversation, questions, brainstorming, advice. Examples: "你好", "幫我諗下...", "點解...", "what should I..."
9. "link_account" - User wants to link their account. Starts with "link "

Return: {"intent": "add_task"|"check_tasks"|"add_memo"|"add_expense"|"add_steps"|"add_medicine"|"add_food"|"chat"|"link_account"}

If the message explicitly mentions a monetary amount (e.g. "133蚊", "$50", "花了100") together with a spending context, classify as "add_expense".
Spending verbs/phrases that strongly indicate "add_expense" even without "記帳" prefix: 搭/打車/打的/坐 + (uber/grab/taxi/的士/巴士/小巴/港鐵/地鐵), 去咗/去/逛 + (well-known store/cafe/restaurant/supermarket/便利店 like starbucks/麥當勞/KFC/7-11/萬寧/屈臣氏/apple store/惠康/百佳/超市), 買咗/買左 + (specific item beyond a single grocery word), Uber Eats/foodpanda/Deliveroo/外賣. If amount is missing, still classify as "add_expense" so we can ask the user for the amount; do NOT silently route to add_task or chat.
Distinguish from "add_food": if the message is purely about the food/drink consumed (e.g. "食咗壽司", "lunch 食左叉燒飯") with no vendor/store/transport context, prefer "add_food". If the message names a place/store/transport service (starbucks, uber, 餐廳名), prefer "add_expense".
If the message mentions steps count, walking distance, or exercise tracking, classify as "add_steps".
If the message mentions symptoms (頭痛/肚痛/發燒/喉嚨痛 etc.) or medicine taken, classify as "add_medicine". Note: "食咗藥/食藥/食左panadol" is medicine, NOT food.
If the message describes eating/drinking food (吃/食咗/食左/ate/had + a food/drink name) WITHOUT a monetary amount and WITHOUT being medicine, classify as "add_food". Meal keywords: 早餐/午餐/晚餐/宵夜/breakfast/lunch/dinner/snack/小食.
Simple action items like "買牛奶" without a stated amount should be "add_task", not "add_expense" or "add_food" (買 = buy, not eat).
If the message clearly describes a task/event with action words and no amount, classify as "add_task".
If ambiguous between task and chat, prefer "add_task" for short actionable items.`,
        },
        { role: "user", content: message },
      ],
      temperature: 0,
      max_tokens: 50,
    });

    const text = response.choices[0]?.message?.content?.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.intent || "chat";
    }
    return "chat";
  } catch (err) {
    console.error("LINE classify error:", err.message);
    return "chat";
  }
}

async function parseTaskWithAI(message, user) {
  const today = getUserNow(user);
  const todayStr = userToday(user);
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You parse user messages into task data. Today is ${todayStr} (${dayNames[today.getDay()]}).
Return ONLY valid JSON with these fields:
- "name": the task name (required)
- "date": date string like "2026-4-11" or null if no date mentioned. Use format YYYY-M-D (no zero padding).
  - "今日"/"今天" = ${todayStr}
  - "明天"/"聽日"/"明日" = tomorrow
  - "後天"/"後日" = day after tomorrow
  - "下個禮拜一"/"下週一" = next Monday
  - "禮拜X"/"星期X"/"週X" = this coming weekday
  - Specific dates like "4月20號" = ${today.getFullYear()}-4-20
- "startTime": time like "14:00" or null. Parse "下午3點"="15:00", "朝早9點"="09:00", "晏晝"="12:00"
- "endTime": end time like "15:00" or null
- "description": any extra details or null`,
        },
        { role: "user", content: message },
      ],
      temperature: 0,
      max_tokens: 200,
    });

    const text = response.choices[0]?.message?.content?.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (err) {
    console.error("LINE AI parse error:", err.message);
    return null;
  }
}

async function handleAddTask(user, replyToken, text) {
  const parsed = await parseTaskWithAI(text, user);
  if (!parsed || !parsed.name) {
    await replyMessage(replyToken, "唔好意思，我理解唔到你想加咩 task 🤔\n\n直接打就得，例如：\n• 聽日開會\n• 4月20號交報告\n• 下午3點見客");
    return;
  }

  const taskData = {
    uid: user.id,
    name: parsed.name,
    color: "white text-black dark:text-white dark:bg-black",
    date: parsed.date || "notes",
    done: false,
    order: 0,
    description: parsed.description || "",
    startTime: parsed.startTime || null,
    endDate: parsed.date || null,
    endTime: parsed.endTime || "24:00",
  };

  await db.insert(tasks).values(taskData).returning();

  let confirmMsg = `✅ 已加 task！\n\n📝 ${parsed.name}`;
  if (parsed.date) {
    const parts = parsed.date.split("-");
    confirmMsg += `\n📅 ${parts[1]}月${parts[2]}日`;
  } else {
    confirmMsg += `\n📌 Notes（無日期）`;
  }
  if (parsed.startTime) {
    confirmMsg += `\n⏰ ${parsed.startTime}`;
  }
  if (parsed.description) {
    confirmMsg += `\n📋 ${parsed.description}`;
  }

  await replyMessage(replyToken, confirmMsg);
}

async function handleCheckTasks(user, replyToken, text) {
  const todayStr2 = userToday(user);
  const userTasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.uid, user.id), eq(tasks.done, false)));

  const todayTasks = userTasks.filter((t) => t.date === todayStr2);
  const otherTasks = userTasks.filter((t) => t.date !== todayStr2 && t.date !== "notes");
  const noteTasks = userTasks.filter((t) => t.date === "notes");

  let msg = `📋 ${user.name} 嘅 Tasks\n`;

  if (todayTasks.length > 0) {
    msg += `\n── 今日 ──\n`;
    todayTasks
      .sort((a, b) => (a.startTime || "99:99").localeCompare(b.startTime || "99:99"))
      .forEach((t) => {
        msg += `${t.startTime ? `⏰ ${t.startTime} ` : "• "}${t.name}\n`;
      });
  } else {
    msg += `\n今日暫時無 task 🎉\n`;
  }

  if (otherTasks.length > 0) {
    msg += `\n── 之後 ──\n`;
    otherTasks
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
      .slice(0, 10)
      .forEach((t) => {
        const parts = t.date?.split("-");
        const dateLabel = parts ? `${parts[1]}/${parts[2]}` : "";
        msg += `📅 ${dateLabel} ${t.startTime ? t.startTime + " " : ""}${t.name}\n`;
      });
    if (otherTasks.length > 10) {
      msg += `...仲有 ${otherTasks.length - 10} 個\n`;
    }
  }

  if (noteTasks.length > 0) {
    msg += `\n── Notes ──\n`;
    noteTasks.slice(0, 5).forEach((t) => {
      msg += `📌 ${t.name}\n`;
    });
    if (noteTasks.length > 5) {
      msg += `...仲有 ${noteTasks.length - 5} 個\n`;
    }
  }

  const total = userTasks.length;
  msg += `\n共 ${total} 個未完成 task`;

  await replyMessage(replyToken, msg);
}

async function handleAddJournalFromLine(user, replyToken, text) {
  const body = (text || "").trim();
  if (!body) return;
  try {
    await db.insert(journalEntries).values({
      uid: user.id,
      body: body.slice(0, 2000),
      date: userToday(user),
      source: "line",
    });
    const d = getUserNow(user);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    await replyMessage(replyToken, `🪶 已記低 [${hh}:${mm}]\n${body.length > 60 ? body.slice(0, 60) + "…" : body}\n\n打「reflect」叫我回顧今日，打「muse」返回一般模式。`);
  } catch (e) {
    console.error("Journal add error:", e.message);
    await replyMessage(replyToken, "⚠️ 儲存失敗，請稍後再試。");
  }
}

async function handleAddMemo(user, replyToken, text) {
  let content = text;
  const prefixes = ["memo:", "memo：", "筆記:", "筆記：", "記住:", "記住：", "note:", "note："];
  for (const prefix of prefixes) {
    if (text.toLowerCase().startsWith(prefix)) {
      content = text.slice(prefix.length).trim();
      break;
    }
  }

  const title =
    content.length > 40 ? content.substring(0, 40) + "..." : content;

  await db.insert(memos).values({
    uid: user.id,
    title,
    content,
    date: userToday(user),
    color: "white",
    noteType: "fleeting",
  });

  // Generic LINE memo capture intentionally does NOT auto-fire wiki Ingest
  // (out of scope for #164 — only food/expense/medicine LINE logs are
  // auto-ingested behind the wikiAutoIngestLineLog toggle).

  await replyMessage(
    replyToken,
    `📝 已儲存 memo！\n\n${title}\n\n💡 已標記為 Fleeting Note`
  );
}

async function parseExpenseWithAI(message, user) {
  const today = getUserNow(user);
  const todayStr2 = userToday(user);
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You parse expense/spending messages into structured data. Today is ${todayStr2} (${dayNames[today.getDay()]}).
Return ONLY valid JSON:
{
  "store": "store/restaurant name or description (e.g. 'lunch', 'dinner', 'taxi')",
  "date": "YYYY-M-D format date, default today ${todayStr2}",
  "currency": "HKD",
  "items": [{"name": "item description", "price": number}],
  "total": number (sum of all items, or the total amount mentioned),
  "notes": "any extra details or null",
  "category": "food|grocery|transport|shopping|entertainment|health|bills|telecom|other"
}

Date parsing:
- "今日"/"今天" = ${todayStr2}
- "昨天"/"尋日" = yesterday
- "4月13日"/"4月13號" = ${today.getFullYear()}-4-13
- If no date mentioned, use ${todayStr2}

Amount parsing:
- "133" or "133蚊" or "$133" = 133
- "食左133" = total 133
- Parse Chinese/Cantonese numbers

The user may write like "記帳 4月13日 lunch食左133" meaning: spent 133 on lunch on April 13.
Strip any prefix like "記帳", "記賬", "expense" before parsing.`,
        },
        { role: "user", content: message },
      ],
      temperature: 0,
      max_tokens: 300,
    });

    const text = response.choices[0]?.message?.content?.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (err) {
    console.error("LINE expense parse error:", err.message);
    return null;
  }
}

async function parseExpenseEditWithAI(message, currentExpense, user) {
  const today = getUserNow(user);
  const todayStr = userToday(user);
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You parse short edit instructions for the user's MOST RECENT expense entry. Today is ${todayStr}.
Current expense: ${JSON.stringify(currentExpense)}.

The user replies in Cantonese / Mandarin / English to amend it. Examples:
- "改做 65" / "改成65" / "改 65蚊" => {"total": 65}
- "改去 grocery" / "改類別 grocery" / "歸類做 食" => {"category": "grocery"}
- "改店 starbucks" / "改成 starbucks" / "改商戶 麥當勞" => {"store": "starbucks"}
- "改成 lunch 80" / "改做 dinner $120" => {"store": "dinner", "total": 120}
- "改日期 4月10號" / "改去尋日" => {"date": "${today.getFullYear()}-4-10" or yesterday in YYYY-M-D}
- "改 notes 同同事食" => {"notes": "同同事食"}

Return ONLY valid JSON. Include only fields the user actually wants to change.
Allowed fields:
- "store" (string)
- "total" (number, the new amount)
- "date" (YYYY-M-D, today=${todayStr}, parse 尋日/昨天=yesterday, 4月10號=${today.getFullYear()}-4-10)
- "category" (one of food|grocery|transport|shopping|entertainment|health|bills|telecom|other)
- "notes" (string)

If the message contains a bare number ("65") with no other context, treat it as {"total": 65}.
If you cannot tell what to update, return {}.`,
        },
        { role: "user", content: message },
      ],
      temperature: 0,
      max_tokens: 150,
    });
    const text = response.choices[0]?.message?.content?.trim();
    const m = text?.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    return null;
  } catch (e) {
    console.error("LINE expense edit parse error:", e.message);
    return null;
  }
}

async function handleAddExpense(user, replyToken, text, lineUserId) {
  const parsed = await parseExpenseWithAI(text, user);

  if (!parsed) {
    await replyMessage(replyToken, "唔好意思，我理解唔到記帳內容 🤔\n\n試下咁寫：\n• 記帳 lunch 133\n• 記帳 4月13日 lunch食左133\n• 記帳 uber 45蚊");
    return;
  }

  if (!parsed.total || Number(parsed.total) <= 0) {
    if (lineUserId) {
      pendingExpenses.set(lineUserId, {
        parsed,
        originalText: text,
        savedAt: Date.now(),
      });
    }
    const vendor = parsed.store || "嗰次消費";
    let askMsg = `🤔 我見到你提到「${vendor}」，但未見到金額。\n\n`;
    askMsg += `用咗幾錢？回覆數字就會幫你記低，例如：\n• 80\n• 80蚊\n• $80\n\n`;
    askMsg += `如果唔想記帳，輸入「唔使」就算。`;
    await replyMessage(replyToken, askMsg);
    return;
  }

  if (lineUserId) pendingExpenses.delete(lineUserId);

  const dateStr = parsed.date || userToday(user);

  try {
    const insertedExpense = await db.insert(expenses).values({
      uid: user.id,
      store: parsed.store || "",
      date: dateStr,
      currency: parsed.currency || "HKD",
      total: String(parsed.total || 0),
      items: JSON.stringify(parsed.items || []),
      notes: parsed.notes || "",
      category: normalizeCategory(parsed.category, parsed.store, parsed.items),
      source: "line",
    }).returning({ id: expenses.id });
    try {
      await sendPushToUser(user.id, {
        title: "💰 已記帳",
        body: `${parsed.store || "支出"} ${parsed.currency || "HKD"}${parsed.total || 0}`,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { type: "expense-added", source: "line", expenseId: insertedExpense?.[0]?.id, date: dateStr },
      });
    } catch (e) {
      console.error("Failed to send expense push:", e.message);
    }

    const normalizedCat = normalizeCategory(parsed.category, parsed.store, parsed.items);
    rememberLastExpense(lineUserId, insertedExpense?.[0]?.id, {
      store: parsed.store || "",
      total: Number(parsed.total) || 0,
      currency: parsed.currency || "HKD",
      date: dateStr,
      category: normalizedCat,
      notes: parsed.notes || "",
      items: parsed.items || [],
    });

    const itemLines = (parsed.items || []).map(i => `  • ${i.name}  ${parsed.currency || ""}${i.price}`).join("\n");
    let confirmMsg = `💰 已記帳！\n\n🏪 ${parsed.store || "N/A"}`;
    confirmMsg += `\n💵 ${parsed.currency || "HKD"}${parsed.total}`;
    if (itemLines) confirmMsg += `\n${itemLines}`;
    const parts = dateStr.split("-");
    confirmMsg += `\n📅 ${parts[1]}月${parts[2]}日`;
    if (parsed.category) confirmMsg += `\n🏷 ${formatCategoryForLine(parsed.category)}`;
    confirmMsg += `\n\n已儲存到記帳簿 ✅\n\n💡 5 分鐘內可回覆「改做 65」、「改去 grocery」或「唔記啦」嚟修改 / 取消。`;
    await replyMessage(replyToken, confirmMsg);
    try {
      const { enqueueAutoIngest } = await import("./wikiAutoIngest.js");
      enqueueAutoIngest({
        uid: user.id, trigger: "line-expense",
        input: `LINE expense (${dateStr}): ${parsed.store || ""} ${parsed.currency || "HKD"}${parsed.total} cat=${normalizedCat}${parsed.notes ? `\nNotes: ${parsed.notes}` : ""}`,
      });
    } catch {}
  } catch (e) {
    console.error("Failed to save expense:", e.message);
    await replyMessage(replyToken, "⚠️ 記帳儲存失敗，請稍後再試。");
  }
}

async function parseStepsWithAI(message, user) {
  const today = getUserNow(user);
  const todayStr2 = userToday(user);
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You parse step/walking/exercise messages into structured data. Today is ${todayStr2} (${dayNames[today.getDay()]}).
Return ONLY valid JSON:
{
  "date": "YYYY-MM-DD format, default today ${todayStr2.replace(/-/g, '-')}",
  "steps": number or null (step count),
  "distance": "distance in km as string e.g. '5.2' or null",
  "calories": number or null,
  "walkTime": "walk time as string e.g. '1h 30m' or '45m' or null",
  "remarks": "any extra notes or null"
}

Date parsing:
- "今日"/"今天" = today
- "昨天"/"尋日" = yesterday  
- Specific dates like "4月13日" = ${today.getFullYear()}-04-13

Number parsing:
- "8000步" = 8000 steps
- "一萬步" = 10000 steps
- "5公里"/"5km" = distance "5.0"
- "行左45分鐘" = walkTime "45m"

Format the date as YYYY-MM-DD (with zero padding).`,
        },
        { role: "user", content: message },
      ],
      temperature: 0,
      max_tokens: 200,
    });

    const text = response.choices[0]?.message?.content?.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return null;
  } catch (err) {
    console.error("LINE steps parse error:", err.message);
    return null;
  }
}

async function handleAddSteps(user, replyToken, text) {
  const parsed = await parseStepsWithAI(text, user);
  if (!parsed || (!parsed.steps && !parsed.distance)) {
    await replyMessage(replyToken, "唔好意思，我理解唔到步數 🤔\n\n試下咁寫：\n• 今日行左8000步\n• steps 12000\n• 步數 6500 5.2km\n• 行左45分鐘 3km");
    return;
  }

  const dateStr = parsed.date || userTodayPadded(user);

  try {
    const insertedSteps = await db.insert(steps).values({
      uid: user.id,
      date: dateStr,
      steps: parsed.steps || 0,
      distance: parsed.distance || null,
      calories: parsed.calories || null,
      walkTime: parsed.walkTime || null,
      remarks: parsed.remarks || null,
      source: "line",
    }).returning({ id: steps.id });
    try {
      await sendPushToUser(user.id, {
        title: "🚶 步數已記錄",
        body: `${(parsed.steps || 0).toLocaleString()} 步`,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { type: "steps-added", source: "line", stepsId: insertedSteps?.[0]?.id, date: dateStr },
      });
    } catch (e) {
      console.error("Failed to send steps push:", e.message);
    }

    let level = "🔴 Low";
    const s = parsed.steps || 0;
    if (s >= 10000) level = "🟢 Excellent";
    else if (s >= 7500) level = "🟢 Active";
    else if (s >= 5000) level = "🟡 Moderate";
    else if (s >= 2500) level = "🟠 Light";

    let confirmMsg = `🚶 步數已記錄！\n\n👟 ${(parsed.steps || 0).toLocaleString()} 步`;
    if (parsed.distance) confirmMsg += `\n📏 ${parsed.distance} km`;
    if (parsed.calories) confirmMsg += `\n🔥 ${parsed.calories} cal`;
    if (parsed.walkTime) confirmMsg += `\n⏱ ${parsed.walkTime}`;
    confirmMsg += `\n📊 ${level}`;
    const parts = dateStr.split("-");
    confirmMsg += `\n📅 ${parts[1]}月${parts[2]}日`;
    if (parsed.remarks) confirmMsg += `\n📝 ${parsed.remarks}`;
    confirmMsg += `\n\n已儲存到健康記錄 ✅`;

    await replyMessage(replyToken, confirmMsg);
  } catch (e) {
    console.error("Failed to save steps:", e.message);
    await replyMessage(replyToken, "⚠️ 步數儲存失敗，請稍後再試。");
  }
}

async function parseMedicineWithAI(message, user) {
  const today = getUserNow(user);
  const todayStr2 = userToday(user);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You parse symptom/medicine messages into structured data. Today is ${todayStr2}.
Return ONLY valid JSON:
{
  "date": "YYYY-MM-DD format, default today",
  "time": "HH:MM or null",
  "symptom": "the symptom in original language (e.g. 頭痛, 肚痛, 發燒)",
  "medicine": "medicine name or null",
  "dosage": "dosage info or null",
  "severity": number 1-5 (1=slight, 3=moderate, 5=severe), default 3,
  "notes": "any extra notes or null"
}

Symptom mapping:
- 頭痛/headache → 頭痛
- 肚痛/stomach → 肚痛
- 發燒/fever → 發燒
- 喉嚨痛/sore throat → 喉嚨痛
- 流鼻水/runny nose → 流鼻水
- 咳嗽/cough → 咳嗽
- 暈/dizzy → 暈眩
- 失眠/insomnia → 失眠
- Use the user's original Chinese term when possible

Format the date as YYYY-MM-DD (with zero padding).`,
        },
        { role: "user", content: message },
      ],
      temperature: 0,
      max_tokens: 200,
    });

    const text = response.choices[0]?.message?.content?.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return null;
  } catch (err) {
    console.error("LINE medicine parse error:", err.message);
    return null;
  }
}

async function handleAddMedicine(user, replyToken, text) {
  const parsed = await parseMedicineWithAI(text, user);
  if (!parsed || !parsed.symptom) {
    await replyMessage(replyToken, "唔好意思，我理解唔到症狀 🤔\n\n試下咁寫：\n• 頭痛食左panadol\n• 肚痛\n• 發燒 38度\n• 食咗止痛藥 500mg");
    return;
  }

  const dateStr = parsed.date || userTodayPadded(user);
  const sev = parsed.severity != null ? Math.min(5, Math.max(1, parseInt(parsed.severity) || 3)) : 3;

  try {
    const insertedMed = await db.insert(medicineLog).values({
      uid: user.id,
      date: dateStr,
      time: parsed.time || null,
      symptom: parsed.symptom,
      medicine: parsed.medicine || null,
      dosage: parsed.dosage || null,
      severity: sev,
      notes: parsed.notes || null,
    }).returning({ id: medicineLog.id });
    try {
      await sendPushToUser(user.id, {
        title: "💊 症狀已記錄",
        body: `${parsed.symptom}${parsed.medicine ? ` · ${parsed.medicine}` : ""}`,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { type: "medicine-added", source: "line", medicineId: insertedMed?.[0]?.id, date: dateStr },
      });
    } catch (e) {
      console.error("Failed to send medicine push:", e.message);
    }

    const sevLabels = { 1: "輕微", 2: "偏輕", 3: "中等", 4: "較重", 5: "嚴重" };
    let confirmMsg = `💊 症狀已記錄！\n\n🤒 ${parsed.symptom}`;
    confirmMsg += `\n📊 嚴重度：${"●".repeat(sev)}${"○".repeat(5-sev)} (${sevLabels[sev]})`;
    if (parsed.medicine) confirmMsg += `\n💊 ${parsed.medicine}`;
    if (parsed.dosage) confirmMsg += ` (${parsed.dosage})`;
    if (parsed.time) confirmMsg += `\n⏰ ${parsed.time}`;
    const parts = dateStr.split("-");
    confirmMsg += `\n📅 ${parts[1]}月${parts[2]}日`;
    if (parsed.notes) confirmMsg += `\n📝 ${parsed.notes}`;
    confirmMsg += `\n\n已儲存到健康記錄 ✅`;

    await replyMessage(replyToken, confirmMsg);
    try {
      const { enqueueAutoIngest } = await import("./wikiAutoIngest.js");
      enqueueAutoIngest({
        uid: user.id, trigger: "line-medicine",
        input: `LINE health log (${dateStr}): symptom=${parsed.symptom} severity=${sev}${parsed.medicine ? ` medicine=${parsed.medicine}` : ""}${parsed.dosage ? ` dosage=${parsed.dosage}` : ""}${parsed.notes ? `\nNotes: ${parsed.notes}` : ""}`,
      });
    } catch {}
  } catch (e) {
    console.error("Failed to save medicine:", e.message);
    await replyMessage(replyToken, "⚠️ 症狀儲存失敗，請稍後再試。");
  }
}

async function parseFoodWithAI(message, goalCtx = null, user = null) {
  const today = getUserNow(user);
  const todayStr = userToday(user);
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const goalBlock = formatGoalsForPrompt(goalCtx);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You parse a Cantonese/English meal description into a structured food log entry. Today is ${todayStr} (${dayNames[today.getDay()]}).
Return ONLY valid JSON in this shape:
{"items":[{"name":"food name (Chinese preferred, e.g. 鮮蝦雲吞、叉燒飯、珍珠奶茶)","portion":"portion description e.g. '1 碗', '1 杯', '中份' or null","calories":number}],"totalCalories":number,"mealType":"breakfast|lunch|dinner|snack|unknown","date":"YYYY-MM-DD","time":"HH:MM or null","healthScore":number,"suggestion":"短小精準的飲食建議 in Cantonese (廣東話)"}

Rules:
- Identify each food/drink item the user describes. Estimate calories (rough is fine) and sum into totalCalories.
- mealType from cues: 早餐/breakfast, 午餐/lunch, 晚餐/晚飯/dinner, 宵夜/snack/小食. If unclear use "unknown".
- date: parse Chinese/English relative dates. "今日/今天/今朝/今早" = ${todayStr}. "昨日/昨晚/尋日/yesterday" = day before. "前日/前天" = 2 days before. Specific dates like "4月17日" → ${today.getFullYear()}-04-17. If no date mentioned, use ${todayStr}. Always return zero-padded YYYY-MM-DD.
- time: if user mentions a time (e.g. "8點", "晚上7點", "lunch"), give HH:MM, else null.

⚠️ 用戶健康背景（評分同建議時必須考慮）：
  • 用戶本人：高血壓（Hypertension）、甲狀腺病（Thyroid disease）
  • 父親：大腸癌（Colorectal cancer）— 屬大腸癌高風險家族史
  • 母親：糖尿病（Diabetes）— 屬糖尿病高風險家族史

- healthScore (1-10, 10=最啱呢位用戶, 1=最唔啱)：除咗一般健康因素（蔬菜、油炸、份量），亦要因應用戶背景扣分：
    • 高鈉/高鹽/醃製/加工肉（午餐肉、香腸、火腿、即食麵、罐頭湯、豉油重食物）→ 高血壓扣分
    • 紅肉、燒烤、加工肉（腸仔、煙肉、午餐肉）→ 大腸癌風險扣分
    • 缺乏纖維/蔬菜/全穀 → 大腸癌風險扣分
    • 高糖/高升糖（白飯多、含糖飲品、甜品、果汁、糖水）→ 糖尿病風險扣分
    • 含碘極高食物（大量紫菜、海帶、海鮮）或十字花科生食過量 → 甲狀腺要留意
    • 蔬菜豐富、全穀、瘦蛋白、低鈉、無糖 → 加分

- suggestion: 用廣東話寫 2-4 句即時建議，必須針對用戶背景。例子：
    • 「鮮蝦雲吞湯底偏鹹，你血壓偏高就試下唔好飲哂啲湯。下次可以加碟灼菜補纖維。」
    • 「白飯偏多容易升血糖，媽媽有糖尿你都要留意。可以轉糙米或加多啲菜，飯量減半。」
    • 「燒味屬加工紅肉，爸爸有大腸癌史建議每週唔好過 1-2 次，多食西蘭花、麥皮補纖維。」
  唔好長篇大論，唔好重覆免責聲明，亦唔好每次都列哂三個病——只講同眼前食物最相關嗰個。${goalBlock}`,
        },
        { role: "user", content: message },
      ],
      temperature: 0,
      max_tokens: 500,
    });

    const text = response.choices[0]?.message?.content?.trim();
    const jsonMatch = text?.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (err) {
    console.error("LINE food parse error:", err.message);
    return null;
  }
}

async function parseFoodEditWithAI(message, currentFood, user) {
  const today = getUserNow(user);
  const todayStr = userToday(user);
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You parse short edit instructions for the user's MOST RECENT food log entry. Today is ${todayStr}.
Current food entry: ${JSON.stringify(currentFood)}.

The user replies in Cantonese / Mandarin / English to amend it. Examples:
- "改做 叉燒飯" / "改名 牛肉麵" / "改成 sushi" => {"name": "叉燒飯"}
- "改卡 650" / "改做 600 kcal" / "改卡路里 720" => {"totalCalories": 650}
- "改做 lunch" / "改成 dinner" / "改 早餐" => {"mealType": "lunch"}
- "改日期 4月10號" / "改去尋日" => {"date": "${today.getFullYear()}-04-10" or yesterday in YYYY-MM-DD}
- "改時間 13:30" / "改做 8:00" => {"time": "13:30"}
- "改做 叉燒飯 700" / "改成 sushi 550 kcal" => {"name": "叉燒飯", "totalCalories": 700}
- "650" / "650 kcal" / "650卡" (bare number reply) => {"totalCalories": 650}

Return ONLY valid JSON. Include only fields the user actually wants to change.
Allowed fields:
- "name" (string, the new food/meal name)
- "totalCalories" (number, the new kcal amount)
- "mealType" (one of breakfast|lunch|dinner|snack|unknown)
- "date" (YYYY-MM-DD, today=${todayStr}, parse 尋日/昨天=yesterday, 4月10號=${today.getFullYear()}-04-10, always zero-padded)
- "time" (HH:MM, 24h)

If the message contains a bare number ("650") with no other context, treat it as {"totalCalories": 650}.
If you cannot tell what to update, return {}.`,
        },
        { role: "user", content: message },
      ],
      temperature: 0,
      max_tokens: 150,
    });
    const text = response.choices[0]?.message?.content?.trim();
    const m = text?.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    return null;
  } catch (e) {
    console.error("LINE food edit parse error:", e.message);
    return null;
  }
}

async function handleFoodSummary(user, replyToken) {
  const today = userToday(user);
  const totals = await getTodayMacroTotals(user.id, today);
  const goalCtx = buildGoalContext(user, totals);
  const parts = [];
  parts.push(`🍽️ 今日飲食總結`);
  if (totals.calories > 0 || totals.protein > 0 || totals.carbs > 0 || totals.fat > 0 || totals.sodium > 0) {
    const macroLine = formatMacroSummary(totals);
    parts.push(`今日合共 ${Math.round(totals.calories)} kcal${macroLine ? `\n${macroLine}` : ""}`);
  } else {
    parts.push("今日仲未記錄到任何嘢食 😌");
  }
  let reply = parts.join("\n\n");
  const goalBlock = formatGoalSummaryForReply(goalCtx);
  if (goalBlock) {
    reply += goalBlock;
  } else if (!user.proteinGoal && !user.carbsGoal && !user.fatGoal && !user.sodiumGoal) {
    reply += `\n\n💡 仲未設目標？喺 app 入面設好蛋白質／碳水／脂肪／鈉目標，之後 Muse 可以幫你追進度。`;
  }
  await replyMessage(replyToken, reply);
}

async function handleAddFood(user, replyToken, text, lineUserId) {
  const todayForGoals = userToday(user);
  const todayTotalsForGoals = await getTodayMacroTotals(user.id, todayForGoals);
  const goalCtx = buildGoalContext(user, todayTotalsForGoals);
  const parsed = await parseFoodWithAI(text, goalCtx, user);
  const foodItems = Array.isArray(parsed?.items) ? parsed.items : [];
  if (!parsed || foodItems.length === 0) {
    await replyMessage(replyToken, "唔好意思，我理解唔到食咗咩 🤔\n\n試下咁寫：\n• 晚餐食咗一碗鮮蝦雲吞\n• lunch 食左叉燒飯\n• 今朝食咗多士同奶茶\n• snack: 一杯珍珠奶茶");
    return;
  }

  const now = getUserNow(user);
  const todayDate = userTodayPadded(user);
  let foodDate = todayDate;
  const rawDate = (parsed.date || "").toString().trim();
  const dm = rawDate.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (dm) {
    foodDate = `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`;
  }
  const foodTime = (parsed.time && /^\d{1,2}:\d{2}$/.test(parsed.time))
    ? parsed.time.padStart(5, "0")
    : `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const enrichedResult = await enrichItems(foodItems);
  const enrichedItems = enrichedResult.items;
  const totalCal = enrichedResult.totalCalories || parseInt(parsed.totalCalories) ||
    enrichedItems.reduce((sum, it) => sum + (parseInt(it.calories) || 0), 0);
  const mealType = ["breakfast", "lunch", "dinner", "snack", "unknown"].includes(parsed.mealType) ? parsed.mealType : "unknown";
  const aiTotal = parseInt(parsed.totalCalories) || 0;
  const aiHealthScore = Math.max(0, Math.min(10, parseInt(parsed.healthScore) || 0));
  const healthScore = adjustHealthScoreForCalories(aiHealthScore, aiTotal, totalCal);
  const suggestion = (parsed.suggestion || "").toString().trim();

  const mealLabels = {
    breakfast: "🌅 早餐",
    lunch: "☀️ 午餐",
    dinner: "🌙 晚餐",
    snack: "🍪 小食",
    unknown: "🍽️ 餐點",
  };
  const mealLabel = mealLabels[mealType];

  let foodSaved = false;
  try {
    const inserted = await db.insert(foodLog).values({
      uid: user.id,
      date: foodDate,
      time: foodTime,
      items: JSON.stringify(enrichedItems),
      totalCalories: totalCal,
      mealType,
      suggestion,
      healthScore,
      source: "line",
    }).returning({ id: foodLog.id });
    foodSaved = inserted && inserted.length > 0;
    if (foodSaved) {
      try {
        await sendPushToUser(user.id, {
          title: "🍽️ 食物已記錄",
          body: `${mealLabel} ~ ${totalCal} kcal`,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          data: { type: "food-added", source: "line", foodId: inserted[0].id, date: foodDate },
        });
      } catch (e) {
        console.error("Failed to send food push:", e.message);
      }
      rememberLastFoodLog(lineUserId, inserted[0].id, {
        items: enrichedItems,
        totalCalories: totalCal,
        mealType,
        date: foodDate,
        time: foodTime,
        suggestion,
        healthScore,
      });
    }
  } catch (e) {
    console.error("Failed to save food log:", e.message);
  }

  const itemLines = enrichedItems
    .map((it) => `${sourceEmoji(it.source)} ${it.name || "?"}${it.portion ? `（${it.portion}）` : ""} ~ ${it.calories || 0} kcal`)
    .join("\n");
  const memoTitle = `🍽️ ${mealLabel} ${totalCal} kcal (${foodDate} ${foodTime})`;
  const memoContent = `${mealLabel}\n日期：${foodDate} ${foodTime}\n\n${itemLines}\n\n總卡路里：約 ${totalCal} kcal${suggestion ? `\n\n💡 ${suggestion}` : ""}${sourcesFooter(enrichedItems)}`;

  try {
    await db.insert(memos).values({
      uid: user.id,
      title: memoTitle,
      content: memoContent,
      color: "orange",
      noteType: "fleeting",
    });
  } catch (e) {
    console.error("Failed to save food memo:", e.message);
  }

  try {
    const { enqueueAutoIngest } = await import("./wikiAutoIngest.js");
    enqueueAutoIngest({ uid: user.id, trigger: "line-food", input: `LINE food log: ${memoTitle}\n\n${memoContent}` });
  } catch {}

  const scoreEmoji = healthScore >= 8 ? "🟢" : healthScore >= 5 ? "🟡" : healthScore > 0 ? "🔴" : "⚪";
  const scoreLine = healthScore > 0 ? `\n${scoreEmoji} 健康評分：${healthScore}/10` : "";

  let replyMsg = `🍽️ 食物已記錄！\n\n${mealLabel}\n`;
  enrichedItems.forEach((it) => {
    replyMsg += `\n${sourceEmoji(it.source)} ${it.name || "?"}${it.portion ? `（${it.portion}）` : ""} ~ ${it.calories || 0} kcal`;
  });
  replyMsg += `\n\n🔥 總卡路里：約 ${totalCal} kcal${scoreLine}`;
  {
    const macroLine = formatMacroSummary(enrichedItems);
    if (macroLine) replyMsg += `\n📊 ${macroLine}`;
  }
  replyMsg += `\n📅 ${foodDate} ${foodTime}${sourcesFooter(enrichedItems)}`;
  if (suggestion) {
    replyMsg += `\n\n💡 飲食建議：\n${suggestion}`;
  }
  if (foodSaved) {
    replyMsg += formatGoalCoachingForReply(goalCtx, sumMacros(enrichedItems));
  }
  replyMsg += foodSaved ? `\n\n已儲存到飲食記錄 ✅` : `\n\n⚠️ 儲存失敗，請於 app 內檢查`;
  if (foodSaved) {
    replyMsg += `\n\n💡 5 分鐘內可回覆「改名 叉燒飯」、「改卡 650」、「改做 dinner」、「改日期 尋日」或「唔記啦」嚟修改 / 取消。`;
  }

  await replyMessage(replyToken, replyMsg);
}

function getSkillSystemPrompt(skill, user, todayStr2, todayTasks, allTasks) {
  const taskSummary =
    todayTasks.length > 0
      ? todayTasks
          .sort((a, b) => (a.startTime || "99:99").localeCompare(b.startTime || "99:99"))
          .map((t) => `- ${t.startTime ? t.startTime + " " : ""}${t.name}`)
          .join("\n")
      : "No tasks today";
  const allTasksList = allTasks
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .slice(0, 30)
    .map((t) => `- [${t.date || "notes"}] ${t.startTime ? t.startTime + " " : ""}${t.name}`)
    .join("\n");

  const lineRules = `\n\nIMPORTANT LINE Bot rules:
- Keep replies under 800 characters (LINE messages should be concise)
- Reply in the same language the user uses (usually Cantonese/Chinese)
- Be natural and conversational
- Use emoji sparingly for visual clarity`;

  switch (skill) {
    case "analytics":
      return `You are Muse in ANALYTICS mode for "${user.name}". Analyze productivity and task patterns.

Today: ${todayStr2}
Tasks today:\n${taskSummary}
Total pending: ${allTasks.length}
All tasks:\n${allTasksList}

Provide data-driven insights about workload, time allocation, and productivity. Give specific numbers and actionable advice.${lineRules}`;

    case "writer":
      return `You are Muse in WRITER mode for "${user.name}". Help write, edit, and organize text.

Today: ${todayStr2}

Help with: drafting memos/emails, summarizing, expanding bullet points, proofreading, translating, creating outlines. Match the user's tone and be articulate.${lineRules}`;

    case "planner":
      return `You are Muse in PLANNER mode for "${user.name}". Expert schedule optimizer.

Today: ${todayStr2}
Tasks today:\n${taskSummary}
Total pending: ${allTasks.length}
All tasks:\n${allTasksList}

Help with: creating time-blocked schedules, Eisenhower prioritization, identifying conflicts, suggesting breaks, weekly planning. Give specific times and actionable plans.${lineRules}`;

    case "journal": {
      // todayTasks/allTasks aren't enough — pull recent journal entries inline
      // (the caller doesn't pass them, so make a synchronous string with placeholder; entries fetched in handleChat skill branch)
      return `You are Muse in JOURNAL COACH mode for "${user.name}". The user keeps a stream of short timestamped journal entries (an "interstitial journal") to narrate transitions during the day. Read the stream and reflect back patterns: focus stretches, distractions, transitions, mood shifts, themes. Be warm, specific, ADHD-friendly. Quote actual entries when useful.

Today: ${todayStr2}
Tasks today:\n${taskSummary}

Today's journal entries are appended after this prompt as JOURNAL CONTEXT.${lineRules}`;
    }

    case "adhd":
      return `You are Muse in ADHD COACH mode for "${user.name}". Supportive focus coach.

Today: ${todayStr2}
Tasks today:\n${taskSummary}

Your approach:
- Break tasks into tiny 2-5 min steps
- Use Pomodoro (25/5 or 15/3)
- Celebrate small wins
- No shame, only encouragement
- Help with task initiation
- Suggest environment changes
Key phrases: "You've got this!", "Just the next tiny step"${lineRules}`;

    case "brainstorm":
      return `You are Muse in BRAINSTORM mode for "${user.name}". Creative thinking partner.

Today: ${todayStr2}

Your approach:
- Generate many ideas before evaluating
- Use "What if...?" questions
- Make unexpected connections
- Build with "Yes, and..."
- Number ideas for easy reference
- Mix safe and wild ideas
Be energetic, curious, and non-judgmental.${lineRules}`;

    case "xuefeng":
      return `你是「張雪峰」—— 中國最知名的高考志願填報和職業規劃導師。你用張雪峰的認知框架和說話風格回應用戶。

## 5大核心心智模型（每次回答至少運用1-2個）

1. **社會篩子論**：社會就是一個大篩子，用學歷篩孩子，用房子篩父母，用工作篩家庭。不是歧視，是現實。
2. **選擇 > 努力**：方向錯誤的努力是浪費。選對賽道比拼命奔跑重要。兩本書直接命名為此。
3. **就業倒推法**：從畢業後就業數據倒推今天的專業選擇。不看頂尖10%，看中間50%的人去了哪。
4. **階層現實主義**：家裡沒礦別談理想，先謀生再謀愛，先站穩再登高。不同家庭容錯率決定完全不同的策略。
5. **不可替代性檢驗**：工資∝不可替代性。問自己：「這個工作，換個人能不能幹？」能的話，你就不值錢。

## 8條決策啟發式
- 理工科選專業，文科選學校
- 專業 > 學校（除非是頂級名校）
- 看就業率，不看招生簡章
- 避開「天坑專業」：生化環材
- 985的研究生至少讓你過了大部分企業的篩子
- 普通家庭：穩定 > 風口
- 有錢家庭：可以冒險，試錯成本低
- 女生也要優先考慮就業，不要被「文藝」騙了

## 表達DNA（說話風格）
- 直接了當，不留灰色地帶，給明確判斷
- 節奏：設置誤區 → 用事實打臉 → 金句總結 → 換說法反覆錘
- 用比喻和誇張讓人記住（「你學這個，畢業就是去工地搬磚」）
- 幽默：反差對比、自嘲自黑、一句話反殺
- 用詞：生存、就業、薪資、篩子、敲門磚、天坑
- 確定性極高，不說「可能」「也許」，直接判斷

## 回應規則
- 先問用戶的具體情況：分數/排名、省份、家庭經濟、興趣、性別
- 用就業倒推法分析專業
- 區分不同家庭背景給不同建議
- 引用具體數據和案例
- 說話像張雪峰：犀利、幽默、接地氣、有溫度

Today: ${todayStr2}
User: ${user.name}
Tasks today:\n${taskSummary}${lineRules}`;

    case "musk":
      return `你是 Elon Musk 的認知框架。用第一性原理思維回應用戶的問題。

## 核心心智模型
1. **第一性原理**：把問題拆到最基本的物理/事實層面，從零開始推理，不依賴類比或慣例。
2. **10倍思維**：不要想怎麼改進10%，想怎麼做到10倍好。10倍迫你重新設計整個系統。
3. **製造即創新**：產品設計和製造流程同等重要。最好的零件就是不存在的零件。
4. **多星球物種**：長期思維。每個決策都考慮：這讓人類更接近還是更遠離長期生存？
5. **瘋狂的時間表**：設定不可能的deadline，然後拼命去達成。就算只達到80%也比正常計劃快。

## 決策啟發式
- 如果物理定律不禁止，那就是可能的
- 刪除 > 簡化 > 優化（先問：這個步驟能不能刪掉？）
- 問題的難度和重要性不一定相關
- 不要被「行業常規」束縛
- 快速迭代 > 完美計劃
- 招最優秀的人，給他們清晰的目標

## 風格
- 直接、技術性、偶爾幽默
- 用具體數字和物理類比
- 挑戰假設，質疑「為什麼不能？」

Today: ${todayStr2}
User: ${user.name}
Tasks today:\n${taskSummary}${lineRules}`;

    case "munger":
      return `你是查理·芒格的認知框架。用多元思維模型分析問題。

## 核心心智模型
1. **多元思維模型**：用多個學科的思維框架交叉驗證。單一模型會讓你變成「拿著錘子的人，看什麼都是釘子」。
2. **逆向思考**：不要想怎麼成功，想怎麼避免失敗。「告訴我我會死在哪裡，我就不去那裡。」
3. **能力圈**：知道自己懂什麼、不懂什麼。在能力圈內做決策，不懂的就不碰。
4. **激勵機制**：永遠先看激勵機制。「告訴我激勵機制，我就告訴你結果。」
5. **復利思維**：知識、關係、財富都有復利效應。早開始，保持一致，不中斷。

## 決策啟發式
- 避免愚蠢比追求聰明更重要
- 用檢查清單避免常見錯誤
- 等待「肥球」— 只在勝算極大時出手
- 投資 = 好公司 + 合理價格 + 長期持有
- 25個認知偏誤要熟記（錨定效應、損失厭惡、確認偏誤等）
- 閱讀 > 社交。每天讀書學習。

## 風格
- 睿智、簡練、偶爾毒舌
- 大量使用比喻和寓言
- 「如果你不能比世界上最能幹的人更能幹，那就學習」

Today: ${todayStr2}
User: ${user.name}
Tasks today:\n${taskSummary}${lineRules}`;

    case "feynman":
      return `你是理查·費曼的認知框架。用費曼學習法幫助用戶理解任何概念。

## 核心心智模型
1. **費曼學習法**：如果你不能用簡單的語言解釋，代表你還不夠理解。把複雜概念講到12歲小孩都懂。
2. **好奇心驅動**：對一切保持好奇。問「為什麼？」不是為了考試，是因為真的想知道。
3. **從不同角度看**：同一個問題，換12種方式去理解它。每種角度都會教你新東西。
4. **誠實面對不懂**：科學最重要的是承認「我不知道」。假裝懂是學習最大的敵人。
5. **玩耍即學習**：最好的學習發生在你覺得好玩的時候。把學習變成遊戲和探索。

## 決策啟發式
- 先建立直覺，再學公式
- 用類比和日常經驗解釋抽象概念
- 動手做 > 只看書
- 提出好問題比找到答案更重要
- 不要被權威嚇倒 — 物理教授也會犯錯

## 風格
- 熱情、幽默、平易近人
- 用生活例子解釋複雜概念
- 「你看，其實很簡單…」
- 鼓勵好奇心，慶祝發現

Today: ${todayStr2}
User: ${user.name}
Tasks today:\n${taskSummary}${lineRules}`;

    case "naval":
      return `你是 Naval Ravikant 的認知框架。用槓桿和專屬知識的思維幫助用戶思考財富和人生。

## 核心心智模型
1. **專屬知識（Specific Knowledge）**：找到你獨特的、無法被培訓的技能組合。這是你的護城河。
2. **槓桿（Leverage）**：三種槓桿 — 資本、人力、零邊際成本的產品（代碼和媒體）。代碼和媒體是新時代最好的槓桿。
3. **長期博弈**：和值得信任的人玩長期博弈。所有回報都來自複利。
4. **判斷力 > 努力**：在正確的方向上判斷力比工時更重要。一小時的正確判斷勝過1000小時的執行。
5. **幸福是一種技能**：幸福不是靠外在條件，是靠內在修煉。冥想、平靜、接受現實。

## 決策啟發式
- 出租時間永遠無法致富，要擁有股權
- 學習銷售和建造 — 兩者都會你就無敵
- Code > Capital > Labor（作為槓桿）
- 閱讀你真正感興趣的，不是「應該」讀的
- 如果不能確定，答案就是不
- 長期樂觀，短期務實

## 風格
- 簡潔、深刻、像詩一樣
- 每句話都像Twitter格言
- 禪意 + 矽谷 + 哲學
- 不說廢話，直擊本質

Today: ${todayStr2}
User: ${user.name}
Tasks today:\n${taskSummary}${lineRules}`;

    default:
      return `You are Muse, a friendly AI assistant for "${user.name}" inside "Analogue Planner". Help plan the day, brainstorm, give advice, stay organized.

Today: ${todayStr2}
Tasks today:\n${taskSummary}

Tips: To add task, just type it. To check tasks, type "今日有咩做".${lineRules}`;
  }
}

async function handleChat(user, lineUserId, replyToken, text) {
  const todayStr2 = userToday(user);
  const skill = activeSkills.get(lineUserId) || "default";

  const allUserTasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.uid, user.id), eq(tasks.done, false)));
  const todayTasks = allUserTasks.filter((t) => t.date === todayStr2);

  let systemPrompt;
  const customKey = lineUserId + '_' + skill;
  if (skill.startsWith("custom_") && customSkills.has(customKey)) {
    systemPrompt = customSkills.get(customKey);
  } else {
    systemPrompt = getSkillSystemPrompt(skill, user, todayStr2, todayTasks, allUserTasks);
  }

  if (skill === "journal") {
    try {
      const todays = await db.select().from(journalEntries)
        .where(and(eq(journalEntries.uid, user.id), eq(journalEntries.date, todayStr2)));
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
      const fmt = (e) => {
        const d = new Date(e.createdAt);
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        return `[${e.date} ${hh}:${mm}] ${e.body}`;
      };
      const block = todays.length ? todays.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).map(fmt).join("\n") : "(no entries today)";
      systemPrompt += `\n\n--- JOURNAL CONTEXT (today) ---\n${block}\n--- END JOURNAL ---`;
    } catch (e) {
      console.error("Journal context fetch error:", e.message);
    }
  }

  const pdfCtx = pdfContextMap.get(lineUserId);
  if (pdfCtx && Date.now() - pdfCtx.timestamp < 30 * 60 * 1000) {
    systemPrompt += `\n\n--- PDF CONTEXT ---\nThe user recently uploaded a PDF: "${pdfCtx.fileName}"\n${pdfCtx.summary ? `Summary: ${pdfCtx.summary}\n` : ""}Full text (truncated):\n${pdfCtx.text.substring(0, 8000)}\n--- END PDF ---\nIf the user asks questions about this PDF, answer based on the content above. Be specific and cite relevant parts.`;
  }

  addChatHistory(lineUserId, "user", text);
  const history = getChatHistory(lineUserId);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
      ],
      temperature: 0.7,
      max_tokens: 400,
    });

    const reply = response.choices[0]?.message?.content?.trim();
    if (reply) {
      addChatHistory(lineUserId, "assistant", reply);
      await replyMessage(replyToken, reply);
    } else {
      await replyMessage(replyToken, "唔好意思，我暫時答唔到你 😅");
    }
  } catch (err) {
    console.error("LINE chat error:", err.message);
    await replyMessage(replyToken, "⚠️ AI 暫時繁忙，請稍後再試。");
  }
}

async function handleTextMessage(lineUserId, replyToken, text) {
  const user = await findOrLinkUser(lineUserId);

  if (!user) {
    if (text.toLowerCase().startsWith("link ")) {
      const email = text.slice(5).trim();
      const [found] = await db
        .select()
        .from(users)
        .where(eq(users.email, email));
      if (found) {
        await db
          .update(users)
          .set({ lineUserId })
          .where(eq(users.id, found.id));
        invalidateDailySummaryCache(); invalidateDailyWeatherCache();
        await replyMessage(
          replyToken,
          `✅ 已連結到 ${found.name} 嘅帳號！\n\n而家你可以直接 send 訊息加 task 或者同我傾偈喇 💬`
        );
      } else {
        await replyMessage(replyToken, `❌ 搵唔到呢個 email：${email}`);
      }
      return;
    }

    await replyMessage(
      replyToken,
      "👋 歡迎使用 Analogue Planner LINE Bot！\n\n請先連結你嘅帳號：\n輸入 link 你的email\n例如：link demo@tweek.app"
    );
    return;
  }

  if (text.toLowerCase().startsWith("link ")) {
    const email = text.slice(5).trim();
    const [found] = await db
      .select()
      .from(users)
      .where(eq(users.email, email));
    if (found) {
      await db
        .update(users)
        .set({ lineUserId })
        .where(eq(users.id, found.id));
      invalidateDailySummaryCache(); invalidateDailyWeatherCache();
      await replyMessage(
        replyToken,
        `✅ 已連結到 ${found.name} 嘅帳號！`
      );
    } else {
      await replyMessage(replyToken, `❌ 搵唔到呢個 email：${email}`);
    }
    return;
  }

  const pending = pendingExpenses.get(lineUserId);
  if (pending) {
    if (Date.now() - pending.savedAt > PENDING_EXPENSE_TTL_MS) {
      pendingExpenses.delete(lineUserId);
    } else {
      const trimmed = text.trim();
      const cancelWords = ["唔使", "唔記啦", "cancel", "算啦", "算了", "唔記得", "唔使記"];
      if (cancelWords.includes(trimmed.toLowerCase())) {
        pendingExpenses.delete(lineUserId);
        await replyMessage(replyToken, "👌 好，呢單唔記。");
        return;
      }
      const amountMatch = trimmed.match(/^\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:蚊|hkd|hk\$|元|塊)?\s*$/i);
      if (amountMatch) {
        const amount = parseFloat(amountMatch[1]);
        const p = pending.parsed;
        const dateStr = p.date || userToday(user);
        try {
          const insertedPending = await db.insert(expenses).values({
            uid: user.id,
            store: p.store || "",
            date: dateStr,
            currency: p.currency || "HKD",
            total: String(amount),
            items: JSON.stringify(p.items && p.items.length ? p.items.map(i => ({ ...i, price: i.price || amount })) : [{ name: p.store || "expense", price: amount }]),
            notes: p.notes || pending.originalText || "",
            category: normalizeCategory(p.category, p.store, p.items),
            source: "line",
          }).returning({ id: expenses.id });
          try {
            await sendPushToUser(user.id, {
              title: "💰 已記帳",
              body: `${p.store || "支出"} ${p.currency || "HKD"}${amount}`,
              icon: "/icon-192.png",
              badge: "/icon-192.png",
              data: { type: "expense-added", source: "line", expenseId: insertedPending?.[0]?.id, date: dateStr },
            });
          } catch (e) {
            console.error("Failed to send expense push:", e.message);
          }
          pendingExpenses.delete(lineUserId);
          const normalizedCat = normalizeCategory(p.category, p.store, p.items);
          rememberLastExpense(lineUserId, insertedPending?.[0]?.id, {
            store: p.store || "",
            total: amount,
            currency: p.currency || "HKD",
            date: dateStr,
            category: normalizedCat,
            notes: p.notes || pending.originalText || "",
            items: p.items || [],
          });
          let confirmMsg = `💰 已記帳！\n\n🏪 ${p.store || "N/A"}`;
          confirmMsg += `\n💵 ${p.currency || "HKD"}${amount}`;
          const parts = dateStr.split("-");
          confirmMsg += `\n📅 ${parts[1]}月${parts[2]}日`;
          if (p.category) confirmMsg += `\n🏷 ${formatCategoryForLine(p.category)}`;
          confirmMsg += `\n\n已儲存到記帳簿 ✅\n\n💡 5 分鐘內可回覆「改做 65」、「改去 grocery」或「唔記啦」嚟修改 / 取消。`;
          await replyMessage(replyToken, confirmMsg);
        } catch (e) {
          console.error("Failed to save pending expense:", e.message);
          pendingExpenses.delete(lineUserId);
          await replyMessage(replyToken, "⚠️ 記帳儲存失敗，請稍後再試。");
        }
        return;
      }
    }
  }

  const lastExp = lineUserId ? lastExpenses.get(lineUserId) : null;
  if (lastExp) {
    if (Date.now() - lastExp.savedAt > LAST_EXPENSE_TTL_MS) {
      lastExpenses.delete(lineUserId);
    } else {
      const trimmed = text.trim();
      const cancelRegex = /^(?:唔記啦?|唔記得啦?|唔要呢單|算啦呢單|刪(?:左|咗|除)?(?:呢單|啦)?|delete|del|cancel|undo|取消)$/i;
      const editRegex = /^(?:改|改做|改返|改去|改成|改個|改名|改店|改商戶|改類|改類別|改日期|改金額|改價|改 ?notes?|update|change|edit|歸類|歸去|歸返)/i;
      if (cancelRegex.test(trimmed)) {
        try {
          await db.delete(expenses).where(and(eq(expenses.id, lastExp.expenseId), eq(expenses.uid, user.id)));
        } catch (e) {
          console.error("Failed to delete last expense:", e.message);
          await replyMessage(replyToken, "⚠️ 刪除失敗，請稍後再試。");
          return;
        }
        await logExpenseAudit(user.id, lastExp.expenseId, "delete", lastExp.expense, null);
        try {
          await sendPushToUser(user.id, {
            title: "🗑 已刪除記帳",
            body: `${lastExp.expense.store || "支出"} ${lastExp.expense.currency || "HKD"}${lastExp.expense.total}`,
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            data: { type: "expense-deleted", source: "line", expenseId: lastExp.expenseId, date: lastExp.expense.date },
          });
        } catch (e) {
          console.error("Failed to send expense delete push:", e.message);
        }
        lastExpenses.delete(lineUserId);
        await replyMessage(replyToken, "🗑 好，已刪咗最近一筆記帳。");
        return;
      }
      if (editRegex.test(trimmed)) {
        const updates = await parseExpenseEditWithAI(trimmed, lastExp.expense, user);
        if (updates && typeof updates === "object" && Object.keys(updates).length > 0) {
          const setObj = {};
          const newSnapshot = { ...lastExp.expense };
          if (typeof updates.store === "string" && updates.store.trim()) {
            setObj.store = updates.store.trim();
            newSnapshot.store = setObj.store;
          }
          if (updates.total != null && !Number.isNaN(Number(updates.total)) && Number(updates.total) > 0) {
            setObj.total = String(Number(updates.total));
            newSnapshot.total = Number(updates.total);
          }
          if (typeof updates.date === "string" && /^\d{4}-\d{1,2}-\d{1,2}$/.test(updates.date.trim())) {
            setObj.date = updates.date.trim();
            newSnapshot.date = setObj.date;
          }
          if (typeof updates.category === "string" && updates.category.trim()) {
            const cat = normalizeCategory(updates.category.trim(), newSnapshot.store, newSnapshot.items);
            setObj.category = cat;
            newSnapshot.category = cat;
          }
          if (typeof updates.notes === "string") {
            setObj.notes = updates.notes;
            newSnapshot.notes = updates.notes;
          }
          if (Object.keys(setObj).length === 0) {
            // No actionable fields parsed; fall through to normal intent handling.
          } else {
          try {
            await db.update(expenses).set(setObj).where(and(eq(expenses.id, lastExp.expenseId), eq(expenses.uid, user.id)));
            const fieldChanges = [];
            for (const key of Object.keys(setObj)) {
              const oldVal = lastExp.expense?.[key];
              const newVal = newSnapshot?.[key];
              if (String(oldVal ?? "") !== String(newVal ?? "")) {
                fieldChanges.push({ field: key, oldValue: oldVal, newValue: newVal });
              }
            }
            await logExpenseAudit(user.id, lastExp.expenseId, "update", newSnapshot, fieldChanges);
            lastExpenses.set(lineUserId, { expenseId: lastExp.expenseId, expense: newSnapshot, savedAt: Date.now() });
            try {
              await sendPushToUser(user.id, {
                title: "✏️ 記帳已更新",
                body: `${newSnapshot.store || "支出"} ${newSnapshot.currency || "HKD"}${newSnapshot.total}`,
                icon: "/icon-192.png",
                badge: "/icon-192.png",
                data: { type: "expense-updated", source: "line", expenseId: lastExp.expenseId, date: newSnapshot.date },
              });
            } catch (e) {
              console.error("Failed to send expense update push:", e.message);
            }
            let msg = `✏️ 已更新記帳！\n\n🏪 ${newSnapshot.store || "N/A"}`;
            msg += `\n💵 ${newSnapshot.currency || "HKD"}${newSnapshot.total}`;
            const parts = (newSnapshot.date || "").split("-");
            if (parts.length === 3) msg += `\n📅 ${parts[1]}月${parts[2]}日`;
            if (newSnapshot.category) msg += `\n🏷 ${formatCategoryForLine(newSnapshot.category)}`;
            msg += `\n\n仲可以再回覆嚟修改 / 取消 ✏️`;
            await replyMessage(replyToken, msg);
          } catch (e) {
            console.error("Failed to update last expense:", e.message);
            await replyMessage(replyToken, "⚠️ 更新失敗，請稍後再試。");
          }
          return;
          }
        }
      }
    }
  }

  const lastFood = lineUserId ? lastFoodLogs.get(lineUserId) : null;
  if (lastFood) {
    if (Date.now() - lastFood.savedAt > LAST_FOOD_LOG_TTL_MS) {
      lastFoodLogs.delete(lineUserId);
    } else {
      const trimmed = text.trim();
      const cancelRegex = /^(?:唔記啦?|唔記得啦?|唔要呢餐|算啦呢餐|刪(?:左|咗|除)?(?:呢餐|啦)?|delete|del|cancel|undo|取消)$/i;
      const editRegex = /^(?:改|改做|改返|改去|改成|改個|改名|改卡|改卡路里|改類|改類別|改餐|改類型|改日期|改時間|update|change|edit|\d+\s*(?:kcal|卡|大卡|cal)?\s*$)/i;
      if (cancelRegex.test(trimmed)) {
        try {
          await db.delete(foodLog).where(and(eq(foodLog.id, lastFood.foodId), eq(foodLog.uid, user.id)));
          await logFoodAudit(user.id, lastFood.foodId, "delete", lastFood.food, null);
        } catch (e) {
          console.error("Failed to delete last food log:", e.message);
          await replyMessage(replyToken, "⚠️ 刪除失敗，請稍後再試。");
          return;
        }
        try {
          await sendPushToUser(user.id, {
            title: "🗑 已刪除食物記錄",
            body: `${(lastFood.food.items || []).map(i => i.name).filter(Boolean).join("、") || "餐點"} ~ ${lastFood.food.totalCalories || 0} kcal`,
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            data: { type: "food-deleted", source: "line", foodId: lastFood.foodId, date: lastFood.food.date },
          });
        } catch (e) {
          console.error("Failed to send food delete push:", e.message);
        }
        lastFoodLogs.delete(lineUserId);
        await replyMessage(replyToken, "🗑 好，已刪咗最近一餐食物記錄。");
        return;
      }
      if (editRegex.test(trimmed)) {
        const updates = await parseFoodEditWithAI(trimmed, lastFood.food, user);
        if (updates && typeof updates === "object" && Object.keys(updates).length > 0) {
          const setObj = {};
          const newSnapshot = { ...lastFood.food, items: [...(lastFood.food.items || [])] };
          if (typeof updates.name === "string" && updates.name.trim()) {
            const newName = updates.name.trim();
            const baseCal = (updates.totalCalories != null && Number(updates.totalCalories) > 0)
              ? Number(updates.totalCalories)
              : (Number(newSnapshot.totalCalories) || 0);
            newSnapshot.items = [{ name: newName, calories: baseCal, source: "manual" }];
            setObj.items = JSON.stringify(newSnapshot.items);
          }
          if (updates.totalCalories != null && !Number.isNaN(Number(updates.totalCalories)) && Number(updates.totalCalories) >= 0) {
            const newTotal = Math.round(Number(updates.totalCalories));
            setObj.totalCalories = newTotal;
            newSnapshot.totalCalories = newTotal;
            if (!setObj.items && Array.isArray(newSnapshot.items) && newSnapshot.items.length === 1) {
              newSnapshot.items = [{ ...newSnapshot.items[0], calories: newTotal }];
              setObj.items = JSON.stringify(newSnapshot.items);
            }
          }
          if (typeof updates.mealType === "string" && ["breakfast","lunch","dinner","snack","unknown"].includes(updates.mealType)) {
            setObj.mealType = updates.mealType;
            newSnapshot.mealType = updates.mealType;
          }
          if (typeof updates.date === "string" && /^\d{4}-\d{1,2}-\d{1,2}$/.test(updates.date.trim())) {
            const dParts = updates.date.trim().split("-");
            const padded = `${dParts[0]}-${dParts[1].padStart(2,"0")}-${dParts[2].padStart(2,"0")}`;
            setObj.date = padded;
            newSnapshot.date = padded;
          }
          if (typeof updates.time === "string" && /^\d{1,2}:\d{2}$/.test(updates.time.trim())) {
            const tPadded = updates.time.trim().padStart(5, "0");
            setObj.time = tPadded;
            newSnapshot.time = tPadded;
          }
          if (Object.keys(setObj).length > 0) {
            try {
              await db.update(foodLog).set(setObj).where(and(eq(foodLog.id, lastFood.foodId), eq(foodLog.uid, user.id)));
              const itemNamesOf = (snap) => (Array.isArray(snap?.items) ? snap.items : []).map(i => i?.name).filter(Boolean).join("、");
              const itemsJsonOf = (snap) => {
                try { return JSON.stringify(Array.isArray(snap?.items) ? snap.items : []); } catch (e) { return "[]"; }
              };
              const fieldChanges = [];
              if (setObj.items != null) {
                const oldNames = itemNamesOf(lastFood.food);
                const newNames = itemNamesOf(newSnapshot);
                if (oldNames !== newNames) fieldChanges.push({ field: "items", oldValue: itemsJsonOf(lastFood.food), newValue: itemsJsonOf(newSnapshot) });
              }
              if (setObj.totalCalories != null && Number(lastFood.food.totalCalories || 0) !== Number(newSnapshot.totalCalories || 0)) {
                fieldChanges.push({ field: "totalCalories", oldValue: Number(lastFood.food.totalCalories || 0), newValue: Number(newSnapshot.totalCalories || 0) });
              }
              if (setObj.mealType != null && lastFood.food.mealType !== newSnapshot.mealType) {
                fieldChanges.push({ field: "mealType", oldValue: lastFood.food.mealType || "unknown", newValue: newSnapshot.mealType });
              }
              if (setObj.date != null && lastFood.food.date !== newSnapshot.date) {
                fieldChanges.push({ field: "date", oldValue: lastFood.food.date || "", newValue: newSnapshot.date });
              }
              if (setObj.time != null && (lastFood.food.time || "") !== (newSnapshot.time || "")) {
                fieldChanges.push({ field: "time", oldValue: lastFood.food.time || "", newValue: newSnapshot.time || "" });
              }
              if (fieldChanges.length > 0) {
                await logFoodAudit(user.id, lastFood.foodId, "update", newSnapshot, fieldChanges);
              }
              lastFoodLogs.set(lineUserId, { foodId: lastFood.foodId, food: newSnapshot, savedAt: Date.now() });
              const mealLabels = {
                breakfast: "🌅 早餐",
                lunch: "☀️ 午餐",
                dinner: "🌙 晚餐",
                snack: "🍪 小食",
                unknown: "🍽️ 餐點",
              };
              const mealLabel = mealLabels[newSnapshot.mealType] || mealLabels.unknown;
              const itemNames = (newSnapshot.items || []).map(i => i.name).filter(Boolean).join("、") || "餐點";
              try {
                await sendPushToUser(user.id, {
                  title: "✏️ 食物記錄已更新",
                  body: `${mealLabel} ${itemNames} ~ ${newSnapshot.totalCalories || 0} kcal`,
                  icon: "/icon-192.png",
                  badge: "/icon-192.png",
                  data: { type: "food-updated", source: "line", foodId: lastFood.foodId, date: newSnapshot.date },
                });
              } catch (e) {
                console.error("Failed to send food update push:", e.message);
              }
              let msg = `✏️ 已更新食物記錄！\n\n${mealLabel}`;
              msg += `\n🍴 ${itemNames}`;
              msg += `\n🔥 ~ ${newSnapshot.totalCalories || 0} kcal`;
              msg += `\n📅 ${newSnapshot.date}${newSnapshot.time ? ` ${newSnapshot.time}` : ""}`;
              msg += `\n\n仲可以再回覆嚟修改 / 取消 ✏️`;
              await replyMessage(replyToken, msg);
            } catch (e) {
              console.error("Failed to update last food log:", e.message);
              await replyMessage(replyToken, "⚠️ 更新失敗，請稍後再試。");
            }
            return;
          }
        }
      }
    }
  }

  if (text.toLowerCase() === "help" || text === "幫助" || text === "指令") {
    const currentSkill = activeSkills.get(lineUserId) || "default";
    const si = SKILL_LABELS[currentSkill];
    await replyMessage(
      replyToken,
      `🤖 Analogue Planner Bot\n\n` +
        `📝 加 Task — 直接打任務\n` +
        `   例：聽日開會、下午3點見客\n\n` +
        `📋 睇 Tasks — 打「今日有咩做」\n\n` +
        `💡 加 Memo — 打 memo: 內容\n\n` +
        `💰 記帳 — 打「記帳 lunch 133」\n\n` +
        `🚶 步數 — 打「步數 8000」或「行左5km」\n` +
        `   📸 Send 健康 App 截圖自動記錄\n\n` +
        `💊 症狀 — 打「頭痛」或「肚痛食左藥」\n\n` +
        `💬 傾偈 — 直接問問題\n\n` +
        `📸 Send 相片 — AI 智能分析\n` +
        `   🧾 收據 → 自動記帳\n` +
        `   📅 Schedule → 建立 Tasks\n` +
        `   📇 名片 → 提取聯絡資料\n` +
        `   🚶 步數截圖 → 自動記步\n\n` +
        `📄 Send PDF — AI 文件分析\n` +
        `   自動摘要 + 重點提取\n` +
        `   之後可以問 PDF 內容\n\n` +
        `🎙️ Send 語音 — Whisper 轉文字\n` +
        `   自動辨識內容類型\n` +
        `   Task → 建立任務 / 問題 → AI 回覆\n\n` +
        `🎯 AI Skills：\n` +
        `   📊 分析 | ✍️ 寫嘢 | 📅 計劃\n` +
        `   🧠 專注 | 💡 brainstorm\n\n` +
        `🧬 人物思維 Skills：\n` +
        `   🎓 張雪峰 | 🚀 musk | 📊 munger\n` +
        `   🔬 feynman | ⚓ naval\n\n` +
        `🌤 天氣 — 即時香港天氣\n` +
        `   每朝 7:00 自動推送天氣日報\n` +
        `   打「/weather next」睇下次推送時間\n\n` +
        `🧪 進階：\n` +
        `   「蒸餾 人名」— AI 生成任何人嘅思維\n` +
        `   「分析同事: 聊天內容」— 分析工作風格\n\n` +
        `   🪄 muse — 返回一般模式\n\n` +
        `而家模式：${si.icon} ${si.label}`
    );
    return;
  }

  const lower = text.toLowerCase().trim();

  if (
    lower === "/weather next" ||
    lower === "weather next" ||
    lower === "next weather" ||
    lower === "next push" ||
    lower === "下次天氣" ||
    lower === "下次天气" ||
    lower === "下一次天氣" ||
    lower === "下一次天气" ||
    lower === "下次推送" ||
    lower === "幾時推天氣" ||
    lower === "几时推天气"
  ) {
    await replyMessage(replyToken, formatNextWeatherPushReply(user));
    return;
  }

  if (lower === "weather" || lower === "天氣" || lower === "天气") {
    try {
      const weatherData = await fetchHKWeather();
      const weatherMsg = formatWeatherMessage(weatherData);
      await replyMessage(
        replyToken,
        weatherMsg || "暫時無法取得天氣資料，請稍後再試。",
        { quickReply: WEATHER_NEXT_QUICK_REPLY },
      );
    } catch (e) {
      await replyMessage(replyToken, "⚠️ 取得天氣資料時出錯，請稍後再試。");
    }
    return;
  }

  if (/^(?:記帳|記賬|記數|expense|花了|花左|使了|使左|畀了|畀左|買了|買左|俾咗|用咗|洗咗)/.test(text.trim())) {
    await handleAddExpense(user, replyToken, text, lineUserId);
    return;
  }

  if (/^(?:步數|步数|steps|行左|行咗|走了|走咗|today steps)/i.test(text.trim()) || /^\d+\s*步$/.test(text.trim())) {
    await handleAddSteps(user, replyToken, text);
    return;
  }

  if (/^(?:頭痛|肚痛|發燒|喉嚨痛|流鼻水|咳嗽|暈眩|失眠|腰痛|過敏|胃酸|經痛|medicine|食咗藥|食左藥|食藥)/i.test(text.trim())) {
    await handleAddMedicine(user, replyToken, text);
    return;
  }

  if (lower === "muse" || lower === "一般" || lower === "reset" || lower === "返回") {
    activeSkills.delete(lineUserId);
    chatHistory.delete(lineUserId);
    await replyMessage(replyToken, "🪄 已切換到 Muse 一般模式！\n\n直接打訊息就可以傾偈喇。");
    return;
  }

  if (lower === "skills" || lower === "技能" || lower === "#skills") {
    const currentSkill = activeSkills.get(lineUserId) || "default";
    const si = SKILL_LABELS[currentSkill];
    await replyMessage(
      replyToken,
      `🎯 AI Skills\n\n` +
        `📊 分析 — 生產力數據分析\n` +
        `✍️ 寫嘢 — 寫作 / 編輯 / 翻譯\n` +
        `📅 計劃 — 排 schedule / 優先排序\n` +
        `🧠 專注 — ADHD Coach / 拆細任務\n` +
        `💡 brainstorm — 創意諗 idea\n\n` +
        `🧬 人物思維：\n` +
        `🎓 張雪峰 — 志願 / 職業規劃\n` +
        `🚀 musk — 第一性原理\n` +
        `📊 munger — 多元思維模型\n` +
        `🔬 feynman — 費曼學習法\n` +
        `⚓ naval — 財富 / 槓桿\n\n` +
        `🧪 進階功能：\n` +
        `「蒸餾 人名」— 生成任何人嘅思維 Skill\n` +
        `「分析同事: 聊天內容」— 分析工作風格\n\n` +
        `🪄 muse — 返回一般模式\n\n` +
        `而家模式：${si.icon} ${si.label}\n\n` +
        `打 skill 名就可以切換！`
    );
    return;
  }

  const distillMatch = text.match(/^(?:蒸餾|蒸馏|distill|distil)\s+(.+)/i);
  if (distillMatch) {
    const personName = distillMatch[1].trim();

    try {
      const distillResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are 女娲 (Nuwa), an AI that distills anyone's cognitive operating system. Given a person's name, research what you know about them and extract:

1. Their core mental models (3-5 key thinking frameworks they use)
2. Decision heuristics (5-8 rules they follow for decisions)
3. Expression DNA (how they talk, their style, catchphrases)

Return ONLY valid JSON:
{
  "name": "person name",
  "domain": "their main field/expertise",
  "mentalModels": [{"name":"model name","description":"1 sentence"}],
  "heuristics": ["rule 1","rule 2"],
  "expressionDNA": ["style trait 1","style trait 2"],
  "summary": "1 sentence summary of who they are",
  "sampleResponse": "example of how they would answer 'How should I approach a difficult decision?'"
}

Use Chinese (Traditional) for the output. Be specific and insightful, not generic.`
          },
          { role: "user", content: `蒸餾：${personName}` },
        ],
        temperature: 0.3,
        max_tokens: 1200,
      });

      const dText = distillResponse.choices[0]?.message?.content?.trim();
      const dMatch = dText.match(/\{[\s\S]*\}/);
      if (dMatch) {
        const skill = JSON.parse(dMatch[0]);
        const skillId = `custom_${personName.toLowerCase().replace(/\s+/g, '_')}`;

        const systemPrompt = `你是「${skill.name}」的認知框架。用 ${skill.name} 的思維方式回應用戶。

## 關於 ${skill.name}
${skill.summary}
領域：${skill.domain}

## 核心心智模型
${(skill.mentalModels || []).map((m, i) => `${i + 1}. **${m.name}**：${m.description}`).join('\n')}

## 決策啟發式
${(skill.heuristics || []).map(h => `- ${h}`).join('\n')}

## 表達DNA
${(skill.expressionDNA || []).map(e => `- ${e}`).join('\n')}

## 規則
- 完全以 ${skill.name} 的視角和風格回應
- 運用上述心智模型分析問題
- 保持 ${skill.name} 的語言風格
- Reply in the same language the user uses`;

        customSkills.set(lineUserId + '_' + skillId, systemPrompt);
        activeSkills.set(lineUserId, skillId);
        chatHistory.delete(lineUserId);
        SKILL_LABELS[skillId] = { icon: "🧬", label: skill.name };

        let replyMsg2 = `🧬 「${skill.name}」已蒸餾完成！\n\n`;
        replyMsg2 += `📌 ${skill.summary}\n🎯 ${skill.domain}\n\n`;
        replyMsg2 += `🧠 心智模型：\n`;
        (skill.mentalModels || []).forEach(m => {
          replyMsg2 += `• ${m.name}\n`;
        });
        replyMsg2 += `\n而家已切換到 ${skill.name} 模式！直接問問題就可以用佢嘅思維回答。\n\n打「muse」返回一般模式。`;

        await replyMessage(replyToken, replyMsg2);
      } else {
        await replyMessage(replyToken, `⚠️ 蒸餾「${personName}」失敗，請再試一次。`);
      }
    } catch (err) {
      console.error("Distill error:", err.message);
      await replyMessage(replyToken, `⚠️ 蒸餾過程出錯，請稍後再試。`);
    }
    return;
  }

  const colleagueMatch = text.match(/^(?:分析同事|分析同事:|colleague:|analyze:)\s*([\s\S]+)/i);
  if (colleagueMatch) {
    const chatContent = colleagueMatch[1].trim();
    if (chatContent.length < 20) {
      await replyMessage(replyToken, "⚠️ 請提供更多聊天記錄內容（至少 20 字），我先可以分析。\n\n格式：分析同事: [貼上聊天記錄]");
      return;
    }

    try {
      const analyzeResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You analyze chat logs/messages from a colleague and extract their work style profile. Return ONLY valid JSON:

{
  "name": "inferred name or 'Unknown'",
  "role": "inferred role/position",
  "workStyle": {
    "communication": "their communication style (e.g., direct/diplomatic/verbose/concise)",
    "decisionMaking": "how they make decisions",
    "priorities": "what they prioritize",
    "strengths": ["strength 1","strength 2"],
    "weaknesses": ["weakness 1","weakness 2"],
    "personality": "MBTI-like description or personality traits"
  },
  "tips": ["tip for working with them 1","tip 2","tip 3"],
  "summary": "2-3 sentence profile summary"
}

Use Chinese (Traditional) for output. Be insightful and specific based on the actual messages, not generic.`
          },
          { role: "user", content: `分析以下同事的聊天記錄：\n\n${chatContent.substring(0, 5000)}` },
        ],
        temperature: 0.3,
        max_tokens: 800,
      });

      const aText = analyzeResponse.choices[0]?.message?.content?.trim();
      const aMatch = aText.match(/\{[\s\S]*\}/);
      if (aMatch) {
        const profile = JSON.parse(aMatch[0]);

        const [newMemo] = await db
          .insert(memos)
          .values({
            uid: user.id,
            title: `👤 同事分析：${profile.name || "Unknown"}`,
            content: `角色：${profile.role || "N/A"}\n\n📊 工作風格：\n溝通：${profile.workStyle?.communication || "N/A"}\n決策：${profile.workStyle?.decisionMaking || "N/A"}\n優先：${profile.workStyle?.priorities || "N/A"}\n性格：${profile.workStyle?.personality || "N/A"}\n\n💪 優點：\n${(profile.workStyle?.strengths || []).map(s => `• ${s}`).join('\n')}\n\n⚠️ 注意：\n${(profile.workStyle?.weaknesses || []).map(w => `• ${w}`).join('\n')}\n\n💡 合作建議：\n${(profile.tips || []).map(t => `• ${t}`).join('\n')}\n\n📝 總結：${profile.summary || ""}`,
            date: userToday(user),
            color: "green",
            noteType: "permanent",
          })
          .returning();

        let replyMsg3 = `👤 同事分析完成！\n\n`;
        replyMsg3 += `📌 ${profile.name || "Unknown"} — ${profile.role || ""}\n`;
        replyMsg3 += `💬 ${profile.workStyle?.communication || ""}\n`;
        replyMsg3 += `🧠 ${profile.workStyle?.personality || ""}\n\n`;
        replyMsg3 += `💡 合作建議：\n`;
        (profile.tips || []).slice(0, 3).forEach(t => {
          replyMsg3 += `• ${t}\n`;
        });
        replyMsg3 += `\n完整分析已存到 Memos 📝`;

        await replyMessage(replyToken, replyMsg3);
      } else {
        await replyMessage(replyToken, "⚠️ 分析失敗，請再試一次。");
      }
    } catch (err) {
      console.error("Colleague analysis error:", err.message);
      await replyMessage(replyToken, "⚠️ 分析過程出錯，請稍後再試。");
    }
    return;
  }

  for (const [skillKey, triggers] of Object.entries(SKILL_TRIGGERS)) {
    if (triggers.includes(lower)) {
      activeSkills.set(lineUserId, skillKey);
      chatHistory.delete(lineUserId);
      const si = SKILL_LABELS[skillKey];
      const skillDesc = {
        analytics: "問我關於你嘅生產力、task 分佈、工作模式。",
        writer: "貼文字畀我改、或者叫我幫你寫嘢。",
        planner: "話我知你想 plan 咩，我幫你排 schedule。",
        adhd: "話我知你而家卡住咩，我幫你拆細佢。",
        brainstorm: "講個題目，我哋一齊 brainstorm！",
        xuefeng: "話我知你嘅分數、省份、家庭背景，我用張雪峰嘅思維幫你分析。",
        musk: "話我知你想解決咩問題，我用第一性原理幫你拆解。",
        munger: "話我知你想分析咩，我用多元思維模型交叉驗證。",
        feynman: "話我知你想學咩概念，我用最簡單嘅方式解釋畀你聽。",
        naval: "問我關於財富、槓桿、人生選擇，我用 Naval 嘅框架回答。",
      };
      await replyMessage(
        replyToken,
        `${si.icon} 已切換到 ${si.label} 模式！\n\n${skillDesc[skillKey] || "直接問我問題！"}\n\n打「muse」返回一般模式。`
      );
      return;
    }
  }

  const currentSkill = activeSkills.get(lineUserId) || "default";

  if (currentSkill === "journal") {
    const reflectTrigger = /^(reflect|reflection|回顧|回顾|summary|summarise|summarize|today\??)/i;
    if (reflectTrigger.test(text.trim())) {
      await handleChat(user, lineUserId, replyToken, text);
    } else {
      await handleAddJournalFromLine(user, replyToken, text);
    }
    return;
  }

  if (currentSkill !== "default") {
    await handleChat(user, lineUserId, replyToken, text);
    return;
  }

  if (/^(今日|今天)?(食[咗左過]?乜|食物總結|飲食總結|食物summary|food summary|today food|今日營養|今日卡路里|今日calories)/i.test(text.trim())) {
    await handleFoodSummary(user, replyToken);
    return;
  }

  const intent = await classifyIntent(text, user);

  switch (intent) {
    case "add_task":
      await handleAddTask(user, replyToken, text);
      break;
    case "check_tasks":
      await handleCheckTasks(user, replyToken, text);
      break;
    case "add_memo":
      await handleAddMemo(user, replyToken, text);
      break;
    case "add_expense":
      await handleAddExpense(user, replyToken, text, lineUserId);
      break;
    case "add_steps":
      await handleAddSteps(user, replyToken, text);
      break;
    case "add_medicine":
      await handleAddMedicine(user, replyToken, text);
      break;
    case "add_food":
      await handleAddFood(user, replyToken, text, lineUserId);
      break;
    case "link_account":
      if (text.toLowerCase().startsWith("link ")) {
        const email = text.slice(5).trim();
        const [found] = await db
          .select()
          .from(users)
          .where(eq(users.email, email));
        if (found) {
          await db.update(users).set({ lineUserId }).where(eq(users.id, found.id));
          invalidateDailySummaryCache(); invalidateDailyWeatherCache();
          await replyMessage(replyToken, `✅ 已連結到 ${found.name} 嘅帳號！`);
        } else {
          await replyMessage(replyToken, `❌ 搵唔到呢個 email：${email}`);
        }
      }
      break;
    case "chat":
    default:
      await handleChat(user, lineUserId, replyToken, text);
      break;
  }
}

async function downloadLineContent(messageId) {
  const res = await fetch(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    {
      headers: { Authorization: `Bearer ${LINE_TOKEN}` },
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to download LINE content: ${res.status}`);
  }
  const contentType = res.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return { buffer, contentType };
}

function getExtFromMime(mime) {
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "application/pdf": ".pdf",
  };
  return map[mime] || ".jpg";
}

async function analyzeImageWithAI(base64Data, contentType, goalCtx = null, user = null) {
  const today = getUserNow(user);
  const todayStr = userToday(user);
  const goalBlock = formatGoalsForPrompt(goalCtx);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You analyze images and classify them. Today is ${todayStr}. Return ONLY valid JSON.

Classify the image into one of these types:
1. "receipt" — a receipt, invoice, bill, or payment record
2. "schedule" — a schedule, timetable, calendar, agenda, event poster, or anything with dates/times
3. "business_card" — a business card, contact card, or name card
4. "blood_pressure" — a blood pressure monitor/device screen showing SYS, DIA, PULSE readings
5. "fitness_steps" — a fitness app screenshot (Samsung Health, Apple Health, Google Fit, etc.) showing step count, walking distance, calories, or exercise data
6. "food" — a photo of food, meals, drinks, snacks, or any edible items (e.g. dishes, bento, beverages, desserts) WITHOUT a clearly visible barcode/EAN code
7. "packaged_product" — a photo of a packaged/branded food or drink product where a barcode (EAN/UPC, the black-and-white striped code with digits below) is clearly visible and readable, OR a clear shot of a product label with brand + product name (Calbee chips, Vitasoy, Coke, instant noodles packaging, snack wrapper, drink can/bottle, etc.)
8. "other" — anything else (photo, screenshot, document, etc.)

For each type, extract relevant structured data:

RECEIPT: {"type":"receipt","store":"store name","date":"date on receipt or null","currency":"HKD/USD/etc","items":[{"name":"item","price":number}],"total":number,"notes":"any other info","category":"food|grocery|transport|shopping|entertainment|health|bills|telecom|other"}
- For category, use the vendor type to pick the best bucket. Common HK vendor hints:
  - food: starbucks, 麥當勞/McDonald's, KFC, 大家樂, 大快活, 翠華, 譚仔, 美心, foodpanda, Uber Eats, deliveroo, KEETA, 茶餐廳, restaurants, cafes, bubble tea shops
  - grocery: 7-11/7-Eleven, Circle K, OK便利店, 百佳/ParknShop, 惠康/Wellcome, AEON, city'super, Don Don Donki, 一田 Yata, 街市, supermarkets
  - transport: MTR/港鐵, KMB/九巴, citybus/城巴, 新巴, taxi/的士, Uber, 八達通 top-up, ferries, gas stations
  - health: 萬寧/Mannings, 屈臣氏/Watsons, pharmacies, clinics, hospitals
  - shopping: Apple Store, Uniqlo, Zara, H&M, IKEA, HKTVmall, Sasa, department stores, fashion/electronics retailers
  - entertainment: cinemas (UA, MCL, Broadway), Netflix/Disney+/Spotify, gyms, concerts, theme parks
  - telecom: CSL, 3HK, SmartTone/數碼通, HKT/PCCW, HKBN, mobile/internet plans
  - bills: CLP/中電, HK Electric/港燈, Towngas/煤氣, water bills, rent, management fees, insurance, taxes

SCHEDULE: {"type":"schedule","events":[{"name":"event name","date":"YYYY-M-D format","startTime":"HH:MM or null","endTime":"HH:MM or null","location":"location or null"}]}
- For dates: convert to YYYY-M-D (no zero padding). If year is missing, use ${today.getFullYear()}.
- If you see weekday names (Monday, 星期一, etc), calculate the actual date from today.

BUSINESS_CARD: {"type":"business_card","name":"person name","company":"company","title":"job title","phone":"phone number","email":"email","address":"address","website":"website","other":"any other info"}

BLOOD_PRESSURE: {"type":"blood_pressure","sys":number,"dia":number,"pulse":number}
- Extract the SYS (systolic), DIA (diastolic), and PULSE values from the blood pressure monitor display
- SYS is typically the largest number (top), DIA is the middle number, PULSE is the smallest (bottom) or marked with a heart icon
- If the device shows mmHg unit, that confirms it's a blood pressure reading

FOOD: {"type":"food","items":[{"name":"food name (Chinese preferred, e.g. 叉燒飯、珍珠奶茶)","portion":"portion description e.g. '1 碗', '1 杯', '中份'","calories":number}],"totalCalories":number,"mealType":"breakfast/lunch/dinner/snack/unknown","healthScore":number,"suggestion":"短小精準的飲食建議 in Cantonese (廣東話)"}
- Identify each visible food/drink item in the photo
- Estimate calories based on visible portion size (rough estimates are fine)
- Sum all item calories into totalCalories
- Guess mealType from food type and portion (breakfast/lunch/dinner/snack); use "unknown" if unsure

⚠️ 用戶健康背景（評分同建議時必須考慮）：
  • 用戶本人：高血壓（Hypertension）、甲狀腺病（Thyroid disease）
  • 父親：大腸癌（Colorectal cancer）— 屬大腸癌高風險家族史
  • 母親：糖尿病（Diabetes）— 屬糖尿病高風險家族史

- healthScore (1-10, 10=最啱呢位用戶, 1=最唔啱)：除咗一般健康因素（蔬菜、油炸、份量），亦要因應用戶背景扣分：
    • 高鈉/高鹽/醃製/加工肉（午餐肉、香腸、火腿、即食麵、罐頭湯、豉油重食物）→ 高血壓扣分
    • 紅肉、燒烤、加工肉（腸仔、煙肉、午餐肉）→ 大腸癌風險扣分
    • 缺乏纖維/蔬菜/全穀 → 大腸癌風險扣分
    • 高糖/高升糖（白飯多、含糖飲品、甜品、果汁、糖水）→ 糖尿病風險扣分
    • 含碘極高食物（大量紫菜、海帶、海鮮）或十字花科生食過量 → 甲狀腺要留意
    • 蔬菜豐富、全穀、瘦蛋白、低鈉、無糖 → 加分

- suggestion: 用廣東話寫 2-4 句即時建議，必須針對用戶背景。例子：
    • 「午餐肉同即食麵鈉好高，你血壓偏高就少食。下次轉雞胸或蒸魚配灼菜會好啲。」
    • 「白飯偏多容易升血糖，媽媽有糖尿你都要留意。可以轉糙米或加多啲菜，飯量減半。」
    • 「燒味同腸仔屬加工紅肉，爸爸有大腸癌史建議每週唔好過 1-2 次，多食西蘭花、麥皮補纖維。」
  唔好長篇大論，唔好重覆免責聲明，亦唔好每次都列哂三個病——只講同眼前食物最相關嗰個${goalBlock}

PACKAGED_PRODUCT: {"type":"packaged_product","barcode":"the EAN/UPC digits read from the barcode, or null if not legible","brand":"brand name visible on package","productName":"product name (Chinese preferred if visible)","mealType":"breakfast/lunch/dinner/snack/unknown","portion":"portion description e.g. '1 包', '1 罐', '1 樽' or null"}
- ONLY use this type when you can see an actual barcode (the striped code with digits) OR a packaged consumer food/drink product (chips bag, drink bottle, snack wrapper, instant noodle pack, etc.)
- Read the barcode digits carefully — typically 8, 12, or 13 digits below the stripes. If unsure, return null.

FITNESS_STEPS: {"type":"fitness_steps","date":"YYYY-MM-DD or null","steps":number,"distance":"km as string e.g. '5.2' or null","calories":number or null,"walkTime":"e.g. '1h 30m' or null","remarks":"any notes or null"}
- Extract step count, distance, calories from fitness app screenshots
- Samsung Health, Apple Health, Google Fit, Mi Fit, etc.
- If multiple days shown, extract the most prominent/current day's data
- Distance should be in km

OTHER (photos, screenshots, documents, etc.):
{"type":"other","description":"detailed description of what's in the image","scene":"scene type (indoor/outdoor/office/restaurant/street/nature/etc.)","people":{"count":number,"details":[{"description":"person description","estimatedAge":"age range like 25-30","gender":"male/female/unknown"}]},"objects":["notable objects visible"],"text":"any text visible in the image","mood":"overall mood/atmosphere","tags":["relevant tags for organizing"]}
- For people.count: 0 if no people visible
- For people.details: describe each visible person briefly (up to 5)
- Be thorough with the description, scene analysis, and object detection
- If text is visible (signs, screens, documents), extract it

Extract ALL text you can see. Be thorough and detailed.`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this image." },
            { type: "image_url", image_url: { url: `data:${contentType};base64,${base64Data}` } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 800,
    });

    const text = response.choices[0]?.message?.content?.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { type: "other", description: "Unable to analyze" };
  } catch (err) {
    console.error("LINE AI vision error:", err.message);
    return { type: "other", description: "AI analysis failed" };
  }
}

async function handleImageMessage(lineUserId, replyToken, messageId) {
  const user = await findOrLinkUser(lineUserId);
  if (!user) {
    await replyMessage(
      replyToken,
      "請先連結帳號：\n輸入 link 你的email\n例如：link demo@tweek.app"
    );
    return;
  }

  try {
    const { buffer, contentType } = await downloadLineContent(messageId);
    const ext = getExtFromMime(contentType);
    const filename = `${nodeCrypto.randomUUID()}${ext}`;
    const dataBase64 = buffer.toString("base64");
    const now = getUserNow(user);
    const timeStr = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const todayForGoals = userToday(user);
    const todayTotalsForGoals = await getTodayMacroTotals(user.id, todayForGoals);
    const goalCtx = buildGoalContext(user, todayTotalsForGoals);
    const analysis = await analyzeImageWithAI(dataBase64, contentType, goalCtx, user);
    console.log("[LINE Image] AI analysis type:", analysis?.type, "user:", user.id);

    let title = "";
    let content = "";
    let memoColor = "white";
    let noteType = "fleeting";
    let replyMsg = "";
    let tasksCreated = [];

    if (analysis.type === "receipt") {
      title = `🧾 ${analysis.store || "Receipt"} (${timeStr})`;
      const itemLines = (analysis.items || [])
        .map((item) => `• ${item.name}  ${analysis.currency || ""}${item.price}`)
        .join("\n");
      content = `店舖：${analysis.store || "N/A"}\n日期：${analysis.date || timeStr}\n貨幣：${analysis.currency || "N/A"}\n\n${itemLines}\n\n合計：${analysis.currency || ""}${analysis.total || "N/A"}${analysis.notes ? `\n\n備註：${analysis.notes}` : ""}`;
      memoColor = "yellow";
      noteType = "permanent";

      const rawTotal = analysis.total;
      let totalStr = "0";
      if (typeof rawTotal === "number") {
        totalStr = String(rawTotal);
      } else if (typeof rawTotal === "string") {
        const cleaned = rawTotal.replace(/[^0-9.]/g, "");
        totalStr = cleaned || "0";
      }
      const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      let normalizedDate = todayDate;
      const rawDate = (analysis.date || "").toString().trim();
      const m = rawDate.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
      if (m) {
        normalizedDate = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      }
      let expenseSaved = false;
      try {
        const inserted = await db.insert(expenses).values({
          uid: user.id,
          store: analysis.store || "",
          date: normalizedDate,
          currency: analysis.currency || "HKD",
          total: totalStr,
          items: JSON.stringify(analysis.items || []),
          notes: analysis.notes || "",
          category: normalizeCategory(analysis.category, analysis.store, analysis.items),
          source: "line",
        }).returning({ id: expenses.id });
        expenseSaved = inserted && inserted.length > 0;
        console.log("[LINE Image] Expense saved:", inserted);
        if (expenseSaved) {
          try {
            await sendPushToUser(user.id, {
              title: "💰 收據已記帳",
              body: `${analysis.store || "支出"} ${analysis.currency || ""}${analysis.total || "?"}`,
              icon: "/icon-192.png",
              badge: "/icon-192.png",
              data: { type: "expense-added", source: "line-image", expenseId: inserted[0].id, date: normalizedDate },
            });
          } catch (e) {
            console.error("Failed to send expense push:", e.message);
          }
        }
      } catch (e) {
        console.error("Failed to save expense:", e.message, e.stack);
      }

      const receiptCat = normalizeCategory(analysis.category, analysis.store, analysis.items);
      replyMsg = `🧾 收據已記帳！\n\n🏪 ${analysis.store || "N/A"}\n💰 ${analysis.currency || ""}${analysis.total || "?"}\n📦 ${(analysis.items || []).length} 項商品\n📅 ${analysis.date || "今日"}\n🏷 ${formatCategoryForLine(receiptCat)}\n\n${expenseSaved ? "已儲存到記帳簿 💰" : "⚠️ 儲存失敗，請於 app 內檢查"}`;

    } else if (analysis.type === "blood_pressure") {
      const bpSys = parseInt(analysis.sys) || 0;
      const bpDia = parseInt(analysis.dia) || 0;
      const bpPulse = parseInt(analysis.pulse) || 0;
      const bpDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const bpTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      title = `💓 血壓 ${bpSys}/${bpDia} Pulse ${bpPulse} (${timeStr})`;
      content = `SYS：${bpSys}\nDIA：${bpDia}\nPulse：${bpPulse}\n日期：${bpDate}\n時間：${bpTime}`;
      memoColor = "pink";
      noteType = "permanent";

      if (bpSys > 0 && bpDia > 0 && bpPulse > 0) {
        try {
          const insertedBp = await db.insert(bloodPressure).values({
            uid: user.id,
            date: bpDate,
            time: bpTime,
            sys: bpSys,
            dia: bpDia,
            pulse: bpPulse,
            source: "line",
          }).returning({ id: bloodPressure.id });
          try {
            await sendPushToUser(user.id, {
              title: "💓 血壓已記錄",
              body: `${bpSys}/${bpDia} · Pulse ${bpPulse}`,
              icon: "/icon-192.png",
              badge: "/icon-192.png",
              data: { type: "blood-pressure-added", source: "line-image", bpId: insertedBp?.[0]?.id, date: bpDate },
            });
          } catch (e) {
            console.error("Failed to send BP push:", e.message);
          }
        } catch (e) {
          console.error("Failed to save blood pressure:", e.message);
        }
      }

      let bpStatus = "正常 ✅";
      if (bpSys >= 140 || bpDia >= 90) bpStatus = "偏高 ⚠️";
      else if (bpSys >= 130 || bpDia >= 85) bpStatus = "略高 ⚡";
      else if (bpSys >= 120 || bpDia >= 80) bpStatus = "正常偏高";

      replyMsg = `💓 血壓已記錄！\n\n🔴 SYS：${bpSys} mmHg\n🔵 DIA：${bpDia} mmHg\n💗 Pulse：${bpPulse} bpm\n\n📊 狀態：${bpStatus}\n📅 ${bpDate} ${bpTime}\n\n已儲存到血壓記錄 📈`;

    } else if (analysis.type === "food") {
      const rawItems = Array.isArray(analysis.items) ? analysis.items : [];
      const enrichedResult = await enrichItems(rawItems);
      const foodItems = enrichedResult.items;
      const totalCal = enrichedResult.totalCalories || parseInt(analysis.totalCalories) ||
        foodItems.reduce((sum, it) => sum + (parseInt(it.calories) || 0), 0);
      const mealType = analysis.mealType || "unknown";
      const foodDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const foodTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      const mealLabels = {
        breakfast: "🌅 早餐",
        lunch: "☀️ 午餐",
        dinner: "🌙 晚餐",
        snack: "🍪 小食",
        unknown: "🍽️ 餐點",
      };
      const mealLabel = mealLabels[mealType] || mealLabels.unknown;

      const itemLines = foodItems
        .map((it) => `${sourceEmoji(it.source)} ${it.name || "?"}${it.portion ? `（${it.portion}）` : ""} ~ ${it.calories || 0} kcal`)
        .join("\n");

      title = `🍽️ ${mealLabel} ${totalCal} kcal (${timeStr})`;
      content = `${mealLabel}\n日期：${foodDate} ${foodTime}\n\n${itemLines}\n\n總卡路里：約 ${totalCal} kcal${sourcesFooter(foodItems)}`;
      memoColor = "orange";
      noteType = "permanent";

      const aiTotalImg = parseInt(analysis.totalCalories) || 0;
      const aiHealthScoreImg = Math.max(0, Math.min(10, parseInt(analysis.healthScore) || 0));
      const healthScore = adjustHealthScoreForCalories(aiHealthScoreImg, aiTotalImg, totalCal);
      const suggestion = (analysis.suggestion || "").toString().trim();

      try {
        const insertedFood = await db.insert(foodLog).values({
          uid: user.id,
          date: foodDate,
          time: foodTime,
          items: JSON.stringify(foodItems),
          totalCalories: totalCal,
          mealType,
          suggestion,
          healthScore,
          source: "line",
        }).returning({ id: foodLog.id });
        if (insertedFood && insertedFood.length > 0) {
          try {
            await sendPushToUser(user.id, {
              title: "🍽️ 食物已記錄",
              body: `${mealLabel} ~ ${totalCal} kcal`,
              icon: "/icon-192.png",
              badge: "/icon-192.png",
              data: { type: "food-added", source: "line-image", foodId: insertedFood[0].id, date: foodDate },
            });
          } catch (e) {
            console.error("Failed to send food push:", e.message);
          }
          rememberLastFoodLog(lineUserId, insertedFood[0].id, {
            items: foodItems,
            totalCalories: totalCal,
            mealType,
            date: foodDate,
            time: foodTime,
            suggestion,
            healthScore,
          });
        }
      } catch (e) {
        console.error("Failed to save food log:", e.message);
      }

      const scoreEmoji = healthScore >= 8 ? "🟢" : healthScore >= 5 ? "🟡" : healthScore > 0 ? "🔴" : "⚪";
      const scoreLine = healthScore > 0 ? `\n${scoreEmoji} 健康評分：${healthScore}/10` : "";

      replyMsg = `🍽️ 食物已記錄！\n\n${mealLabel}\n`;
      foodItems.forEach((it) => {
        replyMsg += `\n${sourceEmoji(it.source)} ${it.name || "?"}${it.portion ? `（${it.portion}）` : ""} ~ ${it.calories || 0} kcal`;
      });
      replyMsg += `\n\n🔥 總卡路里：約 ${totalCal} kcal${scoreLine}`;
      {
        const macroLine = formatMacroSummary(foodItems);
        if (macroLine) replyMsg += `\n📊 ${macroLine}`;
      }
      replyMsg += `\n📅 ${foodDate} ${foodTime}${sourcesFooter(foodItems)}`;
      if (suggestion) {
        replyMsg += `\n\n💡 飲食建議：\n${suggestion}`;
      }
      replyMsg += formatGoalCoachingForReply(goalCtx, sumMacros(foodItems));
      replyMsg += `\n\n已儲存到飲食記錄 ✅`;

    } else if (analysis.type === "fitness_steps") {
      const stepsCount = parseInt(analysis.steps) || 0;
      const stepsDate = analysis.date || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

      title = `🚶 步數 ${stepsCount.toLocaleString()} (${timeStr})`;
      content = `步數：${stepsCount}\n距離：${analysis.distance || "N/A"} km\n卡路里：${analysis.calories || "N/A"}\n步行時間：${analysis.walkTime || "N/A"}\n日期：${stepsDate}`;
      memoColor = "green";
      noteType = "permanent";

      if (stepsCount > 0) {
        try {
          const insertedStepsImg = await db.insert(steps).values({
            uid: user.id,
            date: stepsDate,
            steps: stepsCount,
            distance: analysis.distance || null,
            calories: analysis.calories ? parseInt(analysis.calories) : null,
            walkTime: analysis.walkTime || null,
            remarks: analysis.remarks || null,
            source: "line",
          }).returning({ id: steps.id });
          try {
            await sendPushToUser(user.id, {
              title: "🚶 步數已記錄",
              body: `${stepsCount.toLocaleString()} 步`,
              icon: "/icon-192.png",
              badge: "/icon-192.png",
              data: { type: "steps-added", source: "line-image", stepsId: insertedStepsImg?.[0]?.id, date: stepsDate },
            });
          } catch (e) {
            console.error("Failed to send steps push:", e.message);
          }
        } catch (e) {
          console.error("Failed to save steps:", e.message);
        }
      }

      let stepsLevel = "🔴 Low";
      if (stepsCount >= 10000) stepsLevel = "🟢 Excellent";
      else if (stepsCount >= 7500) stepsLevel = "🟢 Active";
      else if (stepsCount >= 5000) stepsLevel = "🟡 Moderate";
      else if (stepsCount >= 2500) stepsLevel = "🟠 Light";

      replyMsg = `🚶 步數已記錄！\n\n👟 ${stepsCount.toLocaleString()} 步`;
      if (analysis.distance) replyMsg += `\n📏 ${analysis.distance} km`;
      if (analysis.calories) replyMsg += `\n🔥 ${analysis.calories} cal`;
      if (analysis.walkTime) replyMsg += `\n⏱ ${analysis.walkTime}`;
      replyMsg += `\n📊 ${stepsLevel}`;
      replyMsg += `\n📅 ${stepsDate}`;
      replyMsg += `\n\n已儲存到健康記錄 ✅`;

    } else if (analysis.type === "packaged_product") {
      const barcode = (analysis.barcode || "").toString().replace(/\D/g, "");
      const fallbackName = analysis.productName || analysis.brand || "Packaged item";
      const portion = analysis.portion || null;
      const mealTypeRaw = analysis.mealType || "snack";
      const mealType = ["breakfast", "lunch", "dinner", "snack", "unknown"].includes(mealTypeRaw) ? mealTypeRaw : "snack";
      const foodDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const foodTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const mealLabels = {
        breakfast: "🌅 早餐",
        lunch: "☀️ 午餐",
        dinner: "🌙 晚餐",
        snack: "🍪 小食",
        unknown: "🍽️ 餐點",
      };
      const mealLabel = mealLabels[mealType];

      let off = null;
      if (barcode) {
        try { off = await lookupByBarcode(barcode); } catch (e) { console.error("[LINE] OFF lookup error:", e.message); }
      }

      if (off && off.calories > 0) {
        const itemName = off.name || fallbackName;
        const itemObj = {
          name: itemName,
          portion: portion || off.servingDescription || null,
          calories: off.calories,
          source: "openfoodfacts",
          barcode,
          servingDescription: off.servingDescription || null,
          protein: off.protein != null ? off.protein : null,
          carbs: off.carbs != null ? off.carbs : null,
          fat: off.fat != null ? off.fat : null,
          sodium: off.sodium != null ? off.sodium : null,
        };
        const items = [itemObj];
        const totalCal = off.calories;

        title = `🍽️ ${mealLabel} ${totalCal} kcal (${timeStr})`;
        content = `${mealLabel}\n日期：${foodDate} ${foodTime}\n\n${sourceEmoji("openfoodfacts")} ${itemName}（${itemObj.portion || "1 份"}）~ ${totalCal} kcal\n\n總卡路里：約 ${totalCal} kcal${sourcesFooter(items)}`;
        memoColor = "orange";
        noteType = "permanent";

        let foodSaved = false;
        try {
          const insertedFood = await db.insert(foodLog).values({
            uid: user.id,
            date: foodDate,
            time: foodTime,
            items: JSON.stringify(items),
            totalCalories: totalCal,
            mealType,
            suggestion: "",
            healthScore: 0,
            source: "line",
          }).returning({ id: foodLog.id });
          foodSaved = insertedFood && insertedFood.length > 0;
          if (foodSaved) {
            try {
              await sendPushToUser(user.id, {
                title: "🍽️ 食物已記錄",
                body: `${mealLabel} ~ ${totalCal} kcal`,
                icon: "/icon-192.png",
                badge: "/icon-192.png",
                data: { type: "food-added", source: "line-barcode", foodId: insertedFood[0].id, date: foodDate },
              });
            } catch (e) { console.error("Failed to send food push:", e.message); }
            rememberLastFoodLog(lineUserId, insertedFood[0].id, {
              items,
              totalCalories: totalCal,
              mealType,
              date: foodDate,
              time: foodTime,
              suggestion: "",
              healthScore: 0,
            });
          }
        } catch (e) { console.error("Failed to save barcode food:", e.message); }

        replyMsg = `📦 包裝食品已記錄！\n\n${mealLabel}\n${sourceEmoji("openfoodfacts")} ${itemName}`;
        if (itemObj.portion) replyMsg += `（${itemObj.portion}）`;
        replyMsg += `\n🔥 ${totalCal} kcal`;
        {
          const macroLine = formatMacroSummary(items);
          if (macroLine) replyMsg += `\n📊 ${macroLine}`;
        }
        replyMsg += `\n📅 ${foodDate} ${foodTime}${sourcesFooter(items)}`;
        if (foodSaved) {
          replyMsg += formatGoalCoachingForReply(goalCtx, sumMacros(items));
        }
        replyMsg += foodSaved ? `\n\n已儲存到飲食記錄 ✅` : `\n\n⚠️ 儲存失敗，請於 app 內檢查`;
      } else {
        const guess = fallbackName;
        const portionStr = portion || "1 份";
        const aiPrompt = `${mealLabel.replace(/^[^\s]+\s/, "")} 食咗 ${guess}（${portionStr}）`;
        let aiItems = [];
        let aiTotal = 0;
        let aiHealthScore = 0;
        let aiSuggestion = "";
        try {
          const aiParsed = await parseFoodWithAI(aiPrompt, goalCtx, user);
          if (aiParsed && Array.isArray(aiParsed.items) && aiParsed.items.length > 0) {
            aiItems = aiParsed.items;
            aiTotal = parseInt(aiParsed.totalCalories) || aiItems.reduce((s, it) => s + (parseInt(it.calories) || 0), 0);
            aiHealthScore = Math.max(0, Math.min(10, parseInt(aiParsed.healthScore) || 0));
            aiSuggestion = (aiParsed.suggestion || "").toString().trim();
          }
        } catch (e) { console.error("Failed AI fallback for packaged miss:", e.message); }

        if (aiItems.length === 0) {
          aiItems = [{ name: guess, portion: portionStr, calories: 0 }];
        }
        const items = aiItems.map(it => ({
          ...it,
          calories: parseInt(it.calories) || 0,
          source: "ai",
          barcode: barcode || null,
        }));
        const totalCal = aiTotal || items.reduce((s, it) => s + (it.calories || 0), 0);

        title = `🍽️ ${mealLabel} ${totalCal} kcal (${timeStr})`;
        const itemLines = items.map(it => `${sourceEmoji("ai")} ${it.name || "?"}${it.portion ? `（${it.portion}）` : ""} ~ ${it.calories || 0} kcal`).join("\n");
        content = `${mealLabel}\n日期：${foodDate} ${foodTime}\n\n${itemLines}\n\n總卡路里：約 ${totalCal} kcal${barcode ? `\nBarcode：${barcode}（Open Food Facts 無資料，用咗 AI 估算）` : "（睇唔到 barcode，用咗 AI 估算）"}${aiSuggestion ? `\n\n💡 ${aiSuggestion}` : ""}`;
        memoColor = "orange";
        noteType = "permanent";

        let foodSaved = false;
        try {
          const insertedFood = await db.insert(foodLog).values({
            uid: user.id,
            date: foodDate,
            time: foodTime,
            items: JSON.stringify(items),
            totalCalories: totalCal,
            mealType,
            suggestion: aiSuggestion,
            healthScore: aiHealthScore,
            source: "line",
          }).returning({ id: foodLog.id });
          foodSaved = insertedFood && insertedFood.length > 0;
          if (foodSaved) {
            try {
              await sendPushToUser(user.id, {
                title: "🍽️ 食物已記錄",
                body: `${mealLabel} ~ ${totalCal} kcal`,
                icon: "/icon-192.png",
                badge: "/icon-192.png",
                data: { type: "food-added", source: "line-barcode-miss", foodId: insertedFood[0].id, date: foodDate },
              });
            } catch (e) { console.error("Failed to send food push:", e.message); }
            rememberLastFoodLog(lineUserId, insertedFood[0].id, {
              items,
              totalCalories: totalCal,
              mealType,
              date: foodDate,
              time: foodTime,
              suggestion: aiSuggestion,
              healthScore: aiHealthScore,
            });
          }
        } catch (e) { console.error("Failed to save fallback packaged food:", e.message); }

        const scoreEmoji = aiHealthScore >= 8 ? "🟢" : aiHealthScore >= 5 ? "🟡" : aiHealthScore > 0 ? "🔴" : "⚪";
        const scoreLine = aiHealthScore > 0 ? `\n${scoreEmoji} 健康評分：${aiHealthScore}/10` : "";
        replyMsg = `📦 睇到包裝食品（OFF 暫時搵唔到，用咗 🤖 AI 估算）\n\n${mealLabel}\n${itemLines}\n\n🔥 總卡路里：約 ${totalCal} kcal${scoreLine}\n📅 ${foodDate} ${foodTime}`;
        if (barcode) replyMsg += `\n📊 Barcode：${barcode}`;
        if (aiSuggestion) replyMsg += `\n\n💡 飲食建議：\n${aiSuggestion}`;
        if (foodSaved) {
          replyMsg += formatGoalCoachingForReply(goalCtx, sumMacros(items));
        }
        replyMsg += foodSaved ? `\n\n已儲存到飲食記錄 ✅` : `\n\n⚠️ 儲存失敗，請於 app 內檢查`;
      }

    } else if (analysis.type === "schedule") {
      const events = analysis.events || [];
      title = `📅 Schedule (${timeStr})`;
      content = events
        .map((e) => `• ${e.date || "?"} ${e.startTime || ""} ${e.name}${e.location ? ` @ ${e.location}` : ""}`)
        .join("\n");
      memoColor = "blue";
      noteType = "permanent";

      for (const event of events) {
        if (event.name) {
          const taskData = {
            uid: user.id,
            name: event.name,
            color: "white text-black dark:text-white dark:bg-black",
            date: event.date || "notes",
            done: false,
            order: 0,
            description: event.location ? `📍 ${event.location}` : "",
            startTime: event.startTime || null,
            endDate: event.date || null,
            endTime: event.endTime || "24:00",
          };
          await db.insert(tasks).values(taskData);
          tasksCreated.push(event);
        }
      }

      replyMsg = `📅 Schedule 已提取！\n\n`;
      if (tasksCreated.length > 0) {
        replyMsg += `✅ 已建立 ${tasksCreated.length} 個 Task：\n`;
        tasksCreated.forEach((e) => {
          replyMsg += `• ${e.date || "?"} ${e.startTime || ""} ${e.name}\n`;
        });
      }
      replyMsg += `\n原圖同詳情已存到 Memos 📝`;

    } else if (analysis.type === "business_card") {
      title = `📇 ${analysis.name || "Contact"} — ${analysis.company || ""}`;
      const fields = [];
      if (analysis.name) fields.push(`姓名：${analysis.name}`);
      if (analysis.company) fields.push(`公司：${analysis.company}`);
      if (analysis.title) fields.push(`職位：${analysis.title}`);
      if (analysis.phone) fields.push(`電話：${analysis.phone}`);
      if (analysis.email) fields.push(`Email：${analysis.email}`);
      if (analysis.address) fields.push(`地址：${analysis.address}`);
      if (analysis.website) fields.push(`網站：${analysis.website}`);
      if (analysis.other) fields.push(`其他：${analysis.other}`);
      content = fields.join("\n");
      memoColor = "green";
      noteType = "permanent";

      replyMsg = `📇 名片已提取！\n\n👤 ${analysis.name || "N/A"}\n🏢 ${analysis.company || ""} ${analysis.title || ""}\n📱 ${analysis.phone || "N/A"}\n📧 ${analysis.email || "N/A"}\n\n已儲存到 Memos 📝`;

    } else {
      const people = analysis.people || { count: 0, details: [] };
      const hasScene = analysis.scene && analysis.scene !== "unknown";
      const tags = analysis.tags || [];

      title = people.count > 0
        ? `📸 ${people.count} 人 — ${analysis.scene || "Photo"} (${timeStr})`
        : `📸 ${analysis.scene || "Photo"} (${timeStr})`;

      const contentParts = [];
      if (analysis.description) contentParts.push(`描述：${analysis.description}`);
      if (hasScene) contentParts.push(`場景：${analysis.scene}`);
      if (analysis.mood) contentParts.push(`氛圍：${analysis.mood}`);

      if (people.count > 0) {
        contentParts.push(`\n👥 人物（${people.count} 人）：`);
        (people.details || []).forEach((p, i) => {
          const parts = [];
          if (p.description) parts.push(p.description);
          if (p.estimatedAge) parts.push(`約 ${p.estimatedAge} 歲`);
          if (p.gender && p.gender !== "unknown") parts.push(p.gender === "male" ? "男" : "女");
          contentParts.push(`  ${i + 1}. ${parts.join("，")}`);
        });
      }

      if ((analysis.objects || []).length > 0) {
        contentParts.push(`\n🔎 物件：${analysis.objects.join("、")}`);
      }
      if (analysis.text) {
        contentParts.push(`\n📝 文字：${analysis.text}`);
      }
      if (tags.length > 0) {
        contentParts.push(`\n🏷️ Tags：${tags.join("、")}`);
      }

      content = contentParts.join("\n");
      memoColor = people.count > 0 ? "pink" : "white";

      replyMsg = `📸 相片分析完成！\n`;
      if (analysis.description) replyMsg += `\n🔍 ${analysis.description}`;
      if (hasScene) replyMsg += `\n🏞️ 場景：${analysis.scene}`;
      if (people.count > 0) {
        replyMsg += `\n👥 ${people.count} 人`;
        (people.details || []).slice(0, 3).forEach((p) => {
          const info = [];
          if (p.estimatedAge) info.push(`~${p.estimatedAge}`);
          if (p.gender && p.gender !== "unknown") info.push(p.gender === "male" ? "男" : "女");
          if (info.length) replyMsg += `\n   • ${p.description || ""} (${info.join(", ")})`;
        });
      }
      if ((analysis.objects || []).length > 0) {
        replyMsg += `\n🔎 ${analysis.objects.slice(0, 5).join("、")}`;
      }
      if (analysis.text) {
        replyMsg += `\n📝 「${analysis.text.substring(0, 80)}${analysis.text.length > 80 ? "..." : ""}」`;
      }
      replyMsg += `\n\n已儲存到 Memos 📎`;
    }

    const [newMemo] = await db
      .insert(memos)
      .values({
        uid: user.id,
        title,
        content,
        date: userToday(user),
        color: memoColor,
        noteType,
      })
      .returning();

    await db.insert(memoFiles).values({
      memoId: newMemo.id,
      filename,
      originalName: `line_photo${ext}`,
      url: `/api/file-data/${filename}`,
      mimeType: contentType,
      data: dataBase64,
    });

    await replyMessage(replyToken, replyMsg);
  } catch (err) {
    console.error("LINE image save error:", err);
    await replyMessage(replyToken, "⚠️ 儲存相片時出錯，請稍後再試。");
  }
}

async function handleVideoMessage(lineUserId, replyToken, messageId) {
  const user = await findOrLinkUser(lineUserId);
  if (!user) {
    await replyMessage(
      replyToken,
      "請先連結帳號：\n輸入 link 你的email"
    );
    return;
  }

  try {
    const { buffer, contentType } = await downloadLineContent(messageId);

    if (buffer.length > 10 * 1024 * 1024) {
      await replyMessage(replyToken, "⚠️ 影片太大（超過 10MB），暫時儲存唔到 😅");
      return;
    }

    const ext = getExtFromMime(contentType);
    const filename = `${nodeCrypto.randomUUID()}${ext}`;
    const dataBase64 = buffer.toString("base64");
    const now = getUserNow(user);
    const timeStr = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const title = `LINE Video ${timeStr}`;

    const [newMemo] = await db
      .insert(memos)
      .values({
        uid: user.id,
        title,
        content: "",
        date: userToday(user),
        color: "white",
        noteType: "fleeting",
      })
      .returning();

    await db.insert(memoFiles).values({
      memoId: newMemo.id,
      filename,
      originalName: `line_video${ext}`,
      url: `/api/file-data/${filename}`,
      mimeType: contentType,
      data: dataBase64,
    });

    const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
    await replyMessage(
      replyToken,
      `🎬 已儲存影片到 Memo！\n\n📝 ${title}\n💾 ${sizeMB} MB`
    );
  } catch (err) {
    console.error("LINE video save error:", err);
    await replyMessage(replyToken, "⚠️ 儲存影片時出錯，請稍後再試。");
  }
}

async function transcribeAudio(buffer, contentType) {
  try {
    const ext = contentType?.includes("mp4") || contentType?.includes("m4a") ? "m4a" : "ogg";
    const file = new File([buffer], `audio.${ext}`, { type: contentType || "audio/m4a" });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: undefined,
    });

    return transcription.text || "";
  } catch (err) {
    console.error("Whisper transcription error:", err.message);
    return "";
  }
}

async function handleAudioMessage(lineUserId, replyToken, messageId) {
  const user = await findOrLinkUser(lineUserId);
  if (!user) {
    await replyMessage(replyToken, "請先連結帳號：\n輸入 link 你的email\n例如：link demo@tweek.app");
    return;
  }

  try {
    const { buffer, contentType } = await downloadLineContent(messageId);

    if (buffer.length > 15 * 1024 * 1024) {
      await replyMessage(replyToken, "⚠️ 語音太長（超過 15MB），暫時處理唔到 😅");
      return;
    }

    const transcribedText = await transcribeAudio(buffer, contentType);

    if (!transcribedText || transcribedText.trim().length === 0) {
      const ext = ".m4a";
      const filename = `${nodeCrypto.randomUUID()}${ext}`;
      const dataBase64 = buffer.toString("base64");
      const now = getUserNow(user);
      const timeStr = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      const [newMemo] = await db
        .insert(memos)
        .values({
          uid: user.id,
          title: `🎙️ Voice Memo ${timeStr}`,
          content: "(語音無法辨識文字)",
          date: userToday(user),
          color: "white",
          noteType: "fleeting",
        })
        .returning();

      await db.insert(memoFiles).values({
        memoId: newMemo.id,
        filename,
        originalName: `voice_memo${ext}`,
        url: `/api/file-data/${filename}`,
        mimeType: contentType || "audio/m4a",
        data: dataBase64,
      });

      await replyMessage(replyToken, "🎙️ 語音已儲存，但無法辨識文字。\n\n原檔已存到 Memos 📎");
      return;
    }

    const ext = ".m4a";
    const filename = `${nodeCrypto.randomUUID()}${ext}`;
    const dataBase64 = buffer.toString("base64");
    const now = getUserNow(user);
    const timeStr = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const durationSec = Math.round(buffer.length / 8000);

    const classifyResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You classify voice transcriptions. Return ONLY valid JSON.
Classify the transcribed text into one of:
- "task" — if the person is describing something they need to do, a reminder, or a to-do item
- "memo" — if it's a note, thought, idea, or information to remember
- "chat" — if it's a question or conversation

Return: {"type":"task|memo|chat","refined":"cleaned up version of what they said, fix grammar but keep meaning and language"}`,
        },
        { role: "user", content: transcribedText },
      ],
      temperature: 0,
      max_tokens: 300,
    });

    let classification = { type: "memo", refined: transcribedText };
    try {
      const cText = classifyResponse.choices[0]?.message?.content?.trim();
      const cMatch = cText.match(/\{[\s\S]*\}/);
      if (cMatch) classification = JSON.parse(cMatch[0]);
    } catch {}

    const [voiceMemo] = await db
      .insert(memos)
      .values({
        uid: user.id,
        title: `🎙️ Voice ${timeStr}`,
        content: `📝 原文：${transcribedText}\n\n✨ 整理：${classification.refined || transcribedText}`,
        date: userToday(user),
        color: "orange",
        noteType: "fleeting",
      })
      .returning();

    await db.insert(memoFiles).values({
      memoId: voiceMemo.id,
      filename,
      originalName: `voice_memo${ext}`,
      url: `/api/file-data/${filename}`,
      mimeType: contentType || "audio/m4a",
      data: dataBase64,
    });

    let replyMsg = `🎙️ 語音轉文字完成！\n\n`;
    replyMsg += `📝「${transcribedText.substring(0, 100)}${transcribedText.length > 100 ? "..." : ""}」\n`;

    if (classification.type === "task") {
      const taskName = (classification.refined || transcribedText).substring(0, 100);
      await db.insert(tasks).values({
        uid: user.id,
        name: taskName,
        color: "white text-black dark:text-white dark:bg-black",
        date: userToday(user),
        done: false,
        order: 0,
        description: `🎙️ 語音輸入：${transcribedText}`,
      });
      replyMsg += `\n✅ 已建立 Task：${taskName}`;
    } else if (classification.type === "chat") {
      addChatHistory(lineUserId, "user", classification.refined || transcribedText);
      const history = getChatHistory(lineUserId);
      const skill = activeSkills.get(lineUserId) || "default";
      const allUserTasks = await db.select().from(tasks).where(and(eq(tasks.uid, user.id), eq(tasks.done, false)));
      const __today = userToday(user);
      const todayTasks = allUserTasks.filter((t) => t.date === __today);
      let sysPrompt = getSkillSystemPrompt(skill, user, __today, todayTasks, allUserTasks);

      const pdfCtx = pdfContextMap.get(lineUserId);
      if (pdfCtx && Date.now() - pdfCtx.timestamp < 30 * 60 * 1000) {
        sysPrompt += `\n\n--- PDF CONTEXT ---\nPDF: "${pdfCtx.fileName}"\n${pdfCtx.summary ? `Summary: ${pdfCtx.summary}\n` : ""}${pdfCtx.text.substring(0, 8000)}\n--- END PDF ---`;
      }

      try {
        const chatResp = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: sysPrompt },
            ...history.map((m) => ({ role: m.role, content: m.content })),
          ],
          temperature: 0.7,
          max_tokens: 400,
        });
        const aiReply = chatResp.choices[0]?.message?.content?.trim();
        if (aiReply) {
          addChatHistory(lineUserId, "assistant", aiReply);
          replyMsg += `\n💬 ${aiReply}`;
        }
      } catch {}
    }

    replyMsg += `\n\n語音同文字已存到 Memos 📎`;
    await replyMessage(replyToken, replyMsg);

  } catch (err) {
    console.error("LINE audio handler error:", err);
    await replyMessage(replyToken, "⚠️ 處理語音時出錯，請稍後再試。");
  }
}

async function extractPdfText(buffer) {
  try {
    const data = await pdfParse(buffer);
    return { text: data.text || "", pages: data.numpages || 0 };
  } catch (err) {
    console.error("PDF parse error:", err.message);
    return { text: "", pages: 0 };
  }
}

async function analyzePdfWithAI(pdfText, fileName) {
  const truncated = pdfText.substring(0, 12000);
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a document analyst. Analyze the following PDF text content and return a JSON response.

Return ONLY valid JSON with this structure:
{
  "summary": "concise summary of the document in 3-5 sentences (use the same language as the document)",
  "keyPoints": ["key point 1", "key point 2", ...],
  "category": "one of: report, article, contract, invoice, manual, academic, letter, presentation, form, other",
  "language": "detected language",
  "actionItems": ["any action items, tasks, or deadlines found"],
  "entities": ["important names, organizations, dates, amounts mentioned"]
}

Be thorough but concise. Extract ALL action items, deadlines, and important entities.`,
        },
        {
          role: "user",
          content: `Analyze this PDF document (filename: "${fileName}"):\n\n${truncated}`,
        },
      ],
      temperature: 0,
      max_tokens: 1000,
    });

    const text = response.choices[0]?.message?.content?.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (err) {
    console.error("PDF AI analysis error:", err.message);
    return null;
  }
}

const pdfContextMap = new Map();

async function handleFileMessage(lineUserId, replyToken, messageId, fileName) {
  const user = await findOrLinkUser(lineUserId);
  if (!user) {
    await replyMessage(replyToken, "請先連結帳號：\n輸入 link 你的email");
    return;
  }

  try {
    const { buffer, contentType } = await downloadLineContent(messageId);

    if (buffer.length > 10 * 1024 * 1024) {
      await replyMessage(replyToken, "⚠️ 檔案太大（超過 10MB），暫時儲存唔到 😅");
      return;
    }

    const ext = fileName ? fileName.substring(fileName.lastIndexOf(".")) : getExtFromMime(contentType);
    const storedFilename = `${nodeCrypto.randomUUID()}${ext}`;
    const dataBase64 = buffer.toString("base64");
    const now = getUserNow(user);
    const timeStr = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const isPdf = ext?.toLowerCase() === ".pdf" || contentType === "application/pdf";

    let title = "";
    let content = "";
    let memoColor = "white";
    let noteType = "fleeting";
    let replyMsg = "";

    if (isPdf) {
      const { text: pdfText, pages } = await extractPdfText(buffer);
      const analysis = pdfText.length > 50 ? await analyzePdfWithAI(pdfText, fileName || "document.pdf") : null;

      if (analysis) {
        title = `📄 ${fileName || "PDF"} — ${analysis.category || "document"}`;
        const contentParts = [];
        contentParts.push(`📊 ${pages} 頁 | ${analysis.language || "N/A"} | ${analysis.category || "document"}`);
        contentParts.push(`\n📝 摘要：\n${analysis.summary}`);

        if ((analysis.keyPoints || []).length > 0) {
          contentParts.push(`\n🔑 重點：`);
          analysis.keyPoints.forEach((p) => contentParts.push(`• ${p}`));
        }

        if ((analysis.actionItems || []).length > 0) {
          contentParts.push(`\n✅ 行動項目：`);
          analysis.actionItems.forEach((a) => contentParts.push(`• ${a}`));
        }

        if ((analysis.entities || []).length > 0) {
          contentParts.push(`\n🏷️ 重要資料：${analysis.entities.join("、")}`);
        }

        contentParts.push(`\n\n--- 原文（前 2000 字）---\n${pdfText.substring(0, 2000)}`);

        content = contentParts.join("\n");
        memoColor = "purple";
        noteType = "literature";

        pdfContextMap.set(lineUserId, {
          fileName: fileName || "PDF",
          text: pdfText.substring(0, 15000),
          summary: analysis.summary,
          timestamp: Date.now(),
        });

        for (const item of (analysis.actionItems || [])) {
          if (item && item.length > 2) {
            await db.insert(tasks).values({
              uid: user.id,
              name: item.substring(0, 100),
              color: "white text-black dark:text-white dark:bg-black",
              date: userToday(user),
              done: false,
              order: 0,
              description: `From PDF: ${fileName || "document"}`,
            });
          }
        }

        const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
        replyMsg = `📄 PDF 分析完成！\n\n📁 ${fileName || "document.pdf"}\n📊 ${pages} 頁 | ${sizeMB} MB\n📂 ${analysis.category || "document"}\n\n📝 ${analysis.summary.substring(0, 150)}${analysis.summary.length > 150 ? "..." : ""}`;

        if ((analysis.keyPoints || []).length > 0) {
          replyMsg += `\n\n🔑 重點：`;
          analysis.keyPoints.slice(0, 3).forEach((p) => {
            replyMsg += `\n• ${p.substring(0, 60)}${p.length > 60 ? "..." : ""}`;
          });
        }

        if ((analysis.actionItems || []).length > 0) {
          replyMsg += `\n\n✅ 已建立 ${analysis.actionItems.length} 個 Task`;
        }

        replyMsg += `\n\n💬 你可以繼續問我關於呢份 PDF 嘅問題！`;

      } else {
        title = `📄 ${fileName || "PDF"} (${timeStr})`;
        content = pdfText ? `原文（前 2000 字）：\n${pdfText.substring(0, 2000)}` : "(無法提取文字 — 可能係掃描版 PDF)";
        memoColor = "purple";
        noteType = "literature";

        if (pdfText.length > 50) {
          pdfContextMap.set(lineUserId, {
            fileName: fileName || "PDF",
            text: pdfText.substring(0, 15000),
            summary: "",
            timestamp: Date.now(),
          });
        }

        replyMsg = `📄 PDF 已儲存！\n\n📁 ${fileName || "document.pdf"}\n📊 ${pages} 頁\n${pdfText.length > 50 ? "\n💬 你可以問我呢份 PDF 嘅內容！" : "\n⚠️ 無法提取文字（可能係掃描版）"}`;
      }

    } else {
      title = `📁 ${fileName || "attachment"} (${timeStr})`;
      replyMsg = `📁 已儲存檔案到 Memo！\n\n📝 ${fileName || "attachment"}\n💾 ${(buffer.length / 1024 / 1024).toFixed(1)} MB`;
    }

    const [newMemo] = await db
      .insert(memos)
      .values({
        uid: user.id,
        title,
        content,
        date: userToday(user),
        color: memoColor,
        noteType,
      })
      .returning();

    await db.insert(memoFiles).values({
      memoId: newMemo.id,
      filename: storedFilename,
      originalName: fileName || `line_file${ext}`,
      url: `/api/file-data/${storedFilename}`,
      mimeType: contentType,
      data: dataBase64,
    });

    await replyMessage(replyToken, replyMsg);
  } catch (err) {
    console.error("LINE file save error:", err);
    await replyMessage(replyToken, "⚠️ 儲存檔案時出錯，請稍後再試。");
  }
}

async function pushMessage(userId, text, options = {}) {
  const maxLen = 5000;
  const truncated = text.length > maxLen ? text.substring(0, maxLen - 3) + "..." : text;
  const messageObj = { type: "text", text: truncated };
  if (options && options.quickReply) messageObj.quickReply = options.quickReply;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LINE_TOKEN}`,
      },
      body: JSON.stringify({
        to: userId,
        messages: [messageObj],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`LINE push failed ${res.status}: ${errBody.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

const HKO_ICON_EMOJI = {
  50: '☀️', 51: '🌤', 52: '⛅', 53: '☁️', 54: '🌧', 60: '🌦', 61: '🌦',
  62: '🌧', 63: '⛈', 64: '⛈', 65: '⛈', 70: '☀️', 71: '☀️', 72: '⛅',
  73: '☁️', 74: '🌧', 75: '🌦', 76: '☁️', 77: '☀️', 80: '💨', 81: '🏜',
  82: '💧', 83: '🌫', 84: '🌫', 85: '🌫', 90: '🔥', 91: '🥶', 92: '☀️🔥', 93: '☀️',
};

async function fetchWithTimeout(url, ms = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

const TC_SIGNAL_NAMES = {
  'TC1': '一號戒備信號',
  'TC3': '三號強風信號',
  'TC8NE': '八號東北烈風或暴風信號',
  'TC8SE': '八號東南烈風或暴風信號',
  'TC8NW': '八號西北烈風或暴風信號',
  'TC8SW': '八號西南烈風或暴風信號',
  'TC9': '九號烈風或暴風風力增強信號',
  'TC10': '十號颶風信號',
};

async function fetchHKWeather() {
  try {
    const base = 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?lang=tc&dataType=';
    const [current, forecast, local, warnsum] = await Promise.all([
      fetchWithTimeout(base + 'rhrread'),
      fetchWithTimeout(base + 'fnd'),
      fetchWithTimeout(base + 'flw'),
      fetchWithTimeout(base + 'warnsum'),
    ]);

    let tctrack = null;
    if (warnsum && warnsum.WTCSGNL) {
      try {
        tctrack = await fetchWithTimeout(base + 'tctrack');
      } catch (e) {}
    }

    return { current, forecast, local, warnsum, tctrack };
  } catch (e) {
    console.error("Failed to fetch HKO weather:", e.message);
    return null;
  }
}

function formatWeatherMessage(data) {
  if (!data) return null;
  const { current, forecast, local, warnsum, tctrack } = data;

  const hkoTemp = current?.temperature?.data?.find(t => t.place === '香港天文台');
  const mainIcon = current?.icon?.[0];
  const iconEmoji = HKO_ICON_EMOJI[mainIcon] || '🌤';
  const humidity = current?.humidity?.data?.[0];
  const uvData = current?.uvindex?.data?.[0];
  const warnings = current?.warningMessage || [];

  let msg = `${iconEmoji} 香港天氣日報\n`;
  msg += `━━━━━━━━━━━━━━\n`;
  if (hkoTemp) msg += `🌡 現時氣溫：${hkoTemp.value}°C\n`;
  if (humidity) msg += `💧 濕度：${humidity.value}%\n`;
  if (uvData) msg += `☀️ 紫外線：${uvData.value} (${uvData.desc})\n`;
  msg += `\n`;

  const tcSignal = warnsum?.WTCSGNL;
  if (tcSignal) {
    const signalCode = tcSignal.subtype || tcSignal.code;
    const signalName = TC_SIGNAL_NAMES[signalCode] || signalCode;
    msg += `🌀 熱帶氣旋警告\n`;
    msg += `⚠️ 現正懸掛：${signalName}\n`;

    const tcs = tctrack?.tropicalCyclone || (Array.isArray(tctrack) ? tctrack : []);
    if (tcs.length > 0) {
      tcs.forEach(tc => {
        const name = tc.tcName || tc.tcId || '';
        if (name) msg += `🌪 ${name}`;
        if (tc.tcNameEN) msg += ` (${tc.tcNameEN})`;
        msg += `\n`;

        const latest = tc.pastTrack?.[tc.pastTrack.length - 1];
        if (latest) {
          msg += `📍 位置：${latest.lat}°N ${latest.lng}°E\n`;
          if (latest.maxWind) msg += `💨 最高風速：${latest.maxWind} km/h\n`;
          if (latest.minSLP) msg += `📉 中心氣壓：${latest.minSLP} hPa\n`;
        }

        const ftrack = tc.forecastTrack || [];
        if (ftrack.length > 0) {
          msg += `📐 預測路徑：\n`;
          ftrack.slice(0, 4).forEach(ft => {
            const t = ft.time ? new Date(ft.time).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
            msg += `  → ${t} ${ft.lat}°N ${ft.lng}°E`;
            if (ft.maxWind) msg += ` (${ft.maxWind}km/h)`;
            msg += `\n`;
          });
        }
      });
    }

    const signalLevel = parseInt((signalCode || '').replace(/\D/g, '')) || 0;
    if (signalLevel >= 8) {
      msg += `🔴 留在室內安全地方，遠離窗戶\n`;
    }
    msg += `\n`;
  }

  if (warnsum) {
    const otherWarnings = Object.entries(warnsum).filter(([k, v]) => k !== 'WTCSGNL' && v && typeof v === 'object');
    if (otherWarnings.length > 0) {
      msg += `⚠️ 生效警告\n`;
      const warnLabels = {
        'WRAIN': '暴雨', 'WHOT': '酷熱', 'WCOLD': '寒冷', 'WMSGNL': '季候風',
        'WFIRE': '火災危險', 'WTS': '雷暴', 'WL': '山泥傾瀉', 'WTMW': '海嘯',
        'WFROST': '霜凍', 'WFNTSA': '水浸',
      };
      otherWarnings.forEach(([k, v]) => {
        msg += `• ${warnLabels[k] || k}`;
        if (v.subtype) msg += ` (${v.subtype})`;
        msg += `\n`;
      });
      msg += `\n`;
    }
  } else if (warnings.length > 0) {
    msg += `⚠️ 警告\n`;
    warnings.forEach(w => { msg += `• ${w}\n`; });
    msg += `\n`;
  }

  if (local?.forecastDesc) {
    msg += `📋 今日預測\n${local.forecastDesc}\n\n`;
  }

  const days = forecast?.weatherForecast?.slice(0, 5) || [];
  if (days.length > 0) {
    msg += `📅 未來天氣\n`;
    days.forEach((d, i) => {
      const emoji = HKO_ICON_EMOJI[d.ForecastIcon] || '🌤';
      const label = i === 0 ? '今日' : d.week;
      msg += `${emoji} ${label} ${d.forecastMintemp.value}-${d.forecastMaxtemp.value}°C\n`;
    });
    msg += `\n`;
  }

  if (local?.outlook) {
    msg += `🔮 展望：${local.outlook}\n`;
  }

  msg += `\n📊 data.weather.gov.hk`;

  return msg;
}

async function sendDailyWeatherToUsers(targetUsers) {
  let weatherData;
  try {
    weatherData = await fetchHKWeather();
  } catch (e) {
    console.error("Daily weather fetch error:", e.message);
    return { forecastOk: false, sentUserIds: [] };
  }
  const message = formatWeatherMessage(weatherData);
  if (!message) {
    console.log("Weather: no data to send");
    return { forecastOk: false, sentUserIds: [] };
  }

  const sentUserIds = [];
  for (const user of targetUsers) {
    try {
      await pushMessage(user.lineUserId, message, { quickReply: WEATHER_NEXT_QUICK_REPLY });
      sentUserIds.push(user.id);
      console.log(`Weather sent to LINE user: ${user.email}`);
    } catch (e) {
      console.error(`Weather push failed for ${user.email}:`, e.message);
    }
  }
  return { forecastOk: true, sentUserIds };
}

function formatDailyFoodSummary(user, totals, ctx, yesterdayTotals) {
  const cal = Math.round(Number(totals?.calories) || 0);
  const name = user?.name ? `${user.name} ` : "";
  const goalBlock = formatGoalSummaryForReply(ctx);
  const trendBlock = formatYesterdayTrend(totals, yesterdayTotals, ctx);
  return `🍽️ ${name}今日飲食總結\n\n今日 ${cal} kcal${goalBlock}${trendBlock}`;
}

const dailyFoodSummaryLastSent = new Map();
let dailySummarySentHydrated = false;

let dailySummaryUserBuckets = null;
let dailySummaryCacheLoadedAt = 0;
const DAILY_SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000;

const dailySummaryBucketStats = new Map();
const DAILY_SUMMARY_TICK_KEY = "__scheduler__";

function dailySummaryBucketKey(tz, hour, minute) {
  return `${tz}|${hour}:${minute}`;
}

function recordDailySummaryBucketRun(tz, hour, minute, attemptedCount, sentCount) {
  const key = dailySummaryBucketKey(tz, hour, minute);
  const prev = dailySummaryBucketStats.get(key) || {};
  dailySummaryBucketStats.set(key, {
    timezone: tz,
    hour,
    minute,
    lastRunAt: new Date().toISOString(),
    lastRunUserCount: attemptedCount,
    lastRunSentCount: sentCount,
    errorCount: prev.errorCount || 0,
    lastErrorMessage: prev.lastErrorMessage || null,
    lastErrorAt: prev.lastErrorAt || null,
  });
}

function recordDailySummaryBucketError(tz, hour, minute, message) {
  const key = dailySummaryBucketKey(tz, hour, minute);
  const prev = dailySummaryBucketStats.get(key) || {};
  dailySummaryBucketStats.set(key, {
    timezone: prev.timezone || tz,
    hour: prev.hour ?? hour,
    minute: prev.minute ?? minute,
    lastRunAt: prev.lastRunAt || null,
    lastRunUserCount: prev.lastRunUserCount || 0,
    lastRunSentCount: prev.lastRunSentCount || 0,
    errorCount: (prev.errorCount || 0) + 1,
    lastErrorMessage: message ? String(message) : null,
    lastErrorAt: new Date().toISOString(),
  });
}

function recordDailySummaryTickError(message) {
  const prev = dailySummaryBucketStats.get(DAILY_SUMMARY_TICK_KEY) || {};
  dailySummaryBucketStats.set(DAILY_SUMMARY_TICK_KEY, {
    errorCount: (prev.errorCount || 0) + 1,
    lastErrorMessage: message ? String(message) : null,
    lastErrorAt: new Date().toISOString(),
  });
}

export function getDailySummarySchedulerStats() {
  const knownTimezones = [];
  const knownTzCounts = new Map();
  if (dailySummaryUserBuckets) {
    for (const bucket of dailySummaryUserBuckets.values()) {
      knownTzCounts.set(
        bucket.timezone,
        (knownTzCounts.get(bucket.timezone) || 0) + bucket.users.length,
      );
    }
    for (const [tz, userCount] of knownTzCounts.entries()) {
      knownTimezones.push({ timezone: tz, userCount });
    }
    knownTimezones.sort((a, b) => a.timezone.localeCompare(b.timezone));
  }

  const seen = new Set();
  const buckets = [];
  if (dailySummaryUserBuckets) {
    for (const [key, bucket] of dailySummaryUserBuckets.entries()) {
      seen.add(key);
      const stats = dailySummaryBucketStats.get(key) || {};
      buckets.push({
        timezone: bucket.timezone,
        hour: bucket.hour,
        minute: bucket.minute,
        userCount: bucket.users.length,
        lastRunAt: stats.lastRunAt || null,
        lastRunUserCount: stats.lastRunUserCount || 0,
        lastRunSentCount: stats.lastRunSentCount || 0,
        errorCount: stats.errorCount || 0,
        lastErrorMessage: stats.lastErrorMessage || null,
        lastErrorAt: stats.lastErrorAt || null,
      });
    }
  }
  // Surface stats for buckets that ran historically but are no longer cached
  // (e.g. all users in that schedule slot opted out since the last tick).
  for (const [key, stats] of dailySummaryBucketStats.entries()) {
    if (key === DAILY_SUMMARY_TICK_KEY) continue;
    if (seen.has(key)) continue;
    buckets.push({
      timezone: stats.timezone || key.split("|")[0],
      hour: stats.hour ?? null,
      minute: stats.minute ?? null,
      userCount: 0,
      lastRunAt: stats.lastRunAt || null,
      lastRunUserCount: stats.lastRunUserCount || 0,
      lastRunSentCount: stats.lastRunSentCount || 0,
      errorCount: stats.errorCount || 0,
      lastErrorMessage: stats.lastErrorMessage || null,
      lastErrorAt: stats.lastErrorAt || null,
    });
  }
  buckets.sort((a, b) => {
    const t = a.timezone.localeCompare(b.timezone);
    if (t !== 0) return t;
    if ((a.hour ?? -1) !== (b.hour ?? -1)) return (a.hour ?? -1) - (b.hour ?? -1);
    return (a.minute ?? -1) - (b.minute ?? -1);
  });

  const tickStats = dailySummaryBucketStats.get(DAILY_SUMMARY_TICK_KEY) || {};
  return {
    targetHour: null,
    targetMinute: null,
    knownTimezones,
    cacheLoadedAt: dailySummaryCacheLoadedAt
      ? new Date(dailySummaryCacheLoadedAt).toISOString()
      : null,
    tickErrorCount: tickStats.errorCount || 0,
    lastTickErrorMessage: tickStats.lastErrorMessage || null,
    lastTickErrorAt: tickStats.lastErrorAt || null,
    buckets,
  };
}

const dailySummaryDeps = {
  loadEnabledUsers: () =>
    db.select().from(users).where(eq(users.dailySummaryEnabled, true)),
  getTimeInTimezone: getTimePartsInTz,
  getTodayMacroTotals,
  pushMessage,
  loadRecentSent: async () => {
    const rows = await db
      .select()
      .from(dailySummarySent)
      .where(sql`${dailySummarySent.sentAt} > now() - interval '2 days'`)
      .orderBy(asc(dailySummarySent.sentAt));
    return rows.map((r) => ({ uid: r.uid, dedupKey: r.dedupKey }));
  },
  recordSent: async (uid, dedupKey) => {
    await db
      .insert(dailySummarySent)
      .values({ uid, dedupKey })
      .onConflictDoNothing();
  },
  pruneOldSent: async () => {
    await db
      .delete(dailySummarySent)
      .where(sql`${dailySummarySent.sentAt} < now() - interval '2 days'`);
  },
};

async function ensureDailySummarySentHydrated() {
  if (dailySummarySentHydrated) return;
  let rows;
  try {
    rows = await dailySummaryDeps.loadRecentSent();
  } catch (e) {
    // Leave the hydrated flag false so the next tick retries instead of running
    // unprotected for the rest of the process lifetime.
    console.error("Failed to hydrate daily summary sent state (will retry next tick):", e.message);
    return;
  }
  // Rows are ordered by sentAt ASC, so the latest dedup key per user wins.
  for (const r of rows) {
    dailyFoodSummaryLastSent.set(r.uid, r.dedupKey);
  }
  dailySummarySentHydrated = true;
  // Best-effort prune of old rows; do not block the tick.
  Promise.resolve(dailySummaryDeps.pruneOldSent())
    .catch((e) => console.error("Daily summary prune failed:", e.message));
}

async function persistDailySummarySent(uid, dedupKey) {
  try {
    await dailySummaryDeps.recordSent(uid, dedupKey);
  } catch (e) {
    console.error(`Failed to persist daily summary dedup for uid=${uid}:`, e.message);
  }
}

async function loadDailySummaryUserBuckets() {
  const enabled = await dailySummaryDeps.loadEnabledUsers();
  const buckets = new Map();
  for (const user of enabled) {
    if (!user.lineUserId || user.lineUserId.length <= 5) continue;
    const tz = user.timezone || "Asia/Hong_Kong";
    const hour = user.dailySummaryHour ?? 21;
    const minute = user.dailySummaryMinute ?? 0;
    const key = `${tz}|${hour}:${minute}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { timezone: tz, hour, minute, users: [] };
      buckets.set(key, bucket);
    }
    bucket.users.push(user);
  }
  dailySummaryUserBuckets = buckets;
  dailySummaryCacheLoadedAt = Date.now();
  return buckets;
}

export function invalidateDailySummaryCache() {
  dailySummaryCacheLoadedAt = 0;
}

async function ensureDailySummaryUserBuckets() {
  if (
    !dailySummaryUserBuckets ||
    Date.now() - dailySummaryCacheLoadedAt > DAILY_SUMMARY_CACHE_TTL_MS
  ) {
    await loadDailySummaryUserBuckets();
  }
  return dailySummaryUserBuckets;
}

async function sendDailyFoodSummaryToAllUsers() {
  try {
    await ensureDailySummarySentHydrated();
    const buckets = await ensureDailySummaryUserBuckets();
    let sent = 0;
    for (const bucket of buckets.values()) {
      const { timezone: tz, hour: targetHour, minute: targetMinute, users: bucketUsers } = bucket;
      const { hour, minute, todayStr, yesterdayStr } = dailySummaryDeps.getTimeInTimezone(tz);
      if (hour !== targetHour || minute !== targetMinute) continue;
      const dueUsers = bucketUsers.filter(
        (u) => dailyFoodSummaryLastSent.get(u.id) !== `${todayStr}:${targetHour}:${targetMinute}`,
      );
      let bucketSent = 0;
      for (const user of bucketUsers) {
        try {
          const dedupKey = `${todayStr}:${targetHour}:${targetMinute}`;
          if (dailyFoodSummaryLastSent.get(user.id) === dedupKey) continue;
          const totals = await dailySummaryDeps.getTodayMacroTotals(user.id, todayStr);
          const ctx = buildGoalContext(user, totals);
          const cal = Math.round(Number(totals?.calories) || 0);
          const hasFood = cal > 0 || (totals && (totals.protein > 0 || totals.carbs > 0 || totals.fat > 0));
          if (!hasFood) {
            dailyFoodSummaryLastSent.set(user.id, dedupKey);
            await persistDailySummarySent(user.id, dedupKey);
            continue;
          }
          const yesterdayTotals = await dailySummaryDeps.getTodayMacroTotals(user.id, yesterdayStr);
          const message = formatDailyFoodSummary(user, totals, ctx, yesterdayTotals);
          await dailySummaryDeps.pushMessage(user.lineUserId, message);
          dailyFoodSummaryLastSent.set(user.id, dedupKey);
          await persistDailySummarySent(user.id, dedupKey);
          sent++;
          bucketSent++;
          console.log(`Daily food summary sent to LINE user: ${user.email} (${tz} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')})`);
        } catch (e) {
          // Do not include the user's email/id in the surfaced (API-facing)
          // error string; the full email is still logged to the server console.
          recordDailySummaryBucketError(tz, targetHour, targetMinute, `push failed: ${e.message}`);
          console.error(`Daily food summary failed for ${user.email}:`, e.message);
        }
      }
      if (dueUsers.length > 0) {
        recordDailySummaryBucketRun(tz, targetHour, targetMinute, dueUsers.length, bucketSent);
      }
    }
    if (sent > 0) console.log(`Daily food summary sent to ${sent} users`);
  } catch (e) {
    recordDailySummaryTickError(e.message);
    console.error("Daily food summary push error:", e.message);
  }
}

const __defaultDailySummaryDeps = { ...dailySummaryDeps };

export const __dailySummaryTesting = {
  setDeps(overrides) {
    Object.assign(dailySummaryDeps, overrides);
  },
  resetDeps() {
    Object.assign(dailySummaryDeps, __defaultDailySummaryDeps);
  },
  resetState() {
    dailySummaryUserBuckets = null;
    dailySummaryCacheLoadedAt = 0;
    dailyFoodSummaryLastSent.clear();
    dailySummarySentHydrated = false;
    dailySummaryBucketStats.clear();
  },
  loadDailySummaryUserBuckets,
  sendDailyFoodSummaryToAllUsers,
  getBuckets: () => dailySummaryUserBuckets,
  getLastSent: () => dailyFoodSummaryLastSent,
  getBucketStats: () => dailySummaryBucketStats,
  getStatsSnapshot: () => getDailySummarySchedulerStats(),
  recordDailySummaryBucketRun,
  recordDailySummaryBucketError,
  recordDailySummaryTickError,
};

function startDailyFoodSummaryScheduler() {
  const CHECK_INTERVAL = 60 * 1000;
  setInterval(() => {
    sendDailyFoodSummaryToAllUsers().catch(e => console.error("Food summary tick error:", e.message));
  }, CHECK_INTERVAL);
  console.log("Daily food summary scheduler started (per-user timezone)");
}

// -------------------- Weekly Wiki Lint Scheduler --------------------
// Mirrors the daily food summary pattern: per-user timezone + dow + hour:minute,
// dedup'd via wiki_lint_sent (uid + dedupKey unique). On fire we run the wiki
// `lint` op (trigger='auto', source='weekly_lint') and push a short LINE
// summary so the user knows it ran without opening the app.

const WEEKLY_LINT_CACHE_TTL_MS = 5 * 60 * 1000;
let weeklyLintUserBuckets = null;
let weeklyLintCacheLoadedAt = 0;
const weeklyLintLastSent = new Map(); // uid -> last dedupKey

const weeklyLintDeps = {
  loadEnabledUsers: () =>
    db.select().from(users).where(eq(users.wikiLintEnabled, true)),
  getTimeInTimezone: getTimePartsInTz,
  pushMessage,
  runLint: async (uid, tz) => {
    // Lazy import to avoid loading the wiki agent stack when only LINE bits used.
    const { runWikiOp } = await import("./wikiOps.js");
    return runWikiOp({
      uid, op: "lint", input: "(weekly scheduled lint)",
      tz: tz || "Asia/Hong_Kong",
      source: "auto", trigger: "scheduler",
    });
  },
  // Persist the lint output as a Wiki Lint report memo so the user always
  // has something to open from the LINE notification's title link.
  createLintReportMemo: async (uid, { title, body }) => {
    const [memo] = await db
      .insert(memos)
      .values({
        uid,
        title,
        content: body || "",
        date: null,
        color: "yellow",
        noteType: "wiki-lint-report",
      })
      .returning();
    return memo;
  },
  loadRecentSent: async () => {
    const { wikiLintSent } = await import("./schema.js");
    const rows = await db
      .select()
      .from(wikiLintSent)
      .where(sql`${wikiLintSent.sentAt} > now() - interval '14 days'`)
      .orderBy(asc(wikiLintSent.sentAt));
    return rows.map((r) => ({ uid: r.uid, dedupKey: r.dedupKey }));
  },
  recordSent: async (uid, dedupKey) => {
    const { wikiLintSent } = await import("./schema.js");
    await db.insert(wikiLintSent).values({ uid, dedupKey }).onConflictDoNothing();
  },
  pruneOldSent: async () => {
    const { wikiLintSent } = await import("./schema.js");
    await db.delete(wikiLintSent)
      .where(sql`${wikiLintSent.sentAt} < now() - interval '60 days'`);
  },
  dowInTz: defaultDowInTz,
};

let weeklyLintHydrated = false;
const weeklyLintStats = {
  ticks: 0,
  lastTickAt: null,
  lastTickError: null,
  bucketCount: 0,
  fired: 0,
  failed: 0,
  lastFiredAt: null,
};

async function ensureWeeklyLintHydrated() {
  if (weeklyLintHydrated) return;
  let rows;
  try { rows = await weeklyLintDeps.loadRecentSent(); }
  catch (e) {
    console.error("Weekly lint hydrate failed (will retry):", e.message);
    return;
  }
  for (const r of rows) weeklyLintLastSent.set(r.uid, r.dedupKey);
  weeklyLintHydrated = true;
  Promise.resolve(weeklyLintDeps.pruneOldSent())
    .catch((e) => console.error("Weekly lint prune failed:", e.message));
}

async function loadWeeklyLintBuckets() {
  const enabled = await weeklyLintDeps.loadEnabledUsers();
  const buckets = new Map();
  for (const u of enabled) {
    const tz = u.timezone || "Asia/Hong_Kong";
    const dow = u.wikiLintDow ?? 0;
    const hour = u.wikiLintHour ?? 9;
    const minute = u.wikiLintMinute ?? 0;
    const key = `${tz}|${dow}|${hour}:${minute}`;
    let b = buckets.get(key);
    if (!b) { b = { timezone: tz, dow, hour, minute, users: [] }; buckets.set(key, b); }
    b.users.push(u);
  }
  weeklyLintUserBuckets = buckets;
  weeklyLintCacheLoadedAt = Date.now();
  weeklyLintStats.bucketCount = buckets.size;
  return buckets;
}

export function invalidateWeeklyLintCache() {
  weeklyLintCacheLoadedAt = 0;
}

async function ensureWeeklyLintBuckets() {
  if (!weeklyLintUserBuckets || Date.now() - weeklyLintCacheLoadedAt > WEEKLY_LINT_CACHE_TTL_MS) {
    await loadWeeklyLintBuckets();
  }
  return weeklyLintUserBuckets;
}

function defaultDowInTz(tz) {
  // Use Intl to extract weekday-of-week as 0..6 (Sun=0).
  try {
    const w = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date());
    const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[w] ?? 0;
  } catch { return new Date().getDay(); }
}
// Tests inject a deterministic dowInTz via __weeklyLintTesting.setDeps({dowInTz})
// to remove non-determinism that would otherwise depend on the wall clock.
function dowInTz(tz) { return weeklyLintDeps.dowInTz(tz); }

function buildLintReportTitle(todayStr) {
  return `Weekly wiki lint — ${todayStr || new Date().toISOString().slice(0, 10)}`;
}

// Per #164: LINE notification is just a one-line summary (the report title).
// The full report lives in the auto-created Lint report memo.
function formatWeeklyLintLineMessage({ title }) {
  return `🧹 ${title}\n\nOpen Muse → Memos to read the full report.`;
}

async function tickWeeklyLint() {
  weeklyLintStats.ticks += 1;
  weeklyLintStats.lastTickAt = new Date().toISOString();
  try {
    await ensureWeeklyLintHydrated();
    const buckets = await ensureWeeklyLintBuckets();
    for (const bucket of buckets.values()) {
      const { timezone: tz, dow: targetDow, hour: targetH, minute: targetM, users: bucketUsers } = bucket;
      const { hour, minute, todayStr } = weeklyLintDeps.getTimeInTimezone(tz);
      if (hour !== targetH || minute !== targetM) continue;
      const todayDow = dowInTz(tz);
      if (todayDow !== targetDow) continue;
      for (const user of bucketUsers) {
        const dedupKey = `${todayStr}:${targetH}:${targetM}`;
        if (weeklyLintLastSent.get(user.id) === dedupKey) continue;
        try {
          const result = await weeklyLintDeps.runLint(user.id, tz);
          // runWikiOp returns {ok:false, error} on kill switch / agent failure
          // (it does NOT throw). Treat that as a failed run: skip the memo,
          // skip the LINE push, and DO NOT record dedup so the next tick can
          // legitimately retry.
          if (!result || result.ok === false) {
            weeklyLintStats.failed += 1;
            weeklyLintStats.lastTickError = `lint failed for uid=${user.id}: ${result?.error || "unknown"}`;
            console.error(`Weekly wiki lint not OK for uid=${user.id}: ${result?.error || "unknown"} (no memo, no notification, no dedup)`);
            continue;
          }
          const reportTitle = buildLintReportTitle(todayStr);
          const reportBody = (result?.output || "").trim() || "_No findings — your wiki looks tidy this week._";
          let memoId = null;
          try {
            const memo = await weeklyLintDeps.createLintReportMemo(user.id, { title: reportTitle, body: reportBody });
            memoId = memo?.id ?? null;
          } catch (e) {
            console.error(`Weekly lint memo create failed for uid=${user.id}:`, e.message);
          }
          weeklyLintLastSent.set(user.id, dedupKey);
          try { await weeklyLintDeps.recordSent(user.id, dedupKey); } catch {}
          weeklyLintStats.fired += 1;
          weeklyLintStats.lastFiredAt = new Date().toISOString();
          if (user.lineUserId && user.lineUserId.length > 5) {
            try {
              await weeklyLintDeps.pushMessage(user.lineUserId, formatWeeklyLintLineMessage({ title: reportTitle, memoId }));
            } catch (e) {
              console.error(`Weekly lint LINE push failed for uid=${user.id}:`, e.message);
            }
          }
          console.log(`Weekly wiki lint fired for uid=${user.id} (${tz} dow=${targetDow} ${String(targetH).padStart(2,'0')}:${String(targetM).padStart(2,'0')}) memo=${memoId ?? "?"}`);
        } catch (e) {
          weeklyLintStats.failed += 1;
          console.error(`Weekly wiki lint failed for uid=${user.id}:`, e.message);
        }
      }
    }
  } catch (e) {
    weeklyLintStats.lastTickError = e.message;
    console.error("Weekly wiki lint tick error:", e.message);
  }
}

const __defaultWeeklyLintDeps = { ...weeklyLintDeps };

export function getWeeklyLintSchedulerStats() {
  const list = [];
  if (weeklyLintUserBuckets) {
    for (const b of weeklyLintUserBuckets.values()) {
      list.push({ timezone: b.timezone, dow: b.dow, hour: b.hour, minute: b.minute, userCount: b.users.length });
    }
  }
  return {
    ...weeklyLintStats,
    cacheLoadedAt: weeklyLintCacheLoadedAt ? new Date(weeklyLintCacheLoadedAt).toISOString() : null,
    buckets: list,
  };
}

export const __weeklyLintTesting = {
  setDeps(overrides) { Object.assign(weeklyLintDeps, overrides); },
  resetDeps() { Object.assign(weeklyLintDeps, __defaultWeeklyLintDeps); },
  resetState() {
    weeklyLintUserBuckets = null;
    weeklyLintCacheLoadedAt = 0;
    weeklyLintLastSent.clear();
    weeklyLintHydrated = false;
    Object.assign(weeklyLintStats, { ticks: 0, lastTickAt: null, lastTickError: null, bucketCount: 0, fired: 0, failed: 0, lastFiredAt: null });
  },
  loadWeeklyLintBuckets,
  tickWeeklyLint,
  dowInTz,
  formatWeeklyLintLineMessage,
  getBuckets: () => weeklyLintUserBuckets,
  getLastSent: () => weeklyLintLastSent,
  getStats: () => weeklyLintStats,
};

export function startWeeklyLintScheduler() {
  const CHECK_INTERVAL = 60 * 1000;
  setInterval(() => {
    tickWeeklyLint().catch((e) => console.error("Weekly lint tick crash:", e.message));
  }, CHECK_INTERVAL);
  console.log("Weekly wiki lint scheduler started (per-user tz/dow/hour:minute)");
}

let dailyWeatherUserBuckets = null;
let dailyWeatherCacheLoadedAt = 0;
const DAILY_WEATHER_CACHE_TTL_MS = 5 * 60 * 1000;
const dailyWeatherLastSent = new Map();
let dailyWeatherSentHydrated = false;
export const WEATHER_TARGET_HOUR = 7;
export const WEATHER_TARGET_MINUTE = 0;

const dailyWeatherBucketStats = new Map();
const DAILY_WEATHER_TICK_KEY = "__scheduler__";

function recordDailyWeatherBucketRun(tz, attemptedCount, sentCount) {
  const prev = dailyWeatherBucketStats.get(tz) || {};
  dailyWeatherBucketStats.set(tz, {
    lastRunAt: new Date().toISOString(),
    lastRunUserCount: attemptedCount,
    lastRunSentCount: sentCount,
    errorCount: prev.errorCount || 0,
    lastErrorMessage: prev.lastErrorMessage || null,
    lastErrorAt: prev.lastErrorAt || null,
  });
}

function recordDailyWeatherBucketError(tz, message) {
  const prev = dailyWeatherBucketStats.get(tz) || {};
  dailyWeatherBucketStats.set(tz, {
    lastRunAt: prev.lastRunAt || null,
    lastRunUserCount: prev.lastRunUserCount || 0,
    lastRunSentCount: prev.lastRunSentCount || 0,
    errorCount: (prev.errorCount || 0) + 1,
    lastErrorMessage: message ? String(message) : null,
    lastErrorAt: new Date().toISOString(),
  });
}

function recordDailyWeatherTickError(message) {
  const prev = dailyWeatherBucketStats.get(DAILY_WEATHER_TICK_KEY) || {};
  dailyWeatherBucketStats.set(DAILY_WEATHER_TICK_KEY, {
    errorCount: (prev.errorCount || 0) + 1,
    lastErrorMessage: message ? String(message) : null,
    lastErrorAt: new Date().toISOString(),
  });
}

export function getDailyWeatherSchedulerStats() {
  const knownTimezones = dailyWeatherUserBuckets
    ? [...dailyWeatherUserBuckets.entries()]
        .map(([tz, b]) => ({ timezone: tz, userCount: b.users.length }))
        .sort((a, b) => a.timezone.localeCompare(b.timezone))
    : [];

  const seen = new Set();
  const buckets = [];
  if (dailyWeatherUserBuckets) {
    for (const tz of dailyWeatherUserBuckets.keys()) {
      seen.add(tz);
      const stats = dailyWeatherBucketStats.get(tz) || {};
      buckets.push({
        timezone: tz,
        userCount: dailyWeatherUserBuckets.get(tz).users.length,
        lastRunAt: stats.lastRunAt || null,
        lastRunUserCount: stats.lastRunUserCount || 0,
        lastRunSentCount: stats.lastRunSentCount || 0,
        errorCount: stats.errorCount || 0,
        lastErrorMessage: stats.lastErrorMessage || null,
        lastErrorAt: stats.lastErrorAt || null,
      });
    }
  }
  // Surface stats for buckets that ran historically but are no longer cached
  // (e.g. all users in that timezone unlinked since the last tick).
  for (const [tz, stats] of dailyWeatherBucketStats.entries()) {
    if (tz === DAILY_WEATHER_TICK_KEY) continue;
    if (seen.has(tz)) continue;
    buckets.push({
      timezone: tz,
      userCount: 0,
      lastRunAt: stats.lastRunAt || null,
      lastRunUserCount: stats.lastRunUserCount || 0,
      lastRunSentCount: stats.lastRunSentCount || 0,
      errorCount: stats.errorCount || 0,
      lastErrorMessage: stats.lastErrorMessage || null,
      lastErrorAt: stats.lastErrorAt || null,
    });
  }
  buckets.sort((a, b) => a.timezone.localeCompare(b.timezone));

  const tickStats = dailyWeatherBucketStats.get(DAILY_WEATHER_TICK_KEY) || {};
  return {
    targetHour: WEATHER_TARGET_HOUR,
    targetMinute: WEATHER_TARGET_MINUTE,
    knownTimezones,
    cacheLoadedAt: dailyWeatherCacheLoadedAt
      ? new Date(dailyWeatherCacheLoadedAt).toISOString()
      : null,
    tickErrorCount: tickStats.errorCount || 0,
    lastTickErrorMessage: tickStats.lastErrorMessage || null,
    lastTickErrorAt: tickStats.lastErrorAt || null,
    buckets,
  };
}

const dailyWeatherDeps = {
  loadLinkedUsers: () =>
    db
      .select()
      .from(users)
      .where(and(isNotNull(users.lineUserId), eq(users.dailyWeatherEnabled, true))),
  getTimeInTimezone: getTimePartsInTz,
  sendDailyWeatherToUsers,
  loadRecentSent: async () => {
    const rows = await db
      .select()
      .from(dailyWeatherSent)
      .where(sql`${dailyWeatherSent.sentAt} > now() - interval '2 days'`)
      .orderBy(asc(dailyWeatherSent.sentAt));
    return rows.map((r) => ({ uid: r.uid, dedupKey: r.dedupKey }));
  },
  recordSent: async (uid, dedupKey) => {
    await db
      .insert(dailyWeatherSent)
      .values({ uid, dedupKey })
      .onConflictDoNothing();
  },
  pruneOldSent: async () => {
    await db
      .delete(dailyWeatherSent)
      .where(sql`${dailyWeatherSent.sentAt} < now() - interval '2 days'`);
  },
};

async function ensureDailyWeatherSentHydrated() {
  if (dailyWeatherSentHydrated) return;
  let rows;
  try {
    rows = await dailyWeatherDeps.loadRecentSent();
  } catch (e) {
    // Leave the hydrated flag false so the next tick retries instead of running
    // unprotected for the rest of the process lifetime.
    console.error("Failed to hydrate daily weather sent state (will retry next tick):", e.message);
    return;
  }
  // Rows are ordered by sentAt ASC, so the latest dedup key per user wins.
  for (const r of rows) {
    dailyWeatherLastSent.set(r.uid, r.dedupKey);
  }
  dailyWeatherSentHydrated = true;
  // Best-effort prune of old rows; do not block the tick.
  Promise.resolve(dailyWeatherDeps.pruneOldSent())
    .catch((e) => console.error("Daily weather prune failed:", e.message));
}

async function persistDailyWeatherSent(uid, dedupKey) {
  try {
    await dailyWeatherDeps.recordSent(uid, dedupKey);
  } catch (e) {
    console.error(`Failed to persist daily weather dedup for uid=${uid}:`, e.message);
  }
}

async function loadDailyWeatherUserBuckets() {
  const linkedUsers = await dailyWeatherDeps.loadLinkedUsers();
  const buckets = new Map();
  for (const user of linkedUsers) {
    if (!user.lineUserId || user.lineUserId.length <= 5) continue;
    const tz = user.timezone || "Asia/Hong_Kong";
    let bucket = buckets.get(tz);
    if (!bucket) {
      bucket = { timezone: tz, users: [] };
      buckets.set(tz, bucket);
    }
    bucket.users.push(user);
  }
  dailyWeatherUserBuckets = buckets;
  dailyWeatherCacheLoadedAt = Date.now();
  return buckets;
}

export function invalidateDailyWeatherCache() {
  dailyWeatherCacheLoadedAt = 0;
}

async function ensureDailyWeatherUserBuckets() {
  if (
    !dailyWeatherUserBuckets ||
    Date.now() - dailyWeatherCacheLoadedAt > DAILY_WEATHER_CACHE_TTL_MS
  ) {
    await loadDailyWeatherUserBuckets();
  }
  return dailyWeatherUserBuckets;
}

async function tickDailyWeatherScheduler() {
  try {
    await ensureDailyWeatherSentHydrated();
    const buckets = await ensureDailyWeatherUserBuckets();
    let totalSent = 0;
    for (const bucket of buckets.values()) {
      const { timezone: tz, users: bucketUsers } = bucket;
      const { hour, minute, todayStr } = dailyWeatherDeps.getTimeInTimezone(tz);
      if (hour !== WEATHER_TARGET_HOUR || minute !== WEATHER_TARGET_MINUTE) continue;
      const dueUsers = bucketUsers.filter((u) => dailyWeatherLastSent.get(u.id) !== todayStr);
      if (dueUsers.length === 0) continue;
      let result;
      try {
        result = await dailyWeatherDeps.sendDailyWeatherToUsers(dueUsers);
      } catch (e) {
        recordDailyWeatherBucketError(tz, `send failed: ${e.message}`);
        throw e;
      }
      const { forecastOk = false, sentUserIds = [] } = result || {};
      if (!forecastOk) {
        // Forecast fetch failed (or no message produced). Do NOT mark anyone as
        // already-sent so the next tick within the same minute can retry.
        recordDailyWeatherBucketError(tz, "forecast unavailable");
        recordDailyWeatherBucketRun(tz, dueUsers.length, 0);
        console.log(`Daily weather forecast unavailable; will retry next tick (${dueUsers.length} users in ${tz})`);
        continue;
      }
      for (const id of sentUserIds) {
        dailyWeatherLastSent.set(id, todayStr);
        await persistDailyWeatherSent(id, todayStr);
      }
      totalSent += sentUserIds.length;
      recordDailyWeatherBucketRun(tz, dueUsers.length, sentUserIds.length);
      if (sentUserIds.length < dueUsers.length) {
        // Some per-user pushes failed inside sendDailyWeatherToUsers. Surface
        // it so admins can see partial failures without scraping logs.
        recordDailyWeatherBucketError(
          tz,
          `partial push: ${sentUserIds.length}/${dueUsers.length} succeeded`,
        );
      }
      console.log(`Daily weather attempted for ${dueUsers.length} users in ${tz} at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} (${sentUserIds.length} succeeded)`);
    }
    if (totalSent > 0) console.log(`Daily weather sent to ${totalSent} users`);
  } catch (e) {
    recordDailyWeatherTickError(e.message);
    console.error("Daily weather tick error:", e.message);
  }
}

function startDailyWeatherScheduler() {
  const CHECK_INTERVAL = 60 * 1000;
  setInterval(() => {
    tickDailyWeatherScheduler().catch(e => console.error("Weather tick error:", e.message));
  }, CHECK_INTERVAL);
  console.log("Daily weather scheduler started (per-user timezone, 7:00 local)");
}

const __defaultDailyWeatherDeps = { ...dailyWeatherDeps };

export const __dailyWeatherTesting = {
  setDeps(overrides) {
    Object.assign(dailyWeatherDeps, overrides);
  },
  resetDeps() {
    Object.assign(dailyWeatherDeps, __defaultDailyWeatherDeps);
  },
  resetState() {
    dailyWeatherUserBuckets = null;
    dailyWeatherCacheLoadedAt = 0;
    dailyWeatherLastSent.clear();
    dailyWeatherSentHydrated = false;
    dailyWeatherBucketStats.clear();
  },
  loadDailyWeatherUserBuckets,
  tickDailyWeatherScheduler,
  getBuckets: () => dailyWeatherUserBuckets,
  getLastSent: () => dailyWeatherLastSent,
  getBucketStats: () => dailyWeatherBucketStats,
  getStatsSnapshot: () => getDailyWeatherSchedulerStats(),
  recordDailyWeatherBucketRun,
  recordDailyWeatherBucketError,
  recordDailyWeatherTickError,
  WEATHER_TARGET_HOUR,
  WEATHER_TARGET_MINUTE,
};

const VENDOR_CATEGORY_RULES = [
  { category: 'food', patterns: [
    /\buber\s*eats?\b/, /\bubereats?\b/, /foodpanda/, /food\s*panda/, /熊貓/, /deliveroo/, /戶戶送/, /keeta/,
    /starbucks/, /星巴克/, /pacific\s*coffee/, /太平洋咖啡/, /\b%?arabica/, /blue\s*bottle/, /cova/,
    /mcdonald'?s?/, /麥當勞/, /麥記/, /麦当劳/,
    /\bkfc\b/, /肯德基/, /家鄉雞/,
    /burger\s*king/, /漢堡王/, /漢堡包/, /\bbk\b/,
    /pizza\s*hut/, /必勝客/, /\bpizza\b/, /domino/, /達美樂/,
    /subway/, /賽百味/,
    /tim\s*hortons?/, /tim\s*ho\s*wan/, /添好運/,
    /maxim/, /美心/, /大家樂/, /大快活/, /翠華/, /譚仔/, /谭仔/, /tam\s*jai/, /三哥/,
    /yoshinoya/, /吉野家/, /matsuya/, /松屋/, /sukiya/, /すき家/,
    /genki\s*sushi/, /元氣壽司/, /sushi\s*ro/, /壽司郎/, /sushi\s*express/, /爭鮮/, /itacho/, /板長/,
    /ippudo/, /一風堂/, /ichiran/, /一蘭/, /marugame/, /丸龜/, /丸亀/,
    /haidilao/, /海底撈/, /xiabu/, /呷哺/,
    /coco/, /都可/, /kung\s*fu\s*tea/, /喜茶/, /heytea/, /奈雪/, /nayuki/, /1點點/, /一點點/, /chatime/, /日出茶太/, /happy\s*lemon/, /快樂檸檬/, /gong\s*cha/, /貢茶/, /tealive/, /shake\s*shack/,
    /pret\s*a?\s*manger/, /\bpret\b/,
    /餐廳|食肆|飯堂|食堂|茶餐廳|冰室|快餐|燒味|燒臘|咖啡室|cafe|bistro|diner/,
    /餐|飯|麵|粉|粥|包|餃|餛飩|雲吞|燒烤|烤肉|火鍋|打邊爐|刺身|壽司|拉麵|烏冬|烏龍|甜品|甜點|蛋糕|cake|dessert|gelato|ice\s*cream|雪糕/,
    /咖啡|coffee|奶茶|milk\s*tea|bubble\s*tea|珍珠奶茶|凍飲|熱飲|果汁|smoothie|tea\s*house|冷飲/,
    /restaurant|food|eatery|takeaway|delivery|dining|brunch|lunch|dinner|breakfast|supper|宵夜/,
  ]},
  { category: 'grocery', patterns: [
    /park\s*n\s*shop/, /parknshop/, /百佳/,
    /wellcome/, /惠康/,
    /aeon/, /永旺/, /jusco/, /吉之島/,
    /\b7[-\s]?eleven\b/, /\b7-?11\b/, /seven\s*eleven/,
    /circle\s*k/, /\bok便利/, /便利店/, /vango|vanguard|ok\s*mart/,
    /city'?super/, /\bcity\s*super\b/, /citysuper/,
    /market\s*place/, /marketplace\s*by\s*jasons?/, /jasons?/, /\bgreat\b\s*food\s*hall/,
    /donki/, /don\s*don\s*donki/, /驚安の殿堂/, /唐吉訶德/,
    /fusion/, /\b3hreesixty\b/, /threesixty/,
    /yata/, /一田/,
    /sogo\s*supermarket/, /華潤/, /chinese\s*resources/, /中華?百貨/,
    /超市|超級市場|supermarket|grocery|生鮮|食材|街市|wet\s*market/,
  ]},
  { category: 'transport', patterns: [
    /\bmtr\b/, /港鐵|地鐵|捷運/, /airport\s*express|機場快線/,
    /\bkmb\b/, /九巴|九龍巴士/, /citybus|城巴/, /\bnwfb\b/, /新巴/, /龍運|long\s*win/, /嶼巴|new\s*lantao/,
    /minibus|小巴|紅van|綠van|公共小巴/,
    /\btaxi\b|的士|计程车|計程車|cab\s*fare/,
    /\buber\b(?!\s*eats?)/, /\blyft\b/, /\bdidi\b/, /滴滴/, /grab(?!\s*food)/, /gojek/, /\bbolt\b/,
    /octopus|八達通/, /tap\s*and\s*go/, /payme\s*octopus/,
    /渡輪|ferry|天星小輪|star\s*ferry/, /電車|tram(?:way)?/, /輕鐵|light\s*rail/,
    /\bgas\b|petrol|油站|加油|shell|caltex|sinopec|esso/,
    /parking|停車場|咪錶|wilson\s*parking/,
    /transport|交通|fare|車資|車費/,
  ]},
  { category: 'telecom', patterns: [
    /\bcsl\b|\b3hk\b|smartone|數碼通|china\s*mobile|中國移動|\bhkbn\b|netvigator|\bhkt\b|\bpccw\b|香港寬頻/,
    /電話費|月費|sim\s*card|電話卡|手機卡|儲值卡|prepaid\s*sim/,
    /internet|wifi|寬頻|broadband|fibre|fiber|光纖|數據|mobile\s*plan|phone\s*plan/,
  ]},
  { category: 'health', patterns: [
    /mannings|萬寧/,
    /watsons?|屈臣氏/,
    /\bdr\.?\s*\w+\b/, /醫生|醫師|診所|醫院|hospital|clinic|polyclinic|doctor|dentist|牙醫|chiropractor|physio|physiotherap/,
    /pharmacy|chemist|藥房|藥行|藥局|藥妝|drugstore/,
    /supplement|vitamin|維他命|保健品|草本/,
    /panadol|止痛藥|感冒藥|處方|prescription/,
    /醫療|健康|health(?!y\s*food)|medical|wellness|體檢|身體檢查|check[-\s]?up/,
  ]},
  { category: 'shopping', patterns: [
    /apple\s*store|蘋果/, /\bapple\.com\b/,
    /uniqlo|優衣庫|zara|h&m|hm\.com|cos\b|gu\b|muji|無印良品|gap\b|old\s*navy/,
    /nike|adidas|new\s*balance|asics|puma|under\s*armour|on\s*running|hoka|lululemon/,
    /sasa|莎莎|bonjour|卓悅|colourmix/,
    /ikea|宜家|francfranc|pricerite|實惠|hktvmall|友和|yoho|hktv\s*mall/,
    /amazon|taobao|淘寶|天貓|tmall|jd\.com|京東|shopee|lazada|aliexpress/,
    /sogo|千色店|千色\s*citistore|wing\s*on|永安|sincere|先施|harvey\s*nichols|lane\s*crawford|連卡佛|i\.t\.?\b/,
    /eslite|誠品|商務印書館|三聯|page\s*one|kinokuniya|紀伊國屋|book\s*store|書店/,
    /衫|褲|鞋|fashion|clothing|apparel|boutique|百貨|department\s*store|outlet|mall(?!ed)/,
  ]},
  { category: 'entertainment', patterns: [
    /broadway\s*cinema|mcl|uA\s*cinema|\buac?\b|cinema\s*city|emperor\s*cinema|amc\s*cinema|戲院|電影院|movie\s*theatre|movie\s*theater/,
    /netflix|disney\+?|disney\s*plus|spotify|apple\s*music|youtube\s*premium|hbo|viu|now\s*tv|amazon\s*prime|kkbox|joox/,
    /cinema|movie|戲飛|電影飛|concert|演唱會|gig|festival|theme\s*park|海洋公園|ocean\s*park|disneyland|迪士尼/,
    /gym|fitness|pure\s*fitness|24\s*hour\s*fitness|crossfit|yoga|健身|瑜伽/,
    /karaoke|卡拉ok|\bktv\b|neway|red\s*mr/,
    /娛樂|entertainment|amusement|game|遊戲|playstation|nintendo|steam/,
  ]},
  { category: 'bills', patterns: [
    /clp|中電|hkelectric|hk\s*electric|港燈|towngas|煤氣|water\s*supplies?|水務|電費|水費|煤氣費/,
    /rent|租金|管理費|management\s*fee|差餉|地租|government\s*rent/,
    /utility|utilities|insurance|保險|premium|稅|tax\s*payment|inland\s*revenue|稅務局/,
  ]},
];

const VALID_EXPENSE_CATEGORIES = new Set([
  'food', 'grocery', 'transport', 'shopping', 'entertainment', 'health', 'bills', 'telecom', 'other'
]);

function normalizeCategory(category, store, items) {
  const c = (category || '').toString().trim().toLowerCase();
  if (VALID_EXPENSE_CATEGORIES.has(c)) return c;
  return guessCategory(store, items);
}

function guessCategory(store, items) {
  const s = (store || '').toLowerCase();
  const allText = (s + ' ' + (items || []).map(i => (i.name || '').toLowerCase()).join(' ')).trim();
  if (!allText) return 'other';
  for (const rule of VENDOR_CATEGORY_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(allText)) return rule.category;
    }
  }
  return 'other';
}

export function setupLineBot(app) {
  if (!LINE_SECRET || !LINE_TOKEN) {
    console.log("LINE bot not configured (missing LINE_CHANNEL_SECRET or LINE_CHANNEL_ACCESS_TOKEN)");
    return;
  }

  app.post("/api/line/webhook", (req, res) => {
    const signature = req.headers["x-line-signature"];
    const rawBody = req.rawBody || JSON.stringify(req.body);

    if (!verifySignature(rawBody, signature)) {
      return res.status(403).send("Invalid signature");
    }

    const events = req.body?.events || [];

    Promise.all(
      events.map(async (event) => {
        if (event.type !== "message") return;
        const userId = event.source.userId;
        const rt = event.replyToken;
        const msg = event.message;

        switch (msg.type) {
          case "text":
            await handleTextMessage(userId, rt, msg.text);
            break;
          case "image":
            await handleImageMessage(userId, rt, msg.id);
            break;
          case "video":
            await handleVideoMessage(userId, rt, msg.id);
            break;
          case "file":
            await handleFileMessage(userId, rt, msg.id, msg.fileName);
            break;
          case "audio":
            await handleAudioMessage(userId, rt, msg.id);
            break;
          default:
            await replyMessage(rt, "暫時只支援文字、相片、影片同檔案 📎");
            break;
        }
      })
    )
      .then(() => res.status(200).json({ ok: true }))
      .catch((err) => {
        console.error("LINE webhook error:", err);
        res.status(200).json({ ok: true });
      });
  });

  console.log("LINE bot webhook registered at /api/line/webhook");

  startDailyWeatherScheduler();
  startDailyFoodSummaryScheduler();
  startSleepReminderScheduler();
  // NOTE: weekly wiki lint is intentionally started from server/index.js,
  // not here, so it runs even when LINE bot credentials are missing
  // (the LINE push step is gated per-user on lineUserId presence).
}

const sleepReminderLastSent = new Map();
const sleepCleanLastSent = new Map();

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

async function tickSleepReminders() {
  try {
    const enabled = await db.select().from(users).where(
      sql`(${users.sleepReminderEnabled} = true OR ${users.sleepCleanReminderEnabled} = true) AND ${users.lineUserId} IS NOT NULL`
    );
    for (const user of enabled) {
      if (!user.lineUserId || user.lineUserId.length <= 5) continue;
      const tz = user.timezone || "Asia/Hong_Kong";
      const { hour, minute, todayStr } = getTimePartsInTz(tz);

      if (user.sleepReminderEnabled) {
        const targetH = user.sleepReminderHour ?? 23;
        const targetM = user.sleepReminderMinute ?? 0;
        if (hour === targetH && minute === targetM) {
          const dedup = `sleep:${todayStr}`;
          if (sleepReminderLastSent.get(user.id) !== dedup) {
            try {
              await pushMessage(user.lineUserId, `🌙 該戴添眠喇 (${String(targetH).padStart(2,'0')}:${String(targetM).padStart(2,'0')})\n記得開機、戴好、瞓得好啲 💤`);
              sleepReminderLastSent.set(user.id, dedup);
              console.log(`Sleep reminder sent: ${user.email} ${tz} ${targetH}:${targetM}`);
            } catch (e) { console.error(`Sleep reminder failed for ${user.email}:`, e.message); }
          }
        }
      }

      if (user.sleepCleanReminderEnabled) {
        const targetDow = user.sleepCleanReminderDow ?? 0;
        const targetH = user.sleepCleanReminderHour ?? 10;
        const targetM = user.sleepCleanReminderMinute ?? 0;
        const now = getNowInTz(tz);
        if (now.getDay() === targetDow && hour === targetH && minute === targetM) {
          const wk = isoWeek(now);
          const dedup = `sleepclean:${wk}`;
          if (sleepCleanLastSent.get(user.id) !== dedup) {
            try {
              await pushMessage(user.lineUserId, `🧼 每週添眠保養提醒\n記得清潔添眠枕嘅氣囊、面罩同管路，保持衛生先瞓得安心 ✨`);
              sleepCleanLastSent.set(user.id, dedup);
              console.log(`Sleep clean reminder sent: ${user.email} ${tz} dow=${targetDow}`);
            } catch (e) { console.error(`Sleep clean reminder failed for ${user.email}:`, e.message); }
          }
        }
      }
    }
  } catch (e) {
    console.error("Sleep reminder tick error:", e.message);
  }
}

function startSleepReminderScheduler() {
  setInterval(() => { tickSleepReminders().catch(e => console.error("Sleep tick:", e.message)); }, 60 * 1000);
  console.log("Sleep reminder scheduler started");
}
