const DEFAULT_TZ = "Asia/Hong_Kong";

export function userTimezone(user) {
  return (user && user.timezone) || DEFAULT_TZ;
}

export function getNowInTz(tz) {
  const tzName = tz || DEFAULT_TZ;
  try {
    return new Date(new Date().toLocaleString("en-US", { timeZone: tzName }));
  } catch {
    return new Date(new Date().toLocaleString("en-US", { timeZone: DEFAULT_TZ }));
  }
}

export function getUserNow(user) {
  return getNowInTz(userTimezone(user));
}

export function todayInTz(tz) {
  const d = getNowInTz(tz);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function userToday(user) {
  return todayInTz(userTimezone(user));
}

export function todayPaddedInTz(tz) {
  const d = getNowInTz(tz);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function userTodayPadded(user) {
  return todayPaddedInTz(userTimezone(user));
}

export function yesterdayInTz(tz) {
  const d = getNowInTz(tz);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function userYesterday(user) {
  return yesterdayInTz(userTimezone(user));
}

export function getTimePartsInTz(tz) {
  const local = getNowInTz(tz);
  const yesterday = new Date(local);
  yesterday.setDate(yesterday.getDate() - 1);
  return {
    hour: local.getHours(),
    minute: local.getMinutes(),
    todayStr: `${local.getFullYear()}-${local.getMonth() + 1}-${local.getDate()}`,
    yesterdayStr: `${yesterday.getFullYear()}-${yesterday.getMonth() + 1}-${yesterday.getDate()}`,
  };
}

export function getUserTimeParts(user) {
  return getTimePartsInTz(userTimezone(user));
}

function tzOffsetMs(tz, when) {
  const tzName = tz || DEFAULT_TZ;
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tzName,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(when);
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    const hour = map.hour === "24" ? 0 : parseInt(map.hour, 10);
    const wallUtc = Date.UTC(
      parseInt(map.year, 10),
      parseInt(map.month, 10) - 1,
      parseInt(map.day, 10),
      hour,
      parseInt(map.minute, 10),
      parseInt(map.second, 10),
    );
    // Round to whole minutes since IANA tz offsets are minute-precision; this
    // also drops the sub-second component of `when` so callers get clean
    // second/minute-aligned timestamps.
    return Math.round((wallUtc - when.getTime()) / 60000) * 60000;
  } catch {
    if (tzName === DEFAULT_TZ) return 0;
    return tzOffsetMs(DEFAULT_TZ, when);
  }
}

export function getNextOccurrenceInTz(tz, targetHour, targetMinute, now = new Date()) {
  const offsetNow = tzOffsetMs(tz, now);
  const wallNowMs = now.getTime() + offsetNow;
  const wallNow = new Date(wallNowMs);
  const target = new Date(Date.UTC(
    wallNow.getUTCFullYear(),
    wallNow.getUTCMonth(),
    wallNow.getUTCDate(),
    targetHour,
    targetMinute,
    0,
    0,
  ));
  if (target.getTime() <= wallNowMs) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  let candidate = new Date(target.getTime() - offsetNow);
  const offsetAtCandidate = tzOffsetMs(tz, candidate);
  if (offsetAtCandidate !== offsetNow) {
    candidate = new Date(target.getTime() - offsetAtCandidate);
  }
  return candidate;
}
