import React, { useEffect, useState, useMemo } from 'react';
import { getStoredToken } from '../../scripts/api';
import { useAuth } from '../../contexts/AuthContext.jsx';
import {
  MACRO_DEFS,
  GOAL_FIELDS,
  macroNum,
  getItemMacros,
  sumMacrosFromRows,
  progressTone,
  MacroProgress,
  MacroChip,
  MacroChips,
} from '../food/macros.jsx';

const authFetch = (url, opts = {}) => {
  const token = getStoredToken();
  return fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
};

const COMMON_TIMEZONES = [
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Bangkok',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Australia/Sydney',
  'Pacific/Auckland',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'America/Sao_Paulo',
  'UTC',
];

function formatTzOffsetLabel(tz) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
    const parts = fmt.formatToParts(new Date());
    const off = parts.find(p => p.type === 'timeZoneName')?.value || '';
    return `${tz} (${off})`;
  } catch {
    return tz;
  }
}

const MEAL_LABELS = {
  breakfast: { label: '早餐', icon: '🌅', color: 'text-amber-600 dark:text-amber-400' },
  lunch: { label: '午餐', icon: '☀️', color: 'text-orange-600 dark:text-orange-400' },
  dinner: { label: '晚餐', icon: '🌙', color: 'text-indigo-600 dark:text-indigo-400' },
  snack: { label: '小食', icon: '🍪', color: 'text-pink-600 dark:text-pink-400' },
  unknown: { label: '餐點', icon: '🍽️', color: 'text-gray-600 dark:text-gray-400' },
};

function scoreColor(score) {
  if (!score) return 'bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400';
  if (score >= 8) return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
  if (score >= 5) return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300';
  return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
}

