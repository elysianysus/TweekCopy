import React, { useState, useEffect, useMemo } from 'react';
import { getStoredToken } from '../../scripts/api';

function stepsCategory(steps) {
  if (steps >= 10000) return { label: 'Excellent', color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-950/30', dot: 'bg-green-500' };
  if (steps >= 7500) return { label: 'Active', color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/30', dot: 'bg-emerald-500' };
  if (steps >= 5000) return { label: 'Moderate', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30', dot: 'bg-amber-500' };
  if (steps >= 2500) return { label: 'Light', color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-950/30', dot: 'bg-orange-400' };
  return { label: 'Low', color: 'text-red-400', bg: 'bg-red-50 dark:bg-red-950/30', dot: 'bg-red-400' };
}

function MiniChart({ data }) {
  if (!data || data.length < 2) return null;
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const last30 = sorted.slice(-30);

  const allSteps = last30.map(d => d.steps);
  const maxV = Math.max(...allSteps, 10000) * 1.1;

  const w = 100;
  const h = 40;
  const barW = w / last30.length;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h + 2}`} className="w-full h-28" preserveAspectRatio="none">
        <line x1="0" y1={h - (10000 / maxV) * h} x2={w} y2={h - (10000 / maxV) * h}
          stroke="currentColor" strokeWidth="0.3" strokeDasharray="2 2" className="text-green-300 dark:text-green-800" />
        {last30.map((d, i) => {
          const barH = (d.steps / maxV) * h;
          const cat = stepsCategory(d.steps);
          const colorMap = {
            'bg-green-500': '#22c55e', 'bg-emerald-500': '#10b981',
            'bg-amber-500': '#f59e0b', 'bg-orange-400': '#fb923c', 'bg-red-400': '#f87171',
          };
          return (
            <rect key={i} x={i * barW + barW * 0.1} y={h - barH} width={barW * 0.8} height={barH}
              fill={colorMap[cat.dot] || '#94a3b8'} rx="0.5" opacity="0.8" />
          );
        })}
      </svg>
      <div className="flex items-center justify-center gap-4 mt-1 text-[9px]">
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-green-500 rounded-sm inline-block" />10k+</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-500 rounded-sm inline-block" />5k+</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-400 rounded-sm inline-block" />&lt;2.5k</span>
        <span className="text-green-300 dark:text-green-700">--- 10k goal</span>
      </div>
    </div>
  );
}

function DistanceChart({ data }) {
  if (!data || data.length < 2) return null;
  const sorted = [...data].filter(d => d.distance).sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return null;
  const last30 = sorted.slice(-30);
  const values = last30.map(d => {
    const m = d.distance.match(/([\d.]+)/);
    return m ? parseFloat(m[1]) : 0;
  });
  const maxV = Math.max(...values, 5) * 1.1;
  const w = 100; const h = 40;
  const step = w / (last30.length - 1 || 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / maxV) * h).toFixed(1)}`).join(' ');

  return (
    <div className="w-full mb-4">
      <svg viewBox={`-2 -2 ${w + 4} ${h + 4}`} className="w-full h-24" preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke="#6366f1" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="flex items-center justify-center gap-4 mt-1 text-[9px]">
        <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-indigo-500 rounded inline-block" />Distance (km)</span>
      </div>
    </div>
  );
}

function StatsCard({ records }) {
  if (!records || records.length === 0) return null;
  const avgSteps = Math.round(records.reduce((s, r) => s + r.steps, 0) / records.length);
  const maxSteps = Math.max(...records.map(r => r.steps));
  const cat = stepsCategory(avgSteps);

  const totalDist = records.reduce((s, r) => {
    if (!r.distance) return s;
    const m = r.distance.match(/([\d.]+)/);
    return s + (m ? parseFloat(m[1]) : 0);
  }, 0);

  return (
    <div className="grid grid-cols-4 gap-2 mb-4">
      <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
        <div className="text-lg font-light text-blue-500 tabular-nums">{avgSteps.toLocaleString()}</div>
        <div className="text-[9px] text-gray-400 uppercase">avg/day</div>
      </div>
      <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
        <div className="text-lg font-light text-purple-500 tabular-nums">{maxSteps.toLocaleString()}</div>
        <div className="text-[9px] text-gray-400 uppercase">best day</div>
      </div>
      <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
        <div className="text-lg font-light text-gray-500 tabular-nums">{totalDist > 0 ? totalDist.toFixed(1) : '—'}</div>
        <div className="text-[9px] text-gray-400 uppercase">total km</div>
      </div>
      <div className={`text-center p-2 rounded-lg ${cat.bg}`}>
        <div className={`text-lg font-light ${cat.color}`}>{cat.label}</div>
        <div className="text-[9px] text-gray-400 uppercase">{records.length} days</div>
      </div>
    </div>
  );
}

export default function StepsView({ embedded, filterField }) {
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
      const res = await fetch('/api/steps', {
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
    const res = await fetch('/api/steps', {
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
    const res = await fetch(`/api/steps/${id}`, {
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
        const res = await fetch('/api/steps/import-text', {
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
        const res = await fetch('/api/steps/import-image', {
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
      const res = await fetch('/api/steps/bulk', {
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
    await fetch(`/api/steps/${id}`, {
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

  const isFilterView = filterField === 'distance' || filterField === 'walkTime' || filterField === 'remarks';

  if (isFilterView) {
    return <FilteredFieldView records={filtered} field={filterField} groupedByDate={groupedByDate}
      availableMonths={availableMonths} monthFilter={monthFilter} setMonthFilter={setMonthFilter}
      onEdit={(id, data) => updateRecord(id, data)} onDelete={deleteRecord}
      editingId={editingId} setEditingId={setEditingId} />;
  }

  const content = (
    <>
      <div className="flex items-baseline justify-between mb-4 px-1">
        <h2 className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-2">
          <i className="fa-solid fa-shoe-prints text-blue-400" />
          Steps
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

      {showAdd && <StepsForm onSubmit={addRecord} onCancel={() => setShowAdd(false)} />}

      {(importParsing || importRecords) && (
        <div className="mb-4 border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-gray-50 dark:bg-gray-900/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] text-gray-400 uppercase tracking-wider">
              <i className="fa-solid fa-file-import text-[9px] mr-1" />
              {importParsing ? 'AI parsing...' : `Found ${importRecords?.length || 0} records`}
            </span>
            {!importParsing && (
              <div className="flex gap-1.5">
                <button onClick={confirmImport} disabled={importSaving || !importRecords?.some(r => r._selected)} className="text-[10px] px-2.5 py-1 bg-black text-white dark:bg-white dark:text-black rounded cursor-pointer hover:opacity-80 transition disabled:opacity-40">
                  <i className="fa-solid fa-check text-[9px] mr-1" />{importSaving ? 'Saving...' : `Import (${importRecords?.filter(r => r._selected).length || 0})`}
                </button>
                <button onClick={() => { setImportRecords(null); setImportError(''); }} className="text-[10px] px-2 py-1 text-gray-400 hover:text-gray-600 cursor-pointer transition">Cancel</button>
              </div>
            )}
          </div>
          {importParsing && (
            <div className="flex items-center justify-center py-8">
              <i className="fa-solid fa-spinner animate-spin text-gray-400 mr-2" />
              <span className="text-xs text-gray-400">Parsing step data with AI...</span>
            </div>
          )}
          {importError && <p className="text-[10px] text-red-400 mb-2">{importError}</p>}
          {importRecords && (
            <div className="max-h-[60vh] overflow-y-auto space-y-1">
              {importRecords.map((rec, idx) => {
                const cat = stepsCategory(rec.steps);
                return (
                  <div key={idx} onClick={() => toggleImportRecord(idx)} className={`flex items-center gap-2 py-2 px-2 rounded-lg cursor-pointer transition ${rec._selected ? 'bg-white dark:bg-gray-800' : 'opacity-40'}`}>
                    <input type="checkbox" checked={rec._selected} readOnly className="w-3.5 h-3.5 accent-black dark:accent-white shrink-0" />
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`w-1.5 h-1.5 rounded-full ${cat.dot} shrink-0`} />
                      <span className="text-[10px] text-gray-400 w-20 shrink-0">{rec.date}</span>
                      <span className="text-[13px] font-medium text-blue-500 tabular-nums">{rec.steps?.toLocaleString()}</span>
                      {rec.distance && <span className="text-[11px] text-gray-400">{rec.distance}</span>}
                      {rec.calories && <span className="text-[11px] text-orange-400">{rec.calories} kcal</span>}
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
        <span className="text-[10px] text-gray-400 ml-auto">{filtered.length} days</span>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-800">
        {groupedByDate.length === 0 && (
          <div className="py-12 text-center">
            <i className="fa-solid fa-shoe-prints text-gray-200 dark:text-gray-700 text-3xl mb-3 block" />
            <p className="text-xs text-gray-400">No step records yet</p>
            <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-1">Add manually or import from Samsung Health screenshot</p>
          </div>
        )}
        {groupedByDate.map(([date, dayRecords]) => (
          <div key={date} className="border-b border-gray-100 dark:border-gray-800/50">
            <div className="text-[10px] text-gray-400 uppercase tracking-wider px-1 pt-3 pb-1 sticky top-0 bg-white/80 dark:bg-black/80 backdrop-blur-sm">
              {formatDateLabel(date)}
            </div>
            {dayRecords.map(rec => (
              editingId === rec.id ? (
                <StepsForm key={rec.id} initial={rec} onSubmit={(d) => updateRecord(rec.id, d)} onCancel={() => setEditingId(null)} />
              ) : (
                <StepsRow key={rec.id} record={rec} onEdit={() => setEditingId(rec.id)} onDelete={() => deleteRecord(rec.id)} />
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

function FilteredFieldView({ records, field, groupedByDate, availableMonths, monthFilter, setMonthFilter, onEdit, onDelete, editingId, setEditingId }) {
  const fieldLabels = { distance: 'Walking Distance', walkTime: 'Walk Time', remarks: 'Remarks' };
  const fieldIcons = { distance: 'fa-solid fa-route', walkTime: 'fa-solid fa-stopwatch', remarks: 'fa-solid fa-pen-clip' };
  const fieldColors = { distance: 'text-indigo-400', walkTime: 'text-teal-400', remarks: 'text-gray-400' };

  const hasData = records.some(r => r[field]);

  if (field === 'distance') {
    const distRecords = records.filter(r => r.distance);
    const totalDist = distRecords.reduce((s, r) => {
      const m = r.distance.match(/([\d.]+)/);
      return s + (m ? parseFloat(m[1]) : 0);
    }, 0);
    const avgDist = distRecords.length > 0 ? totalDist / distRecords.length : 0;
    const maxDist = distRecords.reduce((mx, r) => {
      const m = r.distance.match(/([\d.]+)/);
      return Math.max(mx, m ? parseFloat(m[1]) : 0);
    }, 0);

    return (
      <>
        {distRecords.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
              <div className="text-lg font-light text-indigo-500 tabular-nums">{totalDist.toFixed(1)}</div>
              <div className="text-[9px] text-gray-400 uppercase">total km</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
              <div className="text-lg font-light text-indigo-400 tabular-nums">{avgDist.toFixed(1)}</div>
              <div className="text-[9px] text-gray-400 uppercase">avg km/day</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
              <div className="text-lg font-light text-purple-500 tabular-nums">{maxDist.toFixed(1)}</div>
              <div className="text-[9px] text-gray-400 uppercase">best day</div>
            </div>
          </div>
        )}
        <DistanceChart data={records} />
        <FieldRecordList records={records} field={field} groupedByDate={groupedByDate}
          availableMonths={availableMonths} monthFilter={monthFilter} setMonthFilter={setMonthFilter}
          onEdit={onEdit} onDelete={onDelete} editingId={editingId} setEditingId={setEditingId}
          fieldLabels={fieldLabels} fieldIcons={fieldIcons} fieldColors={fieldColors} hasData={hasData} />
      </>
    );
  }

  if (field === 'walkTime') {
    const wtRecords = records.filter(r => r.walkTime);
    return (
      <>
        {wtRecords.length > 0 && (
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
              <div className="text-lg font-light text-teal-500 tabular-nums">{wtRecords.length}</div>
              <div className="text-[9px] text-gray-400 uppercase">days tracked</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
              <div className="text-lg font-light text-teal-400 tabular-nums">
                {(() => {
                  const totalMin = wtRecords.reduce((s, r) => {
                    const m = r.walkTime.match(/(\d+)/);
                    return s + (m ? parseInt(m[1]) : 0);
                  }, 0);
                  return totalMin >= 60 ? `${Math.floor(totalMin / 60)}h ${totalMin % 60}m` : `${totalMin}m`;
                })()}
              </div>
              <div className="text-[9px] text-gray-400 uppercase">total time</div>
            </div>
          </div>
        )}
        <FieldRecordList records={records} field={field} groupedByDate={groupedByDate}
          availableMonths={availableMonths} monthFilter={monthFilter} setMonthFilter={setMonthFilter}
          onEdit={onEdit} onDelete={onDelete} editingId={editingId} setEditingId={setEditingId}
          fieldLabels={fieldLabels} fieldIcons={fieldIcons} fieldColors={fieldColors} hasData={hasData} />
      </>
    );
  }

  return (
    <FieldRecordList records={records} field={field} groupedByDate={groupedByDate}
      availableMonths={availableMonths} monthFilter={monthFilter} setMonthFilter={setMonthFilter}
      onEdit={onEdit} onDelete={onDelete} editingId={editingId} setEditingId={setEditingId}
      fieldLabels={fieldLabels} fieldIcons={fieldIcons} fieldColors={fieldColors} hasData={hasData} />
  );
}

function FieldRecordList({ records, field, groupedByDate, availableMonths, monthFilter, setMonthFilter, onEdit, onDelete, editingId, setEditingId, fieldLabels, fieldIcons, fieldColors, hasData }) {
  return (
    <>
      <div className="flex items-center gap-2 mb-4 px-1">
        {availableMonths.length > 0 && (
          <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
            className="text-[11px] bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-gray-600 dark:text-gray-400 cursor-pointer">
            {availableMonths.map(m => <option key={m} value={m}>{m}</option>)}
            <option value="">All time</option>
          </select>
        )}
        <span className="text-[10px] text-gray-400 ml-auto">{records.filter(r => r[field]).length} entries</span>
      </div>
      <div className="border-t border-gray-200 dark:border-gray-800">
        {!hasData && (
          <div className="py-12 text-center">
            <i className={`${fieldIcons[field]} text-gray-200 dark:text-gray-700 text-3xl mb-3 block`} />
            <p className="text-xs text-gray-400">No {fieldLabels[field]?.toLowerCase()} data yet</p>
            <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-1">Add data via the Steps tab when creating records</p>
          </div>
        )}
        {groupedByDate.map(([date, dayRecords]) => {
          const relevantRecords = dayRecords.filter(r => r[field]);
          if (relevantRecords.length === 0) return null;
          return (
            <div key={date} className="border-b border-gray-100 dark:border-gray-800/50">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider px-1 pt-3 pb-1 sticky top-0 bg-white/80 dark:bg-black/80 backdrop-blur-sm">
                {formatDateLabel(date)}
              </div>
              {relevantRecords.map(rec => (
                <div key={rec.id} className="flex items-center py-2.5 px-1 group">
                  <i className={`${fieldIcons[field]} text-[10px] ${fieldColors[field]} mr-3`} />
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-[13px] font-medium tabular-nums">{rec[field]}</span>
                    <span className="text-[10px] text-gray-400">{rec.steps.toLocaleString()} steps</span>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                    <button onClick={() => setEditingId(rec.id)} className="text-[10px] text-gray-400 hover:text-blue-500 cursor-pointer p-1">
                      <i className="fa-solid fa-pen text-[9px]" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
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

function StepsRow({ record, onEdit, onDelete }) {
  const cat = stepsCategory(record.steps);

  return (
    <div className="flex items-center py-2.5 px-1 group">
      <div className={`w-1.5 h-1.5 rounded-full ${cat.dot} mr-3 shrink-0`} />
      <div className="flex items-center gap-3 flex-1 min-w-0 flex-wrap">
        <div className="flex items-baseline gap-1">
          <span className="text-[15px] font-medium text-blue-500 tabular-nums">{record.steps.toLocaleString()}</span>
          <span className="text-[10px] text-gray-400">steps</span>
        </div>
        {record.distance && (
          <div className="flex items-baseline gap-0.5">
            <i className="fa-solid fa-route text-[7px] text-gray-300 dark:text-gray-600" />
            <span className="text-[12px] text-gray-500 tabular-nums">{record.distance}</span>
          </div>
        )}
        {record.walkTime && (
          <div className="flex items-baseline gap-0.5">
            <i className="fa-solid fa-stopwatch text-[7px] text-teal-400" />
            <span className="text-[12px] text-teal-500 tabular-nums">{record.walkTime}</span>
          </div>
        )}
        {record.calories && (
          <div className="flex items-baseline gap-0.5">
            <i className="fa-solid fa-fire text-[7px] text-orange-300" />
            <span className="text-[12px] text-orange-400 tabular-nums">{record.calories}</span>
          </div>
        )}
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${cat.bg} ${cat.color} font-medium`}>{cat.label}</span>
        {record.source === 'import' && <span className="text-[8px] text-gray-400">imported</span>}
        {record.remarks && (
          <div className="w-full mt-0.5">
            <span className="text-[10px] text-gray-400 italic">{record.remarks}</span>
          </div>
        )}
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

function StepsForm({ initial, onSubmit, onCancel }) {
  const [date, setDate] = useState(initial?.date || new Date().toISOString().slice(0, 10));
  const [stepsVal, setStepsVal] = useState(initial?.steps?.toString() || '');
  const [distance, setDistance] = useState(initial?.distance || '');
  const [calories, setCalories] = useState(initial?.calories?.toString() || '');
  const [walkTime, setWalkTime] = useState(initial?.walkTime || '');
  const [remarks, setRemarks] = useState(initial?.remarks || '');

  function handleSubmit(e) {
    e.preventDefault();
    if (!stepsVal) return;
    onSubmit({
      date,
      steps: parseInt(stepsVal),
      distance: distance || null,
      calories: calories ? parseInt(calories) : null,
      walkTime: walkTime || null,
      remarks: remarks || null,
    });
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
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">Steps</label>
          <input type="number" value={stepsVal} onChange={e => setStepsVal(e.target.value)} placeholder="8000"
            className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">Distance</label>
          <input type="text" value={distance} onChange={e => setDistance(e.target.value)} placeholder="5.2 km"
            className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white" />
        </div>
        <div>
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">Walk Time</label>
          <input type="text" value={walkTime} onChange={e => setWalkTime(e.target.value)} placeholder="45 min"
            className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white" />
        </div>
        <div>
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">Calories</label>
          <input type="number" value={calories} onChange={e => setCalories(e.target.value)} placeholder="320"
            className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white" />
        </div>
      </div>
      <div>
        <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">Remarks</label>
        <input type="text" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Morning walk in the park..."
          className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white" />
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
