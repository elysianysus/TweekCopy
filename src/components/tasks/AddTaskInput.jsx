import React, { useState, useRef, useEffect } from 'react';
import { createTask, tryCatchDecorator } from '../../scripts/api.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { QUADRANTS } from '../../constants/eisenhower.js';
import { repeatLabel } from '../../scripts/utils.js';

const QUADRANT_STYLES = {
    q1: 'bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 border-red-300 dark:border-red-700',
    q2: 'bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-700',
    q3: 'bg-yellow-100 dark:bg-yellow-950 text-yellow-600 dark:text-yellow-500 border-yellow-300 dark:border-yellow-700',
    q4: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600',
};
const QUADRANT_DOT = {
    q1: 'bg-red-400',
    q2: 'bg-blue-400',
    q3: 'bg-yellow-400',
    q4: 'bg-gray-400',
};

const REPEAT_OPTIONS = [
    { value: null, label: 'No repeat' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekdays', label: 'Every weekday (Mon–Fri)' },
    { value: 'weekly', label: 'Weekly (same weekday)' },
    { value: 'monthly', label: 'Monthly (same day)' },
    { value: 'every_n_days', label: 'Every N days' },
];

export default function AddTaskInput({ date, tasksData, onTasksChanged, placeholder = 'Add a task...', showBorder = false, defaultDone = false }) {
    const { currentUser } = useAuth();
    const [name, setName] = useState('');
    const [quadrant, setQuadrant] = useState('q4');
    const [focused, setFocused] = useState(false);
    const [repeatPattern, setRepeatPattern] = useState(null);
    const [repeatInterval, setRepeatInterval] = useState(2);
    const [repeatEndedAt, setRepeatEndedAt] = useState('');
    const [showRepeatPicker, setShowRepeatPicker] = useState(false);
    const inputRef = useRef(null);
    const containerRef = useRef(null);

    useEffect(() => {
        if (focused && inputRef.current) {
            inputRef.current.focus();
        }
    }, [focused]);

    function resetForm() {
        setName('');
        setQuadrant('q4');
        setRepeatPattern(null);
        setRepeatInterval(2);
        setRepeatEndedAt('');
        setShowRepeatPicker(false);
    }

    async function submit() {
        if (!name.trim() || !currentUser) return;
        const payload = {
            name: name.trim(),
            color: 'white text-black dark:text-white dark:bg-black',
            date,
            done: defaultDone,
            order: tasksData.length,
            eisenhowerQuadrant: quadrant || null,
            endDate: date,
            endTime: '24:00',
        };
        if (repeatPattern) {
            payload.repeatPattern = repeatPattern;
            if (repeatPattern === 'every_n_days') {
                payload.repeatInterval = Math.max(1, parseInt(repeatInterval, 10) || 1);
            }
            if (repeatEndedAt) payload.repeatEndedAt = repeatEndedAt;
        }
        await tryCatchDecorator(createTask)(payload);
        resetForm();
        if (onTasksChanged) onTasksChanged();
    }

    function handleKeyDown(ev) {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            submit();
        }
        if (ev.key === 'Escape') {
            resetForm();
            setFocused(false);
            inputRef.current?.blur();
        }
    }

    function handleBlur(ev) {
        if (containerRef.current && containerRef.current.contains(ev.relatedTarget)) return;
        if (showRepeatPicker) return;
        if (name.trim()) submit();
        setFocused(false);
    }

    const selectedQ = quadrant ? QUADRANTS.find(q => q.key === quadrant) : null;
    const repeatSummary = repeatPattern
        ? repeatLabel(repeatPattern, repeatInterval) + (repeatEndedAt ? ` · until ${repeatEndedAt}` : '')
        : '';

    if (!focused) {
        return (
            <div
                className={`add-task w-full py-2 bg-white dark:bg-black cursor-pointer
                    ${showBorder ? 'border-b border-gray-200 dark:border-gray-700' : ''}`}
                onClick={() => setFocused(true)}
            >
                <p className="opacity-0 select-none indent-1.5 text-sm">.</p>
            </div>
        );
    }

    return (
        <div ref={containerRef} className="add-task" onBlur={handleBlur}>
            <div className="relative">
                <input
                    ref={inputRef}
                    type="text"
                    value={name}
                    onChange={ev => setName(ev.target.value)}
                    placeholder={placeholder}
                    className="w-full bg-white dark:bg-black py-2 indent-1.5 pr-16
                        border-b border-gray-300 dark:border-gray-700
                        focus:outline-none focus:px-1.5 focus:shadow-lg focus:border focus:rounded-md
                        dark:focus:border-none dark:focus:bg-stone-800"
                    onKeyDown={handleKeyDown}
                />
                <button
                    type="button"
                    tabIndex={0}
                    title={repeatPattern ? `Repeats: ${repeatSummary}` : 'Set repeat'}
                    onClick={ev => {
                        ev.preventDefault();
                        setShowRepeatPicker(p => !p);
                    }}
                    className={`absolute right-7 top-1/2 -translate-y-1/2 text-[11px] px-1
                        ${repeatPattern ? 'text-blue-500' : 'text-gray-300 hover:text-gray-500'}`}
                >
                    <i className="fa-solid fa-rotate" />
                </button>
                {quadrant && (
                    <span
                        className={`absolute right-2 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ${QUADRANT_DOT[quadrant]}`}
                        title={selectedQ?.label}
                    />
                )}
            </div>

            {showRepeatPicker && (
                <div className="mt-1 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 shadow-md py-1 text-xs">
                    {REPEAT_OPTIONS.map(opt => (
                        <button
                            key={opt.value ?? 'none'}
                            type="button"
                            onClick={() => {
                                setRepeatPattern(opt.value);
                                if (!opt.value) setRepeatEndedAt('');
                            }}
                            className={`w-full text-left px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 ${repeatPattern === opt.value ? 'bg-gray-100 dark:bg-gray-700 font-medium' : ''}`}
                        >
                            {opt.label}
                        </button>
                    ))}
                    {repeatPattern === 'every_n_days' && (
                        <div className="px-3 py-1.5 flex items-center gap-2 border-t border-gray-200 dark:border-gray-700">
                            <span className="text-gray-500">Every</span>
                            <input
                                type="number"
                                min="1"
                                max="365"
                                value={repeatInterval}
                                onChange={ev => setRepeatInterval(ev.target.value)}
                                className="w-14 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-transparent focus:outline-none focus:border-blue-400"
                            />
                            <span className="text-gray-500">days</span>
                        </div>
                    )}
                    {repeatPattern && (
                        <div className="px-3 py-1.5 flex items-center gap-2 border-t border-gray-200 dark:border-gray-700">
                            <span className="text-gray-500">Ends on</span>
                            <input
                                type="date"
                                value={repeatEndedAt}
                                onChange={ev => setRepeatEndedAt(ev.target.value)}
                                className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-transparent focus:outline-none focus:border-blue-400"
                            />
                            {repeatEndedAt && (
                                <button
                                    type="button"
                                    onClick={() => setRepeatEndedAt('')}
                                    className="text-gray-400 hover:text-gray-600"
                                    title="Clear end date"
                                >
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            )}
                        </div>
                    )}
                    <div className="px-3 py-1.5 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between text-[10px] text-gray-400">
                        <span>{repeatSummary || 'Not repeating'}</span>
                        <button
                            type="button"
                            onClick={() => setShowRepeatPicker(false)}
                            className="text-blue-500 hover:underline"
                        >
                            Done
                        </button>
                    </div>
                </div>
            )}

            <div className="flex gap-1 pt-1.5 pb-0.5 flex-wrap items-center">
                {QUADRANTS.map(q => {
                    const active = quadrant === q.key;
                    return (
                        <button
                            key={q.key}
                            type="button"
                            tabIndex={0}
                            onClick={() => setQuadrant(active ? null : q.key)}
                            className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-all
                                ${active
                                    ? QUADRANT_STYLES[q.key]
                                    : 'border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:border-gray-400 dark:hover:border-gray-500'
                                }`}
                        >
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${QUADRANT_DOT[q.key]}`} />
                            {q.label}
                        </button>
                    );
                })}
                {repeatPattern && (
                    <span className="ml-auto inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200">
                        <i className="fa-solid fa-rotate text-[9px]" />
                        {repeatSummary}
                    </span>
                )}
            </div>
        </div>
    );
}
