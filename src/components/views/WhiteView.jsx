import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import WhiteboardOverview, { recordBoardOpened } from './WhiteboardOverview.jsx';
import {
    getWhiteboards, createWhiteboard, updateWhiteboard, deleteWhiteboard,
    getWhiteboardById, getWhiteboardMemos, addMemoToWhiteboard,
    updateWhiteboardMemo, removeWhiteboardMemo, getMemos, updateMemo, createMemo, deleteMemo,
    bulkMoveWhiteboardMemos,
    getWhiteboardConnections, createWhiteboardConnection, updateWhiteboardConnection, deleteWhiteboardConnection,
    getWhiteboardSections, createWhiteboardSection, updateWhiteboardSection, deleteWhiteboardSection,
    getMemoBacklinks, getMemoLinks, getMemoTitles,
    uploadMemoFile, deleteMemoFile,
} from '../../scripts/api.js';
import { MemoEditor } from './MemoView.jsx';
import { TEMPLATES as THINKING_TEMPLATES } from '../../lib/whiteboardTemplates.js';

function sanitizeHtml(html) {
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','hr','div','span','a','strong','b','em','i','u','s','del',
            'ul','ol','li','blockquote','pre','code','table','thead','tbody','tr','th','td',
            'img','figure','figcaption','sub','sup','mark','details','summary','abbr','small'],
        ALLOWED_ATTR: ['href','src','alt','title','class','style','target','rel','width','height','colspan','rowspan'],
        ALLOW_DATA_ATTR: false,
    });
}

function markdownToSimpleHtml(text) {
    if (!text) return '';
    let html = text
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/\[\[([^\]]+)\]\]/g, '<span class="text-blue-500 font-medium">$1</span>');
    const lines = html.split('\n');
    const result = [];
    let inList = false;
    for (const line of lines) {
        const bulletMatch = line.match(/^[\s]*[-*•]\s+(.+)/);
        const numberedMatch = line.match(/^[\s]*(\d+)\.\s+(.+)/);
        if (bulletMatch) {
            if (!inList) { result.push('<ul>'); inList = 'ul'; }
            result.push(`<li>${bulletMatch[1]}</li>`);
        } else if (numberedMatch) {
            if (!inList) { result.push('<ol>'); inList = 'ol'; }
            result.push(`<li>${numberedMatch[2]}</li>`);
        } else {
            if (inList) { result.push(inList === 'ul' ? '</ul>' : '</ol>'); inList = false; }
            if (line.startsWith('<h')) {
                result.push(line);
            } else if (line.trim()) {
                result.push(`<p>${line}</p>`);
            }
        }
    }
    if (inList) result.push(inList === 'ul' ? '</ul>' : '</ol>');
    return result.join('');
}

function looksLikeHtml(text) {
    if (!text) return false;
    return /<[a-z][\s\S]*>/i.test(text);
}

