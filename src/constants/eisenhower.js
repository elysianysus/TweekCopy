export const QUADRANTS = [
    {
        key: 'q1',
        number: '1',
        label: 'Do First',
        sub: 'Urgent & Important',
        color: 'border-red-400',
        headerColor: 'bg-red-50 dark:bg-red-950',
        labelColor: 'text-red-600 dark:text-red-400',
        dotColor: 'bg-red-400',
        watermarkColor: 'text-red-100 dark:text-red-900/40',
        placeholder: 'Add urgent & important task...',
    },
    {
        key: 'q3',
        number: '2',
        label: 'Delegate',
        sub: 'Urgent & Not Important',
        color: 'border-yellow-400',
        headerColor: 'bg-yellow-50 dark:bg-yellow-950',
        labelColor: 'text-yellow-600 dark:text-yellow-500',
        dotColor: 'bg-yellow-400',
        watermarkColor: 'text-yellow-100 dark:text-yellow-900/40',
        placeholder: 'Add task to delegate...',
    },
    {
        key: 'q2',
        number: '3',
        label: 'Schedule',
        sub: 'Not Urgent & Important',
        color: 'border-blue-400',
        headerColor: 'bg-blue-50 dark:bg-blue-950',
        labelColor: 'text-blue-600 dark:text-blue-400',
        dotColor: 'bg-blue-400',
        watermarkColor: 'text-blue-100 dark:text-blue-900/40',
        placeholder: 'Add important task to schedule...',
    },
    {
        key: 'q4',
        number: '4',
        label: 'Eliminate',
        sub: 'Not Urgent & Not Important',
        color: 'border-gray-400',
        headerColor: 'bg-gray-50 dark:bg-gray-900',
        labelColor: 'text-gray-500 dark:text-gray-400',
        dotColor: 'bg-gray-400',
        watermarkColor: 'text-gray-200 dark:text-gray-800/40',
        placeholder: 'Add task to eliminate...',
    },
];

export const QUADRANT_DOT = {
    q1: 'bg-red-400',
    q2: 'bg-blue-400',
    q3: 'bg-yellow-400',
    q4: 'bg-gray-400',
};

export function getTasksForQuadrant(tasks, quadrantKey) {
    return tasks.filter(t => {
        if (t.eisenhowerQuadrant === quadrantKey) return true;
        if (!t.eisenhowerQuadrant && t.date === `eisenhower-${quadrantKey}`) return true;
        return false;
    });
}

export function isCalendarDate(date) {
    return date && date !== 'eisenhower' && !date.startsWith('eisenhower-') && date !== 'notes';
}

export function formatDeadline(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isPast = date < today;
    return { label: `${days[date.getDay()]} ${d} ${months[m - 1]}`, isPast };
}
