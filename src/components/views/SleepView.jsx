import React, { useState, useEffect, useMemo } from 'react';
import { getStoredToken } from '../../scripts/api';

function fmtMin(min) {
  if (min == null) return '—';
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function severityColor(pct) {
  if (pct == null) return 'text-gray-400';
  if (pct >= 80) return 'text-emerald-500';
  if (pct >= 60) return 'text-amber-500';
  return 'text-red-500';
}

function snoreColor(min) {
  if (min == null) return 'text-gray-400';
  if (min >= 90) return 'text-red-500';
  if (min >= 60) return 'text-amber-500';
  if (min >= 30) return 'text-yellow-500';
  return 'text-emerald-500';
}

function SnoreChart({ data }) {
  if (!data || data.length < 2) return null;
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  const values = sorted.map(d => d.snoreMin || 0);
  const max = Math.max(...values, 60) * 1.1;
  const w = 100, h = 40;
  const barW = w / sorted.length;
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h + 2}`} className="w-full h-24" preserveAspectRatio="none">
        <line x1="0" y1={h - (60 / max) * h} x2={w} y2={h - (60 / max) * h}
          stroke="currentColor" strokeWidth="0.3" strokeDasharray="2 2" className="text-amber-300 dark:text-amber-800" />
        {sorted.map((d, i) => {
          const v = d.snoreMin || 0;
          const barH = (v / max) * h;
          const color = v >= 90 ? '#ef4444' : v >= 60 ? '#f59e0b' : v >= 30 ? '#eab308' : '#10b981';
          return <rect key={i} x={i * barW + barW * 0.1} y={h - barH} width={barW * 0.8} height={barH} fill={color} rx="0.5" opacity="0.85" />;
        })}
      </svg>
      <div className="flex items-center justify-center gap-3 mt-1 text-[9px]">
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-sm inline-block" />&lt;30m</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-yellow-500 rounded-sm inline-block" />30-60</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-500 rounded-sm inline-block" />60-90</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-500 rounded-sm inline-block" />90+</span>
        <span className="text-amber-300 dark:text-amber-700">--- 60m line</span>
      </div>
    </div>
  );
}

function TrendLine({ data, getValue, color, label, unit, target = null, height = 40 }) {
  const points = (data || []).filter(d => getValue(d) != null);
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  const values = sorted.map(getValue);
  const max = Math.max(...values, target || 0) * 1.1 || 1;
  const min = Math.min(...values, target || max) * 0.9;
  const range = max - min || 1;
  const w = 100;
  const step = w / (sorted.length - 1 || 1);
  const path = values.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`).join(' ');
  return (
    <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</span>
        <span className="text-[10px] tabular-nums" style={{ color }}>
          {values[values.length - 1]}{unit} · avg {Math.round(values.reduce((a, v) => a + v, 0) / values.length)}{unit}
        </span>
      </div>
      <svg viewBox={`-2 -2 ${w + 4} ${height + 4}`} className="w-full h-20" preserveAspectRatio="none">
        {target != null && (
          <line x1="0" y1={(height - ((target - min) / range) * height).toFixed(1)} x2={w}
            y2={(height - ((target - min) / range) * height).toFixed(1)}
            stroke="currentColor" strokeWidth="0.3" strokeDasharray="2 2" className="text-gray-300 dark:text-gray-700" />
        )}
        <polyline points={path} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function GlossaryPanel() {
  return (
    <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-3 mb-4 bg-gray-50/50 dark:bg-gray-900/30 space-y-2 text-[11px] text-gray-600 dark:text-gray-400">
      <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1">
        <i className="fa-solid fa-circle-info mr-1" />名詞解釋 / Glossary
      </div>
      <div><span className="font-medium text-indigo-500">有效干預率 (Effective Intervention %)</span> — 添眠枕成功令鼾聲下降嘅比例。越高越好；&lt; 60% 代表干預效果有限。</div>
      <div><span className="font-medium text-amber-500">鼾聲時長 (Snore duration)</span> — 全晚累計打鼾分鐘。長期 &gt; 60 分鐘可能係 OSA 警號。</div>
      <div><span className="font-medium text-yellow-500">鼾聲強度平均降低 (Snore intensity drop, dB)</span> — 干預後鼾聲分貝下降幅度。10 dB 約為音量減半。</div>
      <div><span className="font-medium text-cyan-500">SpO₂ min</span> — 全晚血氧最低值。低於 90% 提示低氧事件，應留意。</div>
      <div><span className="font-medium text-purple-500">AHI (Apnea-Hypopnea Index)</span> — 每小時呼吸暫停 + 低通氣次數。本 app 暫不直接量度；參考診斷：&lt;5 正常，5–15 輕度，15–30 中度，&gt;30 重度。</div>
      <div><span className="font-medium text-gray-500">離枕次數 (Off-pillow)</span> — 添眠偵測到頭部離開枕頭嘅次數，用以評估配戴依從性。</div>
    </div>
  );
}

function SleepForm({ initial, onSubmit, onCancel }) {
  const [d, setD] = useState({
    date: initial?.date || new Date().toISOString().slice(0, 10),
    bedTime: initial?.bedTime || '',
    wakeTime: initial?.wakeTime || '',
    totalSleepMin: initial?.totalSleepMin ?? '',
    deepSleepMin: initial?.deepSleepMin ?? '',
    remSleepMin: initial?.remSleepMin ?? '',
    wakeCount: initial?.wakeCount ?? '',
    snoreMin: initial?.snoreMin ?? '',
    effectiveInterventionPct: initial?.effectiveInterventionPct ?? '',
    snoreIntensityDropDb: initial?.snoreIntensityDropDb ?? '',
    offPillowCount: initial?.offPillowCount ?? '',
    interventionMin: initial?.interventionMin ?? '',
    spo2Min: initial?.spo2Min ?? '',
    spo2Avg: initial?.spo2Avg ?? '',
    hrAvg: initial?.hrAvg ?? '',
    notes: initial?.notes || '',
  });
  function set(k, v) { setD(prev => ({ ...prev, [k]: v })); }
  const fld = (k, label, type = 'number', extra = {}) => (
    <label className="text-[10px] text-gray-500 dark:text-gray-400">
      <span className="block mb-0.5">{label}</span>
      <input type={type} value={d[k]} onChange={e => set(k, e.target.value)}
        className="w-full text-[12px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-black dark:text-white"
        {...extra} />
    </label>
  );
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit({
      ...d,
      totalSleepMin: d.totalSleepMin === '' ? null : parseInt(d.totalSleepMin),
      deepSleepMin: d.deepSleepMin === '' ? null : parseInt(d.deepSleepMin),
      remSleepMin: d.remSleepMin === '' ? null : parseInt(d.remSleepMin),
      wakeCount: d.wakeCount === '' ? null : parseInt(d.wakeCount),
      snoreMin: d.snoreMin === '' ? null : parseInt(d.snoreMin),
      effectiveInterventionPct: d.effectiveInterventionPct === '' ? null : parseInt(d.effectiveInterventionPct),
      snoreIntensityDropDb: d.snoreIntensityDropDb === '' ? null : parseInt(d.snoreIntensityDropDb),
      offPillowCount: d.offPillowCount === '' ? null : parseInt(d.offPillowCount),
      interventionMin: d.interventionMin === '' ? null : parseInt(d.interventionMin),
      spo2Min: d.spo2Min === '' ? null : parseInt(d.spo2Min),
      spo2Avg: d.spo2Avg === '' ? null : parseInt(d.spo2Avg),
      hrAvg: d.hrAvg === '' ? null : parseInt(d.hrAvg),
    }); }} className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 mb-4 bg-gray-50 dark:bg-gray-900/50 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {fld('date', 'Date', 'date')}
        {fld('bedTime', 'Bed time', 'time')}
        {fld('wakeTime', 'Wake time', 'time')}
      </div>
      <div className="text-[9px] text-gray-400 uppercase tracking-wider pt-1">添眠 / 鼾聲</div>
      <div className="grid grid-cols-3 gap-2">
        {fld('snoreMin', 'Snore (min)')}
        {fld('effectiveInterventionPct', 'Effective % ')}
        {fld('snoreIntensityDropDb', 'dB drop')}
        {fld('interventionMin', 'Intervention (min)')}
        {fld('offPillowCount', 'Off pillow #')}
      </div>
      <div className="text-[9px] text-gray-400 uppercase tracking-wider pt-1">Samsung / 睡眠結構</div>
      <div className="grid grid-cols-3 gap-2">
        {fld('totalSleepMin', 'Total (min)')}
        {fld('deepSleepMin', 'Deep (min)')}
        {fld('remSleepMin', 'REM (min)')}
        {fld('wakeCount', 'Wake #')}
        {fld('spo2Min', 'SpO₂ min')}
        {fld('spo2Avg', 'SpO₂ avg')}
        {fld('hrAvg', 'HR avg')}
      </div>
      <label className="text-[10px] text-gray-500 dark:text-gray-400 block">
        <span className="block mb-0.5">Notes</span>
        <textarea value={d.notes} onChange={e => set('notes', e.target.value)} rows={2}
          className="w-full text-[12px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-black dark:text-white" />
      </label>
      <div className="flex gap-2 pt-1">
        <button type="submit" className="text-[11px] px-3 py-1 bg-black text-white dark:bg-white dark:text-black rounded cursor-pointer hover:opacity-80">
          {initial ? 'Save' : 'Add'}
        </button>
        <button type="button" onClick={onCancel} className="text-[11px] px-3 py-1 text-gray-400 cursor-pointer hover:text-gray-600">Cancel</button>
      </div>
    </form>
  );
}

