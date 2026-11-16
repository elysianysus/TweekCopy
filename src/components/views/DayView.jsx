import React, { useState, useEffect, useRef, useCallback } from 'react';
import Task from '../tasks/Task.jsx';
import { formDate, isPublicHoliday, isMultiDayTask, parseFormDate, openForm, formatRepeatTooltip, formatRepeatEndShort, isFinalRecurringOccurrence } from '../../scripts/utils.js';
import { getMemoByDate, createMemo, updateMemo, deleteMemo, uploadMemoFile, deleteMemoFile, createTask, uploadTaskFile, getRizeSessions } from '../../scripts/api.js';
import { useTaskMenu } from '../../contexts/TaskMenuContext.jsx';
import AddTaskInput from '../tasks/AddTaskInput.jsx';
import { DayMacroCoaching } from '../food/macros.jsx';
import ReflectionColumn from './ReflectionColumn.jsx';
import ActualEntryInput from './ActualEntryInput.jsx';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

const HOURS = [];
for (let h = 0; h <= 24; h++) {
    HOURS.push(h);
}

function TimeSlotInput({ startHour, endHour, dateStr, onDone, onCancel }) {
    const [value, setValue] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        if (inputRef.current) inputRef.current.focus();
    }, []);

    const startLabel = String(startHour).padStart(2, '0') + ':00';
    const endLabel = String(endHour).padStart(2, '0') + ':00';

    async function submit() {
        const name = value.trim();
        if (!name) { onCancel(); return; }
        await createTask({
            name,
            color: 'white text-black dark:text-white dark:bg-black',
            date: dateStr,
            done: false,
            order: 0,
            startTime: startLabel,
            endDate: dateStr,
            endTime: endLabel,
        });
        onDone();
    }

    return (
        <div className="absolute inset-0 flex items-center px-1 z-20 bg-blue-100 dark:bg-blue-900/60 rounded">
            <span className="text-[9px] text-blue-500 dark:text-blue-300 font-mono mr-1 whitespace-nowrap">{startLabel}-{endLabel}</span>
            <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
                onBlur={submit}
                className="flex-1 min-w-0 bg-transparent text-xs focus:outline-none placeholder:text-blue-300 dark:placeholder:text-blue-500"
                placeholder="What are you doing?"
            />
        </div>
    );
}

function HourCellInput({ dateStr, hour, done, onTasksChanged }) {
    const [active, setActive] = useState(false);
    const [value, setValue] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        if (active && inputRef.current) inputRef.current.focus();
    }, [active]);

    async function submit() {
        const name = value.trim();
        if (!name) { setActive(false); return; }
        const timeStr = String(hour).padStart(2, '0') + ':00';
        await createTask({
            name,
            color: 'white text-black dark:text-white dark:bg-black',
            date: dateStr,
            done,
            order: 0,
            startTime: timeStr,
            endDate: dateStr,
            endTime: '24:00',
        });
        setValue('');
        setActive(false);
        if (onTasksChanged) onTasksChanged();
    }

    if (!active) {
        return (
            <div className="w-full h-full min-h-[20px] cursor-pointer" onClick={() => setActive(true)} />
        );
    }

    return (
        <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setValue(''); setActive(false); } }}
            onBlur={submit}
            className="w-full bg-transparent text-xs focus:outline-none px-1 py-0.5 placeholder:text-gray-300"
            placeholder="..."
        />
    );
}

function getTaskHour(task) {
    if (task.startTime) {
        const parts = task.startTime.split(':');
        if (parts.length >= 2) return parseInt(parts[0]);
    }
    if (!task.reminder) return null;
    try {
        const d = new Date(task.reminder);
        if (isNaN(d.getTime())) return null;
        return d.getHours();
    } catch { return null; }
}

function formatDateLabel(dateStr) {
    if (!dateStr) return '';
    const d = parseFormDate(dateStr);
    if (!d) return dateStr;
    return `${d.getDate()}/${d.getMonth() + 1}`;
}

