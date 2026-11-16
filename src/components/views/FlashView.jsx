import React, { useState, useRef, useEffect } from 'react';
import { createTask, deleteTask, createMemo, uploadTaskFile, uploadMemoFile } from '../../scripts/api.js';
import { formDate } from '../../scripts/utils.js';
import { useSearchParams } from 'react-router-dom';
import { getStoredToken } from '../../scripts/api.js';

const CARD_COLORS = [
    'bg-yellow-100 dark:bg-yellow-900/40',
    'bg-pink-100 dark:bg-pink-900/40',
    'bg-blue-100 dark:bg-blue-900/40',
    'bg-green-100 dark:bg-green-900/40',
    'bg-purple-100 dark:bg-purple-900/40',
    'bg-orange-100 dark:bg-orange-900/40',
];

const TASK_COLORS = [
    'yellow-100',
    'pink-100',
    'blue-100',
    'green-100',
    'purple-100',
    'orange-100',
];

const CATEGORY_ICONS = {
    trash: { icon: 'fa-solid fa-trash-can', label: 'Trash', color: 'text-red-400' },
    later: { icon: 'fa-regular fa-calendar', label: 'Later', color: 'text-blue-400' },
    now: { icon: 'fa-solid fa-bolt', label: 'Do Now', color: 'text-yellow-500' },
    memo: { icon: 'fa-regular fa-note-sticky', label: 'Memo', color: 'text-orange-400' },
};

const QUADRANT_LABELS = {
    q1: { label: 'Do First', sub: 'Urgent & Important', dot: 'bg-red-400', text: 'text-red-500' },
    q2: { label: 'Schedule', sub: 'Important', dot: 'bg-blue-400', text: 'text-blue-500' },
    q3: { label: 'Delegate', sub: 'Urgent', dot: 'bg-yellow-400', text: 'text-yellow-500' },
    q4: { label: 'Eliminate', sub: 'Not Important', dot: 'bg-gray-400', text: 'text-gray-400' },
};

const DIFFICULTY_CONFIG = {
    easy: { icon: 'fa-solid fa-feather', label: 'Easy', color: 'text-green-500', bg: 'bg-green-100 dark:bg-green-900/30', ring: 'ring-green-300 dark:ring-green-700' },
    medium: { icon: 'fa-solid fa-fire', label: 'Medium', color: 'text-orange-500', bg: 'bg-orange-100 dark:bg-orange-900/30', ring: 'ring-orange-300 dark:ring-orange-700' },
    hard: { icon: 'fa-solid fa-mountain', label: 'Hard', color: 'text-red-500', bg: 'bg-red-100 dark:bg-red-900/30', ring: 'ring-red-300 dark:ring-red-700' },
};
const DIFFICULTY_CYCLE = [null, 'easy', 'medium', 'hard'];

function useSpeechRecognition() {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [supported, setSupported] = useState(false);
    const recognitionRef = useRef(null);

    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            setSupported(true);
            const recognition = new SpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = true;
            recognition.lang = 'zh-HK';

            recognition.onresult = (event) => {
                let t = '';
                for (let i = 0; i < event.results.length; i++) {
                    t += event.results[i][0].transcript;
                }
                setTranscript(t);
            };

            recognition.onend = () => {
                setIsListening(false);
            };

            recognition.onerror = () => {
                setIsListening(false);
            };

            recognitionRef.current = recognition;
        }
    }, []);

    function startListening() {
        if (!recognitionRef.current) return;
        setTranscript('');
        setIsListening(true);
        try {
            recognitionRef.current.start();
        } catch {
            setIsListening(false);
        }
    }

    function stopListening() {
        if (!recognitionRef.current) return;
        recognitionRef.current.stop();
        setIsListening(false);
    }

    return { isListening, transcript, supported, startListening, stopListening };
}

const TIMER_PRESETS = [
    { label: '5 min', seconds: 5 * 60 },
    { label: '15 min', seconds: 15 * 60 },
    { label: '25 min', seconds: 25 * 60 },
    { label: '45 min', seconds: 45 * 60 },
];

