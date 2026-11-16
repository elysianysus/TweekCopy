import { db } from "./db.js";
import { foodNutritionCache, foodLog } from "./schema.js";
import { eq, and } from "drizzle-orm";

const FATSECRET_TOKEN_URL = "https://oauth.fatsecret.com/connect/token";
const FATSECRET_API_URL = "https://platform.fatsecret.com/rest/server.api";
const OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product";
const USER_AGENT = "Analogue-Planner/1.0 (https://replit.com)";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let fatsecretToken = null;
let fatsecretTokenExp = 0;

const usage = {
  date: hkDate(),
  fatsecret: 0,
  openfoodfacts: 0,
};

function hkDate() {
  const now = new Date();
  const hk = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Hong_Kong" }));
  return `${hk.getFullYear()}-${String(hk.getMonth() + 1).padStart(2, "0")}-${String(hk.getDate()).padStart(2, "0")}`;
}

function rolloverIfNeeded() {
  const today = hkDate();
  if (usage.date !== today) {
    usage.date = today;
    usage.fatsecret = 0;
    usage.openfoodfacts = 0;
  }
}

export function getUsage() {
  rolloverIfNeeded();
  return {
    date: usage.date,
    fatsecret: usage.fatsecret,
    openfoodfacts: usage.openfoodfacts,
    fatsecretConfigured: Boolean(process.env.FATSECRET_CLIENT_ID && process.env.FATSECRET_CLIENT_SECRET),
    fatsecretDailyLimit: 5000,
  };
}

function normalizeKey(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[\s,.\-_/()【】（）「」『』]+/g, "")
    .replace(/[0-9]+(碗|杯|份|個|塊|片|條|碟|份量|kcal|g|ml)/g, "")
    .slice(0, 120);
}

async function readCacheRow(source, key) {
  try {
    const [row] = await db
      .select()
      .from(foodNutritionCache)
      .where(and(eq(foodNutritionCache.source, source), eq(foodNutritionCache.lookupKey, key)));
    return row || null;
  } catch {
    return null;
  }
}

async function readCache(source, key) {
  const row = await readCacheRow(source, key);
  if (!row) return null;
  const fetchedAt = row.fetchedAt ? new Date(row.fetchedAt).getTime() : 0;
  if (Date.now() - fetchedAt > CACHE_TTL_MS) return null;
  return row;
}

async function writeCache(source, key, data) {
  try {
    const existing = await readCacheRow(source, key);
    const values = {
      source,
      lookupKey: key,
      name: data.name || "",
      caloriesPerServing: Math.round(data.calories || 0),
      servingDescription: data.servingDescription || "",
      protein: data.protein != null ? String(data.protein) : null,
      carbs: data.carbs != null ? String(data.carbs) : null,
      fat: data.fat != null ? String(data.fat) : null,
      sodium: data.sodium != null ? String(data.sodium) : null,
      raw: data.raw ? JSON.stringify(data.raw).slice(0, 8000) : "",
      fetchedAt: new Date(),
    };
    if (existing) {
      await db.update(foodNutritionCache).set(values).where(eq(foodNutritionCache.id, existing.id));
    } else {
      await db.insert(foodNutritionCache).values(values);
    }
  } catch (e) {
    console.error("[nutrition] cache write failed:", e.message);
  }
}

async function getFatsecretToken() {
  const id = process.env.FATSECRET_CLIENT_ID;
  const secret = process.env.FATSECRET_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (fatsecretToken && Date.now() < fatsecretTokenExp - 60_000) return fatsecretToken;
  try {
    const auth = Buffer.from(`${id}:${secret}`).toString("base64");
    const res = await fetch(FATSECRET_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=basic",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error("[nutrition] FatSecret token error:", res.status);
      return null;
    }
    const j = await res.json();
    fatsecretToken = j.access_token;
    fatsecretTokenExp = Date.now() + (j.expires_in || 3600) * 1000;
    return fatsecretToken;
  } catch (e) {
    console.error("[nutrition] FatSecret token exception:", e.message);
    return null;
  }
}

