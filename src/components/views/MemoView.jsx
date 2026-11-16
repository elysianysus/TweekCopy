import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { getMemos, searchMemos, createMemo, updateMemo, deleteMemo, uploadMemoFile, deleteMemoFile, aiOrganizeMemos, getMemoTitles, getMemoBacklinks, getMemoWhiteboardsMap, getMemoGraph, importVideoNote } from '../../scripts/api.js';
import { memoToMarkdown, parseFrontmatter, sanitizeFilename, downloadFile, downloadZip, readFileAsText } from '../../scripts/markdown.js';
import { MEMO_TEMPLATES, insertSnippetAtCaret } from '../../lib/memoTextTemplates.js';
import MemoKnowledgePanel from './MemoKnowledgePanel.jsx';
import { findMemoLink, insertMemoLink, filterMemoLinks } from '../../scripts/memoLinkAutocomplete.js';

// Tiny popover button used inside both NewMemoEditor and MemoEditor that
// drops a 思考ツール markdown scaffold (Mandala 9×9, Coordinate Axis,
// Concentric Chart, 4-Panel Memo) at the textarea caret.
function TemplateInsertButton({ textareaRef, value, setValue }) {
    const [open, setOpen] = useState(false);
    function pick(key) {
        const tpl = MEMO_TEMPLATES.find(t => t.key === key);
        if (!tpl) return;
        insertSnippetAtCaret(textareaRef, value || '', setValue, tpl.build());
        setOpen(false);
    }
    return (
        <div className="relative inline-block">
            <button type="button" onClick={() => setOpen(o => !o)}
                title="Insert thinking template"
                className={`text-[10px] px-2 py-0.5 rounded transition cursor-pointer flex items-center gap-1 ${open ? 'bg-purple-500 text-white' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200/60 dark:hover:bg-gray-600/60'}`}>
                <i className="fa-solid fa-shapes" />Template
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
                    <div className="absolute left-0 top-6 z-40 w-60 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-1">
                        <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 px-2 pt-1.5 pb-1 uppercase tracking-wide">
                            Insert thinking template
                        </div>
                        {MEMO_TEMPLATES.map(t => (
                            <button key={t.key} type="button" onClick={() => pick(t.key)}
                                className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-200 flex items-start gap-2">
                                <i className={`fa-solid ${t.icon} w-3 mt-0.5 text-center text-gray-500`} />
                                <span className="flex-1 min-w-0">
                                    <span className="block font-medium">{t.label}</span>
                                    <span className="block text-[10px] text-gray-500 dark:text-gray-400">{t.desc}</span>
                                </span>
                            </button>
                        ))}
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 px-2 pt-1 pb-1.5">
                            Inserts at cursor as plain markdown.
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

const COLORS = [
    { key: 'white', bg: 'bg-white dark:bg-gray-800', border: 'border-gray-200 dark:border-gray-700' },
    { key: 'yellow', bg: 'bg-yellow-50 dark:bg-yellow-900/30', border: 'border-yellow-200 dark:border-yellow-700' },
    { key: 'blue', bg: 'bg-blue-50 dark:bg-blue-900/30', border: 'border-blue-200 dark:border-blue-700' },
    { key: 'green', bg: 'bg-green-50 dark:bg-green-900/30', border: 'border-green-200 dark:border-green-700' },
    { key: 'pink', bg: 'bg-pink-50 dark:bg-pink-900/30', border: 'border-pink-200 dark:border-pink-700' },
    { key: 'purple', bg: 'bg-purple-50 dark:bg-purple-900/30', border: 'border-purple-200 dark:border-purple-700' },
];

const NOTE_TYPES = [
    { key: null, label: 'All', icon: 'fa-note-sticky' },
    { key: 'fleeting', label: 'Fleeting', icon: 'fa-bolt', color: 'text-yellow-500' },
    { key: 'permanent', label: 'Permanent', icon: 'fa-gem', color: 'text-blue-500' },
    { key: 'literature', label: 'Literature', icon: 'fa-book', color: 'text-green-500' },
    { key: 'project', label: 'Project', icon: 'fa-folder', color: 'text-purple-500' },
    { key: 'digest', label: 'Digest', icon: 'fa-newspaper', color: 'text-blue-400' },
    { key: 'video-note', label: 'Video', icon: 'fa-film', color: 'text-red-500' },
];

const VIDEO_URL_PATTERNS = [
    /^https?:\/\/(www\.|m\.|music\.)?youtube\.com\/(watch\?[^\s]*v=[\w-]{6,}|shorts\/[\w-]{6,}|live\/[\w-]{6,})/i,
    /^https?:\/\/youtu\.be\/[\w-]{6,}/i,
    /^https?:\/\/(www\.|m\.)?bilibili\.com\/video\/(BV[\w]+|av\d+)/i,
    /^https?:\/\/b23\.tv\/[\w-]+/i,
];

function isSupportedVideoUrl(url) {
    return VIDEO_URL_PATTERNS.some(re => re.test(url));
}

function VideoImportModal({ onClose, onCreated }) {
    const [url, setUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [elapsed, setElapsed] = useState(0);

    const trimmedUrl = url.trim();
    const looksValid = trimmedUrl === '' || isSupportedVideoUrl(trimmedUrl);

    useEffect(() => {
        if (!busy) { setElapsed(0); return; }
        const start = Date.now();
        const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
        return () => clearInterval(t);
    }, [busy]);

    const busyHint = !busy
        ? ''
        : elapsed < 8
            ? 'Fetching captions…'
            : elapsed < 25
                ? 'No captions found — transcribing audio with Whisper (~30s)…'
                : 'Still transcribing audio… long videos can take a minute.';

    async function handleSubmit(e) {
        e?.preventDefault?.();
        const trimmed = url.trim();
        if (!trimmed || busy) return;
        if (!isSupportedVideoUrl(trimmed)) {
            setError('Paste a YouTube (youtube.com / youtu.be) or Bilibili (bilibili.com / b23.tv) video link.');
            return;
        }
        setError('');
        setBusy(true);
        try {
            const r = await importVideoNote(trimmed);
            onCreated(r.memoId);
        } catch (err) {
            setError(err.message || 'Could not import this video.');
            setBusy(false);
        }
    }

    return (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
                <form onSubmit={handleSubmit} className="p-5">
                    <div className="flex items-center gap-2 mb-3">
                        <i className="fa-solid fa-film text-red-500" />
                        <h2 className="text-base font-semibold">Import from video</h2>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                        Paste a YouTube or Bilibili link. We'll fetch the captions and turn them into a memo with key points and timestamps.
                    </p>
                    <input
                        type="url"
                        autoFocus
                        value={url}
                        onChange={e => { setUrl(e.target.value); if (error) setError(''); }}
                        placeholder="https://www.youtube.com/watch?v=…  or  https://www.bilibili.com/video/BV…"
                        className={`w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800 text-sm focus:outline-none ${looksValid ? 'border-gray-200 dark:border-gray-700 focus:border-gray-400' : 'border-amber-400 dark:border-amber-600 focus:border-amber-500'}`}
                        disabled={busy}
                    />
                    {error && (
                        <div className="mt-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-200">
                            <i className="fa-solid fa-triangle-exclamation mr-1" />{error}
                        </div>
                    )}
                    {busy && busyHint && (
                        <div className="mt-3 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-xs text-blue-800 dark:text-blue-200 flex items-center gap-2">
                            <i className="fa-solid fa-spinner animate-spin" />
                            <span>{busyHint}</span>
                        </div>
                    )}
                    <div className="mt-4 flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={busy}
                            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={busy || !trimmedUrl || !looksValid}
                            className="px-3 py-1.5 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 flex items-center gap-2"
                        >
                            {busy && <i className="fa-solid fa-spinner animate-spin" />}
                            {busy ? 'Generating…' : 'Generate memo'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function getNoteTypeInfo(key) {
    return NOTE_TYPES.find(t => t.key === key) || NOTE_TYPES[0];
}

function getColorClasses(colorKey) {
    return COLORS.find(c => c.key === colorKey) || COLORS[0];
}

function isImageFile(mimeType) {
    return mimeType && mimeType.startsWith('image/');
}

function looksLikeHtml(text) {
    if (!text) return false;
    return /<[a-z][\s\S]*>/i.test(text);
}

function sanitizeHtml(html) {
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','hr','div','span','a','strong','b','em','i','u','s','del',
            'ul','ol','li','blockquote','pre','code','table','thead','tbody','tr','th','td',
            'img','figure','figcaption','sub','sup','mark','details','summary','abbr','small'],
        ALLOWED_ATTR: ['href','src','alt','title','class','style','target','rel','width','height','colspan','rowspan'],
        ALLOW_DATA_ATTR: false,
    });
}

function highlightHtml(html, query) {
    if (!query || !html) return sanitizeHtml(html);
    const sanitized = sanitizeHtml(html);
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const highlightRegex = new RegExp(`(${escaped})`, 'gi');
    let result = '';
    let i = 0;
    while (i < sanitized.length) {
        if (sanitized[i] === '<') {
            const end = sanitized.indexOf('>', i);
            if (end === -1) { result += sanitized.slice(i); break; }
            result += sanitized.slice(i, end + 1);
            i = end + 1;
        } else {
            const nextTag = sanitized.indexOf('<', i);
            const textChunk = nextTag === -1 ? sanitized.slice(i) : sanitized.slice(i, nextTag);
            result += textChunk.replace(highlightRegex, '<mark class="bg-yellow-200 dark:bg-yellow-700 rounded-sm px-0.5">$1</mark>');
            i = nextTag === -1 ? sanitized.length : nextTag;
        }
    }
    return result;
}

function HtmlContent({ html, className = '', highlight = '' }) {
    const processed = highlight ? highlightHtml(html, highlight) : sanitizeHtml(html);
    return (
        <div
            className={`memo-html-content ${className}`}
            dangerouslySetInnerHTML={{ __html: processed }}
        />
    );
}

function LinkAutocomplete({ textareaRef, value, onChange, allTitles }) {
    const [show, setShow] = useState(false);
    const [filter, setFilter] = useState('');
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const [selectedIdx, setSelectedIdx] = useState(0);
    const dropdownRef = useRef(null);

    const filtered = filterMemoLinks(allTitles, filter);
    const composing = useRef(false);

    function checkForTrigger(val, cursorPos) {
        const before = val.slice(0, cursorPos);
        const match = findMemoLink(val, cursorPos, textareaRef.current?.selectionEnd ?? cursorPos);
        if (match && !composing.current) {
            setFilter(match.query);
            setShow(true);
            setSelectedIdx(0);
            if (textareaRef.current) {
                const ta = textareaRef.current;
                const lineHeight = parseInt(getComputedStyle(ta).lineHeight) || 20;
                const lines = before.split('\n');
                const currentLine = lines.length;
                setPosition({
                    top: Math.max(0, Math.min(currentLine * lineHeight + 4 - ta.scrollTop, ta.offsetHeight)),
                    left: 8,
                });
            }
        } else {
            setShow(false);
        }
    }

    function handleInput(e) {
        const val = e.target.value;
        onChange(val);
        checkForTrigger(val, e.target.selectionStart);
    }

    function insertLink(title) {
        const ta = textareaRef.current;
        if (!ta) return;
        const result = insertMemoLink(ta.value, ta.selectionStart, title, ta.selectionEnd);
        if (!result) { setShow(false); return; }
        onChange(result.value);
        setShow(false);
        setTimeout(() => {
            ta.focus();
            ta.setSelectionRange(result.cursor, result.cursor);
        }, 0);
    }

    function handleKeyDown(e) {
        if (composing.current || e.nativeEvent?.isComposing || e.keyCode === 229) return;
        if (!show) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setShow(false);
            return;
        }
        if (filtered.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIdx(i => (i + 1) % filtered.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIdx(i => (i - 1 + filtered.length) % filtered.length);
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            insertLink(filtered[Math.min(selectedIdx, filtered.length - 1)].title);
        }
    }

    const inputProps = {
        onSelect: e => {
            if (document.activeElement === e.target) checkForTrigger(e.target.value, e.target.selectionStart);
        },
        onBlur: () => setShow(false),
        onCompositionStart: () => { composing.current = true; setShow(false); },
        onCompositionEnd: e => { composing.current = false; checkForTrigger(e.target.value, e.target.selectionStart); },
        'aria-label': 'Memo content',
        'aria-autocomplete': 'list',
    };
    return { handleInput, handleKeyDown, inputProps, dropdown: show ? (
        <div
            ref={dropdownRef}
            aria-label="Memo link suggestions"
            className="absolute z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto w-64 max-w-full"
            style={{ top: position.top, left: position.left }}
        >
            {!filtered.length && <p role="status" className="px-3 py-2 text-xs text-gray-500">No matching memos. You can still type a link manually.</p>}
            {filtered.map((item, idx) => (
                <button
                    key={item.id}
                    type="button"
                    aria-label={`Link to ${item.title}`}
                    className={`block w-full text-left px-3 py-2 text-xs truncate transition ${idx === selectedIdx ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                    onPointerDown={e => e.preventDefault()}
                    onClick={() => insertLink(item.title)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                >
                    <i className="fa-solid fa-link text-[9px] mr-1.5 text-gray-400" />{item.title}
                </button>
            ))}
        </div>
    ) : null };
}

function LinkedContent({ text, onLinkClick }) {
    if (!text) return null;
    const parts = text.split(/(\[\[[^\]]+\]\])/g);
    return <>{parts.map((part, i) => {
        const linkMatch = part.match(/^\[\[(.+)\]\]$/);
        if (linkMatch) {
            return (
                <button
                    key={i}
                    onClick={e => { e.stopPropagation(); onLinkClick(linkMatch[1]); }}
                    className="inline-flex items-center gap-0.5 text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline cursor-pointer font-medium"
                >
                    <i className="fa-solid fa-link text-[8px]" />{linkMatch[1]}
                </button>
            );
        }
        return <span key={i}>{part}</span>;
    })}</>;
}

export default function MemoView() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [memosList, setMemosList] = useState([]);
    const [selectedTag, setSelectedTag] = useState(null);
    const [editingMemo, setEditingMemo] = useState(null);
    const [showNewMemo, setShowNewMemo] = useState(false);
    const [draggingOver, setDraggingOver] = useState(false);
    const [aiOrganizing, setAiOrganizing] = useState(false);
    const [aiSuggestions, setAiSuggestions] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState(null);
    const [searching, setSearching] = useState(false);
    const [memoTitles, setMemoTitles] = useState([]);
    const [selectedNoteType, setSelectedNoteType] = useState(null);
    const [showSystemMemos, setShowSystemMemos] = useState(false);
    const [whiteboardsMap, setWhiteboardsMap] = useState({});
    const [showGraph, setShowGraph] = useState(false);
    const [showVideoImport, setShowVideoImport] = useState(false);
    const searchTimerRef = useRef(null);
    const searchSeqRef = useRef(0);
    const fileInputRef = useRef(null);
    const dragCounterRef = useRef(0);
    const openMemoHandled = useRef(false);

    useEffect(() => {
        fetchMemos();
        fetchMemoTitles();
        fetchWhiteboardsMap();
    }, []);

    useEffect(() => {
        const openMemoId = searchParams.get('openMemo');
        if (openMemoId && memosList.length > 0 && !openMemoHandled.current) {
            const target = memosList.find(m => m.id === parseInt(openMemoId));
            if (target) {
                setEditingMemo(target);
                openMemoHandled.current = true;
                setSearchParams(prev => { prev.delete('openMemo'); return prev; }, { replace: true });
            }
        }
    }, [searchParams, memosList]);

    async function fetchMemoTitles() {
        try { setMemoTitles(await getMemoTitles()); } catch (e) { console.error(e); }
    }

    async function fetchWhiteboardsMap() {
        try { setWhiteboardsMap(await getMemoWhiteboardsMap()); } catch (e) { console.error(e); }
    }

    useEffect(() => {
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        const q = searchQuery.trim();
        if (!q) {
            searchSeqRef.current++;
            setSearchResults(null);
            setSearching(false);
            return;
        }
        setSearching(true);
        const seq = ++searchSeqRef.current;
        searchTimerRef.current = setTimeout(async () => {
            try {
                const results = await searchMemos(q);
                if (seq === searchSeqRef.current) {
                    setSearchResults(results);
                    setSearching(false);
                }
            } catch (e) {
                if (seq === searchSeqRef.current) {
                    console.error(e);
                    setSearching(false);
                }
            }
        }, 300);
        return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
    }, [searchQuery]);

    async function fetchMemos() {
        try {
            const data = await getMemos();
            setMemosList(data);
            fetchMemoTitles();
            if (searchQuery.trim()) {
                const results = await searchMemos(searchQuery.trim());
                setSearchResults(results);
            }
        } catch (e) {
            console.error(e);
        }
    }

    const allTags = [...new Set(memosList.flatMap(m => m.tags || []))].sort();

    const displayMemos = searchResults !== null ? searchResults : memosList;
    const isSystemMemo = (m) => {
        const t = (m.title || '').trim();
        return t.startsWith('💓') || t.startsWith('🧾');
    };
    const systemMemoCount = displayMemos.filter(isSystemMemo).length;
    const filteredMemos = displayMemos.filter(m => {
        if (selectedTag && !(m.tags || []).includes(selectedTag)) return false;
        if (selectedNoteType && m.noteType !== selectedNoteType) return false;
        if (!showSystemMemos && isSystemMemo(m)) return false;
        return true;
    });

    async function handleCreateMemo(memoData) {
        try {
            await createMemo(memoData);
            setShowNewMemo(false);
            fetchMemos();
        } catch (e) {
            console.error(e);
        }
    }

    async function handleUpdateMemo(id, data) {
        try {
            await updateMemo(id, data);
            fetchMemos();
        } catch (e) {
            console.error(e);
        }
    }

    async function handleDeleteMemo(id) {
        try {
            await deleteMemo(id);
            setEditingMemo(null);
            fetchMemos();
        } catch (e) {
            console.error(e);
        }
    }

    async function handleUploadFile(memoId) {
        fileInputRef.current?.click();
        fileInputRef.current.onchange = async (ev) => {
            const file = ev.target.files[0];
            if (!file) return;
            try {
                await uploadMemoFile(memoId, file);
                fetchMemos();
            } catch (e) {
                console.error(e);
            }
            ev.target.value = '';
        };
    }

    async function handleDeleteFile(fileId) {
        try {
            await deleteMemoFile(fileId);
            fetchMemos();
        } catch (e) {
            console.error(e);
        }
    }

    function handleDragEnter(ev) {
        ev.preventDefault();
        dragCounterRef.current++;
        if (ev.dataTransfer?.types?.includes('Files')) setDraggingOver(true);
    }
    function handleDragLeave(ev) {
        ev.preventDefault();
        dragCounterRef.current--;
        if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setDraggingOver(false); }
    }
    function handleDragOver(ev) { ev.preventDefault(); }
    async function handleDrop(ev) {
        ev.preventDefault();
        dragCounterRef.current = 0;
        setDraggingOver(false);
        const files = [...(ev.dataTransfer.files || [])];
        if (!files.length) return;
        for (const file of files) {
            try {
                const created = await createMemo({ content: '', title: file.name.replace(/\.[^.]+$/, '') });
                await uploadMemoFile(created.id, file);
            } catch (e) { console.error(e); }
        }
        fetchMemos();
    }

    async function handleAiOrganize() {
        if (memosList.length === 0 || aiOrganizing) return;
        setAiOrganizing(true);
        try {
            const memosToOrganize = memosList.filter(m => m.title || m.content);
            if (memosToOrganize.length === 0) { setAiOrganizing(false); return; }
            const payload = memosToOrganize.map(m => ({
                id: m.id,
                title: m.title || '',
                content: m.content || '',
                tags: m.tags || [],
            }));
            const result = await aiOrganizeMemos(payload);
            if (result.suggestions && result.suggestions.length > 0) {
                const suggMap = {};
                for (const s of result.suggestions) {
                    const sid = Number(s.id);
                    if (isNaN(sid)) continue;
                    const memo = memosList.find(m => m.id === sid);
                    if (!memo) continue;
                    const existingTags = memo.tags || [];
                    const newTags = (s.tags || []).filter(t => typeof t === 'string' && t.trim() && !existingTags.includes(t.trim().toLowerCase())).map(t => t.trim().toLowerCase());
                    if (newTags.length > 0) {
                        suggMap[sid] = { newTags, existingTags, title: memo.title || memo.content?.slice(0, 40) || '(untitled)' };
                    }
                }
                if (Object.keys(suggMap).length > 0) {
                    setAiSuggestions(suggMap);
                } else {
                    setAiSuggestions('none');
                }
            } else {
                setAiSuggestions('none');
            }
        } catch (e) {
            console.error('AI organize error:', e);
        }
        setAiOrganizing(false);
    }

    async function applyAiSuggestions(suggMap) {
        for (const [memoId, sugg] of Object.entries(suggMap)) {
            const memo = memosList.find(m => m.id === parseInt(memoId));
            if (!memo) continue;
            const mergedTags = [...new Set([...(memo.tags || []), ...sugg.newTags])];
            await updateMemo(parseInt(memoId), {
                title: memo.title,
                content: memo.content,
                color: memo.color,
                tags: mergedTags,
            });
        }
        setAiSuggestions(null);
        fetchMemos();
    }

    function removeSuggestionTag(memoId, tag) {
        setAiSuggestions(prev => {
            if (!prev || typeof prev === 'string') return prev;
            const updated = { ...prev };
            const entry = updated[memoId];
            if (entry) {
                entry.newTags = entry.newTags.filter(t => t !== tag);
                if (entry.newTags.length === 0) delete updated[memoId];
            }
            return Object.keys(updated).length === 0 ? 'none' : updated;
        });
    }

    function removeSuggestionMemo(memoId) {
        setAiSuggestions(prev => {
            if (!prev || typeof prev === 'string') return prev;
            const updated = { ...prev };
            delete updated[memoId];
            return Object.keys(updated).length === 0 ? 'none' : updated;
        });
    }

    function handleLinkClickById(id) {
        const target = memosList.find(m => m.id === id);
        if (target) setEditingMemo(target);
    }

    async function handleLinkClick(title) {
        const target = memosList.find(m => m.title === title);
        if (target) {
            setEditingMemo(target);
        } else {
            try {
                const created = await createMemo({ title, content: '' });
                const freshData = await getMemos();
                setMemosList(freshData);
                fetchMemoTitles();
                const newMemo = freshData.find(m => m.id === created.id);
                if (newMemo) setEditingMemo(newMemo);
            } catch (e) { console.error(e); }
        }
    }

    const importInputRef = useRef(null);
    const [importing, setImporting] = useState(false);
    const [exporting, setExporting] = useState(false);

    async function handleExportMemo(memo) {
        const md = memoToMarkdown(memo);
        const filename = sanitizeFilename(memo.title || 'untitled') + '.md';
        await downloadFile(md, filename);
    }

    async function handleExportAll() {
        if (memosList.length === 0 || exporting) return;
        setExporting(true);
        try {
            const usedNames = {};
            const files = memosList.map(memo => {
                let base = sanitizeFilename(memo.title || 'untitled');
                if (usedNames[base]) {
                    usedNames[base]++;
                    base = `${base}_${usedNames[base]}`;
                } else {
                    usedNames[base] = 1;
                }
                return { name: `${base}.md`, content: memoToMarkdown(memo) };
            });
            await downloadZip(files);
        } catch (e) {
            console.error('Export error:', e);
        }
        setExporting(false);
    }

    async function handleImportFiles(ev) {
        const files = [...(ev.target.files || [])];
        if (!files.length) return;
        setImporting(true);
        try {
            for (const file of files) {
                const text = await readFileAsText(file);
                const { meta, content } = parseFrontmatter(text);
                const memoData = {
                    title: meta.title || file.name.replace(/\.(md|txt)$/i, ''),
                    content: content.trim(),
                    color: meta.color || 'white',
                    tags: Array.isArray(meta.tags) ? meta.tags : [],
                    date: meta.date || null,
                };
                await createMemo(memoData);
            }
            fetchMemos();
        } catch (e) {
            console.error('Import error:', e);
        }
        setImporting(false);
        ev.target.value = '';
    }

    async function handlePasteFromClipboard() {
        try {
            let text = '';
            let imageFile = null;
            if (navigator.clipboard.read) {
                try {
                    const clipItems = await navigator.clipboard.read();
                    for (const item of clipItems) {
                        if (item.types.includes('text/plain')) {
                            const blob = await item.getType('text/plain');
                            text = await blob.text();
                        }
                        for (const type of item.types) {
                            if (type.startsWith('image/')) {
                                const blob = await item.getType(type);
                                const ext = type.split('/')[1] || 'png';
                                imageFile = new File([blob], `clipboard.${ext}`, { type });
                                break;
                            }
                        }
                    }
                } catch {
                    text = await navigator.clipboard.readText();
                }
            } else {
                text = await navigator.clipboard.readText();
            }
            if (!text && !imageFile) return;
            const memo = await createMemo({
                content: text || '',
                title: text ? text.slice(0, 60) : 'Pasted image',
            });
            if (imageFile && memo?.id) {
                await uploadMemoFile(memo.id, imageFile);
            }
            fetchMemos();
        } catch (e) {
            console.error('Clipboard paste error:', e);
        }
    }

    return (
        <div className="padding-x py-4 max-lg:mt-12 dark:bg-black dark:text-white min-h-screen relative"
             onDragEnter={handleDragEnter} onDragLeave={handleDragLeave}
             onDragOver={handleDragOver} onDrop={handleDrop}>
            {draggingOver && (
                <div className="absolute inset-0 bg-blue-50/80 dark:bg-blue-900/40 border-2 border-dashed border-blue-400 dark:border-blue-500 rounded-xl z-50 flex items-center justify-center pointer-events-none">
                    <div className="text-blue-500 dark:text-blue-300 flex flex-col items-center gap-2">
                        <i className="fa-solid fa-cloud-arrow-up text-4xl" />
                        <span className="text-sm font-medium">Drop files to create memo</span>
                    </div>
                </div>
            )}
            <input ref={fileInputRef} type="file" className="hidden" />
            <input ref={importInputRef} type="file" className="hidden" accept=".md,.txt" multiple onChange={handleImportFiles} />

            <div className="flex gap-2 mb-4 overflow-x-auto pb-1 lg:hidden items-center">
                <button
                    onClick={() => importInputRef.current?.click()}
                    disabled={importing}
                    className="whitespace-nowrap text-xs px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-400 dark:hover:border-gray-500 transition disabled:opacity-50 flex items-center gap-1"
                >
                    <i className={`fa-solid ${importing ? 'fa-spinner animate-spin' : 'fa-file-import'} text-[10px]`} />
                    {importing ? 'Importing...' : 'Import'}
                </button>
                <button
                    onClick={() => setShowVideoImport(true)}
                    className="whitespace-nowrap text-xs px-3 py-1.5 rounded-full border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition flex items-center gap-1"
                >
                    <i className="fa-solid fa-film text-[10px]" />
                    Video
                </button>
                {memosList.length > 0 && (
                    <button
                        onClick={handleExportAll}
                        disabled={exporting}
                        className="whitespace-nowrap text-xs px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-400 dark:hover:border-gray-500 transition disabled:opacity-50 flex items-center gap-1"
                    >
                        <i className={`fa-solid ${exporting ? 'fa-spinner animate-spin' : 'fa-file-export'} text-[10px]`} />
                        {exporting ? 'Exporting...' : 'Export All'}
                    </button>
                )}
                {memosList.length > 0 && (
                    <button
                        onClick={handleAiOrganize}
                        disabled={aiOrganizing}
                        className="whitespace-nowrap text-xs px-3 py-1.5 rounded-full border border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/30 transition disabled:opacity-50 flex items-center gap-1"
                    >
                        <i className={`fa-solid ${aiOrganizing ? 'fa-spinner animate-spin' : 'fa-wand-magic-sparkles'} text-[10px]`} />
                        {aiOrganizing ? 'Organizing...' : 'AI Tag'}
                    </button>
                )}
                {allTags.length > 0 && (
                    <>
                        <button
                            onClick={() => setSelectedTag(null)}
                            className={`whitespace-nowrap text-xs px-3 py-1.5 rounded-full border transition ${!selectedTag ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white' : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-400'}`}
                        >
                            All ({memosList.length})
                        </button>
                        {allTags.map(tag => {
                            const count = memosList.filter(m => (m.tags || []).includes(tag)).length;
                            return (
                                <button
                                    key={tag}
                                    onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                                    className={`whitespace-nowrap text-xs px-3 py-1.5 rounded-full border transition ${selectedTag === tag ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white' : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-400'}`}
                                >
                                    {tag} ({count})
                                </button>
                            );
                        })}
                    </>
                )}
            </div>

            <div className="max-w-7xl mx-auto">
                <MemoKnowledgePanel onOpenMemo={source => handleLinkClickById(source.id)} />
            </div>
            <div className="flex gap-6 max-w-7xl mx-auto">
                <div className="w-48 flex-shrink-0 hidden lg:block">
                    <div className="sticky top-20">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Tags</h3>
                            {memosList.length > 0 && (
                                <button
                                    onClick={handleAiOrganize}
                                    disabled={aiOrganizing}
                                    className="text-[10px] px-2 py-1 rounded-md border border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/30 transition disabled:opacity-50 flex items-center gap-1"
                                >
                                    <i className={`fa-solid ${aiOrganizing ? 'fa-spinner animate-spin' : 'fa-wand-magic-sparkles'}`} />
                                    {aiOrganizing ? '...' : 'AI Tag'}
                                </button>
                            )}
                        </div>
                        <button
                            onClick={() => setSelectedTag(null)}
                            className={`block w-full text-left text-sm px-3 py-1.5 rounded-lg mb-1 transition ${!selectedTag ? 'bg-gray-100 dark:bg-gray-800 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-900 text-gray-500'}`}
                        >
                            All Notes ({memosList.length})
                        </button>
                        {allTags.map(tag => {
                            const count = memosList.filter(m => (m.tags || []).includes(tag)).length;
                            return (
                                <button
                                    key={tag}
                                    onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                                    className={`block w-full text-left text-sm px-3 py-1.5 rounded-lg mb-1 transition ${selectedTag === tag ? 'bg-gray-100 dark:bg-gray-800 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-900 text-gray-500'}`}
                                >
                                    <i className="fa-solid fa-tag text-[10px] mr-2 text-gray-400" />
                                    {tag} ({count})
                                </button>
                            );
                        })}

                        <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Note Type</h3>
                            {NOTE_TYPES.map(nt => {
                                const count = nt.key ? memosList.filter(m => m.noteType === nt.key).length : memosList.length;
                                return (
                                    <button
                                        key={nt.key || 'all'}
                                        onClick={() => setSelectedNoteType(nt.key === selectedNoteType ? null : nt.key)}
                                        className={`block w-full text-left text-sm px-3 py-1.5 rounded-lg mb-1 transition ${selectedNoteType === nt.key ? 'bg-gray-100 dark:bg-gray-800 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-900 text-gray-500'}`}
                                    >
                                        <i className={`fa-solid ${nt.icon} text-[10px] mr-2 ${nt.color || 'text-gray-400'}`} />
                                        {nt.label} {nt.key ? `(${count})` : ''}
                                    </button>
                                );
                            })}
                        </div>

                        {systemMemoCount > 0 && (
                            <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                                <button
                                    onClick={() => setShowSystemMemos(v => !v)}
                                    className={`block w-full text-left text-sm px-3 py-1.5 rounded-lg mb-1 transition ${showSystemMemos ? 'bg-gray-100 dark:bg-gray-800 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-900 text-gray-500'}`}
                                    title="LINE Bot 自動建立嘅血壓 / 收據 memo"
                                >
                                    <i className={`fa-solid ${showSystemMemos ? 'fa-eye' : 'fa-eye-slash'} text-[10px] mr-2 text-gray-400`} />
                                    {showSystemMemos ? '隱藏' : '顯示'}血壓/收據 ({systemMemoCount})
                                </button>
                            </div>
                        )}

                        <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                            <button
                                onClick={() => setShowGraph(!showGraph)}
                                className={`block w-full text-left text-sm px-3 py-1.5 rounded-lg mb-1 transition ${showGraph ? 'bg-gray-100 dark:bg-gray-800 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-900 text-gray-500'}`}
                            >
                                <i className="fa-solid fa-diagram-project text-[10px] mr-2 text-gray-400" />
                                Knowledge Graph
                            </button>
                        </div>

                        <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-1.5">
                            <button
                                onClick={() => setShowVideoImport(true)}
                                className="block w-full text-left text-sm px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-900 transition"
                            >
                                <i className="fa-solid fa-film text-[10px] mr-2 text-red-400" />
                                Import from video
                            </button>
                            <button
                                onClick={() => importInputRef.current?.click()}
                                disabled={importing}
                                className="block w-full text-left text-sm px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-900 transition disabled:opacity-50"
                            >
                                <i className={`fa-solid ${importing ? 'fa-spinner animate-spin' : 'fa-file-import'} text-[10px] mr-2 text-gray-400`} />
                                {importing ? 'Importing...' : 'Import .md'}
                            </button>
                            {memosList.length > 0 && (
                                <button
                                    onClick={handleExportAll}
                                    disabled={exporting}
                                    className="block w-full text-left text-sm px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-900 transition disabled:opacity-50"
                                >
                                    <i className={`fa-solid ${exporting ? 'fa-spinner animate-spin' : 'fa-file-export'} text-[10px] mr-2 text-gray-400`} />
                                    {exporting ? 'Exporting...' : 'Export All'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex-1 min-w-0">
                    {showGraph ? (
                        <MemoGraphView onSelectMemo={(memo) => setEditingMemo(memo)} memosList={memosList} />
                    ) : (
                    <>
                    <div className="mb-3 relative">
                        <div className="relative">
                            <i className={`fa-solid ${searching ? 'fa-spinner animate-spin' : 'fa-magnifying-glass'} absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm`} />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search notes..."
                                className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 transition placeholder-gray-400"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                >
                                    <i className="fa-solid fa-xmark text-sm" />
                                </button>
                            )}
                        </div>
                        {searchResults !== null && (
                            <p className="text-xs text-gray-400 mt-1.5 ml-1">
                                {searchResults.length} {searchResults.length === 1 ? 'result' : 'results'} for "{searchQuery}"
                            </p>
                        )}
                    </div>

                    <div className="mb-4">
                        <div className="flex gap-2">
                        {!showNewMemo ? (
                            <button
                                onClick={() => setShowNewMemo(true)}
                                className="flex-1 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-left text-gray-400 hover:border-gray-400 dark:hover:border-gray-500 transition cursor-pointer"
                            >
                                Take a memo...
                            </button>
                        ) : (
                            <NewMemoEditor
                                onDone={() => { setShowNewMemo(false); fetchMemos(); }}
                                onCancel={() => setShowNewMemo(false)}
                                memoTitles={memoTitles}
                            />
                        )}
                        <button
                            onClick={() => setShowVideoImport(true)}
                            className="shrink-0 px-4 py-3 rounded-xl border border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 hover:border-red-400 dark:hover:border-red-600 hover:bg-red-50/50 dark:hover:bg-red-900/20 transition cursor-pointer flex items-center gap-2"
                            title="Import from a YouTube or Bilibili video"
                        >
                            <i className="fa-solid fa-film" />
                        </button>
                        <button
                            onClick={handlePasteFromClipboard}
                            className="shrink-0 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-400 hover:border-gray-400 dark:hover:border-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition cursor-pointer flex items-center gap-2"
                            title="Paste from clipboard"
                        >
                            <i className="fa-solid fa-clipboard" />
                            <span className="text-sm max-sm:hidden">Paste</span>
                        </button>
                        </div>
                    </div>

                    <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4">
                        {filteredMemos.map(memo => (
                            <MemoCard
                                key={memo.id}
                                memo={memo}
                                onClick={() => setEditingMemo(memo)}
                                highlight={searchQuery.trim()}
                                onLinkClick={handleLinkClick}
                                onExport={() => handleExportMemo(memo)}
                                whiteboardNames={whiteboardsMap[memo.id] || []}
                            />
                        ))}
                    </div>

                    {filteredMemos.length === 0 && !showNewMemo && (
                        <div className="text-center py-20 text-gray-400">
                            <i className={`fa-regular ${searchQuery.trim() ? 'fa-face-meh' : 'fa-note-sticky'} text-4xl mb-3`} />
                            <p className="text-sm">{searchQuery.trim() ? 'No matching notes found.' : 'No notes yet. Click above to create one.'}</p>
                        </div>
                    )}
                    </>
                    )}
                </div>
            </div>

            {editingMemo && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center lg:p-4"
                     onClick={() => setEditingMemo(null)}>
                    <div className="w-full lg:max-w-lg max-h-[90vh] overflow-y-auto max-lg:rounded-t-2xl lg:rounded-xl" onClick={e => e.stopPropagation()}>
                        <MemoEditor
                            key={editingMemo.id}
                            initialData={editingMemo}
                            onSave={async (data) => {
                                await handleUpdateMemo(editingMemo.id, data);
                                setEditingMemo(null);
                            }}
                            onCancel={() => setEditingMemo(null)}
                            onDelete={() => handleDeleteMemo(editingMemo.id)}
                            onUploadFile={() => handleUploadFile(editingMemo.id)}
                            onDeleteFile={handleDeleteFile}
                            memoTitles={memoTitles}
                            onLinkClick={(title) => {
                                setEditingMemo(null);
                                setTimeout(() => handleLinkClick(title), 100);
                            }}
                            onBacklinkClick={(id) => {
                                setEditingMemo(null);
                                setTimeout(() => handleLinkClickById(id), 100);
                            }}
                            onExport={() => handleExportMemo(editingMemo)}
                            whiteboardNames={whiteboardsMap[editingMemo.id] || []}
                        />
                    </div>
                </div>
            )}

            {aiSuggestions && aiSuggestions !== 'none' && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center lg:p-4"
                     onClick={() => setAiSuggestions(null)}>
                    <div className="w-full lg:max-w-lg max-h-[85vh] overflow-y-auto max-lg:rounded-t-2xl lg:rounded-xl bg-white dark:bg-gray-900 p-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <i className="fa-solid fa-wand-magic-sparkles text-purple-500" />
                                <h3 className="font-medium text-sm">AI Tag Suggestions</h3>
                            </div>
                            <button onClick={() => setAiSuggestions(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                                <i className="fa-solid fa-xmark" />
                            </button>
                        </div>
                        <p className="text-xs text-gray-400 mb-4">Review the suggested tags below. Remove any you don't want, then apply.</p>
                        <div className="space-y-3 mb-4">
                            {Object.entries(aiSuggestions).map(([memoId, sugg]) => (
                                <div key={memoId} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <span className="text-xs font-medium truncate flex-1">{sugg.title}</span>
                                        <button onClick={() => removeSuggestionMemo(memoId)} className="text-gray-400 hover:text-red-400 flex-shrink-0">
                                            <i className="fa-solid fa-xmark text-[10px]" />
                                        </button>
                                    </div>
                                    {sugg.existingTags.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mb-1.5">
                                            {sugg.existingTags.map(tag => (
                                                <span key={tag} className="text-[10px] bg-gray-200 dark:bg-gray-700 rounded-full px-2 py-0.5 text-gray-500">
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    <div className="flex flex-wrap gap-1">
                                        {sugg.newTags.map(tag => (
                                            <span key={tag} className="text-[10px] bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-full px-2 py-0.5 flex items-center gap-1 border border-purple-200 dark:border-purple-700">
                                                + {tag}
                                                <button onClick={() => removeSuggestionTag(memoId, tag)} className="hover:text-red-400">
                                                    <i className="fa-solid fa-xmark text-[8px]" />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setAiSuggestions(null)} className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1.5 cursor-pointer">
                                Cancel
                            </button>
                            <button
                                onClick={() => applyAiSuggestions(aiSuggestions)}
                                className="text-xs bg-purple-600 text-white px-4 py-1.5 rounded-lg font-medium hover:bg-purple-700 transition cursor-pointer"
                            >
                                Apply All
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {aiSuggestions === 'none' && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
                     onClick={() => setAiSuggestions(null)}>
                    <div className="bg-white dark:bg-gray-900 rounded-xl p-6 max-w-sm text-center" onClick={e => e.stopPropagation()}>
                        <i className="fa-solid fa-check-circle text-green-500 text-2xl mb-2" />
                        <p className="text-sm font-medium mb-1">All organized!</p>
                        <p className="text-xs text-gray-400 mb-4">Your memos already have appropriate tags.</p>
                        <button onClick={() => setAiSuggestions(null)} className="text-xs bg-black dark:bg-white text-white dark:text-black px-4 py-1.5 rounded-lg font-medium hover:opacity-80 transition cursor-pointer">
                            OK
                        </button>
                    </div>
                </div>
            )}
            {showVideoImport && (
                <VideoImportModal
                    onClose={() => setShowVideoImport(false)}
                    onCreated={async (memoId) => {
                        setShowVideoImport(false);
                        const fresh = await getMemos();
                        setMemosList(fresh);
                        fetchMemoTitles();
                        openMemoHandled.current = false;
                        setSearchParams(prev => {
                            prev.set('view', 'memo');
                            prev.set('openMemo', String(memoId));
                            return prev;
                        }, { replace: true });
                    }}
                />
            )}
        </div>
    );
}

function HighlightText({ text, query }) {
    if (!query || !text) return <>{text}</>;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return <>{parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
            ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-700 text-inherit rounded-sm px-0.5">{part}</mark>
            : part
    )}</>;
}

function MemoCard({ memo, onClick, highlight, onLinkClick, onExport, whiteboardNames = [] }) {
    const colorCls = getColorClasses(memo.color);
    const images = (memo.files || []).filter(f => isImageFile(f.mimeType));
    const otherFiles = (memo.files || []).filter(f => !isImageFile(f.mimeType));
    const hasLinks = memo.content && /\[\[.+?\]\]/.test(memo.content);
    const typeInfo = memo.noteType ? getNoteTypeInfo(memo.noteType) : null;

    return (
        <div
            onClick={onClick}
            className={`break-inside-avoid mb-4 border rounded-xl p-4 cursor-pointer hover:shadow-md transition group relative ${colorCls.bg} ${colorCls.border}`}
        >
            {onExport && (
                <button
                    onClick={e => { e.stopPropagation(); onExport(); }}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                    title="Export as Markdown"
                >
                    <i className="fa-solid fa-file-arrow-down text-xs" />
                </button>
            )}
            {typeInfo && (
                <div className="mb-1.5">
                    <span className={`text-[10px] font-medium ${typeInfo.color}`}>
                        <i className={`fa-solid ${typeInfo.icon} mr-1`} />{typeInfo.label}
                    </span>
                </div>
            )}
            {images.length > 0 && (
                <div className="mb-2 -mx-4 -mt-4">
                    {images.map((img, idx) => (
                        <img
                            key={img.id}
                            src={img.url}
                            alt={img.originalName}
                            className={`w-full object-contain ${idx === 0 ? 'rounded-t-xl' : ''}`}
                        />
                    ))}
                </div>
            )}
            {memo.title && (
                <h4 className="font-medium text-sm mb-1">
                    <HighlightText text={memo.title} query={highlight} />
                </h4>
            )}
            {memo.content && (
                looksLikeHtml(memo.content) ? (
                    <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-6 overflow-hidden">
                        <HtmlContent html={memo.content} className="text-xs" highlight={highlight} />
                    </div>
                ) : hasLinks ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap line-clamp-6">
                        <LinkedContent text={memo.content} onLinkClick={onLinkClick} />
                    </p>
                ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap line-clamp-6">
                        <HighlightText text={memo.content} query={highlight} />
                    </p>
                )
            )}
            {otherFiles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                    {otherFiles.map(f => (
                        <span key={f.id} className="text-[10px] bg-gray-100 dark:bg-gray-700 rounded px-1.5 py-0.5 text-gray-500">
                            <i className="fa-solid fa-paperclip mr-1" />{f.originalName}
                        </span>
                    ))}
                </div>
            )}
            {(memo.tags || []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                    {memo.tags.map(tag => (
                        <span key={tag} className="text-[10px] bg-gray-200 dark:bg-gray-700 rounded-full px-2 py-0.5 text-gray-500">
                            {tag}
                        </span>
                    ))}
                </div>
            )}
            {whiteboardNames.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                    {whiteboardNames.map(name => (
                        <span key={name} className="text-[10px] bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 dark:text-indigo-400 rounded-full px-2 py-0.5">
                            <i className="fa-solid fa-chalkboard text-[8px] mr-1" />{name}
                        </span>
                    ))}
                </div>
            )}
            {memo.date && (
                <p className="text-[10px] text-gray-400 mt-2">{memo.date}</p>
            )}
        </div>
    );
}

function MemoGraphView({ onSelectMemo, memosList }) {
    const canvasRef = useRef(null);
    const [graphData, setGraphData] = useState(null);
    const [hoveredNode, setHoveredNode] = useState(null);
    const nodesRef = useRef([]);
    const edgesRef = useRef([]);
    const animFrameRef = useRef(null);
    const dragRef = useRef(null);
    const panRef = useRef({ x: 0, y: 0, dragging: false, startX: 0, startY: 0 });
    const zoomRef = useRef(1);

    useEffect(() => {
        getMemoGraph().then(data => {
            setGraphData(data);
            const dpr = window.devicePixelRatio || 1;
            const w = (canvasRef.current?.width || 800) / dpr;
            const h = (canvasRef.current?.height || 600) / dpr;
            const cx = w / 2, cy = h / 2;
            nodesRef.current = data.nodes.map((n, i) => {
                const angle = (2 * Math.PI * i) / data.nodes.length;
                const r = Math.min(w, h) * 0.3;
                return { ...n, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), vx: 0, vy: 0 };
            });
            edgesRef.current = data.edges;
            startSimulation();
        }).catch(console.error);
        return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
    }, []);

    function startSimulation() {
        let iterations = 0;
        function tick() {
            const nodes = nodesRef.current;
            const edges = edgesRef.current;
            if (!nodes.length) return;
            const idMap = {};
            nodes.forEach((n, i) => { idMap[n.id] = i; });
            const repulsion = 2000;
            const attraction = 0.005;
            const damping = 0.85;
            const centerGravity = 0.01;
            const dpr = window.devicePixelRatio || 1;
            const cx = ((canvasRef.current?.width || 800) / dpr) / 2;
            const cy = ((canvasRef.current?.height || 600) / dpr) / 2;

            for (let i = 0; i < nodes.length; i++) {
                let fx = 0, fy = 0;
                for (let j = 0; j < nodes.length; j++) {
                    if (i === j) continue;
                    const dx = nodes[i].x - nodes[j].x;
                    const dy = nodes[i].y - nodes[j].y;
                    const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
                    const force = repulsion / (dist * dist);
                    fx += (dx / dist) * force;
                    fy += (dy / dist) * force;
                }
                fx += (cx - nodes[i].x) * centerGravity;
                fy += (cy - nodes[i].y) * centerGravity;
                nodes[i].vx = (nodes[i].vx + fx) * damping;
                nodes[i].vy = (nodes[i].vy + fy) * damping;
            }

            for (const edge of edges) {
                const si = idMap[edge.source];
                const ti = idMap[edge.target];
                if (si === undefined || ti === undefined) continue;
                const dx = nodes[ti].x - nodes[si].x;
                const dy = nodes[ti].y - nodes[si].y;
                const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
                const force = (dist - 120) * attraction;
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;
                nodes[si].vx += fx; nodes[si].vy += fy;
                nodes[ti].vx -= fx; nodes[ti].vy -= fy;
            }

            for (const n of nodes) {
                if (dragRef.current && dragRef.current.id === n.id) continue;
                n.x += n.vx;
                n.y += n.vy;
            }

            drawGraph();
            iterations++;
            if (iterations < 300) animFrameRef.current = requestAnimationFrame(tick);
        }
        tick();
    }

    function drawGraph() {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width / dpr, h = canvas.height / dpr;
        const dark = document.documentElement.classList.contains('dark');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.translate(panRef.current.x, panRef.current.y);
        ctx.scale(zoomRef.current, zoomRef.current);

        const nodes = nodesRef.current;
        const edges = edgesRef.current;
        const idMap = {};
        nodes.forEach((n, i) => { idMap[n.id] = i; });

        const typeColors = {
            fleeting: '#eab308',
            permanent: '#3b82f6',
            literature: '#22c55e',
            project: '#a855f7',
        };

        ctx.strokeStyle = dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)';
        ctx.lineWidth = 1;
        for (const edge of edges) {
            const si = idMap[edge.source], ti = idMap[edge.target];
            if (si === undefined || ti === undefined) continue;
            ctx.beginPath();
            ctx.moveTo(nodes[si].x, nodes[si].y);
            ctx.lineTo(nodes[ti].x, nodes[ti].y);
            ctx.stroke();
        }

        for (const n of nodes) {
            const connections = edges.filter(e => e.source === n.id || e.target === n.id).length;
            const r = Math.max(6, Math.min(20, 6 + connections * 3));
            const fillColor = typeColors[n.noteType] || (dark ? '#6b7280' : '#9ca3af');
            ctx.beginPath();
            ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
            ctx.fillStyle = hoveredNode === n.id ? (dark ? '#ffffff' : '#000000') : fillColor;
            ctx.fill();
            if (hoveredNode === n.id) {
                ctx.strokeStyle = fillColor;
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            ctx.fillStyle = dark ? '#e5e7eb' : '#374151';
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(n.title.length > 20 ? n.title.slice(0, 20) + '...' : n.title, n.x, n.y + r + 14);
        }

        ctx.restore();
    }

    useEffect(() => { drawGraph(); }, [hoveredNode]);

    function getMousePos(e) {
        const rect = canvasRef.current.getBoundingClientRect();
        const cssX = e.clientX - rect.left;
        const cssY = e.clientY - rect.top;
        const x = (cssX - panRef.current.x) / zoomRef.current;
        const y = (cssY - panRef.current.y) / zoomRef.current;
        return { x, y };
    }

    function findNodeAt(pos) {
        const nodes = nodesRef.current;
        const edges = edgesRef.current;
        for (const n of nodes) {
            const connections = edges.filter(e => e.source === n.id || e.target === n.id).length;
            const r = Math.max(6, Math.min(20, 6 + connections * 3));
            const dx = pos.x - n.x, dy = pos.y - n.y;
            if (dx * dx + dy * dy < (r + 4) * (r + 4)) return n;
        }
        return null;
    }

    function handleMouseDown(e) {
        const pos = getMousePos(e);
        const node = findNodeAt(pos);
        if (node) {
            dragRef.current = { id: node.id, offsetX: pos.x - node.x, offsetY: pos.y - node.y };
        } else {
            panRef.current.dragging = true;
            panRef.current.startX = e.clientX - panRef.current.x;
            panRef.current.startY = e.clientY - panRef.current.y;
        }
    }

    function handleMouseMove(e) {
        const pos = getMousePos(e);
        if (dragRef.current) {
            const node = nodesRef.current.find(n => n.id === dragRef.current.id);
            if (node) {
                node.x = pos.x - dragRef.current.offsetX;
                node.y = pos.y - dragRef.current.offsetY;
                node.vx = 0; node.vy = 0;
                drawGraph();
            }
        } else if (panRef.current.dragging) {
            panRef.current.x = e.clientX - panRef.current.startX;
            panRef.current.y = e.clientY - panRef.current.startY;
            drawGraph();
        } else {
            const node = findNodeAt(pos);
            setHoveredNode(node ? node.id : null);
        }
    }

    function handleMouseUp() {
        if (dragRef.current) dragRef.current = null;
        panRef.current.dragging = false;
    }

    function handleClick(e) {
        if (dragRef.current) return;
        const pos = getMousePos(e);
        const node = findNodeAt(pos);
        if (node) {
            const memo = memosList.find(m => m.id === node.id);
            if (memo) onSelectMemo(memo);
        }
    }

    function handleWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        zoomRef.current = Math.max(0.2, Math.min(3, zoomRef.current * delta));
        drawGraph();
    }

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const parent = canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        function sizeCanvas() {
            const cw = parent.clientWidth;
            const ch = Math.max(500, window.innerHeight - 200);
            canvas.width = cw * dpr;
            canvas.height = ch * dpr;
            canvas.style.width = cw + 'px';
            canvas.style.height = ch + 'px';
        }
        sizeCanvas();
        const handleResize = () => {
            sizeCanvas();
            drawGraph();
        };
        window.addEventListener('resize', handleResize);
        canvas.addEventListener('wheel', handleWheel, { passive: false });
        return () => {
            window.removeEventListener('resize', handleResize);
            canvas.removeEventListener('wheel', handleWheel);
        };
    }, []);

    return (
        <div className="relative">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium flex items-center gap-2">
                    <i className="fa-solid fa-diagram-project text-gray-400" />
                    Knowledge Graph
                    {graphData && <span className="text-xs text-gray-400 font-normal">({graphData.nodes.length} {graphData.nodes.length === 1 ? 'note' : 'notes'}, {graphData.edges.length} {graphData.edges.length === 1 ? 'link' : 'links'})</span>}
                </h3>
                <div className="flex gap-2 items-center text-[10px] text-gray-400">
                    {NOTE_TYPES.filter(nt => nt.key).map(nt => (
                        <span key={nt.key} className="flex items-center gap-1">
                            <span className={`w-2.5 h-2.5 rounded-full inline-block`} style={{ backgroundColor: { fleeting: '#eab308', permanent: '#3b82f6', literature: '#22c55e', project: '#a855f7' }[nt.key] }} />
                            {nt.label}
                        </span>
                    ))}
                    <span className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-full inline-block bg-gray-400" />
                        Untyped
                    </span>
                </div>
            </div>
            {!graphData ? (
                <div className="flex items-center justify-center py-20 text-gray-400">
                    <i className="fa-solid fa-spinner animate-spin mr-2" />Loading graph...
                </div>
            ) : graphData.nodes.length === 0 ? (
                <div className="text-center py-20 text-gray-400">
                    <i className="fa-solid fa-diagram-project text-4xl mb-3" />
                    <p className="text-sm">No notes yet. Create some memos to see the knowledge graph.</p>
                </div>
            ) : (
                <canvas
                    ref={canvasRef}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 cursor-grab active:cursor-grabbing"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onClick={handleClick}
                />
            )}
        </div>
    );
}

function NoteTypeSelector({ noteType, onChange }) {
    return (
        <div className="mt-2 flex flex-wrap gap-1 items-center">
            <span className="text-[10px] text-gray-400 mr-1">Type:</span>
            {NOTE_TYPES.filter(nt => nt.key !== null).map(nt => (
                <button
                    key={nt.key}
                    onClick={() => onChange(noteType === nt.key ? null : nt.key)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition ${noteType === nt.key
                        ? `border-current ${nt.color} font-medium`
                        : 'border-gray-200 dark:border-gray-700 text-gray-400 hover:border-gray-400'}`}
                >
                    <i className={`fa-solid ${nt.icon} mr-1`} />{nt.label}
                </button>
            ))}
        </div>
    );
}

export function NewMemoEditor({ onDone, onCancel, memoTitles = [] }) {
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [color, setColor] = useState('white');
    const [noteType, setNoteType] = useState(null);
    const [tagInput, setTagInput] = useState('');
    const [tags, setTags] = useState([]);
    const [pendingFiles, setPendingFiles] = useState([]);
    const [showPreview, setShowPreview] = useState(false);
    const isHtml = looksLikeHtml(content);
    const newFileInputRef = useRef(null);
    const colorCls = getColorClasses(color);
    const newContentRef = useRef(null);

    const autocomplete = LinkAutocomplete({
        textareaRef: newContentRef,
        value: content,
        onChange: setContent,
        allTitles: memoTitles,
    });

    function addTag() {
        const t = tagInput.trim();
        if (t && !tags.includes(t)) setTags([...tags, t]);
        setTagInput('');
    }
    function removeTag(tag) { setTags(tags.filter(t => t !== tag)); }

    function handleAddFile() { newFileInputRef.current?.click(); }
    function onFileSelected(ev) {
        const file = ev.target.files[0];
        if (file) setPendingFiles(prev => [...prev, file]);
        ev.target.value = '';
    }
    function removePendingFile(idx) { setPendingFiles(prev => prev.filter((_, i) => i !== idx)); }

    async function handleSave() {
        if (!title.trim() && !content.trim() && pendingFiles.length === 0) return;
        try {
            const created = await createMemo({ title, content, color, tags, noteType });
            const memoId = created.id;
            for (const file of pendingFiles) {
                await uploadMemoFile(memoId, file);
            }
            onDone();
        } catch (e) { console.error(e); }
    }

    return (
        <div className={`border rounded-xl p-4 shadow-lg ${colorCls.bg} ${colorCls.border}`}>
            <input ref={newFileInputRef} type="file" className="hidden" onChange={onFileSelected} />
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                   placeholder="Title" className="w-full bg-transparent font-medium text-sm focus:outline-none mb-2 placeholder-gray-400" autoFocus />
            <div className="flex items-center gap-1 mb-2">
                {isHtml && (
                    <>
                        <button onClick={() => setShowPreview(false)}
                            className={`text-[10px] px-2 py-0.5 rounded transition cursor-pointer ${!showPreview ? 'bg-gray-200 dark:bg-gray-600 font-medium' : 'text-gray-400 hover:text-gray-600'}`}>
                            <i className="fa-solid fa-code mr-1" />Code
                        </button>
                        <button onClick={() => setShowPreview(true)}
                            className={`text-[10px] px-2 py-0.5 rounded transition cursor-pointer ${showPreview ? 'bg-gray-200 dark:bg-gray-600 font-medium' : 'text-gray-400 hover:text-gray-600'}`}>
                            <i className="fa-solid fa-eye mr-1" />Preview
                        </button>
                        <span className="mx-1 text-gray-300 dark:text-gray-600">·</span>
                    </>
                )}
                <TemplateInsertButton textareaRef={newContentRef} value={content} setValue={setContent} />
            </div>
            {showPreview && isHtml ? (
                <div className="w-full min-h-[80px] text-sm border border-dashed border-gray-200 dark:border-gray-600 rounded-lg p-3 overflow-auto">
                    <HtmlContent html={content} />
                </div>
            ) : (
                <div className="relative">
                    <textarea ref={newContentRef} value={content} onChange={autocomplete.handleInput}
                              {...autocomplete.inputProps}
                              onKeyDown={autocomplete.handleKeyDown}
                              placeholder="Take a memo... (type [[ to link)"
                              className="w-full bg-transparent text-sm focus:outline-none resize-none min-h-[80px] placeholder-gray-400 font-mono" rows={4} />
                    {autocomplete.dropdown}
                </div>
            )}

            {pendingFiles.length > 0 && (
                <div className="mt-2 space-y-1">
                    {pendingFiles.map((f, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs group">
                            <i className="fa-solid fa-paperclip text-gray-400" />
                            <span className="truncate flex-1 text-gray-500">{f.name}</span>
                            <button onClick={() => removePendingFile(idx)} className="text-gray-400 hover:text-red-400">
                                <i className="fa-solid fa-xmark" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className="mt-3 flex flex-wrap gap-1 items-center">
                {tags.map(tag => (
                    <span key={tag} className="text-[10px] bg-gray-200 dark:bg-gray-700 rounded-full px-2 py-0.5 text-gray-500 flex items-center gap-1">
                        {tag}
                        <button onClick={() => removeTag(tag)} className="hover:text-red-400"><i className="fa-solid fa-xmark text-[8px]" /></button>
                    </span>
                ))}
                <input type="text" value={tagInput} onChange={e => setTagInput(e.target.value)}
                       onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                       placeholder="Add tag..." className="text-[11px] bg-transparent focus:outline-none w-20 placeholder-gray-400" />
            </div>

            <NoteTypeSelector noteType={noteType} onChange={setNoteType} />

            <div className="mt-3 flex items-center justify-between border-t border-gray-200 dark:border-gray-600 pt-3">
                <div className="flex items-center gap-2">
                    {COLORS.map(c => (
                        <button key={c.key} onClick={() => setColor(c.key)}
                                className={`w-5 h-5 rounded-full border-2 transition ${c.bg} ${color === c.key ? 'border-gray-800 dark:border-white scale-110' : 'border-gray-300 dark:border-gray-600'}`} />
                    ))}
                    <button onClick={handleAddFile} className="text-gray-400 hover:text-gray-600 ml-2" title="Attach file">
                        <i className="fa-solid fa-paperclip" />
                    </button>
                </div>
                <div className="flex gap-2">
                    <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1 cursor-pointer">Cancel</button>
                    <button onClick={handleSave} className="text-xs bg-black dark:bg-white text-white dark:text-black px-4 py-1 rounded-lg font-medium hover:opacity-80 transition cursor-pointer">Save</button>
                </div>
            </div>
        </div>
    );
}

export function MemoEditor({ initialData, onSave, onCancel, onDelete, onUploadFile, onDeleteFile, memoTitles = [], onLinkClick, onBacklinkClick, onExport, whiteboardNames = [] }) {
    const [title, setTitle] = useState(initialData?.title || '');
    const [content, setContent] = useState(initialData?.content || '');
    const [color, setColor] = useState(initialData?.color || 'white');
    const [noteType, setNoteType] = useState(initialData?.noteType || null);
    const [isHandMaintained, setIsHandMaintained] = useState(!!initialData?.isHandMaintained);
    const [tagInput, setTagInput] = useState('');
    const [tags, setTags] = useState(initialData?.tags || []);
    const [showPreview, setShowPreview] = useState(false);
    const [backlinks, setBacklinks] = useState([]);
    const isHtml = looksLikeHtml(content);
    const colorCls = getColorClasses(color);
    const contentRef = useRef(null);

    const autocomplete = LinkAutocomplete({
        textareaRef: contentRef,
        value: content,
        onChange: setContent,
        allTitles: memoTitles,
    });

    useEffect(() => {
        if (initialData?.id) {
            getMemoBacklinks(initialData.id).then(setBacklinks).catch(() => {});
        }
    }, [initialData?.id]);

    function addTag() {
        const t = tagInput.trim();
        if (t && !tags.includes(t)) {
            setTags([...tags, t]);
        }
        setTagInput('');
    }

    function removeTag(tag) {
        setTags(tags.filter(t => t !== tag));
    }

    function handleSave() {
        if (!title.trim() && !content.trim()) return;
        onSave({ title, content, color, tags, noteType, isHandMaintained });
    }

    function openKnowledgeSource(source) {
        const dirty = title !== (initialData?.title || '') ||
            content !== (initialData?.content || '') ||
            color !== (initialData?.color || 'white') ||
            noteType !== (initialData?.noteType || null) ||
            isHandMaintained !== !!initialData?.isHandMaintained ||
            JSON.stringify(tags) !== JSON.stringify(initialData?.tags || []) ||
            !!tagInput.trim();
        if (dirty && !window.confirm('Discard unsaved changes and open this memo?')) return;
        if (onBacklinkClick) onBacklinkClick(source.id);
        else if (onLinkClick) onLinkClick(source.title);
    }

    return (
        <div className={`border rounded-xl p-4 shadow-lg ${colorCls.bg} ${colorCls.border}`}>
            <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Title"
                className="w-full bg-transparent font-medium text-sm focus:outline-none mb-2 placeholder-gray-400"
                autoFocus
            />
            <div className="flex items-center gap-1 mb-2">
                {isHtml && (
                    <>
                        <button
                            onClick={() => setShowPreview(false)}
                            className={`text-[10px] px-2 py-0.5 rounded transition cursor-pointer ${!showPreview ? 'bg-gray-200 dark:bg-gray-600 font-medium' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            <i className="fa-solid fa-code mr-1" />Code
                        </button>
                        <button
                            onClick={() => setShowPreview(true)}
                            className={`text-[10px] px-2 py-0.5 rounded transition cursor-pointer ${showPreview ? 'bg-gray-200 dark:bg-gray-600 font-medium' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            <i className="fa-solid fa-eye mr-1" />Preview
                        </button>
                        <span className="mx-1 text-gray-300 dark:text-gray-600">·</span>
                    </>
                )}
                <TemplateInsertButton textareaRef={contentRef} value={content} setValue={setContent} />
            </div>

            {showPreview && isHtml ? (
                <div className="w-full min-h-[80px] text-sm border border-dashed border-gray-200 dark:border-gray-600 rounded-lg p-3 overflow-auto">
                    <HtmlContent html={content} />
                </div>
            ) : (
                <div className="relative">
                    <textarea
                        ref={contentRef}
                        {...autocomplete.inputProps}
                        value={content}
                        onChange={autocomplete.handleInput}
                        onKeyDown={autocomplete.handleKeyDown}
                        placeholder="Take a memo... (type [[ to link)"
                        className="w-full bg-transparent text-sm focus:outline-none resize-none min-h-[80px] placeholder-gray-400 font-mono"
                        rows={4}
                    />
                    {autocomplete.dropdown}
                </div>
            )}

            {initialData?.files?.length > 0 && (
                <div className="mt-2 space-y-2">
                    {initialData.files.map(f => (
                        isImageFile(f.mimeType) ? (
                            <div key={f.id} className="relative group">
                                <a href={f.url} target="_blank" rel="noreferrer">
                                    <img src={f.url} alt={f.originalName} className="w-full rounded object-contain" />
                                </a>
                                {onDeleteFile && (
                                    <button onClick={() => onDeleteFile(f.id)}
                                            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-black/50 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] hover:bg-red-500 transition">
                                        <i className="fa-solid fa-xmark" />
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div key={f.id} className="flex items-center gap-2 text-xs group">
                                <i className="fa-solid fa-paperclip text-gray-400" />
                                <a href={f.url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline truncate flex-1">
                                    {f.originalName}
                                </a>
                                {onDeleteFile && (
                                    <button onClick={() => onDeleteFile(f.id)}
                                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition-opacity">
                                        <i className="fa-solid fa-xmark" />
                                    </button>
                                )}
                            </div>
                        )
                    ))}
                </div>
            )}

            <div className="mt-3 flex flex-wrap gap-1 items-center">
                {tags.map(tag => (
                    <span key={tag} className="text-[10px] bg-gray-200 dark:bg-gray-700 rounded-full px-2 py-0.5 text-gray-500 flex items-center gap-1">
                        {tag}
                        <button onClick={() => removeTag(tag)} className="hover:text-red-400">
                            <i className="fa-solid fa-xmark text-[8px]" />
                        </button>
                    </span>
                ))}
                <input
                    type="text"
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                    placeholder="Add tag..."
                    className="text-[11px] bg-transparent focus:outline-none w-20 placeholder-gray-400"
                />
            </div>

            {initialData?.id && (
                <MemoKnowledgePanel key={initialData.id} memoId={initialData.id}
                    onOpenMemo={onBacklinkClick || onLinkClick ? openKnowledgeSource : undefined} />
            )}

            {backlinks.length > 0 && (
                <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-600">
                    <p className="text-[10px] text-gray-400 mb-1.5 flex items-center gap-1">
                        <i className="fa-solid fa-arrow-left text-[8px]" />
                        {backlinks.length} backlink{backlinks.length !== 1 ? 's' : ''}
                    </p>
                    <div className="flex flex-wrap gap-1">
                        {backlinks.map(bl => (
                            <button
                                key={bl.id}
                                onClick={() => onBacklinkClick ? onBacklinkClick(bl.id) : (onLinkClick && onLinkClick(bl.title))}
                                className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition cursor-pointer flex items-center gap-1"
                            >
                                <i className="fa-solid fa-link text-[7px]" />{bl.title}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {whiteboardNames.length > 0 && (
                <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-600">
                    <p className="text-[10px] text-gray-400 mb-1.5 flex items-center gap-1">
                        <i className="fa-solid fa-chalkboard text-[8px]" />
                        On {whiteboardNames.length} whiteboard{whiteboardNames.length !== 1 ? 's' : ''}
                    </p>
                    <div className="flex flex-wrap gap-1">
                        {whiteboardNames.map(name => (
                            <span key={name} className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 dark:text-indigo-400">
                                <i className="fa-solid fa-chalkboard text-[8px] mr-1" />{name}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            <NoteTypeSelector noteType={noteType} onChange={setNoteType} />

            <label className="mt-2 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400 cursor-pointer select-none" title="If on, the Muse wiki agent will never propose updates to this memo.">
                <input
                    type="checkbox"
                    checked={isHandMaintained}
                    onChange={e => setIsHandMaintained(e.target.checked)}
                    className="cursor-pointer"
                />
                <i className="fa-solid fa-lock text-[10px]" />
                Hand-maintained (the wiki agent won't touch this memo)
            </label>

            <div className="mt-3 flex items-center justify-between border-t border-gray-200 dark:border-gray-600 pt-3">
                <div className="flex items-center gap-2">
                    {COLORS.map(c => (
                        <button
                            key={c.key}
                            onClick={() => setColor(c.key)}
                            className={`w-5 h-5 rounded-full border-2 transition ${c.bg} ${color === c.key ? 'border-gray-800 dark:border-white scale-110' : 'border-gray-300 dark:border-gray-600'}`}
                        />
                    ))}
                    {onUploadFile && (
                        <button onClick={onUploadFile} className="text-gray-400 hover:text-gray-600 ml-2" title="Attach file">
                            <i className="fa-solid fa-paperclip" />
                        </button>
                    )}
                    {onExport && (
                        <button onClick={onExport} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 ml-2" title="Export as Markdown">
                            <i className="fa-solid fa-file-arrow-down" />
                        </button>
                    )}
                    {onDelete && (
                        <button onClick={onDelete} className="text-gray-400 hover:text-red-500 ml-2" title="Delete">
                            <i className="fa-regular fa-trash-can" />
                        </button>
                    )}
                </div>
                <div className="flex gap-2">
                    <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1 cursor-pointer">
                        Cancel
                    </button>
                    <button onClick={handleSave} className="text-xs bg-black dark:bg-white text-white dark:text-black px-4 py-1 rounded-lg font-medium hover:opacity-80 transition cursor-pointer">
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}
