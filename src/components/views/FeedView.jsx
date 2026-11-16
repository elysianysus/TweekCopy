import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getRssFeeds, addRssFeed, deleteRssFeed, updateRssFeed, fetchRssFeed, submitEmail, getEmailInbox, deleteEmail, getGmailStatus, getGmailAuthUrl, disconnectGmail, updateGmailSettings, gmailCheckNow, addHkPack, addYoutubeFeed, getDigestPreferences, putDigestPreferences, createMemo } from '../../scripts/api.js';

const YT_CHANNEL_FEED_RE = /^https?:\/\/(www\.)?youtube\.com\/feeds\/videos\.xml\?channel_id=UC/i;
const isYoutubeChannelFeed = (url) => YT_CHANNEL_FEED_RE.test(url || '');

function timeAgo(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        const now = new Date();
        const diff = now - d;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        if (days < 30) return `${days}d ago`;
        return d.toLocaleDateString();
    } catch { return dateStr; }
}

function FeedSidebar({ feeds, activeFeedId, onSelect, onAdd, onDelete, onToggleAutoSummarize, onShowAll, onShowInbox, onShowDigest, onAddHkPack, onAddYoutube, packBusy, ytBusy }) {
    const [adding, setAdding] = useState(false);
    const [newUrl, setNewUrl] = useState('');
    const [newTitle, setNewTitle] = useState('');
    const [ytInput, setYtInput] = useState('');
    const [showYt, setShowYt] = useState(false);

    async function handleAdd() {
        if (!newUrl.trim()) return;
        await onAdd(newUrl.trim(), newTitle.trim() || null);
        setNewUrl('');
        setNewTitle('');
        setAdding(false);
    }

    async function handleYt() {
        if (!ytInput.trim()) return;
        await onAddYoutube(ytInput.trim());
        setYtInput('');
        setShowYt(false);
    }

    return (
        <div className="w-full lg:w-56 shrink-0 space-y-1">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Feeds</h3>
                <button onClick={() => setAdding(!adding)}
                    className={`w-6 h-6 rounded-md flex items-center justify-center transition cursor-pointer ${adding ? 'bg-black dark:bg-white text-white dark:text-black' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                    <i className={`fa-solid ${adding ? 'fa-xmark' : 'fa-plus'} text-[10px]`} />
                </button>
            </div>

            {adding && (
                <div className="space-y-1.5 pb-2 border-b border-gray-100 dark:border-gray-800 mb-2">
                    <input type="text" value={newUrl} onChange={e => setNewUrl(e.target.value)}
                        placeholder="Feed URL (RSS/Atom)" autoFocus
                        className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-blue-400 placeholder-gray-400" />
                    <input type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)}
                        placeholder="Title (optional)"
                        className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-blue-400 placeholder-gray-400" />
                    <button onClick={handleAdd}
                        className="w-full text-[11px] bg-black dark:bg-white text-white dark:text-black px-3 py-1.5 rounded-lg font-medium hover:opacity-80 transition cursor-pointer">
                        Add Feed
                    </button>
                </div>
            )}

            <button onClick={onShowAll}
                className={`w-full text-left text-xs px-2.5 py-2 transition cursor-pointer flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 ${activeFeedId === 'all' ? 'font-semibold text-black dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'}`}>
                All Articles
            </button>

            <button onClick={onShowDigest}
                className={`w-full text-left text-xs px-2.5 py-2 transition cursor-pointer flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 ${activeFeedId === 'digest' ? 'font-semibold text-black dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'}`}>
                <i className="fa-solid fa-newspaper text-[10px]" />Daily Digest
            </button>

            <button onClick={onShowInbox}
                className={`w-full text-left text-xs px-2.5 py-2 transition cursor-pointer flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 ${activeFeedId === 'inbox' ? 'font-semibold text-black dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'}`}>
                Email Inbox
            </button>

            <div className="pt-2 mt-2 space-y-1.5 border-t border-gray-100 dark:border-gray-800">
                <button onClick={onAddHkPack} disabled={packBusy}
                    className="w-full text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-400 transition cursor-pointer flex items-center gap-1.5 disabled:opacity-40">
                    <i className={`fa-solid ${packBusy ? 'fa-spinner animate-spin' : 'fa-flag'} text-[10px]`} />
                    {packBusy ? 'Adding...' : 'Add HK news pack'}
                </button>
                <button onClick={() => setShowYt(s => !s)}
                    className="w-full text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-400 transition cursor-pointer flex items-center gap-1.5">
                    <i className={`fa-brands fa-youtube text-[10px] text-red-500`} />
                    Add YouTube channel
                </button>
                {showYt && (
                    <div className="space-y-1.5 pt-1">
                        <input type="text" value={ytInput} onChange={e => setYtInput(e.target.value)}
                            placeholder="URL, @handle, or UC… ID" autoFocus
                            className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-blue-400 placeholder-gray-400" />
                        <button onClick={handleYt} disabled={ytBusy || !ytInput.trim()}
                            className="w-full text-[11px] bg-black dark:bg-white text-white dark:text-black px-3 py-1.5 rounded-lg font-medium hover:opacity-80 transition cursor-pointer disabled:opacity-40">
                            {ytBusy ? 'Resolving...' : 'Add channel'}
                        </button>
                    </div>
                )}
            </div>

            <div className="pt-1 mt-1">
                {feeds.map(feed => {
                    const isYt = isYoutubeChannelFeed(feed.url);
                    const auto = !!feed.autoSummarize;
                    return (
                        <div key={feed.id}
                            className={`group flex items-center gap-2 text-xs px-2.5 py-2 border-b border-gray-100 dark:border-gray-800 transition cursor-pointer ${activeFeedId === feed.id ? 'font-semibold text-black dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'}`}
                            onClick={() => onSelect(feed.id)}>
                            <span className="flex-1 truncate flex items-center gap-1.5">
                                {isYt && <i className="fa-brands fa-youtube text-red-500 text-[10px]" />}
                                <span className="truncate">{feed.title || feed.url}</span>
                            </span>
                            {isYt && (
                                <button
                                    onClick={e => { e.stopPropagation(); onToggleAutoSummarize(feed.id, !auto); }}
                                    title={auto ? 'Auto-summarize on (click to disable)' : 'Auto-summarize new videos'}
                                    className={`text-[9px] px-1.5 py-0.5 rounded border transition cursor-pointer ${auto ? 'bg-emerald-500 text-white border-emerald-500' : 'border-gray-200 dark:border-gray-700 text-gray-400 hover:border-emerald-400 hover:text-emerald-500'}`}>
                                    <i className={`fa-solid ${auto ? 'fa-wand-magic-sparkles' : 'fa-wand-magic'}`} />
                                    <span className="ml-1">{auto ? 'Auto' : 'Auto?'}</span>
                                </button>
                            )}
                            <button onClick={e => { e.stopPropagation(); onDelete(feed.id); }}
                                className="hidden group-hover:block text-gray-400 hover:text-red-400 cursor-pointer">
                                <i className="fa-solid fa-xmark text-[9px]" />
                            </button>
                        </div>
                    );
                })}
                {feeds.length === 0 && !adding && (
                    <p className="text-[10px] text-gray-400 text-center py-4">No feeds yet. Click + to add one.</p>
                )}
            </div>
        </div>
    );
}

function ArticleList({ articles, selectedIdx, onSelect, loading }) {
    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-gray-400">
                <i className="fa-solid fa-spinner animate-spin mr-2" />Loading...
            </div>
        );
    }

    if (articles.length === 0) {
        return (
            <div className="text-center py-20 text-gray-400">
                <i className="fa-solid fa-newspaper text-3xl mb-3" />
                <p className="text-sm">No articles yet</p>
            </div>
        );
    }

    return (
        <div className="border-t border-gray-200 dark:border-gray-800">
            {articles.map((article, idx) => (
                <button key={idx} onClick={() => onSelect(idx)}
                    className="w-full text-left border-b border-gray-200 dark:border-gray-800 py-3 px-1 transition cursor-pointer hover:bg-gray-50/50 dark:hover:bg-gray-900/30 group">
                    <div className="flex items-baseline gap-3">
                        <p className="flex-1 text-[13px] leading-snug text-black dark:text-white font-normal group-hover:underline underline-offset-2">
                            {article.title || '(untitled)'}
                        </p>
                        <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">
                            {article.pubDate ? timeAgo(article.pubDate) : ''}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                        {article.feedTitle && (
                            <span className="text-[10px] text-gray-400 uppercase tracking-wider">{article.feedTitle}</span>
                        )}
                        {article.feedTitle && article.description && (
                            <span className="text-gray-300 dark:text-gray-700 text-[10px]">·</span>
                        )}
                        {article.description && (
                            <p className="text-[11px] text-gray-400 line-clamp-1 flex-1">
                                {article.description.slice(0, 100)}
                            </p>
                        )}
                    </div>
                </button>
            ))}
        </div>
    );
}

function isSafeUrl(url) {
    if (!url) return false;
    try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

function ArticleReader({ article, onClose, onSaveAsMemo }) {
    if (!article) return null;
    const safeLink = isSafeUrl(article.link) ? article.link : null;

    return (
        <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-200 dark:border-gray-800">
                <button onClick={onClose} className="text-gray-400 hover:text-black dark:hover:text-white transition cursor-pointer">
                    <i className="fa-solid fa-arrow-left text-xs" />
                </button>
                <div className="flex-1 min-w-0">
                    <h2 className="text-base font-medium leading-snug text-black dark:text-white">{article.title}</h2>
                    <div className="flex items-center gap-2 mt-1">
                        {article.feedTitle && <span className="text-[10px] text-gray-400 uppercase tracking-wider">{article.feedTitle}</span>}
                        {article.feedTitle && article.pubDate && <span className="text-gray-300 dark:text-gray-700 text-[10px]">·</span>}
                        {article.pubDate && <span className="text-[10px] text-gray-400">{timeAgo(article.pubDate)}</span>}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => onSaveAsMemo(article)}
                        className="text-[11px] text-gray-400 hover:text-black dark:hover:text-white transition cursor-pointer underline underline-offset-2">
                        Save
                    </button>
                    {safeLink && (
                        <a href={safeLink} target="_blank" rel="noopener noreferrer"
                            className="text-[11px] text-gray-400 hover:text-black dark:hover:text-white transition underline underline-offset-2">
                            Open ↗
                        </a>
                    )}
                </div>
            </div>
            <div className="text-[13px] leading-[1.9] text-gray-700 dark:text-gray-300 max-w-2xl">
                {article.description || 'No preview available. Click "Open" to read the full article.'}
            </div>
        </div>
    );
}

function GmailPanel({ gmail, onRefresh }) {
    const [checking, setChecking] = useState(false);
    const [checkResult, setCheckResult] = useState(null);
    const [disconnecting, setDisconnecting] = useState(false);

    async function handleConnect() {
        try {
            const data = await getGmailAuthUrl();
            if (data.url) window.open(data.url, '_blank', 'width=600,height=700');
        } catch (e) { console.error(e); }
    }

    async function handleCheckNow() {
        setChecking(true);
        setCheckResult(null);
        try {
            const data = await gmailCheckNow();
            setCheckResult(data);
            if (data.processed > 0) onRefresh();
        } catch (e) { console.error(e); }
        setChecking(false);
    }

    async function handleDisconnect() {
        if (!confirm('Disconnect Gmail?')) return;
        setDisconnecting(true);
        try {
            await disconnectGmail();
            onRefresh();
        } catch (e) { console.error(e); }
        setDisconnecting(false);
    }

    async function handleToggle() {
        try {
            await updateGmailSettings({ enabled: !gmail.enabled });
            onRefresh();
        } catch (e) { console.error(e); }
    }

    if (!gmail.connected) {
        return (
            <div className="border border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-5 mb-4">
                <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                        <i className="fa-brands fa-google text-red-500 text-sm" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold">Connect Gmail</p>
                        <p className="text-[11px] text-gray-400">Auto-fetch emails with a specific label into your inbox</p>
                    </div>
                </div>
                <button onClick={handleConnect}
                    className="text-[11px] bg-black dark:bg-white text-white dark:text-black px-4 py-2 rounded-lg font-medium hover:opacity-80 transition cursor-pointer flex items-center gap-2">
                    <i className="fa-brands fa-google text-[10px]" />
                    Sign in with Google
                </button>
            </div>
        );
    }

    return (
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-green-50 dark:bg-green-900/20 flex items-center justify-center">
                        <i className="fa-brands fa-google text-green-500 text-sm" />
                    </div>
                    <div>
                        <p className="text-sm font-medium flex items-center gap-2">
                            {gmail.email}
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${gmail.enabled ? 'bg-green-100 dark:bg-green-900/30 text-green-600' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}`}>
                                {gmail.enabled ? 'Active' : 'Paused'}
                            </span>
                        </p>
                        <p className="text-[10px] text-gray-400">
                            Label: <strong>{gmail.label || 'ToAnalogue'}</strong>
                            {gmail.lastChecked && <span> · Last checked: {timeAgo(gmail.lastChecked)}</span>}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-1.5">
                    <button onClick={handleCheckNow} disabled={checking}
                        className="text-[11px] px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-400 transition cursor-pointer flex items-center gap-1.5 disabled:opacity-40">
                        <i className={`fa-solid ${checking ? 'fa-spinner animate-spin' : 'fa-sync'} text-[10px]`} />
                        {checking ? 'Checking...' : 'Check Now'}
                    </button>
                    <button onClick={handleToggle}
                        className="text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-400 transition cursor-pointer">
                        <i className={`fa-solid ${gmail.enabled ? 'fa-pause' : 'fa-play'} text-[10px]`} />
                    </button>
                    <button onClick={handleDisconnect} disabled={disconnecting}
                        className="text-[11px] px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-400 hover:border-red-400 transition cursor-pointer">
                        <i className="fa-solid fa-unlink text-[10px]" />
                    </button>
                </div>
            </div>
            {checkResult && (
                <div className="mt-2 text-[11px] text-green-600 dark:text-green-400">
                    <i className="fa-solid fa-check mr-1" />
                    Processed {checkResult.processed} email{checkResult.processed !== 1 ? 's' : ''}
                </div>
            )}
        </div>
    );
}