function SymptomForm({ initial, onSubmit, onCancel }) {
  const [d, setD] = useState({
    date: initial?.date || new Date().toISOString().slice(0, 10),
    morningHeadache: initial?.morningHeadache ?? 1,
    daytimeFatigue: initial?.daytimeFatigue ?? 1,
    concentration: initial?.concentration ?? 5,
    nightWakeCount: initial?.nightWakeCount ?? 1,
    notes: initial?.notes || '',
  });
  function set(k, v) { setD(prev => ({ ...prev, [k]: v })); }
  const slider = (k, label, max = 5) => (
    <label className="text-[10px] text-gray-500 dark:text-gray-400 block">
      <div className="flex justify-between mb-0.5">
        <span>{label}</span>
        <span className="font-medium text-black dark:text-white">{d[k]}</span>
      </div>
      <input type="range" min={1} max={max} value={d[k]}
        onChange={e => set(k, parseInt(e.target.value))}
        className="w-full accent-indigo-500" />
    </label>
  );
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(d); }}
      className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 mb-4 bg-gray-50 dark:bg-gray-900/50 space-y-3">
      <label className="text-[10px] text-gray-500 dark:text-gray-400 block">
        <span className="block mb-0.5">Date</span>
        <input type="date" value={d.date} onChange={e => set('date', e.target.value)}
          className="text-[12px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-black dark:text-white" />
      </label>
      {slider('morningHeadache', 'Morning headache 1–5', 5)}
      {slider('daytimeFatigue', 'Daytime fatigue 1–5', 5)}
      {slider('concentration', 'Concentration 1–5', 5)}
      {slider('nightWakeCount', 'Night-wake severity 1–5', 5)}
      <label className="text-[10px] text-gray-500 dark:text-gray-400 block">
        <span className="block mb-0.5">Notes</span>
        <textarea value={d.notes} onChange={e => set('notes', e.target.value)} rows={2}
          className="w-full text-[12px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-black dark:text-white" />
      </label>
      <div className="flex gap-2">
        <button type="submit" className="text-[11px] px-3 py-1 bg-indigo-500 text-white rounded cursor-pointer hover:opacity-80">
          {initial ? 'Save' : 'Add'}
        </button>
        <button type="button" onClick={onCancel} className="text-[11px] px-3 py-1 text-gray-400 cursor-pointer hover:text-gray-600">Cancel</button>
      </div>
    </form>
  );
}

