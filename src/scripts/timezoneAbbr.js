// Helpers for resolving the short, human-recognizable abbreviation for an
// IANA timezone (e.g. "JST", "PST", "BST"). The renderer in
// TimezoneCombobox.jsx uses these to label each row and to widen search
// matching.
//
// Strategy:
// 1. Ask the runtime via Intl.DateTimeFormat({ timeZoneName: "short" }).
//    Modern Chromium/Firefox return real abbreviations for most zones.
// 2. If the runtime returns a numeric fallback like "GMT+9" or "UTC-03:00"
//    (Safari, slim ICU builds, etc.), fall back to a curated table.
// 3. DST detection compares the current offset to the January and July
//    offsets, so it works correctly in both hemispheres without hardcoded
//    transition dates.

const offsetFormatterCache = new Map();
const abbrFormatterCache = new Map();

function getOffsetFormatter(zone) {
    let f = offsetFormatterCache.get(zone);
    if (!f) {
        try {
            f = new Intl.DateTimeFormat("en-US", {
                timeZone: zone,
                timeZoneName: "longOffset",
            });
        } catch {
            f = null;
        }
        offsetFormatterCache.set(zone, f);
    }
    return f;
}

function getAbbrFormatter(zone) {
    let f = abbrFormatterCache.get(zone);
    if (!f) {
        try {
            f = new Intl.DateTimeFormat("en-US", {
                timeZone: zone,
                timeZoneName: "short",
            });
        } catch {
            f = null;
        }
        abbrFormatterCache.set(zone, f);
    }
    return f;
}

