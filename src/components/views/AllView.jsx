import React from 'react';
import Task from '../tasks/Task.jsx';
import { isCalendarDate } from '../../constants/eisenhower.js';
import { isPublicHoliday } from '../../scripts/utils.js';

export default function AllView({ tasks, onTasksChanged }) {
    const calendarTasks = tasks.filter(t => isCalendarDate(t.date));
    const somedayTasks = tasks.filter(t => !isCalendarDate(t.date));

    const grouped = {};
    for (const t of calendarTasks) {
        if (!grouped[t.date]) grouped[t.date] = [];
        grouped[t.date].push(t);
    }

    const sortedDates = Object.keys(grouped).sort();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function formatDateLabel(dateStr) {
        const parts = dateStr.split('-');
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        return {
            day: d.getDate(),
            dayName: days[d.getDay()],
            month: months[d.getMonth()],
            year: d.getFullYear(),
            isToday: dateStr === todayStr,
            isPast: d < today,
        };
    }

    return (
        <div className="w-full padding-x py-4 max-lg:mt-12 dark:bg-black dark:text-white min-h-screen">
            <div className="flex items-end gap-4 mb-6">
                <div>
                    <h2 className="text-3xl font-black leading-none tracking-tight">All</h2>
                    <p className="text-sm text-gray-400 mt-1">{calendarTasks.length} tasks</p>
                </div>
            </div>

            <div className="flex flex-col gap-1">
                {sortedDates.map(dateStr => {
                    const info = formatDateLabel(dateStr);
                    const dateTasks = grouped[dateStr];
                    return (
                        <div key={dateStr} className={`flex gap-4 items-start ${info.isPast && !info.isToday ? 'opacity-40' : ''}`}>
                            <div className={`w-16 flex-shrink-0 text-right pr-2 pt-2 ${isPublicHoliday(dateStr) ? 'text-red-500' : info.isToday ? 'text-blue-500' : ''}`}>
                                <div className="text-lg font-black leading-none">{info.day}</div>
                                <div className={`text-[10px] uppercase ${isPublicHoliday(dateStr) ? 'text-red-400' : 'text-gray-400'}`}>{info.dayName}</div>
                            </div>
                            <div className="flex-1 border-l border-gray-200 dark:border-gray-700 pl-2">
                                {dateTasks.map(task => (
                                    <Task key={task.id} data={task}
                                          taskListInd={-1} date={dateStr}
                                          tasksCol={dateTasks.length}
                                          ind={0}
                                          onTasksChanged={onTasksChanged} />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {somedayTasks.length > 0 && (
                <div className="mt-8 border-t border-gray-200 dark:border-gray-700 pt-4">
                    <h3 className="text-lg font-bold text-gray-500 mb-2">Someday</h3>
                    <div className="flex flex-col">
                        {somedayTasks.map(task => (
                            <Task key={task.id} data={task}
                                  taskListInd={-1} date={null}
                                  tasksCol={somedayTasks.length}
                                  ind={0}
                                  onTasksChanged={onTasksChanged} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
