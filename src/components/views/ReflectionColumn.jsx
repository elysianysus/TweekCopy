import React, { useEffect, useRef, useState } from 'react';
import {
    REFLECTION_PROMPTS,
    REFLECTION_TITLE,
    emptyReflectionAnswers,
    parseReflectionMemo,
    serializeReflectionMemo,
    isReflectionMemo,
    hasAnyReflectionAnswer,
} from '../../lib/memoTextTemplates.js';
import { createMemo, updateMemo } from '../../scripts/api.js';

export default function ReflectionColumn({ dateStr, dayMemos, setDayMemos, variant = 'desktop' }) {
    const initialMemo = (dayMemos || []).find(m => isReflectionMemo(m.content)) || null;
    const [answers, setAnswers] = useState(() => initialMemo ? parseReflectionMemo(initialMemo.content) : emptyReflectionAnswers());
    const reflectionMemoIdRef = useRef(initialMemo?.id ?? null);
    const lastSavedContentRef = useRef(initialMemo?.content ?? '');
    const hydratedForDateRef = useRef(initialMemo ? dateStr : null);
    const saveTimerRef = useRef(null);
    const creatingRef = useRef(false);

    // Hydrate when the date changes, on first appearance of the memo for the
    // current date (mobile tab opening after fetch), or when an external edit
    // mutates its content.
    useEffect(() => {
        const memo = (dayMemos || []).find(m => isReflectionMemo(m.content)) || null;
        if (memo) {
            const firstHydrationForDate = hydratedForDateRef.current !== dateStr;
            if (firstHydrationForDate || memo.content !== lastSavedContentRef.current) {
                setAnswers(parseReflectionMemo(memo.content));
                lastSavedContentRef.current = memo.content;
                hydratedForDateRef.current = dateStr;
            }
            reflectionMemoIdRef.current = memo.id;
        } else {
            if (hydratedForDateRef.current !== dateStr) {
                setAnswers(emptyReflectionAnswers());
                lastSavedContentRef.current = '';
                reflectionMemoIdRef.current = null;
                hydratedForDateRef.current = dateStr;
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dateStr, dayMemos]);

    function scheduleSave(nextAnswers) {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
            try {
                const memo = (dayMemos || []).find(m => m.id === reflectionMemoIdRef.current)
                    || (dayMemos || []).find(m => isReflectionMemo(m.content))
                    || null;
                const existing = memo?.content || '';
                const newContent = serializeReflectionMemo(nextAnswers, existing);

                if (memo) {
                    lastSavedContentRef.current = newContent;
                    await updateMemo(memo.id, { content: newContent });
                    setDayMemos(prev => prev.map(m => m.id === memo.id ? { ...m, content: newContent } : m));
                } else {
                    if (!hasAnyReflectionAnswer(nextAnswers)) return;
                    if (creatingRef.current) return;
                    creatingRef.current = true;
                    try {
                        const created = await createMemo({ content: newContent, date: dateStr });
                        lastSavedContentRef.current = newContent;
                        reflectionMemoIdRef.current = created.id;
                        setDayMemos(prev => {
                            if (prev.some(m => m.id === created.id)) return prev;
                            return [...prev, { ...created, files: created.files || [] }];
                        });
                    } finally {
                        creatingRef.current = false;
                    }
                }
            } catch (e) {
                console.error('Reflection save failed:', e);
            }
        }, 800);
    }

    function handleChange(promptId, value) {
        setAnswers(prev => {
            const next = { ...prev, [promptId]: value };
            scheduleSave(next);
            return next;
        });
    }

    useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

    const isMobile = variant === 'mobile';
    const labelClass = isMobile
        ? 'text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1'
        : 'text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-0.5';
    const textareaClass = isMobile
        ? 'w-full bg-transparent text-sm focus:outline-none resize-none placeholder-gray-300 dark:placeholder-gray-600 min-h-[44px] leading-snug'
        : 'w-full bg-transparent text-xs focus:outline-none resize-none placeholder-gray-300 dark:placeholder-gray-600 min-h-[38px] leading-snug';

    return (
        <div className={isMobile ? 'p-2 space-y-3' : 'p-2 space-y-2'}>
            {REFLECTION_PROMPTS.map(p => (
                <div key={p.id} className="border-b border-gray-100 dark:border-gray-800 pb-1.5">
                    <div className={labelClass}>{p.label}</div>
                    <textarea
                        value={answers[p.id] || ''}
                        onChange={e => handleChange(p.id, e.target.value)}
                        placeholder="…"
                        rows={isMobile ? 3 : 2}
                        className={textareaClass}
                    />
                </div>
            ))}
            <div className={`${isMobile ? 'text-[10px]' : 'text-[9px]'} text-gray-300 dark:text-gray-600 italic pt-1`}>
                {REFLECTION_TITLE} · 吾日三省吾身
            </div>
        </div>
    );
}