function FocusTimer({ taskName, onClose }) {
    const [duration, setDuration] = useState(25 * 60);
    const [remaining, setRemaining] = useState(25 * 60);
    const [running, setRunning] = useState(false);
    const [finished, setFinished] = useState(false);
    const intervalRef = useRef(null);
    const audioRef = useRef(null);

    useEffect(() => {
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, []);

    function start() {
        if (finished) {
            setRemaining(duration);
            setFinished(false);
        }
        setRunning(true);
        intervalRef.current = setInterval(() => {
            setRemaining(prev => {
                if (prev <= 1) {
                    clearInterval(intervalRef.current);
                    intervalRef.current = null;
                    setRunning(false);
                    setFinished(true);
                    try {
                        const ctx = new (window.AudioContext || window.webkitAudioContext)();
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.connect(gain);
                        gain.connect(ctx.destination);
                        osc.frequency.value = 800;
                        gain.gain.value = 0.3;
                        osc.start();
                        osc.stop(ctx.currentTime + 0.5);
                        setTimeout(() => {
                            const osc2 = ctx.createOscillator();
                            const gain2 = ctx.createGain();
                            osc2.connect(gain2);
                            gain2.connect(ctx.destination);
                            osc2.frequency.value = 1000;
                            gain2.gain.value = 0.3;
                            osc2.start();
                            osc2.stop(ctx.currentTime + 0.3);
                        }, 600);
                    } catch {}
                    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    }

    function pause() {
        setRunning(false);
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    }

    function reset() {
        pause();
        setRemaining(duration);
        setFinished(false);
    }

    function selectPreset(seconds) {
        pause();
        setDuration(seconds);
        setRemaining(seconds);
        setFinished(false);
    }

    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const progress = duration > 0 ? (duration - remaining) / duration : 0;
    const circumference = 2 * Math.PI * 90;
    const strokeOffset = circumference * (1 - progress);

    return (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-lg">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold flex items-center gap-2">
                    <i className="fa-solid fa-hourglass-half text-yellow-500" />
                    Focus Timer
                </h3>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer">
                    <i className="fa-solid fa-xmark" />
                </button>
            </div>

            {taskName && (
                <div className="text-center mb-4 px-4 py-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                    <p className="text-[10px] text-yellow-600 dark:text-yellow-400 font-medium mb-0.5">Focusing on</p>
                    <p className="text-sm font-bold text-yellow-800 dark:text-yellow-200 truncate">{taskName}</p>
                </div>
            )}

            <div className="flex justify-center mb-5">
                <div className="relative w-52 h-52">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 200 200">
                        <circle cx="100" cy="100" r="90" fill="none"
                            stroke="currentColor" strokeWidth="6" className="text-gray-100 dark:text-gray-800" />
                        <circle cx="100" cy="100" r="90" fill="none"
                            strokeWidth="6" strokeLinecap="round"
                            strokeDasharray={circumference} strokeDashoffset={strokeOffset}
                            className={`transition-all duration-1000 ease-linear ${finished ? 'text-green-500' : running ? 'text-yellow-500' : 'text-gray-300 dark:text-gray-600'}`}
                            stroke="currentColor" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className={`text-4xl font-black tabular-nums tracking-tight ${finished ? 'text-green-500' : ''}`}>
                            {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
                        </span>
                        {finished && (
                            <span className="text-sm font-medium text-green-500 mt-1 animate-pulse">Done!</span>
                        )}
                        {running && !finished && (
                            <span className="text-[10px] text-yellow-500 mt-1 font-medium">Focusing...</span>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex justify-center gap-2 mb-4">
                {TIMER_PRESETS.map(p => (
                    <button key={p.seconds} onClick={() => selectPreset(p.seconds)}
                        disabled={running}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${duration === p.seconds
                            ? 'bg-black dark:bg-white text-white dark:text-black'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                    >
                        {p.label}
                    </button>
                ))}
            </div>

            <div className="flex justify-center gap-3">
                {!running && !finished && (
                    <button onClick={start}
                        className="px-8 py-3 bg-black dark:bg-white text-white dark:text-black rounded-xl font-bold text-sm hover:opacity-80 transition cursor-pointer">
                        <i className="fa-solid fa-play mr-2" />Start
                    </button>
                )}
                {running && (
                    <button onClick={pause}
                        className="px-8 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-bold text-sm hover:opacity-80 transition cursor-pointer">
                        <i className="fa-solid fa-pause mr-2" />Pause
                    </button>
                )}
                {(remaining < duration || finished) && (
                    <button onClick={reset}
                        className="px-6 py-3 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-xl font-medium text-sm hover:bg-gray-200 dark:hover:bg-gray-700 transition cursor-pointer">
                        <i className="fa-solid fa-arrow-rotate-left mr-2" />Reset
                    </button>
                )}
                {finished && (
                    <button onClick={onClose}
                        className="px-6 py-3 bg-green-500 text-white rounded-xl font-bold text-sm hover:opacity-80 transition cursor-pointer">
                        <i className="fa-solid fa-check mr-2" />Done
                    </button>
                )}
            </div>

            <p className="text-center text-[10px] text-gray-300 dark:text-gray-600 mt-4">
                Tip: Put your phone face-down during focus time
            </p>
        </div>
    );
}

export default function DumpView({ tasks, onTasksChanged }) {
    const [items, setItems] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [dismissing, setDismissing] = useState({});
    const [aiSuggestions, setAiSuggestions] = useState({});
    const [aiLoading, setAiLoading] = useState(false);
    const [ocrLoading, setOcrLoading] = useState(false);
    const [showTimer, setShowTimer] = useState(false);
    const inputRef = useRef(null);
    const fileInputRef = useRef(null);
    const cameraInputRef = useRef(null);
    const [, setSearchParams] = useSearchParams();
    const colorIdx = useRef(0);

    const { isListening, transcript, supported, startListening, stopListening } = useSpeechRecognition();

    useEffect(() => {
        if (inputRef.current) inputRef.current.focus();
        try {
            const saved = localStorage.getItem('flash_items');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setItems(parsed.map(it => ({
                        ...it,
                        imagePreview: it.imagePreview || undefined,
                        imageFile: undefined,
                    })));
                    colorIdx.current = parsed.length;
                }
            }
        } catch {}
        const sharedText = sessionStorage.getItem('flash_shared_text');
        if (sharedText) {
            sessionStorage.removeItem('flash_shared_text');
            addItem(sharedText);
        }
    }, []);

    useEffect(() => {
        try {
            if (items.length > 0) {
                const toSave = items.map(({ imageFile, ...rest }) => rest);
                localStorage.setItem('flash_items', JSON.stringify(toSave));
            } else if (colorIdx.current > 0) {
                localStorage.removeItem('flash_items');
            }
        } catch {}
    }, [items]);

    useEffect(() => {
        if (transcript) {
            setInputValue(transcript);
        }
    }, [transcript]);

    function addItem(text) {
        const val = (text || inputValue).trim();
        if (!val) return;
        const ci = colorIdx.current % CARD_COLORS.length;
        colorIdx.current++;
        setItems(prev => [...prev, { id: Date.now(), text: val, colorClass: CARD_COLORS[ci], taskColor: TASK_COLORS[ci], difficulty: null }]);
        setInputValue('');
        setTimeout(() => inputRef.current?.focus(), 0);
    }

    function cycleDifficulty(itemId) {
        setItems(prev => prev.map(it => {
            if (it.id !== itemId) return it;
            const currentIdx = DIFFICULTY_CYCLE.indexOf(it.difficulty || null);
            const nextIdx = (currentIdx + 1) % DIFFICULTY_CYCLE.length;
            return { ...it, difficulty: DIFFICULTY_CYCLE[nextIdx] };
        }));
    }

    function handleVoiceToggle() {
        if (isListening) {
            stopListening();
            if (transcript.trim()) {
                setTimeout(() => addItem(transcript.trim()), 100);
            }
        } else {
            startListening();
        }
    }

    async function handleImageOCR(file) {
        if (!file || ocrLoading) return;
        setOcrLoading(true);
        try {
            const token = getStoredToken();
            const formData = new FormData();
            formData.append('image', file);
            const resp = await fetch('/api/ocr', {
                method: 'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                body: formData,
            });
            const data = await resp.json();
            if (data.lines && data.lines.length > 0) {
                const imagePreview = data.imageBase64;
                data.lines.forEach(line => {
                    const ci = colorIdx.current % CARD_COLORS.length;
                    colorIdx.current++;
                    setItems(prev => [...prev, {
                        id: Date.now() + Math.random(),
                        text: line,
                        colorClass: CARD_COLORS[ci],
                        taskColor: TASK_COLORS[ci],
                        imagePreview,
                        imageFile: file,
                    }]);
                });
            } else if (data.text) {
                const ci = colorIdx.current % CARD_COLORS.length;
                colorIdx.current++;
                setItems(prev => [...prev, {
                    id: Date.now(),
                    text: data.text,
                    colorClass: CARD_COLORS[ci],
                    taskColor: TASK_COLORS[ci],
                    imagePreview: data.imageBase64,
                    imageFile: file,
                }]);
            }
        } catch (err) {
            console.error('OCR error:', err);
        }
        setOcrLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (cameraInputRef.current) cameraInputRef.current.value = '';
    }

    function dismissItem(id, direction) {
        setDismissing(prev => ({ ...prev, [id]: direction }));
        setTimeout(() => {
            setItems(prev => prev.filter(it => it.id !== id));
            setDismissing(prev => {
                const n = { ...prev };
                delete n[id];
                return n;
            });
            setAiSuggestions(prev => {
                const n = { ...prev };
                delete n[id];
                return n;
            });
        }, 300);
    }

    async function handleTrash(item) {
        dismissItem(item.id, 'trash');
    }

    async function handleLater(item) {
        dismissItem(item.id, 'later');
        const sug = aiSuggestions[item.id];
        const quadrant = sug?.quadrant || null;
        const task = await createTask({
            name: item.text,
            color: `${item.taskColor} text-black`,
            date: 'notes',
            done: false,
            order: 0,
            eisenhowerQuadrant: quadrant,
        });
        if (item.imageFile && task?.id) {
            try { await uploadTaskFile(task.id, item.imageFile); } catch {}
        }
        if (onTasksChanged) onTasksChanged();
    }

    async function handleNow(item) {
        dismissItem(item.id, 'now');
        const today = formDate(new Date());
        const sug = aiSuggestions[item.id];
        const quadrant = sug?.quadrant || null;
        const task = await createTask({
            name: item.text,
            color: `${item.taskColor} text-black`,
            date: today,
            done: false,
            order: 0,
            eisenhowerQuadrant: quadrant,
        });
        if (item.imageFile && task?.id) {
            try { await uploadTaskFile(task.id, item.imageFile); } catch {}
        }
        if (onTasksChanged) onTasksChanged();
    }

    async function handleMemo(item) {
        dismissItem(item.id, 'memo');
        const memo = await createMemo({ content: item.text });
        if (item.imageFile && memo?.id) {
            try { await uploadMemoFile(memo.id, item.imageFile); } catch {}
        }
    }

    async function handleAiSort() {
        if (items.length === 0 || aiLoading) return;
        setAiLoading(true);
        try {
            const token = getStoredToken();
            const resp = await fetch('/api/dump/ai-sort', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ items: items.map(it => it.text) }),
            });
            const data = await resp.json();
            if (data.suggestions && Array.isArray(data.suggestions)) {
                const map = {};
                data.suggestions.forEach(s => {
                    const item = items[s.index - 1];
                    if (item) {
                        map[item.id] = { category: s.category, reason: s.reason, quadrant: s.quadrant || null, difficulty: s.difficulty || null };
                    }
                });
                setAiSuggestions(map);
                setItems(prev => prev.map(it => {
                    const sug = map[it.id];
                    if (sug?.difficulty && !it.difficulty) {
                        return { ...it, difficulty: sug.difficulty };
                    }
                    return it;
                }));
            }
        } catch (err) {
            console.error('AI sort error:', err);
        }
        setAiLoading(false);
    }

    async function handleAutoSort() {
        if (Object.keys(aiSuggestions).length === 0) return;
        const toProcess = [...items];
        for (const item of toProcess) {
            const sug = aiSuggestions[item.id];
            if (!sug) continue;
            if (sug.category === 'trash') await handleTrash(item);
            else if (sug.category === 'later') await handleLater(item);
            else if (sug.category === 'now') await handleNow(item);
            else if (sug.category === 'memo') await handleMemo(item);
            await new Promise(r => setTimeout(r, 400));
        }
    }

    async function handlePasteFromClipboard() {
        try {
            let text = '';
            if (navigator.clipboard.read) {
                try {
                    const clipItems = await navigator.clipboard.read();
                    for (const item of clipItems) {
                        if (item.types.includes('text/plain')) {
                            const blob = await item.getType('text/plain');
                            text = await blob.text();
                        }
                    }
                } catch {
                    text = await navigator.clipboard.readText();
                }
            } else {
                text = await navigator.clipboard.readText();
            }
            if (text.trim()) {
                addItem(text.trim());
            }
        } catch (e) {
            console.error('Clipboard paste error:', e);
        }
    }

    function goToDay() {
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
        setSearchParams(prev => {
            prev.set('view', 'day');
            prev.set('viewDate', dateStr);
            return prev;
        });
    }

    const allSorted = items.length === 0 && colorIdx.current > 0;

    const undoneToday = (tasks || []).filter(t => {
        if (t.done) return false;
        const today = formDate(new Date());
        return t.date === today;
    });

    const nextTask = undoneToday.length > 0 ? undoneToday[0] : null;

    return (
        <div className="padding-x py-6 dark:bg-black dark:text-white min-h-screen max-lg:mt-12">
            <div className="max-w-lg mx-auto">
                <div className="text-center mb-6">
                    <div className="flex items-center justify-center gap-3 mb-1">
                        <h2 className="text-2xl font-black tracking-tight">Flash</h2>
                        <button
                            onClick={() => setShowTimer(!showTimer)}
                            className={`w-8 h-8 rounded-full flex items-center justify-center transition cursor-pointer ${showTimer ? 'bg-yellow-400 text-yellow-900' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 hover:text-yellow-500'}`}
                            title="Focus Timer"
                        >
                            <i className="fa-solid fa-hourglass-half text-sm" />
                        </button>
                    </div>
                    <p className="text-sm text-gray-400">Write everything down. Don't think about order.</p>
                </div>

                {showTimer && (
                    <div className="mb-5">
                        <FocusTimer
                            taskName={nextTask?.name}
                            onClose={() => setShowTimer(false)}
                        />
                    </div>
                )}

                <div className="mb-4">
                    <div className="flex gap-2">
                        <input
                            ref={inputRef}
                            type="text"
                            value={inputValue}
                            onChange={e => setInputValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') addItem(); }}
                            className="flex-1 min-w-0 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-base focus:outline-none focus:ring-2 focus:ring-yellow-300 dark:focus:ring-yellow-600 placeholder:text-gray-300"
                            placeholder={ocrLoading ? 'Reading image...' : isListening ? 'Listening...' : "What's on your mind?"}
                            autoFocus
                        />
                        <button
                            onClick={() => addItem()}
                            className="px-4 py-3 bg-black dark:bg-white text-white dark:text-black rounded-xl font-bold text-sm hover:opacity-80 transition cursor-pointer shrink-0"
                        >
                            +
                        </button>
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handleImageOCR(e.target.files[0])} />
                    <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => e.target.files?.[0] && handleImageOCR(e.target.files[0])} />
                    <div className="flex gap-2 mt-2 justify-center">
                        <button
                            onClick={() => cameraInputRef.current?.click()}
                            disabled={ocrLoading}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
                            title="Take photo"
                        >
                            {ocrLoading ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-camera" />}
                            <span className="max-sm:hidden">Camera</span>
                        </button>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={ocrLoading}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
                            title="Upload image"
                        >
                            <i className="fa-solid fa-image" />
                            <span className="max-sm:hidden">Photo</span>
                        </button>
                        {supported && (
                            <button
                                onClick={handleVoiceToggle}
                                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                                title={isListening ? 'Stop recording' : 'Voice input'}
                            >
                                <i className="fa-solid fa-microphone" />
                                <span className="max-sm:hidden">{isListening ? 'Stop' : 'Voice'}</span>
                            </button>
                        )}
                        <button
                            onClick={handlePasteFromClipboard}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                            title="Paste from clipboard"
                        >
                            <i className="fa-solid fa-clipboard" />
                            <span className="max-sm:hidden">Paste</span>
                        </button>
                    </div>
                </div>

                {items.length > 0 && (
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-xs text-gray-400">
                            {items.length} item{items.length > 1 ? 's' : ''} to sort
                        </p>
                        <div className="flex gap-2">
                            {Object.keys(aiSuggestions).length > 0 && (
                                <button
                                    onClick={handleAutoSort}
                                    className="text-xs px-3 py-1.5 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 font-medium hover:bg-green-200 dark:hover:bg-green-900/50 transition cursor-pointer"
                                >
                                    <i className="fa-solid fa-wand-magic-sparkles mr-1" />
                                    Auto-sort all
                                </button>
                            )}
                            <button
                                onClick={handleAiSort}
                                disabled={aiLoading}
                                className="text-xs px-3 py-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 font-medium hover:bg-purple-200 dark:hover:bg-purple-900/50 transition cursor-pointer disabled:opacity-50"
                            >
                                {aiLoading ? (
                                    <><i className="fa-solid fa-spinner fa-spin mr-1" />Thinking...</>
                                ) : (
                                    <><i className="fa-solid fa-brain mr-1" />AI Suggest</>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                <div className="space-y-3">
                    {items.map(item => {
                        const d = dismissing[item.id];
                        let animClass = 'translate-x-0 opacity-100';
                        if (d === 'trash') animClass = '-translate-x-full opacity-0';
                        if (d === 'later') animClass = 'translate-x-full opacity-0 scale-95';
                        if (d === 'now') animClass = '-translate-y-8 opacity-0 scale-95';
                        if (d === 'memo') animClass = 'translate-y-8 opacity-0 scale-95';

                        const suggestion = aiSuggestions[item.id];

                        return (
                            <div
                                key={item.id}
                                className={`rounded-xl p-4 shadow-sm ${item.colorClass} transform transition-all duration-300 ease-out ${animClass}`}
                            >
                                {item.imagePreview && (
                                    <div className="mb-2">
                                        <img src={item.imagePreview} alt="OCR source" className="w-full max-h-32 object-cover rounded-lg opacity-80" />
                                    </div>
                                )}
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <p className="text-sm font-medium text-gray-800 flex-1">{item.text}</p>
                                    <button
                                        onClick={() => cycleDifficulty(item.id)}
                                        className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition cursor-pointer ${item.difficulty && DIFFICULTY_CONFIG[item.difficulty] ? `${DIFFICULTY_CONFIG[item.difficulty].bg} ${DIFFICULTY_CONFIG[item.difficulty].color}` : 'bg-gray-200/60 dark:bg-gray-700/40 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                                        title="Set difficulty"
                                    >
                                        <i className={item.difficulty && DIFFICULTY_CONFIG[item.difficulty] ? DIFFICULTY_CONFIG[item.difficulty].icon : 'fa-solid fa-signal'} />
                                        {item.difficulty && DIFFICULTY_CONFIG[item.difficulty] ? DIFFICULTY_CONFIG[item.difficulty].label : 'Diff'}
                                    </button>
                                </div>
                                {suggestion && (
                                    <div className="flex flex-wrap items-center gap-1.5 mb-2 text-xs">
                                        <span className={`flex items-center gap-1 ${CATEGORY_ICONS[suggestion.category]?.color || 'text-gray-400'}`}>
                                            <i className={CATEGORY_ICONS[suggestion.category]?.icon || 'fa-solid fa-circle'} />
                                            <span className="font-medium">AI: {CATEGORY_ICONS[suggestion.category]?.label || suggestion.category}</span>
                                        </span>
                                        {suggestion.quadrant && QUADRANT_LABELS[suggestion.quadrant] && (
                                            <span className={`flex items-center gap-1 ${QUADRANT_LABELS[suggestion.quadrant].text}`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${QUADRANT_LABELS[suggestion.quadrant].dot}`} />
                                                <span className="font-medium">{QUADRANT_LABELS[suggestion.quadrant].label}</span>
                                            </span>
                                        )}
                                        {suggestion.difficulty && DIFFICULTY_CONFIG[suggestion.difficulty] && (
                                            <span className={`flex items-center gap-1 ${DIFFICULTY_CONFIG[suggestion.difficulty].color}`}>
                                                <i className={DIFFICULTY_CONFIG[suggestion.difficulty].icon} />
                                                <span className="font-medium">{DIFFICULTY_CONFIG[suggestion.difficulty].label}</span>
                                            </span>
                                        )}
                                        {suggestion.reason && <span className="text-gray-400">· {suggestion.reason}</span>}
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleTrash(item)}
                                        className={`flex-1 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${suggestion?.category === 'trash' ? 'bg-red-200 dark:bg-red-900/50 text-red-600 dark:text-red-400 ring-2 ring-red-300 dark:ring-red-700' : 'bg-gray-200/80 dark:bg-gray-700/60 text-gray-500 dark:text-gray-400 hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-900/40 dark:hover:text-red-400'}`}
                                    >
                                        <i className="fa-solid fa-trash-can mr-1" />
                                        Trash
                                    </button>
                                    <button
                                        onClick={() => handleLater(item)}
                                        className={`flex-1 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${suggestion?.category === 'later' ? 'bg-blue-200 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 ring-2 ring-blue-300 dark:ring-blue-700' : 'bg-gray-200/80 dark:bg-gray-700/60 text-gray-500 dark:text-gray-400 hover:bg-blue-100 hover:text-blue-500 dark:hover:bg-blue-900/40 dark:hover:text-blue-400'}`}
                                    >
                                        <i className="fa-regular fa-calendar mr-1" />
                                        Later
                                    </button>
                                    <button
                                        onClick={() => handleMemo(item)}
                                        className={`flex-1 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${suggestion?.category === 'memo' ? 'bg-orange-200 dark:bg-orange-900/50 text-orange-600 dark:text-orange-400 ring-2 ring-orange-300 dark:ring-orange-700' : 'bg-gray-200/80 dark:bg-gray-700/60 text-gray-500 dark:text-gray-400 hover:bg-orange-100 hover:text-orange-500 dark:hover:bg-orange-900/40 dark:hover:text-orange-400'}`}
                                    >
                                        <i className="fa-regular fa-note-sticky mr-1" />
                                        Memo
                                    </button>
                                    <button
                                        onClick={() => handleNow(item)}
                                        className={`flex-1 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${suggestion?.category === 'now' ? 'bg-yellow-300 dark:bg-yellow-700 text-yellow-800 dark:text-yellow-100 ring-2 ring-yellow-400 dark:ring-yellow-600' : 'bg-gray-800 dark:bg-white text-white dark:text-black hover:opacity-80'}`}
                                    >
                                        <i className="fa-solid fa-bolt mr-1" />
                                        Do Now
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {allSorted && (
                    <div className="text-center mt-10 animate-fade-in">
                        <div className="text-4xl mb-3">🎯</div>
                        <h3 className="text-xl font-bold mb-1">All sorted!</h3>
                        <p className="text-sm text-gray-400 mb-4">Your brain is clear. Time to start doing.</p>
                        {nextTask && (
                            <div className="mb-4 p-3 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                                <p className="text-xs text-green-600 dark:text-green-400 font-medium mb-1">Next up:</p>
                                <p className="text-sm font-bold text-green-800 dark:text-green-200">{nextTask.name}</p>
                            </div>
                        )}
                        <button
                            onClick={goToDay}
                            className="px-6 py-3 bg-black dark:bg-white text-white dark:text-black rounded-xl font-bold text-sm hover:opacity-80 transition cursor-pointer"
                        >
                            Go to Today →
                        </button>
                    </div>
                )}

                {items.length === 0 && colorIdx.current === 0 && (
                    <div className="text-center mt-16">
                        <div className="text-5xl mb-4 opacity-20">📝</div>
                        <p className="text-sm text-gray-300 dark:text-gray-600">
                            Type anything and press Enter.<br />
                            {supported && <>Or tap <i className="fa-solid fa-microphone" /> to speak.<br /></>}
                            Tap <i className="fa-solid fa-camera" /> to scan handwritten notes.<br />
                            Don't think, just write.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
