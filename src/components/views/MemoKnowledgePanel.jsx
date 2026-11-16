/* eslint-disable react/prop-types */
import { useEffect, useId, useRef, useState } from 'react';
import { getMemoKnowledgeStatus, syncMemoKnowledge, askMemoKnowledge, getRelatedMemoKnowledge } from '../../scripts/api.js';
import './MemoKnowledgePanel.css';

const actionClass = 'text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed';

// An inline disclosure keeps the writing surface mounted, including unsaved edits.
export default function MemoKnowledgePanel({ memoId, onOpenMemo }) {
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState(null);
    const [statusError, setStatusError] = useState('');
    const [statusLoading, setStatusLoading] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const [busy, setBusy] = useState('');
    const [actionError, setActionError] = useState('');
    const [notice, setNotice] = useState('');
    const [question, setQuestion] = useState('');
    const [answer, setAnswer] = useState(null);
    const [askedQuestion, setAskedQuestion] = useState('');
    const [related, setRelated] = useState(null);
    const [relatedError, setRelatedError] = useState('');
    const [relatedLoading, setRelatedLoading] = useState(false);
    const session = useRef(null);
    const actionLock = useRef(false);
    const relatedLock = useRef(false);
    const id = useId();

    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        session.current = controller;
        actionLock.current = false;
        relatedLock.current = false;
        setBusy('');
        setActionError('');
        setStatus(null);
        setStatusLoading(true);
        setRelated(null);
        setRelatedError('');
        setRelatedLoading(false);
        let polling = false;
        async function loadStatus() {
            if (polling) return;
            polling = true;
            try {
                const data = await getMemoKnowledgeStatus({ signal: controller.signal });
                if (!controller.signal.aborted) {
                    setStatus(data);
                    setStatusError('');
                }
            } catch (err) {
                if (!controller.signal.aborted) setStatusError(err.message || 'Could not check your notebook index.');
            } finally {
                polling = false;
                if (!controller.signal.aborted) setStatusLoading(false);
            }
        }
        loadStatus();
        const timer = setInterval(loadStatus, 15000);
        return () => {
            controller.abort();
            clearInterval(timer);
        };
    }, [open, memoId, refresh]);

    async function loadRelated() {
        const controller = session.current;
        if (!controller || controller.signal.aborted || relatedLock.current) return;
        relatedLock.current = true;
        setRelatedLoading(true);
        setRelatedError('');
        try {
            const data = await getRelatedMemoKnowledge(memoId, { signal: controller.signal });
            if (!controller.signal.aborted) setRelated(data);
        } catch (err) {
            if (!controller.signal.aborted) setRelatedError(err.message || 'Could not find related notes.');
        } finally {
            if (!controller.signal.aborted) {
                relatedLock.current = false;
                setRelatedLoading(false);
            }
        }
    }

    async function runAction(kind, event) {
        event?.preventDefault();
        const controller = session.current;
        if (!controller || controller.signal.aborted || actionLock.current || relatedLock.current) return;
        if (kind === 'ask' && !question.trim()) return;
        if (kind === 'sync' && !window.confirm('Enable automatic sync and index existing memos? Memo text will be sent to the configured Neo4j and OpenAI services. This may incur costs.')) return;
        actionLock.current = true;
        setBusy(kind);
        setActionError('');
        setNotice('');
        if (kind === 'ask') {
            setAnswer(null);
            setAskedQuestion(question.trim());
        }
        try {
            if (kind === 'sync') {
                await syncMemoKnowledge({ signal: controller.signal });
                if (!controller.signal.aborted) {
                    setNotice('Sync requested. Automatic sync is enabled; indexing may take a little time.');
                    const data = await getMemoKnowledgeStatus({ signal: controller.signal });
                    if (!controller.signal.aborted) setStatus(data);
                }
            } else {
                const data = await askMemoKnowledge(question.trim(), { signal: controller.signal });
                if (!controller.signal.aborted) setAnswer(data);
            }
        } catch (err) {
            if (!controller.signal.aborted) setActionError(err.message || 'That request did not finish. Please try again.');
        } finally {
            if (!controller.signal.aborted) {
                actionLock.current = false;
                setBusy('');
            }
        }
    }

    function renderSources(sources) {
        if (!sources?.length) return null;
        return (
            <ul className="mt-2 space-y-1">
                {sources.map((source, index) => (
                    <li key={`${source.id}-${index}`}>
                        <button type="button" disabled={!onOpenMemo} onClick={() => onOpenMemo?.(source)}
                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline text-left break-words py-1 disabled:opacity-50">
                            <i className="fa-solid fa-link text-[9px] mr-1.5" aria-hidden="true" />
                            {source.title || 'Untitled memo'}
                        </button>
                    </li>
                ))}
            </ul>
        );
    }

    function renderFacts(facts) {
        if (!facts?.length) return null;
        return (
            <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-gray-500 dark:text-gray-400 py-1">Connections found · {facts.length}</summary>
                <ul className="mt-2 space-y-3 border-l border-gray-200 dark:border-gray-600 pl-3">
                    {facts.map((fact, index) => (
                        <li key={index}>
                            <p className="whitespace-pre-wrap break-words">{fact.fact}</p>
                            {(fact.validAt || fact.invalidAt) && (
                                <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                                    {fact.validAt && <>Valid from <time dateTime={fact.validAt}>{formatDate(fact.validAt)}</time></>}
                                    {fact.validAt && fact.invalidAt && ' · '}
                                    {fact.invalidAt && <>Invalid from <time dateTime={fact.invalidAt}>{formatDate(fact.invalidAt)}</time></>}
                                </p>
                            )}
                        </li>
                    ))}
                </ul>
            </details>
        );
    }

    return (
        <section className="memo-knowledge my-3 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 bg-gray-50/60 dark:bg-gray-800/40">
            <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}
                className="w-full flex items-center gap-2 p-3 text-left rounded-xl hover:bg-gray-100/70 dark:hover:bg-gray-700/40">
                <i className="fa-solid fa-diagram-project text-xs text-gray-400" aria-hidden="true" />
                <span className="flex-1 text-xs font-medium">{memoId ? 'Connections around this memo' : 'Ask your notebook'}</span>
                <span className="text-[10px] text-gray-400">Graphiti</span>
                <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-[9px] text-gray-400`} aria-hidden="true" />
            </button>
            {open && (
                <div id={id} className="knowledge-reveal px-3 pb-4 space-y-4">
                    <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                        Follow a thread between your reflections. Answers use currently indexed memo text, not a complete history of your notebook. Save edits before looking for new connections.
                    </p>
                    <div aria-live="polite" aria-busy={statusLoading}>
                        {statusLoading && <div className="h-8 rounded bg-gray-200/60 dark:bg-gray-700/60" role="status"><span className="sr-only">Checking notebook index…</span></div>}
                        {statusError && <div role="alert" className="text-xs text-amber-700 dark:text-amber-300">{statusError} <button type="button" className="underline ml-1" disabled={!!busy} onClick={() => setRefresh(value => value + 1)}>Retry status</button></div>}
                        {status && (
                            <div className="text-[11px] space-y-2">
                                <p className="font-medium">{!status.configured ? 'Connection not configured' : !status.enabled ? 'Your notebook is not connected yet' : 'Automatic sync enabled'}</p>
                                <p className="text-gray-500 dark:text-gray-400">
                                    {status.synced} of {status.total} memos indexed · {status.pending} pending · {status.failed} failed
                                </p>
                                {status.total === 0 && <p>Add a memo to start weaving connections.</p>}
                                {!status.configured && <p className="text-gray-500 dark:text-gray-400">Configure Neo4j and OpenAI on the server to connect your memos.</p>}
                                {status.lastError && <p className="text-amber-700 dark:text-amber-300 break-words" role="alert">Last sync error: {status.lastError}</p>}
                                <p className="text-gray-500 dark:text-gray-400 leading-relaxed">Enabling sync sends existing and future memo text to the configured Neo4j and OpenAI services and may incur costs.</p>
                                <button type="button" className={actionClass} disabled={!status.configured || !!busy || relatedLoading || !!statusError}
                                    onClick={event => runAction('sync', event)}>
                                    {busy === 'sync' ? 'Requesting sync…' : !status.enabled ? 'Enable automatic sync & index memos' : status.failed > 0 ? 'Retry sync' : 'Sync memos now'}
                                </button>
                            </div>
                        )}
                    </div>
                    {notice && <p role="status" className="text-xs text-blue-600 dark:text-blue-400">{notice}</p>}
                    {memoId && (
                        <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                            <div className="flex items-center justify-between gap-2">
                                <h3 className="text-xs font-medium">Related notes</h3>
                                <button type="button" className={actionClass} onClick={loadRelated}
                                    disabled={!status?.configured || !status?.enabled || !!busy || relatedLoading || !!statusError}>
                                    {relatedLoading ? 'Looking…' : related || relatedError ? 'Try again' : 'Find connections'}
                                </button>
                            </div>
                            <p className="text-[10px] text-gray-500 mt-1">Based on the saved, indexed version of this memo.</p>
                            {relatedLoading && <div role="status" className="mt-2 space-y-2"><span className="sr-only">Finding related notes…</span><div className="h-3 rounded bg-gray-200/60 dark:bg-gray-700" /><div className="h-3 w-2/3 rounded bg-gray-200/60 dark:bg-gray-700" /></div>}
                            {relatedError && <p role="alert" className="mt-2 text-xs text-amber-700 dark:text-amber-300">{relatedError}</p>}
                            {!relatedLoading && related && <>
                                {!related.sources?.length && !related.facts?.length && <p className="mt-3 text-xs text-gray-500">No connections found yet. Try again after more of your notes have been indexed.</p>}
                                {renderSources(related.sources)}
                                {renderFacts(related.facts)}
                            </>}
                        </div>
                    )}
                    <form onSubmit={event => runAction('ask', event)} className="border-t border-gray-200 dark:border-gray-700 pt-3">
                        <label htmlFor={`${id}-question`} className="block text-xs font-medium mb-2">What would you like to reflect on?</label>
                        <textarea id={`${id}-question`} value={question} onChange={event => setQuestion(event.target.value)}
                            rows={2} maxLength={4000} placeholder="What themes keep coming up in my reflections?"
                            disabled={!!busy}
                            className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-transparent p-2.5 resize-y placeholder-gray-400 disabled:opacity-50" />
                        <div className="flex items-center justify-between gap-3 mt-2">
                            <p className="text-[10px] text-gray-500">AI can miss context. Return to the source notes.</p>
                            <button type="submit" className={actionClass} disabled={!question.trim() || !!busy || relatedLoading || !status?.enabled || !status?.configured || !status?.synced || !!statusError}>
                                {busy === 'ask' ? 'Reflecting…' : 'Ask'}
                            </button>
                        </div>
                    </form>
                    {actionError && <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">{actionError} Use the same button to retry.</p>}
                    <div aria-live="polite" aria-busy={busy === 'ask'}>
                        {busy === 'ask' && <div role="status" className="space-y-2"><span className="sr-only">Reading across your indexed notes…</span><div className="h-3 rounded bg-gray-200/60 dark:bg-gray-700" /><div className="h-3 w-3/4 rounded bg-gray-200/60 dark:bg-gray-700" /></div>}
                        {answer && <div className="text-xs leading-relaxed">
                            <p className="text-[10px] text-gray-500 mb-2">Your question · {askedQuestion}</p>
                            <p className="whitespace-pre-wrap break-words">{answer.answer || 'No answer found in the indexed notes. Try a different question or sync more memos.'}</p>
                            {!!answer.sources?.length && <h4 className="text-[10px] font-medium text-gray-500 mt-3">Return to your notes</h4>}
                            {renderSources(answer.sources)}
                            {!answer.sources?.length && <p className="text-[10px] text-gray-500 mt-2">No source notes returned. Treat this answer with care.</p>}
                            {renderFacts(answer.facts)}
                        </div>}
                    </div>
                </div>
            )}
        </section>
    );
}

function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