export default function DayView({ date, tasks, onTasksChanged }) {
    const dateStr = formDate(date);
    const isToday = formDate(new Date()) === dateStr;
    const currentHour = new Date().getHours();
    const { setTaskData } = useTaskMenu();

    const allDayTasks = (tasks || []).filter(t => {
        if (!t.date) return false;
        if (t.date === dateStr) return true;
        if (t.endDate) {
            const start = parseFormDate(t.date);
            const end = parseFormDate(t.endDate);
            const day = parseFormDate(dateStr);
            if (start && end && day) {
                start.setHours(0,0,0,0); end.setHours(0,0,0,0); day.setHours(0,0,0,0);
                if (day >= start && day <= end) return true;
            }
        }
        return false;
    });

    const multiDayTasks = allDayTasks.filter(t => isMultiDayTask(t));
    const singleDayTasks = allDayTasks.filter(t => !isMultiDayTask(t));

    const allTodoTasks = singleDayTasks;
    const somedayTasks = (tasks || []).filter(t => t.date === 'notes');

    const todoByHour = {};
    const todoNoTime = [];
    allTodoTasks.forEach(t => {
        const h = getTaskHour(t);
        if (h !== null) {
            if (!todoByHour[h]) todoByHour[h] = [];
            todoByHour[h].push(t);
        } else {
            todoNoTime.push(t);
        }
    });

    const [dragStart, setDragStart] = useState(null);
    const [dragEnd, setDragEnd] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const [slotInput, setSlotInput] = useState(null);
    const previewColRef = useRef(null);
    const mobilePreviewColRef = useRef(null);

    const getSelectionRange = useCallback(() => {
        if (dragStart === null) return null;
        const end = dragEnd !== null ? dragEnd : dragStart;
        const minH = Math.min(dragStart, end);
        const maxH = Math.min(Math.max(dragStart, end), 23);
        return { start: Math.min(minH, 23), end: Math.min(maxH + 1, 24) };
    }, [dragStart, dragEnd]);

    function handlePreviewMouseDown(hour, e) {
        if (slotInput) return;
        e.preventDefault();
        setDragStart(hour);
        setDragEnd(hour);
        setIsDragging(true);
    }

    function handlePreviewMouseEnter(hour) {
        if (isDragging) {
            setDragEnd(hour);
        }
    }

    useEffect(() => {
        if (!isDragging) return;
        function handleUp() {
            setIsDragging(false);
            const range = getSelectionRange();
            if (range) {
                setSlotInput({ start: range.start, end: range.end });
            }
        }
        window.addEventListener('mouseup', handleUp);
        window.addEventListener('touchend', handleUp);
        return () => {
            window.removeEventListener('mouseup', handleUp);
            window.removeEventListener('touchend', handleUp);
        };
    }, [isDragging, getSelectionRange]);

    function handlePreviewTouchStart(hour, e) {
        if (slotInput) return;
        setDragStart(hour);
        setDragEnd(hour);
        setIsDragging(true);
    }

    function handlePreviewTouchMove(e) {
        const activeRef = mobilePreviewColRef.current || previewColRef.current;
        if (!isDragging || !activeRef) return;
        const touch = e.touches[0];
        const cells = activeRef.querySelectorAll('[data-preview-hour]');
        for (const cell of cells) {
            const rect = cell.getBoundingClientRect();
            if (touch.clientY >= rect.top && touch.clientY < rect.bottom) {
                const h = parseInt(cell.dataset.previewHour);
                if (!isNaN(h)) setDragEnd(h);
                break;
            }
        }
    }

    function clearDragSelection() {
        setDragStart(null);
        setDragEnd(null);
        setSlotInput(null);
    }

    function isHourInSelection(hour) {
        const range = getSelectionRange();
        if (!range) return false;
        return hour >= range.start && hour < range.end;
    }

    const previewTasks = {};
    allTodoTasks.forEach(t => {
        if (t.startTime && t.endTime && t.endTime !== '24:00') {
            const sH = parseInt(t.startTime.split(':')[0]);
            const eH = parseInt(t.endTime.split(':')[0]);
            if (!isNaN(sH) && !isNaN(eH) && eH > sH) {
                for (let h = sH; h < eH; h++) {
                    if (!previewTasks[h]) previewTasks[h] = [];
                    if (h === sH) previewTasks[h].push(t);
                }
            }
        }
    });

    const [dayMemos, setDayMemos] = useState([]);
    const [newMemoText, setNewMemoText] = useState('');
    const saveTimerRefs = useRef({});
    const memoFileInputRef = useRef(null);
    const [uploadingMemoId, setUploadingMemoId] = useState(null);

    useEffect(() => {
        fetchDayMemos();
    }, [dateStr]);

    async function fetchDayMemos() {
        try {
            const data = await getMemoByDate(dateStr);
            setDayMemos(Array.isArray(data) ? data : (data ? [data] : []));
        } catch { setDayMemos([]); }
    }

    function handleMemoContentChange(memoId, val) {
        setDayMemos(prev => prev.map(m => m.id === memoId ? { ...m, content: val } : m));
        if (saveTimerRefs.current[memoId]) clearTimeout(saveTimerRefs.current[memoId]);
        saveTimerRefs.current[memoId] = setTimeout(async () => {
            try { await updateMemo(memoId, { content: val }); } catch (e) { console.error(e); }
        }, 800);
    }

    async function handleAddMemo() {
        if (!newMemoText.trim()) return;
        try {
            await createMemo({ content: newMemoText.trim(), date: dateStr });
            setNewMemoText('');
            fetchDayMemos();
        } catch (e) { console.error(e); }
    }

    async function handleDeleteMemo(memoId) {
        try {
            await deleteMemo(memoId);
            fetchDayMemos();
        } catch (e) { console.error(e); }
    }

    function handleUploadFile(memoId) {
        setUploadingMemoId(memoId);
        memoFileInputRef.current?.click();
    }

    async function onMemoFileSelected(ev) {
        const file = ev.target.files[0];
        if (!file || !uploadingMemoId) return;
        try {
            await uploadMemoFile(uploadingMemoId, file);
            fetchDayMemos();
        } catch (e) { console.error(e); }
        ev.target.value = '';
        setUploadingMemoId(null);
    }

    async function handleDeleteMemoFile(fileId) {
        try {
            await deleteMemoFile(fileId);
            fetchDayMemos();
        } catch (e) { console.error(e); }
    }

    const newMemoFileInputRef = useRef(null);
    async function handleNewMemoWithFile() {
        newMemoFileInputRef.current?.click();
    }
    async function onNewMemoFileSelected(ev) {
        const file = ev.target.files[0];
        if (!file) return;
        try {
            const created = await createMemo({ content: '', date: dateStr });
            await uploadMemoFile(created.id, file);
            fetchDayMemos();
        } catch (e) { console.error(e); }
        ev.target.value = '';
    }

    const [draggingOver, setDraggingOver] = useState(false);
    async function handleMemoDrop(ev) {
        ev.preventDefault();
        setDraggingOver(false);
        const files = [...(ev.dataTransfer.files || [])];
        for (const file of files) {
            try {
                const created = await createMemo({ content: '', date: dateStr });
                await uploadMemoFile(created.id, file);
            } catch (e) { console.error(e); }
        }
        if (files.length) fetchDayMemos();
    }
    function handleMemoDragOver(ev) { ev.preventDefault(); setDraggingOver(true); }
    function handleMemoDragLeave(ev) {
        if (!ev.currentTarget.contains(ev.relatedTarget)) setDraggingOver(false);
    }

    const todoColRef = useRef(null);
    const somedayColRef = useRef(null);
    useEffect(() => {
        function setupColDrop(el, getDate, getDone) {
            if (!el) return () => {};
            function isFileDrag(ev) { return ev.dataTransfer?.types?.indexOf('Files') !== -1; }
            function onOver(ev) { if (isFileDrag(ev)) ev.preventDefault(); }
            async function onDrop(ev) {
                if (!isFileDrag(ev)) return;
                const taskEl = ev.target.closest('[data-task-id]');
                if (taskEl) return;
                ev.preventDefault();
                ev.stopPropagation();
                const files = [...(ev.dataTransfer.files || [])];
                for (const file of files) {
                    try {
                        const task = await createTask({
                            name: file.name.replace(/\.[^.]+$/, ''),
                            color: 'white text-black dark:text-white dark:bg-black',
                            date: getDate(),
                            done: getDone(),
                            order: 0,
                            endDate: getDate(),
                            endTime: '24:00',
                        });
                        await uploadTaskFile(task.id, file);
                    } catch (e) { console.error(e); }
                }
                if (files.length && onTasksChanged) onTasksChanged();
            }
            el.addEventListener('dragover', onOver, true);
            el.addEventListener('drop', onDrop, true);
            return () => {
                el.removeEventListener('dragover', onOver, true);
                el.removeEventListener('drop', onDrop, true);
            };
        }
        const c2 = setupColDrop(todoColRef.current, () => dateStr, () => false);
        const c3 = setupColDrop(somedayColRef.current, () => 'notes', () => false);
        return () => { c2(); c3(); };
    }, [dateStr]);

    const [rizeData, setRizeData] = useState(null);
    const [rizeLoading, setRizeLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setRizeLoading(true);
        getRizeSessions(dateStr).then(data => {
            if (!cancelled) setRizeData(data);
        }).catch(() => {
            if (!cancelled) setRizeData(null);
        }).finally(() => {
            if (!cancelled) setRizeLoading(false);
        });
        return () => { cancelled = true; };
    }, [dateStr]);

    const rizeEntries = rizeData?.timeEntries || [];
    const rizeCategories = rizeData?.categories || [];
    const rizeTotalSeconds = rizeCategories.reduce((sum, c) => sum + (c.timeSpent || 0), 0);
    const rizeFocusSeconds = rizeCategories.filter(c => c.focus).reduce((sum, c) => sum + (c.timeSpent || 0), 0);

    const rizeByHour = {};
    rizeEntries.forEach(entry => {
        const st = new Date(entry.startTime);
        const et = new Date(entry.endTime);
        const startH = st.getHours();
        const endH = et.getHours() + (et.getMinutes() > 0 ? 1 : 0);
        for (let h = startH; h < Math.min(endH, 24); h++) {
            if (!rizeByHour[h]) rizeByHour[h] = [];
            if (h === startH) rizeByHour[h].push(entry);
        }
    });

    function formatDuration(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    }

    function formatRizeTime(isoStr) {
        const d = new Date(isoStr);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    const [mobileTab, setMobileTab] = useState('schedule');
    const dayName = DAYS[date.getDay()];
    const COL = "border-l border-gray-200 dark:border-gray-700";

    return (
        <div className="padding-x py-4 max-lg:mt-12 dark:bg-black dark:text-white min-h-screen">
            <input ref={memoFileInputRef} type="file" className="hidden" onChange={onMemoFileSelected} />
            <input ref={newMemoFileInputRef} type="file" className="hidden" onChange={onNewMemoFileSelected} />
            <div className="flex items-end gap-4 mb-4">
                <div>
                    <h2 className="text-3xl font-black leading-none tracking-tight">{date.getFullYear()}</h2>
                    <h3 className="text-3xl font-black leading-none tracking-tight">{String(date.getMonth() + 1).padStart(2, '0')}</h3>
                </div>
            </div>
            <div className="text-center mb-4">
                <h2 className={`text-5xl font-bold ${isPublicHoliday(date) ? 'text-red-500' : isToday ? 'text-blue-600' : ''}`}>
                    {String(date.getDate()).padStart(2, '0')}
                </h2>
                <p className={`text-sm ${isPublicHoliday(date) ? 'text-red-400' : 'text-gray-400'}`}>{dayName}</p>
            </div>

            <div className="max-w-3xl mx-auto mb-4">
                <DayMacroCoaching date={dateStr} title={isToday ? '今日營養素' : `${dateStr} 營養素`} emptyHint="當日未有飲食記錄" />
            </div>

            <div className="lg:hidden flex gap-1 mb-3">
                {[
                    { key: 'schedule', label: 'Schedule', icon: 'fa-clock' },
                    { key: 'actual', label: 'Actual', icon: 'fa-chart-bar' },
                    { key: 'someday', label: 'Someday', icon: 'fa-inbox' },
                    { key: 'reflection', label: '三省吾身', icon: 'fa-feather-pointed' },
                    { key: 'memo', label: 'Memo', icon: 'fa-note-sticky' },
                ].map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setMobileTab(tab.key)}
                        className={`flex-1 text-xs py-2 rounded-lg font-medium transition ${
                            mobileTab === tab.key
                                ? 'bg-black text-white dark:bg-white dark:text-black'
                                : 'bg-gray-100 dark:bg-gray-900 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-800'
                        }`}
                    >
                        <i className={`fa-solid ${tab.icon} mr-1.5`} />
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="max-w-6xl mx-auto hidden lg:flex">
                <div className="flex-[3] flex min-w-0">
                    <div className="w-10 flex-shrink-0" />
                    <div className="flex-1 text-center py-1">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Preview</span>
                    </div>
                    <div className="flex-1 text-center py-1">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">To Do</span>
                    </div>
                </div>
                <div className="flex-[4] flex min-w-0">
                    <div className="flex-1 text-center py-1">
                        <span className="text-xs font-bold text-emerald-500 uppercase tracking-wider">Actual</span>
                    </div>
                    <div className="flex-1 text-center py-1">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Someday</span>
                    </div>
                    <div className="flex-1 text-center py-1">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">三省吾身</span>
                    </div>
                    <div className="flex-1 text-center py-1">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Memo</span>
                    </div>
                </div>
            </div>

            {/* Mobile: Schedule tab */}
            {mobileTab === 'schedule' && (
                <div className="lg:hidden border-t border-gray-200 dark:border-gray-700">
                    {multiDayTasks.length > 0 && (
                        <div className="border-b border-gray-200 dark:border-gray-700 px-1 py-1.5">
                            {multiDayTasks.map(task => {
                                const startDateLabel = formatDateLabel(task.date);
                                const endDateLabel = formatDateLabel(task.endDate);
                                const startTimeLabel = task.startTime || '';
                                const endTimeLabel = task.endTime === '24:00' ? '' : (task.endTime || '');
                                return (
                                    <div key={task.id}
                                         className="rounded-md px-2.5 py-1.5 mb-1 cursor-pointer hover:opacity-80 transition"
                                         style={{ backgroundColor: '#d5ffa9' }}
                                         onClick={() => {
                                             if (document.querySelector('.blur-bg.active')) return;
                                             openForm("task-menu");
                                             setTaskData({ ...task, onTasksChanged });
                                         }}>
                                        <div className="flex items-center gap-1">
                                            {task.repeatSeriesId && (
                                                <i className={`fa-solid fa-rotate text-[10px] flex-shrink-0 pointer-events-none ${task.repeatEndedAt ? 'text-gray-400' : 'text-gray-500 opacity-70'}`}
                                                   aria-label={formatRepeatTooltip(task)}
                                                   title={formatRepeatTooltip(task)} />
                                            )}
                                            <span className={`text-sm font-bold text-gray-800 ${task.done ? 'line-through opacity-40' : ''}`}>
                                                {task.name}
                                            </span>
                                            {task.repeatSeriesId && task.repeatEndedAt && (
                                                isFinalRecurringOccurrence(task) ? (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-semibold uppercase tracking-wide text-[9px] whitespace-nowrap"
                                                          title={`Final occurrence (series ends ${formatRepeatEndShort(task.repeatEndedAt)})`}>
                                                        <i className="fa-solid fa-flag-checkered text-[8px]" />
                                                        last
                                                    </span>
                                                ) : (
                                                    <span className="text-[9px] text-gray-500 whitespace-nowrap"
                                                          title={formatRepeatTooltip(task)}>
                                                        ends {formatRepeatEndShort(task.repeatEndedAt)}
                                                    </span>
                                                )
                                            )}
                                        </div>
                                        <div className="text-[9px] text-gray-400 mt-0.5">
                                            {startDateLabel}{startTimeLabel ? ` ${startTimeLabel}` : ''} — {endDateLabel}{endTimeLabel ? ` ${endTimeLabel}` : ''}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div className="border-b border-gray-100 dark:border-gray-800 px-2 py-2">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">No Time</span>
                        {todoNoTime.map((task, i) => (
                            <div key={task.id} className="py-0.5">
                                <Task data={task} taskListInd={0} date={date}
                                      tasksCol={allTodoTasks.length} ind={i}
                                      onTasksChanged={onTasksChanged} />
                            </div>
                        ))}
                        <AddTaskInput date={dateStr} tasksData={allTodoTasks} onTasksChanged={onTasksChanged} placeholder="+ Add task..." />
                    </div>

                    <div ref={mobilePreviewColRef} onTouchMove={handlePreviewTouchMove}>
                    {HOURS.map(hour => {
                        const label = String(hour).padStart(2, '0');
                        const hourTodo = todoByHour[hour] || [];
                        const isNow = isToday && hour === currentHour;
                        const inSelection = isHourInSelection(hour);
                        const selRange = getSelectionRange();
                        const isSlotStart = slotInput && hour === slotInput.start;
                        const isSlotEnd = slotInput && hour === slotInput.end - 1;
                        const inSlot = slotInput && hour >= slotInput.start && hour < slotInput.end;
                        const previewForHour = previewTasks[hour] || [];
                        const isOccupied = !!previewTasks[hour];

                        return (
                            <div key={hour} className="flex" style={{ minHeight: '36px' }}>
                                <div className="w-10 flex-shrink-0 text-right pr-2 pt-1.5">
                                    <span className={`text-[11px] leading-none ${isNow ? 'text-blue-600 font-bold' : 'text-gray-300'}`}>
                                        {label}
                                    </span>
                                </div>
                                <div
                                    className={`flex-1 border-l border-gray-200 dark:border-gray-700 relative select-none ${inSelection && !slotInput ? 'bg-blue-50 dark:bg-blue-900/30' : ''} ${inSlot ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                                    data-preview-hour={hour}
                                    onMouseDown={e => handlePreviewMouseDown(hour, e)}
                                    onMouseEnter={() => handlePreviewMouseEnter(hour)}
                                    onTouchStart={e => handlePreviewTouchStart(hour, e)}
                                    style={{ cursor: slotInput ? 'default' : 'crosshair', zIndex: previewForHour.length > 0 ? 10 : 'auto' }}
                                >
                                    {previewForHour.map(t => {
                                        const sH = parseInt(t.startTime.split(':')[0]);
                                        const eH = parseInt(t.endTime.split(':')[0]);
                                        const spanHours = eH - sH;
                                        return (
                                            <div key={t.id}
                                                 className="absolute left-0 right-0 mx-0.5 rounded bg-blue-200/60 dark:bg-blue-800/40 border border-blue-300 dark:border-blue-700 px-1.5 py-0.5 cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800/60 transition"
                                                 style={{ top: 0, height: `${spanHours * 36}px`, zIndex: 10, overflow: 'hidden' }}
                                                 onClick={(e) => {
                                                     e.stopPropagation();
                                                     if (document.querySelector('.blur-bg.active')) return;
                                                     openForm("task-menu");
                                                     setTaskData({ ...t, onTasksChanged });
                                                 }}
                                                 onMouseDown={e => e.stopPropagation()}
                                            >
                                                <span className="text-xs font-medium text-blue-700 dark:text-blue-300 truncate block">{t.name}</span>
                                                <span className="text-[9px] text-blue-500 dark:text-blue-400 font-mono">{t.startTime}-{t.endTime}</span>
                                            </div>
                                        );
                                    })}
                                    {isSlotStart && slotInput && (
                                        <TimeSlotInput
                                            startHour={slotInput.start}
                                            endHour={slotInput.end}
                                            dateStr={dateStr}
                                            onDone={() => { clearDragSelection(); if (onTasksChanged) onTasksChanged(); }}
                                            onCancel={clearDragSelection}
                                        />
                                    )}
                                </div>
                                <div className="flex-1 border-l border-gray-200 dark:border-gray-700 overflow-hidden">
                                    {hourTodo.map((task, i) => (
                                        <div key={task.id} className="px-1 py-0.5">
                                            <Task data={task} taskListInd={0} date={date}
                                                  tasksCol={allTodoTasks.length} ind={i}
                                                  onTasksChanged={onTasksChanged} />
                                        </div>
                                    ))}
                                    <HourCellInput dateStr={dateStr} hour={hour} done={false} onTasksChanged={onTasksChanged} />
                                </div>
                            </div>
                        );
                    })}
                    </div>
                </div>
            )}

            {/* Mobile: Actual tab (Rize) */}
            {mobileTab === 'actual' && (
                <div className="lg:hidden border-t border-gray-200 dark:border-gray-700">
                    {rizeData && (
                        <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                            <div className="flex gap-2 mb-2">
                                <div className="flex-1 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-2 text-center">
                                    <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{formatDuration(rizeTotalSeconds)}</p>
                                    <p className="text-[10px] text-emerald-500">Total</p>
                                </div>
                                <div className="flex-1 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2 text-center">
                                    <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{formatDuration(rizeFocusSeconds)}</p>
                                    <p className="text-[10px] text-blue-500">Focus</p>
                                </div>
                                <div className="flex-1 bg-purple-50 dark:bg-purple-900/20 rounded-lg p-2 text-center">
                                    <p className="text-lg font-bold text-purple-600 dark:text-purple-400">{rizeEntries.length}</p>
                                    <p className="text-[10px] text-purple-500">Sessions</p>
                                </div>
                            </div>
                            {rizeCategories.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                    {rizeCategories.sort((a, b) => b.timeSpent - a.timeSpent).map(c => (
                                        <span key={c.key} className={`text-[10px] px-2 py-0.5 rounded-full ${c.focus ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                                            {c.name} · {formatDuration(c.timeSpent)}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    {rizeLoading && (
                        <div className="text-center py-4 text-gray-400">
                            <i className="fa-solid fa-spinner fa-spin text-lg" />
                        </div>
                    )}
                    <div>
                        {HOURS.slice(0, 24).map(hour => {
                            const label = String(hour).padStart(2, '0');
                            const isNow = isToday && hour === currentHour;
                            const hourRize = rizeByHour[hour] || [];
                            const hourTasks = todoByHour[hour] || [];
                            const hourPreview = previewTasks[hour] || [];
                            const hasContent = hourRize.length > 0 || hourTasks.length > 0 || hourPreview.length > 0;

                            return (
                                <div key={hour} className={`flex border-b border-gray-100 dark:border-gray-800 ${isNow ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''}`} style={{ minHeight: hasContent ? 'auto' : '24px' }}>
                                    <div className="w-10 flex-shrink-0 text-right pr-2 pt-1">
                                        <span className={`text-[11px] leading-none font-mono ${isNow ? 'text-emerald-600 font-bold' : 'text-gray-300 dark:text-gray-600'}`}>
                                            {label}
                                        </span>
                                    </div>
                                    <div className="flex-1 border-l border-gray-200 dark:border-gray-700 py-0.5 min-w-0">
                                        {hourPreview.map(t => {
                                            const sH = parseInt(t.startTime.split(':')[0]);
                                            const eH = t.endTime && t.endTime !== '24:00' ? parseInt(t.endTime.split(':')[0]) : sH + 1;
                                            return (
                                                <div key={`preview-${t.id}`}
                                                     className="mx-1 my-0.5 rounded bg-blue-100/80 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 px-2 py-1 cursor-pointer"
                                                     onClick={() => {
                                                         if (document.querySelector('.blur-bg.active')) return;
                                                         openForm("task-menu");
                                                         setTaskData({ ...t, onTasksChanged });
                                                     }}>
                                                    <div className="flex items-center gap-1.5">
                                                        <i className={`fa-${t.done ? 'solid' : 'regular'} fa-circle${t.done ? '-check' : ''} text-[10px] ${t.done ? 'text-blue-400' : 'text-blue-300'}`} />
                                                        <span className={`text-xs font-medium text-blue-700 dark:text-blue-300 truncate ${t.done ? 'line-through opacity-50' : ''}`}>{t.name}</span>
                                                    </div>
                                                    <span className="text-[9px] text-blue-400 font-mono ml-5">{t.startTime}{t.endTime && t.endTime !== '24:00' ? `-${t.endTime}` : ''}</span>
                                                </div>
                                            );
                                        })}
                                        {hourTasks.filter(t => !hourPreview.find(p => p.id === t.id)).map(t => (
                                            <div key={`task-${t.id}`}
                                                 className="mx-1 my-0.5 rounded bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 px-2 py-1 cursor-pointer"
                                                 onClick={() => {
                                                     if (document.querySelector('.blur-bg.active')) return;
                                                     openForm("task-menu");
                                                     setTaskData({ ...t, onTasksChanged });
                                                 }}>
                                                <div className="flex items-center gap-1.5">
                                                    <i className={`fa-${t.done ? 'solid' : 'regular'} fa-circle${t.done ? '-check' : ''} text-[10px] ${t.done ? 'text-green-400' : 'text-gray-300'}`} />
                                                    <span className={`text-xs font-medium text-black dark:text-white truncate ${t.done ? 'line-through opacity-40' : ''}`}>{t.name}</span>
                                                </div>
                                                <span className="text-[9px] text-gray-400 font-mono ml-5">{t.startTime || `${label}:00`}</span>
                                            </div>
                                        ))}
                                        {hourRize.map(entry => (
                                            <div key={`rize-${entry.id}`} className="mx-1 my-0.5 border-l-2 border-emerald-400 pl-1.5 py-0.5">
                                                <div className="flex items-center gap-1">
                                                    <span className="text-[9px] font-mono text-gray-400">{formatRizeTime(entry.startTime)}-{formatRizeTime(entry.endTime)}</span>
                                                    <span className="text-[9px] text-emerald-500 font-medium">{formatDuration(entry.duration)}</span>
                                                </div>
                                                <p className="text-[11px] font-medium leading-tight">{entry.title}</p>
                                            </div>
                                        ))}
                                        <ActualEntryInput key={`${dateStr}-${hour}`} dateStr={dateStr} hour={hour} onTasksChanged={onTasksChanged} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Mobile: Someday tab */}
            {mobileTab === 'someday' && (
                <div className="lg:hidden border-t border-gray-200 dark:border-gray-700 p-2">
                    {somedayTasks.map((task, i) => (
                        <div key={task.id} className="py-0.5">
                            <Task data={task} taskListInd={2} date={date}
                                  tasksCol={somedayTasks.length} ind={i}
                                  onTasksChanged={onTasksChanged} />
                        </div>
                    ))}
                    <AddTaskInput date="notes" tasksData={somedayTasks} onTasksChanged={onTasksChanged} placeholder="+ Add someday..." />
                    {somedayTasks.length === 0 && (
                        <div className="text-center py-12 text-gray-400">
                            <i className="fa-regular fa-inbox text-3xl mb-2" />
                            <p className="text-xs">Tasks without a date go here</p>
                        </div>
                    )}
                </div>
            )}

            {/* Mobile: Reflection tab */}
            {mobileTab === 'reflection' && (
                <div className="lg:hidden border-t border-gray-200 dark:border-gray-700">
                    <ReflectionColumn dateStr={dateStr} dayMemos={dayMemos} setDayMemos={setDayMemos} variant="mobile" />
                </div>
            )}

            {/* Mobile: Memo tab */}
            {mobileTab === 'memo' && (
                <div className="lg:hidden border-t border-gray-200 dark:border-gray-700 p-2">
                    {dayMemos.map(m => {
                        const files = m.files || [];
                        const hasText = !!m.content?.trim();
                        const allImages = files.length > 0 && files.every(f => f.mimeType && f.mimeType.startsWith('image/'));
                        const imageOnly = !hasText && allImages;

                        return imageOnly ? (
                            <div key={m.id} className="mb-3 border-b border-gray-100 dark:border-gray-800 pb-2">
                                <div className="space-y-1">
                                    {files.map(f => (
                                        <div key={f.id} className="relative group">
                                            <a href={f.url} target="_blank" rel="noreferrer">
                                                <img src={f.url} alt={f.originalName} className="w-full rounded object-contain" />
                                            </a>
                                            <button onClick={() => handleDeleteMemoFile(f.id)}
                                                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-black/50 text-white rounded-full w-4 h-4 flex items-center justify-center text-[8px] hover:bg-red-500 transition">
                                                <i className="fa-solid fa-xmark" />
                                            </button>
                                        </div>
                                    ))}
                                    <div className="flex justify-end gap-1">
                                        <button onClick={() => handleUploadFile(m.id)}
                                                className="text-gray-400 hover:text-gray-600 text-xs" title="Attach">
                                            <i className="fa-solid fa-paperclip" />
                                        </button>
                                        <button onClick={() => handleDeleteMemo(m.id)}
                                                className="text-gray-400 hover:text-red-400 text-xs" title="Delete">
                                            <i className="fa-solid fa-xmark" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div key={m.id} className="mb-3 border-b border-gray-100 dark:border-gray-800 pb-2">
                                <div className="flex items-start gap-1">
                                    <textarea
                                        value={m.content}
                                        onChange={e => handleMemoContentChange(m.id, e.target.value)}
                                        className="w-full bg-transparent text-sm focus:outline-none resize-none placeholder-gray-400 min-h-[40px]"
                                        placeholder="Write memo..."
                                        rows={2}
                                    />
                                    <div className="flex flex-col gap-1 flex-shrink-0">
                                        <button onClick={() => handleUploadFile(m.id)}
                                                className="text-gray-400 hover:text-gray-600 text-xs" title="Attach">
                                            <i className="fa-solid fa-paperclip" />
                                        </button>
                                        <button onClick={() => handleDeleteMemo(m.id)}
                                                className="text-gray-400 hover:text-red-400 text-xs" title="Delete">
                                            <i className="fa-solid fa-xmark" />
                                        </button>
                                    </div>
                                </div>
                                {files.length > 0 && (
                                    <div className="mt-1 space-y-1">
                                        {files.map(f => (
                                            f.mimeType && f.mimeType.startsWith('image/') ? (
                                                <div key={f.id} className="relative group">
                                                    <a href={f.url} target="_blank" rel="noreferrer">
                                                        <img src={f.url} alt={f.originalName} className="w-full rounded object-contain" />
                                                    </a>
                                                    <button onClick={() => handleDeleteMemoFile(f.id)}
                                                            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-black/50 text-white rounded-full w-4 h-4 flex items-center justify-center text-[8px] hover:bg-red-500 transition">
                                                        <i className="fa-solid fa-xmark" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div key={f.id} className="flex items-start gap-1 group">
                                                    <i className="fa-solid fa-file text-gray-400 text-[10px] flex-shrink-0 mt-0.5" />
                                                    <a href={f.url} target="_blank" rel="noreferrer"
                                                       className="text-blue-500 hover:underline flex-1 text-[10px] break-words">
                                                        {f.originalName}
                                                    </a>
                                                    <button onClick={() => handleDeleteMemoFile(f.id)}
                                                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 text-[10px] flex-shrink-0">
                                                        <i className="fa-solid fa-xmark" />
                                                    </button>
                                                </div>
                                            )
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    <div className="flex items-center gap-1">
                        <input
                            type="text"
                            value={newMemoText}
                            onChange={e => setNewMemoText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddMemo(); } }}
                            placeholder="+ New memo..."
                            className="flex-1 bg-transparent text-sm focus:outline-none placeholder-gray-400 py-1"
                        />
                        <button onClick={handleNewMemoWithFile}
                                className="text-gray-400 hover:text-gray-600 text-xs" title="New memo with file">
                            <i className="fa-solid fa-paperclip" />
                        </button>
                    </div>
                    {dayMemos.length === 0 && !newMemoText && (
                        <div className="text-center py-12 text-gray-400">
                            <i className="fa-regular fa-note-sticky text-3xl mb-2" />
                            <p className="text-xs">No memos for this day</p>
                        </div>
                    )}
                </div>
            )}

            <div className="max-w-6xl mx-auto hidden lg:flex border-t border-gray-200 dark:border-gray-700">
                <div ref={todoColRef} className="flex-[3] min-w-0">
                    {multiDayTasks.length > 0 && (
                        <div className="border-b border-gray-200 dark:border-gray-700 px-1 py-1.5">
                            {multiDayTasks.map(task => {
                                const startDateLabel = formatDateLabel(task.date);
                                const endDateLabel = formatDateLabel(task.endDate);
                                const startTimeLabel = task.startTime || '';
                                const endTimeLabel = task.endTime === '24:00' ? '' : (task.endTime || '');
                                const subs = task.subtasks || [];
                                return (
                                    <div key={task.id}
                                         className="rounded-md px-2.5 py-1.5 mb-1 cursor-pointer hover:opacity-80 transition"
                                         style={{ backgroundColor: '#d5ffa9' }}
                                         onClick={() => {
                                             if (document.querySelector('.blur-bg.active')) return;
                                             openForm("task-menu");
                                             setTaskData({ ...task, onTasksChanged });
                                         }}>
                                        <div className="flex items-center justify-center gap-1 mb-1">
                                            {task.repeatSeriesId && (
                                                <i className={`fa-solid fa-rotate text-[10px] flex-shrink-0 pointer-events-none ${task.repeatEndedAt ? 'text-gray-400' : 'text-gray-500 opacity-70'}`}
                                                   aria-label={formatRepeatTooltip(task)}
                                                   title={formatRepeatTooltip(task)} />
                                            )}
                                            <span className={`text-[15px] font-bold text-gray-800 truncate ${task.done ? 'line-through opacity-40' : ''}`}>
                                                {task.name}
                                            </span>
                                            {task.repeatSeriesId && task.repeatEndedAt && (
                                                isFinalRecurringOccurrence(task) ? (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-semibold uppercase tracking-wide text-[9px] whitespace-nowrap"
                                                          title={`Final occurrence (series ends ${formatRepeatEndShort(task.repeatEndedAt)})`}>
                                                        <i className="fa-solid fa-flag-checkered text-[8px]" />
                                                        last
                                                    </span>
                                                ) : (
                                                    <span className="text-[9px] text-gray-500 whitespace-nowrap"
                                                          title={formatRepeatTooltip(task)}>
                                                        ends {formatRepeatEndShort(task.repeatEndedAt)}
                                                    </span>
                                                )
                                            )}
                                        </div>
                                        {subs.length > 0 && (
                                            <div className="mb-1.5">
                                                {subs.slice(0, 4).map(sub => (
                                                    <div key={sub.id} className="flex items-center gap-1 py-0.5">
                                                        <i className={`fa-${sub.done ? 'solid' : 'regular'} fa-circle${sub.done ? '-check' : ''} text-[8px] ${sub.done ? 'text-green-400' : 'text-gray-300 dark:text-gray-500'}`} />
                                                        <span className={`text-[10px] leading-tight truncate ${sub.done ? 'line-through text-gray-400' : 'text-gray-500 dark:text-gray-400'}`}>
                                                            {sub.name}
                                                        </span>
                                                    </div>
                                                ))}
                                                {subs.length > 4 && <span className="text-[9px] text-gray-400">+{subs.length - 4} more</span>}
                                            </div>
                                        )}
                                        <div className="flex items-center gap-1">
                                            <span className="text-[9px] text-gray-400 leading-none whitespace-nowrap">
                                                {startDateLabel}{startTimeLabel ? ` ${startTimeLabel}` : ''}
                                            </span>
                                            <div className="flex items-center flex-1 mx-0.5">
                                                <span className="text-gray-400 text-xs leading-none select-none">&laquo;</span>
                                                <div className="flex-1 border-t border-gray-300 dark:border-gray-500 mx-0.5" />
                                                <span className="text-gray-400 text-xs leading-none select-none">&raquo;</span>
                                            </div>
                                            <span className="text-[9px] text-gray-400 leading-none whitespace-nowrap">
                                                {endDateLabel}{endTimeLabel ? ` ${endTimeLabel}` : ''}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div className="flex border-b border-gray-100 dark:border-gray-800" style={{ minHeight: '36px' }}>
                        <div className="w-10 flex-shrink-0 text-right pr-2 pt-1.5">
                            <span className="text-[11px] leading-none text-gray-400">--</span>
                        </div>
                        <div className={`flex-1 ${COL} overflow-hidden`}>
                        </div>
                        <div className={`flex-1 ${COL} overflow-hidden`}>
                            {todoNoTime.map((task, i) => (
                                <div key={task.id} className="px-1 py-0.5">
                                    <Task data={task} taskListInd={0} date={date}
                                          tasksCol={allTodoTasks.length} ind={i}
                                          onTasksChanged={onTasksChanged} />
                                </div>
                            ))}
                            <div className="px-1">
                                <AddTaskInput
                                    date={dateStr}
                                    tasksData={allTodoTasks}
                                    onTasksChanged={onTasksChanged}
                                    placeholder=""
                                />
                            </div>
                        </div>
                    </div>

                    <div ref={previewColRef} onTouchMove={handlePreviewTouchMove}>
                    {HOURS.map(hour => {
                        const label = String(hour).padStart(2, '0');
                        const hourTodo = todoByHour[hour] || [];
                        const isNow = isToday && hour === currentHour;
                        const inSelection = isHourInSelection(hour);
                        const selRange = getSelectionRange();
                        const isSlotStart = slotInput && hour === slotInput.start;
                        const isSlotEnd = slotInput && hour === slotInput.end - 1;
                        const inSlot = slotInput && hour >= slotInput.start && hour < slotInput.end;
                        const previewForHour = previewTasks[hour] || [];
                        const isOccupied = !!previewTasks[hour];

                        return (
                            <div key={hour} className="flex" style={{ minHeight: '28px' }}>
                                <div className="w-10 flex-shrink-0 text-right pr-2 pt-0.5">
                                    <span className={`text-[11px] leading-none ${isNow ? 'text-blue-600 font-bold' : 'text-gray-300'}`}>
                                        {label}
                                    </span>
                                </div>
                                <div
                                    className={`flex-1 ${COL} relative select-none ${inSelection && !slotInput ? 'bg-blue-50 dark:bg-blue-900/30' : ''} ${inSlot ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                                    data-preview-hour={hour}
                                    onMouseDown={e => handlePreviewMouseDown(hour, e)}
                                    onMouseEnter={() => handlePreviewMouseEnter(hour)}
                                    onTouchStart={e => handlePreviewTouchStart(hour, e)}
                                    style={{ cursor: slotInput ? 'default' : 'crosshair', zIndex: previewForHour.length > 0 ? 10 : 'auto' }}
                                >
                                    {previewForHour.map(t => {
                                        const sH = parseInt(t.startTime.split(':')[0]);
                                        const eH = parseInt(t.endTime.split(':')[0]);
                                        const spanHours = eH - sH;
                                        return (
                                            <div key={t.id}
                                                 className="absolute left-0 right-0 mx-0.5 rounded bg-blue-200/60 dark:bg-blue-800/40 border border-blue-300 dark:border-blue-700 px-1 py-0.5 cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800/60 transition"
                                                 style={{ top: 0, height: `${spanHours * 28}px`, zIndex: 10, overflow: 'hidden' }}
                                                 onClick={(e) => {
                                                     e.stopPropagation();
                                                     if (document.querySelector('.blur-bg.active')) return;
                                                     openForm("task-menu");
                                                     setTaskData({ ...t, onTasksChanged });
                                                 }}
                                                 onMouseDown={e => e.stopPropagation()}
                                            >
                                                <span className="text-[10px] font-medium text-blue-700 dark:text-blue-300 truncate block">{t.name}</span>
                                                <span className="text-[8px] text-blue-500 dark:text-blue-400 font-mono">{t.startTime}-{t.endTime}</span>
                                            </div>
                                        );
                                    })}
                                    {isSlotStart && slotInput && (
                                        <TimeSlotInput
                                            startHour={slotInput.start}
                                            endHour={slotInput.end}
                                            dateStr={dateStr}
                                            onDone={() => { clearDragSelection(); if (onTasksChanged) onTasksChanged(); }}
                                            onCancel={clearDragSelection}
                                        />
                                    )}
                                </div>
                                <div className={`flex-1 ${COL} overflow-hidden`}>
                                    {hourTodo.map((task, i) => (
                                        <div key={task.id} className="px-1 py-0.5">
                                            <Task data={task} taskListInd={0} date={date}
                                                  tasksCol={allTodoTasks.length} ind={i}
                                                  onTasksChanged={onTasksChanged} />
                                        </div>
                                    ))}
                                    <HourCellInput dateStr={dateStr} hour={hour} done={false} onTasksChanged={onTasksChanged} />
                                </div>
                            </div>
                        );
                    })}
                    </div>
                </div>

                <div className="flex-[4] flex min-w-0">
                    <div className={`flex-1 ${COL}`}>
                        {rizeData && (
                            <div className="px-1 py-1 border-b border-gray-100 dark:border-gray-800">
                                <div className="flex gap-1 mb-1">
                                    <div className="flex-1 bg-emerald-50 dark:bg-emerald-900/20 rounded px-1.5 py-0.5 text-center">
                                        <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{formatDuration(rizeTotalSeconds)}</p>
                                        <p className="text-[7px] text-emerald-500">Total</p>
                                    </div>
                                    <div className="flex-1 bg-blue-50 dark:bg-blue-900/20 rounded px-1.5 py-0.5 text-center">
                                        <p className="text-xs font-bold text-blue-600 dark:text-blue-400">{formatDuration(rizeFocusSeconds)}</p>
                                        <p className="text-[7px] text-blue-500">Focus</p>
                                    </div>
                                </div>
                            </div>
                        )}
                        {HOURS.slice(0, 24).map(hour => {
                            const hourRize = rizeByHour[hour] || [];
                            const completed = (todoByHour[hour] || []).filter(task => task.done);
                            return (
                                <div key={hour} className="border-b border-gray-50 dark:border-gray-900" style={{ minHeight: '28px' }}>
                                    {completed.map(task => (
                                        <button key={`actual-${task.id}`} type="button"
                                            className="block w-full text-left px-1 py-1 text-xs text-emerald-700 dark:text-emerald-300"
                                            onClick={() => {
                                                if (document.querySelector('.blur-bg.active')) return;
                                                openForm("task-menu");
                                                setTaskData({ ...task, onTasksChanged });
                                            }}>
                                            <span className="text-[9px] mr-1">{task.startTime}</span>
                                            {task.name}
                                        </button>
                                    ))}
                                    {hourRize.map(entry => (
                                        <div key={entry.id} className="mx-0.5 my-0.5 border-l-2 border-emerald-400 pl-1 py-0.5">
                                            <div className="flex items-center gap-0.5">
                                                <span className="text-[7px] font-mono text-gray-400">{formatRizeTime(entry.startTime)}-{formatRizeTime(entry.endTime)}</span>
                                                <span className="text-[7px] text-emerald-500">{formatDuration(entry.duration)}</span>
                                            </div>
                                            <p className="text-[9px] font-medium leading-tight truncate">{entry.title}</p>
                                        </div>
                                    ))}
                                    <ActualEntryInput key={`${dateStr}-${hour}`} dateStr={dateStr} hour={hour} onTasksChanged={onTasksChanged} />
                                </div>
                            );
                        })}
                    </div>
                    <div ref={somedayColRef} className={`flex-1 ${COL} overflow-hidden`}>
                        {somedayTasks.map((task, i) => (
                            <div key={task.id} className="px-1 py-0.5">
                                <Task data={task} taskListInd={2} date={date}
                                      tasksCol={somedayTasks.length} ind={i}
                                      onTasksChanged={onTasksChanged} />
                            </div>
                        ))}
                        <div className="px-1 pb-2">
                            <AddTaskInput
                                date="notes"
                                tasksData={somedayTasks}
                                onTasksChanged={onTasksChanged}
                                placeholder="+ Add someday..."
                            />
                        </div>
                    </div>

                    <div className={`flex-1 ${COL} overflow-y-auto`}>
                        <ReflectionColumn dateStr={dateStr} dayMemos={dayMemos} setDayMemos={setDayMemos} variant="desktop" />
                    </div>

                    <div className={`flex-1 ${COL} overflow-hidden relative`}
                         onDrop={handleMemoDrop} onDragOver={handleMemoDragOver} onDragLeave={handleMemoDragLeave}>
                        {draggingOver && (
                            <div className="absolute inset-0 bg-blue-50 dark:bg-blue-900/30 border-2 border-dashed border-blue-300 dark:border-blue-600 rounded z-10 flex items-center justify-center">
                                <div className="text-blue-400 text-sm font-medium flex flex-col items-center gap-1">
                                    <i className="fa-solid fa-cloud-arrow-up text-2xl" />
                                    <span>Drop to add memo</span>
                                </div>
                            </div>
                        )}
                        <div className="p-2">
                            {dayMemos.map(m => {
                                const files = m.files || [];
                                const hasText = !!m.content?.trim();
                                const allImages = files.length > 0 && files.every(f => f.mimeType && f.mimeType.startsWith('image/'));
                                const imageOnly = !hasText && allImages;

                                return imageOnly ? (
                                    <div key={m.id} className="mb-3 border-b border-gray-100 dark:border-gray-800 pb-2">
                                        <div className="space-y-1">
                                            {files.map(f => (
                                                <div key={f.id} className="relative group">
                                                    <a href={f.url} target="_blank" rel="noreferrer">
                                                        <img src={f.url} alt={f.originalName} className="w-full rounded object-contain" />
                                                    </a>
                                                    <button onClick={() => handleDeleteMemoFile(f.id)}
                                                            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-black/50 text-white rounded-full w-4 h-4 flex items-center justify-center text-[8px] hover:bg-red-500 transition">
                                                        <i className="fa-solid fa-xmark" />
                                                    </button>
                                                </div>
                                            ))}
                                            <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100">
                                                <button onClick={() => handleUploadFile(m.id)}
                                                        className="text-gray-300 hover:text-gray-500 text-[10px] cursor-pointer" title="Attach">
                                                    <i className="fa-solid fa-paperclip" />
                                                </button>
                                                <button onClick={() => handleDeleteMemo(m.id)}
                                                        className="text-gray-300 hover:text-red-400 text-[10px] cursor-pointer" title="Delete">
                                                    <i className="fa-solid fa-xmark" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div key={m.id} className="mb-3 border-b border-gray-100 dark:border-gray-800 pb-2">
                                        <div className="flex items-start gap-1">
                                            <textarea
                                                value={m.content}
                                                onChange={e => handleMemoContentChange(m.id, e.target.value)}
                                                className="w-full bg-transparent text-sm focus:outline-none resize-none placeholder-gray-400 min-h-[40px]"
                                                placeholder="Write memo..."
                                                rows={2}
                                            />
                                            <div className="flex flex-col gap-1 flex-shrink-0">
                                                <button onClick={() => handleUploadFile(m.id)}
                                                        className="text-gray-300 hover:text-gray-500 text-[10px] cursor-pointer" title="Attach">
                                                    <i className="fa-solid fa-paperclip" />
                                                </button>
                                                <button onClick={() => handleDeleteMemo(m.id)}
                                                        className="text-gray-300 hover:text-red-400 text-[10px] cursor-pointer" title="Delete">
                                                    <i className="fa-solid fa-xmark" />
                                                </button>
                                            </div>
                                        </div>
                                        {files.length > 0 && (
                                            <div className="mt-1 space-y-1">
                                                {files.map(f => (
                                                    f.mimeType && f.mimeType.startsWith('image/') ? (
                                                        <div key={f.id} className="relative group">
                                                            <a href={f.url} target="_blank" rel="noreferrer">
                                                                <img src={f.url} alt={f.originalName} className="w-full rounded object-contain" />
                                                            </a>
                                                            <button onClick={() => handleDeleteMemoFile(f.id)}
                                                                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-black/50 text-white rounded-full w-4 h-4 flex items-center justify-center text-[8px] hover:bg-red-500 transition">
                                                                <i className="fa-solid fa-xmark" />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div key={f.id} className="flex items-start gap-1 group">
                                                            <i className="fa-solid fa-file text-gray-400 text-[10px] flex-shrink-0 mt-0.5" />
                                                            <a href={f.url} target="_blank" rel="noreferrer"
                                                               className="text-blue-500 hover:underline flex-1 text-[10px] break-words whitespace-normal">
                                                                {f.originalName}
                                                            </a>
                                                            <button onClick={() => handleDeleteMemoFile(f.id)}
                                                                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 text-[10px] flex-shrink-0">
                                                                <i className="fa-solid fa-xmark" />
                                                            </button>
                                                        </div>
                                                    )
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            <div className="flex items-center gap-1">
                                <input
                                    type="text"
                                    value={newMemoText}
                                    onChange={e => setNewMemoText(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddMemo(); } }}
                                    placeholder="+ New memo..."
                                    className="flex-1 bg-transparent text-xs focus:outline-none placeholder-gray-400 py-1"
                                />
                                <button onClick={handleNewMemoWithFile}
                                        className="text-gray-300 hover:text-gray-500 text-[10px] cursor-pointer" title="New memo with file">
                                    <i className="fa-solid fa-paperclip" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