function SleepRow({ rec, onEdit, onDelete }) {
  return (
    <div className="py-2 px-1 border-b border-gray-100 dark:border-gray-800/50 group">
      <div className="flex items-center gap-3">
        <span className="text-[10px] text-gray-400 w-20 shrink-0">{rec.date}</span>
        <div className="flex items-center gap-3 flex-1 text-[12px]">
          {rec.snoreMin != null && (
            <span className={`tabular-nums font-medium ${snoreColor(rec.snoreMin)}`}>
              <i className="fa-solid fa-volume-high text-[9px] mr-1" />{rec.snoreMin}m
            </span>
          )}
          {rec.effectiveInterventionPct != null && (
            <span className={`tabular-nums ${severityColor(rec.effectiveInterventionPct)}`}>
              {rec.effectiveInterventionPct}%
            </span>
          )}
          {rec.totalSleepMin != null && (
            <span className="text-blue-500 tabular-nums">
              <i className="fa-solid fa-bed text-[9px] mr-1" />{fmtMin(rec.totalSleepMin)}
            </span>
          )}
          {rec.spo2Min != null && (
            <span className="text-cyan-500 tabular-nums text-[11px]">SpO₂ {rec.spo2Min}</span>
          )}
          {rec.source && rec.source !== 'manual' && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">{rec.source}</span>
          )}
        </div>
        <div className="opacity-0 group-hover:opacity-100 transition flex gap-1">
          <button onClick={onEdit} className="text-[9px] text-gray-400 hover:text-black dark:hover:text-white px-1 cursor-pointer">edit</button>
          <button onClick={onDelete} className="text-[9px] text-red-400 hover:text-red-600 px-1 cursor-pointer">×</button>
        </div>
      </div>
      {rec.notes && <div className="text-[10px] text-gray-500 mt-1 ml-20">{rec.notes}</div>}
    </div>
  );
}

