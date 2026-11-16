export function formDate(date) {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

const PUBLIC_HOLIDAYS_2026 = new Set([
    '2026-1-1', '2026-2-17', '2026-2-18', '2026-2-19',
    '2026-4-3', '2026-4-4', '2026-4-6', '2026-4-7',
    '2026-5-1', '2026-5-25', '2026-6-19', '2026-7-1',
    '2026-9-26', '2026-10-1', '2026-10-19',
    '2026-12-25', '2026-12-26',
]);

export function isPublicHoliday(dateOrStr) {
    if (typeof dateOrStr === 'string') {
        if (PUBLIC_HOLIDAYS_2026.has(dateOrStr)) return true;
        const d = parseFormDate(dateOrStr);
        return d ? d.getDay() === 0 : false;
    }
    const str = formDate(dateOrStr);
    if (PUBLIC_HOLIDAYS_2026.has(str)) return true;
    return dateOrStr.getDay() === 0;
}

export function parseFormDate(str) {
    if (!str) return null;
    const parts = str.split('-').map(Number);
    if (parts.length < 3) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

export function getTasksForDay(tasks, dateStr) {
    const dayDate = parseFormDate(dateStr);
    if (!dayDate) return tasks.filter(t => t.date === dateStr);
    dayDate.setHours(0, 0, 0, 0);
    const filtered = tasks.filter(t => {
        if (t.date === dateStr) return true;
        if (!t.date) return false;
        const startDate = parseFormDate(t.date);
        if (!startDate) return false;
        startDate.setHours(0, 0, 0, 0);
        if (t.endDate) {
            const endD = parseFormDate(t.endDate);
            if (endD) {
                endD.setHours(0, 0, 0, 0);
                if (endD > startDate && dayDate > startDate && dayDate <= endD) return true;
            }
        }
        return false;
    });
    filtered.sort((a, b) => {
        const aTime = a.startTime || '';
        const bTime = b.startTime || '';
        return aTime.localeCompare(bTime);
    });
    return filtered;
}

export function isMultiDayTask(task) {
    if (!task.endDate || !task.date) return false;
    const start = parseFormDate(task.date);
    const end = parseFormDate(task.endDate);
    if (!start || !end) return false;
    start.setHours(0,0,0,0);
    end.setHours(0,0,0,0);
    return end.getTime() !== start.getTime();
}

export function getSpanDays(task) {
    if (!isMultiDayTask(task)) return 1;
    const start = parseFormDate(task.date);
    const end = parseFormDate(task.endDate);
    if (!start || !end) return 1;
    start.setHours(0,0,0,0);
    end.setHours(0,0,0,0);
    return Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

export const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function repeatLabel(pattern, interval) {
    if (!pattern) return '';
    if (pattern === 'daily') return 'Daily';
    if (pattern === 'weekdays') return 'Weekdays';
    if (pattern === 'weekly') return 'Weekly';
    if (pattern === 'monthly') return 'Monthly';
    if (pattern === 'every_n_days') {
        const n = Math.max(1, parseInt(interval, 10) || 1);
        return n === 1 ? 'Daily' : `Every ${n} days`;
    }
    return '';
}

export function formatRepeatTooltip(task) {
    if (!task || !task.repeatPattern) return '';
    const base = repeatLabel(task.repeatPattern, task.repeatInterval);
    const label = base ? `Repeats: ${base}` : 'Repeats';
    if (task.repeatEndedAt) return `${label} (until ${task.repeatEndedAt})`;
    return label;
}

// Human-friendly label for a "Show ahead" horizon expressed in days. Mirrors
// the presets exposed in the recurring-task editor (TaskMenu.jsx
// HORIZON_OPTIONS); falls back to "{n} days" for arbitrary values.
export function horizonLabel(days) {
    const n = Number(days);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n === 30) return '1 month';
    if (n === 90) return '3 months';
    if (n === 180) return '6 months';
    if (n === 365) return '1 year';
    if (n === 730) return '2 years';
    return `${Math.round(n)} days`;
}

// Returns the integer horizonDays override from a task's repeatTemplate, or
// null when the series uses the global default. Accepts either the raw JSON
// string from the API or an already-parsed object.
export function getHorizonDaysFromTemplate(repeatTemplate) {
    if (!repeatTemplate) return null;
    let parsed = repeatTemplate;
    if (typeof repeatTemplate === 'string') {
        try { parsed = JSON.parse(repeatTemplate); } catch { return null; }
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const raw = parsed.horizonDays;
    if (raw == null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Client-side mirror of server/recurrence.js#nextOccurrence. Kept local so
// utils.js stays import-free of server modules.
function clampDayLocal(year, monthIdx, anchorDay) {
    const lastDay = new Date(year, monthIdx + 1, 0).getDate();
    return Math.min(anchorDay, lastDay);
}

function nextOccurrenceLocal(pattern, interval, anchorDateStr, prevDateStr) {
    const anchor = parseFormDate(anchorDateStr);
    const prev = parseFormDate(prevDateStr);
    if (!anchor || !prev) return null;
    if (pattern === 'daily') {
        const n = new Date(prev); n.setDate(n.getDate() + 1); return formDate(n);
    }
    if (pattern === 'weekly') {
        const n = new Date(prev); n.setDate(n.getDate() + 7); return formDate(n);
    }
    if (pattern === 'weekdays') {
        const n = new Date(prev);
        do { n.setDate(n.getDate() + 1); } while (n.getDay() === 0 || n.getDay() === 6);
        return formDate(n);
    }
    if (pattern === 'monthly') {
        const anchorDay = anchor.getDate();
        const cand = new Date(prev.getFullYear(), prev.getMonth() + 1, 1);
        cand.setDate(clampDayLocal(cand.getFullYear(), cand.getMonth(), anchorDay));
        return formDate(cand);
    }
    if (pattern === 'every_n_days') {
        const k = Math.max(1, parseInt(interval, 10) || 1);
        const n = new Date(prev); n.setDate(n.getDate() + k); return formDate(n);
    }
    return null;
}

// True when this materialized occurrence is the last one in a bounded series:
// the next occurrence after `task.date` would fall after `repeatEndedAt` (or the
// pattern has no further occurrences).
export function isFinalRecurringOccurrence(task) {
    if (!task || !task.repeatSeriesId || !task.repeatEndedAt) return false;
    if (!task.repeatPattern || !task.repeatAnchorDate || !task.date) return false;
    const own = parseFormDate(task.date);
    const end = parseFormDate(task.repeatEndedAt);
    if (!own || !end) return false;
    if (own > end) return false;
    const nxt = nextOccurrenceLocal(task.repeatPattern, task.repeatInterval, task.repeatAnchorDate, task.date);
    if (!nxt) return true;
    const nxtDate = parseFormDate(nxt);
    if (!nxtDate) return true;
    return nxtDate > end;
}

export function formatRepeatEndShort(repeatEndedAt) {
    if (!repeatEndedAt) return '';
    const d = parseFormDate(repeatEndedAt);
    if (!d || isNaN(d.getTime())) return String(repeatEndedAt);
    const now = new Date();
    const sameYear = now.getFullYear() === d.getFullYear();
    return sameYear
        ? `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`
        : `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}


const formBlurDict = {
    "login-form": "login-form",
    "task-menu": "task-menu",
    "update-user-form": "update-user-form",
    "signup-form": "signup-form",
}

export function formTransition(from, to) {
    closeForm(from);
    openForm(to);
}

export function openForm(formBlurId) {
    const formBlur = document.querySelector(`[data-id='${formBlurId}']`);
    formBlur.classList.add('active');
    formBlur.querySelector(`.${formBlurId}`).animate([
        {
            top: "6rem",
            opacity: .5,
        },
        {
            top: "3.5rem",
            opacity: 1,
        },
    ], {
        duration: 300,
        fill: "forwards",
    });
}

export function closeForm(formBlurId) {
    const fromForm = document.querySelector(`.blur-bg[data-id="${formBlurId}"]`);
    fromForm.classList.remove("active");
}