import React, {useEffect, useState, useRef} from "react";
import Blur from "../Blur.jsx";
import TaskMenuBtn from "./TaskMenuBtn.jsx";
import {TaskMenuColorPicker} from "./TaskMenuColorPicker.jsx";
import {tryCatchDecorator, deleteTask, updateTask, getSubtasks, createSubtask, updateSubtask, deleteSubtask, getTaskFiles, uploadTaskFile, deleteTaskFile, listRepeatExceptions, addRepeatException, removeRepeatException, updateRepeatAnchor} from "../../scripts/api.js";
import {useTaskMenu} from "../../contexts/TaskMenuContext.jsx";
import {QUADRANTS} from "../../constants/eisenhower.js";
import {repeatLabel, horizonLabel} from "../../scripts/utils.js";

const QUADRANT_OPTIONS = [
    { value: null, label: 'None', dotColor: 'bg-gray-300' },
    ...QUADRANTS.map(q => ({ value: q.key, label: q.label, dotColor: q.dotColor, labelColor: q.labelColor })),
];

const REPEAT_OPTIONS = [
    { value: null, label: 'No repeat' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekdays', label: 'Every weekday (Mon–Fri)' },
    { value: 'weekly', label: 'Weekly (same weekday)' },
    { value: 'monthly', label: 'Monthly (same day)' },
    { value: 'every_n_days', label: 'Every N days…' },
];

// Preset horizons offered in the "Show ahead" control. Values are days and
// must stay within the server's accepted range ([14, 730]); see
// MIN_HORIZON_DAYS / MAX_HORIZON_DAYS in server/scheduler.js. The empty
// string sentinel means "clear the per-series override and use whatever the
// server has configured as the global default" — sending `horizonDays: null`
// to PUT /api/tasks does exactly that. The 'custom' sentinel reveals a
// numeric input so power users can pick any day count in [MIN, MAX].
const HORIZON_DEFAULT_SENTINEL = '';
const HORIZON_CUSTOM_SENTINEL = 'custom';
const HORIZON_MIN_DAYS = 14;
const HORIZON_MAX_DAYS = 730;
const HORIZON_OPTIONS = [
    { value: HORIZON_DEFAULT_SENTINEL, label: 'Default (global)' },
    { value: 30, label: '1 month' },
    { value: 90, label: '3 months' },
    { value: 180, label: '6 months' },
    { value: 365, label: '1 year' },
    { value: 730, label: '2 years' },
    { value: HORIZON_CUSTOM_SENTINEL, label: 'Custom…' },
];

function toInputDate(value) {
    if (!value || typeof value !== 'string') return '';
    if (value === 'notes' || value === 'eisenhower' || value.startsWith('eisenhower-')) return '';
    const parts = value.split('-');
    if (parts.length !== 3) return '';
    const [y, m, d] = parts;
    if (!y || !m || !d) return '';
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function fromInputDate(value) {
    if (!value) return '';
    const parts = value.split('-').map(Number);
    if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) return value;
    return `${parts[0]}-${parts[1]}-${parts[2]}`;
}

function compareDateStrings(a, b) {
    const pa = toInputDate(a);
    const pb = toInputDate(b);
    if (!pa || !pb) return 0;
    if (pa < pb) return -1;
    if (pa > pb) return 1;
    return 0;
}

const TaskMenu = () => {

    const {taskData, setTaskData} = useTaskMenu();
    const {id: taskId, date, color, name, done, description, eisenhowerQuadrant, reminder, startTime, endDate, endTime, repeatPattern, repeatInterval, repeatSeriesId, repeatAnchorDate, repeatEndedAt, repeatTemplate} = taskData;

    const repeatTemplateParsed = (() => {
        if (!repeatTemplate) return null;
        if (typeof repeatTemplate === 'object') return repeatTemplate;
        try { return JSON.parse(repeatTemplate); } catch { return null; }
    })();
    const currentHorizonDays = repeatTemplateParsed && repeatTemplateParsed.horizonDays != null
        ? Number(repeatTemplateParsed.horizonDays)
        : null;
    const currentHorizonText = currentHorizonDays != null ? horizonLabel(currentHorizonDays) : '';

    const [showQuadrantPicker, setShowQuadrantPicker] = useState(false);
    const [showRepeatPicker, setShowRepeatPicker] = useState(false);
    const [repeatIntervalDraft, setRepeatIntervalDraft] = useState(2);
    const [repeatEndedAtDraft, setRepeatEndedAtDraft] = useState('');
    const [subtasksList, setSubtasksList] = useState([]);
    const [newSubtask, setNewSubtask] = useState('');
    const [files, setFiles] = useState([]);
    const [reminderValue, setReminderValue] = useState('');
    const [showReminder, setShowReminder] = useState(false);
    const [descriptionText, setDescriptionText] = useState('');
    const [startDateValue, setStartDateValue] = useState('');
    const [startTimeValue, setStartTimeValue] = useState('');
    const [endDateValue, setEndDateValue] = useState('');
    const [endTimeValue, setEndTimeValue] = useState('');
    const [deletePromptOpen, setDeletePromptOpen] = useState(false);
    const [customHorizonOpen, setCustomHorizonOpen] = useState(false);
    const [customHorizonDraft, setCustomHorizonDraft] = useState('');
    const [exceptions, setExceptions] = useState([]);
    const [skipDateDraft, setSkipDateDraft] = useState('');
    const [anchorDraft, setAnchorDraft] = useState('');
    const [savePrompt, setSavePrompt] = useState(null);
    const fileInputRef = useRef(null);

    const isPresetHorizon = currentHorizonDays != null
        && HORIZON_OPTIONS.some(o => o.value === currentHorizonDays);

    useEffect(() => {
        if (!taskId) return;
        setShowQuadrantPicker(false);
        setShowRepeatPicker(false);
        setDeletePromptOpen(false);
        setCustomHorizonOpen(false);
        setCustomHorizonDraft('');
        setDescriptionText(taskData.description || '');
        setReminderValue(taskData.reminder || '');
        setShowReminder(!!taskData.reminder);
        setStartDateValue(toInputDate(taskData.date));
        setStartTimeValue(taskData.startTime || '');
        setEndDateValue(toInputDate(taskData.endDate || taskData.date));
        setEndTimeValue(taskData.endTime || '24:00');
        setRepeatIntervalDraft(parseInt(taskData.repeatInterval, 10) || 2);
        setRepeatEndedAtDraft(toInputDate(taskData.repeatEndedAt));
        setAnchorDraft(toInputDate(taskData.repeatAnchorDate));
        setSkipDateDraft('');
        setSavePrompt(null);

        getSubtasks(taskId).then(setSubtasksList).catch(() => setSubtasksList([]));
        getTaskFiles(taskId).then(setFiles).catch(() => setFiles([]));
        if (taskData.repeatSeriesId) {
            listRepeatExceptions(taskId).then(setExceptions).catch(() => setExceptions([]));
        } else {
            setExceptions([]);
        }
    }, [taskId]);

    useEffect(() => {
        setAnchorDraft(toInputDate(repeatAnchorDate));
    }, [repeatAnchorDate]);

    async function refreshExceptions() {
        if (!taskId || !repeatSeriesId) return;
        try {
            const list = await listRepeatExceptions(taskId);
            setExceptions(list || []);
        } catch {
            // best-effort
        }
    }

    async function handleAddSkip() {
        if (!skipDateDraft || !repeatSeriesId) return;
        const normalized = fromInputDate(skipDateDraft);
        const result = await tryCatchDecorator(addRepeatException)(taskId, normalized);
        if (!result.success) {
            window.alert(result.message || 'Could not add skip date');
            return;
        }
        setSkipDateDraft('');
        await refreshExceptions();
        window.dispatchEvent(new CustomEvent("tasksChanged"));
    }

    async function handleRemoveSkip(date) {
        const result = await tryCatchDecorator(removeRepeatException)(taskId, date);
        if (!result.success) {
            window.alert(result.message || 'Could not remove skip date');
            return;
        }
        await refreshExceptions();
        window.dispatchEvent(new CustomEvent("tasksChanged"));
    }

    async function handleAnchorApply() {
        if (!anchorDraft || !repeatSeriesId) return;
        const normalized = fromInputDate(anchorDraft);
        if (normalized === repeatAnchorDate) return;
        const ok = window.confirm(
            'Change the series start date?\n\nFuture occurrences will be re-aligned to the new cadence. Past and completed occurrences are kept.'
        );
        if (!ok) {
            setAnchorDraft(toInputDate(repeatAnchorDate));
            return;
        }
        const result = await tryCatchDecorator(updateRepeatAnchor)(taskId, normalized);
        if (!result.success) {
            setAnchorDraft(toInputDate(repeatAnchorDate));
            window.alert(result.message || 'Could not update anchor date');
            return;
        }
        setTaskData(prev => ({ ...prev, repeatAnchorDate: normalized }));
        await refreshExceptions();
        window.dispatchEvent(new CustomEvent("tasksChanged"));
    }

    function openColorPicker(ev) {
        ev.stopPropagation();
        let taskMenuColorPicker = ev.target.parentElement.parentElement.parentElement
            .querySelector(".task-menu-color-picker");
        if (!taskMenuColorPicker) {
            taskMenuColorPicker = ev.target.parentElement.parentElement
                .querySelector(".task-menu-color-picker");
        }
        taskMenuColorPicker.classList.toggle("active");
        const buttonPos = ev.target.getBoundingClientRect();
        taskMenuColorPicker.style.left = `${Math.round(buttonPos.left + buttonPos.width / 2)}px`;
        taskMenuColorPicker.style.top = `${Math.round(buttonPos.bottom) + 12}px`;
    }

    function closeColorPicker(ev) {
        const taskMenuColorPicker = ev.target.querySelector(".task-menu-color-picker");
        if (taskMenuColorPicker) {
            taskMenuColorPicker.classList.remove("active");
        }
    }

    async function delTask(scope) {
        await tryCatchDecorator(deleteTask)(taskId, scope);
        const bgBlur = document.querySelector(".blur-bg.active");
        if (bgBlur) bgBlur.classList.remove("active");
        window.dispatchEvent(new CustomEvent("tasksChanged"));
    }

    function handleDeleteClick() {
        if (repeatSeriesId) {
            setDeletePromptOpen(true);
        } else {
            delTask();
        }
    }

    async function handleRepeatSelect(value) {
        setShowRepeatPicker(false);
        const startStr = startDateValue || toInputDate(taskData.date);
        if (value && !startStr) {
            window.alert('Please give the task a calendar date before turning on repeat.');
            return;
        }
        const intervalToSend = value === 'every_n_days'
            ? Math.max(1, parseInt(repeatIntervalDraft, 10) || 1)
            : null;
        const payload = {
            repeatPattern: value,
            repeatInterval: intervalToSend,
        };
        const applyTo = repeatSeriesId ? 'series' : undefined;
        const result = await tryCatchDecorator(updateTask)(taskId, payload, applyTo);
        if (!result.success) {
            window.alert(result.message || 'Could not update repeat');
            return;
        }
        setTaskData(prev => ({
            ...prev,
            repeatPattern: value,
            repeatInterval: intervalToSend,
            repeatSeriesId: value ? (prev.repeatSeriesId || 'pending') : null,
            repeatAnchorDate: value ? (prev.repeatAnchorDate || (startStr ? fromInputDate(startStr) : prev.date)) : null,
        }));
        window.dispatchEvent(new CustomEvent("tasksChanged"));
    }

    async function handleHorizonChange(rawValue) {
        if (!repeatSeriesId) return;
        // 'custom' = open the numeric input instead of submitting; the user
        // confirms with handleCustomHorizonSubmit. Empty string = clear the
        // per-series override (fall back to the global default). Otherwise
        // parse to an integer day count.
        if (rawValue === HORIZON_CUSTOM_SENTINEL) {
            setCustomHorizonDraft(currentHorizonDays != null ? String(currentHorizonDays) : '');
            setCustomHorizonOpen(true);
            return;
        }
        setCustomHorizonOpen(false);
        let nextHorizon;
        if (rawValue === HORIZON_DEFAULT_SENTINEL) {
            nextHorizon = null;
        } else {
            const n = parseInt(rawValue, 10);
            if (!Number.isFinite(n)) return;
            nextHorizon = n;
        }
        const previousTemplate = repeatTemplate;
        const nextTemplate = { ...(repeatTemplateParsed || {}) };
        if (nextHorizon == null) delete nextTemplate.horizonDays;
        else nextTemplate.horizonDays = nextHorizon;
        // Optimistically reflect the change so the dropdown stays in sync
        // even before the server roundtrips.
        setTaskData(prev => ({ ...prev, repeatTemplate: JSON.stringify(nextTemplate) }));
        const result = await tryCatchDecorator(updateTask)(taskId, {
            horizonDays: nextHorizon,
        }, 'series');
        if (!result.success) {
            setTaskData(prev => ({ ...prev, repeatTemplate: previousTemplate }));
            window.alert(result.message || 'Could not update show-ahead horizon');
            return;
        }
        window.dispatchEvent(new CustomEvent("tasksChanged"));
    }

    async function handleCustomHorizonSubmit() {
        const trimmed = String(customHorizonDraft).trim();
        if (!trimmed) {
            window.alert(`Please enter a whole number of days between ${HORIZON_MIN_DAYS} and ${HORIZON_MAX_DAYS}.`);
            return;
        }
        // Reject non-integer input (e.g. "30.5", "abc", "12 days") before
        // contacting the server so we can surface a friendly message.
        if (!/^-?\d+$/.test(trimmed)) {
            window.alert(`Please enter a whole number of days between ${HORIZON_MIN_DAYS} and ${HORIZON_MAX_DAYS}.`);
            return;
        }
        const n = parseInt(trimmed, 10);
        if (!Number.isFinite(n) || n < HORIZON_MIN_DAYS || n > HORIZON_MAX_DAYS) {
            window.alert(`Show ahead must be between ${HORIZON_MIN_DAYS} and ${HORIZON_MAX_DAYS} days.`);
            return;
        }
        await handleHorizonChange(String(n));
    }

    async function handleRepeatEndedAtChange(rawValue) {
        const normalized = rawValue ? fromInputDate(rawValue) : null;
        if (!repeatSeriesId) {
            setRepeatEndedAtDraft(rawValue);
            return;
        }
        if (normalized && repeatAnchorDate && compareDateStrings(rawValue, toInputDate(repeatAnchorDate)) < 0) {
            window.alert("End date can't be before the start of the series.");
            return;
        }
        const previousDraft = repeatEndedAtDraft;
        setRepeatEndedAtDraft(rawValue);
        const result = await tryCatchDecorator(updateTask)(taskId, {
            repeatEndedAt: normalized,
        }, 'series');
        if (!result.success) {
            // Revert local draft to the persisted value so the input doesn't
            // visually claim a change the server didn't accept.
            setRepeatEndedAtDraft(previousDraft);
            window.alert(result.message || 'Could not update end date');
            return;
        }
        setTaskData(prev => ({ ...prev, repeatEndedAt: normalized }));
        window.dispatchEvent(new CustomEvent("tasksChanged"));
    }

    // For tasks in a recurring series, general-field edits should ask the user
    // which slice of the series the change applies to. For non-recurring
    // tasks we just save immediately. The optimistic local state is applied
    // first regardless so the UI feels responsive; if the user cancels we
    // revert via revertOnCancel.
    function applyRecurringEdit(payload, { revertOnCancel } = {}) {
        const runSave = async (applyTo) => {
            await tryCatchDecorator(updateTask)(taskId, payload, applyTo);
            window.dispatchEvent(new CustomEvent("tasksChanged"));
        };
        if (repeatSeriesId) {
            setSavePrompt({
                payload,
                runSave,
                onCancel: revertOnCancel,
            });
            return;
        }
        runSave();
    }

    async function handleQuadrantSelect(quadrantValue) {
        setShowQuadrantPicker(false);
        const prevValue = taskData.eisenhowerQuadrant;
        setTaskData(prev => ({ ...prev, eisenhowerQuadrant: quadrantValue }));
        applyRecurringEdit(
            { eisenhowerQuadrant: quadrantValue },
            { revertOnCancel: () => setTaskData(prev => ({ ...prev, eisenhowerQuadrant: prevValue })) },
        );
    }

    async function handleAddSubtask() {
        if (!newSubtask.trim()) return;
        const sub = await tryCatchDecorator(createSubtask)(taskId, { name: newSubtask.trim(), order: subtasksList.length });
        if (sub.data) {
            setSubtasksList(prev => [...prev, sub.data]);
        }
        setNewSubtask('');
    }

    async function handleToggleSubtask(sub) {
        await tryCatchDecorator(updateSubtask)(sub.id, { done: !sub.done });
        setSubtasksList(prev => prev.map(s => s.id === sub.id ? { ...s, done: !s.done } : s));
    }

    async function handleDeleteSubtask(subId) {
        await tryCatchDecorator(deleteSubtask)(subId);
        setSubtasksList(prev => prev.filter(s => s.id !== subId));
    }

    async function handleFileUpload(ev) {
        const file = ev.target.files[0];
        if (!file) return;
        const result = await tryCatchDecorator(uploadTaskFile)(taskId, file);
        if (result.data) {
            setFiles(prev => [...prev, result.data]);
        }
        ev.target.value = '';
    }

    async function handleDeleteFile(fileId) {
        await tryCatchDecorator(deleteTaskFile)(fileId);
        setFiles(prev => prev.filter(f => f.id !== fileId));
    }

    async function handleReminderChange(val) {
        const prevVal = reminderValue;
        const prevTaskReminder = taskData.reminder;
        setReminderValue(val);
        setTaskData(prev => ({ ...prev, reminder: val || null }));
        applyRecurringEdit(
            { reminder: val || null },
            { revertOnCancel: () => {
                setReminderValue(prevVal);
                setTaskData(prev => ({ ...prev, reminder: prevTaskReminder }));
            }},
        );
    }

    async function handleDescriptionBlur() {
        if (descriptionText !== (taskData.description || '')) {
            const prevDescription = taskData.description || '';
            setTaskData(prev => ({ ...prev, description: descriptionText }));
            applyRecurringEdit(
                { description: descriptionText },
                { revertOnCancel: () => {
                    setDescriptionText(prevDescription);
                    setTaskData(prev => ({ ...prev, description: prevDescription }));
                }},
            );
        }
    }

    const isSpecial = !date || date === "notes" || date === "eisenhower" || (typeof date === 'string' && date.startsWith('eisenhower'));
    const repeatActive = !!repeatPattern;
    const taskMenuBtns = [
        {
            icon: "fa-regular fa-trash-can cursor-pointer",
            onClick: handleDeleteClick,
            disabled: false,
            tooltip: "Delete",
        },
        {
            icon: `fa-solid fa-rotate cursor-pointer ${repeatActive ? 'text-blue-500' : ''}`,
            onClick: ev => {
                ev.stopPropagation();
                if (isSpecial && !repeatActive) {
                    window.alert('Please give the task a calendar date before turning on repeat.');
                    return;
                }
                setShowRepeatPicker(p => !p);
                setShowQuadrantPicker(false);
            },
            disabled: false,
            tooltip: "Repeat",
        },
        {
            icon: `cursor-pointer inline-block rounded-full w-3 h-3 bg-${color}`,
            onClick: openColorPicker,
            disabled: false,
            tooltip: "Select color",
        },
        {
            icon: "fa-regular fa-bell cursor-pointer",
            onClick: () => setShowReminder(p => !p),
            disabled: false,
            tooltip: "Reminder",
        },
        {
            icon: "fa-solid fa-ellipsis cursor-pointer",
            onClick: () => {},
            disabled: true,
            tooltip: "More",
        },
    ];

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const dateObj = isSpecial ? null : (date instanceof Date ? date : new Date(date));

    const getDate = d => {
        if (!d) return eisenhowerQuadrant ? "Eisenhower Matrix" : "Someday";
        const dayOfWeek = days[d.getDay()].slice(0, 3);
        const month = months[d.getMonth()].slice(0, 3);
        return `${dayOfWeek}, ${d.getDate()} ${month} ${d.getFullYear()}`;
    };

    const currentQuadrant = QUADRANTS.find(q => q.key === eisenhowerQuadrant);

    return (
        <Blur type="task-menu">
            <div className="task-menu relative bg-[#DDE1FB] dark:bg-gray-900 rounded-xl
            py-4 lg:py-6 px-6 lg:px-8 w-[28rem] max-h-[85vh] overflow-y-auto
             z-20 text-gray-600 dark:text-gray-300 transition-all duration-500 ease-linear"
                 onClick={ev => {
                     ev.stopPropagation();
                     closeColorPicker(ev);
                     setShowQuadrantPicker(false);
                 }}>
                <div className="w-full flex justify-between text-sm relative">
                    <div className="flex gap-2 items-center flex-wrap">
                        <i className="fa-regular fa-calendar-days"></i>
                        <p className="text-sm">{getDate(dateObj)}</p>
                        {repeatActive && (
                            <span className="ml-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200">
                                <i className="fa-solid fa-rotate text-[9px]" />
                                {repeatLabel(repeatPattern, repeatInterval)}
                            </span>
                        )}
                        {repeatActive && repeatEndedAt && (
                            <span className="ml-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                                Repeats until {repeatEndedAt}
                            </span>
                        )}
                        {repeatActive && currentHorizonText && (
                            <span className="ml-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                                  title={`Plans ${currentHorizonText} ahead`}>
                                <i className="fa-regular fa-eye text-[9px]" />
                                Plans {currentHorizonText} ahead
                            </span>
                        )}
                    </div>

                    <div className="flex gap-3 items-center">
                        {taskMenuBtns.map((btn, ind) => (
                            <TaskMenuBtn key={ind} {...btn} />
                        ))}
                        <TaskMenuColorPicker
                            setColor={value => setTaskData(prevData =>
                                ({ ...prevData, color: value }))}/>
                    </div>

                    {showRepeatPicker && (
                        <div className="absolute right-0 top-full mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-30 min-w-[220px] py-1"
                             onClick={ev => ev.stopPropagation()}>
                            {REPEAT_OPTIONS.map(opt => (
                                <button
                                    key={opt.value ?? 'none'}
                                    onClick={() => handleRepeatSelect(opt.value)}
                                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${repeatPattern === opt.value ? 'bg-gray-100 dark:bg-gray-700 font-medium' : ''}`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                            <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex items-center gap-2 text-xs">
                                <span className="text-gray-500">Every</span>
                                <input
                                    type="number"
                                    min="1"
                                    max="365"
                                    value={repeatIntervalDraft}
                                    onChange={ev => setRepeatIntervalDraft(ev.target.value)}
                                    className="w-14 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-transparent focus:outline-none focus:border-blue-400 text-xs"
                                />
                                <span className="text-gray-500">days</span>
                                <button
                                    onClick={() => handleRepeatSelect('every_n_days')}
                                    className="ml-auto text-blue-500 hover:underline text-xs"
                                >
                                    Apply
                                </button>
                            </div>
                            {repeatActive && (
                                <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex items-center gap-2 text-xs">
                                    <span className="text-gray-500">Ends on</span>
                                    <input
                                        type="date"
                                        value={repeatEndedAtDraft}
                                        min={repeatAnchorDate ? toInputDate(repeatAnchorDate) : undefined}
                                        onChange={ev => handleRepeatEndedAtChange(ev.target.value)}
                                        className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-transparent focus:outline-none focus:border-blue-400 text-xs"
                                    />
                                    {repeatEndedAtDraft && (
                                        <button
                                            onClick={() => handleRepeatEndedAtChange('')}
                                            className="text-gray-400 hover:text-gray-600 text-[10px]"
                                            title="Clear end date"
                                        >
                                            <i className="fa-solid fa-xmark" />
                                        </button>
                                    )}
                                </div>
                            )}
                            {repeatActive && (
                                <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex flex-col gap-2 text-xs">
                                    <div className="flex items-center gap-2">
                                        <span className="text-gray-500" title="How far ahead the planner pre-fills future occurrences of this series">Show ahead</span>
                                        <select
                                            value={
                                                customHorizonOpen
                                                    ? HORIZON_CUSTOM_SENTINEL
                                                    : currentHorizonDays == null
                                                        ? HORIZON_DEFAULT_SENTINEL
                                                        : isPresetHorizon
                                                            ? String(currentHorizonDays)
                                                            : HORIZON_CUSTOM_SENTINEL
                                            }
                                            onChange={ev => handleHorizonChange(ev.target.value)}
                                            className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-transparent focus:outline-none focus:border-blue-400 text-xs"
                                        >
                                            {HORIZON_OPTIONS.map(opt => (
                                                <option key={String(opt.value)} value={opt.value}>{opt.label}</option>
                                            ))}
                                            {currentHorizonDays != null && !isPresetHorizon && (
                                                <option value={String(currentHorizonDays)}>{`${currentHorizonDays} days`}</option>
                                            )}
                                        </select>
                                    </div>
                                    {(customHorizonOpen || (currentHorizonDays != null && !isPresetHorizon)) && (
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="number"
                                                min={HORIZON_MIN_DAYS}
                                                max={HORIZON_MAX_DAYS}
                                                step="1"
                                                placeholder={`${HORIZON_MIN_DAYS}–${HORIZON_MAX_DAYS}`}
                                                value={customHorizonOpen
                                                    ? customHorizonDraft
                                                    : (currentHorizonDays != null ? String(currentHorizonDays) : '')}
                                                onFocus={() => {
                                                    if (!customHorizonOpen) {
                                                        setCustomHorizonDraft(currentHorizonDays != null ? String(currentHorizonDays) : '');
                                                        setCustomHorizonOpen(true);
                                                    }
                                                }}
                                                onChange={ev => {
                                                    setCustomHorizonOpen(true);
                                                    setCustomHorizonDraft(ev.target.value);
                                                }}
                                                onKeyDown={ev => {
                                                    if (ev.key === 'Enter') {
                                                        ev.preventDefault();
                                                        handleCustomHorizonSubmit();
                                                    } else if (ev.key === 'Escape') {
                                                        ev.preventDefault();
                                                        setCustomHorizonOpen(false);
                                                        setCustomHorizonDraft('');
                                                    }
                                                }}
                                                className="w-20 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-transparent focus:outline-none focus:border-blue-400 text-xs"
                                            />
                                            <span className="text-gray-500">days</span>
                                            <button
                                                onClick={handleCustomHorizonSubmit}
                                                className="ml-auto text-blue-500 hover:underline text-xs"
                                            >
                                                Apply
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                            {repeatActive && (
                                <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex flex-col gap-1.5 text-xs">
                                    <div className="flex items-center gap-2">
                                        <span className="text-gray-500" title="The date the series cadence is anchored to. Changing it re-aligns future occurrences.">Starts</span>
                                        <input
                                            type="date"
                                            value={anchorDraft}
                                            max={repeatEndedAt ? toInputDate(repeatEndedAt) : undefined}
                                            onChange={ev => setAnchorDraft(ev.target.value)}
                                            className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-transparent focus:outline-none focus:border-blue-400 text-xs"
                                        />
                                        {anchorDraft && fromInputDate(anchorDraft) !== repeatAnchorDate && (
                                            <button
                                                onClick={handleAnchorApply}
                                                className="text-blue-500 hover:underline text-xs"
                                            >
                                                Apply
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                            {repeatActive && repeatSeriesId && (
                                <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex flex-col gap-1.5 text-xs">
                                    <div className="flex items-center justify-between">
                                        <span className="text-gray-500" title="Dates excluded from this series. Skipped dates are not re-materialized by the scheduler.">
                                            Skipped dates
                                        </span>
                                        <span className="text-[10px] text-gray-400">{exceptions.length}</span>
                                    </div>
                                    {exceptions.length > 0 && (
                                        <div className="flex flex-col gap-1 max-h-28 overflow-y-auto">
                                            {exceptions.map(ex => (
                                                <div key={ex.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/40 rounded px-2 py-0.5">
                                                    <span className="text-gray-600 dark:text-gray-300">{ex.date}</span>
                                                    <button
                                                        onClick={() => handleRemoveSkip(ex.date)}
                                                        className="text-gray-400 hover:text-blue-500 text-[10px]"
                                                        title="Un-skip this date"
                                                    >
                                                        Un-skip
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="date"
                                            value={skipDateDraft}
                                            min={repeatAnchorDate ? toInputDate(repeatAnchorDate) : undefined}
                                            max={repeatEndedAt ? toInputDate(repeatEndedAt) : undefined}
                                            onChange={ev => setSkipDateDraft(ev.target.value)}
                                            className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-transparent focus:outline-none focus:border-blue-400 text-xs"
                                        />
                                        <button
                                            onClick={handleAddSkip}
                                            disabled={!skipDateDraft}
                                            className={`text-xs ${skipDateDraft ? 'text-blue-500 hover:underline' : 'text-gray-300 cursor-not-allowed'}`}
                                        >
                                            Skip
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {deletePromptOpen && (
                        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
                             onClick={() => setDeletePromptOpen(false)}>
                            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg w-72 p-4 text-sm"
                                 onClick={ev => ev.stopPropagation()}>
                                <p className="text-gray-700 dark:text-gray-200 mb-3 font-medium">Delete recurring task…</p>
                                <div className="flex flex-col gap-1">
                                    <button
                                        onClick={() => { setDeletePromptOpen(false); delTask('one'); }}
                                        className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                                    >
                                        Just this one
                                    </button>
                                    <button
                                        onClick={() => { setDeletePromptOpen(false); delTask('future'); }}
                                        className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                                    >
                                        This and future
                                    </button>
                                    <button
                                        onClick={() => { setDeletePromptOpen(false); delTask('series'); }}
                                        className="w-full text-left px-3 py-2 rounded text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                                    >
                                        Whole series
                                    </button>
                                    <button
                                        onClick={() => setDeletePromptOpen(false)}
                                        className="w-full text-left px-3 py-2 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="mt-3 relative" onClick={ev => ev.stopPropagation()}>
                    <button
                        onClick={() => setShowQuadrantPicker(p => !p)}
                        className="flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-gray-300 hover:border-gray-500 transition-colors"
                    >
                        {currentQuadrant ? (
                            <>
                                <span className={`w-2 h-2 rounded-full ${currentQuadrant.dotColor}`} />
                                <span className={currentQuadrant.labelColor}>{currentQuadrant.label}</span>
                            </>
                        ) : (
                            <>
                                <span className="w-2 h-2 rounded-full bg-gray-300" />
                                <span className="text-gray-400">No matrix quadrant</span>
                            </>
                        )}
                        <i className="fa-solid fa-chevron-down text-gray-400 text-[10px]" />
                    </button>

                    {showQuadrantPicker && (
                        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-30 min-w-[180px]">
                            {QUADRANT_OPTIONS.map(opt => (
                                <button
                                    key={opt.value ?? 'none'}
                                    onClick={() => handleQuadrantSelect(opt.value)}
                                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 text-left transition-colors ${eisenhowerQuadrant === opt.value ? 'bg-gray-100 dark:bg-gray-700' : ''}`}
                                >
                                    <span className={`w-2 h-2 rounded-full ${opt.dotColor} flex-shrink-0`} />
                                    <span className={opt.labelColor || 'text-gray-500'}>{opt.label}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="mt-6">
                    <div className="relative">
                        <input type="text" defaultValue={name}
                               key={taskId}
                               onChange={ev =>
                                   setTaskData(prevTaskData => ({
                                       ...prevTaskData,
                                       name: ev.target.value,
                                   }))
                               }
                               className={"w-full border-b border-gray-400 dark:border-gray-600 indent-2 py-1 text-xl bg-transparent focus:outline-none "
                                   + ((done && "line-through opacity-40") || '')}
                        />
                        <button className="absolute top-1/2 -translate-y-1/2 right-2"
                                onClick={ev => {
                                    ev.preventDefault();
                                    setTaskData(prevData =>
                                        ({ ...prevData, done: !done }));
                                }}>
                            <i className={`fa-${done ? "solid" : "regular"} fa-circle-check fa-lg`}></i>
                        </button>
                    </div>

                    <div className="mt-4 flex gap-2 text-gray-400 text-sm border-b border-gray-300 dark:border-gray-600 pb-2">
                        <button onClick={() => {
                            const ta = document.getElementById('desc-textarea');
                            if (ta) {
                                const start = ta.selectionStart;
                                const end = ta.selectionEnd;
                                const text = descriptionText;
                                setDescriptionText(text.substring(0, start) + '**' + text.substring(start, end) + '**' + text.substring(end));
                            }
                        }} className="font-bold hover:text-gray-600 dark:hover:text-gray-200 px-1">B</button>
                        <button className="hover:text-gray-600 dark:hover:text-gray-200 px-1"><i className="fa-solid fa-list-ul text-xs" /></button>
                        <button className="hover:text-gray-600 dark:hover:text-gray-200 px-1"><i className="fa-solid fa-bars text-xs" /></button>
                        <button className="hover:text-gray-600 dark:hover:text-gray-200 px-1"><i className="fa-solid fa-link text-xs" /></button>
                    </div>

                    <textarea
                        id="desc-textarea"
                        value={descriptionText}
                        onChange={ev => setDescriptionText(ev.target.value)}
                        onBlur={handleDescriptionBlur}
                        className="w-full mt-2 focus:outline-none bg-transparent resize-none text-sm min-h-[60px]"
                        placeholder="Add some extra notes here..."
                        rows={3}
                    />

                    {showReminder && (
                        <div className="mt-2 flex items-center gap-2 text-sm">
                            <i className="fa-regular fa-bell text-gray-400" />
                            <input
                                type="datetime-local"
                                value={reminderValue}
                                onChange={ev => handleReminderChange(ev.target.value)}
                                className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-transparent focus:outline-none focus:border-blue-400"
                            />
                            {reminderValue && (
                                <button onClick={() => handleReminderChange('')}
                                        className="text-gray-400 hover:text-gray-600 text-xs">
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            )}
                        </div>
                    )}

                    <div className="mt-3 border-t border-gray-300 dark:border-gray-600 pt-3">
                        <div className="flex items-center gap-3 text-xs">
                            <div className="flex items-center gap-1.5 flex-1">
                                <span className="text-gray-400 w-10">Start</span>
                                <input
                                    type="date"
                                    value={startDateValue}
                                    onChange={ev => {
                                        const next = ev.target.value;
                                        setStartDateValue(next);
                                        if (next && endDateValue && next > endDateValue) {
                                            setEndDateValue(next);
                                        }
                                    }}
                                    className="border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-transparent focus:outline-none focus:border-blue-400 text-xs"
                                />
                                {startDateValue && (
                                    <button onClick={() => setStartDateValue('')} className="text-gray-400 hover:text-gray-600 text-[10px]" title="Clear start date">
                                        <i className="fa-solid fa-xmark" />
                                    </button>
                                )}
                                <input
                                    type="time"
                                    value={startTimeValue}
                                    onChange={ev => setStartTimeValue(ev.target.value)}
                                    className="border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-transparent focus:outline-none focus:border-blue-400 text-xs"
                                />
                                {startTimeValue && (
                                    <button onClick={() => setStartTimeValue('')} className="text-gray-400 hover:text-gray-600 text-[10px]" title="Clear start time">
                                        <i className="fa-solid fa-xmark" />
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs mt-2">
                            <div className="flex items-center gap-1.5 flex-1">
                                <span className="text-gray-400 w-10">End</span>
                                <input
                                    type="date"
                                    value={endDateValue}
                                    onChange={ev => setEndDateValue(ev.target.value)}
                                    className="border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-transparent focus:outline-none focus:border-blue-400 text-xs"
                                />
                                <input
                                    type="time"
                                    value={endTimeValue}
                                    onChange={ev => setEndTimeValue(ev.target.value)}
                                    className="border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-transparent focus:outline-none focus:border-blue-400 text-xs"
                                />
                                {(endDateValue || endTimeValue) && (
                                    <button onClick={() => { setEndDateValue(''); setEndTimeValue(''); }} className="text-gray-400 hover:text-gray-600 text-[10px]">
                                        <i className="fa-solid fa-xmark" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="mt-4">
                        {subtasksList.map(sub => (
                            <div key={sub.id} className="flex items-center gap-2 py-1.5 group">
                                <button onClick={() => handleToggleSubtask(sub)}
                                        className="flex-shrink-0">
                                    <i className={`fa-${sub.done ? 'solid' : 'regular'} fa-circle${sub.done ? '-check' : ''} text-gray-400`} />
                                </button>
                                <span className={`flex-1 text-sm ${sub.done ? 'line-through text-gray-400' : ''}`}>
                                    {sub.name}
                                </span>
                                <button onClick={() => handleDeleteSubtask(sub.id)}
                                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 text-xs transition-opacity">
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            </div>
                        ))}
                        <div className="flex items-center gap-2 py-1.5">
                            <i className="fa-regular fa-circle text-gray-300 flex-shrink-0" />
                            <input
                                type="text"
                                value={newSubtask}
                                onChange={ev => setNewSubtask(ev.target.value)}
                                onKeyDown={ev => { if (ev.key === 'Enter') handleAddSubtask(); }}
                                placeholder="Add subtask..."
                                className="flex-1 text-sm bg-transparent focus:outline-none placeholder-gray-400"
                            />
                            <button onClick={() => fileInputRef.current?.click()}
                                    className="text-gray-300 hover:text-gray-500 transition-colors">
                                <i className="fa-solid fa-paperclip" />
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                onChange={handleFileUpload}
                                className="hidden"
                            />
                        </div>
                    </div>

                    {files.length > 0 && (
                        <div className="mt-3 border-t border-gray-300 dark:border-gray-600 pt-3">
                            <p className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Attachments</p>
                            {files.map(f => (
                                <div key={f.id} className="flex items-center gap-2 py-1 group text-sm">
                                    <i className="fa-solid fa-paperclip text-gray-400 text-xs" />
                                    <a href={f.url} target="_blank" rel="noreferrer"
                                       className="flex-1 text-blue-500 hover:underline truncate">
                                        {f.originalName}
                                    </a>
                                    <button onClick={() => handleDeleteFile(f.id)}
                                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 text-xs transition-opacity">
                                        <i className="fa-solid fa-xmark" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <button
                    onClick={() => {
                        const wasSpecial = !date || date === 'notes' || date === 'eisenhower' || (typeof date === 'string' && date.startsWith('eisenhower-'));
                        let nextDate = date;
                        let nextEndDate = endDateValue;
                        if (startDateValue) {
                            nextDate = fromInputDate(startDateValue);
                            if (nextEndDate && compareDateStrings(nextEndDate, startDateValue) < 0) {
                                nextEndDate = startDateValue;
                            }
                        } else if (!wasSpecial) {
                            nextDate = taskData.eisenhowerQuadrant ? 'eisenhower' : 'notes';
                            nextEndDate = '';
                        }
                        const dateChanged = nextDate !== date;
                        const payload = {
                            name: taskData.name,
                            color: taskData.color,
                            done: taskData.done,
                            description: descriptionText,
                            date: nextDate,
                            eisenhowerQuadrant: taskData.eisenhowerQuadrant,
                            reminder: reminderValue || null,
                            startTime: startTimeValue || null,
                            endDate: nextEndDate ? fromInputDate(nextEndDate) : null,
                            endTime: endTimeValue || null,
                        };
                        const runSave = async (applyTo) => {
                            await tryCatchDecorator(updateTask)(taskId, payload, applyTo);
                            window.dispatchEvent(new CustomEvent("tasksChanged"));
                            const bgBlur = document.querySelector(".blur-bg.active");
                            if (bgBlur) bgBlur.classList.remove("active");
                        };
                        if (repeatSeriesId && !dateChanged) {
                            // Date-only edits stay scoped to "one" automatically (handled
                            // by the dateChanged branch above). For all other field edits
                            // on a recurring task, ask the user which slice of the series
                            // the change should apply to.
                            setSavePrompt({ payload, runSave });
                            return;
                        }
                        runSave(repeatSeriesId ? 'one' : undefined);
                    }}
                    className="w-full mt-6 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium hover:opacity-80 transition cursor-pointer">
                    Save
                </button>

                {savePrompt && (() => {
                    const cancel = () => {
                        if (savePrompt.onCancel) savePrompt.onCancel();
                        setSavePrompt(null);
                    };
                    const choose = async (scope) => {
                        const r = savePrompt.runSave;
                        setSavePrompt(null);
                        await r(scope);
                    };
                    return (
                        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
                             onClick={cancel}>
                            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg w-72 p-4 text-sm"
                                 onClick={ev => ev.stopPropagation()}>
                                <p className="text-gray-700 dark:text-gray-200 mb-3 font-medium">Apply changes to…</p>
                                <div className="flex flex-col gap-1">
                                    <button
                                        onClick={() => choose('one')}
                                        className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                                    >
                                        Just this one
                                    </button>
                                    <button
                                        onClick={() => choose('future')}
                                        className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                                    >
                                        This and future
                                    </button>
                                    <button
                                        onClick={() => choose('series')}
                                        className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                                    >
                                        Whole series
                                    </button>
                                    <button
                                        onClick={cancel}
                                        className="w-full text-left px-3 py-2 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })()}

                <input type="hidden" id="task-done" value={done ? "true" : "false"} />
                <input type="hidden" id="task-color" value={color || "none"} />
                <input type="hidden" id="task-id" value={taskId || "none"} />
            </div>
        </Blur>
    );
};

export default TaskMenu;
