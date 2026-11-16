import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TEMPLATES as WB_TEMPLATES } from '../../lib/whiteboardTemplates.js';
import { createWhiteboard, updateWhiteboard, getMemoTitles } from '../../scripts/api.js';
import { NewMemoEditor } from './MemoView.jsx';

// Inline SVG previews for the four scaffolds.
function MandalaPreview() {
    const cells = [];
    for (let i = 0; i <= 9; i++) {
        const p = (i / 9) * 90;
        const sw = i % 3 === 0 ? 1.5 : 0.5;
        cells.push(<line key={`h${i}`} x1="5" y1={5 + p} x2="95" y2={5 + p} strokeWidth={sw} />);
        cells.push(<line key={`v${i}`} x1={5 + p} y1="5" x2={5 + p} y2="95" strokeWidth={sw} />);
    }
    return <svg viewBox="0 0 100 100" className="w-full h-full" stroke="currentColor" fill="none">{cells}</svg>;
}
function AxisPreview() {
    return (
        <svg viewBox="0 0 100 100" className="w-full h-full" stroke="currentColor" fill="none">
            <rect x="8" y="8" width="84" height="84" strokeDasharray="3 3" opacity="0.4" />
            <line x1="8" y1="50" x2="92" y2="50" />
            <line x1="50" y1="92" x2="50" y2="8" />
            <polyline points="88,46 92,50 88,54" />
            <polyline points="46,12 50,8 54,12" />
        </svg>
    );
}
function ConcentricPreview() {
    const slices = [];
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        slices.push(<line key={i} x1="50" y1="50" x2={50 + Math.cos(a) * 42} y2={50 + Math.sin(a) * 42} strokeWidth="0.5" opacity="0.5" />);
    }
    return (
        <svg viewBox="0 0 100 100" className="w-full h-full" stroke="currentColor" fill="none">
            <circle cx="50" cy="50" r="14" />
            <circle cx="50" cy="50" r="28" />
            <circle cx="50" cy="50" r="42" strokeWidth="1.5" />
            {slices}
        </svg>
    );
}
function FourPanelPreview() {
    const rects = [];
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
            rects.push(<rect key={`${r}-${c}`} x={10 + c * 42} y={6 + r * 22} width="38" height="18" rx="2" />);
        }
    }
    return <svg viewBox="0 0 100 100" className="w-full h-full" stroke="currentColor" fill="none">{rects}</svg>;
}

const PREVIEWS = {
    mandala: MandalaPreview,
    axis:    AxisPreview,
    circle:  ConcentricPreview,
    '4panel': FourPanelPreview,
};

function todayStamp() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function ThinkView() {
    const [, setSearchParams] = useSearchParams();
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState('');
    const [memoTitles, setMemoTitles] = useState([]);
    // Bump key to remount NewMemoEditor (= reset its internal state) after save.
    const [editorKey, setEditorKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        getMemoTitles()
            .then(rows => { if (!cancelled) setMemoTitles(rows || []); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    async function startWithTemplate(tpl) {
        if (busy) return;
        setBusy(tpl.key);
        setError('');
        try {
            const name = `${tpl.label} · ${todayStamp()}`;
            const board = await createWhiteboard(name);
            const boardId = board?.id || board?.whiteboardId;
            if (!boardId) throw new Error('Created board missing id');
            const elements = tpl.build({ centerX: 400, centerY: 400 });
            const data = JSON.stringify({
                elements,
                appState: { viewBackgroundColor: '#ffffff' },
                files: {},
            });
            await updateWhiteboard(boardId, { data });
            setSearchParams(prev => {
                prev.set('view', 'white');
                prev.set('board', String(boardId));
                return prev;
            });
        } catch (e) {
            console.error(e);
            setError('Could not create whiteboard. Please try again.');
            setBusy(null);
        }
    }

    return (
        <div className="min-h-[calc(100vh-3.5rem)] px-4 sm:px-8 py-8 max-w-6xl mx-auto">
            {/* Full-screen quick-capture composer ---------------------------------- */}
            <section className="mb-12">
                <div className="mb-3 flex items-baseline justify-between">
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-gray-100">
                        Think it out
                    </h1>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                        Saved memos appear under <i className="fa-solid fa-note-sticky mx-1" />Memo
                    </span>
                </div>
                {/* The `[&_textarea]` arbitrary variant stretches NewMemoEditor's
                    inner textarea so the composer feels full-screen on this page
                    without having to fork the component. */}
                <div className="[&_textarea]:min-h-[55vh] [&_textarea]:text-base">
                    <NewMemoEditor
                        key={editorKey}
                        memoTitles={memoTitles}
                        onDone={() => {
                            setEditorKey(k => k + 1);
                            // Refresh titles so the just-saved memo shows up in [[ autocomplete.
                            getMemoTitles()
                                .then(rows => setMemoTitles(rows || []))
                                .catch(() => {});
                        }}
                        onCancel={() => setEditorKey(k => k + 1)}
                    />
                </div>
            </section>

            {/* Visual scaffolds ----------------------------------------------------- */}
            <section>
                <div className="mb-6 text-center">
                    <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100">思考ツール · Visual Scaffolds</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Or pick a scaffold — it spins up a fresh whiteboard with real shapes you can drag, recolour, and label.
                    </p>
                </div>

                {error && <div className="mb-4 text-center text-xs text-red-500">{error}</div>}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    {WB_TEMPLATES.map(tpl => {
                        const Preview = PREVIEWS[tpl.key];
                        const loading = busy === tpl.key;
                        return (
                            <button
                                key={tpl.key}
                                onClick={() => startWithTemplate(tpl)}
                                disabled={!!busy}
                                className="group text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm hover:shadow-lg hover:border-purple-300 dark:hover:border-purple-500 transition cursor-pointer disabled:opacity-50 disabled:cursor-wait flex gap-4 items-start"
                            >
                                <div className="w-28 h-28 flex-shrink-0 text-gray-400 dark:text-gray-500 group-hover:text-purple-500 dark:group-hover:text-purple-400 transition bg-gray-50 dark:bg-gray-950/40 rounded-xl p-2 flex items-center justify-center">
                                    {Preview ? <Preview /> : <i className={`fa-solid ${tpl.icon} text-3xl`} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <i className={`fa-solid ${tpl.icon} text-sm text-gray-400`} />
                                        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">{tpl.label}</h3>
                                    </div>
                                    <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{tpl.desc}</p>
                                    <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-purple-600 dark:text-purple-400 group-hover:gap-2 transition-all">
                                        {loading ? (
                                            <><i className="fa-solid fa-spinner fa-spin" /> Creating board…</>
                                        ) : (
                                            <>Open whiteboard <i className="fa-solid fa-arrow-right text-[10px]" /></>
                                        )}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}
