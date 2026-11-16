import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getStoredToken } from '../../scripts/api.js';
import { formatCategoryForLine } from '../../../shared/expenseCategories.js';
import { GOAL_FIELDS, MacroProgress } from '../food/macros.jsx';

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

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function fmtRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '剛剛';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function TodayDashboardView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showWebhooks, setShowWebhooks] = useState(false);
  const [, setSearchParams] = useSearchParams();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/dashboard/today');
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event) => {
      const msg = event.data;
      if (!msg || msg.type !== 'push') return;
      const t = msg.payload?.data?.type;
      if (
        t === 'food-added' ||
        t === 'food-updated' ||
        t === 'food-deleted' ||
        t === 'expense-added' ||
        t === 'expense-updated' ||
        t === 'expense-deleted' ||
        t === 'steps-added' ||
        t === 'blood-pressure-added' ||
        t === 'medicine-added'
      ) {
        load();
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [load]);

  const goView = (view, extra = {}) => () => {
    setSearchParams(prev => {
      prev.set('view', view);
      Object.entries(extra).forEach(([k, v]) => prev.set(k, v));
      return prev;
    });
  };

  if (loading && !data) {
    return <div className="text-center text-gray-400 text-xs py-12">載入緊今日嘅資訊…</div>;
  }
  if (!data) return null;

  const undoneTasks = (data.tasks || []).filter(t => !t.done);
  const doneTasks = (data.tasks || []).filter(t => t.done);
  const today = new Date();
  const greet = today.getHours() < 6 ? '凌晨好' : today.getHours() < 12 ? '早晨' : today.getHours() < 18 ? '下午好' : '晚上好';

  return (
    <div className="padding-x py-4 max-lg:mt-12 dark:bg-black dark:text-white min-h-screen pb-20">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{greet}</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{data.date} · 今日資訊匯總</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={load}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition cursor-pointer"
              title="Refresh"
            >
              <i className="fa-solid fa-arrows-rotate" />
            </button>
            <button
              onClick={() => setShowWebhooks(true)}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition cursor-pointer"
              title="Webhook 入口"
            >
              <i className="fa-solid fa-plug mr-1" /> Webhooks
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <Stat label="今日 Task" value={undoneTasks.length} sub={`${doneTasks.length} done`} accent="text-blue-600 dark:text-blue-400" onClick={goView('week')} />
          <Stat label="未讀 Email" value={(data.emails || []).length} sub="inbox" accent="text-purple-600 dark:text-purple-400" />
          <Stat label="新 Memo (24h)" value={(data.memos || []).length} sub="incl. LINE" accent="text-amber-600 dark:text-amber-400" onClick={goView('memo')} />
          <Stat label="RSS 新項 (24h)" value={(data.rss || []).length} sub="all feeds" accent="text-green-600 dark:text-green-400" onClick={goView('feed')} />
        </div>

        <MacrosWidget macros={data.macros} onJump={goView('health', { tab: 'food' })} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Section title="今日 Task" icon="fa-list-check" empty="今日冇待辦 task 🎉" onMore={goView('week')}>
            {undoneTasks.slice(0, 8).map(t => (
              <Row key={t.id} title={t.name} sub={t.startTime || ''} icon="fa-square" />
            ))}
            {doneTasks.slice(0, 3).map(t => (
              <Row key={t.id} title={<span className="line-through text-gray-400">{t.name}</span>} sub="" icon="fa-square-check" muted />
            ))}
          </Section>

          <Section title="未讀 Email" icon="fa-envelope" empty="冇未處理 email" >
            {(data.emails || []).slice(0, 8).map(e => (
              <Row key={e.id} title={e.subject || '(no subject)'} sub={e.fromAddress} right={fmtRelative(e.createdAt)} icon="fa-envelope" />
            ))}
          </Section>

          <Section title="LINE / Webhook 入嘅 Memo" icon="fa-note-sticky" empty="24 小時內冇新 memo" onMore={goView('memo')}>
            {(data.memos || []).slice(0, 8).map(m => (
              <Row key={m.id} title={m.title || '(無標題)'} sub={(m.content || '').slice(0, 80)} right={fmtRelative(m.createdAt)} icon="fa-note-sticky" />
            ))}
          </Section>

          <Section title="RSS 新項 (24 小時)" icon="fa-rss" empty="今日所有訂閱都未有新更新" onMore={goView('feed')}>
            {(data.rss || []).slice(0, 8).map((it, i) => (
              <a key={i} href={it.link} target="_blank" rel="noopener noreferrer" className="block">
                <Row title={it.title} sub={it.feedTitle} right={fmtRelative(it.pubDate)} icon="fa-rss" link />
              </a>
            ))}
          </Section>

          <Section title="新 Video Summaries" icon="fa-circle-play" empty="24 小時內冇 auto-import 嘅影片" onMore={goView('memo')}>
            {(data.videoSummaries || []).slice(0, 8).map(v => (
              <button
                key={`vs-${v.id}`}
                onClick={() => setSearchParams(prev => { prev.set('view', 'memo'); prev.set('openMemo', String(v.id)); return prev; })}
                className="w-full text-left"
              >
                <Row title={v.title || '(untitled video)'} sub={v.tldr || ''} right={fmtRelative(v.createdAt)} icon="fa-circle-play" link />
              </button>
            ))}
          </Section>

          <Section title="LINE 入嘅開支" icon="fa-receipt" empty="24 小時內冇新開支" onMore={goView('expenses')}>
            {(data.expenses || []).slice(0, 6).map(e => (
              <Row
                key={e.id}
                title={
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 whitespace-nowrap shrink-0">
                      {formatCategoryForLine(e.category)}
                    </span>
                    <span className="truncate">{e.store || '(no store)'}</span>
                  </span>
                }
                sub={`${e.currency || 'HKD'} ${e.total}`}
                right={fmtRelative(e.createdAt)}
                icon="fa-receipt"
              />
            ))}
          </Section>

          <Section title="健康記錄 (24h)" icon="fa-heart-pulse" empty="冇新健康數據" onMore={goView('health')}>
            {(data.bloodPressure || []).map(b => (
              <Row key={`bp-${b.id}`} title={`💓 ${b.sys}/${b.dia} · pulse ${b.pulse}`} sub="血壓" right={`${b.date} ${b.time || ''}`} icon="fa-heart" />
            ))}
            {(data.steps || []).map(s => (
              <Row key={`s-${s.id}`} title={`🚶 ${(s.steps || 0).toLocaleString()} 步`} sub={s.distance ? `${s.distance} km` : ''} right={s.date} icon="fa-shoe-prints" />
            ))}
            {(data.medicine || []).map(m => (
              <Row key={`m-${m.id}`} title={`💊 ${m.symptom} ${m.medicine ? '· ' + m.medicine : ''}`} sub={`severity ${m.severity}`} right={`${m.date} ${m.time || ''}`} icon="fa-pills" />
            ))}
            {(data.food || []).map(f => (
              <Row key={`f-${f.id}`} title={`🍽️ ${f.totalCalories || 0} kcal`} sub={f.mealType} right={`${f.date} ${f.time || ''}`} icon="fa-utensils" />
            ))}
          </Section>
        </div>

        {showWebhooks && <WebhookPanel onClose={() => setShowWebhooks(false)} />}
      </div>
    </div>
  );
}

