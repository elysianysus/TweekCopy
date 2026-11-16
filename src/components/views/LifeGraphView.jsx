import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getMilestones, createMilestone, updateMilestone, deleteMilestone, getLifeActivity, getMemoGraph, getGraphConnections, createGraphConnection, deleteGraphConnection } from '../../scripts/api.js';

const MILESTONE_COLORS = [
  { key: 'blue', bg: 'bg-blue-500', hex: '#3b82f6' },
  { key: 'green', bg: 'bg-green-500', hex: '#22c55e' },
  { key: 'purple', bg: 'bg-purple-500', hex: '#a855f7' },
  { key: 'red', bg: 'bg-red-500', hex: '#ef4444' },
  { key: 'yellow', bg: 'bg-yellow-500', hex: '#eab308' },
  { key: 'pink', bg: 'bg-pink-500', hex: '#ec4899' },
  { key: 'indigo', bg: 'bg-indigo-500', hex: '#6366f1' },
  { key: 'teal', bg: 'bg-teal-500', hex: '#14b8a6' },
];

const MILESTONE_ICONS = [
  'fa-solid fa-star', 'fa-solid fa-graduation-cap', 'fa-solid fa-briefcase',
  'fa-solid fa-rocket', 'fa-solid fa-trophy', 'fa-solid fa-heart',
  'fa-solid fa-flag', 'fa-solid fa-bolt', 'fa-solid fa-gem',
  'fa-solid fa-code', 'fa-solid fa-plane', 'fa-solid fa-house',
  'fa-solid fa-book', 'fa-solid fa-lightbulb', 'fa-solid fa-music',
  'fa-solid fa-certificate',
];

const CONNECTION_COLORS = ['#6b7280', '#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#eab308', '#ec4899', '#14b8a6'];

const LANE_CONFIG = {
  milestone: { label: 'Milestones', color: '#a855f7', icon: 'fa-solid fa-flag' },
  memo: { label: 'Memos', color: '#3b82f6', icon: 'fa-solid fa-note-sticky' },
  task: { label: 'Tasks', color: '#22c55e', icon: 'fa-solid fa-check-circle' },
};

const TRACK_TYPES = ['milestone', 'memo', 'task'];
const HEADER_WIDTH = 100;
const RULER_HEIGHT = 22;
const TRACK_GAP = 1;
const YEAR_WIDTH = 300;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 3;
const NODE_WIDTH = 140;
const NODE_HEIGHT = 36;

function dateToX(dateStr, startYear) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  const yr = d.getFullYear();
  const start = new Date(yr, 0, 1);
  const end = new Date(yr + 1, 0, 1);
  const frac = (d - start) / (end - start);
  return (yr - startYear + frac) * YEAR_WIDTH;
}

function getNodeKey(type, id) {
  return `${type}_${id}`;
}

