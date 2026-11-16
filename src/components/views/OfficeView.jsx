import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { getCustomSkills, listOfficeJobs, enqueueOfficeJob, getOfficeActionTypes, getWorkerProfile, addWorkerMemory, deleteWorkerMemory, getJobFeedbackMap, submitJobFeedback } from "../../scripts/api.js";
import { ROOM_COLS, ROOM_ROWS, computeDeskLayout, isBlocked, findAdjacentWorker, summarizeJobs } from "../../lib/officeRoom.js";
import PixiOfficeRoom from "./PixiOfficeRoom.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";

// One H/M/L confidence chip with a tooltip explaining why. We accept a
// pre-formatted tooltip string so the server-side baseline copy can be
// reused; the component itself stays purely presentational. Renders nothing
// when level is missing — the parent handles the "user turned it off" path.
function ConfidenceChip({ level, tooltip, size = "sm" }) {
    if (!level) return null;
    const lvl = level === "high" || level === "low" ? level : "medium";
    const palette = lvl === "high"
        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
        : lvl === "low"
            ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200"
            : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200";
    const text = lvl === "high" ? "High" : lvl === "low" ? "Low" : "Medium";
    const px = size === "xs" ? "px-1 py-0 text-[9px]" : "px-1.5 py-0.5 text-[10px]";
    return (
        <span
            className={`${px} rounded-full font-semibold inline-flex items-center gap-0.5 ${palette}`}
            title={tooltip || `${text} confidence in this worker's output.`}
        >
            <i className="fa-solid fa-shield-halved text-[8px] opacity-70" />
            {text}
        </span>
    );
}

// Short tooltip explanation. Mirrors describeConfidence on the server but
// we keep the strings here too so the client can render without a round-trip.
function tipForConfidence(level, actionType) {
    if (level === "high") {
        if (actionType === "draft_memo" || actionType === "summarize_week") {
            return "High confidence — summarising and drafting prose is in the model's sweet spot.";
        }
        return "High confidence — this kind of task is in the model's sweet spot.";
    }
    if (level === "low") {
        if (actionType === "quick_research") {
            return "Low confidence — cross-source research can be wrong. Verify the facts.";
        }
        if (actionType === "draft_tasks") {
            return "Low confidence — multi-step planning under constraints. Review the schedule.";
        }
        return "Low confidence — LLMs are unreliable on this kind of task. Review carefully.";
    }
    return "Medium confidence — decent baseline; skim then trust your gut.";
}

// Built-in skill catalog (mirrors MuseView SKILLS, minus a few internal modes
// that aren't useful as walk-up workers).
const BUILT_IN_SKILLS = [
    { key: "default",    label: "Muse",         icon: "fa-wand-magic-sparkles", color: "text-gray-500" },
    { key: "planner",    label: "Planner",      icon: "fa-calendar-check",      color: "text-orange-500" },
    { key: "adhd",       label: "ADHD Coach",   icon: "fa-brain",                color: "text-pink-500" },
    { key: "journal",    label: "Journal",      icon: "fa-feather",              color: "text-teal-500" },
    { key: "brainstorm", label: "Brainstorm",   icon: "fa-lightbulb",            color: "text-yellow-500" },
    { key: "writer",     label: "Writer",       icon: "fa-pen-fancy",            color: "text-blue-500" },
    { key: "musk",       label: "Musk",         icon: "fa-rocket",               color: "text-blue-400" },
    { key: "munger",     label: "Munger",       icon: "fa-scale-balanced",       color: "text-amber-600" },
    { key: "feynman",    label: "Feynman",      icon: "fa-atom",                  color: "text-cyan-500" },
    { key: "naval",      label: "Naval",        icon: "fa-anchor",               color: "text-indigo-500" },
    { key: "grillMe",    label: "Grill Me",     icon: "fa-fire",                 color: "text-red-600" },
    { key: "specBuilder",label: "Spec Builder", icon: "fa-clipboard-list",       color: "text-violet-500" },
    { key: "manager",    label: "Manager",      icon: "fa-user-tie",             color: "text-purple-500" },
];

const CELL = 36; // px per grid cell at 1x scale
const POLL_MS = 1500;

