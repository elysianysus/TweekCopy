import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { formDate, getTasksForDay, isPublicHoliday, isMultiDayTask, parseFormDate, openForm } from '../../scripts/utils.js';
import { useTaskMenu } from '../../contexts/TaskMenuContext.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

const LEFT_DAYS = 15;
const RIGHT_DAYS = 16;
const DAY_COLS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function DayCell({ year, monthIndex, day, daysInMonth, todayStr, tasks, onDayClick }) {
    if (day > daysInMonth) {
        return <div className="border-r border-gray-100 dark:border-gray-800 min-h-[28px]" />;
    }
    const date = new Date(year, monthIndex, day);
    const dow = date.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const dateStr = formDate(date);
    const isToday = dateStr === todayStr;
    const holiday = isPublicHoliday(date);
    const hasTasks = getTasksForDay(tasks, dateStr).length > 0;

    return (
        <div
            onClick={() => onDayClick(date)}
            className={`relative flex items-center justify-center min-h-[28px] border-r border-gray-100 dark:border-gray-800 cursor-pointer transition-colors
                ${isWeekend
                    ? 'bg-gray-100 dark:bg-gray-800/60 hover:bg-gray-200 dark:hover:bg-gray-700'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-900'}
            `}
        >
            <span className={`text-[10px] leading-none select-none
                ${holiday ? 'font-bold text-red-500' : isToday ? 'font-bold text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}
            `}>
                {day}
            </span>
            {hasTasks && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-400 dark:bg-blue-500" />
            )}
        </div>
    );
}

function getISOWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function generateYearWeeks(year) {
    const jan1 = new Date(year, 0, 1);
    const dayOfWeek = (jan1.getDay() + 6) % 7;
    const firstMon = new Date(year, 0, 1 - dayOfWeek);

    const weeks = [];
    let current = new Date(firstMon);

    while (true) {
        const weekDays = [];
        for (let i = 0; i < 7; i++) {
            weekDays.push(new Date(current));
            current.setDate(current.getDate() + 1);
        }

        const midWeek = weekDays[3];
        if (midWeek.getFullYear() > year) break;

        const weekNum = getISOWeekNumber(weekDays[0]);
        weeks.push({ weekNum, days: weekDays });

        if (weeks.length > 54) break;
    }

    return weeks;
}

function getSpanBarsForWeek(weekDays, tasks) {
    const weekDateStrs = weekDays.map(d => formDate(d));
    const weekStart = parseFormDate(weekDateStrs[0]);
    const weekEnd = parseFormDate(weekDateStrs[6]);
    if (!weekStart || !weekEnd) return [];
    weekStart.setHours(0,0,0,0);
    weekEnd.setHours(0,0,0,0);

    const seen = new Set();
    const bars = [];

    (tasks || []).forEach(task => {
        if (!isMultiDayTask(task) || seen.has(task.id)) return;
        const tStart = parseFormDate(task.date);
        const tEnd = parseFormDate(task.endDate);
        if (!tStart || !tEnd) return;
        tStart.setHours(0,0,0,0);
        tEnd.setHours(0,0,0,0);

        if (tEnd < weekStart || tStart > weekEnd) return;

        seen.add(task.id);
        let startCol = 0;
        let endCol = 6;
        for (let i = 0; i < 7; i++) {
            const d = parseFormDate(weekDateStrs[i]);
            if (d) { d.setHours(0,0,0,0); if (d >= tStart) { startCol = i; break; } }
        }
        for (let i = 6; i >= 0; i--) {
            const d = parseFormDate(weekDateStrs[i]);
            if (d) { d.setHours(0,0,0,0); if (d <= tEnd) { endCol = i; break; } }
        }
        bars.push({ task, startCol, endCol });
    });
    return bars;
}

