import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    REFLECTION_PROMPTS,
    REFLECTION_TITLE,
    isReflectionMemo,
    parseReflectionMemo,
    splitReflectionBullets,
} from '../../lib/memoTextTemplates.js';
import { getMemoByDate, getReflectionSummary, sendReflectionSummaryFeedback } from '../../scripts/api.js';
import { formDate, parseFormDate } from '../../scripts/utils.js';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STOPWORDS = new Set([
    'a','an','and','or','but','if','then','than','the','this','that','these','those',
    'is','was','were','are','be','been','being','am','do','does','did','done','doing',
    'have','has','had','having','will','would','should','could','can','may','might','must',
    'i','me','my','mine','myself','we','us','our','ours','you','your','yours','they','them','their','theirs',
    'he','she','it','his','her','its',
    'of','in','on','at','to','for','from','by','with','about','as','into','through','over','under','up','down','out','off',
    'so','too','very','just','also','only','more','most','some','any','no','not','nor','own','same','such','each','few','all',
    'one','two','three','first','second','last','next','today','tomorrow','yesterday','day','week','month','year',
    'go','went','going','get','got','make','made','take','took','give','gave','see','saw','say','said','feel','felt',
    'thing','things','stuff','really','still','again','because','when','while','where','why','how','what','who','which',
    'there','here','now','later','before','after','during','around','off','okay','ok','yes','maybe','like','want','wanted',
    'need','needed','try','tried','keep','let','put','use','used','work','worked',
]);

