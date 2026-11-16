import React, { useState, useEffect, useMemo } from 'react';
import { getStoredToken } from '../../scripts/api';

function bpCategory(sys, dia) {
  if (sys >= 140 || dia >= 90) return { label: 'High', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950/30', dot: 'bg-red-500' };
  if (sys >= 130 || dia >= 85) return { label: 'Elevated', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30', dot: 'bg-amber-500' };
  if (sys >= 120 || dia >= 80) return { label: 'Pre-high', color: 'text-yellow-500', bg: 'bg-yellow-50 dark:bg-yellow-950/30', dot: 'bg-yellow-500' };
  return { label: 'Normal', color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-950/30', dot: 'bg-green-500' };
}

function pulseCategory(pulse) {
  if (pulse > 100) return 'text-red-500';
  if (pulse > 90) return 'text-amber-500';
  if (pulse < 50) return 'text-blue-500';
  return 'text-green-600 dark:text-green-400';
}

function MiniChart({ data }) {
  if (!data || data.length < 2) return null;
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
  const last30 = sorted.slice(-30);

  const allSys = last30.map(d => d.sys);
  const allDia = last30.map(d => d.dia);
  const allPulse = last30.map(d => d.pulse);
  const minV = Math.min(...allDia, ...allPulse) - 5;
  const maxV = Math.max(...allSys) + 5;
  const range = maxV - minV || 1;

  const w = 100;
  const h = 40;
  const step = w / (last30.length - 1 || 1);

  function polyline(values, color) {
    const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - minV) / range) * h).toFixed(1)}`).join(' ');
    return <polyline points={points} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />;
  }

  return (
    <div className="w-full">
      <svg viewBox={`-2 -2 ${w + 4} ${h + 4}`} className="w-full h-24" preserveAspectRatio="none">
        <line x1="0" y1={h - ((120 - minV) / range) * h} x2={w} y2={h - ((120 - minV) / range) * h}
          stroke="currentColor" strokeWidth="0.3" strokeDasharray="2 2" className="text-red-300 dark:text-red-800" />
        <line x1="0" y1={h - ((80 - minV) / range) * h} x2={w} y2={h - ((80 - minV) / range) * h}
          stroke="currentColor" strokeWidth="0.3" strokeDasharray="2 2" className="text-blue-300 dark:text-blue-800" />
        {polyline(allPulse, '#94a3b8')}
        {polyline(allDia, '#60a5fa')}
        {polyline(allSys, '#ef4444')}
      </svg>
      <div className="flex items-center justify-center gap-4 mt-1 text-[9px]">
        <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-red-500 rounded inline-block" />SYS</span>
        <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-blue-400 rounded inline-block" />DIA</span>
        <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-gray-400 rounded inline-block" />Pulse</span>
        <span className="text-red-300 dark:text-red-700">--- 120</span>
        <span className="text-blue-300 dark:text-blue-700">--- 80</span>
      </div>
    </div>
  );
}

function StatsCard({ records }) {
  if (!records || records.length === 0) return null;
  const avgSys = Math.round(records.reduce((s, r) => s + r.sys, 0) / records.length);
  const avgDia = Math.round(records.reduce((s, r) => s + r.dia, 0) / records.length);
  const avgPulse = Math.round(records.reduce((s, r) => s + r.pulse, 0) / records.length);
  const cat = bpCategory(avgSys, avgDia);

  return (
    <div className="grid grid-cols-4 gap-2 mb-4">
      <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
        <div className="text-lg font-light text-red-500 tabular-nums">{avgSys}</div>
        <div className="text-[9px] text-gray-400 uppercase">SYS avg</div>
      </div>
      <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
        <div className="text-lg font-light text-blue-400 tabular-nums">{avgDia}</div>
        <div className="text-[9px] text-gray-400 uppercase">DIA avg</div>
      </div>
      <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
        <div className="text-lg font-light text-gray-500 tabular-nums">{avgPulse}</div>
        <div className="text-[9px] text-gray-400 uppercase">Pulse avg</div>
      </div>
      <div className={`text-center p-2 rounded-lg ${cat.bg}`}>
        <div className={`text-lg font-light ${cat.color}`}>{cat.label}</div>
        <div className="text-[9px] text-gray-400 uppercase">{records.length} records</div>
      </div>
    </div>
  );
}

export default function BloodPressureView({ embedded }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [importRecords, setImportRecords] = useState(null);
  const [importParsing, setImportParsing] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const [importError, setImportError] = useState('');
  const [monthFilter, setMonthFilter] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  useEffect(() => { loadRecords(); }, []);

  async function loadRecords() {
    setLoading(true);
    try {
      const token = getStoredToken();
      const res = await fetch('/api/blood-pressure', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setRecords(await res.json());
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  async function addRecord(data) {
    const token = getStoredToken();
    const res = await fetch('/api/blood-pressure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const row = await res.json();
      setRecords(prev => [row, ...prev]);
    }
    setShowAdd(false);
  }

  async function updateRecord(id, data) {
    const token = getStoredToken();
    const res = await fetch(`/api/blood-pressure/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const row = await res.json();
      setRecords(prev => prev.map(r => r.id === id ? row : r));
    }
    setEditingId(null);
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportParsing(true);
    setImportError('');
    setImportRecords(null);
    try {
      const token = getStoredToken();
      const isText = file.type.startsWith('text/') || /\.(txt|csv|tsv)$/i.test(file.name);
      if (isText) {
        const text = await file.text();
        const res = await fetch('/api/blood-pressure/import-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text }),
        });
        if (res.ok) {
          const { records: parsed } = await res.json();
          setImportRecords(parsed.map((r, i) => ({ ...r, _selected: true, _id: i })));
        } else {
          const data = await res.json();
          setImportError(data.error || 'Failed to parse text');
        }
      } else {
        const formData = new FormData();
        formData.append('image', file);
        const res = await fetch('/api/blood-pressure/import-image', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (res.ok) {
          const { records: parsed } = await res.json();
          setImportRecords(parsed.map((r, i) => ({ ...r, _selected: true, _id: i })));
        } else {
          const data = await res.json();
          setImportError(data.error || 'Failed to parse image');
        }
      }
    } catch (err) {
      setImportError('Failed to parse file');
    }
    setImportParsing(false);
    e.target.value = '';
  }

  function toggleImportRecord(idx) {
    setImportRecords(prev => prev.map((r, i) => i === idx ? { ...r, _selected: !r._selected } : r));
  }

  async function confirmImport() {
    if (!importRecords) return;
    const selected = importRecords.filter(r => r._selected);
    if (selected.length === 0) return;
    setImportSaving(true);
    try {
      const token = getStoredToken();
      const res = await fetch('/api/blood-pressure/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ records: selected }),
      });
      if (res.ok) {
        const rows = await res.json();
        setRecords(prev => [...rows, ...prev]);
        setImportRecords(null);
      }
    } catch (err) {
      setImportError('Failed to save');
    }
    setImportSaving(false);
  }

  async function deleteRecord(id) {
    const token = getStoredToken();
    await fetch(`/api/blood-pressure/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setRecords(prev => prev.filter(r => r.id !== id));
  }

  const filtered = useMemo(() => {
    if (!monthFilter) return records;
    return records.filter(r => r.date && r.date.startsWith(monthFilter));
  }, [records, monthFilter]);

  const availableMonths = useMemo(() => {
    return [...new Set(records.map(r => r.date ? r.date.slice(0, 7) : null).filter(Boolean))].sort().reverse();
  }, [records]);

  const groupedByDate = useMemo(() => {
    const map = new Map();
    for (const r of filtered) {
      const d = r.date || 'unknown';
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(r);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

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
            <i className="fa-solid fa-heart-pulse text-red-400" />
            Blood Pressure
          </h2>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-gray-400 hover:text-black dark:hover:text-white transition cursor-pointer">
              <i className="fa-solid fa-file-import text-[9px] mr-1" />Import
              <input type="file" accept="image/*,.txt,.csv,.tsv" onChange={handleImportFile} className="hidden" />
            </label>
            <button onClick={() => { setShowAdd(!showAdd); setEditingId(null); }} className="text-[10px] text-gray-400 hover:text-black dark:hover:text-white transition cursor-pointer">
              <i className={`fa-solid ${showAdd ? 'fa-xmark' : 'fa-plus'} text-[9px] mr-1`} />{showAdd ? 'Cancel' : 'Add'}
            </button>
          </div>
        </div>

        {showAdd && <BPForm onSubmit={addRecord} onCancel={() => setShowAdd(false)} />}

        {(importParsing || importRecords) && (
          <div className="mb-4 border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-gray-50 dark:bg-gray-900/50">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">
                <i className="fa-solid fa-file-import text-[9px] mr-1" />
                {importParsing ? 'AI 分析中...' : `已識別 ${importRecords?.length || 0} 筆記錄`}
              </span>
              {!importParsing && (
                <div className="flex gap-1.5">
                  <button onClick={confirmImport} disabled={importSaving || !importRecords?.some(r => r._selected)} className="text-[10px] px-2.5 py-1 bg-black text-white dark:bg-white dark:text-black rounded cursor-pointer hover:opacity-80 transition disabled:opacity-40">
                    <i className="fa-solid fa-check text-[9px] mr-1" />{importSaving ? '儲存中...' : `確認匯入 (${importRecords?.filter(r => r._selected).length || 0})`}
                  </button>
                  <button onClick={() => { setImportRecords(null); setImportError(''); }} className="text-[10px] px-2 py-1 text-gray-400 hover:text-gray-600 cursor-pointer transition">取消</button>
                </div>
              )}
            </div>
            {importParsing && (
              <div className="flex items-center justify-center py-8">
                <i className="fa-solid fa-spinner animate-spin text-gray-400 mr-2" />
                <span className="text-xs text-gray-400">正在用 AI 識別圖片中嘅血壓記錄...</span>
              </div>
            )}
            {importError && <p className="text-[10px] text-red-400 mb-2">{importError}</p>}
            {importRecords && (
              <div className="max-h-[60vh] overflow-y-auto space-y-1">
                {importRecords.map((rec, idx) => {
                  const cat = bpCategory(rec.sys, rec.dia);
                  return (
                    <div key={idx} onClick={() => toggleImportRecord(idx)} className={`flex items-center gap-2 py-2 px-2 rounded-lg cursor-pointer transition ${rec._selected ? 'bg-white dark:bg-gray-800' : 'opacity-40'}`}>
                      <input type="checkbox" checked={rec._selected} readOnly className="w-3.5 h-3.5 accent-black dark:accent-white shrink-0" />
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={`w-1.5 h-1.5 rounded-full ${cat.dot} shrink-0`} />
                        <span className="text-[10px] text-gray-400 w-20 shrink-0">{rec.date}</span>
                        {rec.time && <span className="text-[10px] text-gray-400 w-10 shrink-0">{rec.time}</span>}
                        <span className="text-[13px] font-medium text-red-500 tabular-nums">{rec.sys}</span>
                        <span className="text-[10px] text-gray-300 dark:text-gray-600">/</span>
                        <span className="text-[13px] font-medium text-blue-400 tabular-nums">{rec.dia}</span>
                        <span className="text-[10px] text-gray-300 dark:text-gray-600 mx-1">|</span>
                        <span className="text-[12px] text-gray-500 tabular-nums">{rec.pulse}</span>
                        <span className={`text-[8px] px-1 py-0.5 rounded-full ${cat.bg} ${cat.color} ml-auto`}>{cat.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        
        <MiniChart data={filtered} />
        <StatsCard records={filtered} />

        <div className="flex items-center gap-2 mb-4 px-1">
          {availableMonths.length > 0 && (
            <select
              value={monthFilter}
              onChange={e => setMonthFilter(e.target.value)}
              className="text-[11px] bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-gray-600 dark:text-gray-400 cursor-pointer"
            >
              {availableMonths.map(m => <option key={m} value={m}>{m}</option>)}
              <option value="">All time</option>
            </select>
          )}
          <span className="text-[10px] text-gray-400 ml-auto">{filtered.length} records</span>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800">
          {groupedByDate.length === 0 && (
            <div className="py-12 text-center">
              <i className="fa-solid fa-heart-pulse text-gray-200 dark:text-gray-700 text-3xl mb-3 block" />
              <p className="text-xs text-gray-400">No records this month</p>
            </div>
          )}
          {groupedByDate.map(([date, dayRecords]) => (
            <div key={date} className="border-b border-gray-100 dark:border-gray-800/50">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider px-1 pt-3 pb-1 sticky top-0 bg-white/80 dark:bg-black/80 backdrop-blur-sm">
                {formatDateLabel(date)}
              </div>
              {dayRecords.map(rec => (
                editingId === rec.id ? (
                  <BPForm key={rec.id} initial={rec} onSubmit={(d) => updateRecord(rec.id, d)} onCancel={() => setEditingId(null)} />
                ) : (
                  <BPRow key={rec.id} record={rec} onEdit={() => setEditingId(rec.id)} onDelete={() => deleteRecord(rec.id)} />
                )
              ))}
            </div>
          ))}
        </div>
    </>
  );

  if (embedded) return content;

  return (
    <div className="padding-x py-4 max-lg:mt-12 dark:bg-black dark:text-white min-h-screen pb-20">
      <div className="max-w-2xl mx-auto">
        {content}
      </div>
    </div>
  );
}

function formatDateLabel(dateStr) {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${dateStr} (${days[date.getDay()]})`;
  } catch {
    return dateStr;
  }
}

