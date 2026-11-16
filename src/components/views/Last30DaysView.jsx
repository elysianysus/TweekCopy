import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { useSearchParams } from 'react-router-dom';
import { getStoredToken } from '../../scripts/api.js';

function authedFetch(url, options = {}) {
    const token = getStoredToken();
    return fetch(url, {
        credentials: 'include',
        ...options,
        headers: {
            ...(options.body && !(options.headers || {})['Content-Type'] ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {}),
        },
    });
}

const SOURCES = [
    { key: 'reddit', label: 'Reddit', requiresKey: null },
    { key: 'hn', label: 'Hacker News', requiresKey: null },
    { key: 'github', label: 'GitHub', requiresKey: null },
    { key: 'youtube', label: 'YouTube', requiresKey: 'OPENROUTER_API_KEY' },
    { key: 'x', label: 'X / Twitter', requiresKey: 'SCRAPECREATORS_API_KEY' },
    { key: 'tiktok', label: 'TikTok', requiresKey: 'SCRAPECREATORS_API_KEY' },
    { key: 'polymarket', label: 'Polymarket', requiresKey: null },
    { key: 'web', label: 'Web', requiresKey: null },
];

const TERMINAL = new Set(['succeeded', 'failed']);

function sanitizeBriefHtml(html) {
    return DOMPurify.sanitize(html || '', {
        ALLOWED_TAGS: [
            'h1','h2','h3','h4','h5','h6','p','br','hr','div','span','a','strong','b','em','i','u','s','del',
            'ul','ol','li','blockquote','pre','code','table','thead','tbody','tr','th','td',
            'img','figure','figcaption','sub','sup','mark','details','summary','abbr','small',
            'section','article','header','footer','nav','main','aside',
        ],
        ALLOWED_ATTR: ['href','src','alt','title','class','style','target','rel','width','height','colspan','rowspan','id','scope'],
        ALLOW_DATA_ATTR: false,
    });
}

function formatTime(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        return d.toLocaleString();
    } catch { return ''; }
}

