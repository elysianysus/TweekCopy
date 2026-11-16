import React, { useEffect, useState, useCallback, useRef } from 'react'
import TaskList from './TaskList.jsx'
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { reOrderTasks, getUserTasks, createTask, tryCatchDecorator } from "../../scripts/api.js";
import Loading from "../Loading.jsx";
import { formDate, getTasksForDay, parseFormDate, isMultiDayTask, openForm, formatRepeatTooltip, formatRepeatEndShort, isFinalRecurringOccurrence } from "../../scripts/utils.js";
import Header from "../Header.jsx";
import Task from "./Task.jsx";
import { ReactSortable } from "react-sortablejs";
import { useTaskMenu } from "../../contexts/TaskMenuContext.jsx";
import YearView from "../views/YearView.jsx";
import MonthView from "../views/MonthView.jsx";
import DayView from "../views/DayView.jsx";
import EisenhowerView from "../views/EisenhowerView.jsx";
import AllView from "../views/AllView.jsx";
import FocusView from "../views/FocusView.jsx";
import CheerView from "../views/CheerView.jsx";
import MemoView from "../views/MemoView.jsx";
import WhiteView from "../views/WhiteView.jsx";
import MuseView from "../views/MuseView.jsx";
import PodcastView from "../views/PodcastView.jsx";
import FlashView from "../views/FlashView.jsx";
import FeedView from "../views/FeedView.jsx";
import WeatherView from "../views/WeatherView.jsx";
import ExpensesView from "../views/ExpensesView.jsx";
import LifeGraphView from "../views/LifeGraphView.jsx";
import BloodPressureView from "../views/BloodPressureView.jsx";
import StepsView from "../views/StepsView.jsx";
import HealthView from "../views/HealthView.jsx";
import TodayDashboardView from "../views/TodayDashboardView.jsx";
import JournalView from "../views/JournalView.jsx";
import Last30DaysView from "../views/Last30DaysView.jsx";
import OfficeView from "../views/OfficeView.jsx";
import ThinkView from "../views/ThinkView.jsx";
import WeeklyReflectionPanel from "../views/WeeklyReflectionPanel.jsx";

