import React, { useEffect, useState, useRef, useCallback } from "react";
import {
    getPodcastTranscript,
    getPodcastEpisodeNotes,
    addPodcastEpisodeNote,
    updatePodcastEpisodeNote,
    deletePodcastEpisodeNote,
    updatePodcastEpisode,
    summarizePodcastEpisode,
} from "../../scripts/api.js";

function fmtSec(sec) {
    if (sec == null) return "";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        : `${m}:${String(s).padStart(2, "0")}`;
}

export default function PodcastEpisodeDetail({ episode, onBack, onEpisodeChanged }) {
    const [transcript, setTranscript] = useState(null);
    const [transcriptLoading, setTranscriptLoading] = useState(false);
    const [transcriptError, setTranscriptError] = useState("");
    const [notes, setNotes] = useState([]);
    const [error, setError] = useState("");

    const [overallDraft, setOverallDraft] = useState(episode.notes || "");
    const [savingOverall, setSavingOverall] = useState(false);
    const [overallSaved, setOverallSaved] = useState(false);
    const [editingOverall, setEditingOverall] = useState(false);

    const [noteAtIdx, setNoteAtIdx] = useState(null); // segment index where note composer is open
    const [noteDraft, setNoteDraft] = useState("");
    const [savingNote, setSavingNote] = useState(false);
    const [editingNoteId, setEditingNoteId] = useState(null);
    const [notesOnly, setNotesOnly] = useState(false);
    const [editDraft, setEditDraft] = useState("");

    const [summary, setSummary] = useState(episode.summary || "");
    const [summarizing, setSummarizing] = useState(false);
    const [showSummary, setShowSummary] = useState(false);

    const playerRef = useRef(null);
    const playerReadyRef = useRef(false);
    const currentTimeRef = useRef(0);
    const [quickDraft, setQuickDraft] = useState("");
    const [quickSec, setQuickSec] = useState(null);
    const [savingQuick, setSavingQuick] = useState(false);

    // The YouTube iframe API replies to a "listening" handshake; treat any
    // message from the player frame as readiness.
    useEffect(() => {
        playerReadyRef.current = false;
        currentTimeRef.current = 0;
        setQuickSec(null);
        setQuickDraft("");
        setSummary(episode.summary || "");
        setShowSummary(false);
        setSummarizing(false);
        function onMessage(e) {
            if (typeof e.origin === "string" && e.origin.includes("youtube.com")) {
                playerReadyRef.current = true;
                try {
                    const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
                    const t = data?.info?.currentTime;
                    if (typeof t === "number" && isFinite(t)) currentTimeRef.current = t;
                } catch { /* not JSON */ }
            }
        }
        window.addEventListener("message", onMessage);
        const t = setInterval(() => {
            if (playerReadyRef.current) { clearInterval(t); return; }
            playerRef.current?.contentWindow?.postMessage(
                JSON.stringify({ event: "listening", id: "podcast-player" }), "*"
            );
        }, 500);
        return () => { window.removeEventListener("message", onMessage); clearInterval(t); };
    }, [episode.id]);

    const loadTranscript = useCallback(async () => {
        setTranscriptLoading(true);
        setTranscriptError("");
        try {
            const t = await getPodcastTranscript(episode.id);
            setTranscript(t);
        } catch (e) {
            setTranscriptError(e.message);
        } finally {
            setTranscriptLoading(false);
        }
    }, [episode.id]);

    useEffect(() => {
        loadTranscript();
        getPodcastEpisodeNotes(episode.id).then(setNotes).catch(e => setError(e.message));
    }, [episode.id, loadTranscript]);

    function seekTo(sec) {
        const frame = playerRef.current;
        if (!frame) return;
        if (playerReadyRef.current && frame.contentWindow) {
            frame.contentWindow.postMessage(
                JSON.stringify({ event: "command", func: "seekTo", args: [sec, true] }),
                "*"
            );
            frame.contentWindow.postMessage(
                JSON.stringify({ event: "command", func: "playVideo", args: [] }),
                "*"
            );
        } else {
            // Fallback before the player API is ready: reload at the target time.
            frame.src = `https://www.youtube.com/embed/${episode.videoId}?enablejsapi=1&start=${sec}&autoplay=1`;
        }
    }

    async function saveOverall() {
        if (savingOverall) return;
        setSavingOverall(true);
        try {
            const row = await updatePodcastEpisode(episode.id, { notes: overallDraft });
            onEpisodeChanged?.({ ...episode, notes: row.notes });
            setOverallSaved(true);
            setTimeout(() => setOverallSaved(false), 2000);
        } catch (e) {
            setError(e.message);
        } finally {
            setSavingOverall(false);
        }
    }

    async function saveTimedNote() {
        if (savingNote || !noteDraft.trim() || noteAtIdx == null) return;
        const sec = transcript?.segments?.[noteAtIdx]?.sec ?? null;
        setSavingNote(true);
        try {
            const row = await addPodcastEpisodeNote(episode.id, { sec, content: noteDraft.trim() });
            setNotes(prev => [...prev, row].sort((a, b) => (a.sec ?? 0) - (b.sec ?? 0)));
            setNoteDraft("");
            setNoteAtIdx(null);
        } catch (e) {
            setError(e.message);
        } finally {
            setSavingNote(false);
        }
    }

    function markNow() {
        setQuickSec(Math.floor(currentTimeRef.current || 0));
    }

    async function saveQuickNote() {
        if (savingQuick || !quickDraft.trim() || quickSec == null) return;
        setSavingQuick(true);
        try {
            const row = await addPodcastEpisodeNote(episode.id, { sec: quickSec, content: quickDraft.trim() });
            setNotes(prev => [...prev, row].sort((a, b) => (a.sec ?? 0) - (b.sec ?? 0)));
            setQuickDraft("");
            setQuickSec(null);
        } catch (e) {
            setError(e.message);
        } finally {
            setSavingQuick(false);
        }
    }

    async function saveEditNote(note) {
        try {
            const row = await updatePodcastEpisodeNote(note.id, editDraft.trim());
            setNotes(prev => prev.map(n => n.id === note.id ? row : n));
            setEditingNoteId(null);
        } catch (e) {
            setError(e.message);
        }
    }

    async function removeNote(noteId) {
        if (!confirm("Delete this note?")) return;
        try {
            await deletePodcastEpisodeNote(noteId);
            setNotes(prev => prev.filter(n => n.id !== noteId));
        } catch (e) {
            setError(e.message);
        }
    }

    async function handleSummarize() {
        if (summary) { setShowSummary(s => !s); return; }
        if (summarizing) return;
        setSummarizing(true);
        setError("");
        try {
            const res = await summarizePodcastEpisode(episode.id);
            setSummary(res.summary);
            setShowSummary(true);
            onEpisodeChanged?.({ ...episode, summary: res.summary });
        } catch (e) {
            setError(e.message);
        } finally {
            setSummarizing(false);
        }
    }

    // Notes indexed by nearest segment: we render a note right after the last
    // segment whose sec <= note.sec.
    const timedNotes = notes.filter(n => n.sec != null);
    const notesBySegIdx = {};
    if (transcript?.segments?.length) {
        for (const n of timedNotes) {
            let idx = 0;
            for (let i = 0; i < transcript.segments.length; i++) {
                if (transcript.segments[i].sec <= n.sec) idx = i;
                else break;
            }
            (notesBySegIdx[idx] = notesBySegIdx[idx] || []).push(n);
        }
    }

    return (
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {/* Top bar */}
            <div className="flex items-center gap-3 px-5 py-2.5 border-b border-gray-100 dark:border-gray-800 shrink-0">
                <button onClick={onBack} className="text-xs text-gray-500 hover:text-black dark:hover:text-white cursor-pointer">
                    <i className="fa-solid fa-arrow-left mr-1.5" />Back
                </button>
                <h3 className="text-sm font-semibold dark:text-white truncate flex-1">{episode.title || episode.videoId}</h3>
                <button
                    onClick={handleSummarize}
                    disabled={summarizing}
                    className="text-xs text-amber-500 hover:text-amber-600 cursor-pointer disabled:opacity-50"
                    title={summary ? "Toggle AI summary" : "Generate AI summary"}
                >
                    <i className={`fa-solid ${summarizing ? "fa-spinner fa-spin" : "fa-wand-magic-sparkles"} mr-1`} />
                    {summarizing ? "Summarizing…" : summary ? "Summary" : "Summarize"}
                </button>
            </div>

            {error && (
                <div className="mx-5 mt-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 flex items-center justify-between shrink-0">
                    <span>{error}</span>
                    <button onClick={() => setError("")} className="ml-3"><i className="fa-solid fa-xmark" /></button>
                </div>
            )}

            <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
                {/* Left: player + quick note + overall notes */}
                <div className="lg:w-[46%] shrink-0 flex flex-col overflow-y-auto p-4 gap-3">
                    <div className="aspect-video w-full rounded-xl overflow-hidden bg-black shrink-0">
                        <iframe
                            ref={playerRef}
                            src={`https://www.youtube.com/embed/${episode.videoId}?enablejsapi=1`}
                            title={episode.title}
                            className="w-full h-full"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                        />
                    </div>

                    {showSummary && summary && (
                        <div className="text-xs rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-900/10 px-3 py-2.5 dark:text-gray-200 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto shrink-0">
                            {summary}
                        </div>
                    )}

                    {/* Quick note at current playback time */}
                    <div className="shrink-0">
                        {quickSec == null ? (
                            <button
                                onClick={markNow}
                                className="w-full text-xs bg-purple-500 hover:bg-purple-600 text-white rounded-lg px-3 py-2 cursor-pointer transition"
                                title="Mark the current playback time and write a note"
                            >
                                <i className="fa-solid fa-location-pin mr-1.5" />喺而家時間落 note
                            </button>
                        ) : (
                            <div className="flex gap-1.5 items-center">
                                <span className="shrink-0 text-[11px] font-mono text-purple-500 bg-purple-50 dark:bg-purple-900/30 rounded px-1.5 py-1">{fmtSec(quickSec)}</span>
                                <input
                                    autoFocus
                                    value={quickDraft}
                                    onChange={e => setQuickDraft(e.target.value)}
                                    onKeyDown={e => { if (e.key === "Enter") saveQuickNote(); if (e.key === "Escape") { setQuickSec(null); setQuickDraft(""); } }}
                                    placeholder={`Note @ ${fmtSec(quickSec)}…`}
                                    className="flex-1 min-w-0 text-xs rounded-lg border border-purple-300 dark:border-purple-700 bg-transparent px-2.5 py-1.5 dark:text-white focus:outline-none"
                                />
                                <button onClick={saveQuickNote} disabled={savingQuick || !quickDraft.trim()} className="shrink-0 text-xs bg-purple-500 text-white px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50">
                                    {savingQuick ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-check" />}
                                </button>
                                <button onClick={() => { setQuickSec(null); setQuickDraft(""); }} className="shrink-0 text-xs text-gray-400 px-1 cursor-pointer"><i className="fa-solid fa-xmark" /></button>
                            </div>
                        )}
                    </div>

                    {/* This episode's timed notes, always visible under the player */}
                    {timedNotes.length > 0 && (
                        <div className="shrink-0">
                            <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                                <i className="fa-solid fa-clock mr-1.5 text-purple-400" />本集 notes({timedNotes.length})
                            </div>
                            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
                                {timedNotes.map(n => (
                                    <div key={n.id} className="flex items-start gap-2 text-xs rounded-lg bg-purple-50/60 dark:bg-purple-900/15 px-2.5 py-1.5">
                                        <button
                                            onClick={() => seekTo(n.sec)}
                                            className="shrink-0 font-mono text-[10px] text-purple-500 hover:text-purple-700 cursor-pointer mt-0.5"
                                            title="Jump to this time"
                                        >
                                            {fmtSec(n.sec)}
                                        </button>
                                        <span className="dark:text-gray-200 whitespace-pre-wrap break-words min-w-0">{n.content}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="shrink-0">
                        <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5 flex items-center justify-between">
                            <span><i className="fa-solid fa-note-sticky mr-1.5 text-purple-400" />Overall notes</span>
                            {!editingOverall && (
                                <button
                                    onClick={() => setEditingOverall(true)}
                                    className="text-[10px] text-gray-400 hover:text-purple-500 cursor-pointer"
                                    title="Edit overall notes"
                                >
                                    <i className="fa-solid fa-pen mr-1" />Edit
                                </button>
                            )}
                        </div>
                        {editingOverall ? (
                            <>
                                <textarea
                                    value={overallDraft}
                                    onChange={e => setOverallDraft(e.target.value)}
                                    rows={6}
                                    autoFocus
                                    placeholder="成集嘅整體 notes…"
                                    className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-purple-400 resize-y"
                                />
                                <div className="flex items-center gap-2 mt-1">
                                    <button
                                        onClick={async () => { await saveOverall(); setEditingOverall(false); }}
                                        disabled={savingOverall}
                                        className="text-xs bg-black dark:bg-white text-white dark:text-black px-3 py-1 rounded-lg cursor-pointer disabled:opacity-50"
                                    >
                                        {savingOverall ? "Saving…" : "Save"}
                                    </button>
                                    <button
                                        onClick={() => { setOverallDraft(episode.notes || ""); setEditingOverall(false); }}
                                        className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 cursor-pointer"
                                    >
                                        Cancel
                                    </button>
                                    {overallSaved && <span className="text-[10px] text-emerald-500">Saved ✓</span>}
                                </div>
                            </>
                        ) : overallDraft ? (
                            <div className="text-xs rounded-lg bg-gray-50 dark:bg-gray-900 px-3 py-2.5 dark:text-gray-200 whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
                                {overallDraft}
                            </div>
                        ) : (
                            <button
                                onClick={() => setEditingOverall(true)}
                                className="w-full text-left text-xs text-gray-400 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 px-3 py-2.5 hover:border-purple-300 hover:text-purple-400 cursor-pointer transition"
                            >
                                <i className="fa-solid fa-plus mr-1.5" />加整體 notes…
                            </button>
                        )}
                    </div>
                </div>

                {/* Right: transcript timeline with inline notes */}
                <div className="flex-1 min-w-0 border-t lg:border-t-0 lg:border-l border-gray-100 dark:border-gray-800 flex flex-col overflow-hidden">
                    <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0">
                        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                            <i className="fa-solid fa-closed-captioning mr-1.5 text-blue-400" />
                            Transcript
                            {transcript?.langName ? ` · ${transcript.langName}${transcript.isAutoGenerated ? " (auto)" : ""}` : ""}
                        </span>
                        <div className="flex items-center gap-3">
                            {transcript && (
                                <span className="text-[10px] text-gray-400">{transcript.segments.length} segments · {timedNotes.length} notes</span>
                            )}
                            <button
                                onClick={() => setNotesOnly(v => !v)}
                                className={`text-[10px] px-2 py-0.5 rounded-full cursor-pointer transition ${
                                    notesOnly
                                        ? "bg-purple-500 text-white"
                                        : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-purple-100 dark:hover:bg-purple-900/40"
                                }`}
                                title={notesOnly ? "顯示返全部字幕" : "只顯示筆記"}
                            >
                                <i className="fa-solid fa-note-sticky mr-1" />只睇 notes
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 py-2">
                        {transcriptLoading && <p className="text-xs text-gray-400 py-4">抓緊字幕…</p>}
                        {transcriptError && (
                            <div className="text-xs text-gray-400 py-4">
                                <p className="text-red-400 mb-2">{transcriptError}</p>
                                <button onClick={loadTranscript} className="text-blue-500 hover:underline cursor-pointer">再試一次</button>
                            </div>
                        )}
                        {notesOnly && (
                            timedNotes.length === 0 ? (
                                <p className="text-xs text-gray-400 py-4 text-center">仲未有時間戳筆記。切換返字幕模式,喺任何一句撳「+note」啦!</p>
                            ) : (
                                timedNotes.map(n => (
                                    <div key={n.id} className="my-1.5 flex items-start gap-2 bg-purple-50 dark:bg-purple-900/20 border-l-2 border-purple-400 rounded-r-lg px-2.5 py-2">
                                        <button onClick={() => seekTo(n.sec)} className="shrink-0 text-[10px] font-mono text-purple-500 hover:underline cursor-pointer mt-0.5">{fmtSec(n.sec)}</button>
                                        {editingNoteId === n.id ? (
                                            <div className="flex-1 flex gap-1.5">
                                                <input
                                                    autoFocus
                                                    value={editDraft}
                                                    onChange={e => setEditDraft(e.target.value)}
                                                    onKeyDown={e => { if (e.key === "Enter") saveEditNote(n); if (e.key === "Escape") setEditingNoteId(null); }}
                                                    className="flex-1 text-xs rounded border border-purple-300 dark:border-purple-700 bg-transparent px-2 py-1 dark:text-white focus:outline-none"
                                                />
                                                <button onClick={() => saveEditNote(n)} className="text-[10px] text-purple-500 cursor-pointer"><i className="fa-solid fa-check" /></button>
                                            </div>
                                        ) : (
                                            <p className="flex-1 text-xs dark:text-gray-200 leading-relaxed">{n.content}</p>
                                        )}
                                        <button onClick={() => { setEditingNoteId(n.id); setEditDraft(n.content); }} className="shrink-0 text-gray-300 hover:text-purple-500 text-[10px] cursor-pointer mt-0.5"><i className="fa-solid fa-pen" /></button>
                                        <button onClick={() => removeNote(n.id)} className="shrink-0 text-gray-300 hover:text-red-400 text-[10px] cursor-pointer mt-0.5"><i className="fa-solid fa-trash-can" /></button>
                                    </div>
                                ))
                            )
                        )}
                        {!notesOnly && transcript?.segments?.map((seg, i) => (
                            <div key={i} className="group">
                                <div className="flex items-start gap-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-900/60">
                                    <button
                                        onClick={() => seekTo(seg.sec)}
                                        className="shrink-0 text-[10px] font-mono text-blue-500 hover:text-blue-600 hover:underline cursor-pointer mt-0.5 w-12 text-right"
                                        title="Jump to this point"
                                    >
                                        {fmtSec(seg.sec)}
                                    </button>
                                    <p className="flex-1 text-xs dark:text-gray-300 leading-relaxed">{seg.text}</p>
                                    <button
                                        onClick={() => { setNoteAtIdx(i); setNoteDraft(""); }}
                                        className="shrink-0 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-purple-500 text-[10px] cursor-pointer mt-0.5 transition"
                                        title="Add note at this timestamp"
                                    >
                                        <i className="fa-solid fa-plus" /> note
                                    </button>
                                </div>
                                {noteAtIdx === i && (
                                    <div className="ml-14 my-1.5 flex gap-1.5">
                                        <input
                                            autoFocus
                                            value={noteDraft}
                                            onChange={e => setNoteDraft(e.target.value)}
                                            onKeyDown={e => { if (e.key === "Enter") saveTimedNote(); if (e.key === "Escape") setNoteAtIdx(null); }}
                                            placeholder={`Note @ ${fmtSec(seg.sec)}…`}
                                            className="flex-1 text-xs rounded-lg border border-purple-300 dark:border-purple-700 bg-transparent px-2.5 py-1.5 dark:text-white focus:outline-none"
                                        />
                                        <button onClick={saveTimedNote} disabled={savingNote || !noteDraft.trim()} className="text-xs bg-purple-500 text-white px-2.5 rounded-lg cursor-pointer disabled:opacity-50">
                                            {savingNote ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-check" />}
                                        </button>
                                        <button onClick={() => setNoteAtIdx(null)} className="text-xs text-gray-400 px-1.5 cursor-pointer"><i className="fa-solid fa-xmark" /></button>
                                    </div>
                                )}
                                {(notesBySegIdx[i] || []).map(n => (
                                    <div key={n.id} className="ml-14 my-1 flex items-start gap-2 bg-purple-50 dark:bg-purple-900/20 border-l-2 border-purple-400 rounded-r-lg px-2.5 py-1.5">
                                        <button onClick={() => seekTo(n.sec)} className="shrink-0 text-[10px] font-mono text-purple-500 hover:underline cursor-pointer mt-0.5">{fmtSec(n.sec)}</button>
                                        {editingNoteId === n.id ? (
                                            <div className="flex-1 flex gap-1.5">
                                                <input
                                                    autoFocus
                                                    value={editDraft}
                                                    onChange={e => setEditDraft(e.target.value)}
                                                    onKeyDown={e => { if (e.key === "Enter") saveEditNote(n); if (e.key === "Escape") setEditingNoteId(null); }}
                                                    className="flex-1 text-xs rounded border border-purple-300 dark:border-purple-700 bg-transparent px-2 py-1 dark:text-white focus:outline-none"
                                                />
                                                <button onClick={() => saveEditNote(n)} className="text-[10px] text-purple-500 cursor-pointer"><i className="fa-solid fa-check" /></button>
                                            </div>
                                        ) : (
                                            <p className="flex-1 text-xs dark:text-gray-200 leading-relaxed">{n.content}</p>
                                        )}
                                        <button onClick={() => { setEditingNoteId(n.id); setEditDraft(n.content); }} className="shrink-0 text-gray-300 hover:text-purple-500 text-[10px] cursor-pointer mt-0.5"><i className="fa-solid fa-pen" /></button>
                                        <button onClick={() => removeNote(n.id)} className="shrink-0 text-gray-300 hover:text-red-400 text-[10px] cursor-pointer mt-0.5"><i className="fa-solid fa-trash-can" /></button>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