function SymptomRow({ rec, onEdit, onDelete }) {
  return (
    <div className="py-2 px-1 border-b border-gray-100 dark:border-gray-800/50 group">
      <div className="flex items-center gap-3">
        <span className="text-[10px] text-gray-400 w-20 shrink-0">{rec.date}</span>
        <div className="flex items-center gap-3 flex-1 text-[11px]">
          {rec.morningHeadache != null && <span>頭痛 <span className="font-medium">{rec.morningHeadache}</span>/5</span>}
          {rec.daytimeFatigue != null && <span>疲倦 <span className="font-medium">{rec.daytimeFatigue}</span>/5</span>}
          {rec.concentration != null && <span>專注 <span className="font-medium">{rec.concentration}</span>/5</span>}
          {rec.nightWakeCount != null && <span>夜醒 <span className="font-medium">{rec.nightWakeCount}</span>/5</span>}
        </div>
        <div className="opacity-0 group-hover:opacity-100 transition flex gap-1">
          <button onClick={onEdit} className="text-[9px] text-gray-400 hover:text-black dark:hover:text-white px-1 cursor-pointer">edit</button>
          <button onClick={onDelete} className="text-[9px] text-red-400 hover:text-red-600 px-1 cursor-pointer">×</button>
        </div>
      </div>
      {rec.notes && <div className="text-[10px] text-gray-500 mt-1 ml-20">{rec.notes}</div>}
    </div>
  );
}

