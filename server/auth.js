import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { pool, db } from "./db.js";
import { users } from "./schema.js";
import { eq } from "drizzle-orm";

const PgStore = connectPgSimple(session);

const TZ_EXPANDED_GROUPS_MAX_ITEMS = 64;
const TZ_EXPANDED_GROUPS_MAX_LEN = 64;

export function parseTzExpandedGroups(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    return raw.filter((v) => typeof v === "string");
  }
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v) => typeof v === "string");
  } catch {
    return null;
  }
}

export function sanitizeTzExpandedGroupsInput(value) {
  if (!Array.isArray(value)) return { error: "tzExpandedGroups must be an array of strings" };
  const cleaned = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.length > TZ_EXPANDED_GROUPS_MAX_LEN) {
      return { error: `tzExpandedGroups entry exceeds ${TZ_EXPANDED_GROUPS_MAX_LEN} chars` };
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    cleaned.push(trimmed);
    if (cleaned.length > TZ_EXPANDED_GROUPS_MAX_ITEMS) {
      return { error: `tzExpandedGroups exceeds ${TZ_EXPANDED_GROUPS_MAX_ITEMS} items` };
    }
  }
  return { value: cleaned };
}

function createToken(userId) {
  const payload = JSON.stringify({ userId, iat: Date.now() });
  const b64 = Buffer.from(payload).toString("base64url");
  const sig = crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "fallback-secret")
    .update(b64)
    .digest("hex");
  return `${b64}.${sig}`;
}

function verifyToken(token) {
  try {
    const [b64, sig] = token.split(".");
    if (!b64 || !sig) return null;
    const expected = crypto
      .createHmac("sha256", process.env.SESSION_SECRET || "fallback-secret")
      .update(b64)
      .digest("hex");
    if (sig !== expected) return null;
    const { userId } = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
    return userId || null;
  } catch {
    return null;
  }
}