function StatusPill({ status }) {
    const map = {
        queued:    { label: 'Queued',    cls: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
        running:   { label: 'Running…',  cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
        succeeded: { label: 'Done',      cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
        failed:    { label: 'Failed',    cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
    };
    const m = map[status] || map.queued;
    return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${m.cls}`}>{m.label}</span>;
}

export default function Last30DaysView() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [topic, setTopic] = useState('');
    const [selectedSources, setSelectedSources] = useState(() => new Set(['reddit', 'hn', 'github']));
    const [history, setHistory] = useState([]);
    const [activeRun, setActiveRun] = useState(null); // full payload incl. html
    const [activeId, setActiveId] = useState(null);
    const [loadingHistory, setLoadingHistory] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [showHistory, setShowHistory] = useState(true);
    const [savingMemo, setSavingMemo] = useState(false);
    const [savedMemoId, setSavedMemoId] = useState(null);
    const [copyState, setCopyState] = useState('idle');
    const [subscriptions, setSubscriptions] = useState([]);
    const [subBusy, setSubBusy] = useState(false);
    const pollRef = useRef(null);

    const fetchSubscriptions = useCallback(async () => {
        try {
            const res = await authedFetch('/api/last30days/subscriptions');
            if (res.ok) setSubscriptions(await res.json());
        } catch { /* non-fatal */ }
    }, []);

    useEffect(() => { fetchSubscriptions(); }, [fetchSubscriptions]);

    const activeSubscription = activeRun
        ? subscriptions.find(s => s.enabled && s.topic === activeRun.topic)
        : null;

    const toggleSubscription = async () => {
        if (!activeRun || subBusy) return;
        setSubBusy(true);
        try {
            if (activeSubscription) {
                await authedFetch(`/api/last30days/subscriptions/${activeSubscription.id}`, { method: 'DELETE' });
            } else {
                const res = await authedFetch('/api/last30days/subscriptions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ topic: activeRun.topic, sources: activeRun.sources || [] }),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    alert(`Could not subscribe: ${err.error || res.status}`);
                }
            }
            await fetchSubscriptions();
        } finally {
            setSubBusy(false);
        }
    };

    const removeSubscription = async (id) => {
        await authedFetch(`/api/last30days/subscriptions/${id}`, { method: 'DELETE' });
        fetchSubscriptions();
    };

    const fetchHistory = useCallback(async () => {
        try {
            const res = await authedFetch('/api/last30days/runs');
            if (res.ok) {
                const data = await res.json();
                setHistory(data);
            }
        } finally {
            setLoadingHistory(false);
        }
    }, []);

    const fetchRun = useCallback(async (id, withHtml = false) => {
        const url = withHtml ? `/api/last30days/runs/${id}?include=html` : `/api/last30days/runs/${id}`;
        const res = await authedFetch(url);
        if (!res.ok) return null;
        return await res.json();
    }, []);

    useEffect(() => { fetchHistory(); }, [fetchHistory]);

    // Load active run if URL has ?runId=
    useEffect(() => {
        const id = searchParams.get('runId');
        if (id && Number(id) !== activeId) {
            setActiveId(Number(id));
        }
    }, [searchParams]);

    // Poll the active run while non-terminal.
    useEffect(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        if (!activeId) {
            setActiveRun(null);
            return;
        }
        let cancelled = false;
        let isTerminal = false;
        const tick = async () => {
            const data = await fetchRun(activeId, isTerminal === false ? false : true);
            if (cancelled || !data) return;
            if (TERMINAL.has(data.status) && data.hasHtml && !data.html) {
                const full = await fetchRun(activeId, true);
                if (cancelled) return;
                setActiveRun(full || data);
                isTerminal = true;
                if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
                fetchHistory();
            } else {
                setActiveRun(data);
                if (TERMINAL.has(data.status)) {
                    isTerminal = true;
                    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
                    fetchHistory();
                }
            }
        };
        tick();
        pollRef.current = setInterval(tick, 3000);
        return () => {
            cancelled = true;
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        };
    }, [activeId, fetchRun, fetchHistory]);

    const toggleSource = (key) => {
        setSelectedSources(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    const submitRun = async (overrideTopic, overrideSources) => {
        const t = (overrideTopic ?? topic).trim();
        if (!t) return;
        setSubmitting(true);
        setSavedMemoId(null);
        try {
            const sources = overrideSources ?? Array.from(selectedSources);
            const res = await authedFetch('/api/last30days/runs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic: t, sources }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                alert(`Failed to start: ${err.error || res.status}`);
                return;
            }
            const created = await res.json();
            setActiveId(created.id);
            setSearchParams(prev => { prev.set('view', 'last30days'); prev.set('runId', String(created.id)); return prev; });
            fetchHistory();
        } finally {
            setSubmitting(false);
        }
    };

    const retry = () => {
        if (!activeRun) return;
        submitRun(activeRun.topic, activeRun.sources);
    };

    const copyBrief = async () => {
        if (!activeRun?.html) return;
        try {
            await navigator.clipboard.writeText(activeRun.html);
            setCopyState('copied');
            setTimeout(() => setCopyState('idle'), 1600);
        } catch { setCopyState('idle'); }
    };

    const downloadBrief = async () => {
        if (!activeRun || activeRun.status !== 'succeeded') return;
        // Pull the *raw* engine-produced HTML straight from disk (not the
        // server-sanitized payload we render in the iframe).
        try {
            const res = await authedFetch(`/api/last30days/runs/${activeRun.id}/raw`);
            if (!res.ok) {
                alert(`Download failed: ${res.status}`);
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const slug = (activeRun.topic || 'brief').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brief';
            a.download = `last30days-${slug}.html`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            alert(`Download failed: ${e.message}`);
        }
    };

    const saveAsMemo = async () => {
        if (!activeRun || activeRun.status !== 'succeeded') return;
        setSavingMemo(true);
        try {
            const res = await authedFetch(`/api/last30days/runs/${activeRun.id}/save-as-memo`, { method: 'POST' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                alert(`Could not save memo: ${err.error || res.status}`);
                return;
            }
            const data = await res.json();
            setSavedMemoId(data.memoId);
        } finally {
            setSavingMemo(false);
        }
    };

    const deleteRun = async (id) => {
        if (!confirm('Delete this research run?')) return;
        const res = await authedFetch(`/api/last30days/runs/${id}`, { method: 'DELETE' });
        if (res.ok) {
            if (activeId === id) {
                setActiveId(null);
                setActiveRun(null);
                setSearchParams(prev => { prev.delete('runId'); return prev; });
            }
            fetchHistory();
        }
    };

    const openRun = (id) => {
        setActiveId(id);
        setSavedMemoId(null);
        setSearchParams(prev => { prev.set('view', 'last30days'); prev.set('runId', String(id)); return prev; });
    };

    const safeHtml = useMemo(() => {
        if (!activeRun?.html) return '';
        return sanitizeBriefHtml(activeRun.html);
    }, [activeRun?.html]);

    return (
        <div className="max-w-3xl mx-auto px-3 sm:px-4 pb-24 lg:pb-8">
            <div className="sticky top-0 z-20 -mx-3 sm:-mx-4 px-3 sm:px-4 py-3 bg-white/85 dark:bg-black/85 backdrop-blur-md border-b border-gray-200/70 dark:border-gray-800/70">
                <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <i className="fa-solid fa-newspaper text-indigo-500" />
                    Last 30 Days
                </h1>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Research what people are saying about a topic across Reddit, HN, GitHub, X, YouTube, TikTok, Polymarket and the web.
                </p>
            </div>

            <div className="mt-4 rounded-2xl border border-gray-200 dark:border-gray-800 p-3 bg-white dark:bg-gray-950">
                <textarea
                    value={topic}
                    onChange={e => setTopic(e.target.value)}
                    rows={2}
                    maxLength={280}
                    placeholder="e.g. nvidia earnings reaction, claude opus 4.7, eink tablets…"
                    className="w-full resize-none rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {SOURCES.map(s => {
                        const active = selectedSources.has(s.key);
                        return (
                            <button
                                key={s.key}
                                onClick={() => toggleSource(s.key)}
                                className={`text-[11px] px-2 py-1 rounded-full border transition ${
                                    active
                                        ? 'bg-indigo-600 text-white border-indigo-600'
                                        : 'bg-transparent text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800'
                                }`}
                                title={s.requiresKey ? `Needs ${s.requiresKey}` : 'No API key required'}
                            >
                                {s.label}{s.requiresKey && active ? ' 🔑' : ''}
                            </button>
                        );
                    })}
                </div>
                {(() => {
                    const keyed = SOURCES.filter(s => s.requiresKey && selectedSources.has(s.key));
                    if (keyed.length === 0) return null;
                    return (
                        <div className="mt-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-2.5 py-2 text-[11px] text-amber-800 dark:text-amber-200">
                            <div className="font-medium flex items-center gap-1">
                                <i className="fa-solid fa-key" />
                                Configure key{keyed.length > 1 ? 's' : ''} to enable
                            </div>
                            <ul className="mt-1 space-y-0.5 list-disc pl-4">
                                {keyed.map(s => (
                                    <li key={s.key}>
                                        <span className="font-medium">{s.label}</span> needs{' '}
                                        <code className="px-1 bg-amber-100 dark:bg-amber-900/40 rounded">{s.requiresKey}</code>{' '}
                                        — add it in Replit Secrets, then re-run. Without it this source is silently skipped.
                                    </li>
                                ))}
                            </ul>
                        </div>
                    );
                })()}
                <div className="mt-2 flex items-center justify-end gap-2">
                    <span className="text-[11px] text-gray-400">{topic.length}/280</span>
                    <button
                        onClick={() => submitRun()}
                        disabled={!topic.trim() || submitting}
                        className="px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white disabled:opacity-50 hover:bg-indigo-700"
                    >
                        {submitting ? 'Starting…' : 'Run research'}
                    </button>
                </div>
            </div>

            {activeRun && (
                <div className="mt-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                            <StatusPill status={activeRun.status} />
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{activeRun.topic}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            {activeRun.status === 'failed' && (
                                <button onClick={retry} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700">
                                    <i className="fa-solid fa-rotate-right mr-1" />Retry
                                </button>
                            )}
                            {activeRun.status === 'succeeded' && (
                                <>
                                    <button
                                        onClick={toggleSubscription}
                                        disabled={subBusy}
                                        className={`text-xs px-2 py-1 rounded disabled:opacity-50 ${
                                            activeSubscription
                                                ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60'
                                                : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
                                        }`}
                                        title={activeSubscription ? '已訂閱:每星期自動 re-run。撳一下取消。' : '每星期自動 re-run 呢個 topic'}
                                    >
                                        <i className={`fa-solid ${activeSubscription ? 'fa-bell' : 'fa-arrows-rotate'} mr-1`} />
                                        {subBusy ? '…' : activeSubscription ? '每週更新 ✓' : '每週更新'}
                                    </button>
                                    <button onClick={copyBrief} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700">
                                        <i className="fa-solid fa-copy mr-1" />{copyState === 'copied' ? 'Copied' : 'Copy'}
                                    </button>
                                    <button onClick={downloadBrief} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700">
                                        <i className="fa-solid fa-download mr-1" />HTML
                                    </button>
                                    <button onClick={saveAsMemo} disabled={savingMemo} className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                                        <i className="fa-solid fa-note-sticky mr-1" />
                                        {savedMemoId ? 'Saved ✓' : (savingMemo ? 'Saving…' : 'Save as memo')}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {activeRun.status === 'failed' && (
                        <div className="px-3 py-3 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-b border-red-100 dark:border-red-900/40">
                            <div className="font-medium">{activeRun.errorMessage || 'Engine failed.'}</div>
                            {activeRun.missingKey && (
                                <div className="mt-1 text-xs">
                                    Missing required key <code className="px-1 bg-red-100 dark:bg-red-900/40 rounded">{activeRun.missingKey}</code>. Add it via Replit Secrets and try again.
                                </div>
                            )}
                        </div>
                    )}

                    {!TERMINAL.has(activeRun.status) && (
                        <div className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                            <i className="fa-solid fa-circle-notch fa-spin mr-1" />
                            {activeRun.status === 'running' ? 'Engine is researching…' : 'Queued — starting shortly…'}
                        </div>
                    )}

                    {activeRun.status === 'succeeded' && safeHtml && (
                        <div
                            className="last30days-panel px-3 py-3 prose prose-sm max-w-none dark:prose-invert [&_a]:text-indigo-600 dark:[&_a]:text-indigo-400 [&_table]:text-xs [&_pre]:text-xs [&_pre]:bg-gray-100 dark:[&_pre]:bg-gray-900 [&_pre]:p-2 [&_pre]:rounded [&_code]:bg-gray-100 dark:[&_code]:bg-gray-900 [&_code]:px-1 [&_code]:rounded"
                            dangerouslySetInnerHTML={{ __html: safeHtml }}
                        />
                    )}

                    {savedMemoId && (
                        <div className="px-3 py-2 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-t border-green-100 dark:border-green-900/40">
                            Saved as memo. <a href={`?view=memo&memoId=${savedMemoId}`} className="underline">Open memo</a>
                        </div>
                    )}
                </div>
            )}

            {subscriptions.length > 0 && (
                <div className="mt-6">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        <i className="fa-solid fa-arrows-rotate" />
                        自動更新 (每星期)
                    </div>
                    <div className="mt-2 space-y-1">
                        {subscriptions.map(sub => (
                            <div key={sub.id} className="group flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 text-sm">
                                <div className="min-w-0">
                                    <div className="truncate text-gray-900 dark:text-gray-100">{sub.topic}</div>
                                    <div className="text-[11px] text-gray-400">
                                        {sub.lastEnqueuedAt ? `上次更新:${formatTime(sub.lastEnqueuedAt)}` : '未開始'}
                                    </div>
                                </div>
                                <button
                                    onClick={() => removeSubscription(sub.id)}
                                    className="shrink-0 text-xs px-2 py-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                    title="取消自動更新"
                                >
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="mt-6">
                <button
                    onClick={() => setShowHistory(v => !v)}
                    className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                >
                    <i className={`fa-solid fa-chevron-${showHistory ? 'down' : 'right'}`} />
                    Past runs ({history.length})
                </button>
                {showHistory && (
                    <div className="mt-2 space-y-1">
                        {loadingHistory && <div className="text-xs text-gray-400">Loading…</div>}
                        {!loadingHistory && history.length === 0 && (
                            <div className="text-xs text-gray-400">No runs yet.</div>
                        )}
                        {history.map(run => (
                            <div
                                key={run.id}
                                className={`group flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition ${
                                    activeId === run.id
                                        ? 'border-indigo-300 bg-indigo-50/60 dark:border-indigo-700 dark:bg-indigo-900/20'
                                        : 'border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900'
                                }`}
                                onClick={() => openRun(run.id)}
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <StatusPill status={run.status} />
                                        <span className="truncate text-gray-900 dark:text-gray-100">{run.topic}</span>
                                    </div>
                                    <div className="text-[11px] text-gray-400 mt-0.5">{formatTime(run.createdAt)}</div>
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); deleteRun(run.id); }}
                                    className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-red-500 px-2 py-1"
                                    title="Delete"
                                >
                                    <i className="fa-solid fa-trash" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
