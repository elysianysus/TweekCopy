import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formDate, getTasksForDay, isPublicHoliday, parseFormDate, isMultiDayTask, openForm, formatRepeatTooltip, formatRepeatEndShort, isFinalRecurringOccurrence } from '../../scripts/utils.js';
import Task from '../tasks/Task.jsx';
import { ReactSortable } from 'react-sortablejs';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useTaskMenu } from '../../contexts/TaskMenuContext.jsx';
import { createTask, moveTask, reOrderTasks, tryCatchDecorator } from '../../scripts/api.js';
import AddTaskInput from '../tasks/AddTaskInput.jsx';

const DAYS_HEADER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

async function fetchMonthFocus(yearMonth) {
    const res = await fetch(`/api/month-focus/${yearMonth}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
    });
    if (!res.ok) return { line1: "", line2: "", line3: "" };
    return res.json();
}

async function saveMonthFocus(yearMonth, data) {
    await fetch(`/api/month-focus/${yearMonth}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
        },
        body: JSON.stringify(data),
    });
}

function formatDateLabel(dateStr) {
    if (!dateStr) return '';
    const d = parseFormDate(dateStr);
    if (!d) return dateStr;
    return `${d.getDate()}/${d.getMonth() + 1}`;
}

function SpanBar({ task, startCol, endCol, rowIndex, rowTopOffset, onTasksChanged }) {
    const { setTaskData } = useTaskMenu();

    function openTaskMenu() {
        if (document.querySelector('.blur-bg.active')) return;
        openForm("task-menu");
        setTaskData({ ...task, onTasksChanged });
    }

    const startDateLabel = formatDateLabel(task.date);
    const endDateLabel = formatDateLabel(task.endDate);
    const startTimeLabel = task.startTime || '';
    const endTimeLabel = task.endTime === '24:00' ? '' : (task.endTime || '');

    const leftPct = (startCol / 7) * 100;
    const widthPct = ((endCol - startCol + 1) / 7) * 100;

    const subs = task.subtasks || [];

    return (
        <div
            className="absolute z-10 flex flex-col cursor-pointer hover:opacity-80 transition"
            style={{
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                top: `${rowTopOffset}px`,
                paddingLeft: '3px',
                paddingRight: '3px',
            }}
            onClick={openTaskMenu}
        >
            <div className="rounded-md px-2.5 py-1.5" style={{ backgroundColor: '#d5ffa9' }}>
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
                        {subs.length > 4 && (
                            <span className="text-[9px] text-gray-400">+{subs.length - 4} more</span>
                        )}
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
        </div>
    );
}