const TaskListContainer = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [curDate, setCurDate] = useState(new Date());
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [maxTasks, setMaxTasks] = React.useState(10);

    const { currentUser } = useAuth();

    const view = searchParams.get("view") || "week";

    const fetchTasks = useCallback(async () => {
        if (!currentUser) {
            setTasks([]);
            setLoading(false);
            return;
        }
        const result = await tryCatchDecorator(getUserTasks)();
        if (result.success) {
            setTasks(result.data);
        }
        setLoading(false);
    }, [currentUser]);

    useEffect(() => {
        fetchTasks();
    }, [fetchTasks]);

    const changeMaxTasks = (newTasks) => {
        if (newTasks > maxTasks) setMaxTasks(newTasks);
    }

    function reorderTasks(listInd) {
        return async ev => {
            const oldIndex = ev.oldIndex, newIndex = ev.newIndex;
            const curListTasks = [...tasksData[formDate(dates[listInd])]];
            const temp = curListTasks[oldIndex];
            curListTasks.splice(curListTasks.indexOf(curListTasks[oldIndex]), 1);
            curListTasks.splice(newIndex, 0, temp);
            await reOrderTasks(curListTasks);
            await fetchTasks();
        }
    }

    useEffect(() => {
        const handleTasksChanged = () => fetchTasks();
        window.addEventListener("tasksChanged", handleTasksChanged);
        return () => window.removeEventListener("tasksChanged", handleTasksChanged);
    }, [fetchTasks]);

    useEffect(() => {
        const interval = setInterval(() => {
            fetchTasks();
            const now = new Date();
            if (now.toDateString() !== curDate.toDateString() && !searchParams.has("weekShift")) {
                setCurDate(now);
            }
        }, 60000);
        return () => clearInterval(interval);
    }, [fetchTasks, curDate, searchParams]);

    useEffect(() => {
        setInterval(() => {
            const openedBlur = document.querySelector(".blur-bg.active");
            document.body.style.overflowY = openedBlur ? "hidden" : "auto";
        }, 50);
    }, []);

    useEffect(() => {
        if (searchParams.has("weekShift")) {
            const shift = +searchParams.get("weekShift") * 7;
            setCurDate(() => {
                const newDate = new Date();
                newDate.setDate(newDate.getDate() + shift);
                return newDate;
            })
        }
    }, [searchParams.get("weekShift")]);

    const dayOfWeek = (curDate.getDay() - 1) % 7;
    const dates = [];
    const tasksData = {};
    for (let i = -dayOfWeek; i < -dayOfWeek + 7; ++i) {
        const newDate = new Date(+curDate);
        newDate.setDate(newDate.getDate() + i);
        dates.push(newDate);
        tasksData[formDate(newDate)] = getTasksForDay(tasks, formDate(newDate));
        changeMaxTasks(tasksData[formDate(newDate)].length + 1);
    }

    if (loading) {
        return <Loading text="Your tasks" />;
    }

    function renderView() {
        if (view === "year") {
            const viewYear = parseInt(searchParams.get("viewYear")) || new Date().getFullYear();
            return <YearView year={viewYear} tasks={tasks} onTasksChanged={fetchTasks} />;
        }

        if (view === "month") {
            const viewYear = parseInt(searchParams.get("viewYear")) || new Date().getFullYear();
            const viewMonth = parseInt(searchParams.get("viewMonth")) ?? new Date().getMonth();
            return <MonthView year={viewYear} month={viewMonth} tasks={tasks} onTasksChanged={fetchTasks} />;
        }

        if (view === "day") {
            const viewDateStr = searchParams.get("viewDate");
            let dayDate = new Date();
            if (viewDateStr) {
                const parts = viewDateStr.split("-");
                dayDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            }
            return <DayView date={dayDate} tasks={tasks} onTasksChanged={fetchTasks} />;
        }

        if (view === "eisenhower") {
            return <EisenhowerView tasks={tasks} onTasksChanged={fetchTasks} />;
        }

        if (view === "all") {
            return <AllView tasks={tasks} onTasksChanged={fetchTasks} />;
        }

        if (view === "focus") {
            return <FocusView />;
        }

        if (view === "cheer") {
            return <CheerView />;
        }

        if (view === "think") {
            return <ThinkView />;
        }

        if (view === "memo") {
            return <MemoView />;
        }

        if (view === "white") {
            return <WhiteView />;
        }

        if (view === "muse") {
            return <MuseView onTasksChanged={fetchTasks} />;
        }

        if (view === "flash") {
            return <FlashView tasks={tasks} onTasksChanged={fetchTasks} />;
        }

        if (view === "feed") {
            return <FeedView />;
        }

        if (view === "podcast") {
            return <PodcastView />;
        }

        if (view === "weather") {
            return <WeatherView />;
        }

        if (view === "expenses") {
            return <ExpensesView />;
        }

        if (view === "life") {
            return <LifeGraphView />;
        }

        if (view === "bp") {
            return <BloodPressureView />;
        }

        if (view === "steps") {
            return <StepsView />;
        }

        if (view === "health") {
            return <HealthView />;
        }

        if (view === "today") {
            return <TodayDashboardView />;
        }

        if (view === "journal") {
            return <JournalView />;
        }

        if (view === "last30days") {
            return <Last30DaysView />;
        }

        if (view === "office") {
            return <OfficeView />;
        }

        const weekYear = dates[0].getFullYear();
        const weekMonth = String(dates[0].getMonth() + 1).padStart(2, '0');

        const multiDayTasks = (tasks || []).filter(t => isMultiDayTask(t));
        const multiDayTaskIds = new Set(multiDayTasks.map(t => t.id));

        const weekSpanBars = [];
        multiDayTasks.forEach(task => {
            const taskStart = parseFormDate(task.date);
            const taskEnd = parseFormDate(task.endDate);
            if (!taskStart || !taskEnd) return;
            taskStart.setHours(0,0,0,0);
            taskEnd.setHours(0,0,0,0);
            let startCol = -1, endCol = -1;
            for (let col = 0; col < 7; col++) {
                const colDate = new Date(dates[col]);
                colDate.setHours(0,0,0,0);
                if (colDate >= taskStart && colDate <= taskEnd) {
                    if (startCol === -1) startCol = col;
                    endCol = col;
                }
            }
            if (startCol !== -1) {
                weekSpanBars.push({ task, startCol, endCol });
            }
        });

        const filteredTasksData = {};
        for (const key of Object.keys(tasksData)) {
            filteredTasksData[key] = tasksData[key].filter(t => !multiDayTaskIds.has(t.id));
        }

        return (
            <>
                <div className="w-full padding-x pt-4 max-lg:mt-12 dark:bg-black dark:text-white">
                    <div className="flex items-end gap-4 mb-2">
                        <div>
                            <h2 className="text-3xl font-black leading-none tracking-tight">{weekYear}</h2>
                            <h3 className="text-3xl font-black leading-none tracking-tight">{weekMonth}</h3>
                        </div>
                    </div>
                    <WeekMonthFocus yearMonth={`${weekYear}-${weekMonth}`} />
                </div>
                {weekSpanBars.length > 0 && (
                    <div className="w-full padding-x dark:bg-black dark:text-white">
                        <WeekSpanBars spanBars={weekSpanBars} onTasksChanged={fetchTasks} />
                    </div>
                )}
                <div className="w-full padding-x flex flex-col lg:flex-row gap-6 pb-4 dark:bg-black dark:text-white">
                    {
                        dates.slice(0, 5).map((date, index) => (
                            <TaskList date={date} key={index} ind={index} active={formDate(new Date()) === formDate(date)}
                                      last={false} reorderTasks={reorderTasks(index)}
                                      maxTasks={maxTasks} changeMaxTasks={changeMaxTasks}
                                      tasksData={filteredTasksData[formDate(date)] || []}
                                      onTasksChanged={fetchTasks} />
                        ))
                    }
                    <div className="flex-1 ">
                        {
                            dates.slice(5).map((date, index) => (
                                <TaskList date={date} key={index} ind={index + 5} active={formDate(new Date()) === formDate(date)}
                                          last={true} reorderTasks={reorderTasks(index + 5)}
                                          maxTasks={maxTasks} changeMaxTasks={changeMaxTasks}
                                          tasksData={filteredTasksData[formDate(date)] || []}
                                          onTasksChanged={fetchTasks} />
                            ))
                        }
                    </div>
                </div>
                <div className="w-full padding-x pb-8 dark:bg-black dark:text-white">
                    <WeeklyReflectionPanel dates={dates} />
                    <NotesList
                        notes={tasks.filter(t => t.date === "notes")}
                        onTasksChanged={fetchTasks}
                    />
                </div>
            </>
        );
    }

    return (
        <>
            <Header onTasksChanged={fetchTasks} />
            {view !== "week" && view !== "all" && <div className="max-lg:mt-20" />}
            {renderView()}
        </>
    )
}

