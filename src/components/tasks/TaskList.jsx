import React, { useState, useRef, useEffect } from 'react'
import Task from './Task.jsx';
import { useAuth } from "../../contexts/AuthContext.jsx";
import { moveTask, createTask, uploadTaskFile, tryCatchDecorator } from "../../scripts/api.js";
import { ReactSortable } from "react-sortablejs";
import { formDate, isPublicHoliday } from "../../scripts/utils.js";
import { useSearchParams as useSP } from "react-router-dom";
import AddTaskInput from './AddTaskInput.jsx';

const TaskList = ({ date, active, last, maxTasks, tasksData, ind, reorderTasks, onTasksChanged }) => {

    const getDate = date => {
        let day = date.getDate().toString();
        if (day.length < 2) day = "0" + day;
        return day;
    }

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const day = days[date.getDay()];

    const [, setSP] = useSP();

    function goToDayView(ev) {
        ev.stopPropagation();
        setSP(prev => {
            prev.set("view", "day");
            prev.set("viewDate", formDate(date));
            return prev;
        });
    }

    const tasksComponents = [];
    for (let i = 0; i < tasksData.length; ++i) {
        tasksComponents.push(<Task key={tasksData[i].id} data={tasksData[i]}
                                   taskListInd={ind} date={date}
                                   tasksCol={tasksData.length}
                                   ind={i}
                                   onTasksChanged={onTasksChanged} />);
    }

    const [fileDragOver, setFileDragOver] = useState(false);
    const listRef = useRef(null);
    const onTasksChangedRef = useRef(onTasksChanged);
    onTasksChangedRef.current = onTasksChanged;
    const dateRef = useRef(date);
    dateRef.current = date;
    const tasksDataRef = useRef(tasksData);
    tasksDataRef.current = tasksData;

    useEffect(() => {
        const el = listRef.current;
        if (!el) return;
        function isFileDrag(ev) { return ev.dataTransfer?.types?.indexOf('Files') !== -1; }
        function onOver(ev) {
            if (!isFileDrag(ev)) return;
            ev.preventDefault();
            setFileDragOver(true);
        }
        function onLeave(ev) {
            if (!el.contains(ev.relatedTarget)) setFileDragOver(false);
        }
        async function onDrop(ev) {
            if (!isFileDrag(ev)) return;
            ev.preventDefault();
            ev.stopPropagation();
            setFileDragOver(false);
            const files = [...(ev.dataTransfer.files || [])];
            if (!files.length) return;
            const taskEl = ev.target.closest('[data-task-id]');
            if (taskEl) return;
            for (const file of files) {
                try {
                    const task = await createTask({
                        name: file.name.replace(/\.[^.]+$/, ''),
                        color: 'white text-black dark:text-white dark:bg-black',
                        date: formDate(dateRef.current),
                        done: false,
                        order: tasksDataRef.current.length,
                        endDate: formDate(dateRef.current),
                        endTime: '24:00',
                    });
                    await uploadTaskFile(task.id, file);
                } catch (e) { console.error(e); }
            }
            if (onTasksChangedRef.current) onTasksChangedRef.current();
        }
        el.addEventListener('dragover', onOver, true);
        el.addEventListener('dragleave', onLeave, true);
        el.addEventListener('drop', onDrop, true);
        return () => {
            el.removeEventListener('dragover', onOver, true);
            el.removeEventListener('dragleave', onLeave, true);
            el.removeEventListener('drop', onDrop, true);
        };
    }, []);

    const emptySlots = Math.max(1, (last ? maxTasks / 2 : maxTasks) - tasksData.length);
    return (
        <div ref={listRef} className={`task-list flex flex-1 flex-col ${fileDragOver ? 'bg-blue-50/50 dark:bg-blue-900/20 ring-2 ring-blue-300 dark:ring-blue-600 rounded' : ''}`} data-date={date.getDate()}>
            <div
                className={`flex justify-between items-center py-3 border-b-2 cursor-pointer hover:opacity-70 transition
                ${active ? "border-blue-600" : "border-black dark:border-white"}`}
                onClick={goToDayView}>
                <h2 className={`text-lg lg:text-xl font-bold  ${isPublicHoliday(date) ? "text-red-500" : active ? "text-blue-600" : "text-gray-600"}`}>{getDate(date)}</h2>
                <h3 className={`text-lg lg:text-xl ${isPublicHoliday(date) ? "text-red-300" : active ? "text-blue-300" : "text-gray-300"}`}>{day.slice(0, 3)}</h3>
            </div>

            <ReactSortable list={tasksData} setList={() => null}
                           onUpdate={reorderTasks}
                           onAdd={async (ev) => {
                               const taskId = parseInt(ev.item.dataset.taskId);
                               if (taskId) {
                                   await moveTask(taskId, formDate(date), ev.newIndex);
                                   if (onTasksChanged) onTasksChanged();
                               }
                           }}
                           group="weekdays"
                           ghostClass="sortable-ghost"
                           chosenClass="sortable-chosen"
                           dragClass="sortable-drag"
                           className="flex-1 min-h-[40px]"
            >
                {tasksComponents}
            </ReactSortable>

            {Array.from({ length: emptySlots }, (_, i) => (
                <AddTaskInput
                    key={`add-${date.getDate()}-${i}`}
                    date={formDate(date)}
                    tasksData={tasksData}
                    onTasksChanged={onTasksChanged}
                    showBorder={false}
                />
            ))}
        </div>
    )
}

export default TaskList