export function getZoneOffsetMinutes(zone, when) {
    const f = getOffsetFormatter(zone);
    if (!f) return Number.POSITIVE_INFINITY;
    let raw = "";
    try {
        const parts = f.formatToParts(when);
        raw = parts.find((p) => p.type === "timeZoneName")?.value || "";
    } catch {
        return Number.POSITIVE_INFINITY;
    }
    if (!raw) return Number.POSITIVE_INFINITY;
    let s = raw.replace(/^GMT/, "UTC").replace(/^UTC$/, "UTC+00:00");
    const m = s.match(/^UTC([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (!m) return Number.POSITIVE_INFINITY;
    const sign = m[1] === "-" ? -1 : 1;
    const hh = parseInt(m[2], 10);
    const mm = parseInt(m[3] || "00", 10);
    return sign * (hh * 60 + mm);
}

export function isZoneInDST(zone, now) {
    const year = now.getUTCFullYear();
    const janOffset = getZoneOffsetMinutes(zone, new Date(Date.UTC(year, 0, 15)));
    const julOffset = getZoneOffsetMinutes(zone, new Date(Date.UTC(year, 6, 15)));
    if (!Number.isFinite(janOffset) || !Number.isFinite(julOffset)) return false;
    if (janOffset === julOffset) return false;
    const curOffset = getZoneOffsetMinutes(zone, now);
    return curOffset === Math.max(janOffset, julOffset);
}

export const ZONE_ABBR_FALLBACK = {
    // Asia
    "Asia/Tokyo": { std: "JST" },
    "Asia/Seoul": { std: "KST" },
    "Asia/Shanghai": { std: "CST" },
    "Asia/Hong_Kong": { std: "HKT" },
    "Asia/Singapore": { std: "SGT" },
    "Asia/Taipei": { std: "CST" },
    "Asia/Bangkok": { std: "ICT" },
    "Asia/Ho_Chi_Minh": { std: "ICT" },
    "Asia/Jakarta": { std: "WIB" },
    "Asia/Manila": { std: "PHT" },
    "Asia/Kuala_Lumpur": { std: "MYT" },
    "Asia/Kolkata": { std: "IST" },
    "Asia/Karachi": { std: "PKT" },
    "Asia/Dubai": { std: "GST" },
    "Asia/Tehran": { std: "IRST", dst: "IRDT" },
    "Asia/Jerusalem": { std: "IST", dst: "IDT" },
    "Asia/Kathmandu": { std: "NPT" },
    "Asia/Yangon": { std: "MMT" },
    "Asia/Riyadh": { std: "AST" },
    "Asia/Baghdad": { std: "AST" },
    "Asia/Almaty": { std: "ALMT" },
    "Asia/Tashkent": { std: "UZT" },
    "Asia/Vladivostok": { std: "VLAT" },
    "Asia/Novosibirsk": { std: "NOVT" },
    "Asia/Yekaterinburg": { std: "YEKT" },
    // Europe
    "Europe/London": { std: "GMT", dst: "BST" },
    "Europe/Dublin": { std: "GMT", dst: "IST" },
    "Europe/Lisbon": { std: "WET", dst: "WEST" },
    "Europe/Paris": { std: "CET", dst: "CEST" },
    "Europe/Berlin": { std: "CET", dst: "CEST" },
    "Europe/Madrid": { std: "CET", dst: "CEST" },
    "Europe/Rome": { std: "CET", dst: "CEST" },
    "Europe/Amsterdam": { std: "CET", dst: "CEST" },
    "Europe/Brussels": { std: "CET", dst: "CEST" },
    "Europe/Vienna": { std: "CET", dst: "CEST" },
    "Europe/Zurich": { std: "CET", dst: "CEST" },
    "Europe/Stockholm": { std: "CET", dst: "CEST" },
    "Europe/Oslo": { std: "CET", dst: "CEST" },
    "Europe/Copenhagen": { std: "CET", dst: "CEST" },
    "Europe/Warsaw": { std: "CET", dst: "CEST" },
    "Europe/Prague": { std: "CET", dst: "CEST" },
    "Europe/Budapest": { std: "CET", dst: "CEST" },
    "Europe/Helsinki": { std: "EET", dst: "EEST" },
    "Europe/Athens": { std: "EET", dst: "EEST" },
    "Europe/Bucharest": { std: "EET", dst: "EEST" },
    "Europe/Sofia": { std: "EET", dst: "EEST" },
    "Europe/Kyiv": { std: "EET", dst: "EEST" },
    "Europe/Kiev": { std: "EET", dst: "EEST" },
    "Europe/Riga": { std: "EET", dst: "EEST" },
    "Europe/Tallinn": { std: "EET", dst: "EEST" },
    "Europe/Vilnius": { std: "EET", dst: "EEST" },
    "Europe/Istanbul": { std: "TRT" },
    "Europe/Moscow": { std: "MSK" },
    // Americas
    "America/New_York": { std: "EST", dst: "EDT" },
    "America/Toronto": { std: "EST", dst: "EDT" },
    "America/Detroit": { std: "EST", dst: "EDT" },
    "America/Indiana/Indianapolis": { std: "EST", dst: "EDT" },
    "America/Chicago": { std: "CST", dst: "CDT" },
    "America/Mexico_City": { std: "CST", dst: "CDT" },
    "America/Winnipeg": { std: "CST", dst: "CDT" },
    "America/Denver": { std: "MST", dst: "MDT" },
    "America/Edmonton": { std: "MST", dst: "MDT" },
    "America/Phoenix": { std: "MST" },
    "America/Los_Angeles": { std: "PST", dst: "PDT" },
    "America/Vancouver": { std: "PST", dst: "PDT" },
    "America/Tijuana": { std: "PST", dst: "PDT" },
    "America/Anchorage": { std: "AKST", dst: "AKDT" },
    "America/Halifax": { std: "AST", dst: "ADT" },
    "America/St_Johns": { std: "NST", dst: "NDT" },
    "America/Sao_Paulo": { std: "BRT" },
    "America/Argentina/Buenos_Aires": { std: "ART" },
    "America/Santiago": { std: "CLT", dst: "CLST" },
    "America/Bogota": { std: "COT" },
    "America/Lima": { std: "PET" },
    "America/Caracas": { std: "VET" },
    "America/La_Paz": { std: "BOT" },
    "America/Havana": { std: "CST", dst: "CDT" },
    // Africa
    "Africa/Cairo": { std: "EET", dst: "EEST" },
    "Africa/Johannesburg": { std: "SAST" },
    "Africa/Lagos": { std: "WAT" },
    "Africa/Nairobi": { std: "EAT" },
    "Africa/Casablanca": { std: "WET", dst: "WEST" },
    "Africa/Algiers": { std: "CET" },
    "Africa/Tunis": { std: "CET" },
    "Africa/Tripoli": { std: "EET" },
    "Africa/Khartoum": { std: "CAT" },
    "Africa/Addis_Ababa": { std: "EAT" },
    "Africa/Accra": { std: "GMT" },
    // Oceania
    "Australia/Sydney": { std: "AEST", dst: "AEDT" },
    "Australia/Melbourne": { std: "AEST", dst: "AEDT" },
    "Australia/Hobart": { std: "AEST", dst: "AEDT" },
    "Australia/Brisbane": { std: "AEST" },
    "Australia/Adelaide": { std: "ACST", dst: "ACDT" },
    "Australia/Darwin": { std: "ACST" },
    "Australia/Perth": { std: "AWST" },
    "Pacific/Auckland": { std: "NZST", dst: "NZDT" },
    "Pacific/Fiji": { std: "FJT" },
    "Pacific/Guam": { std: "ChST" },
    "Pacific/Port_Moresby": { std: "PGT" },
    "Pacific/Honolulu": { std: "HST" },
    // UTC family
    "UTC": { std: "UTC" },
    "Etc/UTC": { std: "UTC" },
    "Etc/GMT": { std: "GMT" },
    "GMT": { std: "GMT" },
};

export function getZoneAbbreviation(zone, now) {
    const f = getAbbrFormatter(zone);
    if (f) {
        try {
            const parts = f.formatToParts(now);
            const raw = parts.find((p) => p.type === "timeZoneName")?.value || "";
            if (raw && !/[+\-\d]/.test(raw)) return raw;
        } catch {
            /* fall through to curated fallback */
        }
    }
    const entry = ZONE_ABBR_FALLBACK[zone];
    if (!entry) return "";
    if (entry.dst && isZoneInDST(zone, now)) return entry.dst;
    return entry.std || "";
}

// Generic abbreviation -> full name lookup. Covers abbreviations that have a
// single, unambiguous meaning across all zones. Ambiguous abbreviations (CST,
// IST, AST, BST, …) are intentionally omitted here and resolved per-zone via
// ZONE_ABBR_LONG_NAMES so we don't show the wrong gloss for, say, Asia/Shanghai
// vs America/Chicago.
export const ABBR_LONG_NAMES = {
    // Asia
    JST: "Japan Standard Time",
    KST: "Korea Standard Time",
    HKT: "Hong Kong Time",
    SGT: "Singapore Time",
    ICT: "Indochina Time",
    WIB: "Western Indonesian Time",
    WITA: "Central Indonesian Time",
    WIT: "Eastern Indonesian Time",
    PHT: "Philippine Time",
    PHST: "Philippine Standard Time",
    MYT: "Malaysia Time",
    PKT: "Pakistan Standard Time",
    GST: "Gulf Standard Time",
    IRST: "Iran Standard Time",
    IRDT: "Iran Daylight Time",
    IDT: "Israel Daylight Time",
    NPT: "Nepal Time",
    MMT: "Myanmar Time",
    ALMT: "Almaty Time",
    UZT: "Uzbekistan Time",
    VLAT: "Vladivostok Time",
    NOVT: "Novosibirsk Time",
    YEKT: "Yekaterinburg Time",
    KRAT: "Krasnoyarsk Time",
    OMST: "Omsk Time",
    IRKT: "Irkutsk Time",
    YAKT: "Yakutsk Time",
    MAGT: "Magadan Time",
    SAKT: "Sakhalin Time",
    PETT: "Kamchatka Time",
    AFT: "Afghanistan Time",
    TJT: "Tajikistan Time",
    TMT: "Turkmenistan Time",
    KGT: "Kyrgyzstan Time",
    BTT: "Bhutan Time",
    BNT: "Brunei Darussalam Time",
    HOVT: "Hovd Time",
    ULAT: "Ulaanbaatar Time",
    CHOT: "Choibalsan Time",
    // Europe
    GMT: "Greenwich Mean Time",
    WET: "Western European Time",
    WEST: "Western European Summer Time",
    CET: "Central European Time",
    CEST: "Central European Summer Time",
    EET: "Eastern European Time",
    EEST: "Eastern European Summer Time",
    TRT: "Turkey Time",
    MSK: "Moscow Standard Time",
    SAMT: "Samara Time",
    VOLT: "Volgograd Time",
    // Americas
    EST: "Eastern Standard Time",
    EDT: "Eastern Daylight Time",
    CDT: "Central Daylight Time",
    MST: "Mountain Standard Time",
    MDT: "Mountain Daylight Time",
    PST: "Pacific Standard Time",
    PDT: "Pacific Daylight Time",
    AKST: "Alaska Standard Time",
    AKDT: "Alaska Daylight Time",
    NST: "Newfoundland Standard Time",
    NDT: "Newfoundland Daylight Time",
    BRT: "Brasília Time",
    BRST: "Brasília Summer Time",
    ART: "Argentina Time",
    CLT: "Chile Standard Time",
    CLST: "Chile Summer Time",
    COT: "Colombia Time",
    PET: "Peru Time",
    VET: "Venezuela Time",
    BOT: "Bolivia Time",
    UYT: "Uruguay Standard Time",
    PYT: "Paraguay Standard Time",
    PYST: "Paraguay Summer Time",
    ECT: "Ecuador Time",
    GFT: "French Guiana Time",
    SRT: "Suriname Time",
    GYT: "Guyana Time",
    // Africa
    SAST: "South Africa Standard Time",
    WAT: "West Africa Time",
    WAST: "West Africa Summer Time",
    EAT: "East Africa Time",
    CAT: "Central Africa Time",
    // Oceania
    AEST: "Australian Eastern Standard Time",
    AEDT: "Australian Eastern Daylight Time",
    ACST: "Australian Central Standard Time",
    ACDT: "Australian Central Daylight Time",
    AWST: "Australian Western Standard Time",
    ACWST: "Australian Central Western Standard Time",
    NZST: "New Zealand Standard Time",
    NZDT: "New Zealand Daylight Time",
    LHST: "Lord Howe Standard Time",
    LHDT: "Lord Howe Daylight Time",
    FJT: "Fiji Time",
    FJST: "Fiji Summer Time",
    ChST: "Chamorro Standard Time",
    PGT: "Papua New Guinea Time",
    HST: "Hawaii Standard Time",
    HDT: "Hawaii-Aleutian Daylight Time",
    HAST: "Hawaii-Aleutian Standard Time",
    HADT: "Hawaii-Aleutian Daylight Time",
    SST: "Samoa Standard Time",
    TAHT: "Tahiti Time",
    CHST: "Chamorro Standard Time",
    CHAST: "Chatham Standard Time",
    CHADT: "Chatham Daylight Time",
    NCT: "New Caledonia Time",
    VUT: "Vanuatu Time",
    SBT: "Solomon Islands Time",
    TKT: "Tokelau Time",
    TVT: "Tuvalu Time",
    TOT: "Tonga Time",
    NUT: "Niue Time",
    CKT: "Cook Islands Time",
    GILT: "Gilbert Islands Time",
    PHOT: "Phoenix Islands Time",
    LINT: "Line Islands Time",
    MART: "Marquesas Time",
    PWT: "Palau Time",
    KOST: "Kosrae Time",
    PONT: "Pohnpei Standard Time",
    CHUT: "Chuuk Time",
    MHT: "Marshall Islands Time",
    NRT: "Nauru Time",
    WST: "West Samoa Standard Time",
    WSST: "West Samoa Standard Time",
    WSDT: "West Samoa Daylight Time",
    // UTC family
    UTC: "Coordinated Universal Time",
};

// Per-zone overrides for abbreviations whose meaning depends on the zone.
// CST, IST, AST and BST all have multiple legitimate expansions, so we
// disambiguate based on the IANA zone the user is looking at.
const ZONE_ABBR_LONG_NAMES = {
    "Asia/Shanghai": { CST: "China Standard Time" },
    "Asia/Taipei": { CST: "Taipei Standard Time" },
    "Asia/Chongqing": { CST: "China Standard Time" },
    "Asia/Harbin": { CST: "China Standard Time" },
    "Asia/Urumqi": { CST: "China Standard Time" },
    "America/Chicago": {
        CST: "Central Standard Time",
        CDT: "Central Daylight Time",
    },
    "America/Mexico_City": {
        CST: "Central Standard Time",
        CDT: "Central Daylight Time",
    },
    "America/Winnipeg": {
        CST: "Central Standard Time",
        CDT: "Central Daylight Time",
    },
    "America/Regina": { CST: "Central Standard Time" },
    "America/Costa_Rica": { CST: "Central Standard Time" },
    "America/El_Salvador": { CST: "Central Standard Time" },
    "America/Guatemala": { CST: "Central Standard Time" },
    "America/Managua": { CST: "Central Standard Time" },
    "America/Tegucigalpa": { CST: "Central Standard Time" },
    "America/Belize": { CST: "Central Standard Time" },
    "America/Havana": {
        CST: "Cuba Standard Time",
        CDT: "Cuba Daylight Time",
    },
    "Asia/Kolkata": { IST: "India Standard Time" },
    "Asia/Calcutta": { IST: "India Standard Time" },
    "Asia/Colombo": { IST: "India Standard Time" },
    "Asia/Jerusalem": { IST: "Israel Standard Time" },
    "Asia/Tel_Aviv": { IST: "Israel Standard Time" },
    "Europe/Dublin": { IST: "Irish Standard Time" },
    "Asia/Riyadh": { AST: "Arabia Standard Time" },
    "Asia/Baghdad": { AST: "Arabia Standard Time" },
    "Asia/Kuwait": { AST: "Arabia Standard Time" },
    "Asia/Qatar": { AST: "Arabia Standard Time" },
    "Asia/Bahrain": { AST: "Arabia Standard Time" },
    "Asia/Aden": { AST: "Arabia Standard Time" },
    "America/Halifax": {
        AST: "Atlantic Standard Time",
        ADT: "Atlantic Daylight Time",
    },
    "America/Moncton": {
        AST: "Atlantic Standard Time",
        ADT: "Atlantic Daylight Time",
    },
    "America/Glace_Bay": {
        AST: "Atlantic Standard Time",
        ADT: "Atlantic Daylight Time",
    },
    "America/Goose_Bay": {
        AST: "Atlantic Standard Time",
        ADT: "Atlantic Daylight Time",
    },
    "America/Thule": {
        AST: "Atlantic Standard Time",
        ADT: "Atlantic Daylight Time",
    },
    "Atlantic/Bermuda": {
        AST: "Atlantic Standard Time",
        ADT: "Atlantic Daylight Time",
    },
    "America/Puerto_Rico": { AST: "Atlantic Standard Time" },
    "America/Barbados": { AST: "Atlantic Standard Time" },
    "America/Martinique": { AST: "Atlantic Standard Time" },
    "Europe/London": { BST: "British Summer Time" },
    "Europe/Belfast": { BST: "British Summer Time" },
    "Europe/Guernsey": { BST: "British Summer Time" },
    "Europe/Isle_of_Man": { BST: "British Summer Time" },
    "Europe/Jersey": { BST: "British Summer Time" },
};

// Resolve an abbreviation to a human-readable full name, e.g.
// ("Asia/Tokyo", "JST") -> "Japan Standard Time".
// Per-zone disambiguation wins over the generic table so that ambiguous
// abbreviations (CST, IST, AST, BST) get the meaning that matches the zone.
// Returns "" when no mapping is known so callers can skip a tooltip rather
// than show a misleading one.
export function getZoneAbbreviationLongName(zone, abbr) {
    if (!abbr) return "";
    const zoneOverrides = ZONE_ABBR_LONG_NAMES[zone];
    if (zoneOverrides && zoneOverrides[abbr]) return zoneOverrides[abbr];
    return ABBR_LONG_NAMES[abbr] || "";
}