function BPRow({ record, onEdit, onDelete }) {
  const cat = bpCategory(record.sys, record.dia);
  const pc = pulseCategory(record.pulse);

  return (
    <div className="flex items-center py-2.5 px-1 group">
      <div className={`w-1.5 h-1.5 rounded-full ${cat.dot} mr-3 shrink-0`} />
      {record.time && (
        <span className="text-[11px] text-gray-400 w-12 shrink-0 tabular-nums">{record.time}</span>
      )}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex items-baseline gap-0.5">
          <span className="text-[15px] font-medium text-red-500 tabular-nums">{record.sys}</span>
          <span className="text-[10px] text-gray-300 dark:text-gray-600">/</span>
          <span className="text-[15px] font-medium text-blue-400 tabular-nums">{record.dia}</span>
        </div>
        <div className="flex items-baseline gap-0.5">
          <i className="fa-solid fa-heart text-[7px] text-gray-300 dark:text-gray-600" />
          <span className={`text-[13px] tabular-nums ${pc}`}>{record.pulse}</span>
        </div>
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${cat.bg} ${cat.color} font-medium`}>{cat.label}</span>
        {record.source === 'line' && <span className="text-[8px] text-green-500 font-medium">LINE</span>}
        {record.source === 'import' && <span className="text-[8px] text-gray-400">imported</span>}
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
        <button onClick={onEdit} className="text-[10px] text-gray-400 hover:text-blue-500 cursor-pointer p-1">
          <i className="fa-solid fa-pen text-[9px]" />
        </button>
        <button onClick={onDelete} className="text-[10px] text-gray-400 hover:text-red-500 cursor-pointer p-1">
          <i className="fa-solid fa-trash text-[9px]" />
        </button>
      </div>
    </div>
  );
}

function BPForm({ initial, onSubmit, onCancel }) {
  const [date, setDate] = useState(initial?.date || new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(initial?.time || '');
  const [sys, setSys] = useState(initial?.sys?.toString() || '');
  const [dia, setDia] = useState(initial?.dia?.toString() || '');
  const [pulse, setPulse] = useState(initial?.pulse?.toString() || '');

  function handleSubmit(e) {
    e.preventDefault();
    if (!sys || !dia || !pulse) return;
    onSubmit({ date, time: time || null, sys: parseInt(sys), dia: parseInt(dia), pulse: parseInt(pulse) });
  }

  return (
    <form onSubmit={handleSubmit} className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white" />
        </div>
        <div>
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">Time</label>
          <input type="time" value={time} onChange={e => setTime(e.target.value)}
            className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">SYS</label>
          <input type="number" value={sys} onChange={e => setSys(e.target.value)} placeholder="120"
            className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white" />
        </div>
        <div>
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">DIA</label>
          <input type="number" value={dia} onChange={e => setDia(e.target.value)} placeholder="80"
            className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white" />
        </div>
        <div>
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">PULSE</label>
          <input type="number" value={pulse} onChange={e => setPulse(e.target.value)} placeholder="72"
            className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white" />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="flex-1 text-xs bg-black text-white dark:bg-white dark:text-black py-2 rounded cursor-pointer hover:opacity-80 transition">
          {initial ? 'Update' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-gray-400 px-3 py-2 cursor-pointer hover:text-gray-600 transition">Cancel</button>
      </div>
    </form>
  );
}
