import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const TYPE_META = {
  'food-added': { icon: '🍽️', label: 'LINE 已記低一餐', view: 'health' },
  'food-updated': { icon: '✏️', label: '食物卡路里已更新', view: 'health' },
  'food-deleted': { icon: '🗑', label: 'LINE 已刪咗最近一餐食物', view: 'health' },
  'expense-added': { icon: '💰', label: 'LINE 已記低一筆支出', view: 'expenses' },
  'expense-updated': { icon: '✏️', label: 'LINE 已更新最近一筆支出', view: 'expenses' },
  'expense-deleted': { icon: '🗑', label: 'LINE 已刪咗最近一筆支出', view: 'expenses' },
  'steps-added': { icon: '🚶', label: 'LINE 已記低步數', view: 'steps' },
  'blood-pressure-added': { icon: '💓', label: 'LINE 已記低血壓', view: 'bp' },
  'medicine-added': { icon: '💊', label: 'LINE 已記低症狀', view: 'health' },
};

export default function PushToast() {
  const [toasts, setToasts] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const currentView = searchParams.get('view') || '';

  const dismiss = useCallback((id) => {
    setToasts((arr) => arr.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const timers = new Set();
    const onMessage = (event) => {
      const msg = event.data;
      if (!msg || msg.type !== 'push') return;
      const t = msg.payload?.data?.type;
      const meta = TYPE_META[t];
      if (!meta) return;
      if (currentView === meta.view) return;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const body = (msg.payload?.body || '').toString().slice(0, 80);
      const item = { id, type: t, icon: meta.icon, label: meta.label, view: meta.view, body };
      setToasts((arr) => [...arr.slice(-2), item]);
      const timer = setTimeout(() => {
        setToasts((arr) => arr.filter((x) => x.id !== id));
        timers.delete(timer);
      }, 5000);
      timers.add(timer);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, [currentView]);

  const goView = (view, id) => {
    setSearchParams((prev) => {
      prev.set('view', view);
      return prev;
    });
    dismiss(id);
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-xs pointer-events-none">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => goView(t.view, t.id)}
          className="pointer-events-auto text-left px-3 py-2 rounded-xl shadow-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition cursor-pointer animate-slideIn"
        >
          <div className="flex items-start gap-2">
            <span className="text-lg leading-none mt-0.5">{t.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-gray-900 dark:text-white">{t.label}</div>
              {t.body && (
                <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate mt-0.5">{t.body}</div>
              )}
              <div className="text-[10px] text-blue-600 dark:text-blue-400 mt-0.5">點擊查看 →</div>
            </div>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); dismiss(t.id); }}
              className="text-gray-300 hover:text-gray-600 dark:hover:text-gray-200 text-xs"
            >
              ✕
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