export default function FoodView() {
  const { currentUser, updateUser } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [showAudit, setShowAudit] = useState(false);
  const [editingGoals, setEditingGoals] = useState(false);
  const [goalDrafts, setGoalDrafts] = useState({ proteinGoal: '', carbsGoal: '', fatGoal: '', sodiumGoal: '', sodiumIsMax: true, dailySummaryEnabled: true, dailySummaryHour: 21, dailySummaryMinute: 0, timezone: 'Asia/Hong_Kong' });
  const [savingGoals, setSavingGoals] = useState(false);

  const goals = useMemo(() => ({
    proteinGoal: currentUser?.proteinGoal ?? null,
    carbsGoal: currentUser?.carbsGoal ?? null,
    fatGoal: currentUser?.fatGoal ?? null,
    sodiumGoal: currentUser?.sodiumGoal ?? null,
    sodiumIsMax: currentUser?.sodiumIsMax ?? true,
    dailySummaryEnabled: currentUser?.dailySummaryEnabled ?? true,
    dailySummaryHour: currentUser?.dailySummaryHour ?? 21,
    dailySummaryMinute: currentUser?.dailySummaryMinute ?? 0,
    timezone: currentUser?.timezone || 'Asia/Hong_Kong',
  }), [currentUser]);
  const hasAnyGoal = GOAL_FIELDS.some(f => goals[f.goalKey] > 0);

  const startEditGoals = () => {
    setGoalDrafts({
      proteinGoal: goals.proteinGoal == null ? '' : String(goals.proteinGoal),
      carbsGoal: goals.carbsGoal == null ? '' : String(goals.carbsGoal),
      fatGoal: goals.fatGoal == null ? '' : String(goals.fatGoal),
      sodiumGoal: goals.sodiumGoal == null ? '' : String(goals.sodiumGoal),
      sodiumIsMax: !!goals.sodiumIsMax,
      dailySummaryEnabled: !!goals.dailySummaryEnabled,
      dailySummaryHour: goals.dailySummaryHour ?? 21,
      dailySummaryMinute: goals.dailySummaryMinute ?? 0,
      timezone: goals.timezone || 'Asia/Hong_Kong',
    });
    setEditingGoals(true);
  };

  const saveGoals = async () => {
    const payload = {
      sodiumIsMax: goalDrafts.sodiumIsMax,
      dailySummaryEnabled: !!goalDrafts.dailySummaryEnabled,
      dailySummaryHour: Number(goalDrafts.dailySummaryHour),
      dailySummaryMinute: Number(goalDrafts.dailySummaryMinute),
      timezone: goalDrafts.timezone || 'Asia/Hong_Kong',
    };
    for (const f of GOAL_FIELDS) {
      const v = goalDrafts[f.goalKey];
      if (v === '' || v == null) { payload[f.goalKey] = null; continue; }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        alert(`請輸入有效嘅 ${f.label} 目標`);
        return;
      }
      payload[f.goalKey] = Math.round(n);
    }
    setSavingGoals(true);
    const result = await updateUser(payload);
    setSavingGoals(false);
    if (typeof result === 'string') {
      alert(result || '儲存失敗');
      return;
    }
    setEditingGoals(false);
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/food?limit=200');
      if (res.ok) setRows(await res.json());
    } finally {
      setLoading(false);
    }
  };

  const loadUsage = async () => {
    try {
      const res = await authFetch('/api/nutrition/usage');
      if (res.ok) setUsage(await res.json());
    } catch {}
  };

  const loadAuditLog = async () => {
    try {
      const res = await authFetch('/api/food/audit-log?limit=10');
      if (res.ok) setAuditLog(await res.json());
    } catch {}
  };

  const undoAuditEntry = async (entryId) => {
    try {
      const res = await authFetch(`/api/food/audit-log/${entryId}/undo`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Undo failed');
        return;
      }
      setAuditLog(prev => prev.filter(e => e.id !== entryId));
      await load();
    } catch (e) {
      console.error(e);
      alert('Undo failed');
    }
  };

  useEffect(() => { load(); loadUsage(); loadAuditLog(); }, []);

  const remove = async (id) => {
    if (!confirm('刪除呢個飲食記錄？')) return;
    const res = await authFetch(`/api/food/${id}`, { method: 'DELETE' });
    if (res.ok) setRows(rs => rs.filter(r => r.id !== id));
  };

  const saveEdit = async (id, payload) => {
    const res = await authFetch(`/api/food/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || '更新失敗');
      return false;
    }
    const updated = await res.json();
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...updated } : r));
    return true;
  };

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todayRows = rows.filter(r => r.date === today);
    const todayCal = todayRows.reduce((s, r) => s + (r.totalCalories || 0), 0);
    const last7 = (() => {
      const set = new Set();
      for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        set.add(d.toISOString().slice(0, 10));
      }
      return rows.filter(r => set.has(r.date));
    })();
    const avg7 = last7.length
      ? Math.round(last7.reduce((s, r) => s + (r.totalCalories || 0), 0) / 7)
      : 0;
    const scored = last7.filter(r => r.healthScore > 0);
    const avgScore = scored.length
      ? (scored.reduce((s, r) => s + r.healthScore, 0) / scored.length).toFixed(1)
      : '—';
    const todayMacros = sumMacrosFromRows(todayRows);
    const weekMacros = sumMacrosFromRows(last7);
    const avgWeekMacros = weekMacros
      ? Object.fromEntries(MACRO_DEFS.map(d => [d.key, weekMacros[d.key] / 7]))
      : null;
    return { todayCal, avg7, avgScore, todayCount: todayRows.length, todayMacros, avgWeekMacros };
  }, [rows]);

  return (
    <div>
      {usage && (
        <div className="mb-2 text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-2 flex-wrap">
          <span title="FatSecret food database">今日 FatSecret 查詢：{usage.fatsecretConfigured ? `${usage.fatsecret}/${usage.fatsecretDailyLimit}` : '未設定'}</span>
          <span>·</span>
          <span title="Open Food Facts barcode database">📦 OFF {usage.openfoodfacts}</span>
          <span>·</span>
          <span title="GPT-4o estimate">🤖 AI 估算</span>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
        <StatCard label="今日卡路里" value={stats.todayCal.toLocaleString()} unit="kcal" />
        <StatCard label="今日餐次" value={stats.todayCount} unit="餐" />
        <StatCard label="7日平均" value={stats.avg7.toLocaleString()} unit="kcal/日" />
        <StatCard label="健康評分" value={stats.avgScore} unit="/ 10" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4 text-[11px]">
          <div className="border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 bg-white dark:bg-gray-900/40">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">今日營養素</div>
              {!editingGoals && (
                <button
                  onClick={startEditGoals}
                  className="text-[10px] text-gray-400 hover:text-blue-500 cursor-pointer"
                  title="設定每日目標"
                >
                  <i className="fa-solid fa-bullseye mr-0.5" />{hasAnyGoal ? '目標' : '設定目標'}
                </button>
              )}
            </div>
            {hasAnyGoal ? (
              <div className="space-y-1.5">
                {GOAL_FIELDS.map(f => {
                  const goal = goals[f.goalKey];
                  if (!(goal > 0)) return null;
                  const cur = stats.todayMacros?.[f.key] || 0;
                  const isMax = f.key === 'sodium' && goals.sodiumIsMax;
                  return <MacroProgress key={f.key} field={f} current={cur} goal={goal} isMax={isMax} />;
                })}
                {stats.todayMacros && (
                  <div className="pt-1 border-t border-gray-100 dark:border-gray-800">
                    <MacroChips macros={stats.todayMacros} />
                  </div>
                )}
              </div>
            ) : stats.todayMacros ? (
              <MacroChips macros={stats.todayMacros} />
            ) : (
              <div className="text-[10px] text-gray-400">未有今日記錄</div>
            )}
          </div>
          {stats.avgWeekMacros && (
            <div className="border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 bg-white dark:bg-gray-900/40">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">7日平均營養素 / 日</div>
              <MacroChips macros={stats.avgWeekMacros} />
            </div>
          )}
        </div>

      {editingGoals && (
        <div className="mb-4 border border-blue-200 dark:border-blue-900/40 rounded-xl px-3 py-3 bg-blue-50/40 dark:bg-blue-900/10">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
              <i className="fa-solid fa-bullseye mr-1 text-blue-500" />每日營養目標
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={saveGoals}
                disabled={savingGoals}
                className="text-emerald-500 hover:text-emerald-600 disabled:opacity-50 cursor-pointer text-xs"
              >
                <i className="fa-solid fa-check mr-1" />儲存
              </button>
              <button
                onClick={() => setEditingGoals(false)}
                disabled={savingGoals}
                className="text-gray-400 hover:text-gray-600 cursor-pointer text-xs"
              >
                <i className="fa-solid fa-xmark mr-1" />取消
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            {GOAL_FIELDS.map(f => (
              <label key={f.key} className="flex flex-col gap-0.5">
                <span className="text-[10px] text-gray-500 dark:text-gray-400">{f.label} ({f.unit})</span>
                <input
                  type="number"
                  min="0"
                  value={goalDrafts[f.goalKey]}
                  onChange={e => setGoalDrafts(d => ({ ...d, [f.goalKey]: e.target.value }))}
                  disabled={savingGoals}
                  placeholder={f.key === 'sodium' ? '例如 2000' : '例如 60'}
                  className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </label>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={goalDrafts.sodiumIsMax}
              onChange={e => setGoalDrafts(d => ({ ...d, sodiumIsMax: e.target.checked }))}
              disabled={savingGoals}
              className="cursor-pointer"
            />
            鈉視為每日上限（建議高血壓 / 糖尿病管理開啟）
          </label>
          <p className="mt-1 text-[10px] text-gray-400">留空即停用該項目進度條。</p>
          <div className="mt-3 pt-3 border-t border-blue-100 dark:border-blue-900/40">
            <div className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 mb-1.5">
              <i className="fa-regular fa-bell mr-1 text-blue-500" />LINE 每日飲食總結
            </div>
            <label className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300 cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={goalDrafts.dailySummaryEnabled}
                onChange={e => setGoalDrafts(d => ({ ...d, dailySummaryEnabled: e.target.checked }))}
                disabled={savingGoals}
                className="cursor-pointer"
              />
              啟用每日推送（喺 LINE 收到當日卡路里總結）
            </label>
            <label className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300 mb-2">
              <span className="whitespace-nowrap">時區：</span>
              <select
                value={(() => {
                  const tz = goalDrafts.timezone || 'Asia/Hong_Kong';
                  return COMMON_TIMEZONES.includes(tz) ? tz : '__custom__';
                })()}
                onChange={e => {
                  const v = e.target.value;
                  if (v === '__browser__') {
                    try {
                      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Hong_Kong';
                      setGoalDrafts(d => ({ ...d, timezone: detected }));
                    } catch {
                      setGoalDrafts(d => ({ ...d, timezone: 'Asia/Hong_Kong' }));
                    }
                  } else if (v === '__custom__') {
                    // keep current custom value
                  } else {
                    setGoalDrafts(d => ({ ...d, timezone: v }));
                  }
                }}
                disabled={savingGoals || !goalDrafts.dailySummaryEnabled}
                className="flex-1 min-w-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
              >
                <option value="__browser__">📍 用瀏覽器時區</option>
                {COMMON_TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{formatTzOffsetLabel(tz)}</option>
                ))}
                {!COMMON_TIMEZONES.includes(goalDrafts.timezone || 'Asia/Hong_Kong') && (
                  <option value="__custom__">{goalDrafts.timezone}</option>
                )}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300">
              <span>推送時間：</span>
              <select
                value={goalDrafts.dailySummaryHour}
                onChange={e => setGoalDrafts(d => ({ ...d, dailySummaryHour: Number(e.target.value) }))}
                disabled={savingGoals || !goalDrafts.dailySummaryEnabled}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                ))}
              </select>
              <span>:</span>
              <select
                value={goalDrafts.dailySummaryMinute}
                onChange={e => setGoalDrafts(d => ({ ...d, dailySummaryMinute: Number(e.target.value) }))}
                disabled={savingGoals || !goalDrafts.dailySummaryEnabled}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
              >
                {Array.from({ length: 60 }, (_, m) => (
                  <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                ))}
              </select>
            </label>
            <p className="mt-1.5 text-[10px] text-blue-600 dark:text-blue-300">
              <i className="fa-regular fa-clock mr-1" />
              將喺每日 {String(goalDrafts.dailySummaryHour).padStart(2, '0')}:{String(goalDrafts.dailySummaryMinute).padStart(2, '0')}（{goalDrafts.timezone || 'Asia/Hong_Kong'}）推送
            </p>
            <p className="mt-1 text-[10px] text-gray-400">未連 LINE 嘅話呢個設定唔會生效。</p>
          </div>
          <p className="mt-3 pt-3 border-t border-blue-100 dark:border-blue-900/40 text-[10px] text-gray-500 dark:text-gray-400">
            <i className="fa-regular fa-sun mr-1 text-yellow-500" />
            想開／關 LINE 每朝天氣推送？去「帳戶設定」調整。
          </p>
        </div>
      )}

      {auditLog.length > 0 && (
        <div className="mb-3 border border-gray-200 dark:border-gray-800 rounded-xl">
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
                <FoodAuditEntry key={entry.id} entry={entry} onUndo={undoAuditEntry} />
              ))}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="text-center text-gray-400 text-xs py-8">載入中…</div>
      )}

      {!loading && rows.length === 0 && (
        <div className="text-center text-gray-400 text-xs py-12 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
          仲未有飲食記錄。喺 LINE Bot 發張食物相俾 Muse，會即刻幫你分析卡路里同俾飲食建議 🍽️
        </div>
      )}

      <div className="space-y-2">
        {rows.map(r => (
          <FoodRow key={r.id} row={r} onRemove={remove} onSave={saveEdit} />
        ))}
      </div>
    </div>
  );
}

function FoodRow({ row, onRemove, onSave }) {
  const meal = MEAL_LABELS[row.mealType] || MEAL_LABELS.unknown;
  const initialItems = useMemo(() => {
    try { return JSON.parse(row.items || '[]'); } catch { return []; }
  }, [row.items]);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [totalDraft, setTotalDraft] = useState(String(row.totalCalories || 0));
  const buildItemDrafts = (items) => items.map(it => ({
    ...it,
    name: it.name ?? '',
    calories: String(it.calories ?? 0),
  }));
  const [itemDrafts, setItemDrafts] = useState(() => buildItemDrafts(initialItems));
  const [lookingUpIdx, setLookingUpIdx] = useState(null);
  const [autoTotal, setAutoTotal] = useState(true);
  const [mealDraft, setMealDraft] = useState(row.mealType || 'unknown');
  const [dateDraft, setDateDraft] = useState(row.date || '');
  const [timeDraft, setTimeDraft] = useState((row.time || '').slice(0, 5));

  const startEdit = () => {
    setTotalDraft(String(row.totalCalories || 0));
    setItemDrafts(buildItemDrafts(initialItems));
    setAutoTotal(true);
    setMealDraft(row.mealType || 'unknown');
    setDateDraft(row.date || '');
    setTimeDraft((row.time || '').slice(0, 5));
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setSaving(false);
  };

  const recalcAutoTotal = (items) => {
    if (!autoTotal) return;
    const sum = items.reduce((s, it) => s + (Number(it.calories) || 0), 0);
    setTotalDraft(String(Math.round(sum)));
  };

  const updateItemCalories = (i, value) => {
    setItemDrafts(prev => {
      const next = prev.slice();
      next[i] = { ...next[i], calories: value };
      recalcAutoTotal(next);
      return next;
    });
  };

  const updateItemName = (i, value) => {
    setItemDrafts(prev => {
      const next = prev.slice();
      next[i] = { ...next[i], name: value };
      return next;
    });
  };

  const removeItem = (i) => {
    setItemDrafts(prev => {
      if (initialItems.length > 0 && prev.length <= 1) return prev;
      const next = prev.filter((_, idx) => idx !== i);
      recalcAutoTotal(next);
      return next;
    });
  };

  const addItem = () => {
    setItemDrafts(prev => {
      const next = [...prev, { name: '', calories: '0', source: 'manual' }];
      recalcAutoTotal(next);
      return next;
    });
  };

  const lookupItem = async (i) => {
    const draft = itemDrafts[i];
    const name = (draft?.name || '').trim();
    if (!name) {
      alert('請先輸入食物名稱');
      return;
    }
    setLookingUpIdx(i);
    try {
      const res = await authFetch(`/api/nutrition/lookup?name=${encodeURIComponent(name)}`);
      if (res.status === 404) {
        alert('搵唔到呢個食物嘅營養資料');
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || '查詢失敗');
        return;
      }
      const data = await res.json();
      setItemDrafts(prev => {
        const next = prev.slice();
        const cur = next[i] || {};
        next[i] = {
          ...cur,
          name: data.matchedName || cur.name,
          calories: String(Math.round(data.calories || 0)),
          source: data.source || cur.source || 'manual',
          servingDescription: data.servingDescription ?? cur.servingDescription,
          portion: cur.portion || data.servingDescription || cur.portion,
          protein: data.protein,
          carbs: data.carbs,
          fat: data.fat,
          sodium: data.sodium,
        };
        recalcAutoTotal(next);
        return next;
      });
    } catch (e) {
      console.error(e);
      alert('查詢失敗');
    } finally {
      setLookingUpIdx(null);
    }
  };

  const updateTotalDraft = (value) => {
    setAutoTotal(false);
    setTotalDraft(value);
  };

  const save = async () => {
    const totalNum = Number(totalDraft);
    if (!Number.isFinite(totalNum) || totalNum < 0) {
      alert('請輸入有效嘅總卡路里');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDraft)) {
      alert('請輸入有效日期');
      return;
    }
    if (timeDraft && !/^\d{2}:\d{2}$/.test(timeDraft)) {
      alert('請輸入有效時間');
      return;
    }
    const payload = {
      totalCalories: Math.round(totalNum),
      mealType: mealDraft,
      date: dateDraft,
      time: timeDraft || null,
    };
    if (initialItems.length > 0 || itemDrafts.length > 0) {
      if (initialItems.length > 0 && itemDrafts.length === 0) {
        alert('至少要保留一個項目');
        return;
      }
      const nextItems = [];
      for (const it of itemDrafts) {
        const name = (it.name || '').trim();
        if (!name) {
          alert('請輸入食物名稱');
          return;
        }
        const cal = Number(it.calories);
        nextItems.push({
          ...it,
          name,
          calories: Number.isFinite(cal) && cal >= 0 ? Math.round(cal) : 0,
        });
      }
      payload.items = nextItems;
    }
    setSaving(true);
    const ok = await onSave(row.id, payload);
    setSaving(false);
    if (ok) setEditing(false);
  };

  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-3 bg-white dark:bg-gray-900/40">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          {editing ? (
            <div className="flex flex-wrap items-center gap-1">
              <select
                value={mealDraft}
                onChange={e => setMealDraft(e.target.value)}
                disabled={saving}
                className="text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="breakfast">🌅 早餐</option>
                <option value="lunch">☀️ 午餐</option>
                <option value="dinner">🌙 晚餐</option>
                <option value="snack">🍪 小食</option>
                <option value="unknown">🍽️ 餐點</option>
              </select>
              <input
                type="date"
                value={dateDraft}
                onChange={e => setDateDraft(e.target.value)}
                disabled={saving}
                className="text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <input
                type="time"
                value={timeDraft}
                onChange={e => setTimeDraft(e.target.value)}
                disabled={saving}
                className="text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          ) : (
            <div className={`text-xs font-semibold flex items-center gap-1 ${meal.color}`}>
              <span>{meal.icon}</span>{meal.label}
              <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">{row.date}{row.time ? ` · ${row.time}` : ''}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${scoreColor(row.healthScore)}`}>
            {row.healthScore > 0 ? `${row.healthScore}/10` : '—'}
          </span>
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="0"
                value={totalDraft}
                onChange={e => updateTotalDraft(e.target.value)}
                disabled={saving}
                className="w-20 text-right text-sm font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded px-1.5 py-0.5 tabular-nums focus:outline-none focus:ring-1 focus:ring-orange-400"
              />
              <span className="text-[10px] text-gray-400">kcal</span>
            </div>
          ) : (
            <span className="text-sm font-bold text-orange-600 dark:text-orange-400">
              {row.totalCalories || 0} <span className="text-[10px] font-normal text-gray-400">kcal</span>
            </span>
          )}
          {editing ? (
            <>
              <button
                onClick={save}
                disabled={saving}
                className="text-emerald-500 hover:text-emerald-600 disabled:opacity-50 cursor-pointer"
                title="儲存"
              >
                <i className="fa-solid fa-check text-xs" />
              </button>
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="text-gray-400 hover:text-gray-600 cursor-pointer"
                title="取消"
              >
                <i className="fa-solid fa-rotate-left text-xs" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={startEdit}
                className="text-gray-300 hover:text-blue-500 cursor-pointer"
                title="編輯記錄"
              >
                <i className="fa-solid fa-pen text-xs" />
              </button>
              <button
                onClick={() => onRemove(row.id)}
                className="text-gray-300 hover:text-red-500 cursor-pointer"
                title="刪除"
              >
                <i className="fa-solid fa-xmark text-xs" />
              </button>
            </>
          )}
        </div>
      </div>

      {initialItems.length > 0 && !editing && (
        <div className="text-xs text-gray-700 dark:text-gray-300 space-y-1 mb-2">
          {initialItems.map((it, i) => {
            const macros = getItemMacros(it);
            return (
              <div key={i} className="flex flex-col gap-0.5">
                <div className="flex justify-between items-center gap-2">
                  <span>{it.source === 'fatsecret' ? '📊' : it.source === 'openfoodfacts' ? '📦' : it.source === 'ai' ? '🤖' : '•'} {it.name}{it.portion ? `（${it.portion}）` : ''}</span>
                  <span className="text-gray-400 dark:text-gray-500 tabular-nums">{it.calories || 0} kcal</span>
                </div>
                {macros && (
                  <MacroChips macros={macros} className="pl-4" />
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="text-xs text-gray-700 dark:text-gray-300 space-y-1 mb-2">
          {itemDrafts.map((it, i) => {
            const macros = getItemMacros(it);
            const isLooking = lookingUpIdx === i;
            return (
            <div key={i} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-gray-400 dark:text-gray-500" title={it.source || ''}>
                  {it.source === 'fatsecret' ? '📊' : it.source === 'openfoodfacts' ? '📦' : it.source === 'ai' ? '🤖' : '•'}
                </span>
                <input
                  type="text"
                  value={it.name}
                  onChange={e => updateItemName(i, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); lookupItem(i); } }}
                  disabled={saving || isLooking}
                  placeholder="食物名稱"
                  className="flex-1 min-w-0 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <button
                  onClick={() => lookupItem(i)}
                  disabled={saving || isLooking || !(it.name || '').trim()}
                  className="shrink-0 text-gray-400 hover:text-blue-500 disabled:opacity-30 disabled:hover:text-gray-400 disabled:cursor-not-allowed cursor-pointer"
                  title="查詢營養資料"
                >
                  <i className={`fa-solid ${isLooking ? 'fa-spinner animate-spin' : 'fa-magnifying-glass'} text-xs`} />
                </button>
                {it.portion && (
                  <span className="shrink-0 text-gray-400 dark:text-gray-500 text-[10px]">（{it.portion}）</span>
                )}
                <input
                  type="number"
                  min="0"
                  value={it.calories}
                  onChange={e => updateItemCalories(i, e.target.value)}
                  disabled={saving}
                  className="w-16 shrink-0 text-right bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-1 py-0.5 tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <span className="shrink-0 text-gray-400 dark:text-gray-500">kcal</span>
                <button
                  onClick={() => removeItem(i)}
                  disabled={saving || (initialItems.length > 0 && itemDrafts.length <= 1)}
                  className="shrink-0 text-gray-300 hover:text-red-500 disabled:opacity-30 disabled:hover:text-gray-300 disabled:cursor-not-allowed cursor-pointer"
                  title={initialItems.length > 0 && itemDrafts.length <= 1 ? '至少要保留一個項目' : '移除呢項'}
                >
                  <i className="fa-solid fa-trash text-xs" />
                </button>
              </div>
              {macros && (
                <MacroChips macros={macros} className="pl-6" />
              )}
            </div>
            );
          })}
          <button
            onClick={addItem}
            disabled={saving}
            className="text-[11px] text-blue-500 hover:text-blue-600 disabled:opacity-50 cursor-pointer mt-1"
            title="新增食物項目"
          >
            <i className="fa-solid fa-plus text-[10px] mr-1" />新增項目
          </button>
        </div>
      )}

      {row.suggestion && (
        <div className="mt-2 text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/40 rounded-lg px-2.5 py-2">
          <span className="font-semibold mr-1">💡 Muse 建議：</span>{row.suggestion}
        </div>
      )}
    </div>
  );
}

const FOOD_FIELD_LABELS = {
  items: '食物',
  totalCalories: '卡路里',
  mealType: '餐種',
  date: '日期',
  time: '時間',
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

function formatFoodAuditValue(field, value) {
  if (value == null || value === '') return '—';
  if (field === 'totalCalories') return `${parseFloat(value).toFixed(0)} kcal`;
  if (field === 'mealType') {
    const m = MEAL_LABELS[value] || MEAL_LABELS.unknown;
    return `${m.icon} ${m.label}`;
  }
  if (field === 'items') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        const names = parsed.map(it => it?.name).filter(Boolean);
        return names.length ? names.join('、') : '—';
      }
    } catch {}
    return String(value);
  }
  return String(value);
}

