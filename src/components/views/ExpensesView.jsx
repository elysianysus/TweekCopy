import React, { useState, useEffect } from 'react';
import { getStoredToken } from '../../scripts/api';
import { EXPENSE_CATEGORIES, getCategoryInfo } from '../../../shared/expenseCategories.js';

const CATEGORY_INFO = EXPENSE_CATEGORIES;
const getCatInfo = getCategoryInfo;

export default function ExpensesView() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState('all');
  const [quickText, setQuickText] = useState('');
  const [quickParsing, setQuickParsing] = useState(false);
  const [quickPreview, setQuickPreview] = useState(null);
  const [quickError, setQuickError] = useState('');
  const [importRecords, setImportRecords] = useState(null);
  const [importParsing, setImportParsing] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const [importError, setImportError] = useState('');
  const [auditLog, setAuditLog] = useState([]);
  const [showAudit, setShowAudit] = useState(false);
  const [monthFilter, setMonthFilter] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  useEffect(() => { loadExpenses(); loadAuditLog(); }, []);

  async function undoAuditEntry(entryId) {
    try {
      const token = getStoredToken();
      const res = await fetch(`/api/expenses/audit-log/${entryId}/undo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Undo failed');
        return;
      }
      setAuditLog(prev => prev.filter(e => e.id !== entryId));
      await loadExpenses();
    } catch (e) {
      console.error(e);
      alert('Undo failed');
    }
  }

  async function loadAuditLog() {
    try {
      const token = getStoredToken();
      const res = await fetch('/api/expenses/audit-log?limit=10', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setAuditLog(await res.json());
    } catch (e) {
      console.error(e);
    }
  }

  async function loadExpenses() {
    setLoading(true);
    try {
      const token = getStoredToken();
      const res = await fetch('/api/expenses', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setExpenses(await res.json());
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  async function deleteExpense(id) {
    const token = getStoredToken();
    await fetch(`/api/expenses/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setExpenses(prev => prev.filter(e => e.id !== id));
  }

  async function quickParse() {
    if (!quickText.trim()) return;
    setQuickParsing(true);
    setQuickError('');
    setQuickPreview(null);
    try {
      const token = getStoredToken();
      const res = await fetch('/api/expenses/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: quickText }),
      });
      if (res.ok) {
        const parsed = await res.json();
        setQuickPreview(parsed);
      } else {
        setQuickError('無法解析，試下寫清楚啲，例如：lunch 133');
      }
    } catch (e) {
      setQuickError('解析失敗，請稍後再試');
    }
    setQuickParsing(false);
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
        const res = await fetch('/api/expenses/import-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text }),
        });
        if (res.ok) {
          const { records } = await res.json();
          setImportRecords(records.map((r, i) => ({ ...r, _selected: true, _id: i })));
        } else {
          const data = await res.json();
          setImportError(data.error || 'Failed to parse text');
        }
      } else {
        const formData = new FormData();
        formData.append('image', file);
        const res = await fetch('/api/expenses/import-image', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (res.ok) {
          const { records } = await res.json();
          setImportRecords(records.map((r, i) => ({ ...r, _selected: true, _id: i })));
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
      const res = await fetch('/api/expenses/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ records: selected }),
      });
      if (res.ok) {
        const rows = await res.json();
        setExpenses(prev => [...rows, ...prev]);
        setImportRecords(null);
      }
    } catch (err) {
      setImportError('Failed to save');
    }
    setImportSaving(false);
  }

  async function confirmQuickExpense() {
    if (!quickPreview) return;
    const data = {
      store: quickPreview.store || '',
      total: quickPreview.total || 0,
      category: quickPreview.category || 'other',
      date: quickPreview.date || new Date().toISOString().slice(0, 10),
      currency: quickPreview.currency || 'HKD',
      notes: quickPreview.notes || '',
      items: quickPreview.items || [],
    };
    await addExpense(data);
    setQuickText('');
    setQuickPreview(null);
    setQuickError('');
  }

  async function addExpense(data) {
    const token = getStoredToken();
    const res = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const row = await res.json();
      setExpenses(prev => [row, ...prev]);
    }
    setShowAdd(false);
  }

  const normalizeMonth = (raw) => {
    if (!raw) return '';
    const m = String(raw).match(/^(\d{4})[-/.年](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
    return String(raw).slice(0, 7);
  };
  const filtered = expenses.filter(e => {
    const catMatch = filter === 'all' || e.category === filter;
    let monthMatch = true;
    if (monthFilter) {
      const source = e.date || (e.createdAt ? e.createdAt.slice(0, 10) : '');
      monthMatch = normalizeMonth(source) === monthFilter;
    }
    return catMatch && monthMatch;
  });

  const totalAmount = filtered.reduce((sum, e) => sum + parseFloat(e.total || 0), 0);

  const categoryTotals = {};
  filtered.forEach(e => {
    const cat = e.category || 'other';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + parseFloat(e.total || 0);
  });
  const sortedCategories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);

  const availableMonths = [...new Set(expenses.map(e => {
    const d = e.date || (e.createdAt ? e.createdAt.slice(0, 7) : '');
    return d.length >= 7 ? d.slice(0, 7) : null;
  }).filter(Boolean))].sort().reverse();

  if (loading) {
    return (
      <div className="padding-x py-4 max-lg:mt-12 dark:bg-black dark:text-white min-h-screen flex items-center justify-center">
        <div className="text-gray-400 text-sm"><i className="fa-solid fa-spinner animate-spin mr-2" />Loading...</div>
      </div>
    );
  }

  return (
    <div className="padding-x py-4 max-lg:mt-12 dark:bg-black dark:text-white min-h-screen pb-20">
      <div className="max-w-2xl mx-auto">

        <div className="flex items-baseline justify-between mb-4 px-1">
          <h2 className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Spend</h2>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-gray-400 hover:text-black dark:hover:text-white transition cursor-pointer">
              <i className="fa-solid fa-file-import text-[9px] mr-1" />Import
              <input type="file" accept="image/*,.txt,.csv,.tsv" onChange={handleImportFile} className="hidden" />
            </label>
            <button onClick={() => setShowAdd(!showAdd)} className="text-[10px] text-gray-400 hover:text-black dark:hover:text-white transition cursor-pointer">
              <i className={`fa-solid ${showAdd ? 'fa-xmark' : 'fa-plus'} text-[9px] mr-1`} />{showAdd ? 'Cancel' : 'Add'}
            </button>
          </div>
        </div>

        <div className="mb-4">
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <input
                value={quickText}
                onChange={e => { setQuickText(e.target.value); setQuickError(''); setQuickPreview(null); }}
                onKeyDown={e => e.key === 'Enter' && quickParse()}
                placeholder="記帳：lunch 133、taxi 45蚊、4月13日 dinner 280..."
                className="w-full text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-black dark:text-white placeholder-gray-400 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 transition"
              />
              {quickParsing && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <i className="fa-solid fa-spinner animate-spin text-gray-400 text-xs" />
                </div>
              )}
            </div>
            <button
              onClick={quickParse}
              disabled={quickParsing || !quickText.trim()}
              className="text-xs px-3 py-2.5 bg-black text-white dark:bg-white dark:text-black rounded-lg cursor-pointer hover:opacity-80 transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <i className="fa-solid fa-wand-magic-sparkles text-[10px] mr-1" />解析
            </button>
          </div>
          {quickError && (
            <p className="text-[10px] text-red-400 mt-1.5 px-1">{quickError}</p>
          )}
          {quickPreview && (
            <div className="mt-2 border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-900/50">
              <div className="flex items-start justify-between mb-2">
                <span className="text-[10px] text-gray-400 uppercase tracking-wider">AI 解析結果</span>
                <div className="flex gap-1.5">
                  <button onClick={confirmQuickExpense} className="text-[10px] px-2 py-1 bg-black text-white dark:bg-white dark:text-black rounded cursor-pointer hover:opacity-80 transition">
                    <i className="fa-solid fa-check text-[9px] mr-1" />確認儲存
                  </button>
                  <button onClick={() => { setQuickPreview(null); setQuickText(''); }} className="text-[10px] px-2 py-1 text-gray-400 hover:text-gray-600 cursor-pointer transition">
                    取消
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div>
                  <span className="text-gray-400 block text-[9px]">商舖</span>
                  <span className="text-black dark:text-white">{quickPreview.store || '—'}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[9px]">金額</span>
                  <span className="text-black dark:text-white font-medium">{quickPreview.currency || 'HKD'}{quickPreview.total || 0}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[9px]">日期</span>
                  <span className="text-black dark:text-white">{quickPreview.date || '今日'}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[9px]">分類</span>
                  <span className="text-black dark:text-white">{getCatInfo(quickPreview.category).label}</span>
                </div>
              </div>
              {quickPreview.items && quickPreview.items.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 space-y-0.5">
                  {quickPreview.items.map((item, i) => (
                    <div key={i} className="flex justify-between text-[10px]">
                      <span className="text-gray-500">{item.name}</span>
                      <span className="text-gray-400 tabular-nums">${item.price}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {auditLog.length > 0 && (
          <div className="mb-4 border border-gray-200 dark:border-gray-800 rounded-xl">
            <button
              onClick={() => setShowAudit(!showAudit)}
              className="w-full flex items-center justify-between px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 cursor-pointer hover:text-black dark:hover:text-white transition"
            >
              <span>
                <i className="fa-solid fa-clock-rotate-left text-[9px] mr-1.5" />
                LINE Activity · {auditLog.length}
              </span>
              <i className={`fa-solid ${showAudit ? 'fa-chevron-up' : 'fa-chevron-down'} text-[8px]`} />
            </button>
            {showAudit && (
              <div className="border-t border-gray-200 dark:border-gray-800 max-h-64 overflow-y-auto">
                {auditLog.map(entry => (
                  <AuditEntry key={entry.id} entry={entry} onUndo={undoAuditEntry} />
                ))}
              </div>
            )}
          </div>
        )}

        {(importParsing || importRecords) && (
          <div className="mb-4 border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-gray-50 dark:bg-gray-900/50">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">
                <i className="fa-solid fa-file-import text-[9px] mr-1" />
                {importParsing ? 'AI 分析中...' : `已識別 ${importRecords?.length || 0} 筆交易`}
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
                <span className="text-xs text-gray-400">正在用 AI 識別圖片中嘅消費記錄...</span>
              </div>
            )}
            {importError && <p className="text-[10px] text-red-400 mb-2">{importError}</p>}
            {importRecords && (
              <div className="max-h-[60vh] overflow-y-auto space-y-1">
                {importRecords.map((rec, idx) => {
                  const info = getCatInfo(rec.category);
                  return (
                    <div key={idx} onClick={() => toggleImportRecord(idx)} className={`flex items-center gap-2 py-2 px-2 rounded-lg cursor-pointer transition ${rec._selected ? 'bg-white dark:bg-gray-800' : 'opacity-40'}`}>
                      <input type="checkbox" checked={rec._selected} readOnly className="w-3.5 h-3.5 accent-black dark:accent-white shrink-0" />
                      <div className={`w-6 h-6 rounded ${info.bg} flex items-center justify-center shrink-0`}>
                        <i className={`fa-solid ${info.icon} ${info.color} text-[9px]`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-black dark:text-white truncate">{rec.store || 'Unknown'}</p>
                        <p className="text-[9px] text-gray-400">{rec.date} · {info.label}</p>
                      </div>
                      <span className="text-[11px] font-medium text-black dark:text-white tabular-nums shrink-0">
                        ${parseFloat(rec.total || 0).toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {showAdd && <AddExpenseForm onAdd={addExpense} onCancel={() => setShowAdd(false)} />}

        <div className="border-t border-b border-gray-200 dark:border-gray-800 py-6 mb-4">
          <div className="text-center">
            <span className="text-4xl font-light text-black dark:text-white tabular-nums">${totalAmount.toFixed(2)}</span>
            <p className="text-[10px] text-gray-400 mt-1 uppercase tracking-wider">
              {monthFilter ? `${monthFilter} Total` : 'Total'} · {filtered.length} entries
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1 px-1">
          {availableMonths.length > 0 && (
            <select
              value={monthFilter}
              onChange={e => setMonthFilter(e.target.value)}
              className="text-[11px] bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-gray-600 dark:text-gray-400 cursor-pointer"
            >
              {availableMonths.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
              <option value="">All time</option>
            </select>
          )}
          <div className="flex gap-1">
            <button onClick={() => setFilter('all')} className={`text-[10px] px-2 py-1 rounded cursor-pointer transition ${filter === 'all' ? 'bg-black text-white dark:bg-white dark:text-black' : 'text-gray-400 hover:text-gray-600'}`}>All</button>
            {sortedCategories.map(([cat]) => {
              const info = getCatInfo(cat);
              return (
                <button key={cat} onClick={() => setFilter(cat)} className={`text-[10px] px-2 py-1 rounded cursor-pointer transition ${filter === cat ? 'bg-black text-white dark:bg-white dark:text-black' : 'text-gray-400 hover:text-gray-600'}`}>
                  {info.label}
                </button>
              );
            })}
          </div>
        </div>

        {sortedCategories.length > 0 && (
          <div className="mb-4">
            <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800">
              {sortedCategories.map(([cat, amount]) => {
                const info = getCatInfo(cat);
                const pct = totalAmount > 0 ? (amount / totalAmount * 100) : 0;
                return <div key={cat} className={info.barColor || 'bg-gray-400'} style={{ width: `${pct}%` }} title={`${info.label}: $${amount.toFixed(2)}`} />;
              })}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 px-1">
              {sortedCategories.map(([cat, amount]) => {
                const info = getCatInfo(cat);
                return (
                  <div key={cat} className="flex items-center gap-1">
                    <i className={`fa-solid ${info.icon} ${info.color} text-[9px]`} />
                    <span className="text-[10px] text-gray-500">{info.label}</span>
                    <span className="text-[10px] text-gray-400 tabular-nums">${amount.toFixed(0)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="border-t border-gray-200 dark:border-gray-800">
          {filtered.length === 0 && (
            <div className="py-12 text-center">
              <i className="fa-solid fa-receipt text-gray-200 dark:text-gray-700 text-3xl mb-3 block" />
              <p className="text-xs text-gray-400">暫無記帳記錄</p>
              <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-1">用 LINE Bot 影相記帳 或 手動新增</p>
            </div>
          )}
          {filtered.map(expense => (
            <ExpenseRow key={expense.id} expense={expense} onDelete={deleteExpense} />
          ))}
        </div>

      </div>
    </div>
  );
}

const FIELD_LABELS = {
  store: 'store',
  total: 'amount',
  category: 'category',
  date: 'date',
  notes: 'notes',
};

function formatRelativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function formatAuditValue(field, value, currency) {
  if (value == null || value === '') return '—';
  if (field === 'total') {
    const cur = currency || 'HKD';
    const prefix = cur === 'HKD' ? '$' : `${cur} `;
    return `${prefix}${parseFloat(value).toFixed(0)}`;
  }
  if (field === 'category') {
    try { return getCatInfo(value).label; } catch (e) { return value; }
  }
  return String(value);
}

function AuditEntry({ entry, onUndo }) {
  const [undoing, setUndoing] = useState(false);
  const canUndo = entry.action === 'delete' || (entry.action === 'update' && entry.field && entry.expenseId);
  async function handleUndo(e) {
    e.stopPropagation();
    if (!onUndo || undoing) return;
    setUndoing(true);
    try { await onUndo(entry.id); } finally { setUndoing(false); }
  }
  const isDelete = entry.action === 'delete';
  const icon = isDelete ? 'fa-trash' : 'fa-pen';
  const iconColor = isDelete ? 'text-red-500' : 'text-blue-500';
  const emoji = isDelete ? '🗑' : '✏️';
  const label = entry.store || 'Expense';
  let summary;
  if (isDelete) {
    const amt = `${entry.currency || 'HKD'}${parseFloat(entry.total || 0).toFixed(0)}`;
    summary = (
      <span>
        Removed <span className="text-black dark:text-white">{label}</span>
        <span className="text-gray-400"> · {amt}</span>
      </span>
    );
  } else {
    const fieldLabel = FIELD_LABELS[entry.field] || entry.field;
    summary = (
      <span>
        Updated <span className="text-black dark:text-white">{label}</span>
        <span className="text-gray-400"> · {fieldLabel}: </span>
        <span className="text-gray-500 line-through">{formatAuditValue(entry.field, entry.oldValue, entry.currency)}</span>
        <span className="text-gray-400"> → </span>
        <span className="text-black dark:text-white">{formatAuditValue(entry.field, entry.newValue, entry.currency)}</span>
      </span>
    );
  }
  return (
    <div className="flex items-start gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
      <div className="shrink-0 mt-0.5 text-[10px]" aria-hidden>{emoji}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] leading-tight">{summary}</p>
        <p className="text-[9px] text-gray-400 mt-0.5">{formatRelativeTime(entry.createdAt)}</p>
      </div>
      <i className={`fa-solid ${icon} ${iconColor} text-[9px] mt-1 shrink-0`} aria-hidden />
      {canUndo && (
        <button
          onClick={handleUndo}
          disabled={undoing}
          className="shrink-0 text-[10px] text-gray-400 hover:text-black dark:hover:text-white transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ml-1"
          title={isDelete ? 'Restore expense' : 'Revert change'}
        >
          <i className={`fa-solid ${undoing ? 'fa-spinner animate-spin' : 'fa-rotate-left'} text-[9px] mr-1`} />
          {undoing ? '...' : 'Undo'}
        </button>
      )}
    </div>
  );
}

function ExpenseRow({ expense, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const info = getCatInfo(expense.category);
  let items = [];
  try { items = typeof expense.items === 'string' ? JSON.parse(expense.items) : (expense.items || []); } catch (e) {}

  const displayDate = expense.date || (expense.createdAt ? new Date(expense.createdAt).toLocaleDateString('zh-HK') : '');

  return (
    <div className="border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center py-3 px-1 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className={`w-8 h-8 rounded-lg ${info.bg} flex items-center justify-center shrink-0 mr-3`}>
          <i className={`fa-solid ${info.icon} ${info.color} text-xs`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-black dark:text-white truncate">{expense.store || 'Unknown'}</p>
          <p className="text-[10px] text-gray-400">{displayDate} · {info.label}</p>
        </div>
        <div className="text-right shrink-0 ml-2">
          <span className="text-[13px] font-medium text-black dark:text-white tabular-nums">
            {expense.currency === 'HKD' ? '$' : expense.currency}{parseFloat(expense.total || 0).toFixed(2)}
          </span>
          {expense.source === 'line' && <span className="block text-[9px] text-green-500">LINE</span>}
          {expense.source === 'notification' && <span className="block text-[9px] text-cyan-500"><i className="fa-solid fa-bell text-[7px] mr-0.5" />Auto</span>}
        </div>
      </div>
      {expanded && (
        <div className="pb-3 px-1 ml-11">
          {items.length > 0 && (
            <div className="space-y-0.5 mb-2">
              {items.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className="text-gray-500">{item.name}</span>
                  <span className="text-gray-400 tabular-nums">{expense.currency === 'HKD' ? '$' : ''}{item.price}</span>
                </div>
              ))}
            </div>
          )}
          {expense.notes && <p className="text-[11px] text-gray-400 mb-2">{expense.notes}</p>}
          <button onClick={(e) => { e.stopPropagation(); onDelete(expense.id); }} className="text-[10px] text-red-400 hover:text-red-600 transition cursor-pointer">
            <i className="fa-solid fa-trash text-[9px] mr-1" />Delete
          </button>
        </div>
      )}
    </div>
  );
}

function AddExpenseForm({ onAdd, onCancel }) {
  const [store, setStore] = useState('');
  const [total, setTotal] = useState('');
  const [category, setCategory] = useState('other');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState('HKD');
  const [notes, setNotes] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (!store.trim() || !total) return;
    onAdd({ store: store.trim(), total: parseFloat(total), category, date, currency, notes: notes.trim(), items: [] });
  }

  return (
    <form onSubmit={handleSubmit} className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">商舖</label>
          <input value={store} onChange={e => setStore(e.target.value)} placeholder="Store name" className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white" />
        </div>
        <div>
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">金額</label>
          <input type="number" step="0.01" value={total} onChange={e => setTotal(e.target.value)} placeholder="0.00" className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">日期</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white" />
        </div>
        <div>
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">貨幣</label>
          <select value={currency} onChange={e => setCurrency(e.target.value)} className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white cursor-pointer">
            <option value="HKD">HKD</option>
            <option value="USD">USD</option>
            <option value="CNY">CNY</option>
            <option value="TWD">TWD</option>
            <option value="JPY">JPY</option>
            <option value="GBP">GBP</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">分類</label>
          <select value={category} onChange={e => setCategory(e.target.value)} className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white cursor-pointer">
            {Object.entries(CATEGORY_INFO).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">備註</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" className="w-full text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-black dark:text-white" />
      </div>
      <div className="flex gap-2">
        <button type="submit" className="flex-1 text-xs bg-black text-white dark:bg-white dark:text-black py-2 rounded cursor-pointer hover:opacity-80 transition">Save</button>
        <button type="button" onClick={onCancel} className="text-xs text-gray-400 px-3 py-2 cursor-pointer hover:text-gray-600 transition">Cancel</button>
      </div>
    </form>
  );
}