function SettingsPanel({ user, onSaved }) {
  const [d, setD] = useState({
    sleepReminderEnabled: !!user?.sleepReminderEnabled,
    sleepReminderHour: user?.sleepReminderHour ?? 23,
    sleepReminderMinute: user?.sleepReminderMinute ?? 0,
    sleepCleanReminderEnabled: !!user?.sleepCleanReminderEnabled,
    sleepCleanReminderDow: user?.sleepCleanReminderDow ?? 0,
    sleepCleanReminderHour: user?.sleepCleanReminderHour ?? 10,
    sleepCleanReminderMinute: user?.sleepCleanReminderMinute ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  async function save() {
    setSaving(true);
    try {
      const token = getStoredToken();
      const res = await fetch('/api/user', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(d),
      });
      if (res.ok) onSaved?.(await res.json());
    } catch (e) { console.error(e); }
    setSaving(false);
  }
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 mb-4 bg-gray-50 dark:bg-gray-900/50 space-y-3">
      <div className="text-[10px] text-gray-400 uppercase tracking-wider"><i className="fa-solid fa-bell mr-1" />LINE Reminders</div>
      <label className="flex items-center gap-2 text-[12px]">
        <input type="checkbox" checked={d.sleepReminderEnabled} onChange={e => setD({ ...d, sleepReminderEnabled: e.target.checked })}
          className="accent-indigo-500" />
        <span>Nightly 戴添眠 reminder</span>
      </label>
      {d.sleepReminderEnabled && (
        <div className="flex items-center gap-2 ml-6 text-[11px]">
          <span>at</span>
          <input type="number" min="0" max="23" value={d.sleepReminderHour}
            onChange={e => setD({ ...d, sleepReminderHour: parseInt(e.target.value) || 0 })}
            className="w-14 text-[12px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1" />
          <span>:</span>
          <input type="number" min="0" max="59" value={d.sleepReminderMinute}
            onChange={e => setD({ ...d, sleepReminderMinute: parseInt(e.target.value) || 0 })}
            className="w-14 text-[12px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1" />
        </div>
      )}
      <label className="flex items-center gap-2 text-[12px]">
        <input type="checkbox" checked={d.sleepCleanReminderEnabled} onChange={e => setD({ ...d, sleepCleanReminderEnabled: e.target.checked })}
          className="accent-indigo-500" />
        <span>Weekly device cleaning reminder</span>
      </label>
      {d.sleepCleanReminderEnabled && (
        <div className="flex items-center gap-2 ml-6 text-[11px] flex-wrap">
          <select value={d.sleepCleanReminderDow}
            onChange={e => setD({ ...d, sleepCleanReminderDow: parseInt(e.target.value) })}
            className="text-[12px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1">
            {dows.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
          <span>at</span>
          <input type="number" min="0" max="23" value={d.sleepCleanReminderHour}
            onChange={e => setD({ ...d, sleepCleanReminderHour: parseInt(e.target.value) || 0 })}
            className="w-14 text-[12px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1" />
          <span>:</span>
          <input type="number" min="0" max="59" value={d.sleepCleanReminderMinute}
            onChange={e => setD({ ...d, sleepCleanReminderMinute: parseInt(e.target.value) || 0 })}
            className="w-14 text-[12px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1" />
        </div>
      )}
      <button onClick={save} disabled={saving}
        className="text-[11px] px-3 py-1 bg-black text-white dark:bg-white dark:text-black rounded cursor-pointer hover:opacity-80 disabled:opacity-40">
        {saving ? 'Saving...' : 'Save reminders'}
      </button>
    </div>
  );
}

export default function SleepView({ embedded }) {
  const [records, setRecords] = useState([]);
  const [symptoms, setSymptoms] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showSymAdd, setShowSymAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingSymId, setEditingSymId] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importParsing, setImportParsing] = useState(false);
  const [importError, setImportError] = useState('');

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const token = getStoredToken();
      const [s, sym, u] = await Promise.all([
        fetch('/api/sleep', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : []),
        fetch('/api/sleep/symptoms', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : []),
        fetch('/api/user', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : null),
      ]);
      setRecords(s); setSymptoms(sym); setUser(u);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function addRecord(data) {
    const token = getStoredToken();
    const res = await fetch('/api/sleep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const row = await res.json();
      setRecords(prev => [row, ...prev]);
      setShowAdd(false);
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to save');
    }
  }

  async function updateRecord(id, data) {
    const token = getStoredToken();
    const res = await fetch(`/api/sleep/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const row = await res.json();
      setRecords(prev => prev.map(r => r.id === id ? row : r));
      setEditingId(null);
    }
  }

  async function deleteRecord(id) {
    if (!confirm('Delete this sleep record?')) return;
    const token = getStoredToken();
    await fetch(`/api/sleep/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    setRecords(prev => prev.filter(r => r.id !== id));
  }

  async function addSym(data) {
    const token = getStoredToken();
    const res = await fetch('/api/sleep/symptoms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const row = await res.json();
      setSymptoms(prev => [row, ...prev]);
      setShowSymAdd(false);
    }
  }

  async function updateSym(id, data) {
    const token = getStoredToken();
    const res = await fetch(`/api/sleep/symptoms/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const row = await res.json();
      setSymptoms(prev => prev.map(r => r.id === id ? row : r));
      setEditingSymId(null);
    }
  }

  async function deleteSym(id) {
    if (!confirm('Delete this entry?')) return;
    const token = getStoredToken();
    await fetch(`/api/sleep/symptoms/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    setSymptoms(prev => prev.filter(r => r.id !== id));
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportParsing(true);
    setImportError('');
    setImportPreview(null);
    try {
      const token = getStoredToken();
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch('/api/sleep/import-image', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (res.ok) {
        const { parsed } = await res.json();
        setImportPreview(parsed);
      } else {
        const err = await res.json();
        setImportError(err.error || 'Failed to parse image');
      }
    } catch (err) {
      setImportError('Failed to upload image');
    }
    setImportParsing(false);
    e.target.value = '';
  }

  async function confirmImport() {
    if (!importPreview) return;
    const { source, ...rest } = importPreview;
    await addRecord({ ...rest, source: source || 'import' });
    setImportPreview(null);
  }

  const stats = useMemo(() => {
    if (records.length === 0) return null;
    const withSnore = records.filter(r => r.snoreMin != null);
    const withInt = records.filter(r => r.effectiveInterventionPct != null);
    const withSpo2 = records.filter(r => r.spo2Min != null);
    const withTotal = records.filter(r => r.totalSleepMin != null);
    return {
      nights: records.length,
      avgSnore: withSnore.length ? Math.round(withSnore.reduce((s, r) => s + r.snoreMin, 0) / withSnore.length) : null,
      avgInt: withInt.length ? Math.round(withInt.reduce((s, r) => s + r.effectiveInterventionPct, 0) / withInt.length) : null,
      avgSpo2: withSpo2.length ? Math.round(withSpo2.reduce((s, r) => s + r.spo2Min, 0) / withSpo2.length) : null,
      avgTotal: withTotal.length ? Math.round(withTotal.reduce((s, r) => s + r.totalSleepMin, 0) / withTotal.length) : null,
      latest: records[0],
    };
  }, [records]);

  if (loading) {
    return (
      <div className={embedded ? "flex items-center justify-center py-12" : "padding-x py-4 max-lg:mt-12 dark:bg-black dark:text-white min-h-screen flex items-center justify-center"}>
        <div className="text-gray-400 text-sm"><i className="fa-solid fa-spinner animate-spin mr-2" />Loading...</div>
      </div>
    );
  }

  const content = (
    <>
      <div className="flex items-baseline justify-between mb-4 px-1">
        <h2 className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-2">
          <i className="fa-solid fa-moon text-indigo-400" />
          Sleep · 添眠
        </h2>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-gray-400 hover:text-black dark:hover:text-white transition cursor-pointer">
            <i className="fa-solid fa-camera text-[9px] mr-1" />Import screenshot
            <input type="file" accept="image/*" onChange={handleImportFile} className="hidden" />
          </label>
          <button onClick={() => setShowSettings(s => !s)} className="text-[10px] text-gray-400 hover:text-black dark:hover:text-white transition cursor-pointer">
            <i className="fa-solid fa-bell text-[9px] mr-1" />Reminders
          </button>
          <button onClick={() => { setShowAdd(s => !s); setEditingId(null); }} className="text-[10px] text-gray-400 hover:text-black dark:hover:text-white transition cursor-pointer">
            <i className={`fa-solid ${showAdd ? 'fa-xmark' : 'fa-plus'} text-[9px] mr-1`} />{showAdd ? 'Cancel' : 'Add night'}
          </button>
        </div>
      </div>

      {showSettings && <SettingsPanel user={user} onSaved={(u) => { setUser(u); setShowSettings(false); }} />}
      {showAdd && <SleepForm onSubmit={addRecord} onCancel={() => setShowAdd(false)} />}

      {(importParsing || importPreview || importError) && (
        <div className="mb-4 border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-gray-50 dark:bg-gray-900/50">
          {importParsing && (
            <div className="flex items-center justify-center py-6">
              <i className="fa-solid fa-spinner animate-spin text-gray-400 mr-2" />
              <span className="text-xs text-gray-400">AI parsing screenshot...</span>
            </div>
          )}
          {importError && (
            <div>
              <p className="text-[11px] text-red-500 mb-2">{importError}</p>
              <button onClick={() => setImportError('')} className="text-[10px] text-gray-400 cursor-pointer">Close</button>
            </div>
          )}
          {importPreview && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-400 uppercase tracking-wider">
                  Detected: <span className="text-indigo-500">{importPreview.source || 'unknown'}</span> · {importPreview.date}
                </span>
                <div className="flex gap-1.5">
                  <button onClick={confirmImport} className="text-[10px] px-2.5 py-1 bg-black text-white dark:bg-white dark:text-black rounded cursor-pointer hover:opacity-80">
                    <i className="fa-solid fa-check mr-1" />Save
                  </button>
                  <button onClick={() => setImportPreview(null)} className="text-[10px] px-2 py-1 text-gray-400 cursor-pointer">Cancel</button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                {importPreview.snoreMin != null && <div>Snore: <span className="font-medium text-amber-500">{importPreview.snoreMin}m</span></div>}
                {importPreview.effectiveInterventionPct != null && <div>Effective: <span className="font-medium text-emerald-500">{importPreview.effectiveInterventionPct}%</span></div>}
                {importPreview.snoreIntensityDropDb != null && <div>dB drop: <span className="font-medium">{importPreview.snoreIntensityDropDb}</span></div>}
                {importPreview.interventionMin != null && <div>Intervention: <span className="font-medium">{importPreview.interventionMin}m</span></div>}
                {importPreview.offPillowCount != null && <div>Off-pillow: <span className="font-medium">{importPreview.offPillowCount}</span></div>}
                {importPreview.totalSleepMin != null && <div>Total: <span className="font-medium text-blue-500">{fmtMin(importPreview.totalSleepMin)}</span></div>}
                {importPreview.deepSleepMin != null && <div>Deep: <span className="font-medium">{fmtMin(importPreview.deepSleepMin)}</span></div>}
                {importPreview.remSleepMin != null && <div>REM: <span className="font-medium">{fmtMin(importPreview.remSleepMin)}</span></div>}
                {importPreview.spo2Min != null && <div>SpO₂ min: <span className="font-medium text-cyan-500">{importPreview.spo2Min}</span></div>}
                {importPreview.spo2Avg != null && <div>SpO₂ avg: <span className="font-medium">{importPreview.spo2Avg}</span></div>}
                {importPreview.hrAvg != null && <div>HR avg: <span className="font-medium">{importPreview.hrAvg}</span></div>}
              </div>
            </div>
          )}
        </div>
      )}

      {stats?.latest && (
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/40 bg-gradient-to-br from-indigo-50/40 to-blue-50/40 dark:from-indigo-950/20 dark:to-blue-950/20 p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-gray-400 uppercase tracking-wider">Last Night · {stats.latest.date}</span>
            {stats.latest.source && stats.latest.source !== 'manual' && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300">{stats.latest.source}</span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2 mb-2">
            <div className="text-center">
              <div className={`text-lg font-light tabular-nums ${snoreColor(stats.latest.snoreMin)}`}>{stats.latest.snoreMin ?? '—'}</div>
              <div className="text-[9px] text-gray-400">snore min</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-light tabular-nums ${severityColor(stats.latest.effectiveInterventionPct)}`}>
                {stats.latest.effectiveInterventionPct != null ? `${stats.latest.effectiveInterventionPct}%` : '—'}
              </div>
              <div className="text-[9px] text-gray-400">effective</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-light text-yellow-500 tabular-nums">{stats.latest.snoreIntensityDropDb ?? '—'}</div>
              <div className="text-[9px] text-gray-400">dB drop</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-light text-gray-500 tabular-nums">{stats.latest.offPillowCount ?? '—'}</div>
              <div className="text-[9px] text-gray-400">off-pillow</div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="text-center">
              <div className="text-lg font-light text-blue-500 tabular-nums">{fmtMin(stats.latest.totalSleepMin)}</div>
              <div className="text-[9px] text-gray-400">total</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-light text-purple-500 tabular-nums">{fmtMin(stats.latest.deepSleepMin)}</div>
              <div className="text-[9px] text-gray-400">deep</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-light text-cyan-500 tabular-nums">{stats.latest.spo2Min ?? '—'}</div>
              <div className="text-[9px] text-gray-400">SpO₂ min</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-light text-cyan-400 tabular-nums">{stats.latest.spo2Avg ?? '—'}</div>
              <div className="text-[9px] text-gray-400">SpO₂ avg</div>
            </div>
          </div>
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-4 gap-2 mb-4">
          <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
            <div className="text-base font-light text-indigo-500 tabular-nums">{stats.nights}</div>
            <div className="text-[9px] text-gray-400 uppercase">nights</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
            <div className="text-base font-light text-amber-500 tabular-nums">{stats.avgSnore ?? '—'}</div>
            <div className="text-[9px] text-gray-400 uppercase">avg snore</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
            <div className="text-base font-light text-emerald-500 tabular-nums">{stats.avgInt != null ? `${stats.avgInt}%` : '—'}</div>
            <div className="text-[9px] text-gray-400 uppercase">avg eff</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
            <div className="text-base font-light text-cyan-500 tabular-nums">{stats.avgSpo2 ?? '—'}</div>
            <div className="text-[9px] text-gray-400 uppercase">avg SpO₂ min</div>
          </div>
        </div>
      )}

      <GlossaryPanel />

      <div className="space-y-2 mb-4">
        <div className="text-[10px] text-gray-400 uppercase tracking-wider">30-day trends</div>
        <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Snore minutes (60m line)</div>
          <SnoreChart data={records} />
        </div>
        <TrendLine data={records} getValue={d => d.effectiveInterventionPct} color="#10b981" label="Effective intervention %" unit="%" target={60} />
        <TrendLine data={records} getValue={d => d.totalSleepMin && d.deepSleepMin ? Math.round((d.deepSleepMin / d.totalSleepMin) * 100) : null} color="#a855f7" label="Deep sleep %" unit="%" target={20} />
        <TrendLine data={records} getValue={d => d.spo2Min} color="#06b6d4" label="SpO₂ minimum" unit="%" target={90} />
      </div>

      <div className="border-t border-gray-200 dark:border-gray-800 mt-4">
        {records.length === 0 && (
          <div className="py-12 text-center">
            <i className="fa-solid fa-moon text-gray-200 dark:text-gray-700 text-3xl mb-3 block" />
            <p className="text-xs text-gray-400">No sleep records yet</p>
            <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-1">Add manually or import from 添眠 / Samsung Health screenshot</p>
          </div>
        )}
        {records.map(rec => (
          editingId === rec.id ? (
            <SleepForm key={rec.id} initial={rec} onSubmit={(d) => updateRecord(rec.id, d)} onCancel={() => setEditingId(null)} />
          ) : (
            <SleepRow key={rec.id} rec={rec} onEdit={() => setEditingId(rec.id)} onDelete={() => deleteRecord(rec.id)} />
          )
        ))}
      </div>

      <div className="mt-8 mb-3 flex items-baseline justify-between px-1">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-2">
          <i className="fa-solid fa-clipboard-list text-indigo-400 text-[10px]" />
          Symptom diary
        </h3>
        <button onClick={() => { setShowSymAdd(s => !s); setEditingSymId(null); }}
          className="text-[10px] text-gray-400 hover:text-black dark:hover:text-white cursor-pointer">
          <i className={`fa-solid ${showSymAdd ? 'fa-xmark' : 'fa-plus'} text-[9px] mr-1`} />{showSymAdd ? 'Cancel' : 'Add entry'}
        </button>
      </div>
      {showSymAdd && <SymptomForm onSubmit={addSym} onCancel={() => setShowSymAdd(false)} />}
      <div className="border-t border-gray-200 dark:border-gray-800">
        {symptoms.length === 0 && (
          <div className="py-8 text-center text-[11px] text-gray-400">
            Track morning headache / daytime fatigue / concentration / night wake count over time.
          </div>
        )}
        {symptoms.map(rec => (
          editingSymId === rec.id ? (
            <SymptomForm key={rec.id} initial={rec} onSubmit={(d) => updateSym(rec.id, d)} onCancel={() => setEditingSymId(null)} />
          ) : (
            <SymptomRow key={rec.id} rec={rec} onEdit={() => setEditingSymId(rec.id)} onDelete={() => deleteSym(rec.id)} />
          )
        ))}
      </div>
    </>
  );

  if (embedded) return content;
  return (
    <div className="padding-x py-4 max-lg:mt-12 dark:bg-black dark:text-white min-h-screen pb-20">
      <div className="max-w-2xl mx-auto">{content}</div>
    </div>
  );
}
