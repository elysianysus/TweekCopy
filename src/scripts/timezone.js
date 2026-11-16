export function detectTimezone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
        return "";
    }
}

export function getTimezoneOptions(detected) {
    let zones = [];
    try {
        if (typeof Intl.supportedValuesOf === "function") {
            zones = Intl.supportedValuesOf("timeZone");
        }
    } catch {
        zones = [];
    }
    if (!zones.length) {
        zones = [
            "UTC", "Africa/Cairo", "Africa/Johannesburg", "Africa/Lagos",
            "America/Anchorage", "America/Argentina/Buenos_Aires", "America/Chicago",
            "America/Denver", "America/Halifax", "America/Lima", "America/Los_Angeles",
            "America/Mexico_City", "America/New_York", "America/Phoenix",
            "America/Sao_Paulo", "America/Toronto", "America/Vancouver",
            "Asia/Bangkok", "Asia/Dubai", "Asia/Hong_Kong", "Asia/Jakarta",
            "Asia/Karachi", "Asia/Kolkata", "Asia/Manila", "Asia/Seoul",
            "Asia/Shanghai", "Asia/Singapore", "Asia/Taipei", "Asia/Tehran",
            "Asia/Tokyo", "Australia/Melbourne", "Australia/Perth", "Australia/Sydney",
            "Europe/Amsterdam", "Europe/Athens", "Europe/Berlin", "Europe/Istanbul",
            "Europe/London", "Europe/Madrid", "Europe/Moscow", "Europe/Paris",
            "Europe/Rome", "Europe/Stockholm", "Europe/Warsaw", "Europe/Zurich",
            "Pacific/Auckland", "Pacific/Honolulu",
        ];
    }
    if (detected && !zones.includes(detected)) {
        zones = [detected, ...zones];
    }
    return zones;
}

export function tzOffsetMs(tz, when = new Date()) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        }).formatToParts(when);
        const map = {};
        for (const p of parts) {
            if (p.type !== 'literal') map[p.type] = p.value;
        }
        const hour = parseInt(map.hour, 10) === 24 ? 0 : parseInt(map.hour, 10);
        const wallUtc = Date.UTC(
            parseInt(map.year, 10),
            parseInt(map.month, 10) - 1,
            parseInt(map.day, 10),
            hour,
            parseInt(map.minute, 10),
            parseInt(map.second, 10),
        );
        return Math.round((wallUtc - when.getTime()) / 60000) * 60000;
    } catch {
        return 0;
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
        0, 0,
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

export function isValidTimezone(tz) {
    if (!tz || typeof tz !== 'string') return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}
