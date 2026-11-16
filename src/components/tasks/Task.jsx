import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useSearchParams } from "react-router-dom";
import { toggleDoneTask, uploadTaskFile, tryCatchDecorator } from "../../scripts/api.js";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useTaskMenu } from "../../contexts/TaskMenuContext.jsx";
import { openForm, formatRepeatTooltip, formatRepeatEndShort, horizonLabel, getHorizonDaysFromTemplate, isFinalRecurringOccurrence } from "../../scripts/utils.js";
import { QUADRANT_DOT, isCalendarDate, formatDeadline } from "../../constants/eisenhower.js";

export default function Task({ taskListInd, ind, data, date, tasksCol, onTasksChanged, showDeadline }) {

    const MAX_TASK_NAME_LENGTH = 20;

    const [searchParams] = useSearchParams();

    async function handleToggleDone(ev) {
        ev.stopPropagation();
        const wasDone = data.done;
        let scope = "one";
        if (data.repeatSeriesId) {
            const verb = wasDone ? "uncomplete" : "complete";
            const applyAll = window.confirm(`This task repeats. Apply ${verb} to ALL occurrences in the series?\n\nClick OK for the whole series, Cancel for just this one.`);
            if (applyAll) scope = "series";
        }
        await toggleDoneTask(data.id, scope);
        if (!wasDone) {
            window.dispatchEvent(new CustomEvent("journal:taskCompleted", { detail: { id: data.id, name: data.name } }));
        }
        if (onTasksChanged) onTasksChanged();
    }

    const { setTaskData } = useTaskMenu();

    function openTaskMenu() {
        if (document.querySelector('.blur-bg.active')) return;
        openForm("task-menu");
        setTaskData({ ...data, onTasksChanged });
    }

    useEffect(() => {
        const openedTask = searchParams.get("openedTask");
        if (openedTask && openedTask == data.id) {
            openForm("task-menu");
            setTaskData({ ...data, onTasksChanged });
        }
    }, [searchParams]);

    const quadrantDot = data.eisenhowerQuadrant ? QUADRANT_DOT[data.eisenhowerQuadrant] : null;
    const hasDeadline = showDeadline && isCalendarDate(data.date);
    const deadline = hasDeadline ? formatDeadline(data.date) : null;

    function formatReminderTime(r) {
        if (!r) return null;
        const d = new Date(r);
        if (isNaN(d.getTime())) return null;
        const h = d.getHours();
        const m = d.getMinutes();
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const timeStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        const dateStr = `${d.getDate()} ${months[d.getMonth()]}`;
        const now = new Date();
        now.setHours(0,0,0,0);
        const rDate = new Date(d);
        rDate.setHours(0,0,0,0);
        const isPast = rDate < now;
        return { timeStr, dateStr, isPast };
    }

    const reminderInfo = formatReminderTime(data.reminder);
    const displayTime = data.startTime || null;
    const horizonDaysOverride = data.repeatSeriesId ? getHorizonDaysFromTemplate(data.repeatTemplate) : null;
    const horizonText = horizonDaysOverride != null ? horizonLabel(horizonDaysOverride) : '';
    const horizonBadge = horizonText ? `Plans ${horizonText} ahead` : '';

    const [dragOver, setDragOver] = useState(false);
    const taskRef = useRef(null);
    const dataRef = useRef(data);
    dataRef.current = data;
    const onTasksChangedRef = useRef(onTasksChanged);
    onTasksChangedRef.current = onTasksChanged;

    useEffect(() => {
        const el = taskRef.current;
        if (!el) return;
        function isFileDrag(ev) { return ev.dataTransfer && ev.dataTransfer.types && ev.dataTransfer.types.indexOf('Files') !== -1; }
        function onDragOver(ev) {
            if (!isFileDrag(ev)) return;
            ev.preventDefault();
            ev.stopPropagation();
            setDragOver(true);
        }
        function onDragLeave(ev) {
            if (!el.contains(ev.relatedTarget)) setDragOver(false);
        }
        async function onDrop(ev) {
            if (!isFileDrag(ev)) return;
            ev.preventDefault();
            ev.stopPropagation();
            setDragOver(false);
            const files = [...(ev.dataTransfer.files || [])];
            for (const file of files) {
                try { await uploadTaskFile(dataRef.current.id, file); } catch (e) { console.error(e); }
            }
            if (files.length && onTasksChangedRef.current) onTasksChangedRef.current();
        }
        el.addEventListener('dragover', onDragOver, true);
        el.addEventListener('dragleave', onDragLeave, true);
        el.addEventListener('drop', onDrop, true);
        return () => {
            el.removeEventListener('dragover', onDragOver, true);
            el.removeEventListener('dragleave', onDragLeave, true);
            el.removeEventListener('drop', onDrop, true);
        };
    }, []);

    return (
        <div ref={taskRef} className={`w-full group ${dragOver ? 'ring-2 ring-blue-300 dark:ring-blue-600 rounded bg-blue-50/50 dark:bg-blue-900/20' : ''}`}
             data-ind={ind} data-task-id={data.id}>
            <div className="task flex justify-between items-center py-2 px-3 cursor-grab" onClick={openTaskMenu}>
                <div className="flex flex-col gap-0.5 min-w-0">
                    <h5 className={`task-title px-2 py-0.5 rounded-full text-sm bg-${data.color} flex items-center gap-1.5 ` + (data.done && "opacity-30 line-through decoration-2 decoration-gray-500 dark:decoration-gray-400 ") || ''}
                    >
                        {quadrantDot && !showDeadline && (
                            <span className={`w-1.5 h-1.5 rounded-full ${quadrantDot} flex-shrink-0`} title="In Eisenhower Matrix" />
                        )}
                        {data.repeatSeriesId && (
                            <i className={`fa-solid fa-rotate text-[9px] flex-shrink-0 pointer-events-none ${data.repeatEndedAt ? 'text-gray-400 dark:text-gray-500' : 'text-gray-500 dark:text-gray-300 opacity-70'}`}
                               aria-label={formatRepeatTooltip(data)}
                               title={formatRepeatTooltip(data)} />
                        )}
                        {data.description && <i className="fa-regular fa-note-sticky" />}
                        {displayTime && (
                            <span className="text-[10px] text-gray-400 font-normal">{displayTime}</span>
                        )}
                        {' '}{data.name.slice(0, MAX_TASK_NAME_LENGTH) +
                            (data.name.length > MAX_TASK_NAME_LENGTH ? "..." : "")}
                    </h5>
                    {reminderInfo && (
                        <span className={`text-[10px] px-2 flex items-center gap-1 ${reminderInfo.isPast ? 'text-red-500 dark:text-red-400' : 'text-gray-400'}`}>
                            <i className="fa-regular fa-clock text-[9px]" />
                            {reminderInfo.dateStr} {reminderInfo.timeStr}
                        </span>
                    )}
                    {deadline && !reminderInfo && (
                        <span className={`text-[10px] px-2 flex items-center gap-1 ${deadline.isPast ? 'text-red-500 dark:text-red-400' : 'text-blue-500 dark:text-blue-400'}`}>
                            <i className="fa-regular fa-calendar-days text-[9px]" />
                            {deadline.label}
                            {deadline.isPast && <span className="text-red-500"> · overdue</span>}
                        </span>
                    )}
                    {data.repeatSeriesId && data.repeatEndedAt && (
                        isFinalRecurringOccurrence(data) ? (
                            <span className="text-[10px] px-2 flex items-center gap-1"
                                  title={`Final occurrence (series ends ${formatRepeatEndShort(data.repeatEndedAt)})`}>
                                <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-semibold uppercase tracking-wide text-[9px]">
                                    <i className="fa-solid fa-flag-checkered text-[8px]" />
                                    last
                                </span>
                            </span>
                        ) : (
                            <span className="text-[10px] px-2 flex items-center gap-1 text-gray-400 dark:text-gray-500"
                                  title={formatRepeatTooltip(data)}>
                                <i className="fa-solid fa-rotate text-[9px]" />
                                ends {formatRepeatEndShort(data.repeatEndedAt)}
                            </span>
                        )
                    )}
                    {horizonBadge && (
                        <span className="text-[10px] px-2 flex items-center gap-1 text-gray-400 dark:text-gray-500"
                              title={horizonBadge}>
                            <i className="fa-regular fa-eye text-[9px]" />
                            {horizonBadge}
                        </span>
                    )}
                </div>
                <button className={`toggle-done flex-shrink-0 ml-2 ${data.done ? 'block' : 'hidden group-hover:block max-lg:block'}`} onClick={handleToggleDone}>
                    <i className={`fa-${data.done ? "solid" : "regular"} ${data.done && "opacity-50"} fa-circle-check`}></i>
                </button>
            </div>
            {data.subtasks && data.subtasks.length > 0 && (
                <div className="px-5 pb-1">
                    {data.subtasks.map(sub => (
                        <div key={sub.id} className="flex items-center gap-1.5 py-0.5">
                            <i className={`fa-${sub.done ? 'solid' : 'regular'} fa-circle${sub.done ? '-check' : ''} text-[10px] ${sub.done ? 'text-gray-300' : 'text-gray-400'}`} />
                            <span className={`text-[11px] ${sub.done ? 'line-through text-gray-300' : 'text-gray-500 dark:text-gray-400'}`}>
                                {sub.name}
                            </span>
                        </div>
                    ))}
                </div>
            )}
            {data.files && data.files.length > 0 && (
                <div className="px-5 pb-1.5 space-y-1">
                    {data.files.map(f => (
                        f.mimeType && f.mimeType.startsWith('image/') ? (
                            <a key={f.id} href={f.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                                <img src={f.url} alt={f.originalName} className="w-full rounded object-contain" />
                            </a>
                        ) : (
                            <a key={f.id} href={f.url} target="_blank" rel="noreferrer"
                               onClick={e => e.stopPropagation()}
                               className="flex items-center gap-1 text-[10px] text-blue-500 hover:underline break-words">
                                <i className="fa-solid fa-file text-gray-400 flex-shrink-0" />
                                {f.originalName}
                            </a>
                        )
                    ))}
                </div>
            )}
        </div>
    )
}