function EmailDetail({ email, onBack, onDelete }) {
    const initials = (email.fromAddress || '?').replace(/<.*>/, '').trim().slice(0, 2).toUpperCase();
    const fromName = (email.fromAddress || '').replace(/<.*>/, '').trim() || 'Unknown';
    const fromEmail = (email.fromAddress || '').match(/<(.+?)>/)?.[1] || email.fromAddress || '';

    return (
        <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-5 pb-4 border-b border-gray-100 dark:border-gray-800">
                <button onClick={onBack} className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition cursor-pointer shrink-0">
                    <i className="fa-solid fa-arrow-left text-xs" />
                </button>
                <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-bold leading-snug text-gray-900 dark:text-white">{email.subject || '(no subject)'}</h2>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    {email.processed && (
                        <span className={`text-[10px] px-2.5 py-1 rounded-full font-semibold ${email.resultType === 'task'
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                            : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'}`}>
                            <i className={`fa-solid ${email.resultType === 'task' ? 'fa-check-circle' : 'fa-note-sticky'} mr-1`} />
                            {email.resultType === 'task' ? 'Saved as Task' : 'Saved as Memo'}
                        </span>
                    )}
                    <button onClick={() => { onDelete(email.id); onBack(); }}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 transition cursor-pointer">
                        <i className="fa-solid fa-trash text-xs" />
                    </button>
                </div>
            </div>

            <div className="flex items-start gap-3 mb-5">
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 text-sm font-bold shrink-0">
                    {initials}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{fromName}</p>
                    {fromEmail && fromEmail !== fromName && (
                        <p className="text-[11px] text-gray-400 mt-0.5">{fromEmail}</p>
                    )}
                </div>
                <span className="text-[11px] text-gray-400 shrink-0 mt-0.5">
                    {email.createdAt && timeAgo(email.createdAt)}
                </span>
            </div>

            <div className="bg-white dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 text-[13px] leading-[1.8] text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {email.body || '(no content)'}
            </div>
        </div>
    );
}