const MEMO_COLORS = {
    white: { bg: '#ffffff', border: '#e5e7eb', text: '#111827' },
    yellow: { bg: '#fefce8', border: '#fde68a', text: '#854d0e' },
    green: { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534' },
    blue: { bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af' },
    pink: { bg: '#fdf2f8', border: '#fbcfe8', text: '#9d174d' },
    purple: { bg: '#faf5ff', border: '#e9d5ff', text: '#7e22ce' },
    orange: { bg: '#fff7ed', border: '#fed7aa', text: '#9a3412' },
};

function getDarkColors(color) {
    const dark = {
        white: { bg: '#1f2937', border: '#374151', text: '#f3f4f6' },
        yellow: { bg: '#422006', border: '#854d0e', text: '#fef9c3' },
        green: { bg: '#052e16', border: '#166534', text: '#dcfce7' },
        blue: { bg: '#172554', border: '#1e40af', text: '#dbeafe' },
        pink: { bg: '#500724', border: '#9d174d', text: '#fce7f3' },
        purple: { bg: '#3b0764', border: '#7e22ce', text: '#f3e8ff' },
        orange: { bg: '#431407', border: '#9a3412', text: '#ffedd5' },
    };
    return dark[color] || dark.white;
}

const SECTION_COLORS = {
    blue: { bg: 'rgba(59, 130, 246, 0.08)', border: 'rgba(59, 130, 246, 0.4)', label: '#1e40af' },
    green: { bg: 'rgba(34, 197, 94, 0.08)', border: 'rgba(34, 197, 94, 0.4)', label: '#166534' },
    yellow: { bg: 'rgba(234, 179, 8, 0.10)', border: 'rgba(234, 179, 8, 0.45)', label: '#854d0e' },
    pink: { bg: 'rgba(236, 72, 153, 0.08)', border: 'rgba(236, 72, 153, 0.4)', label: '#9d174d' },
    purple: { bg: 'rgba(168, 85, 247, 0.08)', border: 'rgba(168, 85, 247, 0.4)', label: '#7e22ce' },
    gray: { bg: 'rgba(156, 163, 175, 0.10)', border: 'rgba(156, 163, 175, 0.4)', label: '#374151' },
};

const MemoCardOverlay = React.memo(function MemoCardOverlay({
    placement, isDark, isSelected, mode, isConnectSource, onPointerDown, onContextMenu, onStartEdgeConnection,
}) {
    const { memo, x, y, width, height, placementId } = placement;
    const colors = isDark ? getDarkColors(memo.color) : (MEMO_COLORS[memo.color] || MEMO_COLORS.white);

    const renderedHtml = useMemo(() => {
        if (!memo.content) return '';
        if (looksLikeHtml(memo.content)) return sanitizeHtml(memo.content);
        return sanitizeHtml(markdownToSimpleHtml(memo.content));
    }, [memo.content]);

    const ringClass = isSelected
        ? 'ring-2 ring-blue-500 ring-offset-1'
        : (isConnectSource ? 'ring-2 ring-purple-500 ring-offset-1 animate-pulse' : '');

    return (
        <div
            data-placement-id={placementId}
            onPointerDown={(e) => onPointerDown(e, placement)}
            onContextMenu={(e) => onContextMenu(e, placement)}
            className={`absolute select-none ${ringClass}`}
            style={{
                left: x, top: y, width, height,
                cursor: mode === 'connect' ? 'crosshair' : 'grab',
                pointerEvents: 'auto',
                borderRadius: 8,
            }}
        >
            <div
                className="w-full h-full rounded-lg border shadow-sm overflow-hidden flex flex-col"
                style={{ backgroundColor: colors.bg, borderColor: colors.border, color: colors.text }}
            >
                {memo.title && (
                    <div className="px-4 pt-3 pb-1 border-b" style={{ borderColor: colors.border + '80' }}>
                        <p className="font-bold leading-snug text-[14px]">{memo.title}</p>
                    </div>
                )}
                {renderedHtml && (
                    <div className="px-4 py-2 flex-1 overflow-hidden">
                        <div
                            className="memo-html-content whiteboard-card-content text-[12px]"
                            dangerouslySetInnerHTML={{ __html: renderedHtml }}
                        />
                    </div>
                )}
                {!renderedHtml && !memo.title && (
                    <div className="px-4 py-3 flex-1 flex items-center justify-center">
                        <span className="text-xs opacity-40 italic">Empty memo</span>
                    </div>
                )}
                {(memo.tags && memo.tags.length > 0) && (
                    <div className="px-3 pb-2 pt-1 flex flex-wrap gap-1 border-t" style={{ borderColor: colors.border + '60' }}>
                        {memo.tags.slice(0, 4).map(tag => (
                            <span key={tag} className="px-1.5 py-0.5 rounded-full opacity-70 text-[9px]"
                                style={{ backgroundColor: colors.border + '80' }}>
                                {tag}
                            </span>
                        ))}
                    </div>
                )}
            </div>
            {/* connection handle on right edge - hover to reveal, drag to connect */}
            <div
                onPointerDown={(e) => { e.stopPropagation(); onStartEdgeConnection(e, placement); }}
                title="Drag to connect to another card"
                className="absolute opacity-0 hover:!opacity-100 transition-opacity"
                style={{
                    right: -8, top: '50%', transform: 'translateY(-50%)',
                    width: 16, height: 16, borderRadius: 999, background: '#a855f7',
                    border: '2px solid white', boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                    cursor: 'crosshair', pointerEvents: 'auto',
                    opacity: isConnectSource ? 1 : undefined,
                }}
            />
        </div>
    );
}, (prev, next) => (
    prev.placement === next.placement &&
    prev.isDark === next.isDark &&
    prev.isSelected === next.isSelected &&
    prev.mode === next.mode &&
    prev.isConnectSource === next.isConnectSource
));

function MemoSidebar({ allMemos, onAddMemo, onCreateMemo, show, onToggle }) {
    const [search, setSearch] = useState('');
    const [creating, setCreating] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newContent, setNewContent] = useState('');
    const [saving, setSaving] = useState(false);

    const filtered = allMemos.filter(m => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (m.title || '').toLowerCase().includes(q) ||
            (m.content || '').toLowerCase().includes(q) ||
            (m.tags || []).some(t => t.toLowerCase().includes(q));
    });

    function handleDragStart(e, memo) {
        e.dataTransfer.setData('application/memo-id', String(memo.id));
        e.dataTransfer.effectAllowed = 'copy';
    }

    async function handleSaveNew() {
        if (!newTitle.trim() && !newContent.trim()) return;
        setSaving(true);
        try {
            await onCreateMemo({ title: newTitle, content: newContent });
            setNewTitle(''); setNewContent(''); setCreating(false);
        } catch (e) { console.error(e); }
        setSaving(false);
    }

    return (
        <div className={`absolute top-2 right-2 z-20 transition-all ${show ? 'w-72' : 'w-10'}`}>
            {!show ? (
                <button onClick={onToggle}
                    className="w-10 h-10 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-md flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-700 transition cursor-pointer"
                    title="Show memo panel">
                    <i className="fa-solid fa-note-sticky text-gray-500" />
                </button>
            ) : (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl max-h-[calc(100vh-120px)] flex flex-col">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Memos</span>
                        <div className="flex items-center gap-1.5">
                            <button onClick={() => setCreating(!creating)}
                                className={`w-6 h-6 rounded-md flex items-center justify-center transition cursor-pointer ${creating ? 'bg-blue-500 text-white' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                                title="New memo">
                                <i className="fa-solid fa-plus text-[10px]" />
                            </button>
                            <button onClick={onToggle} className="text-gray-400 hover:text-gray-600 cursor-pointer">
                                <i className="fa-solid fa-xmark text-sm" />
                            </button>
                        </div>
                    </div>
                    {creating && (
                        <div className="px-2.5 py-2 border-b border-gray-100 dark:border-gray-700 space-y-1.5">
                            <input type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Title"
                                className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-blue-400 placeholder-gray-400 font-medium" autoFocus />
                            <textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="Content..."
                                className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-blue-400 placeholder-gray-400 resize-none font-mono" rows={4} />
                            <div className="flex justify-end gap-1.5">
                                <button onClick={() => { setCreating(false); setNewTitle(''); setNewContent(''); }} className="text-[11px] text-gray-400 hover:text-gray-600 px-2.5 py-1 cursor-pointer">Cancel</button>
                                <button onClick={handleSaveNew} disabled={saving} className="text-[11px] bg-black dark:bg-white text-white dark:text-black px-3 py-1 rounded-lg font-medium hover:opacity-80 transition cursor-pointer disabled:opacity-50">
                                    {saving ? 'Saving...' : 'Create & Add'}
                                </button>
                            </div>
                        </div>
                    )}
                    <div className="px-2 py-1.5">
                        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search memos..."
                            className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-blue-400 placeholder-gray-400" />
                    </div>
                    <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1" style={{ maxHeight: '60vh' }}>
                        {filtered.length === 0 && (<p className="text-[10px] text-gray-400 text-center py-4">No memos found</p>)}
                        {filtered.map(memo => (
                            <div key={memo.id} draggable onDragStart={e => handleDragStart(e, memo)} onClick={() => onAddMemo(memo.id)}
                                className="px-2.5 py-2 rounded-lg border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-grab active:cursor-grabbing transition">
                                <p className="text-xs font-medium truncate text-gray-800 dark:text-gray-200">
                                    {memo.title || <span className="italic text-gray-400">Untitled</span>}
                                </p>
                                {memo.content && (<p className="text-[10px] text-gray-400 truncate mt-0.5">{memo.content.replace(/<[^>]+>/g, '').slice(0, 60)}</p>)}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function WhiteboardTabs({ boards, activeId, onSelect, onCreate, onRename, onDelete, onSetParent, onCreateChild, onOpenOverview, overviewActive }) {
    const [renaming, setRenaming] = useState(null);
    const [newName, setNewName] = useState('');
    const [contextMenu, setContextMenu] = useState(null);

    function startRename(wb) { setRenaming(wb.id); setNewName(wb.name); }
    function finishRename() {
        if (renaming && newName.trim()) onRename(renaming, newName.trim());
        setRenaming(null);
    }

    function buildTree(items) {
        const roots = items.filter(b => !b.parentId);
        const children = {};
        items.forEach(b => { if (b.parentId) { if (!children[b.parentId]) children[b.parentId] = []; children[b.parentId].push(b); } });
        function flatten(list, depth) {
            const result = [];
            for (const b of list) {
                result.push({ ...b, depth });
                if (children[b.id]) result.push(...flatten(children[b.id], depth + 1));
            }
            return result;
        }
        return flatten(roots, 0);
    }
    const tree = buildTree(boards);

    function handleContextMenu(e, wb) { e.preventDefault(); e.stopPropagation(); setContextMenu({ wb, x: e.clientX, y: e.clientY }); }

    return (
        <>
            <div className="absolute top-2 left-2 z-20 flex items-center gap-1 flex-wrap max-w-[70%]">
                <button onClick={onOpenOverview}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs cursor-pointer border transition shadow-sm ${overviewActive
                        ? 'bg-black dark:bg-white border-black dark:border-white font-semibold text-white dark:text-black'
                        : 'bg-white/80 dark:bg-gray-800/80 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800'}`}
                    title="Whiteboard overview">
                    <i className="fa-solid fa-table-cells-large text-[10px]" />
                    <span>Overview</span>
                </button>
                {tree.map(wb => (
                    <div key={wb.id} onContextMenu={e => handleContextMenu(e, wb)}
                        className={`group flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs cursor-pointer border transition shadow-sm ${wb.id === activeId
                            ? 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 font-semibold text-gray-900 dark:text-white'
                            : 'bg-white/80 dark:bg-gray-800/80 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-800'}`}
                        style={{ marginLeft: wb.depth * 16 }}>
                        {wb.depth > 0 && <i className="fa-solid fa-turn-up fa-rotate-90 text-[8px] text-gray-300 dark:text-gray-600 mr-0.5" />}
                        {renaming === wb.id ? (
                            <input value={newName} onChange={e => setNewName(e.target.value)} onBlur={finishRename}
                                onKeyDown={e => { if (e.key === 'Enter') finishRename(); if (e.key === 'Escape') setRenaming(null); }}
                                className="bg-transparent text-xs w-20 focus:outline-none" autoFocus />
                        ) : (
                            <>
                                <span onClick={() => onSelect(wb.id)}>{wb.name}</span>
                                <button onClick={e => { e.stopPropagation(); startRename(wb); }} className="hidden group-hover:block text-gray-400 hover:text-gray-600 ml-1 cursor-pointer">
                                    <i className="fa-solid fa-pen text-[8px]" />
                                </button>
                                {boards.length > 1 && (
                                    <button onClick={e => { e.stopPropagation(); onDelete(wb.id); }} className="hidden group-hover:block text-gray-400 hover:text-red-500 cursor-pointer">
                                        <i className="fa-solid fa-xmark text-[9px]" />
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                ))}
                <button onClick={() => onCreate()} className="px-2 py-1.5 rounded-lg text-xs border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:border-gray-400 hover:text-gray-600 transition cursor-pointer shadow-sm bg-white/80 dark:bg-gray-800/80">
                    <i className="fa-solid fa-plus text-[9px]" />
                </button>
            </div>
            {contextMenu && (
                <div className="fixed z-[9999] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]"
                    style={{ left: contextMenu.x, top: contextMenu.y }} onClick={() => setContextMenu(null)}>
                    <button onClick={() => { onCreateChild(contextMenu.wb.id); setContextMenu(null); }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2">
                        <i className="fa-solid fa-plus text-[10px]" />Add sub-board
                    </button>
                    {contextMenu.wb.parentId && (
                        <button onClick={() => { onSetParent(contextMenu.wb.id, null); setContextMenu(null); }}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2">
                            <i className="fa-solid fa-arrow-up text-[10px]" />Move to top level
                        </button>
                    )}
                    {boards.filter(b => b.id !== contextMenu.wb.id && b.id !== contextMenu.wb.parentId).length > 0 && (
                        <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1">
                            <p className="px-3 py-1 text-[10px] text-gray-400">Move under:</p>
                            {boards.filter(b => b.id !== contextMenu.wb.id && b.id !== contextMenu.wb.parentId).map(b => (
                                <button key={b.id} onClick={() => { onSetParent(contextMenu.wb.id, b.id); setContextMenu(null); }}
                                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700">
                                    {b.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </>
    );
}

function QuickMemoForm({ onSave, onCancel }) {
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [saving, setSaving] = useState(false);
    const titleRef = useRef(null);
    useEffect(() => { setTimeout(() => titleRef.current?.focus(), 50); }, []);
    async function handleSubmit(e) {
        e?.preventDefault(); if (saving) return;
        setSaving(true); await onSave(title, content); setSaving(false);
    }
    function handleKeyDown(e) {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
    }
    return (
        <div className="fixed inset-0 bg-black/30 z-[9999] flex items-center justify-center p-4" onClick={onCancel}>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
                <form onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
                    <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <i className="fa-solid fa-bolt text-yellow-500 text-sm" />
                            <span className="text-sm font-semibold text-gray-800 dark:text-white">Quick Memo</span>
                        </div>
                        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600 cursor-pointer"><i className="fa-solid fa-xmark" /></button>
                    </div>
                    <div className="p-4 space-y-3">
                        <input ref={titleRef} value={title} onChange={e => setTitle(e.target.value)} placeholder="Title"
                            className="w-full bg-transparent text-base font-semibold focus:outline-none placeholder-gray-300 dark:placeholder-gray-600 dark:text-white" />
                        <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Write something..."
                            className="w-full bg-transparent text-sm focus:outline-none resize-none min-h-[100px] placeholder-gray-300 dark:placeholder-gray-600 font-mono dark:text-gray-200" rows={5} />
                    </div>
                    <div className="px-4 pb-4 flex items-center justify-between">
                        <span className="text-[10px] text-gray-300 dark:text-gray-600">⌘/Ctrl + Enter to save</span>
                        <div className="flex gap-2">
                            <button type="button" onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1.5 cursor-pointer">Cancel</button>
                            <button type="submit" disabled={saving || (!title.trim() && !content.trim())}
                                className="text-xs bg-black dark:bg-white text-white dark:text-black px-4 py-2 rounded-lg font-bold hover:opacity-80 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
                                {saving ? 'Creating...' : 'Create'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}

function SidePanel({ memo, onClose, onSaveDirect, onDeleteMemo, onLinkClick, memoTitles }) {
    const [current, setCurrent] = useState(memo);
    const [outLinks, setOutLinks] = useState([]);
    const [outLinksKey, setOutLinksKey] = useState(0);
    const [linkPickerOpen, setLinkPickerOpen] = useState(false);
    const [linkPickerQuery, setLinkPickerQuery] = useState('');
    const fileInputRef = useRef(null);

    useEffect(() => { setCurrent(memo); }, [memo.id]);
    useEffect(() => {
        if (current?.id) getMemoLinks(current.id).then(setOutLinks).catch(() => setOutLinks([]));
    }, [current?.id, outLinksKey]);

    async function handleSave(data) {
        const updated = await onSaveDirect(current.id, data);
        if (updated) setCurrent(updated);
        setOutLinksKey(k => k + 1);
    }

    function handleUploadClick() { fileInputRef.current?.click(); }
    async function handleFileChange(e) {
        const file = e.target.files?.[0];
        if (!file || !current?.id) return;
        try {
            await uploadMemoFile(current.id, file);
            const refreshed = await updateMemo(current.id, {});
            setCurrent(prev => ({ ...prev, files: refreshed.files || prev.files }));
        } catch (err) { console.error(err); alert('Upload failed'); }
        e.target.value = '';
    }
    async function handleDeleteFile(fileId) {
        try {
            await deleteMemoFile(fileId);
            setCurrent(prev => ({ ...prev, files: (prev.files || []).filter(f => f.id !== fileId) }));
        } catch (err) { console.error(err); }
    }

    return (
        <div className="fixed top-0 right-0 h-full w-[440px] max-w-[92vw] bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl z-[60] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-gray-500"><i className="fa-solid fa-pen-to-square" /> Edit memo</div>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer" title="Close (changes auto-saved)"><i className="fa-solid fa-xmark" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
                <MemoEditor
                    key={current.id}
                    initialData={current}
                    memoTitles={memoTitles}
                    onSave={handleSave}
                    onCancel={onClose}
                    onDelete={() => onDeleteMemo(current.id)}
                    onUploadFile={handleUploadClick}
                    onDeleteFile={handleDeleteFile}
                    onBacklinkClick={onLinkClick}
                    onLinkClick={onLinkClick}
                />
                <div className="mt-3 px-1">
                    <div className="flex items-center justify-between mb-1.5">
                        <p className="text-[10px] text-gray-400"><i className="fa-solid fa-arrow-right text-[8px] mr-1" />Links to ({outLinks.length})</p>
                        <button onClick={() => { setLinkPickerOpen(true); setLinkPickerQuery(''); }}
                            className="text-[10px] px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 cursor-pointer">
                            <i className="fa-solid fa-link text-[8px] mr-1" /> Link to memo…
                        </button>
                    </div>
                    {outLinks.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {outLinks.map(bl => (
                                <button key={bl.id} onClick={() => onLinkClick(bl.id)} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 cursor-pointer">{bl.title || 'Untitled'}</button>
                            ))}
                        </div>
                    )}
                </div>
                {linkPickerOpen && (
                    <div className="fixed inset-0 z-[70] bg-black/30 flex items-start justify-center pt-24" onClick={() => setLinkPickerOpen(false)}>
                        <div className="w-[400px] max-w-[92vw] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3" onClick={e => e.stopPropagation()}>
                            <p className="text-xs text-gray-500 mb-2">Insert link to another memo</p>
                            <input autoFocus value={linkPickerQuery} onChange={e => setLinkPickerQuery(e.target.value)}
                                placeholder="Search by title…"
                                className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                            <div className="mt-2 max-h-64 overflow-y-auto">
                                {(memoTitles || [])
                                    .filter(t => t.id !== current.id && (t.title || '').toLowerCase().includes(linkPickerQuery.toLowerCase()))
                                    .slice(0, 30)
                                    .map(t => (
                                        <button key={t.id} onClick={async () => {
                                            const newContent = (current.content || '') + (current.content && !current.content.endsWith('\n') ? '\n' : '') + `[[${t.title}]]`;
                                            await handleSave({ content: newContent });
                                            setLinkPickerOpen(false);
                                        }} className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer">
                                            <i className="fa-solid fa-link text-[8px] mr-2 text-blue-500" />{t.title || 'Untitled'}
                                        </button>
                                    ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function Spotlight({ allMemos, placedMemos, onJumpTo, onClose, onOpenInOtherBoard }) {
    const [q, setQ] = useState('');
    const [searchAll, setSearchAll] = useState(false);
    const [idx, setIdx] = useState(0);
    const inputRef = useRef(null);
    useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);

    const placedMap = useMemo(() => {
        const m = new Map();
        placedMemos.forEach(p => m.set(p.memo.id, p));
        return m;
    }, [placedMemos]);

    const results = useMemo(() => {
        const ql = q.toLowerCase().trim();
        const source = searchAll ? allMemos : allMemos.filter(m => placedMap.has(m.id));
        if (!ql) return source.slice(0, 30);
        return source.filter(m =>
            (m.title || '').toLowerCase().includes(ql) ||
            (m.content || '').toLowerCase().includes(ql)
        ).slice(0, 30);
    }, [q, searchAll, allMemos, placedMap]);

    useEffect(() => { setIdx(0); }, [q, searchAll]);

    function pick(r) {
        const placement = placedMap.get(r.id);
        if (placement) onJumpTo(placement);
        else if (onOpenInOtherBoard) onOpenInOtherBoard(r.id);
        onClose();
    }
    function handleKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, results.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
        else if (e.key === 'Enter') { e.preventDefault(); if (results[idx]) pick(results[idx]); }
    }

    return (
        <div className="fixed inset-0 bg-black/30 z-[100] flex items-start justify-center pt-[15vh] p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
                    <i className="fa-solid fa-magnifying-glass text-gray-400 text-sm" />
                    <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={handleKey}
                        placeholder="Search memos on this board..."
                        className="flex-1 bg-transparent text-sm focus:outline-none dark:text-white" />
                    <label className="text-[10px] text-gray-500 flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={searchAll} onChange={e => setSearchAll(e.target.checked)} className="cursor-pointer" />
                        All boards
                    </label>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                    {results.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No results</p>}
                    {results.map((r, i) => {
                        const onBoard = placedMap.has(r.id);
                        return (
                            <button key={r.id} onClick={() => pick(r)} onMouseEnter={() => setIdx(i)}
                                className={`w-full text-left px-4 py-2.5 border-b border-gray-50 dark:border-gray-800 cursor-pointer ${i === idx ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-sm font-medium truncate dark:text-white">{r.title || <span className="italic text-gray-400">Untitled</span>}</p>
                                    {!onBoard && <span className="text-[9px] text-gray-400 shrink-0">other board</span>}
                                </div>
                                {r.content && <p className="text-[11px] text-gray-400 truncate mt-0.5">{r.content.replace(/<[^>]+>/g, '').slice(0, 80)}</p>}
                            </button>
                        );
                    })}
                </div>
                <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800 text-[10px] text-gray-400 border-t border-gray-100 dark:border-gray-700">
                    ↑↓ navigate · ↵ open · esc close
                </div>
            </div>
        </div>
    );
}

function ConnectionsLayer({ connections, placedMemos, viewportTransform, onClickConnection, selectedConnId }) {
    const memoMap = useMemo(() => {
        const m = new Map();
        for (const p of placedMemos) m.set(p.memo.id, p);
        return m;
    }, [placedMemos]);
    const { zoom, scrollX, scrollY } = viewportTransform;
    const lines = [];
    for (const c of connections) {
        const a = memoMap.get(c.fromMemoId);
        const b = memoMap.get(c.toMemoId);
        if (!a || !b) continue;
        const ax = (a.x + a.width / 2 + scrollX) * zoom;
        const ay = (a.y + a.height / 2 + scrollY) * zoom;
        const bx = (b.x + b.width / 2 + scrollX) * zoom;
        const by = (b.y + b.height / 2 + scrollY) * zoom;
        lines.push({ id: c.id, ax, ay, bx, by, label: c.label });
    }
    return (
        <svg className="absolute inset-0 pointer-events-none" style={{ zIndex: 4 }}>
            <defs>
                <marker id="wb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#6b7280" />
                </marker>
                <marker id="wb-arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6" />
                </marker>
            </defs>
            {lines.map(l => {
                const isSel = l.id === selectedConnId;
                return (
                    <g key={l.id} style={{ pointerEvents: 'auto', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onClickConnection(l.id); }}>
                        <line x1={l.ax} y1={l.ay} x2={l.bx} y2={l.by} stroke="transparent" strokeWidth={14} />
                        <line x1={l.ax} y1={l.ay} x2={l.bx} y2={l.by}
                            stroke={isSel ? '#3b82f6' : '#6b7280'} strokeWidth={isSel ? 2.5 : 1.6}
                            markerEnd={isSel ? 'url(#wb-arrow-sel)' : 'url(#wb-arrow)'} />
                        {l.label && (
                            <g>
                                <rect x={(l.ax + l.bx) / 2 - l.label.length * 3.5 - 4} y={(l.ay + l.by) / 2 - 9}
                                    width={l.label.length * 7 + 8} height={16} rx={3} fill={isSel ? '#dbeafe' : '#ffffff'} stroke={isSel ? '#3b82f6' : '#d1d5db'} strokeWidth={0.6} />
                                <text x={(l.ax + l.bx) / 2} y={(l.ay + l.by) / 2 + 3} textAnchor="middle"
                                    style={{ fontSize: 10, fill: '#374151', userSelect: 'none' }}>{l.label}</text>
                            </g>
                        )}
                    </g>
                );
            })}
        </svg>
    );
}

function SectionsLayer({ sections, viewportTransform, onUpdate, onDelete, onPointerDownSection, onResizeSection, selectedSectionId, onChangeSectionColor }) {
    const { zoom, scrollX, scrollY } = viewportTransform;
    const [renaming, setRenaming] = useState(null);
    const [name, setName] = useState('');
    const [colorPickerFor, setColorPickerFor] = useState(null);

    return (
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 2 }}>
            {sections.map(s => {
                const sx = (s.x + scrollX) * zoom;
                const sy = (s.y + scrollY) * zoom;
                const sw = s.width * zoom;
                const sh = s.height * zoom;
                const c = SECTION_COLORS[s.color] || SECTION_COLORS.blue;
                const isSel = s.id === selectedSectionId;
                return (
                    <div key={s.id}
                        onPointerDown={(e) => onPointerDownSection(e, s)}
                        className={`absolute rounded-lg border-2 ${isSel ? 'shadow-md' : ''}`}
                        style={{
                            left: sx, top: sy, width: sw, height: sh,
                            background: c.bg, borderColor: isSel ? '#3b82f6' : c.border,
                            borderStyle: 'dashed', pointerEvents: 'auto', cursor: 'move',
                        }}>
                        <div className="flex items-center justify-between px-2 py-1">
                            {renaming === s.id ? (
                                <input value={name} onChange={e => setName(e.target.value)}
                                    onBlur={() => { onUpdate(s.id, { title: name }); setRenaming(null); }}
                                    onKeyDown={e => { if (e.key === 'Enter') { onUpdate(s.id, { title: name }); setRenaming(null); } if (e.key === 'Escape') setRenaming(null); }}
                                    autoFocus className="bg-white/80 dark:bg-gray-800/80 text-xs font-semibold px-1 rounded focus:outline-none" />
                            ) : (
                                <span onDoubleClick={(e) => { e.stopPropagation(); setRenaming(s.id); setName(s.title || ''); }}
                                    className="text-xs font-semibold px-1 rounded" style={{ color: c.label }}>
                                    {s.title || <span className="italic opacity-60">Untitled section</span>}
                                </span>
                            )}
                            <div className="flex items-center gap-1">
                                <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setColorPickerFor(colorPickerFor === s.id ? null : s.id); }}
                                    className="w-3 h-3 rounded-full border border-white/50 cursor-pointer" style={{ background: c.border }} title="Change color" />
                                <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                                    className="text-[10px] text-gray-500 hover:text-red-500 ml-1 cursor-pointer"><i className="fa-solid fa-xmark" /></button>
                            </div>
                        </div>
                        {colorPickerFor === s.id && (
                            <div onPointerDown={(e) => e.stopPropagation()}
                                className="absolute top-7 right-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg p-1 flex gap-1 z-10">
                                {Object.keys(SECTION_COLORS).map(ck => (
                                    <button key={ck} onClick={() => { onChangeSectionColor(s.id, ck); setColorPickerFor(null); }}
                                        className="w-4 h-4 rounded-full border border-gray-300 cursor-pointer" style={{ background: SECTION_COLORS[ck].border }} />
                                ))}
                            </div>
                        )}
                        {/* resize handle */}
                        <div onPointerDown={(e) => { e.stopPropagation(); onResizeSection(e, s); }}
                            className="absolute -bottom-1 -right-1 w-4 h-4 cursor-nwse-resize rounded-sm bg-blue-500 opacity-0 hover:opacity-100"
                            style={{ opacity: isSel ? 0.9 : undefined }}
                            title="Drag to resize" />
                    </div>
                );
            })}
        </div>
    );
}

function BulkActionBar({ count, onDelete, onMove, boards, currentBoardId }) {
    const [showMove, setShowMove] = useState(false);
    return (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-xl px-3 py-1.5 flex items-center gap-3">
            <span className="text-xs font-semibold dark:text-white">{count} selected</span>
            <div className="w-px h-4 bg-gray-200 dark:bg-gray-700" />
            <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-600 cursor-pointer"><i className="fa-solid fa-trash mr-1" />Remove</button>
            <div className="relative">
                <button onClick={() => setShowMove(!showMove)} className="text-xs text-gray-700 dark:text-gray-200 hover:text-gray-900 cursor-pointer"><i className="fa-solid fa-right-left mr-1" />Move to…</button>
                {showMove && (
                    <div className="absolute bottom-full mb-1 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[160px]">
                        {boards.filter(b => b.id !== currentBoardId).map(b => (
                            <button key={b.id} onClick={() => { setShowMove(false); onMove(b.id); }}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 truncate">{b.name}</button>
                        ))}
                        {boards.filter(b => b.id !== currentBoardId).length === 0 && (
                            <p className="px-3 py-2 text-[10px] text-gray-400">No other boards</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function rectsIntersect(a, b) {
    return !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);
}

export default function WhiteView() {
    const memoLibLoadedRef = useRef(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const overviewMode = searchParams.get('board') === 'overview';
    const urlBoardId = (() => {
        const v = searchParams.get('board');
        if (!v || v === 'overview') return null;
        const n = parseInt(v);
        return isNaN(n) ? null : n;
    })();
    const [ExcalidrawComp, setExcalidrawComp] = useState(null);
    const [loading, setLoading] = useState(true);
    const [boards, setBoards] = useState([]);
    const [activeBoard, setActiveBoard] = useState(null);
    const [boardData, setBoardData] = useState(null);
    const [placedMemos, setPlacedMemos] = useState([]);
    const [allMemos, setAllMemos] = useState([]);
    const [memoTitles, setMemoTitles] = useState([]);
    const [connections, setConnections] = useState([]);
    const [sections, setSections] = useState([]);
    const [showSidebar, setShowSidebar] = useState(false);
    const [editingMemo, setEditingMemo] = useState(null);
    const [quickCreate, setQuickCreate] = useState(null);
    const [viewportTransform, setViewportTransform] = useState({ zoom: 1, scrollX: 0, scrollY: 0 });
    const [mode, setMode] = useState('select'); // select | connect | section
    const [connectFrom, setConnectFrom] = useState(null);
    const [selectedIds, setSelectedIds] = useState(new Set()); // Set<placementId>
    const [selectedConnId, setSelectedConnId] = useState(null);
    const [selectedSectionId, setSelectedSectionId] = useState(null);
    const [marquee, setMarquee] = useState(null); // {x,y,w,h}
    const [drawingSection, setDrawingSection] = useState(null);
    const [spotlightOpen, setSpotlightOpen] = useState(false);
    const [templatesMenuOpen, setTemplatesMenuOpen] = useState(false);
    const [highlightPlacementId, setHighlightPlacementId] = useState(null);
    const [tempConnection, setTempConnection] = useState(null); // {fromX, fromY, toX, toY} in canvas coords
    const [viewportSize, setViewportSize] = useState({ w: window.innerWidth, h: window.innerHeight });

    const saveTimerRef = useRef(null);
    const lastSavedDataRef = useRef(null);
    const apiRef = useRef(null);
    const mountedAtRef = useRef(0);
    const savedFilesRef = useRef(null);
    const containerRef = useRef(null);
    const rafRef = useRef(null);
    const isDark = document.documentElement.classList.contains('dark');

    // Load excalidraw + initial data
    useEffect(() => {
        async function load() {
            if (!document.querySelector('link[data-excalidraw-css]')) {
                const link = document.createElement('link');
                link.rel = 'stylesheet'; link.href = '/excalidraw.css';
                link.setAttribute('data-excalidraw-css', '');
                document.head.appendChild(link);
            }
            // Skip Excalidraw + memo library fetches when opening directly to overview;
            // they'll load on-demand when the user opens an actual board.
            if (!overviewMode) {
                try {
                    const mod = await import("@excalidraw/excalidraw");
                    setExcalidrawComp(() => mod.Excalidraw);
                } catch (e) { console.error("Failed to load Excalidraw", e); }
            }

            try {
                if (overviewMode) {
                    // Skip getWhiteboards() here so the true "no boards yet" empty state
                    // is preserved (existing /api/whiteboards auto-creates a default board).
                    // The overview component fetches its own data via /api/whiteboards/overview.
                } else {
                    const [wbs, userMemos, titles] = await Promise.all([getWhiteboards(), getMemos(), getMemoTitles().catch(() => [])]);
                    setBoards(wbs);
                    setAllMemos(userMemos);
                    setMemoTitles(titles);
                    memoLibLoadedRef.current = true;
                    if (wbs.length > 0) {
                        const initialId = (urlBoardId && wbs.some(b => b.id === urlBoardId)) ? urlBoardId : wbs[0].id;
                        await loadBoard(initialId);
                        recordBoardOpened(initialId);
                    }
                }
            } catch (e) { console.error("Failed to load whiteboard data", e); }
            setLoading(false);
            mountedAtRef.current = Date.now();
        }
        load();
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, []);

    // Resize observer for viewport culling
    useEffect(() => {
        function onResize() {
            const r = containerRef.current?.getBoundingClientRect();
            if (r) setViewportSize({ w: r.width, h: r.height });
        }
        onResize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // ⌘K spotlight
    useEffect(() => {
        function onKey(e) {
            if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                setSpotlightOpen(s => !s);
            } else if (e.key === 'Escape') {
                if (mode !== 'select') { setMode('select'); setConnectFrom(null); }
                if (selectedIds.size > 0) setSelectedIds(new Set());
                if (selectedConnId) setSelectedConnId(null);
                if (selectedSectionId) setSelectedSectionId(null);
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedConnId) {
                const target = e.target;
                if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
                handleDeleteConnection(selectedConnId);
            }
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [mode, selectedIds, selectedConnId, selectedSectionId]);

    async function loadBoard(id) {
        setActiveBoard(id);
        setSelectedIds(new Set()); setConnectFrom(null); setSelectedConnId(null); setSelectedSectionId(null);
        try {
            const [wbData, wbMemos, conns, secs] = await Promise.all([
                getWhiteboardById(id), getWhiteboardMemos(id),
                getWhiteboardConnections(id).catch(() => []),
                getWhiteboardSections(id).catch(() => []),
            ]);
            if (wbData.data && wbData.data !== '{}') {
                const parsed = JSON.parse(wbData.data);
                setBoardData(parsed);
                lastSavedDataRef.current = wbData.data;
                if (apiRef.current) {
                    apiRef.current.updateScene({ elements: parsed.elements || [], appState: parsed.appState || {} });
                    if (parsed.files) {
                        apiRef.current.addFiles(Object.values(parsed.files).map(f => ({ ...f })));
                    }
                }
            } else {
                setBoardData(null); lastSavedDataRef.current = null;
                if (apiRef.current) apiRef.current.updateScene({ elements: [], appState: {} });
            }
            setPlacedMemos(wbMemos);
            setConnections(conns);
            setSections(secs);
            savedFilesRef.current = null;
            mountedAtRef.current = Date.now();
        } catch (e) { console.error(e); }
    }

    function setBoardParam(value, options) {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.set('board', String(value));
            return next;
        }, options);
    }
    async function switchBoard(id) {
        setBoardParam(id, { replace: true });
        if (id !== activeBoard) await loadBoard(id);
        recordBoardOpened(id);
    }

    // React to URL changes (browser back/forward) by loading the target board.
    useEffect(() => {
        if (loading || overviewMode) return;
        if (urlBoardId && urlBoardId !== activeBoard && boards.some(b => b.id === urlBoardId)) {
            loadBoard(urlBoardId);
            recordBoardOpened(urlBoardId);
        }
    }, [urlBoardId, overviewMode, loading, boards, activeBoard]);

    // Lazy-load Excalidraw + memo library when leaving overview mode for the first time.
    useEffect(() => {
        if (overviewMode) return;
        let cancelled = false;
        if (!ExcalidrawComp) {
            (async () => {
                try {
                    const mod = await import("@excalidraw/excalidraw");
                    if (!cancelled) setExcalidrawComp(() => mod.Excalidraw);
                } catch (e) { console.error("Failed to load Excalidraw", e); }
            })();
        }
        if (!memoLibLoadedRef.current) {
            memoLibLoadedRef.current = true;
            (async () => {
                try {
                    const [userMemos, titles] = await Promise.all([getMemos(), getMemoTitles().catch(() => [])]);
                    if (cancelled) return;
                    setAllMemos(userMemos);
                    setMemoTitles(titles);
                } catch (e) { console.error("Failed to load memo library", e); }
            })();
        }
        return () => { cancelled = true; };
    }, [overviewMode, ExcalidrawComp]);

    function openOverview() {
        setBoardParam('overview', { replace: false });
    }
    async function openBoardFromOverview(id) {
        setBoardParam(id, { replace: false });
        if (id !== activeBoard) await loadBoard(id);
        recordBoardOpened(id);
    }

    async function handleCreateBoard() {
        try { const created = await createWhiteboard('Untitled'); setBoards(prev => [...prev, created]); switchBoard(created.id); } catch (e) { console.error(e); }
    }
    async function handleRenameBoard(id, name) {
        try { await updateWhiteboard(id, { name }); setBoards(prev => prev.map(b => b.id === id ? { ...b, name } : b)); } catch (e) { console.error(e); }
    }
    async function handleDeleteBoard(id) {
        try {
            await deleteWhiteboard(id);
            const remaining = boards.filter(b => b.id !== id);
            setBoards(remaining);
            if (activeBoard === id && remaining.length > 0) switchBoard(remaining[0].id);
        } catch (e) { console.error(e); }
    }
    async function handleSetParent(id, parentId) {
        try { await updateWhiteboard(id, { parentId }); setBoards(prev => prev.map(b => b.id === id ? { ...b, parentId } : b)); } catch (e) { console.error(e); }
    }
    async function handleCreateChild(parentId) {
        try { const created = await createWhiteboard('Untitled', parentId); setBoards(prev => [...prev, created]); switchBoard(created.id); } catch (e) { console.error(e); }
    }

    async function handleAddMemoToBoard(memoId, x, y) {
        if (!activeBoard) return;
        try {
            const placement = await addMemoToWhiteboard(activeBoard, memoId, x ?? 200, y ?? 200);
            const memo = allMemos.find(m => m.id === memoId);
            if (memo) setPlacedMemos(prev => prev.some(p => p.memo.id === memoId) ? prev : [...prev, { ...placement, memo }]);
        } catch (e) { console.error(e); }
    }

    async function persistMemoPosition(placementId, x, y) {
        try { await updateWhiteboardMemo(placementId, { x: Math.round(x), y: Math.round(y) }); } catch (e) { console.error(e); }
    }

    async function handleRemoveMemo(placementId) {
        setPlacedMemos(prev => prev.filter(p => p.placementId !== placementId));
        setSelectedIds(prev => { const n = new Set(prev); n.delete(placementId); return n; });
        try { await removeWhiteboardMemo(placementId); } catch (e) { console.error(e); }
        // refresh connections (server cascades)
        if (activeBoard) getWhiteboardConnections(activeBoard).then(setConnections).catch(() => {});
    }

    async function handleEditMemo(memoId, data) {
        try {
            const updated = await updateMemo(memoId, data);
            setPlacedMemos(prev => prev.map(p => p.memo.id === memoId ? { ...p, memo: { ...p.memo, ...data, ...updated } } : p));
            setAllMemos(prev => prev.map(m => m.id === memoId ? { ...m, ...data, ...updated } : m));
            if (data.title !== undefined) {
                setMemoTitles(prev => {
                    const existing = prev.find(t => t.id === memoId);
                    if (existing) return prev.map(t => t.id === memoId ? { ...t, title: updated.title } : t);
                    return [...prev, { id: memoId, title: updated.title }];
                });
            }
            return updated;
        } catch (e) { console.error(e); return null; }
    }

    // Throttled excalidraw onChange via RAF
    const handleChange = useCallback((elements, appState, files) => {
        if (Date.now() - mountedAtRef.current < 1500) return;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
            const z = typeof appState.zoom === 'object' ? (appState.zoom?.value || 1) : (appState.zoom || 1);
            setViewportTransform(prev => {
                const sx = appState.scrollX || 0;
                const sy = appState.scrollY || 0;
                if (prev.zoom === z && prev.scrollX === sx && prev.scrollY === sy) return prev;
                return { zoom: z, scrollX: sx, scrollY: sy };
            });
        });

        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            if (!activeBoard) return;
            let allFiles = {};
            try {
                const api = apiRef.current;
                if (api && typeof api.getFiles === 'function') allFiles = api.getFiles();
            } catch {}
            if (savedFilesRef.current && Object.keys(savedFilesRef.current).length > 0 && Object.keys(allFiles).length === 0) {
                allFiles = savedFilesRef.current;
            }
            if (Object.keys(allFiles).length > 0) savedFilesRef.current = allFiles;

            const data = JSON.stringify({
                elements,
                appState: {
                    viewBackgroundColor: appState.viewBackgroundColor,
                    currentItemFontFamily: appState.currentItemFontFamily,
                    zoom: appState.zoom, scrollX: appState.scrollX, scrollY: appState.scrollY,
                },
                files: allFiles,
            });
            // Coalesce: only save if drawing data actually changed (ignore appState-only viewport changes for save dedup)
            const compactNow = JSON.stringify({ elements, files: allFiles });
            if (lastSavedDataRef.current && lastSavedDataRef.current.compact === compactNow) {
                return;
            }
            lastSavedDataRef.current = { compact: compactNow };
            updateWhiteboard(activeBoard, { data }).catch(e => console.error("Save whiteboard error", e));
        }, 1500);
    }, [activeBoard]);

    const onExcalidrawAPI = useCallback((api) => { apiRef.current = api; }, []);

    // === Memo card pointer interactions (drag, click, multi-select) ===
    const dragStateRef = useRef(null);
    function handleMemoPointerDown(e, placement) {
        if (e.button !== 0) return;
        if (mode === 'connect') {
            e.stopPropagation();
            if (!connectFrom) { setConnectFrom(placement.memo.id); }
            else if (connectFrom === placement.memo.id) { setConnectFrom(null); }
            else { handleCreateConnection(connectFrom, placement.memo.id); setConnectFrom(null); }
            return;
        }
        e.stopPropagation();

        // shift toggle multi-select
        if (e.shiftKey) {
            setSelectedIds(prev => {
                const n = new Set(prev);
                if (n.has(placement.placementId)) n.delete(placement.placementId);
                else n.add(placement.placementId);
                return n;
            });
            return;
        }

        // start drag (single or group)
        const isGroup = selectedIds.has(placement.placementId) && selectedIds.size > 1;
        const targets = isGroup
            ? placedMemos.filter(p => selectedIds.has(p.placementId))
            : [placement];
        dragStateRef.current = {
            startX: e.clientX, startY: e.clientY, moved: false,
            originals: new Map(targets.map(p => [p.placementId, { x: p.x, y: p.y }])),
        };

        function onMove(ev) {
            const dx = (ev.clientX - dragStateRef.current.startX) / viewportTransform.zoom;
            const dy = (ev.clientY - dragStateRef.current.startY) / viewportTransform.zoom;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragStateRef.current.moved = true;
            setPlacedMemos(prev => prev.map(p => {
                const orig = dragStateRef.current.originals.get(p.placementId);
                if (!orig) return p;
                return { ...p, x: orig.x + dx, y: orig.y + dy };
            }));
        }
        function onUp(ev) {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            const moved = dragStateRef.current.moved;
            const dx = (ev.clientX - dragStateRef.current.startX) / viewportTransform.zoom;
            const dy = (ev.clientY - dragStateRef.current.startY) / viewportTransform.zoom;

            if (moved) {
                for (const [pid, orig] of dragStateRef.current.originals) {
                    persistMemoPosition(pid, orig.x + dx, orig.y + dy);
                }
            } else {
                // pure click - open side panel
                setEditingMemo(placement.memo);
                if (!isGroup) setSelectedIds(new Set([placement.placementId]));
            }
            dragStateRef.current = null;
        }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    }

    function handleMemoContextMenu(e, placement) {
        e.preventDefault(); e.stopPropagation();
        if (window.confirm('Remove this memo from the board?')) handleRemoveMemo(placement.placementId);
    }

    // === Connections ===
    async function handleCreateConnection(fromId, toId) {
        if (!activeBoard) return;
        try {
            const created = await createWhiteboardConnection(activeBoard, fromId, toId);
            setConnections(prev => [...prev, created]);
        } catch (e) { console.error(e); alert('Could not create connection'); }
    }
    async function handleClickConnection(connId) {
        setSelectedConnId(connId);
        const conn = connections.find(c => c.id === connId);
        const newLabel = window.prompt('Connection label (leave empty to keep, type "DELETE" to remove):', conn?.label || '');
        if (newLabel === null) return;
        if (newLabel === 'DELETE') { handleDeleteConnection(connId); return; }
        try {
            await updateWhiteboardConnection(connId, { label: newLabel });
            setConnections(prev => prev.map(c => c.id === connId ? { ...c, label: newLabel } : c));
        } catch (e) { console.error(e); }
    }
    async function handleDeleteConnection(connId) {
        try { await deleteWhiteboardConnection(connId); setConnections(prev => prev.filter(c => c.id !== connId)); setSelectedConnId(null); } catch (e) { console.error(e); }
    }

    // === Sections ===
    // Edge-drag connection: drag from a card's edge handle to another card to connect
    function handleStartEdgeConnection(e, sourcePlacement) {
        e.preventDefault();
        const startCanvasX = sourcePlacement.x + sourcePlacement.width;
        const startCanvasY = sourcePlacement.y + sourcePlacement.height / 2;
        const rect = containerRef.current.getBoundingClientRect();
        function clientToCanvas(cx, cy) {
            return {
                x: (cx - rect.left) / viewportTransform.zoom - viewportTransform.scrollX,
                y: (cy - rect.top) / viewportTransform.zoom - viewportTransform.scrollY,
            };
        }
        setTempConnection({ fromX: startCanvasX, fromY: startCanvasY, toX: startCanvasX, toY: startCanvasY });
        function onMove(ev) {
            const c = clientToCanvas(ev.clientX, ev.clientY);
            setTempConnection({ fromX: startCanvasX, fromY: startCanvasY, toX: c.x, toY: c.y });
        }
        function onUp(ev) {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            const c = clientToCanvas(ev.clientX, ev.clientY);
            // hit-test placedMemos
            const target = placedMemos.find(p => p.memo.id !== sourcePlacement.memo.id &&
                c.x >= p.x && c.x <= p.x + p.width && c.y >= p.y && c.y <= p.y + p.height);
            if (target) handleCreateConnection(sourcePlacement.memo.id, target.memo.id);
            setTempConnection(null);
        }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    }

    function handleResizeSection(e, section) {
        e.preventDefault();
        const startX = e.clientX, startY = e.clientY;
        const origW = section.width, origH = section.height;
        const sId = section.id, origX = section.x, origY = section.y;
        function onMove(ev) {
            const dx = (ev.clientX - startX) / viewportTransform.zoom;
            const dy = (ev.clientY - startY) / viewportTransform.zoom;
            const newW = Math.max(80, origW + dx);
            const newH = Math.max(60, origH + dy);
            setSections(prev => prev.map(s => s.id === sId ? { ...s, width: newW, height: newH } : s));
        }
        function onUp(ev) {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            const dx = (ev.clientX - startX) / viewportTransform.zoom;
            const dy = (ev.clientY - startY) / viewportTransform.zoom;
            const newW = Math.max(80, origW + dx);
            const newH = Math.max(60, origH + dy);
            const containedIds = placedMemos
                .filter(p => p.x + p.width / 2 >= origX && p.x + p.width / 2 <= origX + newW &&
                              p.y + p.height / 2 >= origY && p.y + p.height / 2 <= origY + newH)
                .map(p => p.memo.id);
            handleUpdateSection(sId, { width: Math.round(newW), height: Math.round(newH), containedMemoIds: containedIds });
            setPlacedMemos(prev => prev.map(p => containedIds.includes(p.memo.id) ? { ...p, sectionId: sId } : (p.sectionId === sId ? { ...p, sectionId: null } : p)));
        }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    }

    async function handleCreateSection(rect) {
        if (!activeBoard) return;
        try {
            const created = await createWhiteboardSection(activeBoard, { ...rect, title: '', color: 'blue' });
            setSections(prev => [...prev, created]);
            // assign contained memos
            const containedIds = placedMemos
                .filter(p => p.x + p.width / 2 >= rect.x && p.x + p.width / 2 <= rect.x + rect.width &&
                              p.y + p.height / 2 >= rect.y && p.y + p.height / 2 <= rect.y + rect.height)
                .map(p => p.memo.id);
            if (containedIds.length > 0) {
                await updateWhiteboardSection(created.id, { containedMemoIds: containedIds });
                setPlacedMemos(prev => prev.map(p => containedIds.includes(p.memo.id) ? { ...p, sectionId: created.id } : p));
            }
        } catch (e) { console.error(e); }
    }
    async function handleUpdateSection(id, data) {
        try {
            await updateWhiteboardSection(id, data);
            setSections(prev => prev.map(s => s.id === id ? { ...s, ...data } : s));
        } catch (e) { console.error(e); }
    }
    async function handleDeleteSection(id) {
        try { await deleteWhiteboardSection(id); setSections(prev => prev.filter(s => s.id !== id)); } catch (e) { console.error(e); }
    }

    const sectionDragRef = useRef(null);
    function handleSectionPointerDown(e, section) {
        if (e.button !== 0) return;
        e.stopPropagation();
        setSelectedSectionId(section.id);
        const containedIds = placedMemos.filter(p => p.sectionId === section.id ||
            (p.x + p.width / 2 >= section.x && p.x + p.width / 2 <= section.x + section.width &&
             p.y + p.height / 2 >= section.y && p.y + p.height / 2 <= section.y + section.height)
        ).map(p => p.placementId);
        sectionDragRef.current = {
            startX: e.clientX, startY: e.clientY, moved: false,
            origSection: { x: section.x, y: section.y },
            origMemos: new Map(placedMemos.filter(p => containedIds.includes(p.placementId)).map(p => [p.placementId, { x: p.x, y: p.y }])),
            sectionId: section.id, containedIds,
        };
        function onMove(ev) {
            const dx = (ev.clientX - sectionDragRef.current.startX) / viewportTransform.zoom;
            const dy = (ev.clientY - sectionDragRef.current.startY) / viewportTransform.zoom;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) sectionDragRef.current.moved = true;
            setSections(prev => prev.map(s => s.id === sectionDragRef.current.sectionId
                ? { ...s, x: sectionDragRef.current.origSection.x + dx, y: sectionDragRef.current.origSection.y + dy } : s));
            setPlacedMemos(prev => prev.map(p => {
                const orig = sectionDragRef.current.origMemos.get(p.placementId);
                if (!orig) return p;
                return { ...p, x: orig.x + dx, y: orig.y + dy };
            }));
        }
        function onUp(ev) {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            const dx = (ev.clientX - sectionDragRef.current.startX) / viewportTransform.zoom;
            const dy = (ev.clientY - sectionDragRef.current.startY) / viewportTransform.zoom;
            if (sectionDragRef.current.moved) {
                const sId = sectionDragRef.current.sectionId;
                const newX = sectionDragRef.current.origSection.x + dx;
                const newY = sectionDragRef.current.origSection.y + dy;
                handleUpdateSection(sId, { x: newX, y: newY, containedMemoIds: placedMemos
                    .filter(p => sectionDragRef.current.containedIds.includes(p.placementId))
                    .map(p => p.memo.id) });
                for (const [pid, orig] of sectionDragRef.current.origMemos) {
                    persistMemoPosition(pid, orig.x + dx, orig.y + dy);
                }
            }
            sectionDragRef.current = null;
        }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    }

    // === Bulk actions ===
    async function handleBulkDelete() {
        const ids = [...selectedIds];
        for (const pid of ids) {
            try { await removeWhiteboardMemo(pid); } catch {}
        }
        setPlacedMemos(prev => prev.filter(p => !selectedIds.has(p.placementId)));
        setSelectedIds(new Set());
        if (activeBoard) getWhiteboardConnections(activeBoard).then(setConnections).catch(() => {});
    }
    async function handleBulkMove(targetBoardId) {
        const ids = [...selectedIds];
        try {
            await bulkMoveWhiteboardMemos(activeBoard, ids, targetBoardId);
            setPlacedMemos(prev => prev.filter(p => !selectedIds.has(p.placementId)));
            setSelectedIds(new Set());
            if (activeBoard) getWhiteboardConnections(activeBoard).then(setConnections).catch(() => {});
        } catch (e) { console.error(e); alert('Move failed'); }
    }

    // === Insert thinking template (Mandala / Coordinate Axis / Concentric / 4-Panel) ===
    function insertThinkingTemplate(templateKey) {
        const tpl = THINKING_TEMPLATES.find(t => t.key === templateKey);
        if (!tpl || !apiRef.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        let vt = viewportTransform;
        try {
            const appState = apiRef.current.getAppState();
            if (appState) {
                const z = typeof appState.zoom === 'object' ? (appState.zoom?.value || 1) : (appState.zoom || 1);
                vt = { zoom: z, scrollX: appState.scrollX || 0, scrollY: appState.scrollY || 0 };
            }
        } catch {}
        const centerX = Math.round(rect.width / 2 / vt.zoom - vt.scrollX);
        const centerY = Math.round(rect.height / 2 / vt.zoom - vt.scrollY);
        const newEls = tpl.build({ centerX, centerY });
        let existing = [];
        try { existing = apiRef.current.getSceneElements() || []; } catch {}
        try {
            apiRef.current.updateScene({ elements: [...existing, ...newEls] });
        } catch (e) { console.error('insertThinkingTemplate failed', e); }
        setTemplatesMenuOpen(false);
    }

    // === Quick create + drop ===
    function openQuickCreate() {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        let vt = viewportTransform;
        if (apiRef.current) {
            try {
                const appState = apiRef.current.getAppState();
                if (appState) {
                    const z = typeof appState.zoom === 'object' ? (appState.zoom?.value || 1) : (appState.zoom || 1);
                    vt = { zoom: z, scrollX: appState.scrollX || 0, scrollY: appState.scrollY || 0 };
                }
            } catch {}
        }
        const cx = rect.width / 2, cy = rect.height / 2;
        const canvasX = Math.round(cx / vt.zoom - vt.scrollX);
        const canvasY = Math.round(cy / vt.zoom - vt.scrollY);
        setQuickCreate({ x: canvasX, y: canvasY });
    }
    async function handleQuickSave(title, content) {
        if (!title.trim() && !content.trim()) { setQuickCreate(null); return; }
        try {
            const created = await createMemo({ title, content, color: 'white', tags: [] });
            setAllMemos(prev => [created, ...prev]);
            if (activeBoard) {
                const px = quickCreate?.x ?? 200, py = quickCreate?.y ?? 200;
                const placement = await addMemoToWhiteboard(activeBoard, created.id, px, py);
                setPlacedMemos(prev => prev.some(p => p.memo.id === created.id) ? prev : [...prev, { ...placement, memo: created }]);
            }
        } catch (e) { console.error(e); }
        setQuickCreate(null);
    }
    function handleCanvasDrop(e) {
        e.preventDefault();
        const memoIdStr = e.dataTransfer.getData('application/memo-id');
        if (!memoIdStr) return;
        const memoId = parseInt(memoIdStr);
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const clientX = e.clientX - rect.left, clientY = e.clientY - rect.top;
        const canvasX = clientX / viewportTransform.zoom - viewportTransform.scrollX;
        const canvasY = clientY / viewportTransform.zoom - viewportTransform.scrollY;
        handleAddMemoToBoard(memoId, canvasX, canvasY);
    }
    function handleCanvasDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }

    // === Marquee + section drawing on overlay (mode-gated) ===
    function startOverlayDraw(e) {
        if (e.button !== 0) return;
        const rect = containerRef.current.getBoundingClientRect();
        const cx = (e.clientX - rect.left) / viewportTransform.zoom - viewportTransform.scrollX;
        const cy = (e.clientY - rect.top) / viewportTransform.zoom - viewportTransform.scrollY;

        if (mode === 'section') {
            setDrawingSection({ x: cx, y: cy, w: 0, h: 0, startX: cx, startY: cy });
            const onMove = (ev) => {
                const x2 = (ev.clientX - rect.left) / viewportTransform.zoom - viewportTransform.scrollX;
                const y2 = (ev.clientY - rect.top) / viewportTransform.zoom - viewportTransform.scrollY;
                setDrawingSection({ x: Math.min(cx, x2), y: Math.min(cy, y2), w: Math.abs(x2 - cx), h: Math.abs(y2 - cy), startX: cx, startY: cy });
            };
            const onUp = () => {
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                setDrawingSection(d => {
                    if (d && d.w > 30 && d.h > 30) handleCreateSection({ x: d.x, y: d.y, width: d.w, height: d.h });
                    return null;
                });
                setMode('select');
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        } else {
            // marquee multi-select
            setMarquee({ x: cx, y: cy, w: 0, h: 0, startX: cx, startY: cy });
            const onMove = (ev) => {
                const x2 = (ev.clientX - rect.left) / viewportTransform.zoom - viewportTransform.scrollX;
                const y2 = (ev.clientY - rect.top) / viewportTransform.zoom - viewportTransform.scrollY;
                const r = { x: Math.min(cx, x2), y: Math.min(cy, y2), w: Math.abs(x2 - cx), h: Math.abs(y2 - cy), startX: cx, startY: cy };
                setMarquee(r);
                const hits = placedMemos.filter(p => rectsIntersect({ x: p.x, y: p.y, width: p.width, height: p.height }, { x: r.x, y: r.y, width: r.w, height: r.h }));
                setSelectedIds(new Set(hits.map(p => p.placementId)));
            };
            const onUp = () => {
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                setMarquee(null);
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        }
    }

    function jumpToPlacement(placement) {
        if (!apiRef.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const targetCx = placement.x + placement.width / 2;
        const targetCy = placement.y + placement.height / 2;
        const z = viewportTransform.zoom || 1;
        const newScrollX = rect.width / 2 / z - targetCx;
        const newScrollY = rect.height / 2 / z - targetCy;
        try {
            apiRef.current.updateScene({ appState: { scrollX: newScrollX, scrollY: newScrollY } });
            setViewportTransform({ zoom: z, scrollX: newScrollX, scrollY: newScrollY });
        } catch {}
        setHighlightPlacementId(placement.placementId);
        setTimeout(() => setHighlightPlacementId(null), 1500);
    }

    async function jumpFromLink(memoId) {
        const placement = placedMemos.find(p => p.memo.id === memoId);
        if (placement) { jumpToPlacement(placement); return; }
        // find another board hosting this memo
        const memo = allMemos.find(m => m.id === memoId);
        if (!memo) return;
        // attempt to find via any board: query each (best-effort: we just open it on the current board if missing)
        for (const b of boards) {
            if (b.id === activeBoard) continue;
            try {
                const list = await getWhiteboardMemos(b.id);
                if (list.some(p => p.memo.id === memoId)) {
                    await switchBoard(b.id);
                    setTimeout(() => {
                        const list2 = list.find(p => p.memo.id === memoId);
                        if (list2) jumpToPlacement(list2);
                    }, 300);
                    return;
                }
            } catch {}
        }
        // not on any board: place on current
        if (activeBoard) {
            handleAddMemoToBoard(memoId, 200, 200);
        }
    }

    if (loading) return <div className="flex items-center justify-center min-h-screen dark:bg-black dark:text-white"><div className="text-gray-400 text-sm">Loading whiteboard...</div></div>;
    if (overviewMode) {
        return (
            <div className="relative w-full min-h-screen dark:bg-black">
                <WhiteboardTabs
                    boards={boards} activeId={activeBoard} onSelect={switchBoard}
                    onCreate={handleCreateBoard} onRename={handleRenameBoard}
                    onDelete={handleDeleteBoard} onSetParent={handleSetParent} onCreateChild={handleCreateChild}
                    onOpenOverview={openOverview} overviewActive={true}
                />
                <div className="pt-14">
                    <WhiteboardOverview
                        onOpenBoard={openBoardFromOverview}
                        onBoardsMutated={(overviewBoards) => {
                            // Use overview-provided boards (no auto-create) to avoid clobbering
                            // the empty state and to keep tab bar in sync.
                            if (Array.isArray(overviewBoards)) setBoards(overviewBoards);
                        }}
                    />
                </div>
            </div>
        );
    }
    if (!ExcalidrawComp) return <div className="flex items-center justify-center min-h-screen dark:bg-black dark:text-white"><div className="text-gray-400 text-sm">Loading whiteboard component...</div></div>;

    const excalidrawInitialData = boardData ? {
        elements: boardData.elements || [],
        appState: boardData.appState || {},
        files: boardData.files && typeof boardData.files === 'object' && !Array.isArray(boardData.files) ? boardData.files : {},
    } : undefined;

    // Viewport culling for memos
    const padding = 600;
    const visMinX = -viewportTransform.scrollX - padding / viewportTransform.zoom;
    const visMinY = -viewportTransform.scrollY - padding / viewportTransform.zoom;
    const visMaxX = visMinX + (viewportSize.w + padding * 2) / viewportTransform.zoom;
    const visMaxY = visMinY + (viewportSize.h + padding * 2) / viewportTransform.zoom;
    const visiblePlaced = placedMemos.filter(p =>
        p.x + p.width >= visMinX && p.x <= visMaxX && p.y + p.height >= visMinY && p.y <= visMaxY);

    const memosTransform = `translate(${viewportTransform.scrollX * viewportTransform.zoom}px, ${viewportTransform.scrollY * viewportTransform.zoom}px) scale(${viewportTransform.zoom})`;

    const overlayActive = mode === 'section' || mode === 'marquee';

    return (
        <div ref={containerRef}
            style={{ width: '100%', height: 'calc(100vh - 48px)', position: 'relative' }}
            className="lg:!h-[calc(100vh-60px)] max-lg:mt-12"
            onDrop={handleCanvasDrop} onDragOver={handleCanvasDragOver}>

            <ExcalidrawComp
                excalidrawAPI={onExcalidrawAPI}
                initialData={excalidrawInitialData}
                onChange={handleChange}
                UIOptions={{ canvasActions: { loadScene: false, export: false } }}
            />

            {/* sections backdrop layer */}
            <SectionsLayer
                sections={sections}
                viewportTransform={viewportTransform}
                onUpdate={handleUpdateSection}
                onDelete={handleDeleteSection}
                onPointerDownSection={handleSectionPointerDown}
                onResizeSection={handleResizeSection}
                onChangeSectionColor={(id, color) => handleUpdateSection(id, { color })}
                selectedSectionId={selectedSectionId}
            />

            {/* connections layer */}
            <ConnectionsLayer
                connections={connections}
                placedMemos={placedMemos}
                viewportTransform={viewportTransform}
                onClickConnection={handleClickConnection}
                selectedConnId={selectedConnId}
            />

            {tempConnection && (
                <svg className="absolute inset-0 pointer-events-none" style={{ zIndex: 5 }}>
                    <line
                        x1={(tempConnection.fromX + viewportTransform.scrollX) * viewportTransform.zoom}
                        y1={(tempConnection.fromY + viewportTransform.scrollY) * viewportTransform.zoom}
                        x2={(tempConnection.toX + viewportTransform.scrollX) * viewportTransform.zoom}
                        y2={(tempConnection.toY + viewportTransform.scrollY) * viewportTransform.zoom}
                        stroke="#a855f7" strokeWidth={2} strokeDasharray="4 4"
                    />
                </svg>
            )}

            {/* memos layer - single transformed container */}
            <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 6 }}>
                <div style={{
                    position: 'absolute', left: 0, top: 0, width: 0, height: 0,
                    transform: memosTransform, transformOrigin: '0 0',
                    willChange: 'transform',
                }}>
                    {visiblePlaced.map(pm => (
                        <MemoCardOverlay
                            key={pm.placementId}
                            placement={pm}
                            isDark={isDark}
                            isSelected={selectedIds.has(pm.placementId) || pm.placementId === highlightPlacementId}
                            isConnectSource={connectFrom === pm.memo.id}
                            mode={mode}
                            onPointerDown={handleMemoPointerDown}
                            onContextMenu={handleMemoContextMenu}
                            onStartEdgeConnection={handleStartEdgeConnection}
                        />
                    ))}
                </div>
            </div>

            {/* draw overlay for marquee / section creation */}
            {overlayActive && (
                <div className="absolute inset-0" style={{ zIndex: 8, cursor: mode === 'section' ? 'crosshair' : 'default' }}
                    onPointerDown={startOverlayDraw}>
                    {(marquee || drawingSection) && (() => {
                        const r = marquee || drawingSection;
                        return (
                            <div style={{
                                position: 'absolute',
                                left: (r.x + viewportTransform.scrollX) * viewportTransform.zoom,
                                top: (r.y + viewportTransform.scrollY) * viewportTransform.zoom,
                                width: r.w * viewportTransform.zoom, height: r.h * viewportTransform.zoom,
                                border: drawingSection ? '2px dashed #3b82f6' : '1px dashed #3b82f6',
                                background: drawingSection ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.10)',
                                pointerEvents: 'none',
                            }} />
                        );
                    })()}
                </div>
            )}

            <WhiteboardTabs
                boards={boards} activeId={activeBoard} onSelect={switchBoard}
                onCreate={handleCreateBoard} onRename={handleRenameBoard}
                onDelete={handleDeleteBoard} onSetParent={handleSetParent} onCreateChild={handleCreateChild}
                onOpenOverview={openOverview} overviewActive={false}
            />

            <MemoSidebar
                allMemos={allMemos}
                onAddMemo={(memoId) => handleAddMemoToBoard(memoId)}
                onCreateMemo={async ({ title, content }) => {
                    const created = await createMemo({ title, content, color: 'white', tags: [] });
                    setAllMemos(prev => [created, ...prev]);
                    await handleAddMemoToBoard(created.id);
                }}
                show={showSidebar}
                onToggle={() => setShowSidebar(!showSidebar)}
            />

            {/* Mode toolbar (left side, below tabs) */}
            <div className="absolute top-14 left-2 z-20 flex flex-col gap-1 bg-white/90 dark:bg-gray-800/90 border border-gray-200 dark:border-gray-700 rounded-lg shadow-md p-1">
                {[
                    { k: 'select', icon: 'fa-arrow-pointer', t: 'Select / drag' },
                    { k: 'connect', icon: 'fa-link', t: 'Connect cards' },
                    { k: 'section', icon: 'fa-vector-square', t: 'Draw section' },
                    { k: 'marquee', icon: 'fa-object-group', t: 'Marquee select' },
                ].map(opt => (
                    <button key={opt.k} onClick={() => { setMode(opt.k); setConnectFrom(null); }}
                        title={opt.t}
                        className={`w-7 h-7 rounded-md flex items-center justify-center cursor-pointer transition ${mode === opt.k ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                        <i className={`fa-solid ${opt.icon} text-[11px]`} />
                    </button>
                ))}
                <div className="border-t border-gray-200 dark:border-gray-700 my-0.5" />
                <button onClick={() => setSpotlightOpen(true)} title="Search (⌘K)"
                    className="w-7 h-7 rounded-md flex items-center justify-center cursor-pointer text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
                    <i className="fa-solid fa-magnifying-glass text-[11px]" />
                </button>
                <div className="relative">
                    <button onClick={() => setTemplatesMenuOpen(o => !o)}
                        title="Insert thinking template"
                        className={`w-7 h-7 rounded-md flex items-center justify-center cursor-pointer transition ${templatesMenuOpen ? 'bg-purple-500 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                        <i className="fa-solid fa-shapes text-[11px]" />
                    </button>
                    {templatesMenuOpen && (
                        <>
                            <div className="fixed inset-0 z-20" onClick={() => setTemplatesMenuOpen(false)} />
                            <div className="absolute left-9 top-0 z-30 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-1">
                                <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 px-2 pt-1.5 pb-1 uppercase tracking-wide">
                                    Insert thinking template
                                </div>
                                {THINKING_TEMPLATES.map(t => (
                                    <button key={t.key}
                                        onClick={() => insertThinkingTemplate(t.key)}
                                        className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-200 flex items-start gap-2">
                                        <i className={`fa-solid ${t.icon} w-3 mt-0.5 text-center text-gray-500`} />
                                        <span className="flex-1 min-w-0">
                                            <span className="block font-medium">{t.label}</span>
                                            <span className="block text-[10px] text-gray-500 dark:text-gray-400">{t.desc}</span>
                                        </span>
                                    </button>
                                ))}
                                <div className="text-[10px] text-gray-400 dark:text-gray-500 px-2 pt-1 pb-1.5">
                                    Drops at current view centre.
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {mode === 'connect' && (
                <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 px-3 py-1 bg-purple-500 text-white text-xs rounded-full shadow">
                    {connectFrom ? 'Click target card to connect' : 'Connect mode: click a source card'} · ESC to exit
                </div>
            )}
            {mode === 'section' && (
                <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 px-3 py-1 bg-blue-500 text-white text-xs rounded-full shadow">
                    Drag on canvas to draw a section · ESC to exit
                </div>
            )}
            {mode === 'marquee' && (
                <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 px-3 py-1 bg-blue-500 text-white text-xs rounded-full shadow">
                    Drag to select multiple cards · ESC to exit
                </div>
            )}

            <button onClick={openQuickCreate}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2.5 rounded-full bg-black dark:bg-white text-white dark:text-black shadow-lg hover:opacity-80 transition cursor-pointer font-medium text-sm"
                title="Quick create memo">
                <i className="fa-solid fa-plus" /><span>New Memo</span>
            </button>

            {selectedIds.size >= 2 && (
                <BulkActionBar
                    count={selectedIds.size}
                    onDelete={handleBulkDelete}
                    onMove={handleBulkMove}
                    boards={boards}
                    currentBoardId={activeBoard}
                />
            )}

            {quickCreate && <QuickMemoForm onSave={handleQuickSave} onCancel={() => setQuickCreate(null)} />}

            {editingMemo && (
                <SidePanel
                    memo={editingMemo}
                    memoTitles={memoTitles}
                    onClose={() => setEditingMemo(null)}
                    onSaveDirect={async (id, data) => await handleEditMemo(id, data)}
                    onDeleteMemo={async (id) => {
                        if (!window.confirm('Delete this memo permanently? This removes it from all boards.')) return;
                        try { await deleteMemo(id); } catch (e) { console.error(e); }
                        setPlacedMemos(prev => prev.filter(p => p.memo.id !== id));
                        setAllMemos(prev => prev.filter(m => m.id !== id));
                        setEditingMemo(null);
                        if (activeBoard) getWhiteboardConnections(activeBoard).then(setConnections).catch(() => {});
                    }}
                    onLinkClick={(idOrTitle) => {
                        setEditingMemo(null);
                        if (typeof idOrTitle === 'number') jumpFromLink(idOrTitle);
                        else {
                            const m = allMemos.find(x => x.title === idOrTitle);
                            if (m) jumpFromLink(m.id);
                        }
                    }}
                />
            )}

            {spotlightOpen && (
                <Spotlight
                    allMemos={allMemos}
                    placedMemos={placedMemos}
                    onJumpTo={jumpToPlacement}
                    onClose={() => setSpotlightOpen(false)}
                    onOpenInOtherBoard={(memoId) => jumpFromLink(memoId)}
                />
            )}
        </div>
    );
}