async function fatsecretCall(method, params) {
  const token = await getFatsecretToken();
  if (!token) return null;
  rolloverIfNeeded();
  usage.fatsecret += 1;
  const body = new URLSearchParams({ method, format: "json", ...params });
  try {
    const res = await fetch(FATSECRET_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error(`[nutrition] FatSecret ${method} error:`, e.message);
    return null;
  }
}

function parseServingNumber(v) {
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function nameSimilarity(query, candidate) {
  const q = String(query || "").toLowerCase().trim();
  const c = String(candidate || "").toLowerCase().trim();
  if (!q || !c) return 0;
  const hasCJK = /[\u3400-\u9fff]/.test(q) || /[\u3400-\u9fff]/.test(c);
  if (hasCJK) {
    const qChars = new Set(Array.from(q).filter(ch => /[\u3400-\u9fff]/.test(ch)));
    const cChars = new Set(Array.from(c).filter(ch => /[\u3400-\u9fff]/.test(ch)));
    if (qChars.size === 0 || cChars.size === 0) return 0;
    let overlap = 0;
    qChars.forEach(ch => { if (cChars.has(ch)) overlap += 1; });
    return overlap / Math.min(qChars.size, cChars.size);
  }
  const qTokens = new Set(q.split(/\s+/).filter(t => t.length >= 2));
  const cTokens = new Set(c.split(/\s+/).filter(t => t.length >= 2));
  if (qTokens.size === 0 || cTokens.size === 0) return 0;
  let overlap = 0;
  qTokens.forEach(t => { if (cTokens.has(t)) overlap += 1; });
  return overlap / Math.min(qTokens.size, cTokens.size);
}

function pickBestServing(servings) {
  if (!servings) return null;
  const list = Array.isArray(servings.serving) ? servings.serving : [servings.serving];
  if (!list.length) return null;
  const preferred = list.find(s => /1\s*(serving|cup|piece|bowl|碗|杯|份|個)/i.test(s.serving_description || ""));
  return preferred || list[0];
}

export async function lookupByName(query) {
  const key = normalizeKey(query);
  if (!key) return null;
  const cached = await readCache("fatsecret", key);
  if (cached && cached.caloriesPerServing > 0) {
    return {
      source: "fatsecret",
      name: cached.name,
      calories: cached.caloriesPerServing,
      servingDescription: cached.servingDescription,
      protein: parseServingNumber(cached.protein),
      carbs: parseServingNumber(cached.carbs),
      fat: parseServingNumber(cached.fat),
      sodium: parseServingNumber(cached.sodium),
      cached: true,
    };
  }
  const search = await fatsecretCall("foods.search.v3", {
    search_expression: query,
    max_results: 5,
    include_food_attributes: "false",
    flag_default_serving: "true",
  });
  const rawResults = search?.foods_search?.results?.food;
  const candidates = Array.isArray(rawResults) ? rawResults : (rawResults ? [rawResults] : []);
  if (candidates.length === 0) return null;
  let best = null;
  let bestSim = 0;
  for (const c of candidates) {
    if (!c?.food_id) continue;
    const sim = nameSimilarity(query, c.food_name);
    if (sim > bestSim) { bestSim = sim; best = c; }
  }
  if (!best || bestSim < 0.5) return null;
  const detail = await fatsecretCall("food.get.v4", { food_id: best.food_id });
  const food = detail?.food;
  if (!food) return null;
  const serving = pickBestServing(food.servings);
  if (!serving) return null;
  const data = {
    name: food.food_name,
    calories: parseServingNumber(serving.calories) || 0,
    servingDescription: serving.serving_description || "",
    protein: parseServingNumber(serving.protein),
    carbs: parseServingNumber(serving.carbohydrate),
    fat: parseServingNumber(serving.fat),
    sodium: parseServingNumber(serving.sodium),
    raw: { food_id: food.food_id, brand_name: food.brand_name },
  };
  if (data.calories <= 0) return null;
  await writeCache("fatsecret", key, data);
  return {
    source: "fatsecret",
    name: data.name,
    calories: Math.round(data.calories),
    servingDescription: data.servingDescription,
    protein: data.protein,
    carbs: data.carbs,
    fat: data.fat,
    sodium: data.sodium,
    cached: false,
  };
}

export async function lookupByBarcode(barcode) {
  const key = String(barcode || "").replace(/\D/g, "");
  if (!key) return null;
  const cached = await readCache("openfoodfacts", key);
  if (cached && cached.caloriesPerServing > 0) {
    return {
      source: "openfoodfacts",
      name: cached.name,
      calories: cached.caloriesPerServing,
      servingDescription: cached.servingDescription,
      protein: cached.protein,
      carbs: cached.carbs,
      fat: cached.fat,
      sodium: cached.sodium,
      cached: true,
    };
  }
  rolloverIfNeeded();
  usage.openfoodfacts += 1;
  try {
    const res = await fetch(`${OFF_PRODUCT_URL}/${encodeURIComponent(key)}.json?fields=product_name,product_name_zh,brands,nutriments,serving_size,serving_quantity`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (j.status !== 1 || !j.product) return null;
    const p = j.product;
    const n = p.nutriments || {};
    const servingQty = parseServingNumber(p.serving_quantity);
    const kcalPer100 = parseServingNumber(n["energy-kcal_100g"]) || (parseServingNumber(n["energy_100g"]) ? parseServingNumber(n["energy_100g"]) / 4.184 : null);
    let calories = parseServingNumber(n["energy-kcal_serving"]);
    if (!calories && kcalPer100 && servingQty) calories = (kcalPer100 * servingQty) / 100;
    if (!calories && kcalPer100) calories = kcalPer100;
    if (!calories) return null;
    const name = p.product_name_zh || p.product_name || (p.brands ? p.brands : `Barcode ${key}`);
    const servingDescription = p.serving_size || (servingQty ? `${servingQty} g` : "100 g");
    const data = {
      name,
      calories,
      servingDescription,
      protein: parseServingNumber(n.proteins_serving) || parseServingNumber(n.proteins_100g),
      carbs: parseServingNumber(n.carbohydrates_serving) || parseServingNumber(n.carbohydrates_100g),
      fat: parseServingNumber(n.fat_serving) || parseServingNumber(n.fat_100g),
      sodium: parseServingNumber(n.sodium_serving) || parseServingNumber(n.sodium_100g),
      raw: { code: key, brands: p.brands },
    };
    await writeCache("openfoodfacts", key, data);
    return {
      source: "openfoodfacts",
      name,
      calories: Math.round(calories),
      servingDescription,
      protein: data.protein,
      carbs: data.carbs,
      fat: data.fat,
      sodium: data.sodium,
      cached: false,
    };
  } catch (e) {
    console.error("[nutrition] OpenFoodFacts error:", e.message);
    return null;
  }
}

export async function enrichItems(items) {
  if (!Array.isArray(items) || items.length === 0) return { items: [], totalCalories: 0, anyEnriched: false };
  const enriched = await Promise.all(
    items.map(async (it) => {
      const aiCal = parseInt(it.calories) || 0;
      const name = (it.name || "").toString().trim();
      if (!name) return { ...it, calories: aiCal, source: "ai" };
      try {
        const hit = await lookupByName(name);
        if (hit && hit.calories > 0) {
          return {
            ...it,
            name: it.name,
            matchedName: hit.name,
            calories: hit.calories,
            source: "fatsecret",
            servingDescription: hit.servingDescription,
            protein: hit.protein,
            carbs: hit.carbs,
            fat: hit.fat,
            sodium: hit.sodium,
          };
        }
      } catch (e) {
        console.error("[nutrition] enrich error:", e.message);
      }
      return { ...it, calories: aiCal, source: "ai" };
    })
  );
  const totalCalories = enriched.reduce((s, it) => s + (parseInt(it.calories) || 0), 0);
  const anyEnriched = enriched.some(it => it.source === "fatsecret");
  return { items: enriched, totalCalories, anyEnriched };
}

export function adjustHealthScoreForCalories(aiScore, aiTotal, correctedTotal) {
  const score = Math.max(0, Math.min(10, parseInt(aiScore) || 0));
  const ai = parseInt(aiTotal) || 0;
  const corrected = parseInt(correctedTotal) || 0;
  if (score === 0 || ai === 0 || corrected === 0) return score;
  const ratio = corrected / ai;
  let delta = 0;
  if (ratio >= 1.5) delta = -2;
  else if (ratio >= 1.2) delta = -1;
  else if (ratio <= 0.6) delta = +1;
  return Math.max(1, Math.min(10, score + delta));
}

export function sourceEmoji(src) {
  if (src === "fatsecret") return "📊";
  if (src === "openfoodfacts") return "📦";
  return "🤖";
}

function num(v) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

export function sumMacros(items) {
  const totals = { protein: 0, carbs: 0, fat: 0, sodium: 0 };
  let any = false;
  for (const it of items || []) {
    for (const k of Object.keys(totals)) {
      const v = num(it?.[k]);
      if (v != null) {
        totals[k] += v;
        any = true;
      }
    }
  }
  return any ? totals : null;
}

export function formatMacroSummary(items) {
  const totals = sumMacros(items);
  if (!totals) return "";
  const parts = [];
  if (totals.protein > 0) parts.push(`P ${Math.round(totals.protein)}g`);
  if (totals.carbs > 0) parts.push(`C ${Math.round(totals.carbs)}g`);
  if (totals.fat > 0) parts.push(`F ${Math.round(totals.fat)}g`);
  if (totals.sodium > 0) parts.push(`Na ${Math.round(totals.sodium)}mg`);
  return parts.join(" · ");
}

function normalizeDateYMD(date) {
  if (!date) return null;
  const m = String(date).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m) return String(date);
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

export async function getTodayMacroTotals(uid, date) {
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, sodium: 0 };
  if (!uid || !date) return totals;
  const normDate = normalizeDateYMD(date);
  try {
    const rows = await db.select().from(foodLog)
      .where(and(eq(foodLog.uid, uid), eq(foodLog.date, normDate)));
    for (const r of rows) {
      totals.calories += Number(r.totalCalories) || 0;
      let items = [];
      try { items = JSON.parse(r.items || "[]"); } catch {}
      const m = sumMacros(items);
      if (m) {
        totals.protein += m.protein || 0;
        totals.carbs += m.carbs || 0;
        totals.fat += m.fat || 0;
        totals.sodium += m.sodium || 0;
      }
    }
  } catch (e) {
    console.error("[nutrition] getTodayMacroTotals error:", e.message);
  }
  return totals;
}

export function buildGoalContext(user, todayTotals) {
  if (!user) return null;
  const goals = {
    protein: { goal: user.proteinGoal ?? null, isMax: false, unit: "g", label: "蛋白質" },
    carbs:   { goal: user.carbsGoal ?? null,   isMax: false, unit: "g", label: "碳水" },
    fat:     { goal: user.fatGoal ?? null,     isMax: false, unit: "g", label: "脂肪" },
    sodium:  { goal: user.sodiumGoal ?? null,  isMax: !!(user.sodiumIsMax ?? true), unit: "mg", label: "鈉" },
  };
  const anySet = Object.values(goals).some(g => g.goal != null && g.goal > 0);
  if (!anySet) return null;
  return {
    goals,
    totals: todayTotals || { calories: 0, protein: 0, carbs: 0, fat: 0, sodium: 0 },
  };
}

const _r0 = (n) => Math.round(Number(n) || 0);

export function formatGoalsForPrompt(ctx) {
  if (!ctx) return "";
  const lines = [];
  for (const [k, g] of Object.entries(ctx.goals)) {
    if (g.goal == null || g.goal <= 0) continue;
    const total = _r0(ctx.totals?.[k]);
    if (g.isMax) {
      const room = g.goal - total;
      lines.push(`- ${g.label}：每日上限 ${g.goal}${g.unit}，今日累計 ${total}${g.unit}（${room > 0 ? `仲剩 ${room}${g.unit} 空間` : `已超 ${-room}${g.unit}`}）`);
    } else {
      const remaining = g.goal - total;
      lines.push(`- ${g.label}：每日目標 ${g.goal}${g.unit}，今日累計 ${total}${g.unit}（${remaining > 0 ? `仲爭 ${remaining}${g.unit}` : `已達標${remaining < 0 ? `，超 ${-remaining}${g.unit}` : ""}`}）`);
    }
  }
  if (lines.length === 0) return "";
  return `\n\n⚠️ 用戶今日營養目標 vs 今日已攝入（未計呢一餐）：\n${lines.join("\n")}\n\n寫 suggestion 時要做嘅事：\n- 參考呢餐會點影響上面嘅目標差距，喺廣東話 suggestion 入面用具體數字提一句，例如「食呢餐後仲爭 18g 蛋白質先到目標 60g」或「今日鈉已 2100mg，超過 2000mg 上限，下一餐建議走鹽」。\n- 只可以提上面有列出嘅目標 (用戶冇設嘅完全唔好提，唔好作數字)。\n- 唔好同一句重複數字，總長仍然係 2-4 句。`;
}

export function formatGoalSummaryForReply(ctx) {
  if (!ctx) return "";
  const lines = [];
  for (const [k, g] of Object.entries(ctx.goals)) {
    if (g.goal == null || g.goal <= 0) continue;
    const total = _r0(ctx.totals?.[k]);
    if (g.isMax) {
      if (total > g.goal) {
        lines.push(`⚠️ ${g.label}：今日 ${total}${g.unit} / 上限 ${g.goal}${g.unit}（超 ${total - g.goal}${g.unit}）`);
      } else {
        lines.push(`✅ ${g.label}：今日 ${total}${g.unit} / 上限 ${g.goal}${g.unit}（仲剩 ${g.goal - total}${g.unit}）`);
      }
    } else {
      const remaining = g.goal - total;
      if (remaining > 0) {
        lines.push(`🎯 ${g.label}：今日 ${total}${g.unit} / 目標 ${g.goal}${g.unit}（仲爭 ${remaining}${g.unit}）`);
      } else {
        lines.push(`✅ ${g.label}：今日 ${total}${g.unit} / 目標 ${g.goal}${g.unit}（已達標${remaining < 0 ? `，多 ${-remaining}${g.unit}` : ""}）`);
      }
    }
  }
  if (lines.length === 0) return "";
  return `\n\n🎯 今日目標進度：\n${lines.join("\n")}`;
}

export function formatGoalCoachingForReply(ctx, mealMacros) {
  if (!ctx) return "";
  if (!mealMacros || typeof mealMacros !== "object") return "";
  const hasMeal = ["protein", "carbs", "fat", "sodium"].some(k => Number(mealMacros[k]) > 0);
  if (!hasMeal) return "";
  const m = mealMacros;
  const newTotals = {
    protein: (ctx.totals?.protein || 0) + (m.protein || 0),
    carbs:   (ctx.totals?.carbs   || 0) + (m.carbs   || 0),
    fat:     (ctx.totals?.fat     || 0) + (m.fat     || 0),
    sodium:  (ctx.totals?.sodium  || 0) + (m.sodium  || 0),
  };
  const lines = [];
  for (const [k, g] of Object.entries(ctx.goals)) {
    if (g.goal == null || g.goal <= 0) continue;
    const total = _r0(newTotals[k]);
    if (g.isMax) {
      if (total > g.goal) {
        lines.push(`⚠️ ${g.label}：今日 ${total}${g.unit} / 上限 ${g.goal}${g.unit}（超 ${total - g.goal}${g.unit}）`);
      } else {
        lines.push(`✅ ${g.label}：今日 ${total}${g.unit} / 上限 ${g.goal}${g.unit}（仲剩 ${g.goal - total}${g.unit}）`);
      }
    } else {
      const remaining = g.goal - total;
      if (remaining > 0) {
        lines.push(`🎯 ${g.label}：今日 ${total}${g.unit} / 目標 ${g.goal}${g.unit}（仲爭 ${remaining}${g.unit}）`);
      } else {
        lines.push(`✅ ${g.label}：今日 ${total}${g.unit} / 目標 ${g.goal}${g.unit}（已達標${remaining < 0 ? `，多 ${-remaining}${g.unit}` : ""}）`);
      }
    }
  }
  if (lines.length === 0) return "";
  return `\n\n🎯 今日目標進度：\n${lines.join("\n")}`;
}

export function sourcesFooter(items) {
  const set = new Set(items.map(it => it.source).filter(Boolean));
  if (!set.has("fatsecret") && !set.has("openfoodfacts")) return "";
  const parts = [];
  if (set.has("fatsecret")) parts.push("📊 FatSecret");
  if (set.has("openfoodfacts")) parts.push("📦 Open Food Facts");
  if (set.has("ai")) parts.push("🤖 AI 估算");
  return `\n\n資料：${parts.join(" · ")}`;
}