export function setupAuth(app) {
  const isProd = process.env.NODE_ENV === "production";
  app.set("trust proxy", 1);

  const sessionStore = new PgStore({
    pool,
    tableName: "sessions",
    createTableIfMissing: true,
  });

  app.use(
    session({
      store: sessionStore,
      secret: process.env.SESSION_SECRET || "fallback-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? "none" : "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    })
  );

  app.post("/api/signup", async (req, res) => {
    try {
      const { email, password, name, timezone } = req.body;
      if (!email || !password || !name) {
        return res.status(400).json({ error: "Email, password, and name are required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: "Please enter a valid email address" });
      }

      let validTimezone = null;
      if (typeof timezone === "string" && timezone.length > 0 && timezone.length <= 64) {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: timezone });
          validTimezone = timezone;
        } catch {
          validTimezone = null;
        }
      }

      const existing = await db.select().from(users).where(eq(users.email, email));
      if (existing.length > 0) {
        return res.status(400).json({ error: "Email already in use" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const insertValues = {
        email,
        password: hashedPassword,
        name,
      };
      if (validTimezone) {
        insertValues.timezone = validTimezone;
      }
      const [user] = await db.insert(users).values(insertValues).returning();

      const token = createToken(user.id);
      req.session.userId = user.id;
      req.session.save(() => {
        res.json({
          id: user.id,
          email: user.email,
          name: user.name,
          darkMode: user.darkMode,
          hasPin: !!user.pin,
          proteinGoal: user.proteinGoal ?? null,
          carbsGoal: user.carbsGoal ?? null,
          fatGoal: user.fatGoal ?? null,
          sodiumGoal: user.sodiumGoal ?? null,
          sodiumIsMax: user.sodiumIsMax ?? true,
          dailySummaryEnabled: user.dailySummaryEnabled ?? true,
          dailySummaryHour: user.dailySummaryHour ?? 21,
          dailySummaryMinute: user.dailySummaryMinute ?? 0,
          dailyWeatherEnabled: user.dailyWeatherEnabled ?? true,
          timezone: user.timezone || "Asia/Hong_Kong",
          timezoneAutoBackfillHandledAt: user.timezoneAutoBackfillHandledAt ?? null,
          tzExpandedGroups: parseTzExpandedGroups(user.tzExpandedGroups),
          tzExpandedGroupsUpdatedAt: user.tzExpandedGroupsUpdatedAt ?? null,
          showConfidenceChips: user.showConfidenceChips ?? true,
          lineLinked: !!user.lineUserId,
          token,
        });
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const [user] = await db.select().from(users).where(eq(users.email, email));
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const token = createToken(user.id);
      req.session.userId = user.id;
      req.session.save(() => {
        res.json({
          id: user.id,
          email: user.email,
          name: user.name,
          darkMode: user.darkMode,
          hasPin: !!user.pin,
          proteinGoal: user.proteinGoal ?? null,
          carbsGoal: user.carbsGoal ?? null,
          fatGoal: user.fatGoal ?? null,
          sodiumGoal: user.sodiumGoal ?? null,
          sodiumIsMax: user.sodiumIsMax ?? true,
          dailySummaryEnabled: user.dailySummaryEnabled ?? true,
          dailySummaryHour: user.dailySummaryHour ?? 21,
          dailySummaryMinute: user.dailySummaryMinute ?? 0,
          dailyWeatherEnabled: user.dailyWeatherEnabled ?? true,
          timezone: user.timezone || "Asia/Hong_Kong",
          timezoneAutoBackfillHandledAt: user.timezoneAutoBackfillHandledAt ?? null,
          tzExpandedGroups: parseTzExpandedGroups(user.tzExpandedGroups),
          tzExpandedGroupsUpdatedAt: user.tzExpandedGroupsUpdatedAt ?? null,
          showConfidenceChips: user.showConfidenceChips ?? true,
          lineLinked: !!user.lineUserId,
          token,
        });
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.get("/api/auth/user", async (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    try {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        darkMode: user.darkMode,
        hasPin: !!user.pin,
        proteinGoal: user.proteinGoal ?? null,
        carbsGoal: user.carbsGoal ?? null,
        fatGoal: user.fatGoal ?? null,
        sodiumGoal: user.sodiumGoal ?? null,
        sodiumIsMax: user.sodiumIsMax ?? true,
        dailySummaryEnabled: user.dailySummaryEnabled ?? true,
        dailySummaryHour: user.dailySummaryHour ?? 21,
        dailySummaryMinute: user.dailySummaryMinute ?? 0,
        dailyWeatherEnabled: user.dailyWeatherEnabled ?? true,
        timezone: user.timezone || "Asia/Hong_Kong",
        timezoneAutoBackfillHandledAt: user.timezoneAutoBackfillHandledAt ?? null,
        tzExpandedGroups: parseTzExpandedGroups(user.tzExpandedGroups),
        tzExpandedGroupsUpdatedAt: user.tzExpandedGroupsUpdatedAt ?? null,
        journalNudgeEnabled: user.journalNudgeEnabled ?? true,
        showConfidenceChips: user.showConfidenceChips ?? true,
        lineLinked: !!user.lineUserId,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/access-code", (req, res) => {
    const { code } = req.body;
    const correct = process.env.ACCESS_CODE;
    if (!correct) return res.json({ ok: true });
    if (code === correct) {
      return res.json({ ok: true });
    }
    return res.status(403).json({ error: "Incorrect access code" });
  });

}

function getUserIdFromRequest(req) {
  if (req.session && req.session.userId) return req.session.userId;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    return verifyToken(auth.slice(7));
  }
  return null;
}

export function isAuthenticated(req, res, next) {
  const userId = getUserIdFromRequest(req);
  if (userId) {
    req.userId = userId;
    return next();
  }
  res.status(401).json({ error: "Not authenticated" });
}

export function getAdminUserIds() {
  const raw = process.env.ADMIN_USER_IDS;
  if (!raw) return new Set();
  return new Set(
    String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0),
  );
}

export function isAdmin(req, res, next) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const admins = getAdminUserIds();
  if (admins.size === 0 || !admins.has(Number(userId))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  req.userId = userId;
  return next();
}
