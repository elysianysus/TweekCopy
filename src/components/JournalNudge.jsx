import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function JournalNudge() {
    const [, setSearchParams] = useSearchParams();
    const { currentUser } = useAuth();
    const [nudge, setNudge] = useState(null);

    useEffect(() => {
        function onCompleted(ev) {
            if (currentUser?.journalNudgeEnabled === false) return;
            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            setNudge({ id, taskName: ev.detail?.name || '' });
            setTimeout(() => {
                setNudge((cur) => (cur && cur.id === id ? null : cur));
            }, 8000);
        }
        window.addEventListener('journal:taskCompleted', onCompleted);
        return () => window.removeEventListener('journal:taskCompleted', onCompleted);
    }, [currentUser]);

    function openJournal() {
        setSearchParams((prev) => { prev.set('view', 'journal'); return prev; });
        setTimeout(() => window.dispatchEvent(new Event('journal:focusInput')), 100);
        setNudge(null);
    }

    if (!nudge) return null;

    return (
        <div className="fixed bottom-20 lg:bottom-6 right-4 z-[80] max-w-xs animate-slideIn">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 px-4 py-3">
                <div className="flex items-start gap-3">
                    <span className="text-xl mt-0.5">✅</span>
                    <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-gray-900 dark:text-white">Done!</div>
                        <div className="text-[11px] text-gray-500 mt-0.5 truncate">{nudge.taskName}</div>
                        <div className="text-xs mt-1.5 text-gray-700 dark:text-gray-300">What's next? Just one line.</div>
                        <div className="flex gap-2 mt-2">
                            <button
                                onClick={openJournal}
                                className="text-[11px] px-2.5 py-1 rounded-full bg-blue-500 text-white font-medium hover:bg-blue-600"
                            >
                                <i className="fa-solid fa-feather mr-1" /> Journal it
                            </button>
                            <button
                                onClick={() => setNudge(null)}
                                className="text-[11px] px-2.5 py-1 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