export default function YearView({ year, tasks, onTasksChanged }) {
    const [, setSearchParams] = useSearchParams();
    const today = new Date();
    const todayStr = formDate(today);
    const { setTaskData } = useTaskMenu();

    function goToDay(date) {
        setSearchParams(prev => {
            prev.set('view', 'day');
            prev.set('viewDate', formDate(date));
            return prev;
        });
    }

    function goToMonth(monthIndex) {
        setSearchParams(prev => {
            prev.set('view', 'month');
            prev.set('viewYear', year);
            prev.set('viewMonth', monthIndex);
            return prev;
        });
    }

    function goToWeek(mondayDate) {
        const now = new Date();
        const curMonday = new Date(now);
        const curDay = (curMonday.getDay() + 6) % 7;
        curMonday.setDate(curMonday.getDate() - curDay);
        curMonday.setHours(0, 0, 0, 0);

        const targetMon = new Date(mondayDate);
        targetMon.setHours(0, 0, 0, 0);

        const diffDays = Math.round((targetMon - curMonday) / (1000 * 60 * 60 * 24));
        const weekShift = Math.round(diffDays / 7);

        setSearchParams(prev => {
            prev.set('view', 'week');
            prev.set('weekShift', weekShift);
            prev.delete('viewYear');
            prev.delete('viewMonth');
            prev.delete('viewDate');
            return prev;
        });
    }

    const yearWeeks = generateYearWeeks(year);

    return (
        <div className="py-6 max-lg:mt-12 dark:bg-black dark:text-white overflow-x-auto">
            <div className="min-w-[640px] px-4 lg:px-8">

                <div className="flex items-baseline gap-3 mb-5">
                    <span className="text-xl font-bold dark:text-white">{year}</span>
                </div>

                <div className="flex gap-0">
                    <div className="flex-1 border-r border-gray-300 dark:border-gray-600 pr-3">
                        {MONTHS.map((monthName, monthIndex) => {
                            const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
                            const isCurrentMonth = today.getFullYear() === year && today.getMonth() === monthIndex;
                            return (
                                <div key={monthIndex} className="flex items-stretch border-b border-gray-200 dark:border-gray-700">
                                    <button
                                        onClick={() => goToMonth(monthIndex)}
                                        className={`w-8 shrink-0 text-left text-[10px] font-medium py-1 pr-1 transition-colors hover:text-blue-500
                                            ${isCurrentMonth ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}
                                        `}
                                    >
                                        {monthName.slice(0, 3)}
                                    </button>
                                    <div
                                        className="flex-1 grid border-l border-gray-200 dark:border-gray-700"
                                        style={{ gridTemplateColumns: `repeat(${LEFT_DAYS}, 1fr)` }}
                                    >
                                        {Array.from({ length: LEFT_DAYS }, (_, i) => (
                                            <DayCell
                                                key={i + 1}
                                                year={year}
                                                monthIndex={monthIndex}
                                                day={i + 1}
                                                daysInMonth={daysInMonth}
                                                todayStr={todayStr}
                                                tasks={tasks}
                                                onDayClick={goToDay}
                                            />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="flex-1 pl-3">
                        {MONTHS.map((monthName, monthIndex) => {
                            const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
                            return (
                                <div key={monthIndex} className="flex items-stretch border-b border-gray-200 dark:border-gray-700">
                                    <div
                                        className="flex-1 grid"
                                        style={{ gridTemplateColumns: `repeat(${RIGHT_DAYS}, 1fr)` }}
                                    >
                                        {Array.from({ length: RIGHT_DAYS }, (_, i) => (
                                            <DayCell
                                                key={i + 16}
                                                year={year}
                                                monthIndex={monthIndex}
                                                day={i + 16}
                                                daysInMonth={daysInMonth}
                                                todayStr={todayStr}
                                                tasks={tasks}
                                                onDayClick={goToDay}
                                            />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="mt-10">
                    <h3 className="text-sm text-gray-400 mb-4 text-center">This year's plan</h3>

                    <table className="w-full border-collapse text-[11px]">
                        <thead>
                            <tr className="border-b border-gray-300 dark:border-gray-600">
                                <th className="w-10 text-left font-normal text-gray-400 py-1"></th>
                                {DAY_COLS.map(d => (
                                    <th key={d} className="font-medium text-gray-500 dark:text-gray-400 py-1 text-left pl-1" style={{ width: `${100 / 7}%` }}>
                                        {d}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {yearWeeks.map(({ weekNum, days }) => {
                                const isCurrentWeek = days.some(d => formDate(d) === todayStr);
                                const spanBars = getSpanBarsForWeek(days, tasks);
                                const multiDayIds = new Set(spanBars.map(b => b.task.id));
                                const rowBg = isCurrentWeek ? 'bg-blue-50 dark:bg-blue-950/30' : '';

                                return (
                                    <React.Fragment key={`w${weekNum}-${formDate(days[0])}`}>
                                        {spanBars.length > 0 && spanBars.map((bar, bi) => {
                                            const cells = [];
                                            let col = 0;
                                            if (bar.startCol > 0) {
                                                cells.push(<td key="pre" colSpan={bar.startCol} className="border-r border-gray-100 dark:border-gray-800" />);
                                                col = bar.startCol;
                                            }
                                            const span = bar.endCol - bar.startCol + 1;
                                            cells.push(
                                                <td key="bar" colSpan={span} className="py-0.5 px-0.5">
                                                    <div
                                                        className={`rounded px-1.5 py-0.5 cursor-pointer hover:opacity-80 transition truncate text-[9px] font-bold text-gray-800 text-center ${bar.task.done ? 'line-through opacity-40' : ''}`}
                                                        style={{ backgroundColor: '#d5ffa9' }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (document.querySelector('.blur-bg.active')) return;
                                                            openForm("task-menu");
                                                            setTaskData({ ...bar.task, onTasksChanged });
                                                        }}
                                                    >
                                                        {bar.task.name}
                                                    </div>
                                                </td>
                                            );
                                            col += span;
                                            if (col < 7) {
                                                cells.push(<td key="post" colSpan={7 - col} />);
                                            }
                                            return (
                                                <tr key={`span-${bar.task.id}-${bi}`} className={`${rowBg}`}>
                                                    <td />
                                                    {cells}
                                                </tr>
                                            );
                                        })}
                                        <tr className={`border-b border-gray-200 dark:border-gray-700 ${rowBg}`}>
                                            <td className="text-gray-400 text-[10px] py-2 pr-1 align-top cursor-pointer hover:text-blue-500"
                                                onClick={() => goToWeek(days[0])}>
                                                w{weekNum}
                                            </td>
                                            {days.map((date, di) => {
                                                const dateStr = formDate(date);
                                                const isToday = dateStr === todayStr;
                                                const dayTasks = getTasksForDay(tasks, dateStr).filter(t => !multiDayIds.has(t.id));
                                                const m = date.getMonth() + 1;
                                                const d = date.getDate();
                                                return (
                                                    <td key={di}
                                                        className={`py-2 pl-1 align-top cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${
                                                            di < 6 ? 'border-r border-gray-100 dark:border-gray-800' : ''
                                                        }`}
                                                        onClick={() => goToDay(date)}>
                                                        <div className={`text-[10px] mb-0.5 ${
                                                            isPublicHoliday(date) ? 'text-red-500 font-bold' :
                                                            isToday ? 'text-blue-500 font-bold' : 'text-gray-500 dark:text-gray-400'
                                                        }`}>
                                                            {m}.{d}
                                                        </div>
                                                        {dayTasks.length > 0 && (
                                                            <div className="flex flex-col gap-px">
                                                                {dayTasks.slice(0, 3).map(t => (
                                                                    <div key={t.id} className={`text-[9px] leading-tight truncate ${
                                                                        t.done ? 'text-gray-300 dark:text-gray-600 line-through' : 'text-gray-600 dark:text-gray-400'
                                                                    }`}>
                                                                        {t.name}
                                                                    </div>
                                                                ))}
                                                                {dayTasks.length > 3 && (
                                                                    <div className="text-[8px] text-gray-400">+{dayTasks.length - 3}</div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
