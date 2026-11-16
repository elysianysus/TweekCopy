import React, { useEffect, useRef, useState } from "react";
import {
  soulcraftStart, soulcraftAnswer, soulcraftSynthesize, soulcraftTweak, soulcraftEnd,
  saveCustomSkill, updateCustomSkill,
} from "../scripts/api.js";

const ICON_OPTIONS = [
  'fa-user','fa-user-tie','fa-face-smile','fa-heart','fa-star',
  'fa-comment','fa-comments','fa-message','fa-fire','fa-bolt',
  'fa-crown','fa-gem','fa-ghost','fa-cat','fa-dog',
  'fa-music','fa-palette','fa-code','fa-gamepad','fa-trophy',
];
const COLOR_OPTIONS = [
  'text-purple-500','text-pink-500','text-rose-500','text-red-500',
  'text-orange-500','text-amber-500','text-yellow-500','text-lime-500',
  'text-green-500','text-emerald-500','text-teal-500','text-cyan-500',
  'text-sky-500','text-blue-500','text-indigo-500','text-violet-500',
];

function storageKey(skill) {
  return skill ? `soulcraft_session_refine_${skill.id}` : "soulcraft_session_create";
}

export default function SoulCraftModal({ skill = null, onClose, onSaved }) {
  const [step, setStep] = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [draft, setDraft] = useState(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingNext, setLoadingNext] = useState(false);
  const [error, setError] = useState("");
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [tweaking, setTweaking] = useState("");
  const scrollRef = useRef(null);
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    const cached = sessionStorage.getItem(storageKey(skill));
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed?.step?.sessionId) {
          setStep(parsed.step);
          setTranscript(parsed.transcript || []);
          if (parsed.draft) setDraft(parsed.draft);
          return;
        }
      } catch {}
    }
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!step?.sessionId) return;
    sessionStorage.setItem(storageKey(skill), JSON.stringify({ step, transcript, draft }));
  }, [step, transcript, draft, skill]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript, step?.question, draft]);

  async function bootstrap() {
    setBusy(true); setError("");
    try {
      const s = await soulcraftStart({ skillId: skill?.id || null });
      setStep(s);
      setTranscript([]);
    } catch (e) {
      setError(e.message || "Failed to start session.");
    }
    setBusy(false);
  }

  async function send({ skip = false, back = false } = {}) {
    if (busy || loadingNext || !step) return;
    const ans = input.trim();
    if (!skip && !back && !ans) return;
    setLoadingNext(true); setError("");
    const prevTranscript = transcript;
    const prevInput = input;
    if (back) {
      setTranscript(prev => prev.slice(0, -2));
    } else {
      setTranscript(prev => [
        ...prev,
        { role: "q", text: step.question, phase: step.phase },
        { role: "a", text: skip ? "(跳過 / skipped)" : ans, skipped: skip, phase: step.phase },
      ]);
    }
    setInput("");
    try {
      const next = await soulcraftAnswer({ sessionId: step.sessionId, answer: ans, skip, back });
      if (next.done) {
        setStep(next);
        await synthesizeNow(next.sessionId);
      } else {
        setStep(next);
      }
    } catch (e) {
      // Roll back optimistic transcript / input so UI matches server state.
      setTranscript(prevTranscript);
      if (!back) setInput(prevInput);
      const msg = (e.message || "Failed.").toString();
      // Session may have been GC'd on the server (1h TTL) or after a cold restart — restart cleanly.
      if (/session not found/i.test(msg)) {
        sessionStorage.removeItem(storageKey(skill));
        setStep(null);
        setTranscript([]);
        setError("Session expired — starting a fresh one.");
        await bootstrap();
      } else {
        setError(msg);
      }
    }
    setLoadingNext(false);
  }

  async function synthesizeNow(sessionId) {
    setBusy(true); setError("");
    try {
      const d = await soulcraftSynthesize(sessionId || step.sessionId);
      setDraft(d);
    } catch (e) {
      const msg = (e.message || "Failed to synthesize.").toString();
      if (/session not found/i.test(msg)) {
        sessionStorage.removeItem(storageKey(skill));
        setStep(null);
        setTranscript([]);
        setError("Session expired before we could finish — starting a fresh interview.");
        await bootstrap();
      } else {
        setError(msg);
      }
    }
    setBusy(false);
  }

  async function save() {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      const payload = {
        label: draft.label,
        icon: draft.icon,
        color: draft.color,
        description: draft.description,
        systemPrompt: draft.systemPrompt,
        persona: draft.persona,
        personalityTags: draft.personalityTags,
      };
      const saved = skill
        ? await updateCustomSkill(skill.id, payload)
        : await saveCustomSkill(payload);
      sessionStorage.removeItem(storageKey(skill));
      try { await soulcraftEnd(step.sessionId); } catch {}
      onSaved(saved);
    } catch (e) {
      setError(e.message || "Failed to save.");
      setBusy(false);
    }
  }

  // Default close: keep sessionStorage + server session alive so reopening resumes.
  function closeAndResume() {
    onClose();
  }

  // Explicit destructive reset, requested by the user via the trash button.
  function discardSession() {
    if (draft || transcript.length > 0) {
      const confirmMsg = skill
        ? "Discard the in-progress refinement? This cannot be undone."
        : "Discard this in-progress persona session? This cannot be undone.";
      if (!window.confirm(confirmMsg)) return;
    }
    sessionStorage.removeItem(storageKey(skill));
    if (step?.sessionId) soulcraftEnd(step.sessionId).catch(() => {});
    onClose();
  }

  async function tweakOne(field) {
    if (!draft || !step?.sessionId || tweaking) return;
    setTweaking(field); setError("");
    try {
      const out = await soulcraftTweak({ sessionId: step.sessionId, field, draft });
      setDraft(d => ({ ...d, ...out }));
    } catch (e) {
      const msg = (e.message || "Failed to tweak field.").toString();
      if (/session not found/i.test(msg)) {
        // Server session expired (1h TTL or restart). The transcript is gone, so
        // per-field regeneration is no longer possible; surface a clear message
        // and offer the discard/save fallback.
        setError("Session expired — per-field regenerate is no longer available. Edit fields manually or discard and start over.");
      } else {
        setError(msg);
      }
    }
    setTweaking("");
  }

  const phaseProgress = step ? `${Math.min((step.phaseIdx || 0) + 1, step.totalPhases)}/${step.totalPhases}` : "";
  const qProgress = step ? `${Math.min(step.questionsAsked + (step.question ? 1 : 0), step.totalQuestions)}/${step.totalQuestions}` : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeAndResume}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div className="flex flex-col">
            <h3 className="text-sm font-semibold dark:text-white flex items-center gap-2">
              <i className="fa-solid fa-comments text-purple-500" />
              {skill ? `Refine: ${skill.label}` : "Design through conversation"}
            </h3>
            {step && !draft && (
              <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-400">
                <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800">{step.phaseLabel}</span>
                <span>Phase {phaseProgress} · Q {qProgress}</span>
              </div>
            )}
            {(transcript.length > 0 || draft) && (
              <div className="text-[10px] text-gray-400 mt-1">
                {draft ? "Draft preview — edit any field or use ↻ to regenerate just that one." : "Close to come back later — your progress is saved."}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {(transcript.length > 0 || draft) && (
              <button
                onClick={discardSession}
                className="text-gray-300 hover:text-red-500 transition px-1.5"
                title="Discard session and start over"
              >
                <i className="fa-solid fa-trash text-xs" />
              </button>
            )}
            <button onClick={closeAndResume} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title="Close (progress kept)">
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
        </div>

        {!draft && (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-3">
              {skill && step?.gapsSummary && (
                <div className="text-[11px] text-gray-600 dark:text-gray-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/50 rounded-lg p-2">
                  <span className="font-medium text-amber-700 dark:text-amber-300">Focus areas: </span>{step.gapsSummary}
                  {step.gaps?.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {step.gaps.map(g => (
                        <span key={g} className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-[10px]">{g}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {transcript.map((t, i) => (
                <div key={i} className={`flex ${t.role === "a" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    t.role === "a"
                      ? (t.skipped ? "bg-gray-100 dark:bg-gray-800 text-gray-400 italic" : "bg-purple-500 text-white")
                      : "bg-gray-100 dark:bg-gray-800 dark:text-gray-100"
                  }`}>{t.text}</div>
                </div>
              ))}
              {step?.question && !loadingNext && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 dark:text-gray-100">
                    {step.question}
                  </div>
                </div>
              )}
              {loadingNext && (
                <div className="flex justify-start">
                  <div className="rounded-2xl px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-400">
                    <i className="fa-solid fa-circle-notch animate-spin mr-1" /> thinking…
                  </div>
                </div>
              )}
              {busy && !step && (
                <div className="text-xs text-gray-400 text-center py-6">
                  <i className="fa-solid fa-spinner animate-spin mr-1" /> Starting session…
                </div>
              )}
              {busy && step?.done && !draft && (
                <div className="text-xs text-gray-400 text-center py-6">
                  <i className="fa-solid fa-spinner animate-spin mr-1" /> Synthesizing your persona…
                </div>
              )}
              {!busy && step?.done && !draft && error && (
                <div className="text-center py-2">
                  <button
                    onClick={() => synthesizeNow(step.sessionId)}
                    className="px-3 py-1.5 text-xs rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700"
                  >
                    <i className="fa-solid fa-arrows-rotate mr-1.5" />Retry synthesis
                  </button>
                </div>
              )}
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>

            <div className="border-t border-gray-100 dark:border-gray-800 p-3 space-y-2 shrink-0">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
                placeholder={step?.question ? "Type your answer… (⌘/Ctrl+Enter to send)" : "…"}
                rows={3}
                disabled={!step?.question || loadingNext || busy}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent dark:text-white outline-none focus:border-gray-400 resize-none"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => send({ back: true })}
                  disabled={!step || transcript.length === 0 || loadingNext || busy}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
                >
                  <i className="fa-solid fa-arrow-left mr-1" />Back
                </button>
                <button
                  onClick={() => send({ skip: true })}
                  disabled={!step?.question || loadingNext || busy}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
                >
                  Skip
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => send()}
                  disabled={!step?.question || !input.trim() || loadingNext || busy}
                  className="px-4 py-1.5 text-xs rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700 disabled:opacity-40 flex items-center gap-1.5"
                >
                  Send <i className="fa-solid fa-paper-plane" />
                </button>
              </div>
            </div>
          </>
        )}

        {draft && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <div className="relative">
                <button type="button" onClick={() => { setShowIconPicker(!showIconPicker); setShowColorPicker(false); }} className="w-12 h-12 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 flex items-center justify-center hover:border-gray-400">
                  <i className={`fa-solid ${draft.icon} ${draft.color} text-xl`} />
                </button>
                {showIconPicker && (
                  <div className="absolute top-full left-0 mt-1 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 grid grid-cols-5 gap-1 w-48">
                    {ICON_OPTIONS.map(ic => (
                      <button key={ic} onClick={() => { setDraft(d => ({ ...d, icon: ic })); setShowIconPicker(false); }} className={`w-8 h-8 rounded flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 ${draft.icon === ic ? 'bg-gray-100 dark:bg-gray-700' : ''}`}>
                        <i className={`fa-solid ${ic} ${draft.color} text-sm`} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-1">
                  <input
                    value={draft.label}
                    onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                    className="flex-1 min-w-0 text-sm font-medium bg-transparent dark:text-white outline-none border-b border-transparent focus:border-gray-300"
                  />
                  <button onClick={() => tweakOne("label")} disabled={!!tweaking} title="Regenerate name" className="text-gray-300 hover:text-purple-500 disabled:opacity-50 px-1">
                    <i className={`fa-solid ${tweaking === "label" ? "fa-spinner animate-spin" : "fa-arrows-rotate"} text-[10px]`} />
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    value={draft.description || ""}
                    onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                    placeholder="One-line vibe…"
                    className="flex-1 min-w-0 text-xs text-gray-500 dark:text-gray-400 bg-transparent outline-none border-b border-transparent focus:border-gray-300"
                  />
                  <button onClick={() => tweakOne("description")} disabled={!!tweaking} title="Regenerate description" className="text-gray-300 hover:text-purple-500 disabled:opacity-50 px-1">
                    <i className={`fa-solid ${tweaking === "description" ? "fa-spinner animate-spin" : "fa-arrows-rotate"} text-[10px]`} />
                  </button>
                </div>
              </div>
              <div className="relative">
                <button type="button" onClick={() => { setShowColorPicker(!showColorPicker); setShowIconPicker(false); }} className="w-8 h-8 rounded-full border border-gray-200 dark:border-gray-700 flex items-center justify-center">
                  <div className={`w-5 h-5 rounded-full ${draft.color.replace('text-', 'bg-')}`} />
                </button>
                {showColorPicker && (
                  <div className="absolute top-full right-0 mt-1 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 grid grid-cols-4 gap-1 w-40">
                    {COLOR_OPTIONS.map(c => (
                      <button key={c} onClick={() => { setDraft(d => ({ ...d, color: c })); setShowColorPicker(false); }} className={`w-8 h-8 rounded flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 ${draft.color === c ? 'ring-2 ring-gray-400' : ''}`}>
                        <div className={`w-5 h-5 rounded-full ${c.replace('text-', 'bg-')}`} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {draft.changeSummary && (
              <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/50 rounded-lg p-2 whitespace-pre-wrap">
                <div className="font-medium mb-1">What changed</div>
                {draft.changeSummary}
              </div>
            )}

            <div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-gray-400 uppercase tracking-wider">Personality tags</label>
                <button onClick={() => tweakOne("personalityTags")} disabled={!!tweaking} title="Regenerate tags" className="text-gray-300 hover:text-purple-500 disabled:opacity-50">
                  <i className={`fa-solid ${tweaking === "personalityTags" ? "fa-spinner animate-spin" : "fa-arrows-rotate"} text-[10px]`} />
                </button>
              </div>
              <input
                value={draft.personalityTags || ""}
                onChange={e => setDraft(d => ({ ...d, personalityTags: e.target.value }))}
                className="w-full px-3 py-2 mt-1 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent dark:text-white outline-none focus:border-gray-400"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-gray-400 uppercase tracking-wider">Persona</label>
                <button onClick={() => tweakOne("persona")} disabled={!!tweaking} title="Regenerate persona" className="text-gray-300 hover:text-purple-500 disabled:opacity-50">
                  <i className={`fa-solid ${tweaking === "persona" ? "fa-spinner animate-spin" : "fa-arrows-rotate"} text-[10px]`} />
                </button>
              </div>
              <textarea
                value={draft.persona || ""}
                onChange={e => setDraft(d => ({ ...d, persona: e.target.value }))}
                rows={8}
                className="w-full px-3 py-2 mt-1 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent dark:text-white outline-none focus:border-gray-400 resize-none font-mono"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <button onClick={() => setShowPrompt(!showPrompt)} className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  <i className={`fa-solid fa-chevron-${showPrompt ? 'down' : 'right'} text-[9px]`} />
                  System prompt
                </button>
                <button onClick={() => tweakOne("systemPrompt")} disabled={!!tweaking} title="Regenerate system prompt" className="text-gray-300 hover:text-purple-500 disabled:opacity-50">
                  <i className={`fa-solid ${tweaking === "systemPrompt" ? "fa-spinner animate-spin" : "fa-arrows-rotate"} text-[10px]`} />
                </button>
              </div>
              {showPrompt && (
                <textarea
                  value={draft.systemPrompt || ""}
                  onChange={e => setDraft(d => ({ ...d, systemPrompt: e.target.value }))}
                  rows={10}
                  className="w-full px-3 py-2 mt-2 text-[11px] border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent dark:text-white outline-none focus:border-gray-400 resize-none font-mono"
                />
              )}
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <div className="flex gap-2 pt-2 sticky bottom-0 bg-white dark:bg-gray-900 pb-1">
              <button
                onClick={() => synthesizeNow()}
                disabled={busy}
                className="flex-1 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:border-gray-400 transition disabled:opacity-50"
                title="Re-run synthesis from the same conversation"
              >
                {busy ? <i className="fa-solid fa-spinner animate-spin" /> : <><i className="fa-solid fa-arrows-rotate mr-1.5" />Regenerate</>}
              </button>
              <button
                onClick={save}
                disabled={busy || !draft.label?.trim() || !draft.systemPrompt?.trim()}
                className="flex-1 py-2.5 rounded-lg bg-black dark:bg-white text-white dark:text-black text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
              >
                <i className="fa-solid fa-check mr-1.5" />{skill ? "Save changes" : "Save persona"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