function MilestoneForm({ milestone, onSave, onCancel, onDelete }) {
  const [title, setTitle] = useState(milestone?.title || '');
  const [date, setDate] = useState(milestone?.date || new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(milestone?.endDate || '');
  const [color, setColor] = useState(milestone?.color || 'blue');
  const [icon, setIcon] = useState(milestone?.icon || 'fa-solid fa-star');
  const [notes, setNotes] = useState(milestone?.notes || '');

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ title: title.trim(), date, endDate: endDate || null, color, icon, notes });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4 dark:text-white">{milestone ? 'Edit Milestone' : 'New Milestone'}</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Milestone title..."
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:border-blue-400" autoFocus />
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Start Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">End Date <span className="text-gray-300 dark:text-gray-600">(optional)</span></label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} min={date}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:border-blue-400" />
            </div>
          </div>
          {endDate && (
            <div className="flex items-center gap-2 text-[10px] text-gray-400">
              <i className="fa-solid fa-calendar-days" />
              <span>
                {(() => {
                  const d1 = new Date(date), d2 = new Date(endDate);
                  const days = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
                  if (days < 0) return 'End date must be after start';
                  if (days === 0) return 'Single day';
                  if (days < 30) return `${days} days`;
                  if (days < 365) return `${Math.round(days / 30)} months (${days} days)`;
                  return `${(days / 365).toFixed(1)} years (${days} days)`;
                })()}
              </span>
              <button type="button" onClick={() => setEndDate('')} className="ml-auto text-gray-400 hover:text-red-400 transition">
                <i className="fa-solid fa-xmark text-[9px]" /> Clear end date
              </button>
            </div>
          )}
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Color</label>
            <div className="flex gap-1.5 flex-wrap">
              {MILESTONE_COLORS.map(c => (
                <button key={c.key} type="button" onClick={() => setColor(c.key)}
                  className={`w-7 h-7 rounded-full ${c.bg} transition ${color === c.key ? 'ring-2 ring-offset-2 ring-blue-500 dark:ring-offset-gray-900' : 'opacity-60 hover:opacity-100'}`} />
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Icon</label>
            <div className="flex gap-1.5 flex-wrap">
              {MILESTONE_ICONS.map(ic => (
                <button key={ic} type="button" onClick={() => setIcon(ic)}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition text-sm ${icon === ic ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
                  <i className={ic} />
                </button>
              ))}
            </div>
          </div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:border-blue-400 resize-none" />
          <div className="flex gap-2 pt-1">
            <button type="submit" className="flex-1 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition">
              {milestone ? 'Save' : 'Create'}
            </button>
            <button type="button" onClick={onCancel} className="px-4 py-2 text-gray-500 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition">Cancel</button>
            {milestone && onDelete && (
              <button type="button" onClick={() => onDelete(milestone.id)} className="px-4 py-2 text-red-500 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition">Delete</button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function TimelineTrack({ type, config, items, trackState, onUpdateState, trackHeight, startYear, endYear, isDark, connectMode, connectSource, onNodeClick }) {
  const containerRef = useRef(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ clientX: 0, panX: 0 });
  const onUpdateRef = useRef(onUpdateState);
  onUpdateRef.current = onUpdateState;
  const { zoom, panX } = trackState;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      onUpdateRef.current(prev => {
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.zoom * delta));
        const ratio = newZoom / prev.zoom;
        return { zoom: newZoom, panX: mx - (mx - prev.panX) * ratio };
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  function handlePointerDown(e) {
    if (connectMode) return;
    if (e.button !== 0) return;
    const tag = e.target.tagName?.toLowerCase();
    if (e.target.closest?.('.cursor-pointer') || e.target.classList?.contains('cursor-pointer')) return;
    if (tag === 'foreignobject' || e.target.closest?.('foreignObject')) return;
    setIsPanning(true);
    panStartRef.current = { clientX: e.clientX, panX };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e) {
    if (!isPanning) return;
    const dx = e.clientX - panStartRef.current.clientX;
    onUpdateState({ panX: panStartRef.current.panX + dx });
  }

  function handlePointerUp() {
    setIsPanning(false);
  }

  function handlePointerCancel() {
    setIsPanning(false);
  }

  const containerWidth = containerRef.current?.clientWidth || 800;
  const centerY = RULER_HEIGHT + (trackHeight - RULER_HEIGHT) / 2;

  const visStartYear = Math.max(startYear, Math.floor(-panX / (YEAR_WIDTH * zoom)) + startYear - 1);
  const visEndYear = Math.min(endYear, Math.ceil((containerWidth - panX) / (YEAR_WIDTH * zoom)) + startYear + 1);

  const todayScreenX = dateToX(new Date().toISOString().split('T')[0], startYear) * zoom + panX;

  return (
    <div className="flex" style={{ height: trackHeight, minHeight: 0 }}>
      <div
        className="flex-shrink-0 flex flex-col items-center justify-center border-r"
        style={{
          width: HEADER_WIDTH,
          borderColor: isDark ? 'rgba(55,65,81,0.5)' : 'rgba(229,231,235,0.8)',
          background: isDark ? 'rgba(15,23,42,0.6)' : 'rgba(255,255,255,0.6)',
        }}
      >
        <div className="w-7 h-7 rounded-lg flex items-center justify-center mb-0.5" style={{ backgroundColor: config.color + '18' }}>
          <i className={config.icon} style={{ color: config.color, fontSize: 13 }} />
        </div>
        <span className="text-[9px] font-bold uppercase tracking-wider leading-tight" style={{ color: config.color }}>{config.label}</span>
        <span className="text-[9px] text-gray-400 dark:text-gray-500 font-mono">{items.length}</span>
        <span className="text-[7px] text-gray-300 dark:text-gray-600 font-mono mt-0.5">{Math.round(zoom * 100)}%</span>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-hidden relative"
        style={{ cursor: connectMode ? 'crosshair' : isPanning ? 'grabbing' : 'grab' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
      >
        <svg width="100%" height={trackHeight} style={{ display: 'block' }}>
          <defs>
            <linearGradient id={`track-grad-${type}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={config.color} stopOpacity={isDark ? 0.06 : 0.04} />
              <stop offset="50%" stopColor={config.color} stopOpacity={isDark ? 0.02 : 0.01} />
              <stop offset="100%" stopColor={config.color} stopOpacity={isDark ? 0.06 : 0.04} />
            </linearGradient>
            <filter id={`shadow-${type}`} x="-20%" y="-20%" width="140%" height="160%">
              <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity={isDark ? 0.4 : 0.08} />
            </filter>
            <filter id={`glow-${type}`} x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#f59e0b" floodOpacity="0.5" />
            </filter>
          </defs>

          <rect x={0} y={0} width="100%" height={trackHeight} fill={isDark ? '#08080c' : '#f8f9fb'} />
          <rect x={0} y={0} width="100%" height={trackHeight} fill={`url(#track-grad-${type})`} />
          <line x1={0} y1={0} x2="100%" y2={0} stroke={config.color} strokeWidth={0.5} strokeOpacity={isDark ? 0.15 : 0.1} />
          <line x1={0} y1={trackHeight - 1} x2="100%" y2={trackHeight - 1} stroke={config.color} strokeWidth={0.5} strokeOpacity={isDark ? 0.15 : 0.1} />

          {(() => {
            const markers = [];
            for (let y = Math.ceil(visStartYear / 100) * 100; y <= visEndYear; y += 100) {
              const sx = (y - startYear) * YEAR_WIDTH * zoom + panX;
              markers.push(
                <g key={`c${y}`}>
                  <line x1={sx} y1={0} x2={sx} y2={trackHeight} stroke={isDark ? '#374151' : '#cbd5e1'} strokeWidth={1.5} strokeOpacity={0.5} />
                  <rect x={sx + 2} y={2} width={36} height={14} rx={3} fill={isDark ? '#1e293b' : '#e2e8f0'} fillOpacity={0.8} />
                  <text x={sx + 6} y={12} fontSize={9} fontWeight={700} fill={isDark ? '#94a3b8' : '#475569'} fontFamily="'Inter', system-ui">{y}</text>
                </g>
              );
            }
            return markers;
          })()}

          {(() => {
            const markers = [];
            for (let y = Math.ceil(visStartYear / 10) * 10; y <= visEndYear; y += 10) {
              if (y % 100 === 0) continue;
              const sx = (y - startYear) * YEAR_WIDTH * zoom + panX;
              markers.push(
                <g key={`d${y}`}>
                  <line x1={sx} y1={RULER_HEIGHT} x2={sx} y2={trackHeight} stroke={isDark ? '#1e293b' : '#e2e8f0'} strokeWidth={0.5} strokeOpacity={0.5} strokeDasharray="4 6" />
                  <text x={sx + 3} y={RULER_HEIGHT - 4} fontSize={7.5} fill={isDark ? '#475569' : '#94a3b8'} fontFamily="'Inter', system-ui" fontWeight={500}>{y}</text>
                </g>
              );
            }
            return markers;
          })()}

          {zoom > 0.15 && (() => {
            const markers = [];
            for (let y = visStartYear; y <= visEndYear; y++) {
              if (y % 10 === 0) continue;
              const sx = (y - startYear) * YEAR_WIDTH * zoom + panX;
              markers.push(
                <g key={`y${y}`}>
                  <line x1={sx} y1={RULER_HEIGHT} x2={sx} y2={trackHeight} stroke={isDark ? '#111827' : '#f1f5f9'} strokeWidth={0.5} strokeDasharray="2 8" />
                  {zoom > 0.3 && (
                    <text x={sx + 2} y={RULER_HEIGHT - 4} fontSize={6.5} fill={isDark ? '#1e293b' : '#cbd5e1'} fontFamily="'Inter', system-ui">{y}</text>
                  )}
                </g>
              );
            }
            return markers;
          })()}

          {todayScreenX > -10 && todayScreenX < containerWidth + 10 && (
            <g>
              <line x1={todayScreenX} y1={0} x2={todayScreenX} y2={trackHeight} stroke="#ef4444" strokeWidth={1.5} strokeOpacity={0.5} />
              <rect x={todayScreenX - 14} y={1} width={28} height={12} rx={6} fill="#ef4444" fillOpacity={0.9} />
              <text x={todayScreenX} y={9} textAnchor="middle" fontSize={6.5} fontWeight={700} fill="white" fontFamily="'Inter', system-ui">TODAY</text>
            </g>
          )}

          {items.map(node => {
            const screenX = node.dataX * zoom + panX;
            const visualW = Math.max(30, node.dataW * zoom);
            const pillW = Math.max(30, Math.min(NODE_WIDTH * zoom, visualW));
            const hasSpan = node.type === 'milestone' && node.data?.endDate && node.dataW > NODE_WIDTH;

            if (screenX + visualW < -20 || screenX > containerWidth + 20) return null;

            const isSource = connectSource?.type === node.type && connectSource?.id === node.id;
            const milestoneHex = node.type === 'milestone' && node.data
              ? (MILESTONE_COLORS.find(c => c.key === node.data.color)?.hex || config.color) : config.color;
            const nodeColor = node.type === 'milestone' ? milestoneHex : config.color;
            const isDone = node.type === 'task' && node.data?.done;

            return (
              <g key={getNodeKey(node.type, node.id)} className="cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onNodeClick(node.type, node.id, node); }}
                filter={isSource ? `url(#glow-${type})` : `url(#shadow-${type})`}
              >
                {hasSpan && (
                  <>
                    <rect x={screenX + pillW - 2} y={node.y + NODE_HEIGHT / 2 - 3}
                      width={Math.max(0, visualW - pillW + 4)} height={6} rx={3}
                      fill={milestoneHex} fillOpacity={0.25} />
                    <rect x={screenX + pillW - 2} y={node.y + NODE_HEIGHT / 2 - 1.5}
                      width={Math.max(0, visualW - pillW + 4)} height={3} rx={1.5}
                      fill={milestoneHex} fillOpacity={0.5} />
                  </>
                )}
                <rect x={screenX} y={node.y} width={hasSpan ? pillW : Math.max(visualW, 20)} height={NODE_HEIGHT} rx={10}
                  fill={isDark ? '#1e293b' : '#ffffff'}
                  stroke={isSource ? '#f59e0b' : nodeColor}
                  strokeWidth={isSource ? 2.5 : 1}
                  strokeOpacity={isDone ? 0.3 : 0.6}
                  fillOpacity={isDone ? 0.4 : 1}
                />
                <rect x={screenX} y={node.y} width={hasSpan ? pillW : Math.max(visualW, 20)} height={NODE_HEIGHT} rx={10}
                  fill={nodeColor} fillOpacity={isDone ? 0.02 : 0.05} />

                {pillW > 28 && (
                  <foreignObject x={screenX + 3} y={node.y + 2} width={Math.max(20, pillW - 6)} height={NODE_HEIGHT - 4}>
                    <div xmlns="http://www.w3.org/1999/xhtml" style={{ display: 'flex', alignItems: 'center', gap: 3, height: '100%', overflow: 'hidden' }}>
                      {node.type === 'milestone' && node.data && (
                        <div style={{ width: 22, height: 22, minWidth: 22, borderRadius: '50%', background: `linear-gradient(135deg, ${milestoneHex}, ${milestoneHex}cc)`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 2px 6px ${milestoneHex}40` }}>
                          <i className={node.data.icon || 'fa-solid fa-star'} style={{ color: 'white', fontSize: 9 }} />
                        </div>
                      )}
                      {node.type === 'memo' && <i className="fa-solid fa-note-sticky" style={{ color: nodeColor, fontSize: 11, minWidth: 14 }} />}
                      {node.type === 'task' && <i className={isDone ? 'fa-solid fa-check-circle' : 'fa-regular fa-circle'} style={{ color: isDone ? '#22c55e' : nodeColor, fontSize: 11, opacity: isDone ? 0.5 : 1, minWidth: 14 }} />}
                      {pillW > 70 && (
                        <div style={{ overflow: 'hidden', flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 10, fontWeight: 600, fontFamily: "'Inter', system-ui",
                            color: isDark ? '#e2e8f0' : '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap', textDecoration: isDone ? 'line-through' : 'none',
                            opacity: isDone ? 0.4 : 1, letterSpacing: '-0.2px',
                          }}>
                            {node.title}
                          </div>
                          <div style={{ fontSize: 7, color: isDark ? '#64748b' : '#94a3b8', fontFamily: "'Inter', system-ui", letterSpacing: '0.2px' }}>
                            {node.date}{hasSpan ? ` → ${node.data.endDate}` : ''}
                          </div>
                        </div>
                      )}
                    </div>
                  </foreignObject>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function TimelineBar({ startYear, endYear, totalWidth, trackStates, allNodes, milestones, isDark, onJump, contentWidth }) {
  const barRef = useRef(null);
  const totalYears = endYear - startYear + 1;

  const decades = [];
  for (let y = Math.ceil(startYear / 10) * 10; y <= endYear; y += 10) {
    decades.push(y);
  }

  const nodeDots = useMemo(() => {
    const dots = [];
    allNodes.forEach((node) => {
      if (isNaN(node.dataX)) return;
      const frac = node.dataX / totalWidth;
      dots.push({ frac, type: node.trackType, id: node.id });
    });
    return dots;
  }, [allNodes, totalWidth]);

  function handleBarClick(e) {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = (e.clientX - rect.left) / rect.width;
    const targetYear = startYear + frac * totalYears;
    onJump(Math.round(targetYear));
  }

  const currentYearFrac = (new Date().getFullYear() - startYear + 0.5) / totalYears;
  const barW = barRef.current?.clientWidth || 300;

  return (
    <div className="flex-shrink-0 bg-white/80 dark:bg-gray-950/80 backdrop-blur-xl border-t border-gray-100 dark:border-gray-800/50 px-3 py-1.5">
      <div
        ref={barRef}
        className="relative w-full h-7 rounded-lg cursor-pointer bg-gray-50 dark:bg-gray-800/40"
        onClick={handleBarClick}
        style={{ overflow: 'visible' }}
      >
        <svg width="100%" height="100%" className="absolute inset-0" style={{ overflow: 'visible' }}>
          {decades.map(y => {
            const pct = ((y - startYear) / totalYears) * 100;
            const isCentury = y % 100 === 0;
            return (
              <g key={y}>
                <line x1={`${pct}%`} y1={0} x2={`${pct}%`} y2="100%"
                  stroke={isDark ? (isCentury ? '#4b5563' : '#374151') : (isCentury ? '#d1d5db' : '#e5e7eb')}
                  strokeWidth={isCentury ? 1.5 : 0.5} />
                <text x={`${pct}%`} y={isCentury ? 12 : 10}
                  textAnchor="middle"
                  fontSize={isCentury ? 9 : 7}
                  fontWeight={isCentury ? 700 : 400}
                  fill={isDark ? (isCentury ? '#9ca3af' : '#6b7280') : (isCentury ? '#6b7280' : '#9ca3af')}
                  fontFamily="system-ui"
                >
                  {isCentury ? y : `'${String(y).slice(-2)}`}
                </text>
              </g>
            );
          })}

          {nodeDots.map((dot, i) => {
            const color = LANE_CONFIG[dot.type]?.color || '#6b7280';
            const pct = dot.frac * 100;
            return (
              <rect key={`${dot.type}_${dot.id}_${i}`}
                x={`${pct}%`} y={dot.type === 'milestone' ? 16 : 22}
                width={2} height={dot.type === 'milestone' ? 12 : 6}
                rx={1} fill={color} fillOpacity={0.7}
              />
            );
          })}

          {milestones.filter(m => m.endDate).map(m => {
            const sFrac = dateToX(m.date, startYear) / totalWidth;
            const eFrac = dateToX(m.endDate, startYear) / totalWidth;
            const hex = MILESTONE_COLORS.find(c => c.key === m.color)?.hex || '#a855f7';
            return (
              <rect key={`span_${m.id}`}
                x={`${sFrac * 100}%`} y={18}
                width={`${(eFrac - sFrac) * 100}%`} height={4}
                rx={2} fill={hex} fillOpacity={0.5}
              />
            );
          })}

          {TRACK_TYPES.map((tType, idx) => {
            const ts = trackStates[tType];
            const color = LANE_CONFIG[tType].color;
            const cw = contentWidth || barW;
            const startFrac = Math.max(0, -ts.panX / (ts.zoom * totalWidth));
            const endFrac = Math.min(1, (cw - ts.panX) / (ts.zoom * totalWidth));
            const yOff = idx * 9;
            return (
              <rect key={`vp_${tType}`}
                x={`${startFrac * 100}%`} y={yOff}
                width={`${Math.max(0.3, (endFrac - startFrac) * 100)}%`} height={9}
                rx={2} fill={color} fillOpacity={0.12}
                stroke={color} strokeWidth={0.8} strokeOpacity={0.4}
              />
            );
          })}

          <line x1={`${currentYearFrac * 100}%`} y1={0} x2={`${currentYearFrac * 100}%`} y2="100%"
            stroke="#ef4444" strokeWidth={1.5} strokeOpacity={0.8} />
        </svg>
      </div>
    </div>
  );
}

export default function LifeGraphView() {
  const [, setSearchParams] = useSearchParams();
  const [milestones, setMilestones] = useState([]);
  const [activity, setActivity] = useState({});
  const [memoTimeline, setMemoTimeline] = useState([]);
  const [taskTimeline, setTaskTimeline] = useState([]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState(null);

  const [trackStates, setTrackStates] = useState({
    milestone: { zoom: 0.5, panX: 0 },
    memo: { zoom: 0.5, panX: 0 },
    task: { zoom: 0.5, panX: 0 },
  });
  const [synced, setSynced] = useState(false);
  const syncedRef = useRef(false);
  syncedRef.current = synced;

  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState(null);
  const [connectColor, setConnectColor] = useState('#6b7280');
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const tracksAreaRef = useRef(null);
  const [tracksAreaHeight, setTracksAreaHeight] = useState(420);

  const isDark = document.documentElement.classList.contains('dark') ||
    document.body.classList.contains('dark') ||
    window.matchMedia('(prefers-color-scheme: dark)').matches;

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    const el = tracksAreaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setTracksAreaHeight(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [ms, act, conns] = await Promise.all([
        getMilestones(), getLifeActivity(), getGraphConnections(),
      ]);
      setMilestones(ms);
      setActivity(act.activity || {});
      setMemoTimeline(act.memoTimeline || []);
      setTaskTimeline(act.taskTimeline || []);
      setConnections(conns || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  const startYear = 1900;
  const endYear = useMemo(() => {
    const years = [new Date().getFullYear()];
    milestones.forEach(m => {
      if (m.date) years.push(new Date(m.date).getFullYear());
      if (m.endDate) years.push(new Date(m.endDate).getFullYear());
    });
    memoTimeline.forEach(m => { if (m.date) years.push(new Date(m.date).getFullYear()); });
    taskTimeline.forEach(t => { if (t.date) years.push(new Date(t.date).getFullYear()); });
    return Math.max(...years) + 1;
  }, [milestones, memoTimeline, taskTimeline]);

  const totalWidth = (endYear - startYear + 1) * YEAR_WIDTH;

  const trackHeight = Math.max(80, Math.floor((tracksAreaHeight - TRACK_GAP * (TRACK_TYPES.length - 1)) / TRACK_TYPES.length));

  const allNodeData = useMemo(() => {
    const map = new Map();
    const perTrack = {};
    const centerY = RULER_HEIGHT + (trackHeight - RULER_HEIGHT) / 2;

    TRACK_TYPES.forEach(type => {
      const rawItems = type === 'milestone'
        ? milestones.map(m => ({ type: 'milestone', id: m.id, title: m.title, date: m.date, data: m }))
        : type === 'memo'
        ? memoTimeline.map(m => ({ type: 'memo', id: m.id, title: m.title, date: m.date, data: m }))
        : taskTimeline.map(t => ({ type: 'task', id: t.id, title: t.title, date: t.date, data: t }));

      const sorted = [...rawItems].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const trackNodes = [];
      let lastEndX = -Infinity;
      let rowOffset = 0;

      sorted.forEach(item => {
        const dataX = dateToX(item.date, startYear);
        let dataW = NODE_WIDTH;
        if (type === 'milestone' && item.data?.endDate) {
          const endX = dateToX(item.data.endDate, startYear);
          dataW = Math.max(NODE_WIDTH, endX - dataX);
        }
        if (dataX < lastEndX + 4) {
          rowOffset = (rowOffset + 1) % 3;
        } else {
          rowOffset = 0;
        }
        const y = centerY - NODE_HEIGHT / 2 + (rowOffset - 1) * (NODE_HEIGHT + 4);
        const nodeEntry = { ...item, dataX, y, dataW };
        trackNodes.push(nodeEntry);
        map.set(getNodeKey(type, item.id), { ...nodeEntry, trackType: type });
        lastEndX = dataX + dataW;
      });

      perTrack[type] = trackNodes;
    });

    return { perTrack, map };
  }, [milestones, memoTimeline, taskTimeline, startYear, trackHeight]);

  const handleUpdateTrack = useCallback((type, updater) => {
    setTrackStates(prev => {
      const current = prev[type];
      const updated = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      if (syncedRef.current) {
        return { milestone: { ...updated }, memo: { ...updated }, task: { ...updated } };
      }
      return { ...prev, [type]: updated };
    });
  }, []);

  const trackUpdateCallbacks = useMemo(() => ({
    milestone: (u) => handleUpdateTrack('milestone', u),
    memo: (u) => handleUpdateTrack('memo', u),
    task: (u) => handleUpdateTrack('task', u),
  }), [handleUpdateTrack]);

  function handleNodeClick(type, id, item) {
    if (connectMode) {
      if (!connectSource) {
        setConnectSource({ type, id });
      } else {
        if (connectSource.type === type && connectSource.id === id) {
          setConnectSource(null);
          return;
        }
        createGraphConnection({
          sourceType: connectSource.type,
          sourceId: connectSource.id,
          targetType: type,
          targetId: id,
          color: connectColor,
        }).then(() => {
          setConnectSource(null);
          loadData();
        });
      }
      return;
    }

    if (type === 'milestone') {
      setEditingMilestone(item.data);
      setShowForm(true);
    } else if (type === 'memo') {
      setSearchParams(prev => {
        prev.set('view', 'memo');
        prev.set('openMemo', id);
        return prev;
      });
    }
  }

  async function handleDeleteConnection(id) {
    try {
      await deleteGraphConnection(id);
      loadData();
    } catch (e) { console.error(e); }
  }

  async function handleSaveMilestone(data) {
    try {
      if (editingMilestone) await updateMilestone(editingMilestone.id, data);
      else await createMilestone(data);
      setShowForm(false);
      setEditingMilestone(null);
      loadData();
    } catch (e) { console.error(e); }
  }

  async function handleDeleteMilestone(id) {
    try {
      await deleteMilestone(id);
      setShowForm(false);
      setEditingMilestone(null);
      loadData();
    } catch (e) { console.error(e); }
  }

  function getContentWidth() {
    const el = tracksAreaRef.current;
    return el ? el.clientWidth - HEADER_WIDTH : 800;
  }

  function jumpToYear(year) {
    const cw = getContentWidth();
    const dataX = (year - startYear) * YEAR_WIDTH;
    setTrackStates(prev => {
      const newStates = {};
      TRACK_TYPES.forEach(type => {
        newStates[type] = { ...prev[type], panX: -dataX * prev[type].zoom + cw / 2 };
      });
      return newStates;
    });
  }

  function jumpToToday() {
    const cw = getContentWidth();
    const today = new Date().toISOString().split('T')[0];
    const dataX = dateToX(today, startYear);
    const newZoom = 0.8;
    const panX = -dataX * newZoom + cw / 2;
    setTrackStates({
      milestone: { zoom: newZoom, panX },
      memo: { zoom: newZoom, panX },
      task: { zoom: newZoom, panX },
    });
  }

  function zoomAll(factor) {
    const cw = getContentWidth();
    const cx = cw / 2;
    setTrackStates(prev => {
      const newStates = {};
      TRACK_TYPES.forEach(type => {
        const ts = prev[type];
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, ts.zoom * factor));
        const ratio = newZoom / ts.zoom;
        newStates[type] = { zoom: newZoom, panX: cx - (cx - ts.panX) * ratio };
      });
      return newStates;
    });
  }

  function toggleSync() {
    if (!synced) {
      setTrackStates(ts => ({
        milestone: { ...ts.milestone },
        memo: { ...ts.milestone },
        task: { ...ts.milestone },
      }));
    }
    setSynced(prev => !prev);
  }

  function handleTracksPointerMove(e) {
    if (!connectMode || !connectSource) return;
    const rect = tracksAreaRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMousePos({ x: e.clientX - rect.left - HEADER_WIDTH, y: e.clientY - rect.top });
  }

  useEffect(() => {
    if (!loading && tracksAreaRef.current) {
      setTimeout(() => jumpToToday(), 100);
    }
  }, [loading]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="animate-pulse space-y-4 w-64">
          <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded w-48" />
          <div className="h-32 bg-gray-200 dark:bg-gray-800 rounded" />
        </div>
      </div>
    );
  }

  const trackTopOffsets = TRACK_TYPES.map((_, i) => i * (trackHeight + TRACK_GAP));

  function getNodeOverlayPos(nodeKey) {
    const node = allNodeData.map.get(nodeKey);
    if (!node) return null;
    const ts = trackStates[node.trackType];
    const idx = TRACK_TYPES.indexOf(node.trackType);
    const visualW = Math.max(30, node.dataW * ts.zoom);
    const hasSpan = node.type === 'milestone' && node.data?.endDate && node.dataW > NODE_WIDTH;
    const anchorW = hasSpan ? visualW : Math.max(30, Math.min(NODE_WIDTH * ts.zoom, visualW));
    return {
      x: node.dataX * ts.zoom + ts.panX + anchorW / 2,
      y: trackTopOffsets[idx] + node.y + NODE_HEIGHT / 2,
    };
  }

  return (
    <div className="w-full h-[calc(100vh-120px)] md:h-[calc(100vh-80px)] flex flex-col dark:text-white relative">
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/80 dark:bg-gray-950/80 backdrop-blur-xl border-b border-gray-100 dark:border-gray-800/50 z-10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold flex items-center gap-2 tracking-tight">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-sm">
              <i className="fa-solid fa-globe text-white text-[10px]" />
            </div>
            <span className="dark:text-white">World Graph</span>
          </h1>
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-gray-400 bg-gray-50 dark:bg-gray-800/40 rounded-full px-2.5 py-0.5">
            <span className="text-purple-400 font-medium">{milestones.length}</span> milestones
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className="text-blue-400 font-medium">{memoTimeline.length}</span> memos
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className="text-green-400 font-medium">{taskTimeline.length}</span> tasks
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex items-center bg-gray-50 dark:bg-gray-800/40 rounded-lg p-0.5 gap-0.5">
            <button onClick={() => jumpToYear(1900)} className="px-2 py-1 text-[10px] rounded-md hover:bg-white dark:hover:bg-gray-700 transition text-gray-500 dark:text-gray-400 font-medium" title="Go to 1900">1900</button>
            <button onClick={() => jumpToYear(2000)} className="px-2 py-1 text-[10px] rounded-md hover:bg-white dark:hover:bg-gray-700 transition text-gray-500 dark:text-gray-400 font-medium" title="Go to 2000">2000</button>
            <button onClick={jumpToToday} className="px-2 py-1 text-[10px] bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400 rounded-md hover:bg-red-100 dark:hover:bg-red-800/40 transition font-semibold" title="Jump to today">Today</button>
          </div>
          <div className="w-px h-5 bg-gray-100 dark:bg-gray-800 mx-0.5" />
          <div className="flex items-center bg-gray-50 dark:bg-gray-800/40 rounded-lg p-0.5">
            <button onClick={() => zoomAll(0.7)} className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-white dark:hover:bg-gray-700 transition text-[11px] text-gray-500" title="Zoom out all tracks">−</button>
            <button onClick={() => zoomAll(1.3)} className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-white dark:hover:bg-gray-700 transition text-[11px] text-gray-500" title="Zoom in all tracks">+</button>
          </div>
          <div className="w-px h-5 bg-gray-100 dark:bg-gray-800 mx-0.5" />
          <button
            onClick={toggleSync}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold transition ${synced ? 'bg-blue-500 text-white shadow-sm shadow-blue-200 dark:shadow-blue-900' : 'bg-gray-50 dark:bg-gray-800/40 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
            title={synced ? 'Tracks are synced - click to unlock' : 'Click to sync all tracks'}
          >
            <i className={`fa-solid ${synced ? 'fa-lock' : 'fa-lock-open'} text-[8px]`} />
            <span className="hidden sm:inline">Sync</span>
          </button>
          <div className="w-px h-5 bg-gray-100 dark:bg-gray-800 mx-0.5" />
          <button
            onClick={() => { setConnectMode(!connectMode); setConnectSource(null); }}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition ${connectMode ? 'bg-orange-500 text-white shadow-sm shadow-orange-200 dark:shadow-orange-900' : 'bg-gray-50 dark:bg-gray-800/40 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
            title="Draw connections between items"
          >
            <i className="fa-solid fa-draw-polygon text-[9px]" />
            <span className="hidden sm:inline">Connect</span>
          </button>
          {connectMode && (
            <div className="flex items-center gap-0.5 ml-0.5 bg-gray-50 dark:bg-gray-800/40 rounded-lg p-1">
              {CONNECTION_COLORS.map(c => (
                <button key={c} onClick={() => setConnectColor(c)}
                  className={`w-4 h-4 rounded-full transition-all ${connectColor === c ? 'ring-2 ring-offset-1 ring-blue-500 dark:ring-offset-gray-900 scale-110' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          )}
          <button onClick={() => { setEditingMilestone(null); setShowForm(true); }}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg text-[10px] font-semibold hover:from-purple-600 hover:to-purple-700 transition shadow-sm shadow-purple-200 dark:shadow-purple-900/30">
            <i className="fa-solid fa-plus text-[8px]" /> Milestone
          </button>
        </div>
      </div>

      {connectMode && (
        <div className="px-4 py-2 bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 border-b border-orange-100 dark:border-orange-900/30 text-[11px] text-orange-600 dark:text-orange-300 flex items-center gap-2 flex-shrink-0">
          <div className="w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center">
            <i className="fa-solid fa-draw-polygon text-[8px] text-orange-500" />
          </div>
          {connectSource
            ? <span>Click target node to complete connection from <b className="text-orange-700 dark:text-orange-200">{connectSource.type}</b></span>
            : <span>Click a source node to start drawing a connection</span>
          }
          <button onClick={() => { setConnectSource(null); setConnectMode(false); }} className="ml-auto text-[10px] px-2 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-300 rounded-md hover:bg-orange-200 dark:hover:bg-orange-800/40 transition font-semibold">Cancel</button>
        </div>
      )}

      <div
        ref={tracksAreaRef}
        className="flex-1 flex flex-col relative min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-950"
        onPointerMove={handleTracksPointerMove}
      >
        {TRACK_TYPES.map((type, i) => (
          <React.Fragment key={type}>
            {i > 0 && (
              <div
                className="flex-shrink-0"
                style={{
                  height: TRACK_GAP,
                  background: isDark
                    ? 'linear-gradient(90deg, rgba(55,65,81,0.3), rgba(55,65,81,0.6), rgba(55,65,81,0.3))'
                    : 'linear-gradient(90deg, rgba(209,213,219,0.3), rgba(209,213,219,0.6), rgba(209,213,219,0.3))',
                }}
              />
            )}
            <div style={{ height: trackHeight }} className="flex-shrink-0">
              <TimelineTrack
                type={type}
                config={LANE_CONFIG[type]}
                items={allNodeData.perTrack[type]}
                trackState={trackStates[type]}
                onUpdateState={trackUpdateCallbacks[type]}
                trackHeight={trackHeight}
                startYear={startYear}
                endYear={endYear}
                isDark={isDark}
                connectMode={connectMode}
                connectSource={connectSource}
                onNodeClick={handleNodeClick}
              />
            </div>
          </React.Fragment>
        ))}

        <svg
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ left: HEADER_WIDTH, right: 0 }}
          width={`calc(100% - ${HEADER_WIDTH}px)`}
          height="100%"
        >
          {connections.map(conn => {
            const sPos = getNodeOverlayPos(getNodeKey(conn.sourceType, conn.sourceId));
            const tPos = getNodeOverlayPos(getNodeKey(conn.targetType, conn.targetId));
            if (!sPos || !tPos) return null;

            const sx = sPos.x, sy = sPos.y, tx = tPos.x, ty = tPos.y;
            const dx = tx - sx, dy = ty - sy;
            const cx1 = sx + dx * 0.4, cy1 = sy;
            const cx2 = tx - dx * 0.4, cy2 = ty;
            const path = `M ${sx} ${sy} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${tx} ${ty}`;
            const connColor = conn.color || '#6b7280';

            const angle = Math.atan2(ty - cy2, tx - cx2);
            const arrowLen = 8;
            const ax1 = tx - arrowLen * Math.cos(angle - 0.4);
            const ay1 = ty - arrowLen * Math.sin(angle - 0.4);
            const ax2 = tx - arrowLen * Math.cos(angle + 0.4);
            const ay2 = ty - arrowLen * Math.sin(angle + 0.4);
            const midX = (sx + tx) / 2, midY = (sy + ty) / 2;

            return (
              <g key={conn.id}>
                <path d={path} stroke={connColor} strokeWidth={1.5} fill="none" strokeOpacity={0.2} />
                <path d={path} stroke={connColor} strokeWidth={1.5} fill="none" strokeOpacity={0.6}
                  strokeDasharray="6 4">
                  <animate attributeName="stroke-dashoffset" from="20" to="0" dur="1.5s" repeatCount="indefinite" />
                </path>
                <polygon points={`${tx},${ty} ${ax1},${ay1} ${ax2},${ay2}`} fill={connColor} fillOpacity={0.7} />
                <circle cx={midX} cy={midY} r={8}
                  fill={isDark ? '#1f2937' : '#ffffff'} stroke={connColor} strokeWidth={1.5}
                  className="cursor-pointer" fillOpacity={0} strokeOpacity={0}
                  style={{ pointerEvents: 'auto' }}
                  onClick={(e) => { e.stopPropagation(); handleDeleteConnection(conn.id); }}>
                  <set attributeName="fill-opacity" to="1" begin="mouseover" end="mouseout" />
                  <set attributeName="stroke-opacity" to="1" begin="mouseover" end="mouseout" />
                </circle>
                <text x={midX} y={midY} textAnchor="middle" fontSize={10} fill="#ef4444" fontWeight="bold"
                  className="pointer-events-none" style={{ dominantBaseline: 'central' }} opacity={0}>
                  <set attributeName="opacity" to="1" begin="mouseover" end="mouseout" />
                  ×
                </text>
              </g>
            );
          })}

          {connectMode && connectSource && (() => {
            const sPos = getNodeOverlayPos(getNodeKey(connectSource.type, connectSource.id));
            if (!sPos) return null;
            return (
              <line x1={sPos.x} y1={sPos.y} x2={mousePos.x} y2={mousePos.y}
                stroke={connectColor} strokeWidth={2} strokeDasharray="6 4" strokeOpacity={0.7} />
            );
          })()}
        </svg>
      </div>

      <TimelineBar
        startYear={startYear}
        endYear={endYear}
        totalWidth={totalWidth}
        trackStates={trackStates}
        allNodes={allNodeData.map}
        milestones={milestones}
        isDark={isDark}
        contentWidth={getContentWidth()}
        onJump={(year) => jumpToYear(year)}
      />

      {showForm && (
        <MilestoneForm
          milestone={editingMilestone}
          onSave={handleSaveMilestone}
          onCancel={() => { setShowForm(false); setEditingMilestone(null); }}
          onDelete={handleDeleteMilestone}
        />
      )}
    </div>
  );
}