// Tailwind text-color → hex used for sprite swatches.
const COLOR_HEX = {
    "text-gray-500":     "#6b7280",
    "text-orange-500":   "#f97316",
    "text-pink-500":     "#ec4899",
    "text-teal-500":     "#14b8a6",
    "text-yellow-500":   "#eab308",
    "text-blue-500":     "#3b82f6",
    "text-blue-400":     "#60a5fa",
    "text-amber-600":    "#d97706",
    "text-cyan-500":     "#06b6d4",
    "text-indigo-500":   "#6366f1",
    "text-red-600":      "#dc2626",
    "text-purple-500":   "#a855f7",
    "text-emerald-500":  "#10b981",
    "text-rose-500":     "#f43f5e",
    "text-red-500":      "#ef4444",
    "text-amber-500":    "#f59e0b",
    "text-lime-500":     "#84cc16",
    "text-green-500":    "#22c55e",
    "text-sky-500":      "#0ea5e9",
    "text-violet-500":   "#8b5cf6",
};

function colorHex(c) {
    return COLOR_HEX[c] || "#6b7280";
}

function relativeTime(iso) {
    if (!iso) return "";
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return "";
    const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const h = Math.round(min / 60);
    if (h < 48) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
}

export default function OfficeView() {
    const { currentUser } = useAuth();
    // Default to ON so the chip rolls out for everyone unless they've
    // explicitly opted out from Account settings.
    const showConfidenceChips = currentUser?.showConfidenceChips !== false;
    const [searchParams, setSearchParams] = useSearchParams();
    const [customSkills, setCustomSkills] = useState([]);
    const [actionTypes, setActionTypes] = useState([
        { key: "draft_tasks",    label: "Draft tasks for tomorrow" },
        { key: "summarize_week", label: "Summarize this week's memos" },
        { key: "quick_research", label: "Quick research" },
        { key: "draft_memo",     label: "Draft a memo" },
    ]);
    const [jobs, setJobs] = useState([]);
    const [player, setPlayer] = useState({ x: Math.floor(ROOM_COLS / 2), y: ROOM_ROWS - 2 });
    const [interactingWith, setInteractingWith] = useState(null); // worker key
    const [submenu, setSubmenu] = useState(null); // 'chat' | 'action' | null
    const [pendingActionType, setPendingActionType] = useState(null);
    const [pendingArgument, setPendingArgument] = useState("");
    const [error, setError] = useState(null);
    const [showHistory, setShowHistory] = useState(false);
    // A · Worker profile loaded when the dialog opens.
    const [workerProfile, setWorkerProfile] = useState(null);
    const [profileLoading, setProfileLoading] = useState(false);
    const [newMemoryText, setNewMemoryText] = useState("");
    // E · Feedback map: { [jobId]: { kind, content } }.
    const [feedbackMap, setFeedbackMap] = useState({});
    const playerRef = useRef(player);
    playerRef.current = player;
    const interactingRef = useRef(interactingWith);
    interactingRef.current = interactingWith;

    // Load custom skills + action types + feedback map once.
    useEffect(() => {
        getCustomSkills().then(setCustomSkills).catch(() => {});
        getOfficeActionTypes().then(setActionTypes).catch(() => {});
        getJobFeedbackMap().then(setFeedbackMap).catch(() => {});
    }, []);

    // E · Submit feedback for a job. After save, optimistically update the
    // local map and refresh the worker profile (memories list) if open.
    const handleJobFeedback = useCallback(async (jobId, kind, note = "") => {
        try {
            await submitJobFeedback(jobId, kind, note);
            setFeedbackMap(prev => ({ ...prev, [jobId]: { kind, note: kind === "correction" ? note : "" } }));
            if (interactingRef.current) {
                getWorkerProfile(interactingRef.current).then(setWorkerProfile).catch(() => {});
            }
        } catch (e) {
            setError(e.message || "Failed to save feedback");
        }
    }, []);

    // Build the worker list (built-ins + custom skills).
    const workers = useMemo(() => {
        const all = [
            ...BUILT_IN_SKILLS,
            ...customSkills.map(s => ({
                key: s.key, label: s.label, icon: (s.icon || "fa-user").replace(/^fa-solid\s+/, ""),
                color: s.color || "text-purple-500",
            })),
        ];
        const layout = computeDeskLayout(all.length);
        return all.map((s, i) => ({ ...s, ...layout[i] })).filter(w => w.deskX !== undefined);
    }, [customSkills]);

    // Poll for jobs while the office is open.
    useEffect(() => {
        let stopped = false;
        async function tick() {
            try {
                const list = await listOfficeJobs(80);
                if (!stopped) setJobs(list);
            } catch (e) { /* ignore */ }
        }
        tick();
        const id = setInterval(tick, POLL_MS);
        return () => { stopped = true; clearInterval(id); };
    }, []);

    const jobSummary = useMemo(() => summarizeJobs(jobs), [jobs]);

    // D · Most recent (last 90s) completed reaction per worker, for the
    // floating purple bubble that drifts above the reactor's head.
    const recentReactionByWorker = useMemo(() => {
        const cutoff = Date.now() - 90_000;
        const out = {};
        for (const j of jobs) {
            if (j.kind !== "reaction" || j.status !== "done") continue;
            const ts = new Date(j.finishedAt || j.createdAt).getTime();
            if (!Number.isFinite(ts) || ts < cutoff) continue;
            const cur = out[j.skillKey];
            if (!cur || ts > new Date(cur.finishedAt || cur.createdAt).getTime()) {
                out[j.skillKey] = j;
            }
        }
        return out;
    }, [jobs]);

    // Movement.
    const tryMove = useCallback((dx, dy) => {
        setPlayer(prev => {
            const nx = prev.x + dx, ny = prev.y + dy;
            if (isBlocked(workers, nx, ny)) return prev;
            return { x: nx, y: ny };
        });
    }, [workers]);

    const tryInteract = useCallback(() => {
        const p = playerRef.current;
        const w = findAdjacentWorker(workers, p.x, p.y);
        if (!w) return;
        setInteractingWith(w.key);
        setSubmenu(null);
        setPendingActionType(null);
        setPendingArgument("");
    }, [workers]);

    // Keyboard input.
    useEffect(() => {
        function onKey(e) {
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
            if (interactingRef.current) {
                if (e.key === "Escape") {
                    e.preventDefault();
                    setInteractingWith(null);
                    setSubmenu(null);
                }
                return;
            }
            const k = e.key.toLowerCase();
            if (["arrowup", "w"].includes(k))    { e.preventDefault(); tryMove(0, -1); }
            else if (["arrowdown", "s"].includes(k))  { e.preventDefault(); tryMove(0, 1); }
            else if (["arrowleft", "a"].includes(k))  { e.preventDefault(); tryMove(-1, 0); }
            else if (["arrowright", "d"].includes(k)) { e.preventDefault(); tryMove(1, 0); }
            else if (k === "e" || k === " " || k === "enter") { e.preventDefault(); tryInteract(); }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [tryMove, tryInteract]);

    function openChatWith(skillKey, conversationId, assistantMessageId) {
        setInteractingWith(null);
        setSearchParams(prev => {
            prev.set("view", "muse");
            prev.set("skill", skillKey);
            if (conversationId) prev.set("convo", String(conversationId));
            else prev.delete("convo");
            if (assistantMessageId) prev.set("msg", String(assistantMessageId));
            else prev.delete("msg");
            return prev;
        });
    }

    async function retryJob(job) {
        try {
            await enqueueOfficeJob(job.skillKey, job.actionType, job.argument || "");
            try { setJobs(await listOfficeJobs(80)); } catch {}
        } catch (e) {
            setError(e.message || "Failed to retry");
        }
    }

    async function dispatchAction(skillKey) {
        if (!pendingActionType) return;
        try {
            await enqueueOfficeJob(skillKey, pendingActionType, pendingArgument.trim());
            setInteractingWith(null);
            setSubmenu(null);
            setPendingActionType(null);
            setPendingArgument("");
            // Refresh jobs immediately so the bubble pops up right away.
            try { setJobs(await listOfficeJobs(80)); } catch {}
        } catch (e) {
            setError(e.message || "Failed to queue action");
        }
    }

    // Fetch a worker's profile (role + recent jobs + memories) whenever the
    // dialog opens for that worker.
    useEffect(() => {
        if (!interactingWith) { setWorkerProfile(null); return; }
        let cancelled = false;
        setProfileLoading(true);
        getWorkerProfile(interactingWith)
            .then(p => { if (!cancelled) setWorkerProfile(p); })
            .catch(() => { if (!cancelled) setWorkerProfile(null); })
            .finally(() => { if (!cancelled) setProfileLoading(false); });
        return () => { cancelled = true; };
    }, [interactingWith]);

    async function handleAddMemory() {
        const text = newMemoryText.trim();
        if (!text || !interactingWith) return;
        try {
            await addWorkerMemory(interactingWith, text);
            setNewMemoryText("");
            // Re-fetch so the new memory shows up immediately.
            try { setWorkerProfile(await getWorkerProfile(interactingWith)); } catch {}
        } catch (e) {
            setError(e.message || "Failed to add memory");
        }
    }

    async function handleDeleteMemory(id) {
        try {
            await deleteWorkerMemory(id);
            setWorkerProfile(p => p ? { ...p, memories: p.memories.filter(m => m.id !== id) } : p);
        } catch (e) {
            setError(e.message || "Failed to delete memory");
        }
    }

    const adjacentWorker = findAdjacentWorker(workers, player.x, player.y);

    const roomWidth = ROOM_COLS * CELL;
    const roomHeight = ROOM_ROWS * CELL;

    return (
        <div className="px-2 py-2 sm:px-4 sm:py-4">
            <style>{`
                @keyframes officeBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
                @keyframes officeWiggle { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
                @keyframes officeBubblePop { from { transform: scale(0.7); opacity: 0; } to { transform: scale(1); opacity: 1; } }
                .office-bubble { animation: officeBubblePop 180ms ease-out; }
            `}</style>

            <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                    <h2 className="text-lg font-semibold dark:text-white">Muse Office</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Click a worker to open a dialog, or walk up (arrow keys / WASD / D-pad) and press <kbd className="px-1 border rounded text-[10px]">E</kbd>.
                    </p>
                </div>
                {error && (
                    <button onClick={() => setError(null)}
                        className="text-xs text-red-600 underline">
                        {error} (dismiss)
                    </button>
                )}
            </div>

            <div className="overflow-auto rounded-2xl bg-gradient-to-b from-amber-50 to-amber-100 dark:from-gray-900 dark:to-gray-950 border border-gray-200 dark:border-gray-800 shadow-inner">
                <div className="relative mx-auto" style={{
                    width: roomWidth, height: roomHeight,
                }} role="application" aria-label="Muse Office grid">
                    {/* B · Pixi-rendered game layer (floor, walls, desks,
                         worker sprites, player sprite) sits at the bottom of
                         the stacking order. Everything below this is a React
                         HUD overlay that floats above the canvas. */}
                    <PixiOfficeRoom
                        workers={workers}
                        player={player}
                        jobSummary={jobSummary}
                        onWorkerClick={(key) => { setInteractingWith(key); setSubmenu(null); }}
                    />

                    {/* HUD: name labels (clickable as a backup for the Pixi
                         sprite click) + status / reaction bubbles. */}
                    {workers.map(w => {
                        const summary = jobSummary[w.key];
                        const totalQueue = summary ? summary.queued + summary.running : 0;
                        const recent = summary?.recent;
                        const openDialog = () => { setInteractingWith(w.key); setSubmenu(null); };
                        return (
                            <React.Fragment key={`hud-${w.key}`}>
                                <button type="button"
                                    onClick={openDialog}
                                    aria-label={`Open dialog with ${w.label}`}
                                    className="absolute text-center select-none cursor-pointer p-0 bg-transparent border-0 focus:outline-none focus:ring-2 focus:ring-purple-400 rounded"
                                    style={{
                                        left: w.workerX * CELL - CELL,
                                        top: w.workerY * CELL - 14,
                                        width: CELL * 3,
                                    }}>
                                    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-white/80 dark:bg-gray-800/80 dark:text-white border border-gray-200 dark:border-gray-700 whitespace-nowrap">
                                        <i className={`fa-solid ${w.icon} ${w.color} mr-1`} />
                                        {w.label}
                                    </span>
                                </button>
                                {recent && (
                                    <StatusBubble
                                        workerKey={w.key}
                                        cellX={w.workerX} cellY={w.workerY}
                                        recent={recent} totalQueue={totalQueue}
                                    />
                                )}
                                {(() => {
                                    const r = recentReactionByWorker[w.key];
                                    if (!r) return null;
                                    const text = (r.result || "").trim().slice(0, 90);
                                    if (!text) return null;
                                    return (
                                        <div className="absolute pointer-events-none office-bubble"
                                            style={{
                                                left: w.workerX * CELL - CELL,
                                                top: w.workerY * CELL - 38,
                                                width: CELL * 3, textAlign: "center", zIndex: 5,
                                            }}>
                                            <span className="inline-block px-2 py-0.5 text-[10px] bg-purple-600 text-white rounded shadow whitespace-normal max-w-[180px]">
                                                💬 {text}
                                            </span>
                                        </div>
                                    );
                                })()}
                            </React.Fragment>
                        );
                    })}

                    {/* "Press E" prompt — anchored above the player. */}
                    {adjacentWorker && !interactingWith && (
                        <div className="absolute pointer-events-none office-bubble"
                            style={{
                                left: player.x * CELL - CELL,
                                top: player.y * CELL - 22,
                                width: CELL * 3, textAlign: "center",
                            }}>
                            <span className="px-2 py-0.5 text-[10px] font-semibold bg-black text-white rounded shadow">
                                E / tap to interact with <span className="opacity-80">{adjacentWorker.label}</span>
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Past office runs */}
            <PastRunsPanel
                jobs={jobs}
                workers={workers}
                actionTypes={actionTypes}
                expanded={showHistory}
                onToggle={() => setShowHistory(v => !v)}
                onOpen={openChatWith}
                onRetry={retryJob}
                feedbackMap={feedbackMap}
                onFeedback={handleJobFeedback}
                showConfidenceChips={showConfidenceChips}
            />

            {/* Mobile D-pad */}
            <div className="mt-3 grid grid-cols-3 gap-1 max-w-[180px] mx-auto select-none lg:hidden">
                <div />
                <DpadButton onPress={() => tryMove(0, -1)} icon="fa-chevron-up" label="Up" />
                <div />
                <DpadButton onPress={() => tryMove(-1, 0)} icon="fa-chevron-left" label="Left" />
                <DpadButton onPress={tryInteract}
                    icon={adjacentWorker ? "fa-hand-pointer" : "fa-circle"}
                    label="Action" highlight={!!adjacentWorker} />
                <DpadButton onPress={() => tryMove(1, 0)} icon="fa-chevron-right" label="Right" />
                <div />
                <DpadButton onPress={() => tryMove(0, 1)} icon="fa-chevron-down" label="Down" />
                <div />
            </div>

            {/* Worker interaction modal */}
            {interactingWith && (() => {
                const w = workers.find(x => x.key === interactingWith);
                if (!w) return null;
                const info = workerProfile?.info;
                const stats = workerProfile?.stats;
                const recentJobs = workerProfile?.recentJobs || [];
                const memories = workerProfile?.memories || [];
                return (
                    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3"
                        onClick={() => { setInteractingWith(null); setSubmenu(null); }}>
                        <div className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-4"
                            onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-3 mb-3">
                                <i className={`fa-solid ${w.icon} ${w.color} text-xl`} />
                                <div className="min-w-0">
                                    <div className="font-semibold dark:text-white">{w.label}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                        {info?.desc || "at the office"}
                                    </div>
                                </div>
                                <button onClick={() => { setInteractingWith(null); setSubmenu(null); }}
                                    className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            </div>

                            {/* A · Profile card (role + stats + recent + memories) */}
                            {!submenu && (
                                <div className="mb-3 space-y-3">
                                    {/* Role description */}
                                    {info?.longDesc && (
                                        <div className="text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2.5 leading-snug">
                                            {info.longDesc}
                                        </div>
                                    )}

                                    {/* Stats */}
                                    {stats && (
                                        <div className="flex gap-2 text-[11px]">
                                            <div className="flex-1 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-2 py-1.5">
                                                <div className="text-gray-500 dark:text-gray-400">Total runs</div>
                                                <div className="font-semibold dark:text-white">{stats.totalJobs}</div>
                                            </div>
                                            <div className="flex-1 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-2 py-1.5">
                                                <div className="text-gray-500 dark:text-gray-400">Last 7 days</div>
                                                <div className="font-semibold dark:text-white">{stats.last7dJobs}</div>
                                            </div>
                                            <div className="flex-1 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-2 py-1.5">
                                                <div className="text-gray-500 dark:text-gray-400">Memories</div>
                                                <div className="font-semibold dark:text-white">{memories.length}</div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Recent runs */}
                                    {recentJobs.length > 0 && (
                                        <div>
                                            <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Recent</div>
                                            <ul className="space-y-1">
                                                {recentJobs.slice(0, 5).map(j => (
                                                    <li key={j.id} className="text-xs flex items-start gap-2">
                                                        <span className={`mt-1 inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                                            j.status === "done" ? "bg-emerald-500" :
                                                            j.status === "failed" ? "bg-red-500" :
                                                            j.status === "running" ? "bg-blue-500" : "bg-gray-400"
                                                        }`} />
                                                        <button
                                                            type="button"
                                                            onClick={() => openChatWith(w.key, j.conversationId, j.assistantMessageId)}
                                                            className="text-left flex-1 min-w-0 hover:underline dark:text-gray-200">
                                                            <span className="font-medium">{actionTypes.find(a => a.key === j.actionType)?.label || j.actionType}</span>
                                                            {j.argument ? <span className="text-gray-500 dark:text-gray-400"> · {j.argument}</span> : null}
                                                            <span className="text-gray-400 dark:text-gray-500"> · {relativeTime(j.createdAt)}</span>
                                                        </button>
                                                        {showConfidenceChips && j.status === "done" && (
                                                            <ConfidenceChip
                                                                level={j.confidence || "medium"}
                                                                tooltip={tipForConfidence(j.confidence || "medium", j.actionType)}
                                                                size="xs"
                                                            />
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {/* F · Long-term memories */}
                                    <div>
                                        <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide flex items-center justify-between">
                                            <span>What I remember</span>
                                            {profileLoading && <i className="fa-solid fa-spinner fa-spin text-gray-400" />}
                                        </div>
                                        {memories.length === 0 && !profileLoading && (
                                            <div className="text-[11px] text-gray-400 italic mb-1">
                                                Nothing yet. After each quick action I'll jot one short note here.
                                            </div>
                                        )}
                                        <ul className="space-y-1">
                                            {memories.slice(0, 6).map(m => (
                                                <li key={m.id} className="text-xs flex items-start gap-2 group">
                                                    <i className={`fa-solid mt-0.5 text-[10px] ${m.source === "manual" ? "fa-user text-blue-500" : "fa-sparkles text-amber-500"}`} />
                                                    <span className="flex-1 dark:text-gray-200">{m.content}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteMemory(m.id)}
                                                        title="Forget this"
                                                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-[10px]">
                                                        <i className="fa-solid fa-xmark" />
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                        <div className="flex gap-1 mt-2">
                                            <input
                                                type="text"
                                                placeholder="Tell me something to remember…"
                                                value={newMemoryText}
                                                onChange={(e) => setNewMemoryText(e.target.value)}
                                                onKeyDown={(e) => { if (e.key === "Enter") handleAddMemory(); }}
                                                className="flex-1 px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                                            />
                                            <button
                                                type="button"
                                                onClick={handleAddMemory}
                                                disabled={!newMemoryText.trim()}
                                                className="px-2 py-1 text-xs rounded bg-purple-600 text-white disabled:opacity-40 hover:bg-purple-700">
                                                Save
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {!submenu && (
                                <div className="grid grid-cols-2 gap-2">
                                    <button onClick={() => openChatWith(w.key)}
                                        className="px-3 py-3 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition flex flex-col items-center gap-1">
                                        <i className="fa-solid fa-comment" />
                                        Chat
                                    </button>
                                    <button onClick={() => setSubmenu("action")}
                                        className="px-3 py-3 rounded-xl bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition flex flex-col items-center gap-1">
                                        <i className="fa-solid fa-bolt" />
                                        Quick action
                                    </button>
                                </div>
                            )}

                            {submenu === "action" && (
                                <div className="space-y-2">
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Pick an action:</div>
                                    {actionTypes
                                        .filter(a => !a.restrictedTo || a.restrictedTo.includes(interactingWith))
                                        .map(a => (
                                        <label key={a.key}
                                            className={`block px-3 py-2 rounded-lg border cursor-pointer text-sm transition ${
                                                pendingActionType === a.key
                                                    ? "bg-purple-50 border-purple-400 dark:bg-purple-900/30"
                                                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
                                            } dark:text-white`}>
                                            <input type="radio" className="mr-2"
                                                checked={pendingActionType === a.key}
                                                onChange={() => setPendingActionType(a.key)} />
                                            {a.label}
                                            {a.kind === "template" && a.steps && (
                                                <div className="ml-6 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                                                    {a.steps.map(s => s.skillKey).join(" → ")}
                                                </div>
                                            )}
                                            {a.desc && (
                                                <div className="ml-6 mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                                                    {a.desc}
                                                </div>
                                            )}
                                        </label>
                                    ))}
                                    {pendingActionType && (
                                        <input
                                            type="text"
                                            placeholder="Optional context (topic, focus, …)"
                                            value={pendingArgument}
                                            onChange={(e) => setPendingArgument(e.target.value)}
                                            className="w-full px-3 py-2 mt-1 text-sm rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-400"
                                            autoFocus
                                        />
                                    )}
                                    <div className="flex gap-2 pt-2">
                                        <button onClick={() => setSubmenu(null)}
                                            className="flex-1 px-3 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 dark:text-white hover:bg-gray-200">
                                            Back
                                        </button>
                                        <button onClick={() => dispatchAction(w.key)}
                                            disabled={!pendingActionType}
                                            className="flex-1 px-3 py-2 text-sm rounded-lg bg-purple-600 text-white disabled:opacity-50 hover:bg-purple-700">
                                            Send
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

function StatusBubble({ cellX, cellY, recent, totalQueue }) {
    const status = recent.status;
    const map = {
        queued:  { text: "queued…",   bg: "bg-gray-700",   icon: "fa-clock" },
        running: { text: "working…",  bg: "bg-blue-600",   icon: "fa-spinner fa-spin" },
        done:    { text: "done",      bg: "bg-emerald-600", icon: "fa-check" },
        failed:  { text: "failed",    bg: "bg-red-600",     icon: "fa-triangle-exclamation" },
    };
    const m = map[status] || map.done;
    return (
        <div className="absolute pointer-events-none office-bubble" style={{
            left: cellX * CELL - CELL,
            top: cellY * CELL - 34,
            width: CELL * 3, textAlign: "center",
        }}>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-white rounded-full shadow ${m.bg}`}
                title={status === "failed" ? (recent.errorMessage || "failed") : recent.actionType}>
                <i className={`fa-solid ${m.icon}`} />
                {m.text}
                {totalQueue > 1 && status !== "done" && status !== "failed" && (
                    <span className="ml-1 px-1 bg-white/30 rounded">×{totalQueue}</span>
                )}
            </span>
        </div>
    );
}

function formatRelative(ts) {
    if (!ts) return "";
    const d = typeof ts === "string" ? new Date(ts) : ts;
    const ms = Date.now() - d.getTime();
    if (Number.isNaN(ms)) return "";
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.round(h / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
}

const STATUS_BADGE = {
    queued:  { text: "queued",   cls: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200" },
    running: { text: "running",  cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200" },
    done:    { text: "done",     cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200" },
    failed:  { text: "failed",   cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200" },
};

function PastRunsPanel({ jobs, workers, actionTypes, expanded, onToggle, onOpen, onRetry, feedbackMap = {}, onFeedback, showConfidenceChips = true }) {
    const workerByKey = useMemo(() => {
        const m = {};
        for (const w of workers) m[w.key] = w;
        return m;
    }, [workers]);
    const actionByKey = useMemo(() => {
        const m = {};
        for (const a of actionTypes) m[a.key] = a;
        return m;
    }, [actionTypes]);

    const visible = jobs || [];
    const total = visible.length;

    return (
        <div className="mt-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <button
                type="button"
                onClick={onToggle}
                className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-2xl"
                aria-expanded={expanded}
            >
                <span className="flex items-center gap-2">
                    <i className={`fa-solid ${expanded ? "fa-chevron-down" : "fa-chevron-right"} text-xs text-gray-400`} />
                    Past office runs
                    <span className="text-xs text-gray-400 font-normal">({total})</span>
                </span>
                {!expanded && total > 0 && (
                    <span className="text-xs text-gray-400 font-normal">latest {formatRelative(visible[0].createdAt)}</span>
                )}
            </button>
            {expanded && (
                <div className="px-2 pb-3 max-h-96 overflow-auto">
                    {total === 0 ? (
                        <div className="text-xs text-gray-500 dark:text-gray-400 px-3 py-4 text-center">
                            No quick-action runs yet. Walk up to a worker and pick "Quick action" to start one.
                        </div>
                    ) : (
                        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                            {visible.map(job => {
                                const w = workerByKey[job.skillKey];
                                const a = actionByKey[job.actionType];
                                const badge = STATUS_BADGE[job.status] || STATUS_BADGE.queued;
                                const skillLabel = w?.label || job.skillKey;
                                const skillIcon = w?.icon || "fa-user";
                                const skillColor = w?.color || "text-gray-500";
                                const actionLabel = a?.label || job.actionType;
                                const canOpen = !!job.conversationId;
                                return (
                                    <li key={job.id} className="px-2 py-2 flex items-start gap-3">
                                        <i className={`fa-solid ${skillIcon} ${skillColor} mt-1 w-4 text-center`} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-medium dark:text-white truncate">{skillLabel}</span>
                                                <span className="text-xs text-gray-500 dark:text-gray-400 truncate">· {actionLabel}</span>
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${badge.cls}`}>{badge.text}</span>
                                                {showConfidenceChips && job.status === "done" && (
                                                    <ConfidenceChip
                                                        level={job.confidence || "medium"}
                                                        tooltip={tipForConfidence(job.confidence || "medium", job.actionType)}
                                                    />
                                                )}
                                            </div>
                                            {job.argument && (
                                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate" title={job.argument}>
                                                    “{job.argument}”
                                                </div>
                                            )}
                                            {job.status === "failed" && job.errorMessage && (
                                                <div className="text-xs text-red-600 dark:text-red-400 mt-0.5 truncate" title={job.errorMessage}>
                                                    {job.errorMessage}
                                                </div>
                                            )}
                                            <div className="text-[10px] text-gray-400 mt-0.5">
                                                {formatRelative(job.createdAt)}
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-1 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => onOpen(job.skillKey, job.conversationId, job.assistantMessageId)}
                                                disabled={!canOpen}
                                                title={canOpen ? "Open in chat" : "No conversation yet"}
                                                className="px-2 py-1 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                <i className="fa-solid fa-comment mr-1" />
                                                Open
                                            </button>
                                            {job.status === "failed" && (
                                                <button
                                                    type="button"
                                                    onClick={() => onRetry(job)}
                                                    className="px-2 py-1 text-xs rounded-md bg-gray-200 dark:bg-gray-800 dark:text-gray-100 hover:bg-gray-300"
                                                >
                                                    <i className="fa-solid fa-rotate-right mr-1" />
                                                    Retry
                                                </button>
                                            )}
                                            {job.status === "done" && job.kind !== "reaction" && onFeedback && (
                                                <FeedbackButtons
                                                    feedback={feedbackMap[job.id]}
                                                    onSubmit={(kind, note) => onFeedback(job.id, kind, note)}
                                                />
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

// E · Inline 👍 / 👎 / ✏️ buttons for a finished office job. Highlights the
// active rating when feedback exists. The ✏️ control opens a tiny inline
// textarea so the user can leave a one-line correction.
function FeedbackButtons({ feedback, onSubmit }) {
    const [editing, setEditing] = useState(false);
    const [note, setNote] = useState("");
    useEffect(() => {
        if (editing && feedback?.kind === "correction" && feedback?.note) {
            setNote(feedback.note);
        }
    }, [editing, feedback]);
    const active = feedback?.kind;
    const baseBtn = "w-7 h-7 rounded-md flex items-center justify-center text-[11px] transition";
    const cls = (k, activeCls) => active === k
        ? `${baseBtn} ${activeCls}`
        : `${baseBtn} bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700`;
    return (
        <div className="flex flex-col items-end gap-1">
            <div className="flex gap-1">
                <button type="button"
                    title="Liked this"
                    onClick={() => onSubmit("positive", "")}
                    className={cls("positive", "bg-emerald-500 text-white")}>
                    <i className="fa-solid fa-thumbs-up" />
                </button>
                <button type="button"
                    title="Didn't like this"
                    onClick={() => onSubmit("negative", "")}
                    className={cls("negative", "bg-red-500 text-white")}>
                    <i className="fa-solid fa-thumbs-down" />
                </button>
                <button type="button"
                    title="Leave a correction"
                    onClick={() => setEditing(v => !v)}
                    className={cls("correction", "bg-amber-500 text-white")}>
                    <i className="fa-solid fa-pen" />
                </button>
            </div>
            {editing && (
                <div className="flex gap-1 items-start">
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        placeholder="One-line correction…"
                        className="w-44 px-1.5 py-1 text-[11px] rounded border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                    <button type="button"
                        onClick={() => {
                            const trimmed = note.trim();
                            if (!trimmed) return;
                            onSubmit("correction", trimmed);
                            setEditing(false);
                        }}
                        disabled={!note.trim()}
                        className="px-2 py-1 text-[11px] rounded bg-amber-500 text-white disabled:opacity-40 hover:bg-amber-600">
                        Save
                    </button>
                </div>
            )}
            {!editing && active === "correction" && feedback?.note && (
                <div className="text-[10px] text-amber-600 dark:text-amber-400 italic max-w-[180px] text-right truncate" title={feedback.note}>
                    “{feedback.note}”
                </div>
            )}
        </div>
    );
}

function DpadButton({ onPress, icon, label, highlight }) {
    return (
        <button
            onClick={onPress}
            onTouchStart={(e) => { e.preventDefault(); onPress(); }}
            aria-label={label}
            className={`h-12 rounded-lg flex items-center justify-center text-lg ${
                highlight
                    ? "bg-purple-600 text-white shadow-lg"
                    : "bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-200 active:bg-gray-300"
            }`}
        >
            <i className={`fa-solid ${icon}`} />
        </button>
    );
}
