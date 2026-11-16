import React, { useState } from 'react';
import Task from '../tasks/Task.jsx';
import { ReactSortable } from 'react-sortablejs';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { createTask, updateTask, reOrderTasks, tryCatchDecorator } from '../../scripts/api.js';
import { QUADRANTS, getTasksForQuadrant } from '../../constants/eisenhower.js';

export { QUADRANTS };

function AddTaskRow({ quadrantKey, tasks, onAdded, currentUser, placeholder }) {
    const [name, setName] = useState('');
    const [deadline, setDeadline] = useState('');
    const [showDate, setShowDate] = useState(false);

    async function submit() {
        if (!name.trim() || !currentUser) return;
        const taskDate = deadline || 'eisenhower';
        const quadrantTasks = getTasksForQuadrant(tasks, quadrantKey);
        await tryCatchDecorator(createTask)({
            name: name.trim(),
            color: 'white text-black dark:text-white dark:bg-black',
            date: taskDate,
            eisenhowerQuadrant: quadrantKey,
            done: false,
            order: quadrantTasks.length,
            ...(deadline ? { endDate: taskDate, endTime: '24:00' } : {}),
        });
        setName('');
        setDeadline('');
        setShowDate(false);
        if (onAdded) onAdded();
    }

    function handleNameKeyDown(ev) {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            submit();
        }
    }

    return (
        <div className="mt-2 border-t border-gray-200 dark:border-gray-700 pt-2">
            <div className="flex items-center gap-1">
                <input
                    type="text"
                    value={name}
                    onChange={ev => setName(ev.target.value)}
                    placeholder={placeholder}
                    className="flex-1 dark:bg-black focus:outline-none py-1.5 indent-1 text-sm text-gray-700 dark:text-gray-300 placeholder-gray-400"
                    onFocus={() => setShowDate(true)}
                    onKeyDown={handleNameKeyDown}
                />
                <button
                    type="button"
                    onClick={() => setShowDate(p => !p)}
                    title="Set deadline"
                    className={`text-xs px-1.5 py-1 rounded transition-colors flex-shrink-0 ${
                        deadline
                            ? 'text-blue-500 dark:text-blue-400'
                            : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                    }`}
                >
                    <i className="fa-regular fa-calendar-days" />
                </button>
                {name.trim() && (
                    <button
                        type="button"
                        onClick={submit}
                        className="text-xs px-2 py-1 bg-gray-800 dark:bg-white text-white dark:text-black rounded hover:opacity-80 transition-opacity flex-shrink-0"
                    >
                        Add
                    </button>
                )}
            </div>

            {showDate && (
                <div className="flex items-center gap-2 mt-1.5 pl-1">
                    <i className="fa-regular fa-clock text-xs text-gray-400" />
                    <input
                        type="date"
                        value={deadline}
                        onChange={ev => setDeadline(ev.target.value)}
                        onKeyDown={ev => ev.key === 'Enter' && submit()}
                        className="text-xs border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 dark:bg-black dark:text-gray-300 focus:outline-none focus:border-blue-400"
                    />
                    {deadline ? (
                        <span className="text-xs text-blue-500 dark:text-blue-400 flex items-center gap-1">
                            <i className="fa-solid fa-arrow-right text-[10px]" />
                            shows in calendar
                        </span>
                    ) : (
                        <span className="text-xs text-gray-400">optional deadline</span>
                    )}
                    {deadline && (
                        <button
                            type="button"
                            onClick={() => setDeadline('')}
                            className="text-gray-400 hover:text-gray-600 text-xs ml-auto"
                        >
                            <i className="fa-solid fa-xmark" />
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

const STORAGE_KEY = 'eisenhower-hide-done';

export default function EisenhowerView({ tasks, onTasksChanged }) {
    const { currentUser } = useAuth();
    const [hideDone, setHideDone] = useState(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored === null ? true : stored === 'true';
        } catch { return true; }
    });

    function toggleHideDone() {
        setHideDone(prev => {
            const next = !prev;
            try { localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
            return next;
        });
    }

    async function handleReorder(quadrantKey, ev) {
        const allQuadrantTasks = getTasksForQuadrant(tasks, quadrantKey);
        const visibleTasks = hideDone ? allQuadrantTasks.filter(t => !t.done) : allQuadrantTasks;
        const reordered = [...visibleTasks];
        const temp = reordered[ev.oldIndex];
        reordered.splice(ev.oldIndex, 1);
        reordered.splice(ev.newIndex, 0, temp);
        if (hideDone) {
            const doneTasks = allQuadrantTasks.filter(t => t.done);
            await reOrderTasks([...reordered, ...doneTasks]);
        } else {
            await reOrderTasks(reordered);
        }
        if (onTasksChanged) onTasksChanged();
    }

    async function handleCrossQuadrantDrop(quadrantKey, ev) {
        if (ev.item) {
            const taskId = parseInt(ev.item.getAttribute('data-task-id'));
            if (!taskId) return;
            const task = tasks.find(t => t.id === taskId);
            if (!task) return;
            const currentQ = task.eisenhowerQuadrant || (task.date.startsWith('eisenhower-') ? task.date.replace('eisenhower-', '') : null);
            if (currentQ === quadrantKey) return;
            await tryCatchDecorator(updateTask)(taskId, { eisenhowerQuadrant: quadrantKey });
            if (onTasksChanged) onTasksChanged();
        }
    }

    function renderQuadrant(q, extraClass = '') {
        const allQTasks = getTasksForQuadrant(tasks, q.key);
        const qTasks = hideDone ? allQTasks.filter(t => !t.done) : allQTasks;
        return (
            <div key={q.key} className={`flex-1 flex flex-col py-3 relative ${extraClass}`}>
                <span className={`absolute top-3 right-2 text-[120px] font-black leading-none ${q.watermarkColor} select-none pointer-events-none`}>
                    {q.number}
                </span>
                <div className="flex items-center gap-2 mb-3 relative z-10">
                    <span className={`w-3 h-3 rounded-full ${q.dotColor} flex-shrink-0`} />
                    <div>
                        <h3 className={`font-bold text-sm ${q.labelColor}`}>{q.label}</h3>
                        <p className="text-xs text-gray-400">{q.sub}</p>
                    </div>
                    <span className="ml-auto text-xs text-gray-400 font-medium">{qTasks.length}</span>
                </div>
                <ReactSortable
                    list={qTasks}
                    setList={() => null}
                    onUpdate={(ev) => handleReorder(q.key, ev)}
                    onAdd={(ev) => handleCrossQuadrantDrop(q.key, ev)}
                    group="eisenhower"
                    ghostClass="sortable-ghost"
                    chosenClass="sortable-chosen"
                    dragClass="sortable-drag"
                    className="flex-1 min-h-[120px]"
                >
                    {qTasks.map((task, i) => (
                        <Task
                            key={task.id}
                            data={task}
                            taskListInd={-1}
                            date={null}
                            tasksCol={qTasks.length}
                            ind={i}
                            onTasksChanged={onTasksChanged}
                            showDeadline={true}
                        />
                    ))}
                </ReactSortable>
                <AddTaskRow
                    quadrantKey={q.key}
                    tasks={tasks}
                    onAdded={onTasksChanged}
                    currentUser={currentUser}
                    placeholder={q.placeholder}
                />
            </div>
        );
    }

    return (
        <div className="padding-x py-6 max-lg:mt-12 dark:bg-black dark:text-white min-h-screen">
            <div className="mb-6 text-center">
                <h2 className="text-2xl font-bold tracking-tight">Eisenhower Matrix</h2>
                <div className="flex items-center justify-center gap-3 mt-1">
                    <p className="text-gray-400 text-sm">Prioritise by urgency and importance</p>
                    <button
                        type="button"
                        onClick={toggleHideDone}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            hideDone
                                ? 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500'
                                : 'border-green-400 dark:border-green-600 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950'
                        }`}
                        title={hideDone ? 'Show completed tasks' : 'Hide completed tasks'}
                    >
                        <i className={`fa-${hideDone ? 'regular' : 'solid'} fa-circle-check mr-1`} />
                        {hideDone ? 'Show done' : 'Showing done'}
                    </button>
                </div>
            </div>

            <div className="max-w-5xl mx-auto">
                <div className="flex flex-col lg:flex-row">
                    {renderQuadrant(QUADRANTS[0], 'pr-0 lg:pr-6 pb-6 lg:pb-0')}
                    <div className="hidden lg:block w-px bg-gray-200 dark:bg-gray-700 self-stretch" />
                    <div className="lg:hidden h-px bg-gray-200 dark:bg-gray-700 w-full" />
                    {renderQuadrant(QUADRANTS[1], 'pl-0 lg:pl-6 pb-6 lg:pb-0')}
                </div>
                <div className="h-px bg-gray-200 dark:bg-gray-700 w-full my-2" />
                <div className="flex flex-col lg:flex-row">
                    {renderQuadrant(QUADRANTS[2], 'pr-0 lg:pr-6 pt-0 lg:pt-0')}
                    <div className="hidden lg:block w-px bg-gray-200 dark:bg-gray-700 self-stretch" />
                    <div className="lg:hidden h-px bg-gray-200 dark:bg-gray-700 w-full" />
                    {renderQuadrant(QUADRANTS[3], 'pl-0 lg:pl-6 pt-0 lg:pt-0')}
                </div>
            </div>
        </div>
    );
}
