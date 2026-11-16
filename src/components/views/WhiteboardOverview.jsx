import React, { useEffect, useMemo, useState, useRef } from 'react';
import { getWhiteboardsOverview, createWhiteboard, updateWhiteboard, deleteWhiteboard } from '../../scripts/api.js';

const RECENTS_KEY_BASE = 'whiteboard_recents_v1';
const MAX_RECENTS = 12;

function recentsKey() {
    let uid = '';
    try {
        uid = localStorage.getItem('uid') || localStorage.getItem('userId')
            || sessionStorage.getItem('uid') || '';
    } catch {}
    return uid ? `${RECENTS_KEY_BASE}:${uid}` : RECENTS_KEY_BASE;
}

export function recordBoardOpened(boardId) {
    if (!boardId) return;
    try {
        const k = recentsKey();
        const raw = localStorage.getItem(k);
        const list = raw ? JSON.parse(raw) : [];
        const filtered = list.filter(e => e.id !== boardId);
        filtered.unshift({ id: boardId, ts: Date.now() });
        localStorage.setItem(k, JSON.stringify(filtered.slice(0, MAX_RECENTS)));
    } catch {}
}

function getRecents() {
    try {
        const raw = localStorage.getItem(recentsKey());
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

const SECTION_THUMB_COLORS = {
    blue: 'rgba(59,130,246,0.25)', green: 'rgba(34,197,94,0.25)',
    yellow: 'rgba(234,179,8,0.30)', pink: 'rgba(236,72,153,0.25)',
    purple: 'rgba(168,85,247,0.25)', gray: 'rgba(156,163,175,0.30)',
};

const MEMO_THUMB_COLORS = {
    white: '#ffffff', yellow: '#fde68a', green: '#bbf7d0', blue: '#bfdbfe',
    pink: '#fbcfe8', purple: '#e9d5ff', orange: '#fed7aa',
};

function formatRelative(ts) {
    if (!ts) return '';
    const d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
    if (diff < 7 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`;
    return d.toLocaleDateString();
}

function BoardThumbnail({ snapshot, width = 240, height = 140 }) {
    const items = [...(snapshot?.sections || []), ...(snapshot?.memos || [])];
    if (items.length === 0) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-gray-50 dark:bg-gray-900 border border-dashed border-gray-200 dark:border-gray-700 rounded text-[10px] text-gray-400 italic">
                empty board
            </div>
        );
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of items) {
        minX = Math.min(minX, it.x);
        minY = Math.min(minY, it.y);
        maxX = Math.max(maxX, it.x + (it.w || it.width || 100));
        maxY = Math.max(maxY, it.y + (it.h || it.height || 100));
    }
    const w = Math.max(maxX - minX, 100);
    const h = Math.max(maxY - minY, 100);
    const pad = 0.05;
    const scale = Math.min(width / (w * (1 + pad * 2)), height / (h * (1 + pad * 2)));
    const offsetX = (width - w * scale) / 2 - minX * scale;
    const offsetY = (height - h * scale) / 2 - minY * scale;
    function tx(x) { return x * scale + offsetX; }
    function ty(y) { return y * scale + offsetY; }
    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
            style={{ background: '#fafafa', borderRadius: 4 }}
            className="dark:!bg-gray-900">
            {(snapshot.sections || []).map((s, i) => (
                <rect key={`s${i}`} x={tx(s.x)} y={ty(s.y)} width={Math.max(s.w * scale, 2)} height={Math.max(s.h * scale, 2)}
                    fill={SECTION_THUMB_COLORS[s.color] || SECTION_THUMB_COLORS.blue}
                    stroke="rgba(0,0,0,0.15)" strokeDasharray="2 2" strokeWidth={0.5} rx={2} />
            ))}
            {(snapshot.connections || []).map((c, i) => (
                <line key={`c${i}`} x1={tx(c.x1)} y1={ty(c.y1)} x2={tx(c.x2)} y2={ty(c.y2)}
                    stroke="#9ca3af" strokeWidth={0.7} opacity={0.7} />
            ))}
            {(snapshot.memos || []).map((m, i) => (
                <rect key={`m${i}`} x={tx(m.x)} y={ty(m.y)} width={Math.max(m.w * scale, 2)} height={Math.max(m.h * scale, 2)}
                    fill={MEMO_THUMB_COLORS[m.color] || '#ffffff'} stroke="rgba(0,0,0,0.2)" strokeWidth={0.5} rx={1.5} />
            ))}
        </svg>
    );
}

function BoardCard({ board, onOpen, onRename, onDelete, onAddChild }) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(board.name);
    function commit() {
        const trimmed = (name || '').trim();
        if (trimmed && trimmed !== board.name) onRename(board.id, trimmed);
        else setName(board.name);
        setEditing(false);
    }
    return (
        <div className="group bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 shadow-sm hover:shadow-md transition flex flex-col gap-2">
            <button onClick={() => onOpen(board.id)} className="block text-left cursor-pointer" title="Open board">
                <div className="rounded overflow-hidden border border-gray-100 dark:border-gray-700">
                    <BoardThumbnail snapshot={board.snapshot} width={240} height={140} />
                </div>
            </button>
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    {editing ? (
                        <input value={name} onChange={e => setName(e.target.value)} onBlur={commit}
                            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setName(board.name); setEditing(false); } }}
                            autoFocus className="w-full text-sm font-semibold bg-transparent focus:outline-none border-b border-blue-400 dark:text-white" />
                    ) : (
                        <button onClick={() => onOpen(board.id)} className="text-sm font-semibold truncate text-left dark:text-white hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer block w-full">
                            {board.name || 'Untitled'}
                        </button>
                    )}
                    <p className="text-[10px] text-gray-400 mt-0.5">
                        {board.memoCount}m · {board.sectionCount}s · {board.connectionCount}c
                        {board.updatedAt && <> · {formatRelative(board.updatedAt)}</>}
                    </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button onClick={() => setEditing(true)} title="Rename"
                        className="w-6 h-6 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer">
                        <i className="fa-solid fa-pen text-[10px]" />
                    </button>
                    <button onClick={() => onAddChild(board.id)} title="Add sub-board"
                        className="w-6 h-6 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer">
                        <i className="fa-solid fa-plus text-[10px]" />
                    </button>
                    <button onClick={() => onDelete(board.id)} title="Delete"
                        className="w-6 h-6 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 cursor-pointer">
                        <i className="fa-solid fa-trash text-[10px]" />
                    </button>
                </div>
            </div>
        </div>
    );
}

function HierarchyTree({ boards, onOpen, onRename, onDelete, onAddChild }) {
    const childrenMap = useMemo(() => {
        const m = {};
        for (const b of boards) {
            const k = b.parentId || 'root';
            if (!m[k]) m[k] = [];
            m[k].push(b);
        }
        return m;
    }, [boards]);
    const [collapsed, setCollapsed] = useState(() => new Set());

    function Node({ board, depth }) {
        const kids = childrenMap[board.id] || [];
        const isCollapsed = collapsed.has(board.id);
        return (
            <div>
                <div className="group flex items-center gap-1 py-1 hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-1" style={{ paddingLeft: depth * 18 + 4 }}>
                    {kids.length > 0 ? (
                        <button onClick={() => setCollapsed(s => { const n = new Set(s); n.has(board.id) ? n.delete(board.id) : n.add(board.id); return n; })}
                            className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-700 cursor-pointer">
                            <i className={`fa-solid ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down'} text-[9px]`} />
                        </button>
                    ) : <span className="w-4" />}
                    <button onClick={() => onOpen(board.id)}
                        className="text-sm dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer truncate flex-1 text-left">
                        {board.name || 'Untitled'}
                        <span className="text-[10px] text-gray-400 ml-2">{board.memoCount}m</span>
                    </button>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                        <button onClick={() => onAddChild(board.id)} title="Add sub-board"
                            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-1 cursor-pointer"><i className="fa-solid fa-plus text-[10px]" /></button>
                        <button onClick={() => { const name = window.prompt('Rename board:', board.name); if (name && name.trim()) onRename(board.id, name.trim()); }} title="Rename"
                            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-1 cursor-pointer"><i className="fa-solid fa-pen text-[10px]" /></button>
                        <button onClick={() => onDelete(board.id)} title="Delete"
                            className="text-gray-400 hover:text-red-500 px-1 cursor-pointer"><i className="fa-solid fa-trash text-[10px]" /></button>
                    </div>
                </div>
                {!isCollapsed && kids.map(k => <Node key={k.id} board={k} depth={depth + 1} />)}
            </div>
        );
    }

    const roots = childrenMap['root'] || [];
    if (roots.length === 0) return <p className="text-xs text-gray-400 italic">No boards.</p>;
    return <div>{roots.map(r => <Node key={r.id} board={r} depth={0} />)}</div>;
}