function tokenize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}'\-\s]/gu, ' ')
        .split(/\s+/)
        .map(w => w.replace(/^[-']+|[-']+$/g, ''))
        .filter(w => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

function summarizePrompt(entries) {
    const wordCounts = new Map();
    const bigramCounts = new Map();
    let totalBullets = 0;
    for (const e of entries) {
        const bullets = splitReflectionBullets(e.text);
        for (const b of bullets) {
            totalBullets += 1;
            const toks = tokenize(b);
            const seen = new Set();
            for (const t of toks) {
                if (!seen.has(t)) {
                    wordCounts.set(t, (wordCounts.get(t) || 0) + 1);
                    seen.add(t);
                }
            }
            const seenBg = new Set();
            for (let i = 0; i < toks.length - 1; i++) {
                const bg = `${toks[i]} ${toks[i + 1]}`;
                if (!seenBg.has(bg)) {
                    bigramCounts.set(bg, (bigramCounts.get(bg) || 0) + 1);
                    seenBg.add(bg);
                }
            }
        }
    }
    const candidates = [];
    for (const [w, c] of wordCounts) if (c >= 2) candidates.push({ term: w, count: c });
    for (const [bg, c] of bigramCounts) if (c >= 2) candidates.push({ term: bg, count: c + 0.5 });
    candidates.sort((a, b) => b.count - a.count || a.term.length - b.term.length);
    const picked = [];
    const usedWords = new Set();
    for (const cand of candidates) {
        const parts = cand.term.split(' ');
        if (parts.some(p => usedWords.has(p))) continue;
        picked.push({ term: cand.term, count: Math.floor(cand.count) });
        parts.forEach(p => usedWords.add(p));
        if (picked.length >= 5) break;
    }
    return { tags: picked, totalBullets };
}

function tagSizeClass(count, max) {
    if (max <= 1) return 'text-xs';
    const ratio = count / max;
    if (ratio > 0.8) return 'text-sm font-semibold';
    if (ratio > 0.5) return 'text-xs font-semibold';
    return 'text-[11px]';
}

export default function WeeklyReflectionPanel({ dates }) {
    const [, setSearchParams] = useSearchParams();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [answersByDate, setAnswersByDate] = useState({});
    const [summariesByPrompt, setSummariesByPrompt] = useState({});
    const [reactionsByPrompt, setReactionsByPrompt] = useState({});
    const [busyByPrompt, setBusyByPrompt] = useState({});

    const dateStrs = useMemo(() => (dates || []).map(d => formDate(d)), [dates]);
    const dateStrsKey = dateStrs.join('|');

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(true);
        setLoadError(false);
        (async () => {
            const results = {};
            let sawError = false;
            await Promise.all(dateStrs.map(async (ds) => {
                try {
                    const data = await getMemoByDate(ds);
                    const memos = Array.isArray(data) ? data : (data ? [data] : []);
                    const refl = memos.find(m => isReflectionMemo(m.content));
                    if (refl) results[ds] = parseReflectionMemo(refl.content);
                } catch (e) {
                    if (!sawError) console.error('Weekly reflection load failed for', ds, e);
                    sawError = true;
                }
            }));
            if (!cancelled) {
                setAnswersByDate(results);
                setLoadError(sawError);
                setLoading(false);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, dateStrsKey]);

    function jumpToDay(ds) {
        setSearchParams(prev => {
            prev.set('view', 'day');
            prev.set('viewDate', ds);
            prev.delete('weekShift');
            return prev;
        });
    }

    const datesWithAny = dateStrs.filter(ds => {
        const a = answersByDate[ds];
        if (!a) return false;
        return REFLECTION_PROMPTS.some(p => (a[p.id] || '').trim().length > 0);
    });

    const weekStart = dateStrs[0] || '';
    const entriesByPrompt = useMemo(() => {
        const out = {};
        for (const p of REFLECTION_PROMPTS) {
            out[p.id] = datesWithAny
                .map(ds => ({ ds, text: (answersByDate[ds]?.[p.id] || '').trim() }))
                .filter(e => e.text.length > 0);
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [answersByDate, dateStrsKey]);

    const entriesFingerprint = useMemo(() => {
        const lines = [];
        for (const p of REFLECTION_PROMPTS) {
            for (const e of entriesByPrompt[p.id] || []) {
                lines.push(`${p.id}\u0001${e.ds}\u0001${e.text}`);
            }
        }
        return lines.join('\u0002');
    }, [entriesByPrompt]);

    useEffect(() => {
        if (!open || loading || !weekStart) return;
        let cancelled = false;
        const promptsToFetch = REFLECTION_PROMPTS.filter(p => {
            const list = entriesByPrompt[p.id] || [];
            const bulletCount = list.reduce((s, e) => {
                const n = (e.text.match(/^\s*(?:[-*+]|\d+\.)\s+\S/gm) || []).length;
                return s + (n || (e.text.trim() ? 1 : 0));
            }, 0);
            return bulletCount >= 3;
        });
        if (promptsToFetch.length === 0) {
            setSummariesByPrompt({});
            return;
        }
        (async () => {
            const next = {};
            await Promise.all(promptsToFetch.map(async (p) => {
                try {
                    const res = await getReflectionSummary({
                        weekStart,
                        promptId: p.id,
                        promptLabel: p.label,
                        entries: entriesByPrompt[p.id],
                    });
                    if (res?.summary) next[p.id] = res.summary;
                } catch (e) {
                    // Silently degrade — tag cloud still renders.
                }
            }));
            if (!cancelled) {
                setSummariesByPrompt(next);
                setReactionsByPrompt({});
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, loading, weekStart, entriesFingerprint]);

    async function regeneratePrompt(p) {
        setBusyByPrompt(prev => ({ ...prev, [p.id]: true }));
        try {
            const res = await getReflectionSummary({
                weekStart,
                promptId: p.id,
                promptLabel: p.label,
                entries: entriesByPrompt[p.id],
                regenerate: true,
            });
            if (res?.summary) {
                setSummariesByPrompt(prev => ({ ...prev, [p.id]: res.summary }));
                setReactionsByPrompt(prev => ({ ...prev, [p.id]: null }));
            }
        } catch (e) {
            console.error('Theme regenerate failed:', e);
        } finally {
            setBusyByPrompt(prev => ({ ...prev, [p.id]: false }));
        }
    }

    async function reactToPrompt(p, rating) {
        setBusyByPrompt(prev => ({ ...prev, [p.id]: true }));
        try {
            await sendReflectionSummaryFeedback({
                weekStart,
                promptId: p.id,
                entries: entriesByPrompt[p.id],
                rating,
            });
            setReactionsByPrompt(prev => ({ ...prev, [p.id]: rating }));
            if (rating === 'down') {
                // Thumbs-down cleared the cache — fetch a fresh theme.
                const res = await getReflectionSummary({
                    weekStart,
                    promptId: p.id,
                    promptLabel: p.label,
                    entries: entriesByPrompt[p.id],
                });
                if (res?.summary) {
                    setSummariesByPrompt(prev => ({ ...prev, [p.id]: res.summary }));
                    setReactionsByPrompt(prev => ({ ...prev, [p.id]: null }));
                }
            }
        } catch (e) {
            console.error('Theme feedback failed:', e);
        } finally {
            setBusyByPrompt(prev => ({ ...prev, [p.id]: false }));
        }
    }

    return (
        <div className="mt-4 border-t-2 border-gray-300 dark:border-gray-700 pt-4">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="flex items-center gap-2 text-lg font-bold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
                <i className={`fa-solid ${open ? 'fa-chevron-down' : 'fa-chevron-right'} text-xs`} />
                <span>Weekly Reflection</span>
                <span className="text-xs font-normal text-gray-400">{REFLECTION_TITLE}</span>
            </button>

            {open && (
                <div className="mt-3">
                    {loading && (
                        <p className="text-sm text-gray-400 italic">Loading this week's reflections…</p>
                    )}
                    {!loading && datesWithAny.length === 0 && (
                        <p className="text-sm text-gray-400 italic">
                            No reflections logged this week yet.
                        </p>
                    )}
                    {!loading && loadError && (
                        <p className="text-sm text-amber-600 dark:text-amber-400 mb-2">
                            Some days couldn't be loaded — showing what we have.
                        </p>
                    )}
                    {!loading && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                            {REFLECTION_PROMPTS.map(p => {
                                const entries = datesWithAny
                                    .map(ds => ({ ds, text: (answersByDate[ds]?.[p.id] || '').trim() }))
                                    .filter(e => e.text.length > 0);
                                const { tags, totalBullets } = summarizePrompt(entries);
                                const maxCount = tags.reduce((m, t) => Math.max(m, t.count), 0);
                                return (
                                    <div key={p.id} className="border border-gray-200 dark:border-gray-800 rounded-md p-3">
                                        <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-2">
                                            {p.label}
                                        </div>
                                        {entries.length > 0 && summariesByPrompt[p.id] && (
                                            <div className="mb-2 text-sm italic text-gray-600 dark:text-gray-300 leading-snug">
                                                <span className="text-[10px] not-italic uppercase tracking-wider text-gray-400 mr-1 align-middle">Theme</span>
                                                {summariesByPrompt[p.id]}
                                                <span className="not-italic ml-2 inline-flex items-center gap-1 align-middle">
                                                    <button
                                                        type="button"
                                                        disabled={!!busyByPrompt[p.id]}
                                                        onClick={() => reactToPrompt(p, 'up')}
                                                        title="Good theme"
                                                        className={`text-xs px-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 ${reactionsByPrompt[p.id] === 'up' ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}
                                                    >
                                                        <i className="fa-solid fa-thumbs-up" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={!!busyByPrompt[p.id]}
                                                        onClick={() => reactToPrompt(p, 'down')}
                                                        title="Off the mark — try again"
                                                        className="text-xs px-1 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
                                                    >
                                                        <i className="fa-solid fa-thumbs-down" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={!!busyByPrompt[p.id]}
                                                        onClick={() => regeneratePrompt(p)}
                                                        title="Regenerate theme"
                                                        className="text-xs px-1 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
                                                    >
                                                        <i className={`fa-solid fa-rotate ${busyByPrompt[p.id] ? 'fa-spin' : ''}`} />
                                                    </button>
                                                </span>
                                            </div>
                                        )}
                                        {entries.length > 0 && (
                                            <div className="mb-2 pb-2 border-b border-dashed border-gray-200 dark:border-gray-800">
                                                {tags.length > 0 ? (
                                                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                                        <span className="text-[10px] uppercase tracking-wider text-gray-400 mr-1">Themes</span>
                                                        {tags.map(t => (
                                                            <span
                                                                key={t.term}
                                                                className={`${tagSizeClass(t.count, maxCount)} text-blue-700 dark:text-blue-300`}
                                                                title={`Appears in ${t.count} bullet${t.count === 1 ? '' : 's'}`}
                                                            >
                                                                {t.term}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="text-[11px] italic text-gray-400">
                                                        {totalBullets <= 1
                                                            ? 'Add a few more entries to see recurring themes.'
                                                            : 'No repeated themes yet this week.'}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                        {entries.length === 0 ? (
                                            <p className="text-xs italic text-gray-400">No entries this week.</p>
                                        ) : (
                                        <ul className="space-y-2">
                                            {entries.map(({ ds, text }) => {
                                                const d = parseFormDate(ds) || new Date(ds);
                                                const dayLabel = `${WEEKDAY_LABELS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
                                                const bullets = splitReflectionBullets(text);
                                                return (
                                                    <li key={ds}>
                                                        <button
                                                            type="button"
                                                            onClick={() => jumpToDay(ds)}
                                                            className="block w-full text-left group"
                                                            title="Open day view"
                                                        >
                                                            <div className="text-[10px] uppercase tracking-wider text-gray-400 group-hover:text-blue-500">
                                                                {dayLabel}
                                                            </div>
                                                            <ul className="text-sm text-gray-700 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 list-disc list-inside pl-1">
                                                                {bullets.map((b, i) => (
                                                                    <li key={i} className="whitespace-pre-wrap break-words">{b}</li>
                                                                ))}
                                                            </ul>
                                                        </button>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
