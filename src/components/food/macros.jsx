import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { getStoredToken } from '../../scripts/api.js';

export const MACRO_DEFS = [
  { key: 'protein', label: 'P', unit: 'g', color: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
  { key: 'carbs', label: 'C', unit: 'g', color: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  { key: 'fat', label: 'F', unit: 'g', color: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
  { key: 'sodium', label: 'Na', unit: 'mg', color: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
];

export const GOAL_FIELDS = [
  { key: 'protein', goalKey: 'proteinGoal', label: '蛋白質', unit: 'g', color: 'rose' },
  { key: 'carbs', goalKey: 'carbsGoal', label: '碳水', unit: 'g', color: 'amber' },
  { key: 'fat', goalKey: 'fatGoal', label: '脂肪', unit: 'g', color: 'yellow' },
  { key: 'sodium', goalKey: 'sodiumGoal', label: '鈉', unit: 'mg', color: 'sky' },
];

export function macroNum(v) {
  if (v == null) return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

export function getItemMacros(item) {
  const out = {};
  let any = false;
  for (const { key } of MACRO_DEFS) {
    const n = macroNum(item?.[key]);
    if (n != null) { out[key] = n; any = true; }
  }
  return any ? out : null;
}

export function sumMacrosFromRows(rows) {
  const totals = { protein: 0, carbs: 0, fat: 0, sodium: 0 };
  let any = false;
  for (const r of rows) {
    let items = [];
    try { items = JSON.parse(r.items || '[]'); } catch {}
    for (const it of items) {
      for (const { key } of MACRO_DEFS) {
        const n = macroNum(it?.[key]);
        if (n != null) { totals[key] += n; any = true; }
      }
    }
  }
  return any ? totals : null;
}

export function progressTone(pct, isMax) {
  if (isMax) {
    if (pct < 0.7) return { bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300' };
    if (pct < 1) return { bar: 'bg-yellow-500', text: 'text-yellow-700 dark:text-yellow-300' };
    return { bar: 'bg-red-500', text: 'text-red-700 dark:text-red-300' };
  }
  if (pct < 0.5) return { bar: 'bg-red-400', text: 'text-red-700 dark:text-red-300' };
  if (pct < 0.9) return { bar: 'bg-yellow-500', text: 'text-yellow-700 dark:text-yellow-300' };
  if (pct <= 1.1) return { bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300' };
  return { bar: 'bg-orange-500', text: 'text-orange-700 dark:text-orange-300' };
}

export function goalDeltaPhrase(current, goal, unit, isMax) {
  const cur = Math.round(current || 0);
  const g = Math.round(goal || 0);
  if (!(g > 0)) return '';
  if (isMax) {
    const room = g - cur;
    if (room > 0) return `仲剩 ${room}${unit} 空間`;
    if (room === 0) return '啱啱到上限';
    return `已超 ${-room}${unit}`;
  }
  const remaining = g - cur;
  if (remaining > 0) return `仲爭 ${remaining}${unit}`;
  if (remaining === 0) return '已達標';
  return `已達標，多 ${-remaining}${unit}`;
}

export function MacroProgress({ field, current, goal, isMax }) {
  const cur = current || 0;
  const pct = goal > 0 ? cur / goal : 0;
  const widthPct = Math.min(100, Math.max(0, pct * 100));
  const tone = progressTone(pct, isMax);
  const delta = goalDeltaPhrase(cur, goal, field.unit, isMax);
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-semibold text-gray-700 dark:text-gray-300">
          {field.label}
          {isMax && field.key === 'sodium' && (
            <span className="ml-1 text-[9px] text-gray-400">上限</span>
          )}
        </span>
        <span className={`tabular-nums ${tone.text}`}>
          今日 {Math.round(cur)} / {isMax ? '上限' : '目標'} {goal}{field.unit}
          <span className="ml-1 text-gray-400">({Math.round(pct * 100)}%)</span>
        </span>
      </div>
      <div className="h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${tone.bar} transition-all`} style={{ width: `${widthPct}%` }} />
      </div>
      {delta && (
        <div className={`text-[10px] tabular-nums ${tone.text}`}>· {delta}</div>
      )}
    </div>
  );
}

function normalizeDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts;
  const yy = y.padStart(4, '0');
  const mm = String(parseInt(m, 10)).padStart(2, '0');
  const dd = String(parseInt(d, 10)).padStart(2, '0');
  if (!yy || !mm || !dd || mm === 'NaN' || dd === 'NaN') return null;
  return `${yy}-${mm}-${dd}`;
}

function useFoodForDate(dateStr) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const normalized = normalizeDate(dateStr);
  useEffect(() => {
    if (!normalized) return;
    let cancelled = false;
    setLoading(true);
    const token = getStoredToken();
    const month = normalized.slice(0, 7);
    fetch(`/api/food?month=${month}&limit=500`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => (r.ok ? r.json() : []))
      .then(data => {
        if (cancelled) return;
        const filtered = Array.isArray(data)
          ? data.filter(r => normalizeDate(r.date) === normalized)
          : [];
        setRows(filtered);
      })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [normalized]);
  return { rows, loading };
}

export function DayMacroCoaching({ date, className = '', title = '今日營養素', emptyHint = null }) {
  const { currentUser } = useAuth();
  const { rows, loading } = useFoodForDate(date);
  const goals = useMemo(() => ({
    proteinGoal: currentUser?.proteinGoal ?? null,
    carbsGoal: currentUser?.carbsGoal ?? null,
    fatGoal: currentUser?.fatGoal ?? null,
    sodiumGoal: currentUser?.sodiumGoal ?? null,
    sodiumIsMax: currentUser?.sodiumIsMax ?? true,
  }), [currentUser]);
  const configured = GOAL_FIELDS.filter(f => Number(goals[f.goalKey]) > 0);
  if (configured.length === 0) return null;
  const totals = sumMacrosFromRows(rows) || { protein: 0, carbs: 0, fat: 0, sodium: 0 };
  return (
    <div className={`border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 bg-white dark:bg-gray-900/40 ${className}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 flex items-center gap-1">
          <i className="fa-solid fa-utensils" />{title}
        </div>
        {loading && <i className="fa-solid fa-spinner animate-spin text-[10px] text-gray-400" />}
      </div>
      <div className="space-y-1.5">
        {configured.map(f => {
          const goal = Number(goals[f.goalKey]);
          const cur = totals[f.key] || 0;
          const isMax = f.key === 'sodium' && !!goals.sodiumIsMax;
          return <MacroProgress key={f.key} field={f} current={cur} goal={goal} isMax={isMax} />;
        })}
      </div>
      {!loading && rows.length === 0 && emptyHint && (
        <div className="text-[10px] text-gray-400 mt-1.5">{emptyHint}</div>
      )}
    </div>
  );
}

export function MacroChip({ def, value }) {
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full ${def.color}`}>
      <span className="font-semibold">{def.label}</span>
      <span className="tabular-nums">{Math.round(value)}{def.unit}</span>
    </span>
  );
}

export function MacroChips({ macros, className = '' }) {
  if (!macros) return null;
  const visible = MACRO_DEFS.filter(d => macros[d.key] != null && macros[d.key] > 0);
  if (visible.length === 0) return null;
  return (
    <span className={`inline-flex flex-wrap gap-1 ${className}`}>
      {visible.map(d => <MacroChip key={d.key} def={d} value={macros[d.key]} />)}
    </span>
  );
}
