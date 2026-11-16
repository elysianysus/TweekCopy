import { test } from "node:test";
import assert from "node:assert/strict";

import {
    getZoneAbbreviation,
    getZoneAbbreviationLongName,
    isZoneInDST,
    ABBR_LONG_NAMES,
    ZONE_ABBR_FALLBACK,
} from "../src/scripts/timezoneAbbr.js";

const SUMMER = new Date("2026-07-15T12:00:00Z");
const WINTER = new Date("2026-01-15T12:00:00Z");

test("isZoneInDST: northern hemisphere zones are in DST in summer, not in winter", () => {
    assert.equal(isZoneInDST("America/Los_Angeles", SUMMER), true);
    assert.equal(isZoneInDST("America/Los_Angeles", WINTER), false);
    assert.equal(isZoneInDST("America/New_York", SUMMER), true);
    assert.equal(isZoneInDST("America/New_York", WINTER), false);
    assert.equal(isZoneInDST("Europe/London", SUMMER), true);
    assert.equal(isZoneInDST("Europe/London", WINTER), false);
    assert.equal(isZoneInDST("Europe/Paris", SUMMER), true);
    assert.equal(isZoneInDST("Europe/Paris", WINTER), false);
});

test("isZoneInDST: southern hemisphere zones are in DST in (their) summer = January", () => {
    assert.equal(isZoneInDST("Australia/Sydney", WINTER), true);
    assert.equal(isZoneInDST("Australia/Sydney", SUMMER), false);
    assert.equal(isZoneInDST("Pacific/Auckland", WINTER), true);
    assert.equal(isZoneInDST("Pacific/Auckland", SUMMER), false);
});

test("isZoneInDST: zones without DST always return false", () => {
    assert.equal(isZoneInDST("Asia/Tokyo", SUMMER), false);
    assert.equal(isZoneInDST("Asia/Tokyo", WINTER), false);
    assert.equal(isZoneInDST("Asia/Kolkata", SUMMER), false);
    assert.equal(isZoneInDST("Asia/Kolkata", WINTER), false);
    assert.equal(isZoneInDST("UTC", SUMMER), false);
});

test("getZoneAbbreviation: returns the expected abbreviation for fallback-mapped zones", () => {
    // Asia/Tokyo has no DST and no Intl short name in many runtimes;
    // fallback should always yield JST.
    assert.equal(getZoneAbbreviation("Asia/Tokyo", SUMMER), "JST");
    assert.equal(getZoneAbbreviation("Asia/Tokyo", WINTER), "JST");
});

test("getZoneAbbreviation: switches between standard and DST names across the year", () => {
    // America/Los_Angeles: PST in winter, PDT in summer.
    assert.equal(getZoneAbbreviation("America/Los_Angeles", SUMMER), "PDT");
    assert.equal(getZoneAbbreviation("America/Los_Angeles", WINTER), "PST");

    // Europe/London: GMT in winter, BST in summer.
    assert.equal(getZoneAbbreviation("Europe/London", SUMMER), "BST");
    assert.equal(getZoneAbbreviation("Europe/London", WINTER), "GMT");

    // Australia/Sydney: AEDT in (southern) summer = January, AEST in July.
    assert.equal(getZoneAbbreviation("Australia/Sydney", WINTER), "AEDT");
    assert.equal(getZoneAbbreviation("Australia/Sydney", SUMMER), "AEST");

    // Europe/Paris: CET in winter, CEST in summer.
    assert.equal(getZoneAbbreviation("Europe/Paris", SUMMER), "CEST");
    assert.equal(getZoneAbbreviation("Europe/Paris", WINTER), "CET");
});

test("getZoneAbbreviation: handles UTC family", () => {
    assert.equal(getZoneAbbreviation("UTC", SUMMER), "UTC");
    assert.equal(getZoneAbbreviation("Etc/UTC", WINTER), "UTC");
});

test("getZoneAbbreviation: returns empty string for an unknown zone with no Intl support", () => {
    // A zone that doesn't exist in the IANA database — Intl will throw, the
    // fallback table won't have it, so we get an empty string (which the UI
    // treats as 'no abbreviation column for this row').
    assert.equal(getZoneAbbreviation("Not/A_Real_Zone", SUMMER), "");
});

test("ZONE_ABBR_FALLBACK: every entry has a non-empty std abbreviation", () => {
    for (const [zone, entry] of Object.entries(ZONE_ABBR_FALLBACK)) {
        assert.ok(
            entry && typeof entry.std === "string" && entry.std.length > 0,
            `expected std abbreviation for ${zone}, got ${JSON.stringify(entry)}`,
        );
        if (entry.dst !== undefined) {
            assert.ok(
                typeof entry.dst === "string" && entry.dst.length > 0,
                `expected non-empty dst abbreviation for ${zone}`,
            );
        }
    }
});

