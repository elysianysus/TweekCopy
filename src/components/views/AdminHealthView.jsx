import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { getRecurrenceSchedulerHealth, getOfficeWorkerHealth } from "../../scripts/api.js";
import Loading from "../Loading.jsx";

const STALE_THRESHOLD_MS = 26 * 60 * 60 * 1000;

function formatTimestamp(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
}

function formatRelative(iso, now) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const diffMs = now - d.getTime();
    if (diffMs < 0) return "in the future";
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 48) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
}

function StatusPill({ kind, children }) {
    const styles = {
        ok: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
        warn: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
        error: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
        idle: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    };
    return (
        <span className={`inline-block text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded ${styles[kind] || styles.idle}`}>
            {children}
        </span>
    );
}

function bucketStatus(b, now) {
    if (b.errorCount > 0) return "error";
    if (!b.lastRunAt) return "idle";
    const last = new Date(b.lastRunAt).getTime();
    if (Number.isNaN(last)) return "idle";
    if (now - last > STALE_THRESHOLD_MS) return "warn";
    return "ok";
}

const OFFICE_BREAKDOWN_COLUMNS = [
    { key: "skillKey", label: "Worker", numeric: false, align: "left" },
    { key: "queued", label: "Queued", numeric: true, align: "right" },
    { key: "running", label: "Running", numeric: true, align: "right" },
    { key: "done", label: "Done", numeric: true, align: "right" },
    { key: "failed", label: "Failed", numeric: true, align: "right" },
    { key: "lastErrorAt", label: "Last error", numeric: false, align: "left" },
];