function MacrosWidget({ macros, onJump }) {
  const goals = macros?.goals || {};
  const totals = macros?.totals;
  const configured = GOAL_FIELDS.filter(f => Number(goals[f.goalKey]) > 0);

  if (configured.length === 0) {
    return (
      <button
        onClick={onJump}
        className="w-full text-left mb-5 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2.5 bg-white dark:bg-gray-900/40 hover:bg-gray-50 dark:hover:bg-gray-900 transition cursor-pointer flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <i className="fa-solid fa-bullseye text-gray-400" />
          <div>
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">營養目標</div>
            <div className="text-[10px] text-gray-400 dark:text-gray-500">設定每日蛋白質、碳水、脂肪、鈉目標</div>
          </div>
        </div>
        <span className="text-[10px] text-blue-500">設定 →</span>
      </button>
    );
  }

  return (
    <button
      onClick={onJump}
      className="w-full text-left mb-5 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2.5 bg-white dark:bg-gray-900/40 hover:bg-gray-50 dark:hover:bg-gray-900 transition cursor-pointer"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
          <i className="fa-solid fa-utensils text-gray-400" />今日營養素
        </div>
        <span className="text-[10px] text-gray-400">睇詳情 →</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {configured.map(f => {
          const goal = Number(goals[f.goalKey]);
          const cur = totals?.[f.key] || 0;
          const isMax = f.key === 'sodium' && !!goals.sodiumIsMax;
          return <MacroProgress key={f.key} field={f} current={cur} goal={goal} isMax={isMax} />;
        })}
      </div>
    </button>
  );
}

function Stat({ label, value, sub, accent, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`border border-gray-200 dark:border-gray-800 rounded-xl p-3 bg-white dark:bg-gray-900/40 text-left ${onClick ? 'hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer transition' : ''}`}
    >
      <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${accent || ''}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{sub}</div>}
    </Tag>
  );
}

function Section({ title, icon, children, empty, onMore }) {
  const arr = React.Children.toArray(children).filter(Boolean);
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
          <i className={`fa-solid ${icon} text-gray-400`} />{title}
          <span className="text-gray-400 font-normal">({arr.length})</span>
        </div>
        {onMore && (
          <button onClick={onMore} className="text-[10px] text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer">
            more →
          </button>
        )}
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-72 overflow-y-auto">
        {arr.length === 0 ? (
          <div className="text-center text-gray-400 text-xs py-8">{empty}</div>
        ) : arr}
      </div>
    </div>
  );
}