function formatDateLabel(dateStr) {
    if (!dateStr) return '';
    const d = parseFormDate(dateStr);
    if (!d) return dateStr;
    return `${d.getDate()}/${d.getMonth() + 1}`;
}

const WeekSpanBars = ({ spanBars, onTasksChanged }) => {
    const { setTaskData } = useTaskMenu();

    function handleClick(task) {
        if (document.querySelector('.blur-bg.active')) return;
        openForm("task-menu");
        setTaskData({ ...task, onTasksChanged });
    }

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

    return (
        <div className="relative mb-2" style={{ height: `${cumOffset}px` }}>
            {spanBars.map((bar, bi) => {
                const { task, startCol, endCol } = bar;
                const startDateLabel = formatDateLabel(task.date);
                const endDateLabel = formatDateLabel(task.endDate);
                const startTimeLabel = task.startTime || '';
                const endTimeLabel = task.endTime === '24:00' ? '' : (task.endTime || '');
                const subs = task.subtasks || [];

                const leftPct = (startCol / 7) * 100;
                const widthPct = ((endCol - startCol + 1) / 7) * 100;

                return (
                    <div
                        key={task.id}
                        className="absolute flex flex-col cursor-pointer hover:opacity-80 transition"
                        style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            top: `${barOffsets[bi]}px`,
                            paddingLeft: '3px',
                            paddingRight: '3px',
                        }}
                        onClick={() => handleClick(task)}
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
            })}
        </div>
    );
};