function OfficeBreakdownTable({ rows, windowHours, now }) {
    const [sortKey, setSortKey] = useState("failed");
    const [sortDir, setSortDir] = useState("desc");

    const sorted = useMemo(() => {
        const list = Array.isArray(rows) ? [...rows] : [];
        const dir = sortDir === "asc" ? 1 : -1;
        list.sort((a, b) => {
            const av = a?.[sortKey];
            const bv = b?.[sortKey];
            if (sortKey === "lastErrorAt") {
                const at = av ? new Date(av).getTime() : 0;
                const bt = bv ? new Date(bv).getTime() : 0;
                return (at - bt) * dir;
            }
            if (typeof av === "number" && typeof bv === "number") {
                return (av - bv) * dir;
            }
            return String(av || "").localeCompare(String(bv || "")) * dir;
        });
        return list;
    }, [rows, sortKey, sortDir]);

    const toggleSort = (key) => {
        if (key === sortKey) {
            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            const col = OFFICE_BREAKDOWN_COLUMNS.find((c) => c.key === key);
            setSortDir(col?.numeric || key === "lastErrorAt" ? "desc" : "asc");
        }
    };

    return (
        <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Per-worker activity (last {windowHours}h)
                </h3>
                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                    {sorted.length} worker{sorted.length === 1 ? "" : "s"}
                </span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide">
                        <tr>
                            {OFFICE_BREAKDOWN_COLUMNS.map((c) => (
                                <th
                                    key={c.key}
                                    className={`px-3 py-2 font-medium select-none cursor-pointer ${c.align === "right" ? "text-right" : "text-left"}`}
                                    onClick={() => toggleSort(c.key)}
                                >
                                    {c.label}
                                    {sortKey === c.key && (
                                        <span className="ml-1 text-[10px] text-gray-400">
                                            {sortDir === "asc" ? "▲" : "▼"}
                                        </span>
                                    )}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {sorted.length === 0 && (
                            <tr>
                                <td colSpan={OFFICE_BREAKDOWN_COLUMNS.length} className="px-3 py-4 text-center text-gray-500 dark:text-gray-400">
                                    No office jobs in the last {windowHours}h.
                                </td>
                            </tr>
                        )}
                        {sorted.map((r) => {
                            const failedCls = r.failed > 0 ? "text-red-600 dark:text-red-400 font-semibold" : "text-gray-700 dark:text-gray-300";
                            const runningCls = r.running > 0 ? "text-blue-600 dark:text-blue-400 font-semibold" : "text-gray-700 dark:text-gray-300";
                            const queuedCls = r.queued > 0 ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-gray-700 dark:text-gray-300";
                            return (
                                <tr key={r.skillKey} className={r.failed > 0 ? "bg-red-50 dark:bg-red-900/20" : ""}>
                                    <td className="px-3 py-2 align-top font-mono text-xs text-gray-800 dark:text-gray-200">
                                        {r.skillKey}
                                    </td>
                                    <td className={`px-3 py-2 align-top text-right tabular-nums ${queuedCls}`}>
                                        {r.queued}
                                    </td>
                                    <td className={`px-3 py-2 align-top text-right tabular-nums ${runningCls}`}>
                                        {r.running}
                                    </td>
                                    <td className="px-3 py-2 align-top text-right tabular-nums text-gray-700 dark:text-gray-300">
                                        {r.done}
                                    </td>
                                    <td className={`px-3 py-2 align-top text-right tabular-nums ${failedCls}`}>
                                        {r.failed}
                                    </td>
                                    <td className="px-3 py-2 align-top text-xs text-gray-700 dark:text-gray-300 max-w-xs">
                                        {r.lastErrorMessage ? (
                                            <div>
                                                {r.lastErrorAt && (
                                                    <div className="text-[11px] text-gray-500 dark:text-gray-400">
                                                        {formatRelative(r.lastErrorAt, now)}
                                                    </div>
                                                )}
                                                <div className="text-gray-600 dark:text-gray-400 break-words" title={r.lastErrorMessage}>
                                                    {r.lastErrorMessage}
                                                </div>
                                            </div>
                                        ) : (
                                            <span className="text-gray-400">—</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function OfficeHealthCard({ stats, now }) {
    if (!stats) return null;
    const hasError = stats.failed > 0 || !!stats.lastErrorMessage;
    return (
        <section className="mt-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Muse Office worker</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Started</div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {stats.startedAt ? formatRelative(stats.startedAt, now) : "not started"}
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">{formatTimestamp(stats.startedAt)}</div>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">In flight</div>
                    <div className="text-lg font-semibold text-gray-900 dark:text-white tabular-nums">
                        {stats.inflight} / {stats.capacity?.global ?? "?"}
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">global cap</div>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Throughput</div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white tabular-nums">
                        {stats.succeeded} ok · {stats.failed} failed
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">{stats.attempted} attempted</div>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Last error</div>
                    <div className={`text-sm font-medium ${hasError ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>
                        {stats.lastErrorAt ? formatRelative(stats.lastErrorAt, now) : "—"}
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate" title={stats.lastErrorMessage || ""}>
                        {stats.lastErrorMessage || "no errors"}
                    </div>
                </div>
            </div>
            <OfficeBreakdownTable
                rows={stats.breakdown || []}
                windowHours={stats.breakdownWindowHours || 24}
                now={now}
            />
            <OfficeConfidenceTable
                rows={stats.confidenceBreakdown || []}
                windowDays={stats.confidenceWindowDays || 7}
            />
        </section>
    );
}

// Per-skill High/Medium/Low distribution over the last N days. Sorted on
// the server by % low desc so the most-worrying workers float to the top.
function OfficeConfidenceTable({ rows, windowDays }) {
    const list = Array.isArray(rows) ? rows : [];
    return (
        <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Per-worker confidence (last {windowDays}d)
                </h3>
                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                    {list.length} worker{list.length === 1 ? "" : "s"}
                </span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide">
                        <tr>
                            <th className="px-3 py-2 font-medium text-left">Worker</th>
                            <th className="px-3 py-2 font-medium text-right">High</th>
                            <th className="px-3 py-2 font-medium text-right">Medium</th>
                            <th className="px-3 py-2 font-medium text-right">Low</th>
                            <th className="px-3 py-2 font-medium text-right">Total</th>
                            <th className="px-3 py-2 font-medium text-right">% Low</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {list.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-3 py-4 text-center text-gray-500 dark:text-gray-400">
                                    No finished office jobs in the last {windowDays}d.
                                </td>
                            </tr>
                        )}
                        {list.map((r) => (
                            <tr key={r.skillKey} className={r.lowPct >= 50 ? "bg-red-50 dark:bg-red-900/20" : ""}>
                                <td className="px-3 py-2 align-top font-mono text-xs text-gray-800 dark:text-gray-200">
                                    {r.skillKey}
                                </td>
                                <td className="px-3 py-2 align-top text-right tabular-nums text-emerald-700 dark:text-emerald-300">{r.high}</td>
                                <td className="px-3 py-2 align-top text-right tabular-nums text-amber-700 dark:text-amber-300">{r.medium}</td>
                                <td className={`px-3 py-2 align-top text-right tabular-nums ${r.low > 0 ? "text-red-600 dark:text-red-400 font-semibold" : "text-gray-700 dark:text-gray-300"}`}>
                                    {r.low}
                                </td>
                                <td className="px-3 py-2 align-top text-right tabular-nums text-gray-700 dark:text-gray-300">{r.total}</td>
                                <td className={`px-3 py-2 align-top text-right tabular-nums ${r.lowPct >= 50 ? "text-red-600 dark:text-red-400 font-semibold" : r.lowPct >= 25 ? "text-amber-600 dark:text-amber-400" : "text-gray-700 dark:text-gray-300"}`}>
                                    {r.lowPct}%
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function AdminHealthView() {
    const { currentUser, isLoading: authLoading } = useAuth();
    const [stats, setStats] = useState(null);
    const [officeStats, setOfficeStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [fetchedAt, setFetchedAt] = useState(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [recurrence, office] = await Promise.all([
                getRecurrenceSchedulerHealth(),
                getOfficeWorkerHealth().catch((e) => ({ __error: e.message || "failed" })),
            ]);
            setStats(recurrence);
            setOfficeStats(office && !office.__error ? office : null);
            setFetchedAt(Date.now());
        } catch (err) {
            setStats(null);
            setOfficeStats(null);
            setError(err.message || "Failed to load");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!authLoading && currentUser) {
            refresh();
        } else if (!authLoading) {
            setLoading(false);
        }
    }, [authLoading, currentUser, refresh]);

    const now = fetchedAt || Date.now();
    const summary = useMemo(() => {
        if (!stats?.buckets) return null;
        let errors = 0;
        let stale = 0;
        let healthy = 0;
        let idle = 0;
        for (const b of stats.buckets) {
            const s = bucketStatus(b, now);
            if (s === "error") errors += 1;
            else if (s === "warn") stale += 1;
            else if (s === "ok") healthy += 1;
            else idle += 1;
        }
        return { errors, stale, healthy, idle };
    }, [stats, now]);

    if (authLoading) return <Loading text="Loading" />;

    if (!currentUser) {
        return (
            <div className="min-w-screen min-h-screen bg-white dark:bg-black flex items-center justify-center">
                <div className="text-center">
                    <p className="text-gray-700 dark:text-gray-300 mb-4">You need to log in to view this page.</p>
                    <Link to="/" className="text-sm text-gray-800 dark:text-gray-200 underline">Go to sign in</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-w-screen min-h-screen bg-white dark:bg-black">
            <main className="max-w-5xl mx-auto px-4 py-6">
                <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                    <div>
                        <div className="flex items-center gap-2">
                            <Link to="/" className="text-xs text-gray-500 dark:text-gray-400 hover:underline">← Back</Link>
                        </div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">Recurrence scheduler health</h1>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            Snapshot of the nightly recurring-task materializer.
                        </p>
                    </div>
                    <button
                        onClick={refresh}
                        disabled={loading}
                        className="px-3 py-2 text-sm rounded-lg bg-gray-800 dark:bg-gray-700 text-white hover:bg-gray-700 dark:hover:bg-gray-600 disabled:opacity-50 cursor-pointer"
                    >
                        <i className={`fa-solid fa-rotate ${loading ? "fa-spin" : ""} mr-1`} />
                        Refresh
                    </button>
                </div>

                {error && (
                    <div className="mb-4 p-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-900/20 text-sm text-red-800 dark:text-red-300">
                        {error === "Forbidden"
                            ? "Your account is not in the admin allow-list (ADMIN_USER_IDS)."
                            : error === "Not authenticated"
                                ? "You need to sign in again."
                                : `Could not load scheduler stats: ${error}`}
                    </div>
                )}

                {loading && !stats && <Loading text="Loading" />}

                {stats && (
                    <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                            <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                                <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Target time</div>
                                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                                    {String(stats.targetHour).padStart(2, "0")}:{String(stats.targetMinute).padStart(2, "0")}
                                </div>
                                <div className="text-[11px] text-gray-500 dark:text-gray-400">per timezone</div>
                            </div>
                            <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                                <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Default horizon</div>
                                <div className="text-lg font-semibold text-gray-900 dark:text-white">{stats.horizonDays} days</div>
                                <div className="text-[11px] text-gray-500 dark:text-gray-400">override per series</div>
                            </div>
                            <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                                <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">User cache loaded</div>
                                <div className="text-sm font-medium text-gray-900 dark:text-white">
                                    {stats.cacheLoadedAt ? formatRelative(stats.cacheLoadedAt, now) : "never"}
                                </div>
                                <div className="text-[11px] text-gray-500 dark:text-gray-400">{formatTimestamp(stats.cacheLoadedAt)}</div>
                            </div>
                            <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                                <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Tick errors</div>
                                <div className={`text-lg font-semibold ${stats.tickErrorCount > 0 ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>
                                    {stats.tickErrorCount}
                                </div>
                                <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate" title={stats.lastTickErrorMessage || ""}>
                                    {stats.lastTickErrorMessage ? `latest: ${stats.lastTickErrorMessage}` : "no top-level errors"}
                                </div>
                            </div>
                        </div>

                        {summary && (
                            <div className="mb-3 flex flex-wrap gap-2 text-xs text-gray-600 dark:text-gray-300">
                                <StatusPill kind="ok">{summary.healthy} healthy</StatusPill>
                                <StatusPill kind="warn">{summary.stale} stale</StatusPill>
                                <StatusPill kind="error">{summary.errors} errored</StatusPill>
                                <StatusPill kind="idle">{summary.idle} idle</StatusPill>
                                {fetchedAt && (
                                    <span className="ml-auto text-[11px] text-gray-400">
                                        Snapshot {formatRelative(new Date(fetchedAt).toISOString(), Date.now()) || "just now"}
                                    </span>
                                )}
                            </div>
                        )}

                        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide">
                                    <tr>
                                        <th className="text-left px-3 py-2 font-medium">Status</th>
                                        <th className="text-left px-3 py-2 font-medium">Timezone</th>
                                        <th className="text-right px-3 py-2 font-medium">Users</th>
                                        <th className="text-left px-3 py-2 font-medium">Last run</th>
                                        <th className="text-right px-3 py-2 font-medium">Processed</th>
                                        <th className="text-right px-3 py-2 font-medium">Created</th>
                                        <th className="text-left px-3 py-2 font-medium">Recent error</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                    {stats.buckets.length === 0 && (
                                        <tr>
                                            <td colSpan={7} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">
                                                No timezones tracked yet. The scheduler will populate this after its first tick.
                                            </td>
                                        </tr>
                                    )}
                                    {stats.buckets.map((b) => {
                                        const status = bucketStatus(b, now);
                                        const rowBg =
                                            status === "error"
                                                ? "bg-red-50 dark:bg-red-900/20"
                                                : status === "warn"
                                                    ? "bg-yellow-50 dark:bg-yellow-900/20"
                                                    : "";
                                        const relative = formatRelative(b.lastRunAt, now);
                                        return (
                                            <tr key={b.timezone} className={rowBg}>
                                                <td className="px-3 py-2 align-top">
                                                    <StatusPill kind={status}>
                                                        {status === "ok"
                                                            ? "OK"
                                                            : status === "warn"
                                                                ? "Stale"
                                                                : status === "error"
                                                                    ? "Error"
                                                                    : "Idle"}
                                                    </StatusPill>
                                                </td>
                                                <td className="px-3 py-2 align-top font-mono text-xs text-gray-800 dark:text-gray-200">
                                                    {b.timezone}
                                                </td>
                                                <td className="px-3 py-2 align-top text-right tabular-nums text-gray-700 dark:text-gray-300">
                                                    {b.userCount}
                                                </td>
                                                <td className="px-3 py-2 align-top text-gray-700 dark:text-gray-300">
                                                    <div>{formatTimestamp(b.lastRunAt)}</div>
                                                    {relative && (
                                                        <div className="text-[11px] text-gray-500 dark:text-gray-400">{relative}</div>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 align-top text-right tabular-nums text-gray-700 dark:text-gray-300">
                                                    {b.lastRunUserCount}
                                                </td>
                                                <td className="px-3 py-2 align-top text-right tabular-nums text-gray-700 dark:text-gray-300">
                                                    {b.lastRunCreatedCount}
                                                </td>
                                                <td className="px-3 py-2 align-top text-xs text-gray-700 dark:text-gray-300 max-w-xs">
                                                    {b.errorCount > 0 ? (
                                                        <div>
                                                            <div className="font-medium text-red-700 dark:text-red-300">
                                                                ×{b.errorCount} {b.lastErrorAt && (
                                                                    <span className="font-normal text-gray-500 dark:text-gray-400">
                                                                        · {formatRelative(b.lastErrorAt, now)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="text-gray-600 dark:text-gray-400 break-words" title={b.lastErrorMessage || ""}>
                                                                {b.lastErrorMessage || "(no message)"}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <span className="text-gray-400">—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <OfficeHealthCard stats={officeStats} now={now} />
                    </>
                )}
            </main>
        </div>
    );
}

export default AdminHealthView;