const UNDOABLE_FOOD_FIELDS = new Set(['items', 'totalCalories', 'mealType', 'date', 'time']);

function FoodAuditEntry({ entry, onUndo }) {
  const [undoing, setUndoing] = useState(false);
  const isDelete = entry.action === 'delete';
  const canUndo = isDelete
    ? !!entry.snapshot
    : (
        entry.action === 'update'
        && !!entry.foodId
        && UNDOABLE_FOOD_FIELDS.has(entry.field)
        && (entry.field === 'time' || (entry.oldValue != null && entry.oldValue !== ''))
      );
  async function handleUndo(e) {
    e.stopPropagation();
    if (!onUndo || undoing) return;
    setUndoing(true);
    try { await onUndo(entry.id); } finally { setUndoing(false); }
  }
  const icon = isDelete ? 'fa-trash' : 'fa-pen';
  const iconColor = isDelete ? 'text-red-500' : 'text-blue-500';
  const emoji = isDelete ? '🗑' : '✏️';
  const meal = MEAL_LABELS[entry.mealType] || MEAL_LABELS.unknown;
  const label = entry.summary || meal.label;
  let summary;
  if (isDelete) {
    summary = (
      <span>
        Removed <span className="text-black dark:text-white">{label}</span>
        <span className="text-gray-400"> · {entry.totalCalories || 0} kcal</span>
      </span>
    );
  } else {
    const fieldLabel = FOOD_FIELD_LABELS[entry.field] || entry.field;
    summary = (
      <span>
        Updated <span className="text-black dark:text-white">{label}</span>
        <span className="text-gray-400"> · {fieldLabel}: </span>
        <span className="text-gray-500 line-through">{formatFoodAuditValue(entry.field, entry.oldValue)}</span>
        <span className="text-gray-400"> → </span>
        <span className="text-black dark:text-white">{formatFoodAuditValue(entry.field, entry.newValue)}</span>
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
          title={isDelete ? '還原食物記錄' : '撤銷變更'}
        >
          <i className={`fa-solid ${undoing ? 'fa-spinner animate-spin' : 'fa-rotate-left'} text-[9px] mr-1`} />
          {undoing ? '...' : 'Undo'}
        </button>
      )}
    </div>
  );
}

function StatCard({ label, value, unit }) {
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-3 bg-white dark:bg-gray-900/40">
      <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">{label}</div>
      <div className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{value}<span className="text-[10px] font-normal text-gray-400 dark:text-gray-500 ml-1">{unit}</span></div>
    </div>
  );
}
