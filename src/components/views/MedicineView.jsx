import React, { useState, useEffect, useMemo } from 'react';
import { getStoredToken } from '../../scripts/api';

const COMMON_SYMPTOMS = [
  { label: '頭痛', icon: '🤕' },
  { label: '肚痛', icon: '🤢' },
  { label: '發燒', icon: '🤒' },
  { label: '喉嚨痛', icon: '😷' },
  { label: '流鼻水', icon: '🤧' },
  { label: '咳嗽', icon: '😮‍💨' },
  { label: '暈眩', icon: '😵' },
  { label: '失眠', icon: '😴' },
  { label: '腰痛', icon: '🦴' },
  { label: '過敏', icon: '🫁' },
  { label: '胃酸', icon: '💊' },
  { label: '經痛', icon: '🩸' },
];

function severityInfo(sev) {
  if (sev >= 5) return { label: 'Severe', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950/30', dot: 'bg-red-500' };
  if (sev >= 4) return { label: 'Bad', color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-950/30', dot: 'bg-orange-500' };
  if (sev >= 3) return { label: 'Moderate', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30', dot: 'bg-amber-500' };
  if (sev >= 2) return { label: 'Mild', color: 'text-yellow-500', bg: 'bg-yellow-50 dark:bg-yellow-950/30', dot: 'bg-yellow-400' };
  return { label: 'Slight', color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-950/30', dot: 'bg-green-500' };
}

function SymptomStats({ records }) {
  if (!records || records.length === 0) return null;
  const symptomCount = {};
  for (const r of records) {
    symptomCount[r.symptom] = (symptomCount[r.symptom] || 0) + 1;
  }
  const sorted = Object.entries(symptomCount).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = sorted[0]?.[1] || 1;

  return (
    <div className="mb-4">
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
          <div className="text-lg font-light text-pink-500 tabular-nums">{records.length}</div>
          <div className="text-[9px] text-gray-400 uppercase">total logs</div>
        </div>
        <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
          <div className="text-lg font-light text-purple-500 tabular-nums">{Object.keys(symptomCount).length}</div>
          <div className="text-[9px] text-gray-400 uppercase">symptoms</div>
        </div>
        <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
          <div className="text-lg font-light text-amber-500 tabular-nums">
            {(records.reduce((s, r) => s + (r.severity || 3), 0) / records.length).toFixed(1)}
          </div>
          <div className="text-[9px] text-gray-400 uppercase">avg severity</div>
        </div>
      </div>
      <div className="space-y-1">
        {sorted.map(([symptom, count]) => {
          const emoji = COMMON_SYMPTOMS.find(s => s.label === symptom)?.icon || '💊';
          return (
            <div key={symptom} className="flex items-center gap-2 px-1">
              <span className="text-sm w-6 text-center">{emoji}</span>
              <span className="text-[11px] text-gray-600 dark:text-gray-400 w-16 shrink-0 truncate">{symptom}</span>
              <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-pink-400 rounded-full transition-all" style={{ width: `${(count / max) * 100}%` }} />
              </div>
              <span className="text-[10px] text-gray-400 tabular-nums w-6 text-right">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MedicineView({ embedded }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [monthFilter, setMonthFilter] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  useEffect(() => { loadRecords(); }, []);

  async function loadRecords() {
    setLoading(true);
    try {
      const token = getStoredToken();
      const res = await fetch('/api/medicine', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setRecords(await res.json());
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  async function addRecord(data) {
    try {
      const token = getStoredToken();
      const res = await fetch('/api/medicine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const row = await res.json();
        setRecords(prev => [row, ...prev]);
        setShowAdd(false);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function updateRecord(id, data) {
    try {
      const token = getStoredToken();
      const res = await fetch(`/api/medicine/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const row = await res.json();
        setRecords(prev => prev.map(r => r.id === id ? row : r));
        setEditingId(null);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function deleteRecord(id) {
    if (!confirm('Delete this record?')) return;
    try {
      const token = getStoredToken();
      const res = await fetch(`/api/medicine/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setRecords(prev => prev.filter(r => r.id !== id));
      }
    } catch (e) {
      console.error(e);
    }
  }

  const filtered = useMemo(() => {
    if (!monthFilter) return records;
    return records.filter(r => r.date && r.date.startsWith(monthFilter));
  }, [records, monthFilter]);

  const availableMonths = useMemo(() => {
    const months = [...new Set(records.map(r => r.date ? r.date.slice(0, 7) : null).filter(Boolean))].sort().reverse();
    if (months.length > 0 && !months.includes(monthFilter)) {
      setMonthFilter(months[0]);
    }
    return months;
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
          <i className="fa-solid fa-pills text-pink-400" />
          Medicine & Symptoms
        </h2>
        <button onClick={() => { setShowAdd(!showAdd); setEditingId(null); }} className="text-[10px] text-gray-400 hover:text-black dark:hover:text-white transition cursor-pointer">
          <i className={`fa-solid ${showAdd ? 'fa-xmark' : 'fa-plus'} text-[9px] mr-1`} />{showAdd ? 'Cancel' : 'Add'}
        </button>
      </div>

      {showAdd && <MedForm onSubmit={addRecord} onCancel={() => setShowAdd(false)} />}

      <SymptomStats records={filtered} />

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
        <span className="text-[10px] text-gray-400 ml-auto">{filtered.length} logs</span>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-800">
        {groupedByDate.length === 0 && (
          <div className="py-12 text-center">
            <i className="fa-solid fa-pills text-gray-200 dark:text-gray-700 text-3xl mb-3 block" />
            <p className="text-xs text-gray-400">No medicine/symptom logs yet</p>
            <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-1">Record symptoms and medication taken</p>
          </div>
        )}
        {groupedByDate.map(([date, dayRecords]) => (
          <div key={date} className="border-b border-gray-100 dark:border-gray-800/50">
            <div className="text-[10px] text-gray-400 uppercase tracking-wider px-1 pt-3 pb-1 sticky top-0 bg-white/80 dark:bg-black/80 backdrop-blur-sm">
              {formatDateLabel(date)}
            </div>
            {dayRecords.map(rec => (
              editingId === rec.id ? (
                <MedForm key={rec.id} initial={rec} onSubmit={(d) => updateRecord(rec.id, d)} onCancel={() => setEditingId(null)} />
              ) : (
                <MedRow key={rec.id} record={rec} onEdit={() => setEditingId(rec.id)} onDelete={() => deleteRecord(rec.id)} />
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

function MedRow({ record, onEdit, onDelete }) {
  const sev = severityInfo(record.severity || 3);
  const emoji = COMMON_SYMPTOMS.find(s => s.label === record.symptom)?.icon || '💊';

  return (
    <div className="flex items-start py-2.5 px-1 group">
      <div className={`w-1.5 h-1.5 rounded-full ${sev.dot} mr-3 shrink-0 mt-1.5`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm">{emoji}</span>
          <span className="text-[13px] font-medium">{record.symptom}</span>
          {record.time && <span className="text-[10px] text-gray-400 tabular-nums">{record.time}</span>}
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${sev.bg} ${sev.color} font-medium`}>{sev.label}</span>
          <div className="flex gap-0.5 ml-auto">
            {[1,2,3,4,5].map(i => (
              <div key={i} className={`w-1.5 h-1.5 rounded-full ${i <= (record.severity || 3) ? sev.dot : 'bg-gray-200 dark:bg-gray-700'}`} />
            ))}
          </div>
        </div>
        {record.medicine && (
          <div className="flex items-center gap-1 mt-1">
            <i className="fa-solid fa-pills text-[8px] text-pink-300" />
            <span className="text-[11px] text-pink-500">{record.medicine}</span>
            {record.dosage && <span className="text-[10px] text-gray-400">({record.dosage})</span>}
          </div>
        )}
        {record.notes && (
          <p className="text-[10px] text-gray-400 italic mt-0.5">{record.notes}</p>
        )}
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition shrink-0 ml-2">
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

function MedForm({ initial, onSubmit, onCancel }) {
  const [date, setDate] = useState(initial?.date || new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(initial?.time || '');
  const [symptom, setSymptom] = useState(initial?.symptom || '');
  const [medicine, setMedicine] = useState(initial?.medicine || '');
  const [dosage, setDosage] = useState(initial?.dosage || '');
  const [severity, setSeverity] = useState(initial?.severity || 3);
  const [notes, setNotes] = useState(initial?.notes || '');

  function handleSubmit(e) {
    e.preventDefault();
    if (!symptom.trim()) return;
    onSubmit({
      date, time: time || null,
      symptom: symptom.trim(),
      medicine: medicine.trim() || null,
      dosage: dosage.trim() || null,
      severity, notes: notes.trim() || null,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4 space-y-3">
      <div className="flex flex-wrap gap-1.5 mb-1">
        {COMMON_SYMPTOMS.map(s => (
          <button key={s.label} type="button"
            onClick={() => setSymptom(s.label)}
            className={`text-[10px] px-2 py-1 rounded-lg transition cursor-pointer ${
              symptom === s.label
                ? 'bg-pink-500 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}>
            {s.icon} {s.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">Symptom</label>
          <input type="text" value={symptom} onChange={e => setSymptom(e.target.value)} placeholder="頭痛 / Headache"
            className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white" />
        </div>
        <div>
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">Severity (1-5)</label>
          <div className="flex items-center gap-1.5 mt-0.5">
            {[1,2,3,4,5].map(i => (
              <button key={i} type="button" onClick={() => setSeverity(i)}
                className={`w-7 h-7 rounded-full text-[11px] font-medium transition cursor-pointer ${
                  i <= severity
                    ? 'bg-pink-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
                }`}>
                {i}
              </button>
            ))}
          </div>
        </div>
      </div>
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">Medicine</label>
          <input type="text" value={medicine} onChange={e => setMedicine(e.target.value)} placeholder="Panadol / 止痛藥"
            className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white" />
        </div>
        <div>
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">Dosage</label>
          <input type="text" value={dosage} onChange={e => setDosage(e.target.value)} placeholder="1 tablet / 500mg"
            className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white" />
        </div>
      </div>
      <div>
        <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">Notes</label>
        <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="After lunch / 食完飯後好啲..."
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
