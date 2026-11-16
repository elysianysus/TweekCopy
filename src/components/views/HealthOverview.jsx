import React, { useState, useEffect, useRef, useMemo } from 'react';
import { getStoredToken } from '../../scripts/api';
import { DayMacroCoaching } from '../food/macros.jsx';

function severityColor(sev) {
  if (sev >= 4) return 'text-red-500';
  if (sev >= 3) return 'text-amber-500';
  return 'text-green-500';
}

function bpStatus(sys, dia) {
  if (sys >= 140 || dia >= 90) return { label: 'High', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950/30' };
  if (sys >= 130 || dia >= 85) return { label: 'Elevated', color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-950/30' };
  if (sys >= 120 || dia >= 80) return { label: 'Pre-high', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30' };
  return { label: 'Normal', color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-950/30' };
}

function stepsLevel(avg) {
  if (avg >= 10000) return { label: 'Excellent', color: 'text-green-500' };
  if (avg >= 7500) return { label: 'Active', color: 'text-emerald-500' };
  if (avg >= 5000) return { label: 'Moderate', color: 'text-amber-500' };
  if (avg >= 2500) return { label: 'Light', color: 'text-orange-500' };
  return { label: 'Low', color: 'text-red-500' };
}

function MiniSparkline({ data, color = '#ec4899', height = 32 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 120;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={w} height={height} className="shrink-0">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export default function HealthOverview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [question, setQuestion] = useState('');
  const [showChat, setShowChat] = useState(false);
  const summaryRef = useRef(null);

  useEffect(() => { loadOverview(); }, []);

  async function loadOverview() {
    setLoading(true);
    try {
      const token = getStoredToken();
      const res = await fetch('/api/health/overview', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setData(await res.json());
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  async function getAiSummary(q) {
    setAiLoading(true);
    setAiSummary('');
    setShowChat(true);
    try {
      const token = getStoredToken();
      const res = await fetch('/api/health/ai-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: q || '' }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6);
            if (payload === '[DONE]') break;
            try {
              const parsed = JSON.parse(payload);
              if (parsed.text) {
                full += parsed.text;
                setAiSummary(full);
              }
            } catch {}
          }
        }
      }
    } catch (e) {
      console.error(e);
      setAiSummary('Unable to generate summary. Please try again.');
    }
    setAiLoading(false);
  }

  const stats = useMemo(() => {
    if (!data) return null;
    const s = data.steps;
    const b = data.bp;
    const m = data.medicine;

    const avgSteps = s.length > 0 ? Math.round(s.reduce((a, r) => a + r.steps, 0) / s.length) : 0;
    const totalDist = s.reduce((a, r) => a + parseFloat(r.distance || 0), 0);
    const avgSys = b.length > 0 ? Math.round(b.reduce((a, r) => a + r.sys, 0) / b.length) : 0;
    const avgDia = b.length > 0 ? Math.round(b.reduce((a, r) => a + r.dia, 0) / b.length) : 0;
    const avgPulse = b.length > 0 ? Math.round(b.reduce((a, r) => a + r.pulse, 0) / b.length) : 0;
    const symptomCount = {};
    m.forEach(r => { symptomCount[r.symptom] = (symptomCount[r.symptom] || 0) + 1; });
    const topSymptom = Object.entries(symptomCount).sort((a, b) => b[1] - a[1])[0];

    const sleep = data.sleep || [];
    const lastSleep = sleep[0] || null;
    const sleepWithSnore = sleep.filter(r => r.snoreMin != null);
    const avgSnore = sleepWithSnore.length > 0 ? Math.round(sleepWithSnore.reduce((a, r) => a + r.snoreMin, 0) / sleepWithSnore.length) : null;
    const sleepSparkline = [...sleep].reverse().filter(r => r.snoreMin != null).map(r => r.snoreMin);
    const symptoms = data.sleepSymptoms || [];
    const recentSymptoms = symptoms.slice(0, 7);
    let symptomFlag = null;
    if (recentSymptoms.length > 0) {
      const maxSev = recentSymptoms.reduce((mx, r) => Math.max(mx,
        r.morningHeadache || 0, r.daytimeFatigue || 0, r.nightWakeCount || 0,
        r.concentration ? (6 - r.concentration) : 0), 0);
      const latest = symptoms[0];
      const has = latest && (
        (latest.morningHeadache || 0) >= 3 ||
        (latest.daytimeFatigue || 0) >= 3 ||
        (latest.nightWakeCount || 0) >= 3 ||
        (latest.concentration && latest.concentration <= 3));
      if (has || maxSev >= 4) {
        symptomFlag = { date: latest.date, severity: maxSev };
      }
    }

    return {
      stepsDays: s.length, avgSteps, totalDist,
      bpReadings: b.length, avgSys, avgDia, avgPulse,
      latestBP: b[0] || null,
      medLogs: m.length, topSymptom,
      stepsSparkline: [...s].reverse().map(r => r.steps),
      bpSparkline: [...b].reverse().map(r => r.sys),
      lastSleep, sleepNights: sleep.length, avgSnore, sleepSparkline, symptomFlag,
    };
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-400 text-sm"><i className="fa-solid fa-spinner animate-spin mr-2" />Loading...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-12 text-center">
        <p className="text-xs text-gray-400">Unable to load health data</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-2">
          <i className="fa-solid fa-chart-line text-pink-400" />
          30-Day Overview
        </h3>
        <span className="text-[9px] text-gray-400">{data.period.from} — {data.period.to}</span>
      </div>

      <DayMacroCoaching date={new Date().toISOString().slice(0, 10)} title="今日營養素" emptyHint="今日未有飲食記錄" />

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <i className="fa-solid fa-shoe-prints text-[10px] text-blue-400" />
            <span className="text-[10px] text-gray-400 uppercase">Steps</span>
          </div>
          {stats.stepsDays > 0 ? (
            <>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-xl font-light tabular-nums">{stats.avgSteps.toLocaleString()}</div>
                  <div className="text-[9px] text-gray-400">avg/day</div>
                </div>
                <MiniSparkline data={stats.stepsSparkline} color="#3b82f6" />
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className={`font-medium ${stepsLevel(stats.avgSteps).color}`}>{stepsLevel(stats.avgSteps).label}</span>
                <span className="text-gray-400">{stats.stepsDays} days · {stats.totalDist.toFixed(1)}km</span>
              </div>
            </>
          ) : (
            <div className="text-[11px] text-gray-400 py-2">No data yet</div>
          )}
        </div>

        <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <i className="fa-solid fa-heart-pulse text-[10px] text-red-400" />
            <span className="text-[10px] text-gray-400 uppercase">Blood Pressure</span>
          </div>
          {stats.bpReadings > 0 ? (
            <>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-xl font-light tabular-nums">{stats.avgSys}/{stats.avgDia}</div>
                  <div className="text-[9px] text-gray-400">avg SYS/DIA</div>
                </div>
                <MiniSparkline data={stats.bpSparkline} color="#ef4444" />
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className={`font-medium ${bpStatus(stats.avgSys, stats.avgDia).color}`}>
                  {bpStatus(stats.avgSys, stats.avgDia).label}
                </span>
                <span className="text-gray-400">{stats.bpReadings} readings · {stats.avgPulse} bpm</span>
              </div>
            </>
          ) : (
            <div className="text-[11px] text-gray-400 py-2">No data yet</div>
          )}
        </div>

        <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <i className="fa-solid fa-pills text-[10px] text-purple-400" />
            <span className="text-[10px] text-gray-400 uppercase">Medicine</span>
          </div>
          {stats.medLogs > 0 ? (
            <>
              <div className="text-xl font-light tabular-nums">{stats.medLogs}</div>
              <div className="text-[9px] text-gray-400">symptom logs</div>
              {stats.topSymptom && (
                <div className="text-[10px] text-gray-500 dark:text-gray-400">
                  Most frequent: <span className="font-medium text-purple-500">{stats.topSymptom[0]}</span> ({stats.topSymptom[1]}x)
                </div>
              )}
            </>
          ) : (
            <div className="text-[11px] text-gray-400 py-2">No data yet</div>
          )}
        </div>

        <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <i className="fa-solid fa-route text-[10px] text-emerald-400" />
            <span className="text-[10px] text-gray-400 uppercase">Distance</span>
          </div>
          {stats.totalDist > 0 ? (
            <>
              <div className="text-xl font-light tabular-nums">{stats.totalDist.toFixed(1)}</div>
              <div className="text-[9px] text-gray-400">km total</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">
                Avg: <span className="font-medium">{(stats.totalDist / Math.max(stats.stepsDays, 1)).toFixed(1)}</span> km/day
              </div>
            </>
          ) : (
            <div className="text-[11px] text-gray-400 py-2">No data yet</div>
          )}
        </div>
      </div>

      {stats.lastSleep && (
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/40 bg-gradient-to-br from-indigo-50/40 to-blue-50/40 dark:from-indigo-950/20 dark:to-blue-950/20 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <i className="fa-solid fa-moon text-[10px] text-indigo-400" />
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Last Night</span>
            </div>
            <span className="text-[9px] text-gray-400">{stats.lastSleep.date}</span>
          </div>
          <div className="grid grid-cols-4 gap-2 mb-2">
            <div className="text-center">
              <div className="text-base font-light text-indigo-500 tabular-nums">{stats.lastSleep.snoreMin ?? '—'}</div>
              <div className="text-[9px] text-gray-400">snore min</div>
            </div>
            <div className="text-center">
              <div className="text-base font-light text-emerald-500 tabular-nums">{stats.lastSleep.effectiveInterventionPct != null ? `${stats.lastSleep.effectiveInterventionPct}%` : '—'}</div>
              <div className="text-[9px] text-gray-400">effective</div>
            </div>
            <div className="text-center">
              <div className="text-base font-light text-blue-500 tabular-nums">{stats.lastSleep.totalSleepMin != null ? `${Math.floor(stats.lastSleep.totalSleepMin/60)}h${stats.lastSleep.totalSleepMin%60}` : '—'}</div>
              <div className="text-[9px] text-gray-400">total</div>
            </div>
            <div className="text-center">
              <div className="text-base font-light text-cyan-500 tabular-nums">{stats.lastSleep.spo2Min ?? '—'}</div>
              <div className="text-[9px] text-gray-400">SpO₂ min</div>
            </div>
          </div>
          {stats.sleepSparkline.length >= 2 && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-gray-400">{stats.sleepNights} nights · avg snore {stats.avgSnore ?? '—'}m</span>
              <MiniSparkline data={stats.sleepSparkline} color="#6366f1" />
            </div>
          )}
          {stats.symptomFlag && (
            <div className="mt-2 flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-300">
              <i className="fa-solid fa-triangle-exclamation text-[9px]" />
              <span>OSA symptom flag — recent diary severity {stats.symptomFlag.severity}/5 ({stats.symptomFlag.date})</span>
            </div>
          )}
        </div>
      )}

      {stats.latestBP && (
        <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">Latest BP Reading</div>
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className="text-lg font-light tabular-nums">{stats.latestBP.sys}</div>
              <div className="text-[9px] text-gray-400">SYS</div>
            </div>
            <div className="text-gray-300 dark:text-gray-600">/</div>
            <div className="text-center">
              <div className="text-lg font-light tabular-nums">{stats.latestBP.dia}</div>
              <div className="text-[9px] text-gray-400">DIA</div>
            </div>
            <div className="text-center ml-3">
              <div className="text-lg font-light tabular-nums text-red-400">{stats.latestBP.pulse}</div>
              <div className="text-[9px] text-gray-400">Pulse</div>
            </div>
            <div className="ml-auto text-right">
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${bpStatus(stats.latestBP.sys, stats.latestBP.dia).bg} ${bpStatus(stats.latestBP.sys, stats.latestBP.dia).color} font-medium`}>
                {bpStatus(stats.latestBP.sys, stats.latestBP.dia).label}
              </span>
              <div className="text-[9px] text-gray-400 mt-1">{stats.latestBP.date}</div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-pink-200 dark:border-pink-900/40 bg-gradient-to-br from-pink-50/50 to-purple-50/50 dark:from-pink-950/20 dark:to-purple-950/20 p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center">
            <i className="fa-solid fa-wand-magic-sparkles text-white text-[10px]" />
          </div>
          <span className="text-xs font-medium">Muse Health Insights</span>
        </div>

        {!showChat && !aiSummary && (
          <div className="space-y-2">
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Let AI analyze your health data and provide personalized insights.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => getAiSummary('')} className="text-[10px] px-3 py-1.5 rounded-lg bg-pink-500 text-white cursor-pointer hover:bg-pink-600 transition">
                <i className="fa-solid fa-sparkles mr-1" />Generate Overview
              </button>
              <button onClick={() => getAiSummary('Am I getting enough exercise?')} className="text-[10px] px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                Exercise Check
              </button>
              <button onClick={() => getAiSummary('How is my blood pressure trend?')} className="text-[10px] px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                BP Trend
              </button>
              <button onClick={() => getAiSummary('Any health concerns or patterns I should know about?')} className="text-[10px] px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                Health Concerns
              </button>
            </div>
          </div>
        )}

        {showChat && (
          <div className="space-y-3">
            {aiSummary && (
              <div ref={summaryRef} className="text-[12px] leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                {aiSummary}
              </div>
            )}
            {aiLoading && !aiSummary && (
              <div className="flex items-center gap-2 py-4">
                <i className="fa-solid fa-spinner animate-spin text-pink-400 text-sm" />
                <span className="text-[11px] text-gray-400">Analyzing your health data...</span>
              </div>
            )}
            {aiLoading && aiSummary && (
              <div className="flex items-center gap-1">
                <div className="w-1 h-1 rounded-full bg-pink-400 animate-pulse" />
                <div className="w-1 h-1 rounded-full bg-pink-400 animate-pulse" style={{ animationDelay: '0.2s' }} />
                <div className="w-1 h-1 rounded-full bg-pink-400 animate-pulse" style={{ animationDelay: '0.4s' }} />
              </div>
            )}
            {!aiLoading && (
              <div className="flex gap-2 mt-2">
                <input
                  type="text"
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && question.trim()) { getAiSummary(question); setQuestion(''); } }}
                  placeholder="Ask about your health..."
                  className="flex-1 text-[11px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-black dark:text-white"
                />
                <button
                  onClick={() => { if (question.trim()) { getAiSummary(question); setQuestion(''); } }}
                  className="text-[10px] px-3 py-1.5 rounded-lg bg-pink-500 text-white cursor-pointer hover:bg-pink-600 transition"
                >
                  <i className="fa-solid fa-paper-plane" />
                </button>
              </div>
            )}
            {!aiLoading && aiSummary && (
              <button
                onClick={() => { setShowChat(false); setAiSummary(''); }}
                className="text-[9px] text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <i className="fa-solid fa-xmark mr-1" />Close
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