function Row({ title, sub, right, icon, muted, link }) {
  return (
    <div className={`flex items-start gap-2 px-3 py-2 text-xs ${link ? 'hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer' : ''}`}>
      <i className={`fa-regular ${icon || 'fa-circle'} text-[10px] text-gray-400 mt-1`} />
      <div className="flex-1 min-w-0">
        <div className={`truncate ${muted ? 'text-gray-400' : 'text-gray-800 dark:text-gray-100'}`}>{title}</div>
        {sub && <div className="truncate text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{sub}</div>}
      </div>
      {right && <div className="text-[10px] text-gray-400 whitespace-nowrap">{right}</div>}
    </div>
  );
}

function WebhookPanel({ onClose }) {
  const [hooks, setHooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [defaultType, setDefaultType] = useState('memo');
  const [creating, setCreating] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const load = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/webhooks');
      if (res.ok) setHooks(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    setCreating(true);
    try {
      const res = await authFetch('/api/webhooks', {
        method: 'POST',
        body: JSON.stringify({ name: name || 'Webhook', defaultType }),
      });
      if (res.ok) {
        setName('');
        await load();
      }
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('刪除呢個 webhook？舊嘅 URL 會即刻失效。')) return;
    const res = await authFetch(`/api/webhooks/${id}`, { method: 'DELETE' });
    if (res.ok) load();
  };

  const copy = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      // best effort
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5 border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <i className="fa-solid fa-plug text-emerald-500" /> Webhook 入口
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
          畀外部工具（Cloudflare Worker、Zapier、IFTTT、curl、自寫 script）push 資訊入嚟你嘅 Memo 或 Task。
          每個 webhook 有獨立 token，建議每個來源開一個方便管理同停用。
        </p>

        <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-3 mb-4 bg-gray-50 dark:bg-gray-800/40">
          <div className="text-xs font-semibold mb-2 text-gray-700 dark:text-gray-200">建立新 Webhook</div>
          <div className="flex gap-2 flex-wrap">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="名稱 (e.g. Cloudflare Worker)"
              className="flex-1 min-w-[160px] text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
            <select
              value={defaultType}
              onChange={e => setDefaultType(e.target.value)}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            >
              <option value="memo">→ Memo</option>
              <option value="task">→ Task</option>
            </select>
            <button
              onClick={create}
              disabled={creating}
              className="text-xs px-3 py-1.5 rounded-lg bg-black text-white dark:bg-white dark:text-black font-semibold hover:opacity-80 transition disabled:opacity-50 cursor-pointer"
            >
              {creating ? '...' : '建立'}
            </button>
          </div>
        </div>

        {loading && <div className="text-center text-gray-400 text-xs py-4">載入中…</div>}

        {!loading && hooks.length === 0 && (
          <div className="text-center text-gray-400 text-xs py-8 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
            仲未有任何 webhook
          </div>
        )}

        <div className="space-y-2">
          {hooks.map(h => {
            const url = `${origin}/api/webhook/in/${h.token}`;
            return (
              <div key={h.id} className="border border-gray-200 dark:border-gray-800 rounded-xl p-3 bg-white dark:bg-gray-900/40">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                    {h.name}
                    <span className="text-[10px] font-normal text-gray-400">→ {h.defaultType}</span>
                  </div>
                  <button
                    onClick={() => remove(h.id)}
                    className="text-gray-300 hover:text-red-500 cursor-pointer text-xs"
                    title="刪除"
                  >
                    <i className="fa-solid fa-trash" />
                  </button>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <code className="flex-1 text-[10px] bg-gray-100 dark:bg-gray-800 px-2 py-1.5 rounded font-mono text-gray-700 dark:text-gray-200 break-all">
                    {url}
                  </code>
                  <button
                    onClick={() => copy(url)}
                    className="text-xs px-2 py-1.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer"
                    title="Copy URL"
                  >
                    <i className="fa-solid fa-copy" />
                  </button>
                </div>
                <div className="text-[10px] text-gray-400">
                  已用 {h.callCount || 0} 次{h.lastUsedAt ? ` · 最後 ${fmtRelative(h.lastUsedAt)}` : ''}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 pt-4 border-t border-gray-200 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-400 space-y-2">
          <div className="font-semibold text-gray-700 dark:text-gray-200">點用？</div>
          <div>
            POST 一個 JSON：<br />
            <code className="text-[10px] bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
              {'{ "title": "...", "content": "...", "type": "memo|task", "tags": ["..."] }'}
            </code>
          </div>
          <div>或者用 GET query string：<code className="text-[10px] bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">?title=Hello&content=World</code></div>
          <div>例子：<code className="text-[10px] bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded break-all">curl -X POST {'<your-url>'} -H "Content-Type: application/json" -d '{`{"title":"Test","content":"From webhook"}`}'</code></div>
        </div>
      </div>
    </div>
  );
}