function EmailInboxView({ emails, loading, onSubmit, onDelete, submitting, gmail, onGmailRefresh }) {
    const [showForm, setShowForm] = useState(false);
    const [selectedEmailId, setSelectedEmailId] = useState(null);
    const [from, setFrom] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');

    const selectedEmail = selectedEmailId !== null ? emails.find(e => e.id === selectedEmailId) : null;

    async function handleSubmit() {
        if (!subject.trim() && !body.trim()) return;
        await onSubmit(from, subject, body);
        setFrom('');
        setSubject('');
        setBody('');
        setShowForm(false);
    }

    if (selectedEmail) {
        return <EmailDetail email={selectedEmail} onBack={() => setSelectedEmailId(null)} onDelete={onDelete} />;
    }

    return (
        <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                    <i className="fa-solid fa-envelope text-blue-400" />
                    Email Inbox
                    <span className="text-xs text-gray-400 font-normal">Forward emails here to create tasks/memos</span>
                </h3>
                <button onClick={() => setShowForm(!showForm)}
                    className={`text-[11px] px-3 py-1.5 rounded-lg border transition cursor-pointer flex items-center gap-1.5 ${showForm ? 'bg-black dark:bg-white text-white dark:text-black border-transparent' : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-400'}`}>
                    <i className={`fa-solid ${showForm ? 'fa-xmark' : 'fa-paste'} text-[10px]`} />
                    {showForm ? 'Cancel' : 'Paste Email'}
                </button>
            </div>

            <GmailPanel gmail={gmail} onRefresh={onGmailRefresh} />

            {showForm && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-4 space-y-2">
                    <input type="text" value={from} onChange={e => setFrom(e.target.value)}
                        placeholder="From (e.g. boss@company.com)"
                        className="w-full text-xs px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-blue-400 placeholder-gray-400" />
                    <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
                        placeholder="Subject"
                        className="w-full text-xs px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-blue-400 placeholder-gray-400 font-medium" />
                    <textarea value={body} onChange={e => setBody(e.target.value)}
                        placeholder="Paste email body here..."
                        className="w-full text-xs px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-blue-400 placeholder-gray-400 resize-none font-mono"
                        rows={8} />
                    <div className="flex justify-end">
                        <button onClick={handleSubmit} disabled={submitting || (!subject.trim() && !body.trim())}
                            className="text-[11px] bg-black dark:bg-white text-white dark:text-black px-4 py-1.5 rounded-lg font-medium hover:opacity-80 transition cursor-pointer disabled:opacity-40 flex items-center gap-1.5">
                            <i className={`fa-solid ${submitting ? 'fa-spinner animate-spin' : 'fa-wand-magic-sparkles'} text-[10px]`} />
                            {submitting ? 'Processing...' : 'AI Classify & Save'}
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-20 text-gray-400">
                    <i className="fa-solid fa-spinner animate-spin mr-2" />Loading...
                </div>
            ) : emails.length === 0 ? (
                <div className="text-center py-20 text-gray-400">
                    <i className="fa-solid fa-inbox text-4xl mb-3" />
                    <p className="text-sm">No emails yet</p>
                    <p className="text-xs mt-1">Connect Gmail above or paste a forwarded email</p>
                </div>
            ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden">
                    {emails.map(email => {
                        const initials = (email.fromAddress || '?').replace(/<.*>/, '').trim().slice(0, 2).toUpperCase();
                        const senderName = (email.fromAddress || 'Unknown').replace(/<.*>/, '').trim();
                        return (
                            <div key={email.id} onClick={() => setSelectedEmailId(email.id)}
                                className="group flex items-start gap-3 px-4 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition cursor-pointer">
                                <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 text-[11px] font-bold shrink-0 mt-0.5">
                                    {initials}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[12px] font-semibold text-gray-900 dark:text-white truncate">{senderName}</span>
                                        <span className="text-[10px] text-gray-400 shrink-0">{email.createdAt && timeAgo(email.createdAt)}</span>
                                        {email.processed && (
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${email.resultType === 'task'
                                                ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                                                : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'}`}>
                                                {email.resultType === 'task' ? 'Task' : 'Memo'}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[12px] font-medium text-gray-800 dark:text-gray-200 truncate mt-0.5">{email.subject || '(no subject)'}</p>
                                    {email.body && (
                                        <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{email.body.slice(0, 120)}</p>
                                    )}
                                </div>
                                <button onClick={e => { e.stopPropagation(); onDelete(email.id); }}
                                    className="hidden group-hover:flex w-7 h-7 rounded-full items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 transition cursor-pointer shrink-0 mt-0.5">
                                    <i className="fa-solid fa-trash text-[10px]" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function DigestPanel({ feeds, onSaved, onToast }) {
    const [prefsLoaded, setPrefsLoaded] = useState(false);
    const [selectedIds, setSelectedIds] = useState(() => feeds.map(f => f.id));
    const [windowHours, setWindowHours] = useState(24);
    const [keyword, setKeyword] = useState('');
    const [bySource, setBySource] = useState({});
    const [loading, setLoading] = useState(false);
    const [includedKeys, setIncludedKeys] = useState({});
    const [saving, setSaving] = useState(false);
    const debounceRef = useRef(null);
    const saveDebounceRef = useRef(null);
    const initRef = useRef(false);

    useEffect(() => {
        if (initRef.current) return;
        if (feeds.length === 0) return;
        initRef.current = true;
        (async () => {
            let p = null;
            try { p = await getDigestPreferences(); } catch (e) { console.error(e); }
            const currentFeeds = feeds;
            if (p) {
                setWindowHours(p.windowHours || 24);
                setKeyword(p.keyword || '');
            }
            const savedIds = p && Array.isArray(p.selectedFeedIds) ? p.selectedFeedIds : [];
            const validIds = savedIds.filter(id => currentFeeds.some(f => f.id === id));
            const hkUrlPrefixes = ['rthk.hk', 'analogue-source:tvb-news', 'analogue-source:cr881', 'analogue-source:line-today-hk'];
            const hkFeedIds = currentFeeds
                .filter(f => hkUrlPrefixes.some(p => (f.url || '').includes(p)))
                .map(f => f.id);
            const fallback = hkFeedIds.length ? hkFeedIds : currentFeeds.map(f => f.id);
            setSelectedIds(validIds.length ? validIds : fallback);
            setPrefsLoaded(true);
        })();
    }, [feeds]);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => { loadPreview(); }, 250);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [selectedIds.join(','), windowHours, keyword]);

    useEffect(() => {
        if (!prefsLoaded) return;
        if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = setTimeout(() => {
            putDigestPreferences({ selectedFeedIds: selectedIds, windowHours, keyword }).catch(() => {});
        }, 250);
    }, [prefsLoaded, selectedIds.join(','), windowHours, keyword]);

    async function loadPreview() {
        if (selectedIds.length === 0) { setBySource({}); return; }
        setLoading(true);
        const cutoff = Date.now() - windowHours * 3600 * 1000;
        const kw = keyword.trim().toLowerCase();
        const next = {};
        await Promise.all(selectedIds.map(async (id) => {
            const feed = feeds.find(f => f.id === id);
            if (!feed) return;
            const sourceLabel = feed.title || feed.url;
            try {
                const data = await fetchRssFeed(feed.url);
                if (data.error) {
                    next[id] = { feed, items: [], error: data.error };
                    return;
                }
                let items = (data.items || []).filter(it => {
                    if (!it.pubDate) return windowHours >= 168;
                    const t = new Date(it.pubDate).getTime();
                    return Number.isFinite(t) && t >= cutoff;
                });
                if (kw) {
                    items = items.filter(it =>
                        (it.title || '').toLowerCase().includes(kw) ||
                        (it.description || '').toLowerCase().includes(kw)
                    );
                }
                items = items.slice(0, 30).map(it => ({ ...it, feedId: id, feedTitle: sourceLabel }));
                next[id] = { feed, items, error: null };
            } catch (err) {
                next[id] = { feed, items: [], error: err.message || 'Failed to load' };
            }
        }));
        setBySource(next);
        setLoading(false);
        setIncludedKeys(prev => {
            const updated = { ...prev };
            for (const [id, group] of Object.entries(next)) {
                for (const it of (group.items || [])) {
                    const k = `${id}::${it.link || it.title}`;
                    if (updated[k] === undefined) updated[k] = true;
                }
            }
            return updated;
        });
    }

    function toggleFeed(id) {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    }

    function toggleItem(key) {
        setIncludedKeys(prev => ({ ...prev, [key]: !prev[key] }));
    }

    async function handleSave() {
        setSaving(true);
        try {
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            const dateStr = `${yyyy}-${parseInt(mm)}-${parseInt(dd)}`;
            const isoDate = `${yyyy}-${mm}-${dd}`;
            const lines = [`# 每日新聞摘要 · ${isoDate}`, ''];
            let count = 0;
            for (const id of selectedIds) {
                const group = bySource[id];
                if (!group) continue;
                const picked = (group.items || []).filter(it => includedKeys[`${id}::${it.link || it.title}`] !== false);
                if (picked.length === 0 && !group.error) continue;
                lines.push(`## ${group.feed.title || group.feed.url}`);
                if (group.error) {
                    lines.push(`_${group.error}_`);
                    lines.push('');
                    continue;
                }
                for (const it of picked) {
                    const t = (it.title || '(untitled)').replace(/\n/g, ' ').trim();
                    const when = it.pubDate ? ` — ${it.pubDate}` : '';
                    if (it.link) lines.push(`- [${t}](${it.link})${when}`);
                    else lines.push(`- ${t}${when}`);
                    const desc = (it.description || it.summary || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
                    if (desc) lines.push(`  ${desc.slice(0, 280)}${desc.length > 280 ? '…' : ''}`);
                    count++;
                }
                lines.push('');
            }
            if (count === 0) {
                onToast?.('No items selected to save');
                setSaving(false);
                return;
            }
            const content = lines.join('\n');
            const memo = await createMemo({
                title: `📰 HK Digest · ${isoDate}`,
                content,
                date: dateStr,
                color: 'blue',
                noteType: 'digest',
                tags: ['daily-digest'],
            });
            try {
                await putDigestPreferences({ selectedFeedIds: selectedIds, windowHours, keyword });
            } catch (e) { console.error(e); }
            onSaved?.(memo);
        } catch (err) {
            console.error(err);
            onToast?.(err.message || 'Failed to save digest');
        }
        setSaving(false);
    }

    const totalSelected = Object.entries(bySource).reduce((acc, [id, g]) => {
        return acc + (g.items || []).filter(it => includedKeys[`${id}::${it.link || it.title}`] !== false).length;
    }, 0);

    return (
        <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                    <i className="fa-solid fa-newspaper text-blue-400" />
                    Daily Digest
                    <span className="text-xs text-gray-400 font-normal">Pick stories, save as one Memo</span>
                </h3>
                <button onClick={handleSave} disabled={saving || totalSelected === 0}
                    className="text-[11px] bg-black dark:bg-white text-white dark:text-black px-4 py-1.5 rounded-lg font-medium hover:opacity-80 transition cursor-pointer disabled:opacity-40 flex items-center gap-1.5">
                    <i className={`fa-solid ${saving ? 'fa-spinner animate-spin' : 'fa-floppy-disk'} text-[10px]`} />
                    {saving ? 'Saving...' : `Save to Memo (${totalSelected})`}
                </button>
            </div>

            <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-4 space-y-3">
                <div>
                    <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">Time window</p>
                    <div className="flex flex-wrap gap-1.5">
                        {[6, 12, 24, 48, 168].map(h => (
                            <button key={h} onClick={() => setWindowHours(h)}
                                className={`text-[11px] px-3 py-1 rounded-full border transition cursor-pointer ${windowHours === h ? 'bg-black dark:bg-white text-white dark:text-black border-transparent' : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-400'}`}>
                                {h < 48 ? `Last ${h}h` : (h === 48 ? 'Last 48h' : 'Last 7d')}
                            </button>
                        ))}
                    </div>
                </div>
                <div>
                    <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">Keyword filter (optional)</p>
                    <input type="text" value={keyword} onChange={e => setKeyword(e.target.value)}
                        placeholder="e.g. 立法會, weather, AI"
                        className="w-full text-xs px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-blue-400 placeholder-gray-400" />
                </div>
                <div>
                    <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">Feeds ({selectedIds.length}/{feeds.length})</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {feeds.length === 0 && (
                            <p className="text-[11px] text-gray-400 col-span-full">No feeds yet. Click "Add HK news pack" in the sidebar.</p>
                        )}
                        {feeds.map(f => (
                            <label key={f.id} className="flex items-center gap-2 text-[12px] cursor-pointer">
                                <input type="checkbox" checked={selectedIds.includes(f.id)}
                                    onChange={() => toggleFeed(f.id)} className="cursor-pointer" />
                                <span className="truncate">{f.title || f.url}</span>
                            </label>
                        ))}
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-12 text-gray-400">
                    <i className="fa-solid fa-spinner animate-spin mr-2" />Loading preview...
                </div>
            ) : (
                <div className="space-y-4">
                    {selectedIds.map(id => {
                        const group = bySource[id];
                        if (!group) return null;
                        return (
                            <div key={id} className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
                                <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900/40 flex items-center justify-between">
                                    <p className="text-[12px] font-semibold text-gray-700 dark:text-gray-300 truncate">{group.feed.title || group.feed.url}</p>
                                    <span className="text-[10px] text-gray-400 tabular-nums">
                                        {group.error ? 'unavailable' : `${(group.items || []).length} items`}
                                    </span>
                                </div>
                                {group.error ? (
                                    <p className="px-4 py-3 text-[11px] text-amber-600 dark:text-amber-400">
                                        <i className="fa-solid fa-triangle-exclamation mr-1.5" />{group.error}
                                    </p>
                                ) : (group.items || []).length === 0 ? (
                                    <p className="px-4 py-3 text-[11px] text-gray-400">No matching items in this window.</p>
                                ) : (
                                    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                                        {(group.items || []).map((it, idx) => {
                                            const key = `${id}::${it.link || it.title}`;
                                            const included = includedKeys[key] !== false;
                                            return (
                                                <li key={idx} className="px-4 py-2 flex items-start gap-2.5">
                                                    <input type="checkbox" checked={included}
                                                        onChange={() => toggleItem(key)}
                                                        className="mt-1 cursor-pointer" />
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-[12px] leading-snug text-gray-800 dark:text-gray-200">
                                                            {it.link ? (
                                                                <a href={isSafeUrl(it.link) ? it.link : '#'} target="_blank" rel="noopener noreferrer"
                                                                    className="hover:underline">{it.title || '(untitled)'}</a>
                                                            ) : (it.title || '(untitled)')}
                                                        </p>
                                                        {it.pubDate && (
                                                            <p className="text-[10px] text-gray-400 mt-0.5">{timeAgo(it.pubDate)}</p>
                                                        )}
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default function FeedView() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [feeds, setFeeds] = useState([]);
    const [activeFeedId, setActiveFeedId] = useState('all');
    const [articles, setArticles] = useState([]);
    const [feedError, setFeedError] = useState(null);
    const [selectedArticle, setSelectedArticle] = useState(null);
    const [loading, setLoading] = useState(false);
    const [emails, setEmails] = useState([]);
    const [emailsLoading, setEmailsLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [savedMsg, setSavedMsg] = useState(null);
    const [gmail, setGmail] = useState({ connected: false });
    const [packBusy, setPackBusy] = useState(false);
    const [ytBusy, setYtBusy] = useState(false);

    useEffect(() => {
        loadFeeds();
        loadGmailStatus();
    }, []);

    useEffect(() => {
        if (activeFeedId === 'inbox') {
            loadEmails();
        } else if (activeFeedId === 'all') {
            loadAllArticles();
        } else if (activeFeedId === 'digest') {
            // DigestPanel handles its own data
        } else {
            const feed = feeds.find(f => f.id === activeFeedId);
            if (feed) loadFeedArticles(feed);
        }
    }, [activeFeedId, feeds]);

    async function handleAddHkPack() {
        setPackBusy(true);
        try {
            const res = await addHkPack();
            setSavedMsg(`HK pack: added ${res.added}, skipped ${res.skipped}`);
            setTimeout(() => setSavedMsg(null), 3000);
            await loadFeeds();
        } catch (e) {
            console.error(e);
            setSavedMsg(e.message || 'Failed to add HK pack');
            setTimeout(() => setSavedMsg(null), 3000);
        }
        setPackBusy(false);
    }

    async function handleAddYoutube(input) {
        setYtBusy(true);
        try {
            const res = await addYoutubeFeed(input);
            setSavedMsg(res.created ? `Added YouTube: ${res.feed.title}` : `Already subscribed: ${res.feed.title}`);
            setTimeout(() => setSavedMsg(null), 3000);
            await loadFeeds();
        } catch (e) {
            console.error(e);
            setSavedMsg(e.message || 'Failed to add YouTube channel');
            setTimeout(() => setSavedMsg(null), 4000);
        }
        setYtBusy(false);
    }

    function handleDigestSaved(memo) {
        setSavedMsg('Digest saved to Memo');
        setTimeout(() => setSavedMsg(null), 3000);
        setSearchParams(prev => {
            prev.set('view', 'memo');
            prev.set('openMemo', String(memo.id));
            return prev;
        });
    }

    async function loadGmailStatus() {
        try {
            const data = await getGmailStatus();
            setGmail(data);
        } catch (e) { console.error(e); }
    }

    async function handleGmailRefresh() {
        await loadGmailStatus();
        await loadEmails();
    }

    async function loadFeeds() {
        try {
            const data = await getRssFeeds();
            setFeeds(data);
        } catch (e) { console.error(e); }
    }

    async function loadAllArticles() {
        if (feeds.length === 0) { setArticles([]); return; }
        setLoading(true);
        try {
            const allItems = [];
            for (const feed of feeds) {
                try {
                    const data = await fetchRssFeed(feed.url);
                    const items = (data.items || []).map(item => ({ ...item, feedTitle: feed.title || data.title }));
                    allItems.push(...items);
                } catch (e) { console.error(`Failed to fetch ${feed.url}:`, e); }
            }
            allItems.sort((a, b) => {
                const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
                const db2 = b.pubDate ? new Date(b.pubDate).getTime() : 0;
                return db2 - da;
            });
            setArticles(allItems.slice(0, 100));
        } catch (e) { console.error(e); }
        setLoading(false);
    }

    async function loadFeedArticles(feed) {
        setLoading(true);
        setSelectedArticle(null);
        setFeedError(null);
        try {
            const data = await fetchRssFeed(feed.url);
            if (data.error) {
                const msg = String(data.error);
                setFeedError(msg.startsWith('Source temporarily unavailable') ? msg : `Source temporarily unavailable: ${msg}`);
            }
            const items = (data.items || []).map(item => ({ ...item, feedTitle: feed.title || data.title }));
            setArticles(items);
        } catch (e) {
            console.error(e);
            setArticles([]);
            setFeedError(`Source temporarily unavailable: ${e.message || 'fetch failed'}`);
        }
        setLoading(false);
    }

    async function loadEmails() {
        setEmailsLoading(true);
        try {
            setEmails(await getEmailInbox());
        } catch (e) { console.error(e); }
        setEmailsLoading(false);
    }

    async function handleAddFeed(url, title) {
        try {
            await addRssFeed(url, title);
            await loadFeeds();
        } catch (e) { console.error(e); }
    }

    async function handleDeleteFeed(feedId) {
        try {
            await deleteRssFeed(feedId);
            if (activeFeedId === feedId) setActiveFeedId('all');
            await loadFeeds();
        } catch (e) { console.error(e); }
    }

    async function handleToggleAutoSummarize(feedId, next) {
        const prev = feeds;
        setFeeds(fs => fs.map(f => f.id === feedId ? { ...f, autoSummarize: next } : f));
        try {
            await updateRssFeed(feedId, { autoSummarize: next });
            setSavedMsg(next ? 'Auto-summarize on for this channel' : 'Auto-summarize off');
            setTimeout(() => setSavedMsg(null), 2500);
        } catch (e) {
            console.error(e);
            setFeeds(prev);
            setSavedMsg(e.message || 'Failed to update feed');
            setTimeout(() => setSavedMsg(null), 3000);
        }
    }

    async function handleSubmitEmail(from, subject, body) {
        setSubmitting(true);
        try {
            const result = await submitEmail(from, subject, body);
            setSavedMsg(`Saved as ${result.resultType}`);
            setTimeout(() => setSavedMsg(null), 3000);
            await loadEmails();
        } catch (e) { console.error(e); }
        setSubmitting(false);
    }

    async function handleDeleteEmail(id) {
        try {
            await deleteEmail(id);
            setEmails(prev => prev.filter(e => e.id !== id));
        } catch (e) { console.error(e); }
    }

    async function handleSaveAsMemo(article) {
        try {
            const { createMemo } = await import('../../scripts/api.js');
            await createMemo({
                title: article.title,
                content: `${article.description || ''}\n\nSource: ${article.link || ''}`,
                color: 'blue',
                noteType: 'literature',
                tags: ['rss'],
            });
            setSavedMsg('Saved to Memos');
            setTimeout(() => setSavedMsg(null), 3000);
        } catch (e) { console.error(e); }
    }

    return (
        <div className="padding-x py-4 max-lg:mt-12 dark:bg-black dark:text-white min-h-screen">
            {savedMsg && (
                <div className="fixed top-4 right-4 z-50 bg-green-500 text-white text-xs px-4 py-2 rounded-lg shadow-lg animate-pulse">
                    <i className="fa-solid fa-check mr-1.5" />{savedMsg}
                </div>
            )}

            <div className="flex flex-col lg:flex-row gap-6">
                <FeedSidebar
                    feeds={feeds}
                    activeFeedId={activeFeedId}
                    onSelect={id => setActiveFeedId(id)}
                    onAdd={handleAddFeed}
                    onDelete={handleDeleteFeed}
                    onToggleAutoSummarize={handleToggleAutoSummarize}
                    onShowAll={() => setActiveFeedId('all')}
                    onShowInbox={() => setActiveFeedId('inbox')}
                    onShowDigest={() => setActiveFeedId('digest')}
                    onAddHkPack={handleAddHkPack}
                    onAddYoutube={handleAddYoutube}
                    packBusy={packBusy}
                    ytBusy={ytBusy}
                />

                <div className="flex-1 min-w-0">
                    {activeFeedId === 'digest' ? (
                        <DigestPanel
                            feeds={feeds}
                            onSaved={handleDigestSaved}
                            onToast={(msg) => { setSavedMsg(msg); setTimeout(() => setSavedMsg(null), 3000); }}
                        />
                    ) : activeFeedId === 'inbox' ? (
                        <EmailInboxView
                            emails={emails}
                            loading={emailsLoading}
                            onSubmit={handleSubmitEmail}
                            onDelete={handleDeleteEmail}
                            submitting={submitting}
                            gmail={gmail}
                            onGmailRefresh={handleGmailRefresh}
                        />
                    ) : selectedArticle !== null ? (
                        <ArticleReader
                            article={articles[selectedArticle]}
                            onClose={() => setSelectedArticle(null)}
                            onSaveAsMemo={handleSaveAsMemo}
                        />
                    ) : (
                        <div>
                            <div className="flex items-baseline justify-between mb-2 px-1">
                                <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                    {activeFeedId === 'all' ? 'All Articles' : (feeds.find(f => f.id === activeFeedId)?.title || 'Feed')}
                                </h3>
                                {!loading && <span className="text-[10px] text-gray-400 tabular-nums">{articles.length} items</span>}
                            </div>
                            {feedError && activeFeedId !== 'all' && (
                                <div className="mb-2 mx-1 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-2 py-1.5 rounded">
                                    {feedError}
                                </div>
                            )}
                            <ArticleList
                                articles={articles}
                                selectedIdx={null}
                                onSelect={idx => setSelectedArticle(idx)}
                                loading={loading}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