const NotesList = ({ notes, onTasksChanged }) => {
    const { currentUser } = useAuth();

    async function handleAddNote(ev) {
        if (ev.key === "Enter" || ev.type === "blur") {
            if (!ev.target.value) return;
            if (currentUser) {
                const name = ev.target.value;
                ev.target.value = "";
                await tryCatchDecorator(createTask)({
                    name,
                    color: "white text-black dark:text-white dark:bg-black",
                    date: "notes",
                    done: false,
                    order: notes.length,
                    eisenhowerQuadrant: "q4",
                });
                if (onTasksChanged) onTasksChanged();
            }
        }
    }

    async function handleReorder(ev) {
        const curList = [...notes];
        const temp = curList[ev.oldIndex];
        curList.splice(ev.oldIndex, 1);
        curList.splice(ev.newIndex, 0, temp);
        await reOrderTasks(curList);
        if (onTasksChanged) onTasksChanged();
    }

    return (
        <div className="mt-4 border-t-2 border-gray-300 dark:border-gray-700 pt-4">
            <h2 className="text-lg font-bold text-gray-500 mb-2">Someday</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6">
                {[0, 1, 2].map(col => {
                    const colNotes = notes.filter((_, i) => i % 3 === col);
                    return (
                        <div key={col} className="flex flex-col">
                            <ReactSortable list={colNotes} setList={() => null}
                                           onUpdate={handleReorder}
                                           ghostClass="sortable-ghost"
                                           chosenClass="sortable-chosen"
                                           dragClass="sortable-drag"
                                           group="notes"
                            >
                                {colNotes.map(note => (
                                    <Task key={note.id} data={note}
                                          taskListInd={-1} date={null}
                                          tasksCol={colNotes.length}
                                          ind={notes.indexOf(note)}
                                          onTasksChanged={onTasksChanged} />
                                ))}
                            </ReactSortable>
                            <input type="text"
                                   placeholder="Add someday task..."
                                   className="w-full border-b dark:bg-black
                                   focus:outline-none focus:px-1.5 focus:shadow-lg focus:border dark:focus:border-none dark:focus:bg-stone-800
                                   py-2 indent-1.5 focus:rounded-md border-gray-300 dark:border-gray-700 focus:z-5"
                                   onBlur={handleAddNote}
                                   onKeyDown={handleAddNote}
                            />
                            {[...Array(4)].map((_, i) => (
                                <div key={i} className="w-full py-2 border-b border-gray-200 dark:border-gray-700">
                                    <p className="opacity-0 cursor-default">.</p>
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

const WeekMonthFocus = ({ yearMonth }) => {
    const [focus, setFocus] = useState({ line1: "", line2: "", line3: "" });
    const focusLoaded = useRef(false);

    useEffect(() => {
        focusLoaded.current = false;
        fetch(`/api/month-focus/${yearMonth}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
        })
            .then(r => r.ok ? r.json() : { line1: "", line2: "", line3: "" })
            .then(data => {
                setFocus({ line1: data.line1 || "", line2: data.line2 || "", line3: data.line3 || "" });
                focusLoaded.current = true;
            });
    }, [yearMonth]);

    function handleBlur() {
        if (focusLoaded.current) {
            fetch(`/api/month-focus/${yearMonth}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
                },
                body: JSON.stringify(focus),
            });
        }
    }

    return (
        <div className="mb-2 px-1">
            <h4 className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">This Month Focus</h4>
            <div className="flex flex-col gap-0.5">
                {['line1', 'line2', 'line3'].map((key, i) => (
                    <input key={key}
                           type="text"
                           value={focus[key]}
                           onChange={e => setFocus(prev => ({ ...prev, [key]: e.target.value }))}
                           onBlur={handleBlur}
                           placeholder={`Focus ${i + 1}`}
                           className="text-sm bg-transparent border-b border-gray-200 dark:border-gray-700 focus:border-blue-400 focus:outline-none py-0.5 w-full placeholder:text-gray-300 dark:placeholder:text-gray-600"
                    />
                ))}
            </div>
        </div>
    );
};

export default TaskListContainer
