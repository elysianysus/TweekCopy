import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getZoneAbbreviation, getZoneAbbreviationLongName } from '../../scripts/timezoneAbbr.js';
import { createExpandedGroupsSync } from './expandedGroupsSync.js';

const EXPANDED_STORAGE_KEY = "tweek.tzExpandedGroups";

function readStoredExpandedGroups() {
    if (typeof window === "undefined" || !window.localStorage) return null;
    try {
        const raw = window.localStorage.getItem(EXPANDED_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            // Legacy format: bare array, no timestamp
            return {
                groups: new Set(parsed.filter((v) => typeof v === "string")),
                updatedAt: 0,
            };
        }
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.groups)) {
            const updatedAt = Number(parsed.updatedAt);
            return {
                groups: new Set(parsed.groups.filter((v) => typeof v === "string")),
                updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0,
            };
        }
        return null;
    } catch {
        return null;
    }
}

function writeStoredExpandedGroups(groupsSet, updatedAt) {
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
        window.localStorage.setItem(
            EXPANDED_STORAGE_KEY,
            JSON.stringify({ groups: [...groupsSet], updatedAt }),
        );
    } catch {
        /* ignore quota / disabled storage */
    }
}

function normalize(str) {
    return String(str || "")
        .toLowerCase()
        .replace(/[_\/]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

const timeFormatterCache = new Map();
const offsetFormatterCache = new Map();

function getTimeFormatter(zone) {
    let f = timeFormatterCache.get(zone);
    if (!f) {
        try {
            f = new Intl.DateTimeFormat([], {
                timeZone: zone,
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
            });
        } catch {
            f = null;
        }
        timeFormatterCache.set(zone, f);
    }
    return f;
}

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

function getZoneTime(zone, now) {
    const f = getTimeFormatter(zone);
    if (!f) return "";
    try {
        return f.format(now);
    } catch {
        return "";
    }
}

function getZoneOffset(zone, now) {
    const f = getOffsetFormatter(zone);
    if (!f) return "";
    try {
        const parts = f.formatToParts(now);
        const raw = parts.find((p) => p.type === "timeZoneName")?.value || "";
        if (!raw) return "";
        // "GMT" -> "UTC", "GMT+05:30" -> "UTC+05:30", "GMT-8" -> "UTC-08:00"
        let s = raw.replace(/^GMT/, "UTC").replace(/^UTC$/, "UTC+00:00");
        const m = s.match(/^UTC([+-])(\d{1,2})(?::?(\d{2}))?$/);
        if (m) {
            const sign = m[1];
            const hh = m[2].padStart(2, "0");
            const mm = (m[3] || "00").padStart(2, "0");
            s = `UTC${sign}${hh}:${mm}`;
        }
        return s;
    } catch {
        return "";
    }
}

function filterZones(zones, query, zoneInfo) {
    const q = normalize(query);
    if (!q) return zones;
    const tokens = q.split(" ").filter(Boolean);
    return zones.filter((zone) => {
        const info = zoneInfo[zone];
        const haystack = info
            ? `${normalize(zone)} ${normalize(info.time)} ${normalize(info.offset)} ${normalize(info.abbr)}`
            : normalize(zone);
        return tokens.every((t) => haystack.includes(t));
    });
}

const REGION_ORDER = [
    "Africa", "America", "Antarctica", "Arctic", "Asia",
    "Atlantic", "Australia", "Europe", "Indian", "Pacific", "Etc",
];

function getRegion(zone) {
    if (!zone || typeof zone !== "string") return "Other";
    const idx = zone.indexOf("/");
    if (idx === -1) return "Etc";
    return zone.slice(0, idx);
}

function buildGroups(zones) {
    const map = new Map();
    for (const zone of zones) {
        const region = getRegion(zone);
        if (!map.has(region)) map.set(region, []);
        map.get(region).push(zone);
    }
    const groups = [];
    for (const region of REGION_ORDER) {
        if (map.has(region)) {
            groups.push({ region, zones: map.get(region).slice().sort() });
            map.delete(region);
        }
    }
    for (const region of [...map.keys()].sort()) {
        groups.push({ region, zones: map.get(region).slice().sort() });
    }
    return groups;
}

const UNKNOWN_OFFSET = "Unknown offset";

function parseOffsetMinutes(offset) {
    // offset looks like "UTC+09:00", "UTC-05:30", "UTC+00:00"
    if (!offset) return Number.POSITIVE_INFINITY;
    const m = offset.match(/^UTC([+-])(\d{2}):(\d{2})$/);
    if (!m) return Number.POSITIVE_INFINITY;
    const sign = m[1] === "-" ? -1 : 1;
    const hh = parseInt(m[2], 10);
    const mm = parseInt(m[3], 10);
    return sign * (hh * 60 + mm);
}

function buildOffsetGroups(zones, zoneInfo) {
    const map = new Map();
    for (const zone of zones) {
        const offset = (zoneInfo[zone] && zoneInfo[zone].offset) || "";
        const key = offset || UNKNOWN_OFFSET;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(zone);
    }
    const keys = [...map.keys()].sort((a, b) => {
        const am = parseOffsetMinutes(a);
        const bm = parseOffsetMinutes(b);
        if (am !== bm) return am - bm;
        return a.localeCompare(b);
    });
    return keys.map((key) => ({
        region: key,
        zones: map.get(key).slice().sort(),
    }));
}

const SUGGESTED = "Suggested";
const SORT_STORAGE_KEY = "tweek.tzSortMode";
const SHORTCUT_HINT_STORAGE_KEY = "tweek.tzShortcutHintDismissed";

function readStoredSortMode() {
    if (typeof window === "undefined" || !window.localStorage) return "region";
    try {
        const v = window.localStorage.getItem(SORT_STORAGE_KEY);
        return v === "offset" ? "offset" : "region";
    } catch {
        return "region";
    }
}

function readStoredShortcutHintDismissed() {
    if (typeof window === "undefined" || !window.localStorage) return false;
    try {
        return window.localStorage.getItem(SHORTCUT_HINT_STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

export default function TimezoneCombobox({
    id,
    value,
    onChange,
    options,
    detected,
    placeholder = "Search timezone (e.g. tokyo, new york)",
    accountExpandedGroups = null,
    accountExpandedGroupsUpdatedAt = null,
    onAccountExpandedGroupsChange = null,
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [activeIdx, setActiveIdx] = useState(0);
    const [now, setNow] = useState(() => new Date());
    const [sortMode, setSortMode] = useState(() => readStoredSortMode());
    const [shortcutHintDismissed, setShortcutHintDismissed] = useState(
        () => readStoredShortcutHintDismissed(),
    );

    function dismissShortcutHint() {
        setShortcutHintDismissed(true);
        if (typeof window === "undefined" || !window.localStorage) return;
        try {
            window.localStorage.setItem(SHORTCUT_HINT_STORAGE_KEY, "1");
        } catch {
            /* ignore quota / disabled storage */
        }
    }
    const detectedRegion = detected ? getRegion(detected) : null;
    const detectedOffset = detected ? getZoneOffset(detected, now) : "";
    const valueOffset = value ? getZoneOffset(value, now) : "";
    // Prefer the user's explicitly selected zone's offset; fall back to the
    // detected zone's offset when nothing is selected yet. Recomputes with
    // `now` so DST shifts are reflected automatically.
    const userOffset = valueOffset || detectedOffset;
    const hadStoredExpandedRef = useRef(false);
    // Tracks the timestamp of the locally-known expandedGroups value. Used to
    // decide most-recent-wins when reconciling against the server-stored copy.
    // 0 means "no real local preference" (defaults / detected-region only).
    const localUpdatedAtRef = useRef(0);
    // Tracks which user-toggle the persistence effect should treat as a real
    // edit (worth pushing to the server). Auto-adjustments (detected region,
    // adopting server value) leave this as false.
    const userInitiatedChangeRef = useRef(false);
    // Largest accountExpandedGroupsUpdatedAt we have already reconciled, so we
    // don't repeatedly re-apply the same server snapshot.
    const lastSyncedAccountTsRef = useRef(0);
    const onAccountExpandedGroupsChangeRef = useRef(onAccountExpandedGroupsChange);
    useEffect(() => {
        onAccountExpandedGroupsChangeRef.current = onAccountExpandedGroupsChange;
    }, [onAccountExpandedGroupsChange]);
    const pushSyncRef = useRef(null);
    if (pushSyncRef.current === null) {
        // Lazily instantiated once per component lifecycle. The send callback
        // reads through onAccountExpandedGroupsChangeRef so a parent prop
        // change between the schedule and the eventual fire/flush still ends
        // up calling the latest version of the callback.
        pushSyncRef.current = createExpandedGroupsSync({
            delay: 400,
            send: (arr) => {
                const cb = onAccountExpandedGroupsChangeRef.current;
                if (cb) {
                    try {
                        cb(arr);
                    } catch {
                        /* swallow — the sync is best-effort */
                    }
                }
            },
        });
    }

    const [expandedGroups, setExpandedGroups] = useState(() => {
        const stored = readStoredExpandedGroups();
        if (stored) {
            hadStoredExpandedRef.current = true;
            localUpdatedAtRef.current = stored.updatedAt;
            return stored.groups;
        }
        const s = new Set();
        s.add(SUGGESTED);
        if (detectedRegion) s.add(detectedRegion);
        return s;
    });

    function schedulePushToServer(arr) {
        if (!onAccountExpandedGroupsChangeRef.current) return;
        pushSyncRef.current.schedule(arr);
    }

    useEffect(() => {
        // Persist the latest expandedGroups to localStorage so the picker
        // remembers the layout on the same device. Real user edits also
        // schedule a debounced push to the user's account so the choice
        // follows them across devices.
        let ts;
        if (userInitiatedChangeRef.current) {
            ts = Date.now();
            localUpdatedAtRef.current = ts;
        } else {
            // Auto-adjustments (detected region added, adopting server value)
            // keep the existing local timestamp. For a fresh install with no
            // real preference yet this stays at 0, which lets a future server
            // snapshot win the most-recent-wins comparison.
            ts = localUpdatedAtRef.current;
        }
        writeStoredExpandedGroups(expandedGroups, ts);
        if (userInitiatedChangeRef.current) {
            schedulePushToServer([...expandedGroups]);
        }
        userInitiatedChangeRef.current = false;
    }, [expandedGroups]);

    const accountUpdatedAtMs = useMemo(() => {
        if (!accountExpandedGroupsUpdatedAt) return 0;
        const t = new Date(accountExpandedGroupsUpdatedAt).getTime();
        return Number.isFinite(t) ? t : 0;
    }, [accountExpandedGroupsUpdatedAt]);

    useEffect(() => {
        // Reconcile server-stored expanded groups with the local copy once
        // the user's account preference is known (or changes). Most-recent
        // wins; ties are no-ops.
        if (accountUpdatedAtMs <= 0) return;
        if (accountUpdatedAtMs <= lastSyncedAccountTsRef.current) return;
        lastSyncedAccountTsRef.current = accountUpdatedAtMs;
        const serverGroups = Array.isArray(accountExpandedGroups) ? accountExpandedGroups : [];
        if (accountUpdatedAtMs > localUpdatedAtRef.current) {
            // Server is newer — adopt without echoing back to the server.
            hadStoredExpandedRef.current = true;
            localUpdatedAtRef.current = accountUpdatedAtMs;
            userInitiatedChangeRef.current = false;
            setExpandedGroups(new Set(serverGroups.filter((v) => typeof v === "string")));
        } else if (accountUpdatedAtMs < localUpdatedAtRef.current) {
            // Local edits are newer than the server snapshot — push them up
            // so other devices catch up.
            schedulePushToServer([...expandedGroups]);
        }
        // Equal timestamps: in sync, nothing to do.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountUpdatedAtMs, accountExpandedGroups]);

    useEffect(() => () => {
        // On unmount, fire any pending debounced push so a quick navigate-away
        // doesn't drop the user's last edit on the floor. The sync helper
        // tracks the latest scheduled value internally, so flushing here
        // never sends a stale snapshot of `expandedGroups`.
        if (pushSyncRef.current) pushSyncRef.current.flush();
    }, []);

    useEffect(() => {
        if (typeof window === "undefined" || !window.localStorage) return;
        try {
            window.localStorage.setItem(SORT_STORAGE_KEY, sortMode);
        } catch {
            /* ignore quota / disabled storage */
        }
    }, [sortMode]);

    useEffect(() => {
        // If the detected region becomes known/changes after mount, make sure
        // it's included in the default-expanded set without removing any
        // groups the user has manually toggled. Skipped when the user already
        // has a persisted expanded set — their stored choices win.
        if (hadStoredExpandedRef.current) return;
        if (!detectedRegion) return;
        setExpandedGroups((prev) => {
            if (prev.has(detectedRegion)) return prev;
            const next = new Set(prev);
            next.add(detectedRegion);
            return next;
        });
    }, [detectedRegion]);

    useEffect(() => {
        // When sorting by UTC offset, also default-expand the detected zone's
        // offset group so users land near their current offset. Skipped when
        // the user already has a persisted expanded set.
        if (hadStoredExpandedRef.current) return;
        if (sortMode !== "offset" || !detectedOffset) return;
        setExpandedGroups((prev) => {
            if (prev.has(detectedOffset)) return prev;
            const next = new Set(prev);
            next.add(detectedOffset);
            return next;
        });
    }, [sortMode, detectedOffset]);
    const wrapperRef = useRef(null);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        setNow(new Date());
        const interval = setInterval(() => setNow(new Date()), 30000);
        return () => clearInterval(interval);
    }, [open]);

    const zoneInfo = useMemo(() => {
        const map = {};
        for (const zone of options) {
            const abbr = getZoneAbbreviation(zone, now);
            map[zone] = {
                time: getZoneTime(zone, now),
                offset: getZoneOffset(zone, now),
                abbr,
                abbrLongName: getZoneAbbreviationLongName(zone, abbr),
            };
        }
        return map;
    }, [options, now]);

    const baseGroups = useMemo(() => {
        if (sortMode === "offset") {
            return buildOffsetGroups(options, zoneInfo);
        }
        return buildGroups(options);
    }, [options, sortMode, zoneInfo]);

    const hasDetected = !!(detected && options.includes(detected));

    const displayGroups = useMemo(() => {
        const filtered = baseGroups
            .map((g) => {
                let zones = filterZones(g.zones, query, zoneInfo);
                if (!query && hasDetected) {
                    // Avoid showing the detected zone twice (once in Suggested, once in its native region).
                    zones = zones.filter((z) => z !== detected);
                }
                return { region: g.region, zones };
            })
            .filter((g) => g.zones.length > 0);

        if (!query && hasDetected) {
            return [{ region: SUGGESTED, zones: [detected] }, ...filtered];
        }
        return filtered;
    }, [baseGroups, query, zoneInfo, hasDetected, detected]);

    const isSearching = !!query;
    const isExpanded = (region) => isSearching || expandedGroups.has(region);

    const flatZones = useMemo(() => {
        const arr = [];
        for (const g of displayGroups) {
            if (isExpanded(g.region)) {
                for (const z of g.zones) arr.push(z);
            }
        }
        return arr;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [displayGroups, expandedGroups, isSearching]);

    // When `activeHeaderRegion` is non-null, the keyboard "focus" is on that
    // region's header (collapsible toggle) rather than on a zone option.
    // ArrowUp/Down navigation between zones (the existing pattern) still
    // skips header rows; users land on a header explicitly via ArrowLeft
    // from one of its zones, and Enter/Space on a header toggles its group.
    const [activeHeaderRegion, setActiveHeaderRegion] = useState(null);

    function toggleGroup(region) {
        userInitiatedChangeRef.current = true;
        setExpandedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(region)) next.delete(region);
            else next.add(region);
            return next;
        });
    }

    // Index of the first zone of `region` in the current flatZones list.
    // Returns -1 if the region is collapsed or not present.
    function firstZoneIdxInRegion(region) {
        let idx = 0;
        for (const g of displayGroups) {
            if (g.region === region) {
                return isExpanded(g.region) ? idx : -1;
            }
            if (isExpanded(g.region)) idx += g.zones.length;
        }
        return -1;
    }

    // Region containing the zone at activeIdx, or null when the active row
    // is a header (activeHeaderRegion set) or the list is empty.
    const activeZoneRegion = useMemo(() => {
        if (activeHeaderRegion) return null;
        if (!flatZones.length) return null;
        let i = 0;
        for (const g of displayGroups) {
            if (!isExpanded(g.region)) continue;
            const len = g.zones.length;
            if (activeIdx >= i && activeIdx < i + len) return g.region;
            i += len;
        }
        return null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [displayGroups, activeIdx, flatZones.length, expandedGroups, isSearching, activeHeaderRegion]);

    useEffect(() => {
        setActiveIdx(0);
        setActiveHeaderRegion(null);
    }, [query, open]);

    useEffect(() => {
        // If the visible groups change (sort mode flip, search filter, etc.)
        // and the focused header is no longer present, drop header focus so
        // we don't strand aria-activedescendant on a missing element.
        if (!activeHeaderRegion) return;
        const stillThere = displayGroups.some((g) => g.region === activeHeaderRegion);
        if (!stillThere) setActiveHeaderRegion(null);
    }, [displayGroups, activeHeaderRegion]);

    useEffect(() => {
        // Keep activeIdx within bounds whenever the visible list changes
        // (e.g. after collapsing a group).
        if (activeIdx > flatZones.length - 1) {
            setActiveIdx(Math.max(0, flatZones.length - 1));
        }
    }, [flatZones.length, activeIdx]);

    useEffect(() => {
        function onDocClick(e) {
            if (!wrapperRef.current) return;
            if (!wrapperRef.current.contains(e.target)) {
                setOpen(false);
                setQuery("");
            }
        }
        if (open) {
            document.addEventListener("mousedown", onDocClick);
            document.addEventListener("touchstart", onDocClick);
        }
        return () => {
            document.removeEventListener("mousedown", onDocClick);
            document.removeEventListener("touchstart", onDocClick);
        };
    }, [open]);

    useEffect(() => {
        if (!open || !listRef.current) return;
        const selector = activeHeaderRegion
            ? `[data-header-region="${activeHeaderRegion}"]`
            : `[data-idx="${activeIdx}"]`;
        const node = listRef.current.querySelector(selector);
        if (node && typeof node.scrollIntoView === "function") {
            node.scrollIntoView({ block: "nearest" });
        }
    }, [activeIdx, open, activeHeaderRegion]);

    useEffect(() => {
        // On open, in offset sort mode, scroll the listbox so the user's
        // highlighted offset group header is centered in view. Without this
        // the list always starts at UTC-12:00 and the user has to scroll to
        // find their own offset (e.g. UTC+09:00 sits well below the top).
        // Only triggers on the open transition — not on every re-render —
        // and uses scrollIntoView (which doesn't move focus) so the input
        // keeps focus. Works whether the group is expanded or collapsed,
        // since the header element itself is the scroll target.
        if (!open || !listRef.current) return;
        if (sortMode !== "offset" || !userOffset) return;
        const node = listRef.current.querySelector(
            `[data-header-region="${userOffset}"]`,
        );
        if (node && typeof node.scrollIntoView === "function") {
            node.scrollIntoView({ block: "center" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    function selectZone(zone) {
        if (!zone) return;
        onChange(zone);
        setOpen(false);
        setQuery("");
        if (inputRef.current && typeof inputRef.current.blur === "function") {
            inputRef.current.blur();
        }
    }

    // Move the active row to the first zone of the next visible group after
    // `region` (used when ArrowDown is pressed while a header is focused).
    function moveActiveToNextZoneAfterHeader(region) {
        let passedRegion = false;
        let cursor = 0;
        for (const g of displayGroups) {
            if (!passedRegion) {
                if (g.region === region) {
                    passedRegion = true;
                    if (isExpanded(g.region)) cursor += g.zones.length;
                    continue;
                }
                if (isExpanded(g.region)) cursor += g.zones.length;
                continue;
            }
            if (isExpanded(g.region)) {
                setActiveIdx(cursor);
                setActiveHeaderRegion(null);
                return true;
            }
        }
        return false;
    }

    // Index of the first zone of the next visible region group with at least
    // one zone after `currentRegion` (collapsed groups in between are
    // skipped — collapsed groups have no flatZones entries to land on).
    // When `currentRegion` is null, returns the first such index from the
    // top. Returns -1 if no eligible region exists.
    function firstZoneIdxOfNextRegion(currentRegion) {
        let cursor = 0;
        let passed = currentRegion == null;
        for (const g of displayGroups) {
            const expanded = isExpanded(g.region);
            if (passed) {
                if (expanded && g.zones.length > 0) return cursor;
            } else if (g.region === currentRegion) {
                passed = true;
            }
            if (expanded) cursor += g.zones.length;
        }
        return -1;
    }

    // Index of the first zone of the closest visible region group with at
    // least one zone *before* `currentRegion`. Returns -1 if none.
    function firstZoneIdxOfPrevRegion(currentRegion) {
        let cursor = 0;
        let lastEligible = -1;
        for (const g of displayGroups) {
            if (currentRegion != null && g.region === currentRegion) break;
            const expanded = isExpanded(g.region);
            if (expanded && g.zones.length > 0) {
                lastEligible = cursor;
            }
            if (expanded) cursor += g.zones.length;
        }
        return lastEligible;
    }

    // Move the active row to the last zone of the closest visible group
    // before `region` (used when ArrowUp is pressed while a header is
    // focused).
    function moveActiveToPrevZoneBeforeHeader(region) {
        let last = -1;
        for (const g of displayGroups) {
            if (g.region === region) break;
            if (isExpanded(g.region)) last += g.zones.length;
        }
        // `last` started at -1 and accumulated lengths, so it now points at
        // the last index of the previous expanded group (or -1 if none).
        if (last >= 0) {
            setActiveIdx(last);
            setActiveHeaderRegion(null);
            return true;
        }
        return false;
    }

    function handleKeyDown(e) {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) setOpen(true);
            if (activeHeaderRegion) {
                // If the focused header's group is expanded, ArrowDown moves
                // into its first zone. Otherwise jump to the next visible
                // group's first zone.
                const ownFirst = firstZoneIdxInRegion(activeHeaderRegion);
                if (ownFirst >= 0) {
                    setActiveIdx(ownFirst);
                    setActiveHeaderRegion(null);
                } else if (!moveActiveToNextZoneAfterHeader(activeHeaderRegion)) {
                    // No zones below — keep header focused.
                }
                return;
            }
            setActiveIdx((i) => Math.min(flatZones.length - 1, i + 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) setOpen(true);
            if (activeHeaderRegion) {
                if (!moveActiveToPrevZoneBeforeHeader(activeHeaderRegion)) {
                    // Nothing above — stay on header.
                }
                return;
            }
            setActiveIdx((i) => Math.max(0, i - 1));
        } else if (e.key === "ArrowLeft") {
            if (!open || isSearching) return;
            if (activeHeaderRegion) {
                // Collapse the focused header's group if it is currently
                // expanded; otherwise let the input handle the cursor key.
                if (expandedGroups.has(activeHeaderRegion)) {
                    e.preventDefault();
                    toggleGroup(activeHeaderRegion);
                }
                return;
            }
            const region = activeZoneRegion;
            if (region && expandedGroups.has(region)) {
                e.preventDefault();
                toggleGroup(region);
                setActiveHeaderRegion(region);
            }
        } else if (e.key === "ArrowRight") {
            if (!open || isSearching) return;
            if (activeHeaderRegion) {
                // Single-press semantics: expand the group (if collapsed)
                // AND drill into its first zone. Use Enter or Space if you
                // just want to toggle without moving focus.
                e.preventDefault();
                const wasExpanded = expandedGroups.has(activeHeaderRegion);
                if (!wasExpanded) toggleGroup(activeHeaderRegion);
                // After the (possibly pending) expansion, the first zone
                // index is the cumulative count of earlier expanded groups.
                let firstIdx = 0;
                for (const g of displayGroups) {
                    if (g.region === activeHeaderRegion) break;
                    if (isExpanded(g.region)) firstIdx += g.zones.length;
                }
                setActiveIdx(firstIdx);
                setActiveHeaderRegion(null);
            }
            // ArrowRight on a zone is a no-op here — let the input cursor
            // handle the key naturally.
        } else if (e.key === "PageDown") {
            // Jump straight to the first zone of the next visible region
            // group. Skips collapsed groups in between (they have no
            // landable zones in the flat list).
            e.preventDefault();
            if (!open) {
                setOpen(true);
                return;
            }
            const currentRegion = activeHeaderRegion || activeZoneRegion;
            const target = firstZoneIdxOfNextRegion(currentRegion);
            if (target >= 0) {
                setActiveIdx(target);
                setActiveHeaderRegion(null);
            }
        } else if (e.key === "PageUp") {
            // Mirror of PageDown — first zone of the previous visible
            // region group, skipping collapsed groups in between.
            e.preventDefault();
            if (!open) {
                setOpen(true);
                return;
            }
            const currentRegion = activeHeaderRegion || activeZoneRegion;
            const target = firstZoneIdxOfPrevRegion(currentRegion);
            if (target >= 0) {
                setActiveIdx(target);
                setActiveHeaderRegion(null);
            }
        } else if (e.key === "Enter") {
            if (!open) return;
            if (activeHeaderRegion) {
                e.preventDefault();
                toggleGroup(activeHeaderRegion);
                return;
            }
            e.preventDefault();
            const zone = flatZones[activeIdx];
            if (zone) selectZone(zone);
        } else if (e.key === " " || e.key === "Spacebar") {
            // Only intercept Space when a header is focused — otherwise the
            // user is searching and a literal space (e.g. "new york") should
            // pass through to the input.
            if (open && activeHeaderRegion && !isSearching) {
                e.preventDefault();
                toggleGroup(activeHeaderRegion);
            }
        } else if (e.key === "Escape") {
            if (open) {
                e.preventDefault();
                setOpen(false);
                setQuery("");
                setActiveHeaderRegion(null);
            }
        }
    }

    const inputDisplay = open ? query : (value || "");

    let runningIdx = 0;

    return (
        <div ref={wrapperRef} className="relative">
            <input
                ref={inputRef}
                id={id}
                type="text"
                role="combobox"
                aria-expanded={open}
                aria-autocomplete="list"
                aria-controls={`${id}-listbox`}
                aria-activedescendant={
                    open
                        ? (activeHeaderRegion
                            ? `${id}-group-${activeHeaderRegion}`
                            : (flatZones[activeIdx] ? `${id}-option-${activeIdx}` : undefined))
                        : undefined
                }
                autoComplete="off"
                spellCheck={false}
                value={inputDisplay}
                placeholder={value ? value : placeholder}
                onFocus={() => setOpen(true)}
                onChange={(e) => {
                    setQuery(e.target.value);
                    if (!open) setOpen(true);
                }}
                onKeyDown={handleKeyDown}
                className="w-full px-4 py-3 pr-10 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
            <button
                type="button"
                tabIndex={-1}
                aria-label={open ? "Close timezone list" : "Open timezone list"}
                onMouseDown={(e) => {
                    e.preventDefault();
                    if (open) {
                        setOpen(false);
                        setQuery("");
                    } else {
                        setOpen(true);
                        if (inputRef.current) inputRef.current.focus();
                    }
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer"
            >
                <i className={`fa-solid ${open ? "fa-chevron-up" : "fa-chevron-down"} text-xs`} />
            </button>

            {open && (
                <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
                <ul
                    id={`${id}-listbox`}
                    ref={listRef}
                    role="listbox"
                    className={`w-full max-h-64 overflow-y-auto overscroll-contain ${
                        shortcutHintDismissed ? "" : "pb-10"
                    }`}
                >
                    <li
                        role="presentation"
                        className="sticky top-0 z-20 flex items-center justify-between gap-2 px-3 py-1.5 bg-gray-50/95 dark:bg-gray-800/95 backdrop-blur border-b border-gray-200 dark:border-gray-700"
                    >
                        <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            Sort by
                        </span>
                        <div
                            role="group"
                            aria-label="Sort timezones"
                            className="inline-flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden text-[11px]"
                        >
                            {[
                                { key: "region", label: "Region" },
                                { key: "offset", label: "UTC offset" },
                            ].map((opt) => {
                                const active = sortMode === opt.key;
                                return (
                                    <button
                                        key={opt.key}
                                        type="button"
                                        tabIndex={-1}
                                        aria-pressed={active}
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            if (sortMode !== opt.key) {
                                                setSortMode(opt.key);
                                                setActiveIdx(0);
                                                setActiveHeaderRegion(null);
                                            }
                                            if (inputRef.current) inputRef.current.focus();
                                        }}
                                        className={`px-2 py-0.5 cursor-pointer transition-colors ${
                                            active
                                                ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white font-semibold"
                                                : "bg-transparent text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/60"
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                );
                            })}
                        </div>
                    </li>
                    {displayGroups.length === 0 && (
                        <li className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                            No timezones match "{query}"
                        </li>
                    )}
                    {displayGroups.map((group) => {
                        const expanded = isExpanded(group.region);
                        const headerId = `${id}-group-${group.region}`;
                        const headerActive = activeHeaderRegion === group.region;
                        // Only highlight in offset sort mode — in region mode
                        // the group keys are continent names, not offsets, so
                        // the comparison would never meaningfully match.
                        const isUserOffsetGroup =
                            sortMode === "offset" &&
                            !!userOffset &&
                            group.region === userOffset;
                        const header = (
                            <li
                                key={`header-${group.region}`}
                                role="presentation"
                                data-header-region={group.region}
                                className={`sticky top-8 z-10 backdrop-blur border-b border-gray-200 dark:border-gray-700 ${
                                    isUserOffsetGroup
                                        ? "bg-blue-50/95 dark:bg-blue-900/40"
                                        : "bg-gray-50/95 dark:bg-gray-800/95"
                                }`}
                            >
                                <button
                                    type="button"
                                    id={headerId}
                                    aria-expanded={expanded}
                                    tabIndex={-1}
                                    // preventDefault on mousedown stops the
                                    // browser shifting focus away from the
                                    // input (so keyboard nav keeps working
                                    // after a header click). The actual toggle
                                    // happens on click so a single tap toggles
                                    // exactly once instead of double-firing.
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (isSearching) return;
                                        toggleGroup(group.region);
                                        setActiveIdx(0);
                                        setActiveHeaderRegion(null);
                                        if (inputRef.current) inputRef.current.focus();
                                    }}
                                    disabled={isSearching}
                                    className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider ${
                                        headerActive
                                            ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
                                            : isUserOffsetGroup
                                                ? "text-blue-700 dark:text-blue-200"
                                                : "text-gray-500 dark:text-gray-400"
                                    } ${
                                        isSearching ? "cursor-default" : "cursor-pointer hover:text-gray-700 dark:hover:text-gray-200"
                                    }`}
                                >
                                    <span className="flex items-center gap-1.5 min-w-0">
                                        <i
                                            className={`fa-solid fa-chevron-right text-[9px] transition-transform ${
                                                expanded ? "rotate-90" : ""
                                            }`}
                                            aria-hidden="true"
                                        />
                                        <span className="truncate">{group.region}</span>
                                        {isUserOffsetGroup && (
                                            <span
                                                className="shrink-0 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-800/70 text-blue-700 dark:text-blue-100 normal-case"
                                                aria-label="Matches your current timezone offset"
                                            >
                                                your offset
                                            </span>
                                        )}
                                    </span>
                                    <span className="shrink-0 text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
                                        {group.zones.length}
                                    </span>
                                </button>
                            </li>
                        );

                        if (!expanded) return header;

                        const zoneItems = group.zones.map((zone) => {
                            const idx = runningIdx++;
                            const isActive = idx === activeIdx;
                            const isSelected = zone === value;
                            const isDetected = zone === detected;
                            const info = zoneInfo[zone] || { time: "", offset: "", abbr: "" };
                            return (
                                <li
                                    key={zone}
                                    id={`${id}-option-${idx}`}
                                    data-idx={idx}
                                    role="option"
                                    aria-selected={isSelected}
                                    onMouseEnter={() => {
                                        setActiveIdx(idx);
                                        setActiveHeaderRegion(null);
                                    }}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        selectZone(zone);
                                    }}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        selectZone(zone);
                                    }}
                                    onTouchEnd={(e) => {
                                        e.preventDefault();
                                        selectZone(zone);
                                    }}
                                    className={`px-4 py-2 text-sm cursor-pointer flex items-center justify-between gap-2 ${
                                        isActive
                                            ? "bg-gray-100 dark:bg-gray-800"
                                            : "bg-transparent"
                                    } ${isSelected ? "font-semibold text-gray-900 dark:text-white" : "text-gray-700 dark:text-gray-200"}`}
                                >
                                    <span className="truncate min-w-0 flex-1">{zone}</span>
                                    <span className="shrink-0 flex items-center gap-1.5">
                                        {info.time && (
                                            <span
                                                className="tabular-nums text-gray-600 dark:text-gray-300"
                                                aria-label={`Current local time ${info.time}${info.abbr ? `, ${info.abbrLongName ? `${info.abbrLongName} (${info.abbr})` : info.abbr}` : ""}${info.offset ? `, ${info.offset}` : ""}`}
                                            >
                                                {info.time}
                                            </span>
                                        )}
                                        {info.abbr && (
                                            <span
                                                className="text-[11px] font-medium tracking-wide text-gray-500 dark:text-gray-400"
                                                title={info.abbrLongName || info.abbr}
                                                aria-label={info.abbrLongName ? `${info.abbrLongName} (${info.abbr})` : info.abbr}
                                            >
                                                {info.abbr}
                                            </span>
                                        )}
                                        {info.offset && (
                                            <span className="hidden sm:inline text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                                                {info.offset}
                                            </span>
                                        )}
                                        {isDetected && (
                                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                                                detected
                                            </span>
                                        )}
                                    </span>
                                </li>
                            );
                        });

                        return (
                            <React.Fragment key={`group-${group.region}`}>
                                {header}
                                {zoneItems}
                            </React.Fragment>
                        );
                    })}
                </ul>
                {!shortcutHintDismissed && (
                    // Overlay (not in list flow) so it never reduces visible
                    // option count; listbox `pb-10` lets the last option
                    // scroll clear when the hint wraps to two lines.
                    <div
                        role="note"
                        className="absolute inset-x-0 bottom-0 flex items-start justify-between gap-2 px-3 py-1 bg-gray-50/95 dark:bg-gray-800/95 backdrop-blur border-t border-gray-200 dark:border-gray-700 pointer-events-none"
                    >
                        <span
                            className="text-[10px] leading-tight text-gray-500 dark:text-gray-400 break-words"
                            aria-label="Keyboard shortcuts: Up and Down arrows navigate, Left and Right arrows collapse and expand groups, Page Up and Page Down jump between region groups, Enter selects, Escape closes"
                        >
                            {/* Wrap between shortcuts, never mid-shortcut. */}
                            <span className="inline-block whitespace-nowrap mr-2">
                                <span className="tabular-nums">↑↓</span> navigate
                            </span>
                            <span className="inline-block whitespace-nowrap mr-2">
                                <span className="tabular-nums">←→</span> collapse/expand
                            </span>
                            <span className="inline-block whitespace-nowrap mr-2">
                                PgUp/PgDn jump region
                            </span>
                            <span className="inline-block whitespace-nowrap mr-2">
                                Enter select
                            </span>
                            <span className="inline-block whitespace-nowrap">
                                Esc close
                            </span>
                        </span>
                        <button
                            type="button"
                            aria-label="Dismiss keyboard shortcut hint"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                dismissShortcutHint();
                                if (inputRef.current) inputRef.current.focus();
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    dismissShortcutHint();
                                    if (inputRef.current) inputRef.current.focus();
                                    return;
                                }
                                if (e.key === "Escape") {
                                    // Match the documented Esc-to-close
                                    // shortcut even when focus is on this btn.
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setOpen(false);
                                    setQuery("");
                                    setActiveHeaderRegion(null);
                                    if (inputRef.current) inputRef.current.focus();
                                }
                            }}
                            // pointer-events-auto: overlay disables pointer
                            // events so it doesn't block list interaction.
                            className="shrink-0 px-1 py-0.5 text-[10px] text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none focus:ring-1 focus:ring-gray-400 rounded cursor-pointer pointer-events-auto"
                        >
                            <i className="fa-solid fa-xmark" aria-hidden="true" />
                        </button>
                    </div>
                )}
                </div>
            )}
        </div>
    );
}