export default function MonthView({ year, month, tasks, onTasksChanged }) {
    const [, setSearchParams] = useSearchParams();
    const { currentUser } = useAuth();

    const yearMonth = `${year}-${String(month + 1).padStart(2, '0')}`;
    const [focus, setFocus] = useState({ line1: "", line2: "", line3: "" });
    const focusLoaded = useRef(false);

    useEffect(() => {
        focusLoaded.current = false;
        fetchMonthFocus(yearMonth).then(data => {
            setFocus({ line1: data.line1 || "", line2: data.line2 || "", line3: data.line3 || "" });
            focusLoaded.current = true;
        });
    }, [yearMonth]);

    function handleFocusBlur() {
        if (focusLoaded.current) {
            saveMonthFocus(yearMonth, focus);
        }
    }

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let startDay = (new Date(year, month, 1).getDay() + 6) % 7;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    function goToDay(dayNum) {
        const d = new Date(year, month, dayNum);
        setSearchParams(prev => {
            prev.set('view', 'day');
            prev.set('viewDate', formDate(d));
            return prev;
        });
    }

    const weeks = [];
    let currentWeek = new Array(startDay).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
        currentWeek.push(d);
        if (currentWeek.length === 7) {
            weeks.push(currentWeek);
            currentWeek = [];
        }
    }
    if (currentWeek.length > 0) {
        while (currentWeek.length < 7) currentWeek.push(null);
        weeks.push(currentWeek);
    }

    function getDateStr(dayNum) {
        return formDate(new Date(year, month, dayNum));
    }

    const monthStr = String(month + 1).padStart(2, '0');
    const todayDay = (today.getFullYear() === year && today.getMonth() === month) ? today.getDate() : null;

    function getDayStatus(d) {
        const dayDate = new Date(year, month, d);
        dayDate.setHours(0, 0, 0, 0);
        const isToday = d === todayDay;
        const isPast = dayDate < today;
        const dateStr = getDateStr(d);
        const dayTasks = getTasksForDay(tasks, dateStr);
        const hasTodo = dayTasks.some(t => !t.done);
        const hasDone = dayTasks.some(t => t.done);
        return { isToday, isPast, hasTodo, hasDone };
    }

    const multiDayTasks = (tasks || []).filter(t => isMultiDayTask(t));
    const multiDayTaskIds = new Set(multiDayTasks.map(t => t.id));

    function getSpanBarsForWeek(week) {
        const bars = [];
        const weekDates = week.map(d => d ? getDateStr(d) : null);

        multiDayTasks.forEach(task => {
            const taskStart = parseFormDate(task.date);
            const taskEnd = parseFormDate(task.endDate);
            if (!taskStart || !taskEnd) return;
            taskStart.setHours(0,0,0,0);
            taskEnd.setHours(0,0,0,0);

            let startCol = -1, endCol = -1;
            for (let col = 0; col < 7; col++) {
                if (!weekDates[col]) continue;
                const colDate = parseFormDate(weekDates[col]);
                if (!colDate) continue;
                colDate.setHours(0,0,0,0);
                if (colDate >= taskStart && colDate <= taskEnd) {
                    if (startCol === -1) startCol = col;
                    endCol = col;
                }
            }
            if (startCol !== -1) {
                bars.push({ task, startCol, endCol });
            }
        });

        return bars;
    }

    return (
        <div className="padding-x py-4 max-lg:mt-12 dark:bg-black dark:text-white min-h-screen">
            <div className="flex items-end gap-4 mb-4">
                <div>
                    <h2 className="text-3xl font-black leading-none tracking-tight">{year}</h2>
                    <h3 className="text-3xl font-black leading-none tracking-tight">{monthStr}</h3>
                </div>

                <div className="flex-1 flex items-end gap-0 ml-4 border-b border-gray-200 dark:border-gray-700 pb-1 overflow-hidden">
                    {Array.from({ length: daysInMonth }, (_, i) => {
                        const d = i + 1;
                        const { isToday, isPast, hasTodo, hasDone } = getDayStatus(d);
                        const dimClass = isPast && !isToday ? 'opacity-30' : '';
                        return (
                            <div key={d}
                                 className={`flex flex-col items-center cursor-pointer hover:opacity-70 ${dimClass}`}
                                 style={{ flex: '1 1 0', minWidth: 0 }}
                                 onClick={() => goToDay(d)}>
                                <div className="flex gap-px mb-0.5">
                                    {hasTodo && <span className="w-1.5 h-1.5 rounded-full bg-red-400 block" />}
                                    {hasDone && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 block" />}
                                </div>
                                <div className={`w-px h-3 mb-0.5 ${isToday ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                                <span className={`text-[9px] leading-none ${
                                    isPublicHoliday(new Date(year, month, d)) ? 'text-red-500 font-bold' :
                                    isToday ? 'text-blue-500 font-bold' :
                                    isPast ? 'text-gray-400' :
                                    'text-black dark:text-white'
                                }`}>
                                    {d}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="mb-3 px-1">
                <h4 className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">This Month Focus</h4>
                <div className="flex flex-col gap-0.5">
                    {['line1', 'line2', 'line3'].map((key, i) => (
                        <input key={key}
                               type="text"
                               value={focus[key]}
                               onChange={e => setFocus(prev => ({ ...prev, [key]: e.target.value }))}
                               onBlur={handleFocusBlur}
                               placeholder=""
                               className="text-sm bg-transparent border-b border-gray-200 dark:border-gray-700 focus:border-blue-400 focus:outline-none py-0.5 w-full"
                        />
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700 mb-0">
                {DAYS_HEADER.map((d, i) => (
                    <div key={i} className="text-xs text-gray-400 tracking-wide py-1 pl-1">
                        {d}
                    </div>
                ))}
            </div>

            {weeks.map((week, wi) => {
                const spanBars = getSpanBarsForWeek(week);
                const barHeights = spanBars.map(bar => {
                    const subCount = Math.min((bar.task.subtasks || []).length, 4);
                    return 52 + subCount * 18 + ((bar.task.subtasks || []).length > 4 ? 14 : 0);
                });
                const barOffsets = [];
                let cumOffset = 4;
                for (let i = 0; i < barHeights.length; i++) {
                    barOffsets.push(cumOffset);
                    cumOffset += barHeights[i] + 4;
                }
                const spanBarHeight = cumOffset;

                return (
                    <div key={wi} className="relative border-b border-gray-200 dark:border-gray-700">
                        {spanBars.length > 0 && (
                            <div className="relative" style={{ height: `${spanBarHeight}px` }}>
                                {spanBars.map((bar, bi) => (
                                    <SpanBar
                                        key={bar.task.id}
                                        task={bar.task}
                                        startCol={bar.startCol}
                                        endCol={bar.endCol}
                                        rowIndex={bi}
                                        rowTopOffset={barOffsets[bi]}
                                        onTasksChanged={onTasksChanged}
                                    />
                                ))}
                            </div>
                        )}
                        <div className="grid grid-cols-7" style={{ minHeight: '90px' }}>
                            {week.map((dayNum, di) => {
                                if (!dayNum) return <div key={di} />;

                                const dateStr = getDateStr(dayNum);
                                const dayTasks = getTasksForDay(tasks, dateStr).filter(t => !multiDayTaskIds.has(t.id));
                                const isToday = dayNum === todayDay;

                                return (
                                    <div key={di} className="flex flex-col pt-1 pl-1 pr-0.5">
                                        <span
                                            className={`text-xs cursor-pointer hover:opacity-70 transition mb-0.5 ${
                                                isPublicHoliday(new Date(year, month, dayNum)) ? 'text-red-500 font-bold' :
                                                isToday ? 'text-blue-500 font-bold' : 'text-black dark:text-white'
                                            }`}
                                            onClick={() => goToDay(dayNum)}>
                                            {dayNum}
                                        </span>
                                        <ReactSortable list={dayTasks} setList={() => null}
                                                       onAdd={async (ev) => {
                                                           const taskId = parseInt(ev.item.dataset.taskId);
                                                           if (taskId) {
                                                               await moveTask(taskId, dateStr, ev.newIndex);
                                                               if (onTasksChanged) onTasksChanged();
                                                           }
                                                       }}
                                                       onUpdate={async (ev) => {
                                                           const curList = [...dayTasks];
                                                           const temp = curList[ev.oldIndex];
                                                           curList.splice(ev.oldIndex, 1);
                                                           curList.splice(ev.newIndex, 0, temp);
                                                           await reOrderTasks(curList);
                                                           if (onTasksChanged) onTasksChanged();
                                                       }}
                                                       group="monthdays"
                                                       ghostClass="sortable-ghost"
                                                       chosenClass="sortable-chosen"
                                                       dragClass="sortable-drag"
                                                       className="flex-1 min-h-[30px]">
                                            {dayTasks.map((task, i) => (
                                                <Task key={task.id} data={task}
                                                      taskListInd={di} date={new Date(year, month, dayNum)}
                                                      tasksCol={dayTasks.length}
                                                      ind={i}
                                                      onTasksChanged={onTasksChanged} />
                                            ))}
                                        </ReactSortable>
                                        <AddTaskInput
                                            date={dateStr}
                                            tasksData={dayTasks}
                                            onTasksChanged={onTasksChanged}
                                            showBorder={false}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