test("ZONE_ABBR_FALLBACK: covers the major zones called out in the task description", () => {
    // The task spec explicitly mentions JST, PST, BST as examples — make
    // sure those three are present so search-by-abbreviation works at minimum.
    assert.equal(ZONE_ABBR_FALLBACK["Asia/Tokyo"].std, "JST");
    assert.equal(ZONE_ABBR_FALLBACK["America/Los_Angeles"].std, "PST");
    assert.equal(ZONE_ABBR_FALLBACK["America/Los_Angeles"].dst, "PDT");
    assert.equal(ZONE_ABBR_FALLBACK["Europe/London"].std, "GMT");
    assert.equal(ZONE_ABBR_FALLBACK["Europe/London"].dst, "BST");
});

test("getZoneAbbreviationLongName: resolves the unambiguous abbreviations from the task description", () => {
    assert.equal(getZoneAbbreviationLongName("Asia/Tokyo", "JST"), "Japan Standard Time");
    assert.equal(getZoneAbbreviationLongName("Europe/London", "BST"), "British Summer Time");
    assert.equal(getZoneAbbreviationLongName("Australia/Sydney", "AEDT"), "Australian Eastern Daylight Time");
    assert.equal(getZoneAbbreviationLongName("America/Los_Angeles", "PDT"), "Pacific Daylight Time");
    assert.equal(getZoneAbbreviationLongName("America/Anchorage", "AKDT"), "Alaska Daylight Time");
    assert.equal(getZoneAbbreviationLongName("Pacific/Guam", "ChST"), "Chamorro Standard Time");
    assert.equal(getZoneAbbreviationLongName("Europe/Paris", "CEST"), "Central European Summer Time");
});

test("getZoneAbbreviationLongName: disambiguates CST per-zone (China vs Central vs Cuba)", () => {
    assert.equal(getZoneAbbreviationLongName("Asia/Shanghai", "CST"), "China Standard Time");
    assert.equal(getZoneAbbreviationLongName("America/Chicago", "CST"), "Central Standard Time");
    assert.equal(getZoneAbbreviationLongName("America/Mexico_City", "CST"), "Central Standard Time");
    assert.equal(getZoneAbbreviationLongName("America/Havana", "CST"), "Cuba Standard Time");
});

test("getZoneAbbreviationLongName: disambiguates IST per-zone (India vs Israel vs Ireland)", () => {
    assert.equal(getZoneAbbreviationLongName("Asia/Kolkata", "IST"), "India Standard Time");
    assert.equal(getZoneAbbreviationLongName("Asia/Jerusalem", "IST"), "Israel Standard Time");
    assert.equal(getZoneAbbreviationLongName("Europe/Dublin", "IST"), "Irish Standard Time");
});

test("getZoneAbbreviationLongName: disambiguates AST per-zone (Arabia vs Atlantic)", () => {
    assert.equal(getZoneAbbreviationLongName("Asia/Riyadh", "AST"), "Arabia Standard Time");
    assert.equal(getZoneAbbreviationLongName("America/Halifax", "AST"), "Atlantic Standard Time");
    assert.equal(getZoneAbbreviationLongName("America/Halifax", "ADT"), "Atlantic Daylight Time");
});

test("getZoneAbbreviationLongName: returns empty string for empty / unknown abbreviations", () => {
    assert.equal(getZoneAbbreviationLongName("Asia/Tokyo", ""), "");
    assert.equal(getZoneAbbreviationLongName("Asia/Tokyo", null), "");
    assert.equal(getZoneAbbreviationLongName("Asia/Tokyo", undefined), "");
    // A made-up abbreviation we don't know — better to render no tooltip
    // than a wrong one.
    assert.equal(getZoneAbbreviationLongName("Asia/Tokyo", "ZZZ"), "");
});

test("getZoneAbbreviationLongName: works for Intl-only abbreviations on zones not in the curated table", () => {
    // A zone that isn't in ZONE_ABBR_FALLBACK but whose Intl-returned
    // abbreviation is in the generic ABBR_LONG_NAMES table should still
    // resolve. We pass the abbreviation directly to simulate the result of
    // getZoneAbbreviation() in a runtime that has a "short" name for it.
    assert.equal(getZoneAbbreviationLongName("America/Boise", "MDT"), "Mountain Daylight Time");
    assert.equal(getZoneAbbreviationLongName("Pacific/Pago_Pago", "SST"), "Samoa Standard Time");
});

test("ABBR_LONG_NAMES: every value is a non-empty string", () => {
    for (const [abbr, name] of Object.entries(ABBR_LONG_NAMES)) {
        assert.ok(
            typeof name === "string" && name.length > 0,
            `expected non-empty long name for ${abbr}, got ${JSON.stringify(name)}`,
        );
    }
});

test("ABBR_LONG_NAMES: omits ambiguous abbreviations (handled per-zone instead)", () => {
    // CST, IST, AST and BST mean different things in different zones — the
    // generic table must not pick a default, since that would mislead users
    // for the other meanings.
    assert.equal(ABBR_LONG_NAMES.CST, undefined);
    assert.equal(ABBR_LONG_NAMES.IST, undefined);
    assert.equal(ABBR_LONG_NAMES.AST, undefined);
    assert.equal(ABBR_LONG_NAMES.BST, undefined);
});
