import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getJournalEntries, getJournalDates, createJournalEntry, deleteJournalEntry, getJournalStuckSteps, createTask, getCurrentUser, updateUserData } from '../../scripts/api.js';

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const today = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const cur = new Date(dt); cur.setHours(0,0,0,0);
    if (cur.getTime() === today.getTime()) return 'Today';
    if (cur.getTime() === yesterday.getTime()) return 'Yesterday';
    return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(createdAt) {
    const d = new Date(createdAt);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const SOURCE_META = {
    manual: { icon: '✍️', label: '' },
    line: { icon: '💬', label: 'LINE' },
    'task-transition': { icon: '✅', label: 'after task' },
    'stuck-step': { icon: '🪜', label: 'tiniest step' },
};

export default function JournalView() {
    const [searchParams, setSearchParams] = useSearchParams();
    const initialDate = searchParams.get('jdate') || todayStr();
    const [date, setDate] = useState(initialDate);
    const [entries, setEntries] = useState([]);
    const [text, setText] = useState('');
    const [saving, setSaving] = useState(false);
    const [stuckOpen, setStuckOpen] = useState(false);
    const [dates, setDates] = useState([]);
    const [user, setUser] = useState(null);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    const isToday = date === todayStr();

    const fetchEntries = useCallback(async (d) => {
        try {
            const rows = await getJournalEntries(d);
            setEntries(rows);
        } catch (e) { console.error(e); }
    }, []);

    useEffect(() => { fetchEntries(date); }, [date, fetchEntries]);
    useEffect(() => {
        getJournalDates().then(setDates).catch(() => {});
        getCurrentUser().then(setUser).catch(() => {});
    }, []);

    useEffect(() => {
        const focusInput = () => {
            if (inputRef.current) {
                setDate(todayStr());
                setTimeout(() => inputRef.current?.focus(), 50);
            }
        };
        window.addEventListener('journal:focusInput', focusInput);
        return () => window.removeEventListener('journal:focusInput', focusInput);
    }, []);

    useEffect(() => {
        if (listRef.current && isToday) {
            listRef.current.scrollTop = listRef.current.scrollHeight;
        }
    }, [entries.length, isToday]);

    async function submit(e) {
        e?.preventDefault();
        const trimmed = text.trim();
        if (!trimmed || saving) return;
        setSaving(true);
        try {
            const entry = await createJournalEntry(trimmed, 'manual', isToday ? undefined : date);
            setEntries(prev => [...prev, entry]);
            setText('');
            if (!dates.includes(entry.date)) setDates(prev => [entry.date, ...prev]);
        } catch (e) { console.error(e); }
        setSaving(false);
    }

    async function handleDelete(id) {
        if (!confirm('Delete this entry?')) return;
        try {
            await deleteJournalEntry(id);
            setEntries(prev => prev.filter(e => e.id !== id));
        } catch (e) { console.error(e); }
    }

    function changeDate(newDate) {
        setDate(newDate);
        setSearchParams(prev => {
            if (newDate === todayStr()) prev.delete('jdate');
            else prev.set('jdate', newDate);
            return prev;
        }, { replace: true });
    }

    function shiftDate(days) {
        const [y, m, d] = date.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        dt.setDate(dt.getDate() + days);
        changeDate(`${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`);
    }

    async function toggleNudge() {
        if (!user) return;
        const next = !user.journalNudgeEnabled;
        setUser({ ...user, journalNudgeEnabled: next });
        try {
            await updateUserData({ journalNudgeEnabled: next });
        } catch (e) { console.error(e); }
    }

    return (
        <div className="w-full padding-x pt-4 max-lg:mt-12 pb-24 lg:pb-8 dark:bg-black dark:text-white min-h-screen flex flex-col">
            <div className="flex items-end justify-between gap-3 mb-3">
                <div>
                    <h2 className="text-3xl font-black leading-none tracking-tight">Journal</h2>
                    <p className="text-xs text-gray-500 mt-1">One line, one tap. Narrate the day.</p>
                </div>
                <button
                    onClick={toggleNudge}
                    title="Nudge me after I finish a task"
                    className={`text-[10px] px-2 py-1 rounded-full border transition ${user?.journalNudgeEnabled ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300' : 'border-gray-300 dark:border-gray-700 text-gray-400'}`}
                >
                    <i className="fa-solid fa-bell mr-1" />
                    {user?.journalNudgeEnabled ? 'Nudge on' : 'Nudge off'}
                </button>
            </div>

            <form onSubmit={submit} className="sticky top-0 z-10 -mx-4 px-4 pb-3 pt-1 bg-white/90 dark:bg-black/90 backdrop-blur-md">
                <div className="flex gap-2 items-stretch">
                    <input
                        ref={inputRef}
                        type="text"
                        value={text}
                        onChange={e => setText(e.target.value)}
                        placeholder={isToday ? 'What are you doing right now?' : `Add to ${formatDate(date)}…`}
                        className="flex-1 px-4 py-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-base focus:outline-none focus:border-blue-400 placeholder:text-gray-400"
                        autoFocus
                    />
                    <button
                        type="button"
                        onClick={() => setStuckOpen(true)}
                        className="px-3 py-3 rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-sm font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/50"
                        title="Get the tiniest next step"
                    >
                        <i className="fa-solid fa-life-ring" /> <span className="hidden sm:inline">Stuck?</span>
                    </button>
                    <button
                        type="submit"
                        disabled={!text.trim() || saving}
                        className="px-4 py-3 rounded-2xl bg-blue-500 text-white text-sm font-semibold disabled:opacity-40 hover:bg-blue-600"
                    >
                        {saving ? '…' : 'Save'}
                    </button>
                </div>
                <div className="flex items-center gap-2 mt-2 overflow-x-auto">
                    <button onClick={() => shiftDate(-1)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-sm px-1"><i className="fa-solid fa-chevron-left" /></button>
                    <button
                        onClick={() => changeDate(todayStr())}
                        className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${isToday ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}
                    >
                        {formatDate(date)} · {entries.length}
                    </button>
                    <button onClick={() => shiftDate(1)} disabled={isToday} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-sm px-1 disabled:opacity-30"><i className="fa-solid fa-chevron-right" /></button>
                    <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />
                    {dates.slice(0, 8).map(d => (
                        <button
                            key={d}
                            onClick={() => changeDate(d)}
                            className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap transition ${d === date ? 'bg-gray-900 dark:bg-white text-white dark:text-black' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                        >
                            {formatDate(d)}
                        </button>
                    ))}
                </div>
            </form>

            <div ref={listRef} className="flex-1 overflow-y-auto -mx-2 px-2">
                {entries.length === 0 ? (
                    <div className="text-center py-16 text-gray-400 text-sm">
                        <i className="fa-solid fa-feather text-3xl mb-3 block opacity-50" />
                        {isToday ? 'No entries yet. Start with what you\'re doing right now.' : 'Nothing logged on this day.'}
                    </div>
                ) : (
                    <ul className="flex flex-col gap-1">
                        {entries.map(entry => {
                            const meta = SOURCE_META[entry.source] || SOURCE_META.manual;
                            return (
                                <li key={entry.id} className="group flex gap-3 items-start py-2 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/50 border-l-2 border-transparent hover:border-blue-300">
                                    <div className="text-[10px] font-mono text-gray-400 pt-1 w-12 flex-shrink-0">{formatTime(entry.createdAt)}</div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm whitespace-pre-wrap break-words text-gray-800 dark:text-gray-100">{entry.body}</p>
                                        {meta.label && <span className="text-[9px] text-gray-400 uppercase tracking-wider">{meta.icon} {meta.label}</span>}
                                    </div>
                                    <button
                                        onClick={() => handleDelete(entry.id)}
                                        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-xs"
                                        title="Delete"
                                    >
                                        <i className="fa-solid fa-trash" />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {stuckOpen && (
                <StuckModal
                    onClose={() => setStuckOpen(false)}
                    onLogged={(entry) => setEntries(prev => [...prev, entry])}
                />
            )}
        </div>
    );
}

function StuckModal({ onClose, onLogged }) {
    const [goal, setGoal] = useState('');
    const [steps, setSteps] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function generate(e) {
        e?.preventDefault();
        if (!goal.trim() || loading) return;
        setLoading(true); setError(''); setSteps([]);
        try {
            const res = await getJournalStuckSteps(goal.trim());
            setSteps(res.steps || []);
        } catch (e) {
            setError('Could not get steps. Try again.');
        }
        setLoading(false);
    }

    async function logStep(step) {
        try {
            const entry = await createJournalEntry(`🪜 ${step}`, 'stuck-step');
            onLogged(entry);
        } catch (e) { console.error(e); }
    }

    async function addAsTask(step) {
        try {
            await createTask({
                name: step,
                date: todayStr(),
                color: 'white text-black dark:text-white dark:bg-black',
            });
            window.dispatchEvent(new Event('tasksChanged'));
        } catch (e) { console.error(e); }
    }

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                    <div>
                        <h3 className="font-bold text-base">🪜 Tiniest next step</h3>
                        <p className="text-[11px] text-gray-500 mt-0.5">Type what you're trying to do. I'll suggest a step you can do in 30 seconds.</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg"><i className="fa-solid fa-xmark" /></button>
                </div>
                <form onSubmit={generate} className="p-4 flex gap-2">
                    <input
                        type="text"
                        value={goal}
                        onChange={e => setGoal(e.target.value)}
                        placeholder="e.g. write the report intro"
                        className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:border-blue-400"
                        autoFocus
                    />
                    <button type="submit" disabled={!goal.trim() || loading} className="px-3 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold disabled:opacity-40">
                        {loading ? '…' : 'Go'}
                    </button>
                </form>
                {error && <div className="px-4 pb-2 text-xs text-red-500">{error}</div>}
                {steps.length > 0 && (
                    <div className="px-4 pb-4 flex flex-col gap-2">
                        {steps.map((step, i) => (
                            <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex flex-col gap-2">
                                <p className="text-sm">{step}</p>
                                <div className="flex gap-2">
                                    <button onClick={() => logStep(step)} className="flex-1 text-xs px-2 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 hover:bg-blue-100">
                                        <i className="fa-solid fa-feather mr-1" /> Log it
                                    </button>
                                    <button onClick={() => addAsTask(step)} className="flex-1 text-xs px-2 py-1.5 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-300 hover:bg-green-100">
                                        <i className="fa-solid fa-plus mr-1" /> Add as task
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
