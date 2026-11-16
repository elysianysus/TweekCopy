import React, { useEffect, useState, useCallback, useRef } from "react";
import {
    getPodcastShows,
    addPodcastShow,
    addPodcastVideo,
    getAllPodcastNotes,
    refreshPodcastShow,
    deletePodcastShow,
    getPodcastEpisodes,
    updatePodcastEpisode,
    memorizePodcastEpisode,
} from "../../scripts/api.js";
import PodcastEpisodeDetail from "./PodcastEpisodeDetail.jsx";

function fmtSec(sec) {
    if (sec == null) return "";
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

function formatDate(d) {
    if (!d) return "";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "";
    return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function PodcastView() {
    const [shows, setShows] = useState([]);
    const [activeShowId, setActiveShowId] = useState(null);
    const [episodes, setEpisodes] = useState([]);
    const [loadingEpisodes, setLoadingEpisodes] = useState(false);
    const [channelInput, setChannelInput] = useState("");
    const [adding, setAdding] = useState(false);
    const [videoInput, setVideoInput] = useState("");
    const [addingVideo, setAddingVideo] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState("");
    const [openNotesId, setOpenNotesId] = useState(null);
    const [notesDraft, setNotesDraft] = useState("");
    const [savingNotes, setSavingNotes] = useState(false);
    const notesSavedTimer = useRef(null);
    const [notesSaved, setNotesSaved] = useState(false);
    const [memorizingIds, setMemorizingIds] = useState(new Set());
    const [memorizedMsg, setMemorizedMsg] = useState({});
    const [detailEpisode, setDetailEpisode] = useState(null);
    const [showAllNotes, setShowAllNotes] = useState(false);
    const [allNotes, setAllNotes] = useState(null);
    const [loadingAllNotes, setLoadingAllNotes] = useState(false);

    const loadShows = useCallback(async () => {
        try {
            const rows = await getPodcastShows();
            setShows(rows);
            if (rows.length && !rows.some(s => s.id === activeShowId)) {
                setActiveShowId(rows[0].id);
            }
            if (!rows.length) setActiveShowId(null);
        } catch (e) {
            setError(e.message);
        }
    }, [activeShowId]);

    useEffect(() => { loadShows(); /* eslint-disable-next-line */ }, []);

    const loadEpisodes = useCallback(async (showId) => {
        if (!showId) { setEpisodes([]); return; }
        setLoadingEpisodes(true);
        try {
            setEpisodes(await getPodcastEpisodes(showId));
        } catch (e) {
            setError(e.message);
        } finally {
            setLoadingEpisodes(false);
        }
    }, []);

    useEffect(() => { loadEpisodes(activeShowId); }, [activeShowId, loadEpisodes]);

    async function handleAdd(e) {
        e.preventDefault();
        const channel = channelInput.trim();
        if (!channel || adding) return;
        setAdding(true);
        setError("");
        try {
            const res = await addPodcastShow(channel);
            setChannelInput("");
            await loadShows();
            if (res?.show?.id) setActiveShowId(res.show.id);
        } catch (e2) {
            setError(e2.message);
        } finally {
            setAdding(false);
        }
    }

    async function handleAddVideo(e) {
        e.preventDefault();
        const url = videoInput.trim();
        if (!url || addingVideo) return;
        setAddingVideo(true);
        setError("");
        try {
            const res = await addPodcastVideo(url);
            setVideoInput("");
            await loadShows();
            if (res?.show?.id) {
                setActiveShowId(res.show.id);
                await loadEpisodes(res.show.id);
            }
            if (res?.episode) setDetailEpisode(res.episode);
        } catch (e2) {
            setError(e2.message);
        } finally {
            setAddingVideo(false);
        }
    }

    async function openAllNotes() {
        setDetailEpisode(null);
        setShowAllNotes(true);
        setLoadingAllNotes(true);
        setError("");
        try {
            setAllNotes(await getAllPodcastNotes());
        } catch (e) {
            setError(e.message);
        } finally {
            setLoadingAllNotes(false);
        }
    }

    async function handleRefresh() {
        if (!activeShowId || refreshing) return;
        setRefreshing(true);
        setError("");
        try {
            await refreshPodcastShow(activeShowId);
            await Promise.all([loadShows(), loadEpisodes(activeShowId)]);
        } catch (e) {
            setError(e.message);
        } finally {
            setRefreshing(false);
        }
    }

    async function handleDeleteShow(showId, e) {
        e.stopPropagation();
        if (!confirm("Unsubscribe from this show? Episode notes will be deleted too.")) return;
        try {
            await deletePodcastShow(showId);
            if (activeShowId === showId) setActiveShowId(null);
            if (detailEpisode && detailEpisode.showId === showId) setDetailEpisode(null);
            await loadShows();
        } catch (e2) {
            setError(e2.message);
        }
    }

    async function toggleListened(ep) {
        const next = !ep.listened;
        setEpisodes(prev => prev.map(x => x.id === ep.id ? { ...x, listened: next } : x));
        try {
            await updatePodcastEpisode(ep.id, { listened: next });
            loadShows();
        } catch (e) {
            setEpisodes(prev => prev.map(x => x.id === ep.id ? { ...x, listened: !next } : x));
            setError(e.message);
        }
    }

    function openNotes(ep) {
        if (openNotesId === ep.id) { setOpenNotesId(null); return; }
        setOpenNotesId(ep.id);
        setNotesDraft(ep.notes || "");
        setNotesSaved(false);
    }

    async function saveNotes(ep) {
        if (savingNotes) return;
        setSavingNotes(true);
        try {
            const row = await updatePodcastEpisode(ep.id, { notes: notesDraft });
            setEpisodes(prev => prev.map(x => x.id === ep.id ? { ...x, notes: row.notes } : x));
            setNotesSaved(true);
            clearTimeout(notesSavedTimer.current);
            notesSavedTimer.current = setTimeout(() => setNotesSaved(false), 2000);
        } catch (e) {
            setError(e.message);
        } finally {
            setSavingNotes(false);
        }
    }

    async function handleMemorize(ep) {
        if (memorizingIds.has(ep.id)) return;
        setMemorizingIds(prev => new Set(prev).add(ep.id));
        setError("");
        try {
            const res = await memorizePodcastEpisode(ep.id);
            setMemorizedMsg(prev => ({ ...prev, [ep.id]: res.duplicate ? "Muse 已經記得呢集" : "已存入 Muse 記憶 ✓" }));
            setTimeout(() => setMemorizedMsg(prev => { const n = { ...prev }; delete n[ep.id]; return n; }), 3000);
        } catch (e) {
            setError(e.message);
        } finally {
            setMemorizingIds(prev => { const n = new Set(prev); n.delete(ep.id); return n; });
        }
    }

    const activeShow = shows.find(s => s.id === activeShowId);

    return (
        <div className="flex h-[calc(100dvh-4rem)] bg-white dark:bg-black">
            {/* Shows sidebar */}
            <div className="w-64 shrink-0 border-r border-gray-100 dark:border-gray-800 flex flex-col">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                    <h2 className="text-sm font-semibold dark:text-white flex items-center gap-2">
                        <i className="fa-solid fa-podcast text-purple-500" /> Podcasts
                    </h2>
                    <form onSubmit={handleAdd} className="mt-2 flex gap-1.5">
                        <input
                            value={channelInput}
                            onChange={e => setChannelInput(e.target.value)}
                            placeholder="@handle or channel URL"
                            className="flex-1 min-w-0 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-purple-400"
                        />
                        <button
                            type="submit"
                            disabled={!channelInput.trim() || adding}
                            className="text-xs bg-black dark:bg-white text-white dark:text-black rounded-lg px-2.5 py-1.5 disabled:opacity-40 cursor-pointer"
                            title="Subscribe"
                        >
                            {adding ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-plus" />}
                        </button>
                    </form>
                    <button
                        onClick={openAllNotes}
                        className={`mt-1.5 w-full text-left text-xs rounded-lg px-2 py-1.5 cursor-pointer transition flex items-center gap-2 ${
                            showAllNotes ? "bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300" : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900"
                        }`}
                    >
                        <i className="fa-solid fa-note-sticky text-purple-400" /> 我嘅所有筆記
                    </button>
                    <form onSubmit={handleAddVideo} className="mt-1.5 flex gap-1.5">
                        <input
                            value={videoInput}
                            onChange={e => setVideoInput(e.target.value)}
                            placeholder="Paste a video link…"
                            className="flex-1 min-w-0 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-purple-400"
                        />
                        <button
                            type="submit"
                            disabled={!videoInput.trim() || addingVideo}
                            className="text-xs bg-purple-500 text-white rounded-lg px-2.5 py-1.5 disabled:opacity-40 cursor-pointer"
                            title="Open notebook for a single video"
                        >
                            {addingVideo ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-film" />}
                        </button>
                    </form>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {shows.length === 0 && (
                        <p className="text-xs text-gray-400 px-4 py-6 text-center leading-relaxed">
                            No shows yet.<br />Paste a YouTube channel URL or @handle above to start your podcast notebook.
                        </p>
                    )}
                    {shows.map(s => (
                        <div
                            key={s.id}
                            onClick={() => { setActiveShowId(s.id); setShowAllNotes(false); setDetailEpisode(null); }}
                            className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer text-xs group hover:bg-gray-50 dark:hover:bg-gray-900 ${
                                activeShowId === s.id ? "bg-gray-100 dark:bg-gray-900" : ""
                            }`}
                        >
                            <div className="flex-1 min-w-0">
                                <div className="truncate font-medium dark:text-gray-200">{s.title || s.channelId || "Untitled show"}</div>
                                <div className="text-[10px] text-gray-400">
                                    {s.listenedCount}/{s.episodeCount} listened
                                </div>
                            </div>
                            <button
                                onClick={(e) => handleDeleteShow(s.id, e)}
                                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition"
                                title="Unsubscribe"
                            >
                                <i className="fa-solid fa-trash-can" />
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Episodes */}
            <div className="flex-1 min-w-0 flex flex-col">
                {detailEpisode ? (
                    <PodcastEpisodeDetail
                        episode={detailEpisode}
                        onBack={() => { setDetailEpisode(null); if (showAllNotes) openAllNotes(); }}
                        onEpisodeChanged={(updated) => {
                            setDetailEpisode(updated);
                            setEpisodes(prev => prev.map(x => x.id === updated.id ? updated : x));
                        }}
                    />
                ) : showAllNotes ? (
                    <div className="flex-1 overflow-y-auto">
                        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                            <h3 className="text-sm font-semibold dark:text-white flex items-center gap-2">
                                <i className="fa-solid fa-note-sticky text-purple-400" /> 我嘅所有筆記
                            </h3>
                            <button onClick={() => setShowAllNotes(false)} className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer">
                                <i className="fa-solid fa-xmark" /> 關閉
                            </button>
                        </div>
                        {error && (
                            <div className="m-3 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{error}</div>
                        )}
                        {loadingAllNotes && (
                            <p className="text-xs text-gray-400 px-5 py-6"><i className="fa-solid fa-spinner fa-spin mr-1.5" />Loading notes…</p>
                        )}
                        {!loadingAllNotes && allNotes && allNotes.length === 0 && (
                            <p className="text-xs text-gray-400 px-5 py-8 text-center leading-relaxed">
                                仲未有筆記。<br />入去任何一集,喺字幕度撳「+note」或者寫低整體筆記啦!
                            </p>
                        )}
                        {!loadingAllNotes && (allNotes || []).map(({ episode: ep, overallNotes, timedNotes }) => (
                            <div key={ep.id} className="px-5 py-4 border-b border-gray-50 dark:border-gray-900">
                                <div className="flex items-start gap-3">
                                    {ep.thumbnail && (
                                        <img src={ep.thumbnail} alt="" className="w-20 h-12 rounded object-cover shrink-0 hidden sm:block cursor-pointer" loading="lazy" onClick={() => setDetailEpisode(ep)} />
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <button
                                            onClick={() => setDetailEpisode(ep)}
                                            className="text-xs font-semibold dark:text-gray-200 hover:text-purple-500 text-left cursor-pointer"
                                        >
                                            {ep.title || ep.videoId}
                                        </button>
                                        <div className="text-[10px] text-gray-400 mt-0.5">{formatDate(ep.publishedAt)}</div>
                                        {overallNotes && (
                                            <div className="mt-2 text-xs dark:text-gray-300 whitespace-pre-wrap bg-gray-50 dark:bg-gray-900 rounded-lg px-3 py-2">
                                                {overallNotes}
                                            </div>
                                        )}
                                        {timedNotes.map(n => (
                                            <div key={n.id} className="mt-1.5 flex items-start gap-2 bg-purple-50 dark:bg-purple-900/20 border-l-2 border-purple-400 rounded-r-lg px-2.5 py-1.5">
                                                <button
                                                    onClick={() => setDetailEpisode(ep)}
                                                    className="shrink-0 text-[10px] font-mono text-purple-500 hover:underline cursor-pointer mt-0.5"
                                                    title="Open episode at this note"
                                                >
                                                    {fmtSec(n.sec)}
                                                </button>
                                                <p className="flex-1 text-xs dark:text-gray-300 whitespace-pre-wrap">{n.content}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                <>
                {error && (
                    <div className="m-3 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 flex items-center justify-between">
                        <span>{error}</span>
                        <button onClick={() => setError("")} className="ml-3 text-red-400 hover:text-red-600"><i className="fa-solid fa-xmark" /></button>
                    </div>
                )}
                {!activeShow ? (
                    <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
                        <div className="text-center">
                            <i className="fa-solid fa-podcast text-3xl mb-3 block text-gray-300 dark:text-gray-700" />
                            Subscribe to a channel to see episodes here.
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-800">
                            <div className="min-w-0">
                                <h3 className="text-sm font-semibold dark:text-white truncate">{activeShow.title || activeShow.channelId}</h3>
                                <a href={activeShow.channelUrl} target="_blank" rel="noreferrer" className="text-[10px] text-gray-400 hover:text-purple-500">
                                    Open channel <i className="fa-solid fa-arrow-up-right-from-square" />
                                </a>
                            </div>
                            <button
                                onClick={handleRefresh}
                                disabled={refreshing}
                                className="text-xs text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer disabled:opacity-50"
                            >
                                <i className={`fa-solid fa-rotate ${refreshing ? "fa-spin" : ""} mr-1.5`} />
                                Check for new
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {loadingEpisodes ? (
                                <p className="text-xs text-gray-400 px-5 py-6">Loading episodes…</p>
                            ) : episodes.length === 0 ? (
                                <p className="text-xs text-gray-400 px-5 py-6">No episodes yet — try "Check for new".</p>
                            ) : (
                                episodes.map(ep => (
                                    <div key={ep.id} className="border-b border-gray-50 dark:border-gray-900">
                                        <div className="flex items-start gap-3 px-5 py-3">
                                            <button
                                                onClick={() => toggleListened(ep)}
                                                title={ep.listened ? "Mark as unlistened" : "Mark as listened"}
                                                className={`mt-0.5 shrink-0 w-5 h-5 rounded-full border flex items-center justify-center text-[10px] transition cursor-pointer ${
                                                    ep.listened
                                                        ? "bg-emerald-500 border-emerald-500 text-white"
                                                        : "border-gray-300 dark:border-gray-600 text-transparent hover:border-emerald-400"
                                                }`}
                                            >
                                                <i className="fa-solid fa-check" />
                                            </button>
                                            {ep.thumbnail && (
                                                <img src={ep.thumbnail} alt="" className="w-20 h-12 rounded object-cover shrink-0 hidden sm:block" loading="lazy" />
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <button
                                                    onClick={() => setDetailEpisode(ep)}
                                                    className={`text-xs font-medium hover:text-purple-500 dark:text-gray-200 block truncate text-left w-full cursor-pointer ${ep.listened ? "text-gray-400 dark:text-gray-500" : ""}`}
                                                    title="Open episode notebook"
                                                >
                                                    {ep.title || ep.videoId}
                                                </button>
                                                <div className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-2">
                                                    <span>{formatDate(ep.publishedAt)}</span>
                                                    {ep.notes && <span className="text-purple-400"><i className="fa-solid fa-note-sticky" /> has notes</span>}
                                                    <a href={ep.url} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-red-500" title="Open on YouTube">
                                                        <i className="fa-brands fa-youtube" />
                                                    </a>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleMemorize(ep)}
                                                disabled={memorizingIds.has(ep.id)}
                                                className="shrink-0 text-xs px-2 py-1 rounded-lg cursor-pointer transition text-gray-400 hover:text-blue-500 disabled:opacity-60"
                                                title="Save notes into Muse memory"
                                            >
                                                <i className={`fa-solid ${memorizingIds.has(ep.id) ? "fa-spinner fa-spin" : "fa-brain"}`} />
                                            </button>
                                            <button
                                                onClick={() => openNotes(ep)}
                                                className={`shrink-0 text-xs px-2 py-1 rounded-lg cursor-pointer transition ${
                                                    openNotesId === ep.id
                                                        ? "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300"
                                                        : "text-gray-400 hover:text-purple-500"
                                                }`}
                                                title="Notes"
                                            >
                                                <i className="fa-solid fa-pen-to-square" />
                                            </button>
                                        </div>
                                        {memorizedMsg[ep.id] && (
                                            <div className="px-5 pb-2 pl-[3.25rem] text-[10px] text-blue-500">{memorizedMsg[ep.id]}</div>
                                        )}
                                        {openNotesId === ep.id && (
                                            <div className="px-5 pb-4 pl-[3.25rem]">
                                                <textarea
                                                    value={notesDraft}
                                                    onChange={e => setNotesDraft(e.target.value)}
                                                    rows={5}
                                                    placeholder="Notes for this episode… (Markdown welcome)"
                                                    className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-purple-400 resize-y"
                                                />
                                                <div className="flex items-center gap-2 mt-1.5">
                                                    <button
                                                        onClick={() => saveNotes(ep)}
                                                        disabled={savingNotes}
                                                        className="text-xs bg-black dark:bg-white text-white dark:text-black px-3 py-1 rounded-lg cursor-pointer disabled:opacity-50"
                                                    >
                                                        {savingNotes ? "Saving…" : "Save notes"}
                                                    </button>
                                                    {notesSaved && <span className="text-[10px] text-emerald-500">Saved ✓</span>}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </>
                )}
                </>
                )}
            </div>
        </div>
    );
}