function StatsTable({ boards, onOpen }) {
    const [sortKey, setSortKey] = useState('updatedAt');
    const [sortDir, setSortDir] = useState('desc');
    const sorted = useMemo(() => {
        const list = [...boards];
        list.sort((a, b) => {
            let av = a[sortKey], bv = b[sortKey];
            if (sortKey === 'updatedAt') { av = new Date(av || 0).getTime(); bv = new Date(bv || 0).getTime(); }
            if (sortKey === 'name') { av = (av || '').toLowerCase(); bv = (bv || '').toLowerCase(); }
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
        return list;
    }, [boards, sortKey, sortDir]);

    function clickHeader(key) {
        if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
    }
    function HeaderCell({ k, label, align }) {
        const active = sortKey === k;
        return (
            <th onClick={() => clickHeader(k)}
                className={`px-3 py-2 cursor-pointer select-none text-[11px] font-semibold text-gray-500 dark:text-gray-400 ${align || 'text-left'} ${active ? 'text-gray-900 dark:text-white' : ''}`}>
                {label} {active && <i className={`fa-solid ${sortDir === 'asc' ? 'fa-arrow-up' : 'fa-arrow-down'} text-[8px] ml-1`} />}
            </th>
        );
    }
    return (
        <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
            <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                        <HeaderCell k="name" label="Name" />
                        <HeaderCell k="memoCount" label="Memos" align="text-right" />
                        <HeaderCell k="sectionCount" label="Sections" align="text-right" />
                        <HeaderCell k="connectionCount" label="Connections" align="text-right" />
                        <HeaderCell k="updatedAt" label="Updated" />
                    </tr>
                </thead>
                <tbody>
                    {sorted.map(b => (
                        <tr key={b.id} className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                            <td className="px-3 py-1.5">
                                <button onClick={() => onOpen(b.id)} className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer text-left truncate">
                                    {b.name || 'Untitled'}
                                </button>
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{b.memoCount}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{b.sectionCount}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{b.connectionCount}</td>
                            <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 text-xs">{formatRelative(b.updatedAt)}</td>
                        </tr>
                    ))}
                    {sorted.length === 0 && (
                        <tr><td colSpan={5} className="px-3 py-4 text-center text-xs text-gray-400 italic">No boards match.</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

function BoardGraph({ boards, crossLinks, onOpen }) {
    const width = 720, height = 380;
    const layout = useMemo(() => {
        // Simple force-ish layout via radial / random + a few iterations
        const n = boards.length;
        if (n === 0) return [];
        const nodes = boards.map((b, i) => {
            const angle = (i / Math.max(n, 1)) * Math.PI * 2;
            const r = Math.min(width, height) * 0.32;
            return { id: b.id, name: b.name, x: width / 2 + Math.cos(angle) * r, y: height / 2 + Math.sin(angle) * r, weight: b.memoCount + 1 };
        });
        const idMap = {};
        nodes.forEach(n => { idMap[n.id] = n; });
        const parentEdges = boards.filter(b => b.parentId && idMap[b.parentId])
            .map(b => ({ a: b.parentId, b: b.id, kind: 'parent' }));
        const linkEdges = (crossLinks || []).filter(l => idMap[l.fromBoardId] && idMap[l.toBoardId])
            .map(l => ({ a: l.fromBoardId, b: l.toBoardId, kind: 'link' }));
        const edges = [...parentEdges, ...linkEdges];
        // 60 quick iterations of force layout
        for (let it = 0; it < 60; it++) {
            // repulsion
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const a = nodes[i], b = nodes[j];
                    const dx = a.x - b.x, dy = a.y - b.y;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
                    const force = 800 / (dist * dist);
                    a.x += (dx / dist) * force; a.y += (dy / dist) * force;
                    b.x -= (dx / dist) * force; b.y -= (dy / dist) * force;
                }
            }
            // attraction along edges
            for (const e of edges) {
                const a = idMap[e.a], b = idMap[e.b];
                const dx = b.x - a.x, dy = b.y - a.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
                const target = e.kind === 'parent' ? 90 : 130;
                const force = (dist - target) * 0.04;
                a.x += (dx / dist) * force; a.y += (dy / dist) * force;
                b.x -= (dx / dist) * force; b.y -= (dy / dist) * force;
            }
            // pull toward center
            for (const n of nodes) {
                n.x += (width / 2 - n.x) * 0.005;
                n.y += (height / 2 - n.y) * 0.005;
                n.x = Math.max(30, Math.min(width - 30, n.x));
                n.y = Math.max(20, Math.min(height - 20, n.y));
            }
        }
        return { nodes, edges };
    }, [boards, crossLinks]);

    if (!layout.nodes || layout.nodes.length === 0) {
        return <p className="text-xs text-gray-400 italic">No boards to graph.</p>;
    }

    return (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-gray-50 dark:bg-gray-900">
            <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
                <defs>
                    <marker id="ov-arrow-link" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#a855f7" />
                    </marker>
                </defs>
                {layout.edges.map((e, i) => {
                    const a = layout.nodes.find(n => n.id === e.a);
                    const b = layout.nodes.find(n => n.id === e.b);
                    if (!a || !b) return null;
                    const isParent = e.kind === 'parent';
                    return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                        stroke={isParent ? '#9ca3af' : '#a855f7'}
                        strokeWidth={isParent ? 1.4 : 1.2}
                        strokeDasharray={isParent ? undefined : '4 3'}
                        markerEnd={isParent ? undefined : 'url(#ov-arrow-link)'}
                        opacity={0.7} />;
                })}
                {layout.nodes.map(n => {
                    const r = 14 + Math.min(Math.sqrt(n.weight) * 2, 12);
                    return (
                        <g key={n.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(n.id)}>
                            <circle cx={n.x} cy={n.y} r={r} fill="#3b82f6" stroke="white" strokeWidth={1.5} />
                            <text x={n.x} y={n.y + r + 12} textAnchor="middle" fontSize="11" fill="#374151" className="dark:!fill-gray-200">
                                {(n.name || 'Untitled').length > 16 ? (n.name || '').slice(0, 16) + '…' : (n.name || 'Untitled')}
                            </text>
                        </g>
                    );
                })}
            </svg>
            <p className="text-[10px] text-gray-400 px-3 py-1.5 border-t border-gray-200 dark:border-gray-700">
                <span className="inline-block w-3 h-px bg-gray-400 align-middle mr-1" />parent · 
                <span className="inline-block w-3 h-px bg-purple-500 align-middle mx-1" style={{ borderTop: '1px dashed #a855f7' }} />memo link
            </p>
        </div>
    );
}

function GraphFallbackList({ boards, crossLinks, onOpen }) {
    return (
        <div className="space-y-2 text-xs">
            {boards.map(b => {
                const parent = boards.find(x => x.id === b.parentId);
                const linksOut = (crossLinks || []).filter(l => l.fromBoardId === b.id)
                    .map(l => boards.find(x => x.id === l.toBoardId)?.name).filter(Boolean);
                return (
                    <div key={b.id} className="border border-gray-200 dark:border-gray-700 rounded p-2">
                        <button onClick={() => onOpen(b.id)} className="font-semibold text-blue-600 dark:text-blue-400 cursor-pointer">{b.name || 'Untitled'}</button>
                        {parent && <p className="text-gray-500 mt-1">↑ parent: {parent.name}</p>}
                        {linksOut.length > 0 && <p className="text-purple-500 mt-1">→ links: {linksOut.join(', ')}</p>}
                    </div>
                );
            })}
        </div>
    );
}

export default function WhiteboardOverview({ onOpenBoard, onBoardsMutated }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [gridSort, setGridSort] = useState('updated');
    const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 640);

    useEffect(() => {
        function onResize() { setIsMobile(window.innerWidth < 640); }
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    async function refresh() {
        setLoading(true);
        try {
            const d = await getWhiteboardsOverview();
            setData(d);
            setError(null);
            if (onBoardsMutated) onBoardsMutated(d.boards || []);
        } catch (e) {
            setError(e.message || 'Failed to load overview');
        }
        setLoading(false);
    }

    useEffect(() => { refresh(); }, []);

    const boards = (data && data.boards) || [];
    const crossLinks = (data && data.crossLinks) || [];
    const q = search.trim().toLowerCase();
    const filteredBoards = useMemo(() => (
        q ? boards.filter(b => (b.name || '').toLowerCase().includes(q)) : boards
    ), [boards, q]);
    // Tree includes ancestor chains of matched boards so paths stay connected.
    const treeBoards = useMemo(() => {
        if (!q) return boards;
        const byId = {};
        boards.forEach(b => { byId[b.id] = b; });
        const keep = new Set();
        for (const b of filteredBoards) {
            let cur = b;
            while (cur && !keep.has(cur.id)) {
                keep.add(cur.id);
                cur = cur.parentId ? byId[cur.parentId] : null;
            }
        }
        return boards.filter(b => keep.has(b.id));
    }, [boards, filteredBoards, q]);
    const sortedGrid = useMemo(() => {
        const arr = [...filteredBoards];
        arr.sort((a, b) => {
            if (gridSort === 'name') return (a.name || '').localeCompare(b.name || '');
            if (gridSort === 'memos') return b.memoCount - a.memoCount;
            return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
        });
        return arr;
    }, [filteredBoards, gridSort]);
    const recents = useMemo(() => (
        getRecents()
            .map(r => ({ ...r, board: filteredBoards.find(b => b.id === r.id) }))
            .filter(r => r.board)
            .slice(0, 8)
    ), [filteredBoards, data]);

    function handleOpen(id) {
        recordBoardOpened(id);
        onOpenBoard(id);
    }

    async function handleCreateRoot() {
        const name = window.prompt('Name for new whiteboard:', 'Untitled');
        if (!name) return;
        try {
            const created = await createWhiteboard(name.trim() || 'Untitled');
            await refresh();
            handleOpen(created.id);
        } catch (e) { alert('Failed to create board'); }
    }
    async function handleRename(id, name) {
        try { await updateWhiteboard(id, { name }); await refresh(); } catch { alert('Rename failed'); }
    }
    async function handleDelete(id) {
        if (!window.confirm('Delete this whiteboard? Memos remain in your library.')) return;
        try { await deleteWhiteboard(id); await refresh(); } catch { alert('Delete failed'); }
    }
    async function handleAddChild(parentId) {
        const name = window.prompt('Name for sub-board:', 'Untitled');
        if (!name) return;
        try {
            const created = await createWhiteboard(name.trim() || 'Untitled', parentId);
            await refresh();
            handleOpen(created.id);
        } catch { alert('Create failed'); }
    }

    if (loading) {
        return (
            <div className="p-6 max-w-7xl mx-auto">
                <div className="animate-pulse space-y-4">
                    <div className="h-8 w-40 bg-gray-200 dark:bg-gray-800 rounded" />
                    <div className="grid grid-cols-3 gap-4">
                        {[...Array(6)].map((_, i) => <div key={i} className="h-48 bg-gray-100 dark:bg-gray-800 rounded-xl" />)}
                    </div>
                </div>
            </div>
        );
    }
    if (error) return <div className="p-6 text-sm text-red-500">Error: {error}</div>;
    if (!data) return null;

    if (boards.length === 0) {
        return (
            <div className="p-10 max-w-2xl mx-auto text-center">
                <i className="fa-solid fa-paintbrush text-5xl text-gray-300 dark:text-gray-700 mb-4" />
                <h2 className="text-xl font-bold dark:text-white mb-2">No whiteboards yet</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Create your first whiteboard to lay out and connect memos visually.</p>
                <button onClick={handleCreateRoot}
                    className="px-5 py-2.5 rounded-lg bg-black dark:bg-white text-white dark:text-black text-sm font-semibold hover:opacity-80 cursor-pointer">
                    <i className="fa-solid fa-plus mr-2" />Create your first whiteboard
                </button>
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 max-w-7xl mx-auto pb-20 dark:text-white overflow-y-auto" style={{ maxHeight: 'calc(100vh - 60px)' }}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight">Whiteboard Overview</h1>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{boards.length} board{boards.length === 1 ? '' : 's'} · {boards.reduce((s, b) => s + b.memoCount, 0)} memos placed</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search boards…"
                        className="text-sm px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-blue-400 placeholder-gray-400 w-44" />
                    <button onClick={handleCreateRoot} className="px-3 py-2 rounded-lg bg-black dark:bg-white text-white dark:text-black text-xs font-semibold hover:opacity-80 cursor-pointer">
                        <i className="fa-solid fa-plus mr-1.5" />New board
                    </button>
                </div>
            </div>

            {recents.length > 0 && (
                <section className="mb-8">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Recently opened</h2>
                    <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                        {recents.map(r => (
                            <button key={r.id} onClick={() => handleOpen(r.id)}
                                className="flex-shrink-0 w-44 text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2 hover:shadow-md transition cursor-pointer">
                                <div className="rounded overflow-hidden border border-gray-100 dark:border-gray-700">
                                    <BoardThumbnail snapshot={r.board.snapshot} width={170} height={90} />
                                </div>
                                <p className="text-xs font-semibold mt-1.5 truncate dark:text-white">{r.board.name || 'Untitled'}</p>
                                <p className="text-[10px] text-gray-400">opened {formatRelative(r.ts)}</p>
                            </button>
                        ))}
                    </div>
                </section>
            )}

            <section className="mb-8">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">All boards</h2>
                    <div className="flex items-center gap-1 text-[11px]">
                        <span className="text-gray-400">Sort:</span>
                        {[['updated', 'Updated'], ['name', 'Name'], ['memos', 'Memos']].map(([k, l]) => (
                            <button key={k} onClick={() => setGridSort(k)}
                                className={`px-2 py-0.5 rounded cursor-pointer ${gridSort === k ? 'bg-black text-white dark:bg-white dark:text-black' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                                {l}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {sortedGrid.map(b => (
                        <BoardCard key={b.id} board={b} onOpen={handleOpen}
                            onRename={handleRename} onDelete={handleDelete} onAddChild={handleAddChild} />
                    ))}
                    {sortedGrid.length === 0 && (
                        <p className="col-span-full text-xs text-gray-400 italic text-center py-6">No boards match "{search}".</p>
                    )}
                </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <section>
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Hierarchy</h2>
                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2">
                        <HierarchyTree boards={treeBoards} onOpen={handleOpen}
                            onRename={handleRename} onDelete={handleDelete} onAddChild={handleAddChild} />
                    </div>
                </section>
                <section>
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Stats</h2>
                    <StatsTable boards={filteredBoards} onOpen={handleOpen} />
                </section>
            </div>

            <section className="mb-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Board graph</h2>
                {isMobile
                    ? <GraphFallbackList boards={filteredBoards} crossLinks={crossLinks} onOpen={handleOpen} />
                    : <BoardGraph boards={filteredBoards} crossLinks={crossLinks} onOpen={handleOpen} />}
            </section>
        </div>
    );
}
