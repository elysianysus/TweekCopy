import React, { useRef, useState } from 'react';
import { createTask } from '../../scripts/api.js';

export default function ActualEntryInput({ dateStr, hour, onTasksChanged }) {
    const [active, setActive] = useState(false);
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const pending = useRef(false);
    const time = `${String(hour).padStart(2, '0')}:00`;

    async function save(e) {
        e.preventDefault();
        if (!name.trim() || pending.current) return;
        pending.current = true;
        setSaving(true);
        setError('');
        try {
            await createTask({
                name: name.trim(), date: dateStr, done: true, order: 0,
                color: 'white text-black dark:text-white dark:bg-black',
                startTime: time, endDate: dateStr,
                endTime: `${String(hour + 1).padStart(2, '0')}:00`,
            });
        } catch (err) {
            setError(err.message || 'Could not save entry. Please retry.');
            return;
        } finally {
            pending.current = false;
            setSaving(false);
        }
        setName('');
        setActive(false);
        try {
            await onTasksChanged?.();
        } catch {
            setError('Entry saved, but the list could not refresh. Please reload.');
        }
    }

    if (!active) return (
        <div>
            <button type="button" onClick={() => setActive(true)}
                aria-label={`Add actual entry at ${time}`}
                className="w-full text-left px-1 py-1 text-[10px] text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950">
                + Add entry · {time}
            </button>
            {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        </div>
    );
    return (
        <form onSubmit={save} className="p-1 space-y-1">
            <input autoFocus value={name} onChange={e => setName(e.target.value)}
                aria-label={`Actual entry at ${time}`} placeholder="What did you do?"
                disabled={saving}
                className="w-full min-w-0 border rounded p-1 text-xs bg-transparent"
                onKeyDown={e => {
                    if (e.key === 'Escape' && !pending.current) {
                        setActive(false); setName(''); setError('');
                    }
                }} />
            <div className="flex flex-wrap gap-2 text-xs">
                <button type="submit" disabled={saving || !name.trim()} className="text-emerald-600 disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" disabled={saving} onClick={() => {
                    setActive(false); setName(''); setError('');
                }}>Cancel</button>
            </div>
            {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        </form>
    );
}
