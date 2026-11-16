import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getStoredToken, getCustomSkills, generateCustomSkill, saveCustomSkill, updateCustomSkill, deleteCustomSkill, correctCustomSkill, evolveCustomSkill, listMuseMemories, createMuseMemory, updateMuseMemory, deleteMuseMemory, clearAllMuseMemories, clearMuseMemoriesByConversation, createMemo, importMuseConversations } from '../../scripts/api.js';
import SoulCraftModal from '../SoulCraftModal.jsx';
import { isWrapUpMessage, extractWrapUpMemo, slugifyTitle } from '../../lib/wrapup.js';

async function apiFetch(url, options = {}) {
    const token = getStoredToken();
    const res = await fetch(url, {
        credentials: "include",
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...options.headers,
        },
    });
    if (!res.ok) throw new Error("Request failed");
    return res;
}

const SKILLS = [
    { key: 'default', label: 'Muse', icon: 'fa-wand-magic-sparkles', color: 'text-gray-500', desc: 'General assistant' },
    { key: 'analytics', label: 'Analytics', icon: 'fa-chart-line', color: 'text-emerald-500', desc: 'Productivity insights' },
    { key: 'writer', label: 'Writer', icon: 'fa-pen-fancy', color: 'text-blue-500', desc: 'Writing & notes' },
    { key: 'planner', label: 'Planner', icon: 'fa-calendar-check', color: 'text-orange-500', desc: 'Schedule optimizer' },
    { key: 'adhd', label: 'ADHD Coach', icon: 'fa-brain', color: 'text-pink-500', desc: 'Focus & motivation' },
    { key: 'journal', label: 'Journal Coach', icon: 'fa-feather', color: 'text-teal-500', desc: 'Reflect on today\'s journal' },
    { key: 'brainstorm', label: 'Brainstorm', icon: 'fa-lightbulb', color: 'text-yellow-500', desc: 'Creative ideation' },
    { key: 'xuefeng', label: '張雪峰', icon: 'fa-graduation-cap', color: 'text-red-500', desc: '志願填報 · 職業規劃' },
    { key: 'musk', label: 'Elon Musk', icon: 'fa-rocket', color: 'text-blue-400', desc: '第一性原理' },
    { key: 'munger', label: '查理芒格', icon: 'fa-scale-balanced', color: 'text-amber-600', desc: '多元思維模型' },
    { key: 'feynman', label: '費曼', icon: 'fa-atom', color: 'text-cyan-500', desc: '費曼學習法' },
    { key: 'naval', label: 'Naval', icon: 'fa-anchor', color: 'text-indigo-500', desc: '財富 · 槓桿' },
    { key: 'careerOps', label: 'Career Ops', icon: 'fa-briefcase', color: 'text-slate-600', desc: 'Job-search command center' },
    { key: 'grillMe', label: 'Grill Me', icon: 'fa-fire', color: 'text-red-600', desc: 'Stress-test any plan' },
    { key: 'specBuilder', label: 'Spec Builder', icon: 'fa-clipboard-list', color: 'text-violet-500', desc: 'Interview into a paste-ready spec' },
    { key: 'manager', label: 'Manager', icon: 'fa-user-tie', color: 'text-purple-500', desc: 'Plans & delegates' },
];

const SUGGESTION_LABEL_TO_KEY = {
    'Planner': 'planner',
    'planner': 'planner',
    'ADHD Coach': 'adhd',
    'ADHD': 'adhd',
    'Analytics': 'analytics',
    'Journal Coach': 'journal',
    'Journal': 'journal',
    'Writer': 'writer',
    'Brainstorm': 'brainstorm',
    '張雪峰': 'xuefeng',
    '张雪峰': 'xuefeng',
    'Musk': 'musk',
    'Elon Musk': 'musk',
    '芒格': 'munger',
    '查理芒格': 'munger',
    '費曼': 'feynman',
    '费曼': 'feynman',
    'Feynman': 'feynman',
    'Naval': 'naval',
    'Career Ops': 'careerOps',
    'CareerOps': 'careerOps',
    'career ops': 'careerOps',
    'Grill Me': 'grillMe',
    'GrillMe': 'grillMe',
    'grill me': 'grillMe',
    'Grill': 'grillMe',
    'Spec Builder': 'specBuilder',
    'SpecBuilder': 'specBuilder',
    'spec builder': 'specBuilder',
    'Spec': 'specBuilder',
};

const SUGGESTION_REGEX = /switch to the \*\*([^*]+)\*\* skill/gi;

// Wrap-up detection + extraction live in src/lib/wrapup.js so both Grill Me
// and Spec Builder flavours share one code path (and tests can import them).

// Compute today's date as YYYY-MM-DD in the browser's local timezone (which
// matches the user's clock for this UI). Avoids the UTC-midnight off-by-one
// that `new Date().toISOString().slice(0,10)` would cause.
function todayLocalISO() {
    return new Date().toLocaleDateString('en-CA');
}

const ICON_OPTIONS = [
    'fa-user', 'fa-user-tie', 'fa-face-smile', 'fa-heart', 'fa-star',
    'fa-comment', 'fa-comments', 'fa-message', 'fa-fire', 'fa-bolt',
    'fa-crown', 'fa-gem', 'fa-ghost', 'fa-cat', 'fa-dog',
    'fa-music', 'fa-palette', 'fa-code', 'fa-gamepad', 'fa-trophy',
];

const COLOR_OPTIONS = [
    'text-purple-500', 'text-pink-500', 'text-rose-500', 'text-red-500',
    'text-orange-500', 'text-amber-500', 'text-yellow-500', 'text-lime-500',
    'text-green-500', 'text-emerald-500', 'text-teal-500', 'text-cyan-500',
    'text-sky-500', 'text-blue-500', 'text-indigo-500', 'text-violet-500',
];

function getSkillInfo(key, userSkills = []) {
    const builtIn = SKILLS.find(s => s.key === key);
    if (builtIn) return builtIn;
    const custom = userSkills.find(s => s.key === key);
    if (custom) return { key: custom.key, label: custom.label, icon: custom.icon, color: custom.color, desc: custom.description };
    return SKILLS[0];
}

export default function MuseView({ onTasksChanged }) {
    const [conversations, setConversations] = useState([]);
    const [activeConvoId, setActiveConvoId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [model, setModel] = useState(localStorage.getItem("muse_model") || "gpt-4o-mini");
    const [streaming, setStreaming] = useState(false);
    const [streamText, setStreamText] = useState("");
    const [showSidebar, setShowSidebar] = useState(false);
    const [pendingImage, setPendingImage] = useState(null);
    const [pendingImagePreview, setPendingImagePreview] = useState(null);
    const [searchParams, setSearchParams] = useSearchParams();
    const [activeSkill, setActiveSkill] = useState(() => searchParams.get('skill') || 'default');
    const [userSkills, setUserSkills] = useState([]);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(null);
    const [showSoulCraftCreate, setShowSoulCraftCreate] = useState(false);
    const [showSoulCraftRefine, setShowSoulCraftRefine] = useState(null);
    const [showSpecBuilderSettings, setShowSpecBuilderSettings] = useState(false);
    const [skillContextMenu, setSkillContextMenu] = useState(null);
    const [showMemoryPanel, setShowMemoryPanel] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [showWikiPanel, setShowWikiPanel] = useState(false);
    const [viewingRunId, setViewingRunId] = useState(null);
    const [pendingScrollMessageId, setPendingScrollMessageId] = useState(null);
    const [highlightedMessageId, setHighlightedMessageId] = useState(null);
    // Per-message save state for the wrap-up "Save as memo" button.
    // Shape: { [msgId]: { status: 'saving' | 'saved' | 'error', memoId?: number } }
    const [wrapupSaveState, setWrapupSaveState] = useState({});
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const imageInputRef = useRef(null);
    const cameraInputRef = useRef(null);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, []);

    useEffect(() => {
        loadConversations();
        loadUserSkills();
    }, []);

    // Deep-link: ?convo=<id> selects that conversation on mount and strips the param.
    useEffect(() => {
        const cid = searchParams.get('convo');
        const mid = searchParams.get('msg');
        if (cid) {
            const numCid = Number(cid);
            if (Number.isFinite(numCid)) setActiveConvoId(numCid);
            if (mid) {
                const numMid = Number(mid);
                if (Number.isFinite(numMid)) setPendingScrollMessageId(numMid);
            }
            setSearchParams(prev => {
                prev.delete('convo');
                prev.delete('msg');
                return prev;
            }, { replace: true });
        }
    // Run only on mount; subsequent updates use direct setActiveConvoId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (activeConvoId) {
            loadMessages(activeConvoId);
        } else {
            setMessages([]);
        }
    }, [activeConvoId]);

    useEffect(() => {
        if (pendingScrollMessageId && messages.some(m => m.id === pendingScrollMessageId)) {
            const el = document.getElementById(`muse-msg-${pendingScrollMessageId}`);
            if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                setHighlightedMessageId(pendingScrollMessageId);
                setPendingScrollMessageId(null);
                setTimeout(() => setHighlightedMessageId(null), 2500);
                return;
            }
        }
        scrollToBottom();
    }, [messages, streamText, pendingScrollMessageId, scrollToBottom]);

    async function loadUserSkills() {
        try {
            const skills = await getCustomSkills();
            setUserSkills(skills);
        } catch (e) {
            console.error("Failed to load custom skills", e);
        }
    }

    async function loadConversations() {
        try {
            const res = await apiFetch("/api/muse/conversations");
            const data = await res.json();
            setConversations(data);
        } catch (e) {
            console.error("Failed to load conversations", e);
        }
    }

    async function loadCustomSkills() {
        try {
            const data = await getCustomSkills();
            setUserSkills(data);
        } catch (e) {
            console.error("Failed to load custom skills", e);
        }
    }

    async function handleCreateSkill() {
        if (!skillName.trim() || !skillChatLog.trim()) return;
        setGeneratingSkill(true);
        try {
            await generateCustomSkill(skillName.trim(), skillChatLog.trim(), skillIcon, skillColor);
            await loadCustomSkills();
            setShowCreateSkill(false);
            setSkillName('');
            setSkillChatLog('');
            setSkillIcon('fa-user');
            setSkillColor('text-purple-500');
        } catch (e) {
            console.error("Failed to generate skill", e);
        }
        setGeneratingSkill(false);
    }

    async function handleDeleteSkill(id, e) {
        e.stopPropagation();
        if (!confirm('Delete this skill?')) return;
        try {
            await deleteCustomSkill(id);
            setUserSkills(prev => prev.filter(s => s.id !== id));
            if (activeSkill === `custom_${userSkills.find(s => s.id === id)?.key}`) {
                setActiveSkill('default');
            }
        } catch (e) {
            console.error("Failed to delete skill", e);
        }
    }

    async function loadMessages(convoId) {
        try {
            const res = await apiFetch(`/api/muse/conversations/${convoId}/messages`);
            const data = await res.json();
            setMessages(data);
        } catch (e) {
            console.error("Failed to load messages", e);
        }
    }

    function startNewChat() {
        setActiveConvoId(null);
        setMessages([]);
        setShowSidebar(false);
        inputRef.current?.focus();
    }

    async function deleteConvo(id, e) {
        e.stopPropagation();
        try {
            await apiFetch(`/api/muse/conversations/${id}`, { method: "DELETE" });
            setConversations(prev => prev.filter(c => c.id !== id));
            if (activeConvoId === id) {
                setActiveConvoId(null);
                setMessages([]);
            }
        } catch (e) {
            console.error("Failed to delete", e);
        }
    }

    function handleImageSelect(file) {
        if (!file) return;
        setPendingImage(file);
        const reader = new FileReader();
        reader.onload = (e) => setPendingImagePreview(e.target.result);
        reader.readAsDataURL(file);
        if (imageInputRef.current) imageInputRef.current.value = '';
        if (cameraInputRef.current) cameraInputRef.current.value = '';
        setTimeout(() => inputRef.current?.focus(), 100);
    }

    function clearPendingImage() {
        setPendingImage(null);
        setPendingImagePreview(null);
    }

    async function sendMessage(e, opts = {}) {
        e?.preventDefault?.();
        const overrideMsg = typeof opts.message === "string" ? opts.message : null;
        const skillToUse = opts.skill || activeSkill;
        const msg = overrideMsg !== null ? overrideMsg.trim() : input.trim();
        const hasImage = overrideMsg !== null ? false : !!pendingImage;
        if ((!msg && !hasImage) || streaming) return;

        const displayMsg = msg || (hasImage ? "📷 [Image]" : "");
        if (overrideMsg === null) setInput("");
        const imagePreviewUrl = pendingImagePreview;
        const imageFile = pendingImage;
        clearPendingImage();
        setMessages(prev => [...prev, { role: "user", content: displayMsg, id: Date.now(), imagePreview: imagePreviewUrl }]);
        setStreaming(true);
        setStreamText("");

        try {
            const token = getStoredToken();
            let response;

            if (hasImage) {
                const formData = new FormData();
                formData.append("image", imageFile);
                formData.append("message", msg || "What's in this image?");
                formData.append("model", model);
                if (activeConvoId) formData.append("conversationId", activeConvoId);
                response = await fetch("/api/muse/chat-with-image", {
                    method: "POST",
                    credentials: "include",
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    body: formData,
                });
            } else {
                response = await fetch("/api/muse/chat", {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({ message: msg, model, conversationId: activeConvoId, skill: skillToUse }),
                });
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let fullText = "";
            let actionResult = null;
            let newConvoId = activeConvoId;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    try {
                        const event = JSON.parse(line.slice(6));
                        if (event.content) {
                            fullText += event.content;
                            setStreamText(fullText);
                        }
                        if (event.done) {
                            if (event.action) actionResult = event.action;
                            if (event.conversationId) newConvoId = event.conversationId;
                        }
                        if (event.error) {
                            console.error("Muse error:", event.error);
                        }
                    } catch (parseErr) {}
                }
            }

            setMessages(prev => [...prev, { role: "assistant", content: fullText, id: Date.now() + 1 }]);
            setStreamText("");

            if (newConvoId && newConvoId !== activeConvoId) {
                setActiveConvoId(newConvoId);
            }
            loadConversations();

            if (actionResult && onTasksChanged) {
                onTasksChanged();
            }
        } catch (err) {
            console.error("Muse chat error:", err);
            setMessages(prev => [...prev, { role: "assistant", content: "Sorry, something went wrong. Please try again.", id: Date.now() + 1 }]);
            setStreamText("");
        }
        setStreaming(false);
        inputRef.current?.focus();
    }

    function renderInline(text, keyPrefix = "") {
        const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
        return parts.map((part, i) => {
            if (part.startsWith("**") && part.endsWith("**")) {
                return <strong key={`${keyPrefix}b${i}`}>{part.slice(2, -2)}</strong>;
            }
            if (part.startsWith("`") && part.endsWith("`")) {
                return <code key={`${keyPrefix}c${i}`} className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-sm">{part.slice(1, -1)}</code>;
            }
            return <React.Fragment key={`${keyPrefix}t${i}`}>{part}</React.Fragment>;
        });
    }

    async function handleSaveWrapUpAsMemo(msgId, text) {
        const current = wrapupSaveState[msgId];
        if (current?.status === 'saving' || current?.status === 'saved') return;
        setWrapupSaveState(prev => ({ ...prev, [msgId]: { status: 'saving' } }));
        try {
            const { title, content, kind } = extractWrapUpMemo(text);
            // Spec wrap-ups get tagged so the user can find them later, plus
            // an auto wiki Ingest call so they land in the wiki immediately.
            const tags = kind === 'spec'
                ? ['spec', ...(slugifyTitle(title) ? [slugifyTitle(title)] : [])]
                : undefined;
            // We POST to /api/memos directly instead of round-tripping through
            // /api/muse/chat with "draft memo: ..." — both end up calling the
            // same db.insert(memos) and we avoid an extra LLM round-trip plus
            // a phantom "draft memo: ..." turn cluttering the conversation.
            // Date is computed in the browser's local timezone (matches the
            // user's clock) to avoid an off-by-one near UTC midnight.
            const memo = await createMemo({ title, content, date: todayLocalISO(), color: 'white', tags });
            setWrapupSaveState(prev => ({ ...prev, [msgId]: { status: 'saved', memoId: memo?.id } }));
            // Spec memos also fire the wiki Ingest op so entity pages get the
            // new context. We check the kill-switch first so we don't pile up
            // error rows in agent_runs when the operator has paused the agent.
            // Any other failure is best-effort and swallowed.
            if (kind === 'spec') {
                (async () => {
                    try {
                        const ops = await apiFetch('/api/muse/agent/ops');
                        if (ops?.killSwitch) return;
                        await apiFetch('/api/muse/agent/run', {
                            method: 'POST',
                            body: JSON.stringify({ op: 'ingest', input: `${title}\n\n${content}` }),
                        });
                    } catch { /* best-effort */ }
                })();
            }
        } catch (err) {
            console.error("Failed to save wrap-up as memo", err);
            setWrapupSaveState(prev => ({ ...prev, [msgId]: { status: 'error' } }));
        }
    }

    function handleSwitchSkill(skillKey, prevUserMessage) {
        setActiveSkill(skillKey);
        const text = (prevUserMessage || "").trim();
        if (text && !streaming) {
            sendMessage(null, { message: text, skill: skillKey });
        }
    }

    function findPrevUserMessage(messageId) {
        if (!messageId) {
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === "user" && messages[i].content) return messages[i].content;
            }
            return "";
        }
        const idx = messages.findIndex(m => m.id === messageId);
        for (let i = idx - 1; i >= 0; i--) {
            if (messages[i].role === "user" && messages[i].content) return messages[i].content;
        }
        return "";
    }

    function renderContent(text, messageId = null) {
        // The <!-- WRAPUP --> marker is an invisible UI signal; strip it from
        // the visible chat bubble (whitespace-pre-wrap would otherwise render
        // it as literal text). Also collapse the leading blank line it leaves.
        text = (text || '').replace(/^\s*<!--\s*WRAPUP\s*-->\s*\n?/i, '').replace(/<!--\s*WRAPUP\s*-->/gi, '');
        const matches = [];
        const re = new RegExp(SUGGESTION_REGEX.source, SUGGESTION_REGEX.flags);
        let m;
        while ((m = re.exec(text)) !== null) {
            const label = m[1].trim();
            const skillKey = SUGGESTION_LABEL_TO_KEY[label];
            if (!skillKey) continue;
            if (skillKey === activeSkill) continue;
            matches.push({ start: m.index, end: m.index + m[0].length, label, skillKey });
        }

        if (matches.length === 0) return renderInline(text);

        const out = [];
        let cursor = 0;
        matches.forEach((mt, i) => {
            if (mt.start > cursor) out.push(<React.Fragment key={`pre${i}`}>{renderInline(text.slice(cursor, mt.start), `pre${i}-`)}</React.Fragment>);
            const skillInfo = getSkillInfo(mt.skillKey, userSkills);
            out.push(
                <button
                    key={`sw${i}`}
                    type="button"
                    onClick={() => handleSwitchSkill(mt.skillKey, findPrevUserMessage(messageId))}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 my-0.5 rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-600 transition shadow-sm`}
                    title={`Switch to ${skillInfo.label} and re-ask`}
                >
                    <i className={`fa-solid ${skillInfo.icon} ${skillInfo.color}`}></i>
                    <span className="dark:text-white">Switch to {skillInfo.label}</span>
                </button>
            );
            cursor = mt.end;
        });
        if (cursor < text.length) out.push(<React.Fragment key="tail">{renderInline(text.slice(cursor), "tail-")}</React.Fragment>);
        return out;
    }

    function formatDate(dateStr) {
        const d = new Date(dateStr);
        const now = new Date();
        const diff = now - d;
        if (diff < 86400000) return "Today";
        if (diff < 172800000) return "Yesterday";
        return `${d.getMonth() + 1}/${d.getDate()}`;
    }

    async function handleDeleteSkill(skillId) {
        try {
            await deleteCustomSkill(skillId);
            setUserSkills(prev => prev.filter(s => s.id !== skillId));
            if (activeSkill.startsWith("custom_")) {
                const deleted = userSkills.find(s => s.id === skillId);
                if (deleted && deleted.key === activeSkill) {
                    setActiveSkill('default');
                }
            }
            setSkillContextMenu(null);
        } catch (e) {
            console.error("Failed to delete skill", e);
        }
    }

    const activeSkillInfo = getSkillInfo(activeSkill, userSkills);
    const isCustomSkill = activeSkill.startsWith("custom_");
    const activeCustomSkill = isCustomSkill ? userSkills.find(s => s.key === activeSkill) : null;

    function getPlaceholder() {
        if (pendingImage) return "Ask about this image...";
        if (isCustomSkill && activeCustomSkill) return `Message ${activeCustomSkill.label}...`;
        switch (activeSkill) {
            case 'analytics': return "Ask about your productivity...";
            case 'writer': return "What would you like to write?";
            case 'planner': return "What should we plan?";
            case 'adhd': return "What are you stuck on?";
            case 'journal': return "Ask about today's journal...";
            case 'brainstorm': return "What topic to brainstorm?";
            case 'xuefeng': return "你嘅分數、省份、想選咩科？";
            case 'musk': return "What problem to solve?";
            case 'munger': return "想分析咩？";
            case 'feynman': return "想學咩概念？";
            case 'naval': return "Ask about wealth & leverage...";
            case 'careerOps': return "Paste a job URL or JD, or ask about your pipeline...";
            case 'specBuilder': return "Describe the idea you want a spec for...";
            default: return "Message Muse...";
        }
    }

    function getGreeting() {
        if (isCustomSkill && activeCustomSkill) {
            return `${activeCustomSkill.label} — ${activeCustomSkill.description}`;
        }
        switch (activeSkill) {
            case 'analytics': return "Analytics Mode — Let's analyze your productivity.";
            case 'writer': return "Writer Mode — I'll help you write and edit.";
            case 'planner': return "Planner Mode — Let's optimize your schedule.";
            case 'adhd': return "ADHD Coach — I'm here to help you focus.";
            case 'journal': return "Journal Coach — I can read today's stream and reflect back what I see.";
            case 'xuefeng': return "🎓 張雪峰模式 — 用就業倒推法幫你選專業。";
            case 'musk': return "🚀 Elon Musk — 第一性原理思維。";
            case 'munger': return "📊 查理芒格 — 多元思維模型。";
            case 'feynman': return "🔬 費曼 — 用最簡單嘅方式解釋一切。";
            case 'naval': return "⚓ Naval — 財富、槓桿與人生哲學。";
            case 'careerOps': return "💼 Career Ops — Evaluate jobs, tailor your CV, track the pipeline.";
            case 'brainstorm': return "Brainstorm Mode — Let's generate ideas!";
            default: return "Hi! I'm Muse, your planning assistant.";
        }
    }

    function getSubGreeting() {
        if (isCustomSkill && activeCustomSkill) return `Chat with ${activeCustomSkill.label} in their unique style.`;
        switch (activeSkill) {
            case 'default': return <>Chat with me, or try: <span className="font-mono">draft task:</span> / <span className="font-mono">draft memo:</span></>;
            case 'analytics': return "Ask about your task patterns, workload, or productivity stats.";
            case 'writer': return "Paste text to edit, ask me to draft notes, or help organize your writing.";
            case 'planner': return "Ask me to plan your day, prioritize tasks, or create a weekly schedule.";
            case 'adhd': return "Tell me what you're stuck on — I'll break it into tiny steps.";
            case 'brainstorm': return "Share a topic or challenge and I'll help generate ideas.";
            case 'xuefeng': return "話我知你嘅情況：分數、省份、家庭背景，我用張雪峰嘅思維幫你分析。";
            case 'musk': return "話我知你想解決咩問題，我用第一性原理幫你拆解。";
            case 'munger': return "話我知你想分析咩，我用多元思維模型交叉驗證。";
            case 'feynman': return "話我知你想學咩概念，我用最簡單嘅方式解釋。";
            case 'naval': return "問我關於財富、槓桿、人生選擇。";
            case 'careerOps': return "Paste a job URL/JD for an honest A–F evaluation, then I can tailor your CV and track applications. Tag a memo #cv first.";
            default: return "";
        }
    }

    return (
        <div className="flex lg:h-[calc(100vh-60px)] max-lg:h-[calc(100vh-48px-56px)] max-lg:mt-12 bg-white dark:bg-black relative">
            {showSidebar && (
                <div className="absolute inset-0 z-20 flex">
                    <div className="w-64 bg-gray-50 dark:bg-gray-950 border-r border-gray-100 dark:border-gray-800 flex flex-col h-full">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800">
                            <span className="text-xs font-medium dark:text-white">Chats</span>
                            <div className="flex gap-2">
                                <button onClick={() => setShowImportModal(true)} title="Import ChatGPT / Claude history" className="text-xs text-gray-400 hover:text-black dark:hover:text-white transition">
                                    <i className="fa-solid fa-file-import"></i>
                                </button>
                                <button onClick={startNewChat} title="New chat" className="text-xs text-gray-400 hover:text-black dark:hover:text-white transition">
                                    <i className="fa-solid fa-plus"></i>
                                </button>
                                <button onClick={() => setShowSidebar(false)} className="text-xs text-gray-400 hover:text-black dark:hover:text-white transition">
                                    <i className="fa-solid fa-xmark"></i>
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {conversations.map(c => (
                                <div
                                    key={c.id}
                                    onClick={() => { setActiveConvoId(c.id); setShowSidebar(false); }}
                                    className={`flex items-center justify-between px-3 py-2 cursor-pointer text-xs hover:bg-gray-100 dark:hover:bg-gray-900 group ${
                                        activeConvoId === c.id ? "bg-gray-100 dark:bg-gray-900" : ""
                                    }`}
                                >
                                    <div className="flex-1 truncate dark:text-gray-300">
                                        <div className="truncate flex items-center gap-1.5">
                                            {c.source && (
                                                <span
                                                    title={`Imported from ${c.source === 'chatgpt' ? 'ChatGPT' : c.source === 'claude' ? 'Claude' : 'Markdown export'}`}
                                                    className={`shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                                                        c.source === 'chatgpt'
                                                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                                            : c.source === 'claude'
                                                                ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
                                                                : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
                                                    }`}
                                                >
                                                    {c.source === 'chatgpt' ? 'GPT' : c.source === 'claude' ? 'Claude' : 'MD'}
                                                </span>
                                            )}
                                            <span className="truncate">{c.title}</span>
                                        </div>
                                        <div className="text-gray-400 text-[10px]">{formatDate(c.updatedAt || c.createdAt)}</div>
                                    </div>
                                    <button
                                        onClick={(e) => deleteConvo(c.id, e)}
                                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 ml-2 transition"
                                    >
                                        <i className="fa-solid fa-trash text-[10px]"></i>
                                    </button>
                                </div>
                            ))}
                            {conversations.length === 0 && (
                                <div className="text-center text-gray-400 text-xs py-8">No chats yet</div>
                            )}
                        </div>
                    </div>
                    <div className="flex-1" onClick={() => setShowSidebar(false)}></div>
                </div>
            )}

            <div className="flex-1 flex flex-col">
                <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-2">
                        <button onClick={() => setShowSidebar(!showSidebar)} className="text-black dark:text-white text-sm">
                            <i className="fa-solid fa-bars"></i>
                        </button>
                        <button onClick={() => setShowMemoryPanel(true)} title="Long-term memory"
                            className="text-gray-400 hover:text-black dark:hover:text-white text-sm">
                            <i className="fa-solid fa-brain"></i>
                        </button>
                        <select
                            value={model}
                            onChange={(e) => { setModel(e.target.value); localStorage.setItem("muse_model", e.target.value); }}
                            className="text-xs bg-transparent dark:text-white outline-none cursor-pointer"
                        >
                            <optgroup label="OpenAI">
                                <option value="gpt-4o-mini">gpt-4o-mini</option>
                                <option value="gpt-4o">gpt-4o</option>
                                <option value="gpt-5-nano">gpt-5-nano</option>
                                <option value="gpt-5-mini">gpt-5-mini</option>
                                <option value="gpt-5">gpt-5</option>
                                <option value="gpt-5.1">gpt-5.1</option>
                                <option value="gpt-5.2">gpt-5.2</option>
                                <option value="o3-mini">o3-mini</option>
                                <option value="o4-mini">o4-mini</option>
                                <option value="o3">o3</option>
                            </optgroup>
                            <optgroup label="Anthropic">
                                <option value="claude-haiku-4-5">claude-haiku-4-5</option>
                                <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
                                <option value="claude-opus-4-6">claude-opus-4-6</option>
                            </optgroup>
                            <optgroup label="Google">
                                <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                                <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                            </optgroup>
                        </select>
                    </div>
                    <div className="flex items-center gap-1">
                        {activeSkill === 'specBuilder' && (
                            <button
                                onClick={() => setShowSpecBuilderSettings(true)}
                                title="Customize Spec Builder questions"
                                data-testid="spec-builder-customize"
                                className="text-[10px] px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white transition"
                            >
                                <i className="fa-solid fa-sliders text-[9px]" />
                                Questions
                            </button>
                        )}
                        {activeSkill !== 'default' && (
                            <button
                                onClick={() => setActiveSkill('default')}
                                className={`text-[10px] px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 flex items-center gap-1 ${activeSkillInfo.color} hover:opacity-70 transition`}
                            >
                                <i className={`fa-solid ${activeSkillInfo.icon} text-[8px]`} />
                                {activeSkillInfo.label}
                                <i className="fa-solid fa-xmark text-[8px] ml-0.5 text-gray-400" />
                            </button>
                        )}
                        <button onClick={startNewChat} className="text-xs text-gray-400 hover:text-black dark:hover:text-white transition">
                            <i className="fa-solid fa-pen-to-square"></i>
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                    {messages.length === 0 && !streaming && (
                        <div className="flex flex-col items-center justify-center h-full text-center px-2">
                            <i className={`fa-solid ${activeSkillInfo.icon} text-4xl ${activeSkillInfo.color} mb-4 opacity-40`}></i>
                            <p className="text-gray-400 dark:text-gray-500 text-sm mb-1">
                                {getGreeting()}
                            </p>
                            <p className="text-gray-300 dark:text-gray-600 text-xs max-w-xs mb-6">
                                {getSubGreeting()}
                            </p>
                            <div className="grid grid-cols-4 gap-1.5 max-w-md w-full">
                                {SKILLS.map(s => (
                                    <button
                                        key={s.key}
                                        data-skill-key={s.key}
                                        data-active={activeSkill === s.key ? 'true' : 'false'}
                                        onClick={() => { setActiveSkill(s.key); inputRef.current?.focus(); }}
                                        className={`flex flex-col items-center gap-1 px-2 py-3 rounded-xl border transition text-xs ${
                                            activeSkill === s.key
                                                ? 'border-gray-400 dark:border-gray-500 bg-gray-50 dark:bg-gray-900'
                                                : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
                                        }`}
                                    >
                                        <i className={`fa-solid ${s.icon} ${s.color} text-base`} />
                                        <span className="dark:text-gray-300 font-medium">{s.label}</span>
                                        <span className="text-[10px] text-gray-400 leading-tight">{s.desc}</span>
                                    </button>
                                ))}
                            </div>

                            {(userSkills.length > 0 || true) && (
                                <div className="mt-6 w-full max-w-md">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Custom Skills</span>
                                    </div>
                                    <div className="grid grid-cols-4 gap-1.5 w-full">
                                        {userSkills.map(s => (
                                            <CustomSkillCard
                                                key={s.id}
                                                skill={s}
                                                isActive={activeSkill === s.key}
                                                showMenu={skillContextMenu === s.id}
                                                onSelect={() => { setActiveSkill(s.key); inputRef.current?.focus(); }}
                                                onToggleMenu={() => setSkillContextMenu(skillContextMenu === s.id ? null : s.id)}
                                                onEdit={() => { setShowEditModal(s); setSkillContextMenu(null); }}
                                                onDelete={() => handleDeleteSkill(s.id)}
                                            />
                                        ))}
                                        <button
                                            onClick={() => setShowCreateModal(true)}
                                            className="flex flex-col items-center gap-1 px-2 py-3 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600 transition text-xs"
                                        >
                                            <i className="fa-solid fa-plus text-gray-400 text-base" />
                                            <span className="text-gray-400 font-medium">Create</span>
                                            <span className="text-[10px] text-gray-400 leading-tight">From chat log</span>
                                        </button>
                                        <button
                                            onClick={() => setShowSoulCraftCreate(true)}
                                            className="flex flex-col items-center gap-1 px-2 py-3 rounded-xl border border-dashed border-purple-300 dark:border-purple-800 hover:border-purple-500 dark:hover:border-purple-500 transition text-xs"
                                            title="透過對話設計人格 / Design through conversation"
                                        >
                                            <i className="fa-solid fa-comments text-purple-500 text-base" />
                                            <span className="text-gray-400 font-medium">Design</span>
                                            <span className="text-[10px] text-gray-400 leading-tight">透過對話</span>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {messages.map((msg) => {
                        const showSaveAsMemo = msg.role === "assistant" && isWrapUpMessage(msg.content);
                        const saveState = wrapupSaveState[msg.id];
                        return (
                            <div key={msg.id} id={`muse-msg-${msg.id}`} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                                <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap transition-all ${
                                    msg.role === "user"
                                        ? "bg-black text-white dark:bg-white dark:text-black rounded-br-md"
                                        : "bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200 rounded-bl-md"
                                } ${highlightedMessageId === msg.id ? "ring-2 ring-purple-400 ring-offset-2 ring-offset-white dark:ring-offset-black" : ""}`}>
                                    {msg.imagePreview && (
                                        <img src={msg.imagePreview} alt="Attached" className="w-full max-h-48 object-cover rounded-lg mb-2" />
                                    )}
                                    {msg.role === "assistant" ? renderContent(msg.content, msg.id) : renderInline(msg.content)}
                                </div>
                                {showSaveAsMemo && (
                                    <div className="mt-1.5 max-w-[80%]">
                                        <button
                                            type="button"
                                            data-testid={`save-wrapup-memo-${msg.id}`}
                                            onClick={() => handleSaveWrapUpAsMemo(msg.id, msg.content)}
                                            disabled={saveState?.status === 'saving' || saveState?.status === 'saved'}
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-600 transition shadow-sm disabled:opacity-70 disabled:cursor-not-allowed"
                                            title={saveState?.status === 'saved' ? 'Already saved as a memo' : 'Save this wrap-up as a memo'}
                                        >
                                            {saveState?.status === 'saving' ? (
                                                <>
                                                    <i className="fa-solid fa-spinner fa-spin text-gray-500"></i>
                                                    <span className="dark:text-white">Saving…</span>
                                                </>
                                            ) : saveState?.status === 'saved' ? (
                                                <>
                                                    <i className="fa-solid fa-check text-green-500"></i>
                                                    <span className="dark:text-white">Saved as memo</span>
                                                </>
                                            ) : saveState?.status === 'error' ? (
                                                <>
                                                    <i className="fa-solid fa-circle-exclamation text-red-500"></i>
                                                    <span className="dark:text-white">Try again</span>
                                                </>
                                            ) : (
                                                <>
                                                    <i className="fa-solid fa-bookmark text-purple-500"></i>
                                                    <span className="dark:text-white">Save as memo</span>
                                                </>
                                            )}
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {streaming && streamText && (
                        <div className="flex justify-start">
                            <div className="max-w-[80%] rounded-2xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                                {renderContent(streamText)}
                                <span className="inline-block w-1.5 h-4 bg-gray-400 ml-0.5 animate-pulse"></span>
                            </div>
                        </div>
                    )}

                    {streaming && !streamText && (
                        <div className="flex justify-start">
                            <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-gray-100 dark:bg-gray-900">
                                <div className="flex gap-1.5">
                                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></div>
                                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
                                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>

                <div className="px-4 pt-2 flex flex-wrap gap-1.5 items-center">
                    <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mr-1">Wiki:</span>
                    {[
                      { cmd: '/ingest ', label: 'Ingest', icon: 'fa-inbox' },
                      { cmd: '/query ', label: 'Query', icon: 'fa-magnifying-glass' },
                      { cmd: '/synth ', label: 'Synth', icon: 'fa-layer-group' },
                      { cmd: '/lint', label: 'Lint', icon: 'fa-broom' },
                      { cmd: '/reindex', label: 'Reindex', icon: 'fa-list-tree' },
                    ].map(b => (
                      <button
                        key={b.cmd}
                        type="button"
                        disabled={streaming}
                        onClick={() => {
                          if (b.cmd.endsWith(' ')) {
                            setInput(b.cmd);
                            inputRef.current?.focus();
                          } else {
                            sendMessage(null, { message: b.cmd });
                          }
                        }}
                        className="text-[11px] px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                        title={`Run ${b.label} via wiki agent`}
                      >
                        <i className={`fa-solid ${b.icon} mr-1 text-[10px]`}></i>{b.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setShowWikiPanel(true)}
                      className="ml-auto text-[11px] px-2 py-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                      title="View agent run history"
                    >
                      <i className="fa-solid fa-clock-rotate-left mr-1"></i>Runs
                    </button>
                </div>

                <form onSubmit={sendMessage} className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                    {pendingImagePreview && (
                        <div className="flex items-center gap-2 mb-2">
                            <img src={pendingImagePreview} alt="Pending" className="h-16 w-16 object-cover rounded-lg" />
                            <button type="button" onClick={clearPendingImage} className="text-xs text-gray-400 hover:text-red-400 transition">
                                <i className="fa-solid fa-xmark" />
                            </button>
                        </div>
                    )}
                    <div className="flex items-center gap-2">
                        <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handleImageSelect(e.target.files[0])} />
                        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => e.target.files?.[0] && handleImageSelect(e.target.files[0])} />
                        <button type="button" onClick={() => cameraInputRef.current?.click()} disabled={streaming} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition disabled:opacity-50">
                            <i className="fa-solid fa-camera text-sm" />
                        </button>
                        <button type="button" onClick={() => imageInputRef.current?.click()} disabled={streaming} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition disabled:opacity-50">
                            <i className="fa-solid fa-image text-sm" />
                        </button>
                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder={getPlaceholder()}
                            disabled={streaming}
                            className="flex-1 bg-transparent text-sm outline-none dark:text-white placeholder-gray-400"
                        />
                        {(input.trim() || pendingImage) && (
                            <button type="submit" disabled={streaming} className="text-gray-400 hover:text-black dark:hover:text-white transition disabled:opacity-50">
                                <i className="fa-solid fa-paper-plane text-sm" />
                            </button>
                        )}
                    </div>
                </form>
            </div>

            {showMemoryPanel && <MemoryPanel onClose={() => setShowMemoryPanel(false)} onJumpToConversation={(cid, mid) => { if (mid) setPendingScrollMessageId(mid); setActiveConvoId(cid); setShowMemoryPanel(false); setShowSidebar(false); }} />}
            {showImportModal && <ImportConversationsModal onClose={() => setShowImportModal(false)} onImported={() => { setShowImportModal(false); loadConversations(); }} />}
            {showWikiPanel && <WikiRunsPanel onClose={() => setShowWikiPanel(false)} onOpen={(id) => setViewingRunId(id)} />}
            {viewingRunId && <WikiRunDetail id={viewingRunId} onClose={() => setViewingRunId(null)} />}
            {showSpecBuilderSettings && <SpecBuilderQuestionsModal onClose={() => setShowSpecBuilderSettings(false)} />}
            {showCreateModal && <CreateSkillModal onClose={() => setShowCreateModal(false)} onCreated={(skill) => { setUserSkills(prev => [skill, ...prev]); setShowCreateModal(false); setActiveSkill(skill.key); }} />}
            {showEditModal && <EditSkillModal skill={showEditModal} onClose={() => setShowEditModal(null)} onUpdated={(updated) => { setUserSkills(prev => prev.map(s => s.id === updated.id ? updated : s)); setShowEditModal(null); }} onDeleted={(id) => { handleDeleteSkill(id); setShowEditModal(null); }} onRefineViaChat={(s) => { setShowEditModal(null); setShowSoulCraftRefine(s); }} />}
            {showSoulCraftCreate && (
                <SoulCraftModal
                    onClose={() => setShowSoulCraftCreate(false)}
                    onSaved={(skill) => {
                        setUserSkills(prev => [skill, ...prev.filter(s => s.id !== skill.id)]);
                        setShowSoulCraftCreate(false);
                        setActiveSkill(skill.key);
                    }}
                />
            )}
            {showSoulCraftRefine && (
                <SoulCraftModal
                    skill={showSoulCraftRefine}
                    onClose={() => setShowSoulCraftRefine(null)}
                    onSaved={(updated) => {
                        setUserSkills(prev => prev.map(s => s.id === updated.id ? updated : s));
                        setShowSoulCraftRefine(null);
                    }}
                />
            )}

            {skillContextMenu !== null && (
                <div className="fixed inset-0 z-20" onClick={() => setSkillContextMenu(null)} />
            )}
        </div>
    );
}

function formatMemoryTimestamp(raw) {
    if (!raw) return "";
    const iso = String(raw).endsWith("Z") ? raw : raw.replace(" ", "T") + "Z";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const diffMs = Date.now() - d.getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    return d.toLocaleDateString();
}

function MemoryPanel({ onClose, onJumpToConversation }) {
    const [memories, setMemories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    const [newContent, setNewContent] = useState("");
    const [adding, setAdding] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editText, setEditText] = useState("");
    const [error, setError] = useState("");
    const [filterKind, setFilterKind] = useState("all"); // 'all' | 'auto' | 'manual'

    async function load(q = "", kind = filterKind) {
        setLoading(true);
        setError("");
        try {
            const rows = await listMuseMemories({ q, kind: kind === "all" ? null : kind });
            setMemories(rows || []);
        } catch (e) {
            setError(e.message || "Failed to load memories");
        }
        setLoading(false);
    }

    useEffect(() => { load(query.trim(), filterKind); }, [filterKind]);

    async function handleSearch(e) {
        e.preventDefault();
        await load(query.trim(), filterKind);
    }

    async function handleForgetConversation(cid) {
        if (!cid) return;
        if (!confirm(`Forget all memories from chat #${cid}?`)) return;
        try {
            await clearMuseMemoriesByConversation(cid);
            setMemories(prev => prev.filter(m => m.source_conversation_id !== cid));
        } catch (e) {
            setError(e.message || "Failed to forget conversation");
        }
    }

    async function handleAdd(e) {
        e.preventDefault();
        const content = newContent.trim();
        if (!content) return;
        setAdding(true);
        setError("");
        try {
            const row = await createMuseMemory(content, "manual");
            setMemories(prev => [row, ...prev]);
            setNewContent("");
        } catch (e) {
            setError(e.message || "Failed to save");
        }
        setAdding(false);
    }

    async function handleSaveEdit(id) {
        const text = editText.trim();
        if (!text) return;
        try {
            const row = await updateMuseMemory(id, text);
            setMemories(prev => prev.map(m => m.id === id ? { ...m, content: row.content } : m));
            setEditingId(null);
            setEditText("");
        } catch (e) {
            setError(e.message || "Failed to update");
        }
    }

    async function handleDelete(id) {
        if (!confirm("Delete this memory?")) return;
        try {
            await deleteMuseMemory(id);
            setMemories(prev => prev.filter(m => m.id !== id));
        } catch (e) {
            setError(e.message || "Failed to delete");
        }
    }

    async function handleClearAll() {
        if (!confirm("Delete ALL Muse memories? This cannot be undone.")) return;
        try {
            await clearAllMuseMemories();
            setMemories([]);
        } catch (e) {
            setError(e.message || "Failed to clear");
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-2">
                        <i className="fa-solid fa-brain text-purple-500" />
                        <h3 className="text-sm font-semibold dark:text-white">Muse Memory</h3>
                        <span className="text-[10px] text-gray-400">{memories.length}</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={handleClearAll} className="text-[10px] text-gray-400 hover:text-red-500 transition" title="Delete all memories">
                            <i className="fa-solid fa-trash" /> Clear all
                        </button>
                        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                            <i className="fa-solid fa-xmark" />
                        </button>
                    </div>
                </div>

                <div className="px-5 pt-3 flex items-center gap-1">
                    {[
                        { k: "all", label: "All" },
                        { k: "auto", label: "Auto-extracted" },
                        { k: "manual", label: "Manual" },
                    ].map(t => (
                        <button
                            key={t.k}
                            onClick={() => setFilterKind(t.k)}
                            className={`text-[10px] px-2.5 py-1 rounded-full border transition ${
                                filterKind === t.k
                                    ? "bg-purple-500 text-white border-purple-500"
                                    : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300"
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                <form onSubmit={handleSearch} className="px-5 pt-3">
                    <div className="flex gap-2 items-center">
                        <i className="fa-solid fa-magnifying-glass text-xs text-gray-400" />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Semantic search…"
                            className="flex-1 text-sm bg-transparent border-b border-gray-200 dark:border-gray-700 px-1 py-1 outline-none dark:text-white"
                        />
                        {query && (
                            <button type="button" onClick={() => { setQuery(""); load(""); }} className="text-xs text-gray-400 hover:text-gray-600">
                                <i className="fa-solid fa-xmark" />
                            </button>
                        )}
                    </div>
                </form>

                <form onSubmit={handleAdd} className="px-5 pt-2">
                    <div className="flex gap-2 items-center">
                        <i className="fa-solid fa-plus text-xs text-gray-400" />
                        <input
                            value={newContent}
                            onChange={e => setNewContent(e.target.value)}
                            placeholder='Teach Muse a fact (e.g. "User has hypertension")'
                            className="flex-1 text-sm bg-transparent border-b border-gray-200 dark:border-gray-700 px-1 py-1 outline-none dark:text-white"
                        />
                        <button type="submit" disabled={adding || !newContent.trim()}
                            className="text-xs px-3 py-1 rounded-full bg-purple-500 text-white hover:bg-purple-600 transition disabled:opacity-50">
                            {adding ? "…" : "Add"}
                        </button>
                    </div>
                </form>

                {error && <div className="px-5 mt-2 text-xs text-red-500">{error}</div>}

                <div className="flex-1 overflow-y-auto px-5 py-3">
                    {loading && <div className="text-xs text-gray-400 text-center py-8">Loading…</div>}
                    {!loading && memories.length === 0 && (
                        <div className="text-xs text-gray-400 text-center py-8">
                            No memories yet. They'll be saved automatically as you chat.
                        </div>
                    )}
                    {filterKind === "auto" && memories.length > 0 ? (
                        (() => {
                            const groups = new Map();
                            const orphans = [];
                            for (const m of memories) {
                                const cid = m.source_conversation_id;
                                if (!cid) { orphans.push(m); continue; }
                                if (!groups.has(cid)) groups.set(cid, []);
                                groups.get(cid).push(m);
                            }
                            return (
                                <div className="space-y-4">
                                    {[...groups.entries()].map(([cid, rows]) => (
                                        <div key={cid}>
                                            <div className="flex items-center justify-between mb-1.5 px-1">
                                                <button
                                                    type="button"
                                                    onClick={() => onJumpToConversation && onJumpToConversation(cid, null)}
                                                    className="text-[10px] uppercase tracking-wider text-purple-500 hover:text-purple-600 hover:underline"
                                                    title={`Open conversation #${cid}`}
                                                >
                                                    <i className="fa-regular fa-comment mr-1" />
                                                    chat #{cid} · {rows.length} {rows.length === 1 ? "memory" : "memories"}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleForgetConversation(cid)}
                                                    className="text-[10px] text-gray-400 hover:text-red-500"
                                                    title={`Forget all memories from chat #${cid}`}
                                                >
                                                    <i className="fa-solid fa-eraser mr-0.5" />
                                                    Forget all from this chat
                                                </button>
                                            </div>
                                            <ul className="space-y-2">
                                                {rows.map(m => renderMemoryRow(m, {
                                                    editingId, setEditingId, editText, setEditText,
                                                    handleSaveEdit, handleDelete, onJumpToConversation,
                                                }))}
                                            </ul>
                                        </div>
                                    ))}
                                    {orphans.length > 0 && (
                                        <div>
                                            <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5 px-1">
                                                No source chat
                                            </div>
                                            <ul className="space-y-2">
                                                {orphans.map(m => renderMemoryRow(m, {
                                                    editingId, setEditingId, editText, setEditText,
                                                    handleSaveEdit, handleDelete, onJumpToConversation,
                                                }))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            );
                        })()
                    ) : (
                    <ul className="space-y-2">
                        {memories.map(m => (
                            <li key={m.id} className="border border-gray-100 dark:border-gray-800 rounded-lg p-2.5 group">
                                <div className="flex items-start gap-2">
                                    <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                        m.kind === "manual" ? "bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300"
                                        : m.kind === "correction" ? "bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-300"
                                        : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                                    }`}>
                                        {m.kind || "auto"}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        {editingId === m.id ? (
                                            <div className="flex gap-1">
                                                <input
                                                    value={editText}
                                                    onChange={e => setEditText(e.target.value)}
                                                    autoFocus
                                                    className="flex-1 text-sm bg-transparent border-b border-gray-300 dark:border-gray-600 outline-none dark:text-white"
                                                    onKeyDown={e => { if (e.key === "Enter") handleSaveEdit(m.id); if (e.key === "Escape") { setEditingId(null); setEditText(""); } }}
                                                />
                                                <button onClick={() => handleSaveEdit(m.id)} className="text-xs text-green-600 hover:text-green-700">
                                                    <i className="fa-solid fa-check" />
                                                </button>
                                                <button onClick={() => { setEditingId(null); setEditText(""); }} className="text-xs text-gray-400">
                                                    <i className="fa-solid fa-xmark" />
                                                </button>
                                            </div>
                                        ) : (
                                            <p className="text-sm dark:text-gray-200 break-words">{m.content}</p>
                                        )}
                                        <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-1 text-[9px] text-gray-400">
                                            {m.created_at && (
                                                <span title={new Date(m.created_at + (String(m.created_at).endsWith("Z") ? "" : "Z")).toLocaleString()}>
                                                    <i className="fa-regular fa-clock mr-0.5" />
                                                    {formatMemoryTimestamp(m.created_at)}
                                                </span>
                                            )}
                                            {m.source_conversation_id && (
                                                <button
                                                    type="button"
                                                    onClick={() => onJumpToConversation && onJumpToConversation(m.source_conversation_id, m.source_message_id || null)}
                                                    title={m.source_message_id ? `Jump to source message in chat #${m.source_conversation_id}` : `Open conversation #${m.source_conversation_id}`}
                                                    className="text-purple-500 hover:text-purple-600 hover:underline"
                                                >
                                                    <i className="fa-regular fa-comment mr-0.5" />
                                                    {m.source_message_id ? "view source message" : `chat #${m.source_conversation_id}`}
                                                </button>
                                            )}
                                            {m.similarity !== undefined && (
                                                <span>match {(Number(m.similarity) * 100).toFixed(0)}%</span>
                                            )}
                                        </div>
                                    </div>
                                    {editingId !== m.id && (
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                                            <button onClick={() => { setEditingId(m.id); setEditText(m.content); }} className="text-[10px] text-gray-400 hover:text-gray-600">
                                                <i className="fa-solid fa-pen" />
                                            </button>
                                            <button onClick={() => handleDelete(m.id)} className="text-[10px] text-gray-400 hover:text-red-500">
                                                <i className="fa-solid fa-trash" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                    )}
                </div>
            </div>
        </div>
    );
}

function renderMemoryRow(m, ctx) {
    const { editingId, setEditingId, editText, setEditText, handleSaveEdit, handleDelete, onJumpToConversation } = ctx;
    return (
        <li key={m.id} className="border border-gray-100 dark:border-gray-800 rounded-lg p-2.5 group">
            <div className="flex items-start gap-2">
                <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    m.kind === "manual" ? "bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300"
                    : m.kind === "correction" ? "bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-300"
                    : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                }`}>
                    {m.kind || "auto"}
                </span>
                <div className="flex-1 min-w-0">
                    {editingId === m.id ? (
                        <div className="flex gap-1">
                            <input
                                value={editText}
                                onChange={e => setEditText(e.target.value)}
                                autoFocus
                                className="flex-1 text-sm bg-transparent border-b border-gray-300 dark:border-gray-600 outline-none dark:text-white"
                                onKeyDown={e => { if (e.key === "Enter") handleSaveEdit(m.id); if (e.key === "Escape") { setEditingId(null); setEditText(""); } }}
                            />
                            <button onClick={() => handleSaveEdit(m.id)} className="text-xs text-green-600 hover:text-green-700">
                                <i className="fa-solid fa-check" />
                            </button>
                            <button onClick={() => { setEditingId(null); setEditText(""); }} className="text-xs text-gray-400">
                                <i className="fa-solid fa-xmark" />
                            </button>
                        </div>
                    ) : (
                        <p className="text-sm dark:text-gray-200 break-words">{m.content}</p>
                    )}
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-1 text-[9px] text-gray-400">
                        {m.created_at && (
                            <span title={new Date(m.created_at + (String(m.created_at).endsWith("Z") ? "" : "Z")).toLocaleString()}>
                                <i className="fa-regular fa-clock mr-0.5" />
                                {formatMemoryTimestamp(m.created_at)}
                            </span>
                        )}
                        {m.source_message_id && (
                            <button
                                type="button"
                                onClick={() => onJumpToConversation && onJumpToConversation(m.source_conversation_id, m.source_message_id)}
                                title={`Jump to source message in chat #${m.source_conversation_id}`}
                                className="text-purple-500 hover:text-purple-600 hover:underline"
                            >
                                <i className="fa-regular fa-comment mr-0.5" />
                                view source message
                            </button>
                        )}
                    </div>
                </div>
                {editingId !== m.id && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                        <button onClick={() => { setEditingId(m.id); setEditText(m.content); }} className="text-[10px] text-gray-400 hover:text-gray-600">
                            <i className="fa-solid fa-pen" />
                        </button>
                        <button onClick={() => handleDelete(m.id)} className="text-[10px] text-gray-400 hover:text-red-500">
                            <i className="fa-solid fa-trash" />
                        </button>
                    </div>
                )}
            </div>
        </li>
    );
}

function CustomSkillCard({ skill, isActive, showMenu, onSelect, onToggleMenu, onEdit, onDelete }) {
    const longPressTimer = useRef(null);

    function handleTouchStart() {
        longPressTimer.current = setTimeout(() => {
            onToggleMenu();
            longPressTimer.current = null;
        }, 500);
    }

    function handleTouchEnd() {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    }

    return (
        <div className="relative group">
            <button
                onClick={onSelect}
                onContextMenu={(e) => { e.preventDefault(); onToggleMenu(); }}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchEnd}
                className={`w-full flex flex-col items-center gap-1 px-2 py-3 rounded-xl border transition text-xs ${
                    isActive
                        ? 'border-gray-400 dark:border-gray-500 bg-gray-50 dark:bg-gray-900'
                        : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
                }`}
            >
                <i className={`fa-solid ${skill.icon} ${skill.color} text-base`} />
                <span className="dark:text-gray-300 font-medium truncate w-full">{skill.label}</span>
                <span className="text-[10px] text-gray-400 leading-tight truncate w-full">{skill.description}</span>
            </button>
            <button
                onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
                className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition bg-white/80 dark:bg-gray-800/80"
            >
                <i className="fa-solid fa-ellipsis text-[8px]" />
            </button>
            {showMenu && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-30 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[100px]">
                    <button
                        onClick={onEdit}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-300"
                    >
                        <i className="fa-solid fa-pen text-[10px] mr-1.5" /> Edit
                    </button>
                    <button
                        onClick={onDelete}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 text-red-500"
                    >
                        <i className="fa-solid fa-trash text-[10px] mr-1.5" /> Delete
                    </button>
                </div>
            )}
        </div>
    );
}

function CreateSkillModal({ onClose, onCreated }) {
    const [name, setName] = useState("");
    const [chatLog, setChatLog] = useState("");
    const [icon, setIcon] = useState("fa-user");
    const [color, setColor] = useState("text-purple-500");
    const [relationshipInfo, setRelationshipInfo] = useState("");
    const [personalityTags, setPersonalityTags] = useState("");
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [preview, setPreview] = useState(null);
    const [showIconPicker, setShowIconPicker] = useState(false);
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [previewTab, setPreviewTab] = useState("prompt");

    async function handleGenerate() {
        if (!name.trim() || !chatLog.trim()) {
            setError("Please enter a name and paste a chat log.");
            return;
        }
        setLoading(true);
        setError("");
        try {
            const result = await generateCustomSkill(name.trim(), chatLog.trim(), icon, color, relationshipInfo.trim(), personalityTags.trim());
            setPreview(result);
        } catch (e) {
            setError(e.message || "Failed to generate skill.");
        }
        setLoading(false);
    }

    async function handleConfirm() {
        if (!preview) return;
        setLoading(true);
        try {
            const skill = await saveCustomSkill({
                label: preview.label,
                icon: preview.icon,
                color: preview.color,
                description: preview.description,
                systemPrompt: preview.systemPrompt,
                sampleChatLog: preview.sampleChatLog,
                memories: preview.memories,
                persona: preview.persona,
                relationshipInfo: preview.relationshipInfo,
                personalityTags: preview.personalityTags,
            });
            onCreated(skill);
        } catch (e) {
            setError(e.message || "Failed to save skill.");
        }
        setLoading(false);
    }

    function handleRegenerate() {
        setPreview(null);
        handleGenerate();
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                    <h3 className="text-sm font-semibold dark:text-white">Create Custom Skill</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                        <i className="fa-solid fa-xmark" />
                    </button>
                </div>

                {!preview ? (
                    <div className="p-5 space-y-4">
                        <div>
                            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Character Name</label>
                            <input
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder='e.g. "Nuwa", "前同事"'
                                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent dark:text-white outline-none focus:border-gray-400 dark:focus:border-gray-500"
                            />
                        </div>

                        <div className="flex gap-4">
                            <div className="relative">
                                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Icon</label>
                                <button
                                    type="button"
                                    onClick={() => { setShowIconPicker(!showIconPicker); setShowColorPicker(false); }}
                                    className="w-12 h-12 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center hover:border-gray-400 transition"
                                >
                                    <i className={`fa-solid ${icon} ${color} text-lg`} />
                                </button>
                                {showIconPicker && (
                                    <div className="absolute top-full left-0 mt-1 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 grid grid-cols-5 gap-1 w-48">
                                        {ICON_OPTIONS.map(ic => (
                                            <button key={ic} onClick={() => { setIcon(ic); setShowIconPicker(false); }} className={`w-8 h-8 rounded flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 ${icon === ic ? 'bg-gray-100 dark:bg-gray-700' : ''}`}>
                                                <i className={`fa-solid ${ic} ${color} text-sm`} />
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="relative">
                                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Color</label>
                                <button
                                    type="button"
                                    onClick={() => { setShowColorPicker(!showColorPicker); setShowIconPicker(false); }}
                                    className="w-12 h-12 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center hover:border-gray-400 transition"
                                >
                                    <div className={`w-6 h-6 rounded-full ${color.replace('text-', 'bg-')}`} />
                                </button>
                                {showColorPicker && (
                                    <div className="absolute top-full left-0 mt-1 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 grid grid-cols-4 gap-1 w-40">
                                        {COLOR_OPTIONS.map(c => (
                                            <button key={c} onClick={() => { setColor(c); setShowColorPicker(false); }} className={`w-8 h-8 rounded flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 ${color === c ? 'ring-2 ring-gray-400' : ''}`}>
                                                <div className={`w-5 h-5 rounded-full ${c.replace('text-', 'bg-')}`} />
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <label className="text-xs text-gray-500 dark:text-gray-400">Paste Chat Log</label>
                                <label className="text-[10px] text-gray-400 hover:text-black dark:hover:text-white transition cursor-pointer">
                                    <i className="fa-solid fa-file-import text-[9px] mr-1" />Import TXT
                                    <input type="file" accept=".txt,.csv,.tsv,.log,text/*" className="hidden" onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                            const text = await file.text();
                                            setChatLog(prev => prev ? prev + '\n' + text : text);
                                        }
                                        e.target.value = '';
                                    }} />
                                </label>
                                {chatLog.length > 10000 && (
                                    <span className="text-[9px] text-amber-500">{(chatLog.length / 1024).toFixed(0)}KB</span>
                                )}
                            </div>
                            <textarea
                                value={chatLog}
                                onChange={e => setChatLog(e.target.value)}
                                placeholder="Paste WhatsApp / LINE / any chat export here, or import a .txt file..."
                                rows={8}
                                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent dark:text-white outline-none focus:border-gray-400 dark:focus:border-gray-500 resize-none font-mono"
                            />
                            <p className="text-[10px] text-gray-400 mt-1">The AI will analyze this conversation to capture {name || "the person"}'s speaking style.</p>
                        </div>

                        <button
                            type="button"
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
                        >
                            <i className={`fa-solid fa-chevron-${showAdvanced ? 'down' : 'right'} text-[9px]`} />
                            ex-skill Context (optional)
                        </button>

                        {showAdvanced && (
                            <div className="space-y-3 pl-2 border-l-2 border-gray-100 dark:border-gray-800">
                                <div>
                                    <label className="text-[11px] text-gray-500 dark:text-gray-400 mb-1 block">Relationship Info</label>
                                    <input
                                        value={relationshipInfo}
                                        onChange={e => setRelationshipInfo(e.target.value)}
                                        placeholder='e.g. "在一起三年 大學同學 分手一年"'
                                        className="w-full px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent dark:text-white outline-none focus:border-gray-400"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] text-gray-500 dark:text-gray-400 mb-1 block">Personality Tags</label>
                                    <input
                                        value={personalityTags}
                                        onChange={e => setPersonalityTags(e.target.value)}
                                        placeholder='e.g. "ENFP 焦慮型 愛撒嬌 翻舊帳"'
                                        className="w-full px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent dark:text-white outline-none focus:border-gray-400"
                                    />
                                    <p className="text-[9px] text-gray-400 mt-1">MBTI · 星座 · 依戀類型 · 戀愛標籤 · 性格印象</p>
                                </div>
                            </div>
                        )}

                        {error && <p className="text-xs text-red-500">{error}</p>}

                        <button
                            onClick={handleGenerate}
                            disabled={loading || !name.trim() || !chatLog.trim()}
                            className="w-full py-2.5 rounded-lg bg-black dark:bg-white text-white dark:text-black text-sm font-medium disabled:opacity-50 hover:opacity-90 transition flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <i className="fa-solid fa-spinner animate-spin" />
                                    Distilling persona...
                                </>
                            ) : (
                                <>
                                    <i className="fa-solid fa-wand-magic-sparkles" />
                                    Generate Skill
                                </>
                            )}
                        </button>
                    </div>
                ) : (
                    <div className="p-5 space-y-4">
                        <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                            <div className="w-12 h-12 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 flex items-center justify-center">
                                <i className={`fa-solid ${preview.icon} ${preview.color} text-xl`} />
                            </div>
                            <div>
                                <div className="text-sm font-medium dark:text-white">{preview.label}</div>
                                <div className="text-xs text-gray-500">{preview.description}</div>
                            </div>
                        </div>

                        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                            {[
                                { key: "prompt", label: "System Prompt" },
                                { key: "memories", label: "Memories" },
                                { key: "persona", label: "Persona" },
                            ].map(t => (
                                <button
                                    key={t.key}
                                    onClick={() => setPreviewTab(t.key)}
                                    className={`flex-1 text-[10px] py-1.5 rounded-md transition ${previewTab === t.key ? 'bg-white dark:bg-gray-900 text-black dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>

                        <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
                            {previewTab === "prompt" && (preview.systemPrompt || "(empty)")}
                            {previewTab === "memories" && (preview.memories || "(no memories extracted)")}
                            {previewTab === "persona" && (preview.persona || "(no persona extracted)")}
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={handleRegenerate}
                                className="flex-1 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:border-gray-400 transition"
                            >
                                <i className="fa-solid fa-arrows-rotate mr-1.5" />
                                Regenerate
                            </button>
                            <button
                                onClick={handleConfirm}
                                className="flex-1 py-2.5 rounded-lg bg-black dark:bg-white text-white dark:text-black text-sm font-medium hover:opacity-90 transition"
                            >
                                <i className="fa-solid fa-check mr-1.5" />
                                Confirm
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function EditSkillModal({ skill, onClose, onUpdated, onDeleted, onRefineViaChat }) {
    const [label, setLabel] = useState(skill.label);
    const [icon, setIcon] = useState(skill.icon);
    const [color, setColor] = useState(skill.color);
    const [systemPrompt, setSystemPrompt] = useState(skill.systemPrompt);
    const [saving, setSaving] = useState(false);
    const [showIconPicker, setShowIconPicker] = useState(false);
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [editTab, setEditTab] = useState("prompt");
    const [evolveLog, setEvolveLog] = useState("");
    const [evolving, setEvolving] = useState(false);
    const [evolveResult, setEvolveResult] = useState("");

    async function handleSave() {
        setSaving(true);
        try {
            const updated = await updateCustomSkill(skill.id, { label, icon, color, systemPrompt });
            onUpdated(updated);
        } catch (e) {
            console.error("Failed to update skill", e);
        }
        setSaving(false);
    }

    async function handleEvolve() {
        if (!evolveLog.trim()) return;
        setEvolving(true);
        setEvolveResult("");
        try {
            const result = await evolveCustomSkill(skill.id, evolveLog.trim());
            setEvolveResult(result.summary || "Skill updated successfully");
            setEvolveLog("");
            onUpdated(result.skill);
        } catch (e) {
            setEvolveResult("Error: " + (e.message || "Failed to evolve"));
        }
        setEvolving(false);
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                    <div>
                        <h3 className="text-sm font-semibold dark:text-white">Edit Skill</h3>
                        {skill.version > 1 && <span className="text-[9px] text-gray-400">v{skill.version}</span>}
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                        <i className="fa-solid fa-xmark" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    <div>
                        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Name</label>
                        <input
                            value={label}
                            onChange={e => setLabel(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent dark:text-white outline-none focus:border-gray-400"
                        />
                    </div>

                    <div className="flex gap-4">
                        <div className="relative">
                            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Icon</label>
                            <button
                                type="button"
                                onClick={() => { setShowIconPicker(!showIconPicker); setShowColorPicker(false); }}
                                className="w-12 h-12 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center hover:border-gray-400 transition"
                            >
                                <i className={`fa-solid ${icon} ${color} text-lg`} />
                            </button>
                            {showIconPicker && (
                                <div className="absolute top-full left-0 mt-1 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 grid grid-cols-5 gap-1 w-48">
                                    {ICON_OPTIONS.map(ic => (
                                        <button key={ic} onClick={() => { setIcon(ic); setShowIconPicker(false); }} className={`w-8 h-8 rounded flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 ${icon === ic ? 'bg-gray-100 dark:bg-gray-700' : ''}`}>
                                            <i className={`fa-solid ${ic} ${color} text-sm`} />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="relative">
                            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Color</label>
                            <button
                                type="button"
                                onClick={() => { setShowColorPicker(!showColorPicker); setShowIconPicker(false); }}
                                className="w-12 h-12 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center hover:border-gray-400 transition"
                            >
                                <div className={`w-6 h-6 rounded-full ${color.replace('text-', 'bg-')}`} />
                            </button>
                            {showColorPicker && (
                                <div className="absolute top-full left-0 mt-1 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 grid grid-cols-4 gap-1 w-40">
                                    {COLOR_OPTIONS.map(c => (
                                        <button key={c} onClick={() => { setColor(c); setShowColorPicker(false); }} className={`w-8 h-8 rounded flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 ${color === c ? 'ring-2 ring-gray-400' : ''}`}>
                                            <div className={`w-5 h-5 rounded-full ${c.replace('text-', 'bg-')}`} />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                        {[
                            { key: "prompt", label: "System Prompt" },
                            { key: "memories", label: "Memories" },
                            { key: "persona", label: "Persona" },
                            { key: "evolve", label: "Evolve" },
                        ].map(t => (
                            <button
                                key={t.key}
                                onClick={() => setEditTab(t.key)}
                                className={`flex-1 text-[10px] py-1.5 rounded-md transition ${editTab === t.key ? 'bg-white dark:bg-gray-900 text-black dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>

                    {editTab === "prompt" && (
                        <div>
                            <textarea
                                value={systemPrompt}
                                onChange={e => setSystemPrompt(e.target.value)}
                                rows={10}
                                className="w-full px-3 py-2 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent dark:text-white outline-none focus:border-gray-400 resize-none font-mono"
                            />
                        </div>
                    )}

                    {editTab === "memories" && (
                        <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 max-h-52 overflow-y-auto whitespace-pre-wrap font-mono">
                            {skill.memories || "(no memories — re-generate to create structured memories)"}
                        </div>
                    )}

                    {editTab === "persona" && (
                        <div className="space-y-2">
                            <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 max-h-44 overflow-y-auto whitespace-pre-wrap font-mono">
                                {skill.persona || "(no persona — re-generate to create 5-layer persona)"}
                            </div>
                            {skill.corrections && (
                                <div>
                                    <label className="text-[10px] text-amber-500 mb-1 block">Correction Records</label>
                                    <div className="text-[10px] text-gray-500 dark:text-gray-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2 max-h-24 overflow-y-auto whitespace-pre-wrap font-mono">
                                        {skill.corrections}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {editTab === "evolve" && (
                        <div className="space-y-3">
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">Append new chat logs to evolve this skill. The AI will merge incremental findings without overwriting existing analysis.</p>
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-xs text-gray-500 dark:text-gray-400">New Chat Log</label>
                                    <label className="text-[10px] text-gray-400 hover:text-black dark:hover:text-white transition cursor-pointer">
                                        <i className="fa-solid fa-file-import text-[9px] mr-1" />Import TXT
                                        <input type="file" accept=".txt,.csv,.tsv,.log,text/*" className="hidden" onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                                const text = await file.text();
                                                setEvolveLog(prev => prev ? prev + '\n' + text : text);
                                            }
                                            e.target.value = '';
                                        }} />
                                    </label>
                                </div>
                                <textarea
                                    value={evolveLog}
                                    onChange={e => setEvolveLog(e.target.value)}
                                    placeholder="Paste new chat data to merge into this skill..."
                                    rows={6}
                                    className="w-full px-3 py-2 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent dark:text-white outline-none focus:border-gray-400 resize-none font-mono"
                                />
                            </div>
                            <button
                                onClick={handleEvolve}
                                disabled={evolving || !evolveLog.trim()}
                                className="w-full py-2 rounded-lg bg-purple-600 text-white text-xs font-medium disabled:opacity-50 hover:opacity-90 transition flex items-center justify-center gap-1.5"
                            >
                                {evolving ? (
                                    <><i className="fa-solid fa-spinner animate-spin" /> Merging...</>
                                ) : (
                                    <><i className="fa-solid fa-dna" /> Evolve Skill</>
                                )}
                            </button>
                            {evolveResult && (
                                <p className={`text-[11px] ${evolveResult.startsWith("Error") ? "text-red-500" : "text-green-600 dark:text-green-400"}`}>{evolveResult}</p>
                            )}
                        </div>
                    )}

                    {onRefineViaChat && (
                        <button
                            onClick={() => onRefineViaChat(skill)}
                            className="w-full py-2 rounded-lg border border-purple-300 dark:border-purple-800 text-purple-600 dark:text-purple-300 text-xs hover:bg-purple-50 dark:hover:bg-purple-950/30 transition flex items-center justify-center gap-1.5"
                            title="深化人格 / Refine through conversation"
                        >
                            <i className="fa-solid fa-comments" />
                            深化人格 · Refine through conversation
                        </button>
                    )}

                    <div className="flex gap-2">
                        <button
                            onClick={() => onDeleted(skill.id)}
                            className="px-4 py-2.5 rounded-lg border border-red-200 dark:border-red-900 text-red-500 text-sm hover:bg-red-50 dark:hover:bg-red-950 transition"
                        >
                            <i className="fa-solid fa-trash mr-1.5" />
                            Delete
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex-1 py-2.5 rounded-lg bg-black dark:bg-white text-white dark:text-black text-sm font-medium disabled:opacity-50 hover:opacity-90 transition"
                        >
                            {saving ? <i className="fa-solid fa-spinner animate-spin" /> : "Save Changes"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function WikiRunsPanel({ onClose, onOpen }) {
  const [runs, setRuns] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState("all"); // all | manual | auto
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = getStoredToken();
        const qs = new URLSearchParams({ limit: "30" });
        if (filter !== "all") qs.set("source", filter);
        const r = await fetch(`/api/muse/agent/runs?${qs.toString()}`, {
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!cancelled && r.ok) setRuns(await r.json());
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [filter]);
  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white dark:bg-black w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="text-base font-semibold dark:text-white"><i className="fa-solid fa-clock-rotate-left mr-2"></i>Wiki agent runs</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><i className="fa-solid fa-xmark"></i></button>
        </div>
        <div className="px-5 pt-3 flex items-center gap-1 text-xs">
          {[["all","All"],["manual","Manual"],["auto","Auto"]].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-2 py-1 rounded-full border ${filter === k ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white" : "border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-900"}`}
            >{label}</button>
          ))}
        </div>
        <div className="p-5 space-y-2">
          {loading && <div className="text-sm text-gray-400">Loading…</div>}
          {!loading && runs.length === 0 && <div className="text-sm text-gray-400">No runs yet. Try /ingest, /query, /lint, or /reindex in the chat.</div>}
          {runs.map(r => (
            <button
              key={r.id}
              onClick={() => onOpen(r.id)}
              className="w-full text-left px-3 py-2 rounded-lg border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900"
            >
              <div className="flex items-center gap-2 text-xs flex-wrap">
                <span className={`px-1.5 py-0.5 rounded ${r.status === 'ok' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>{r.status}</span>
                <span className="font-mono text-gray-500">#{r.id}</span>
                <span className="font-medium dark:text-white">{r.op}</span>
                {r.source === "auto" && (
                  <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 text-[10px]">auto{r.trigger && r.trigger !== "manual" ? ` · ${r.trigger}` : ""}</span>
                )}
                <span className="text-gray-400 ml-auto">{r.toolCallCount} calls · {r.durationMs}ms</span>
              </div>
              <div className="text-sm dark:text-gray-200 mt-1 truncate">{r.input || '(no input)'}</div>
              {r.output && <div className="text-xs text-gray-500 mt-1 line-clamp-2">{r.output}</div>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DiffView({ diff }) {
  if (!diff) return null;
  const lines = String(diff).split("\n");
  return (
    <pre className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed bg-gray-50 dark:bg-gray-900 rounded-lg p-2 overflow-auto max-h-72">
      {lines.map((l, i) => {
        let cls = "text-gray-600 dark:text-gray-300";
        if (l.startsWith("+++") || l.startsWith("---")) cls = "text-gray-400";
        else if (l.startsWith("+")) cls = "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20";
        else if (l.startsWith("-")) cls = "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20";
        return <div key={i} className={cls}>{l || "\u00a0"}</div>;
      })}
    </pre>
  );
}

function RunUpdateCard({ u, onChanged }) {
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState(u.status);
  const [errorMsg, setErrorMsg] = React.useState(u.errorMessage || null);
  async function decide(action) {
    setBusy(true);
    try {
      const token = getStoredToken();
      const r = await fetch(`/api/muse/agent/updates/${u.id}/${action}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const j = await r.json();
      if (r.ok && j.ok) {
        setStatus(action === "approve" ? "applied" : "rejected");
        if (onChanged) onChanged();
      } else {
        setErrorMsg(j.error || "failed");
      }
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  const badge =
    status === "pending" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
    : status === "applied" || status === "auto_applied" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
    : "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
  return (
    <div className="border border-gray-100 dark:border-gray-800 rounded-lg p-3 text-xs">
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${badge}`}>{status.replace("_", " ")}</span>
        <span className="font-mono text-gray-400">memo #{u.memoId}</span>
        <span className="font-medium dark:text-white truncate">{u.afterTitle || u.beforeTitle || "(untitled)"}</span>
        <span className="text-gray-400 ml-auto">{u.op}</span>
      </div>
      <DiffView diff={u.diff} />
      {errorMsg && <div className="text-red-500 mt-1">error: {errorMsg}</div>}
      {status === "pending" && (
        <div className="flex gap-2 mt-2 justify-end">
          <button
            disabled={busy}
            onClick={() => decide("reject")}
            className="text-[11px] px-3 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          >Reject</button>
          <button
            disabled={busy}
            onClick={() => decide("approve")}
            className="text-[11px] px-3 py-1 rounded bg-black dark:bg-white text-white dark:text-black hover:opacity-80 disabled:opacity-50"
          >Approve</button>
        </div>
      )}
    </div>
  );
}

function AutoApplyToggle({ op }) {
  const [on, setOn] = React.useState(null);
  React.useEffect(() => {
    (async () => {
      const token = getStoredToken();
      const r = await fetch(`/api/muse/agent/auto-apply`, {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (r.ok) {
        const j = await r.json();
        setOn(op === "ingest" ? !!j.ingest : !!j.synthesize);
      }
    })();
  }, [op]);
  async function toggle() {
    const next = !on;
    setOn(next);
    const token = getStoredToken();
    await fetch(`/api/muse/agent/auto-apply`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ op, value: next }),
    });
  }
  if (on === null) return null;
  return (
    <label className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400 cursor-pointer select-none">
      <input type="checkbox" checked={on} onChange={toggle} className="cursor-pointer" />
      Always auto-apply for {op === "ingest" ? "Ingest" : "Synthesize"} (skip review)
    </label>
  );
}

function WikiRunDetail({ id, onClose }) {
  const [run, setRun] = React.useState(null);
  const refresh = React.useCallback(async () => {
    const token = getStoredToken();
    const r = await fetch(`/api/muse/agent/runs/${id}`, {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (r.ok) setRun(await r.json());
  }, [id]);
  React.useEffect(() => { refresh(); }, [refresh]);
  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white dark:bg-black w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="text-base font-semibold dark:text-white">Run #{id} {run && <span className="ml-2 text-xs text-gray-500">({run.op} · {run.status})</span>}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><i className="fa-solid fa-xmark"></i></button>
        </div>
        {!run ? <div className="p-5 text-sm text-gray-400">Loading…</div> : (
          <div className="p-5 space-y-4 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Input</div>
              <pre className="whitespace-pre-wrap bg-gray-50 dark:bg-gray-900 p-3 rounded-lg dark:text-gray-200">{run.input || '(empty)'}</pre>
            </div>
            {run.error && (
              <div>
                <div className="text-xs uppercase tracking-wider text-red-500 mb-1">Error</div>
                <pre className="whitespace-pre-wrap bg-red-50 dark:bg-red-900/20 p-3 rounded-lg text-red-700 dark:text-red-300">{run.error}</pre>
              </div>
            )}
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Output</div>
              <pre className="whitespace-pre-wrap bg-gray-50 dark:bg-gray-900 p-3 rounded-lg dark:text-gray-200">{run.output || '(empty)'}</pre>
            </div>
            {(run.updates && run.updates.length > 0) && (
              <div>
                <div className="text-xs uppercase tracking-wider text-gray-500 mb-1 flex items-center gap-2">
                  <span>Memo updates ({run.updates.length})</span>
                  {(run.op === "ingest" || run.op === "synthesize") && (
                    <span className="ml-auto"><AutoApplyToggle op={run.op} /></span>
                  )}
                </div>
                <div className="space-y-2">
                  {run.updates.map(u => <RunUpdateCard key={u.id} u={u} onChanged={refresh} />)}
                </div>
              </div>
            )}
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Trace ({(run.trace || []).length} steps)</div>
              <div className="space-y-2">
                {(run.trace || []).map((s, i) => (
                  <div key={i} className="border border-gray-100 dark:border-gray-800 rounded-lg p-2.5 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-gray-400">step {s.step}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${s.kind === 'tool_call' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : s.kind === 'final' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>{s.kind}</span>
                      {s.toolName && <span className="font-mono text-gray-700 dark:text-gray-200">{s.toolName}</span>}
                      {s.durationMs != null && <span className="text-gray-400 ml-auto">{s.durationMs}ms</span>}
                    </div>
                    {s.args && <pre className="whitespace-pre-wrap bg-gray-50 dark:bg-gray-900 p-2 rounded mb-1 dark:text-gray-300">args: {JSON.stringify(s.args, null, 2)}</pre>}
                    {s.result !== undefined && <pre className="whitespace-pre-wrap bg-gray-50 dark:bg-gray-900 p-2 rounded dark:text-gray-300 max-h-48 overflow-auto">{typeof s.result === 'string' ? s.result : JSON.stringify(s.result, null, 2)}</pre>}
                    {s.error && <div className="text-red-500 mt-1">error: {s.error}</div>}
                    {s.text && <pre className="whitespace-pre-wrap bg-green-50 dark:bg-green-900/20 p-2 rounded dark:text-gray-200">{s.text}</pre>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Per-user editor for the Spec Builder skill's interview question list.
// Lets the user add / edit / remove / reorder questions and reset back to
// the shipped 8-question default. Persists to /api/muse/spec-builder-questions.
function SpecBuilderQuestionsModal({ onClose }) {
  const [questions, setQuestions] = React.useState(null);
  const [defaults, setDefaults] = React.useState([]);
  const [isCustom, setIsCustom] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    (async () => {
      const token = getStoredToken();
      const r = await fetch(`/api/muse/spec-builder-questions`, {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (r.ok) {
        const j = await r.json();
        setQuestions(j.questions || []);
        setDefaults(j.defaults || []);
        setIsCustom(!!j.isCustom);
      } else {
        setError("Failed to load questions");
      }
    })();
  }, []);

  function update(i, val) {
    setQuestions(qs => qs.map((q, idx) => idx === i ? val : q));
  }
  function remove(i) {
    setQuestions(qs => qs.filter((_, idx) => idx !== i));
  }
  function move(i, delta) {
    setQuestions(qs => {
      const j = i + delta;
      if (j < 0 || j >= qs.length) return qs;
      const next = qs.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function add() {
    setQuestions(qs => [...qs, ""]);
  }

  async function save({ reset = false } = {}) {
    setSaving(true);
    setError(null);
    const payload = reset ? { questions: null } : { questions };
    const token = getStoredToken();
    const r = await fetch(`/api/muse/spec-builder-questions`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (r.ok) {
      const j = await r.json();
      setQuestions(j.questions || []);
      setIsCustom(!!j.isCustom);
      if (reset) return;
      onClose();
    } else {
      const j = await r.json().catch(() => ({}));
      setError(j.error || "Failed to save");
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white dark:bg-black w-full max-w-xl max-h-[88vh] overflow-y-auto rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="spec-builder-questions-modal">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold dark:text-white">Spec Builder questions</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">Edit, reorder, or remove the questions Spec Builder asks. {isCustom ? "Currently using your custom list." : "Currently using the shipped defaults."}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><i className="fa-solid fa-xmark"></i></button>
        </div>
        {questions === null ? (
          <div className="p-5 text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="p-5 space-y-3">
            {error && <div className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 p-2 rounded">{error}</div>}
            <div className="space-y-2" data-testid="spec-builder-question-list">
              {questions.map((q, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-xs text-gray-400 mt-2 w-5 text-right">{i + 1}.</span>
                  <textarea
                    value={q}
                    onChange={(e) => update(i, e.target.value)}
                    rows={2}
                    maxLength={240}
                    className="flex-1 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-2 py-1.5 dark:text-white outline-none focus:border-gray-400 dark:focus:border-gray-600 resize-y"
                    data-testid={`spec-builder-question-${i}`}
                  />
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-400 hover:text-black dark:hover:text-white text-xs disabled:opacity-30 px-1" title="Move up"><i className="fa-solid fa-arrow-up"></i></button>
                    <button onClick={() => move(i, +1)} disabled={i === questions.length - 1} className="text-gray-400 hover:text-black dark:hover:text-white text-xs disabled:opacity-30 px-1" title="Move down"><i className="fa-solid fa-arrow-down"></i></button>
                    <button onClick={() => remove(i)} className="text-gray-400 hover:text-red-600 text-xs px-1" title="Remove"><i className="fa-solid fa-trash"></i></button>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={add} disabled={questions.length >= 20} className="text-xs text-gray-500 hover:text-black dark:hover:text-white border border-dashed border-gray-300 dark:border-gray-700 rounded-lg px-3 py-1.5 disabled:opacity-40" data-testid="spec-builder-add-question">
              <i className="fa-solid fa-plus mr-1"></i> Add question
            </button>
            <div className="text-[11px] text-gray-400">Up to 20 questions. Empty lines are dropped on save.</div>
          </div>
        )}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2">
          <button
            onClick={() => save({ reset: true })}
            disabled={saving || questions === null}
            className="text-xs text-gray-500 hover:text-black dark:hover:text-white px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 disabled:opacity-50"
            data-testid="spec-builder-reset"
            title={`Reset to the shipped ${defaults.length}-question list`}
          >
            <i className="fa-solid fa-rotate-left mr-1"></i> Reset to defaults
          </button>
          <div className="flex-1" />
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-black dark:hover:text-white px-3 py-1.5">Cancel</button>
          <button
            onClick={() => save()}
            disabled={saving || questions === null}
            className="text-xs bg-black dark:bg-white text-white dark:text-black px-3 py-1.5 rounded-lg disabled:opacity-50"
            data-testid="spec-builder-save"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportConversationsModal({ onClose, onImported }) {
    const [source, setSource] = useState('chatgpt');
    const [files, setFiles] = useState([]);
    const [parsing, setParsing] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [extractMemories, setExtractMemories] = useState(true);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);

    const isMarkdown = source === 'markdown';

    useEffect(() => {
        function onKey(e) { if (e.key === 'Escape' && !uploading) onClose(); }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, uploading]);

    async function handleSubmit(e) {
        e.preventDefault();
        if (!files.length || uploading) return;
        setError('');
        setUploading(true);
        try {
            setParsing(true);
            if (isMarkdown) {
                const payload = await Promise.all(
                    files.map(async f => ({ filename: f.name, text: await f.text() }))
                );
                setParsing(false);
                const res = await importMuseConversations('markdown', payload, { extractMemories });
                setResult(res);
            } else {
                const text = await files[0].text();
                let data;
                try { data = JSON.parse(text); }
                catch { throw new Error('File is not valid JSON. Make sure you uploaded conversations.json from the export, not the whole .zip.'); }
                setParsing(false);
                const res = await importMuseConversations(source, data, { extractMemories });
                setResult(res);
            }
        } catch (e) {
            setError(e.message || String(e));
            setParsing(false);
        } finally {
            setUploading(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-lg w-full shadow-xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-800">
                    <h3 className="text-sm font-semibold dark:text-white">Import chat history</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-black dark:hover:text-white text-sm">
                        <i className="fa-solid fa-xmark" />
                    </button>
                </div>

                {!result ? (
                    <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Source</label>
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { key: 'chatgpt',  label: 'ChatGPT',  hint: 'conversations.json from Data export' },
                                    { key: 'claude',   label: 'Claude',   hint: 'conversations.json from Privacy → Export' },
                                    { key: 'markdown', label: 'Markdown', hint: '.md files from a ChatGPT exporter tool' },
                                ].map(s => (
                                    <button
                                        key={s.key}
                                        type="button"
                                        onClick={() => setSource(s.key)}
                                        className={`text-left rounded-lg border px-3 py-2 text-xs transition cursor-pointer ${
                                            source === s.key
                                                ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300'
                                                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-400'
                                        }`}
                                    >
                                        <div className="font-semibold">{s.label}</div>
                                        <div className="text-[10px] opacity-70 mt-0.5">{s.hint}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {isMarkdown ? 'Markdown files (pick one or many)' : 'conversations.json file'}
                            </label>
                            <input
                                type="file"
                                accept={isMarkdown ? '.md,text/markdown,text/plain' : 'application/json,.json'}
                                multiple={isMarkdown}
                                onChange={e => { setFiles(Array.from(e.target.files || [])); setError(''); }}
                                className="block w-full text-xs text-gray-600 dark:text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-gray-100 dark:file:bg-gray-800 file:text-gray-700 dark:file:text-gray-300 hover:file:bg-gray-200 dark:hover:file:bg-gray-700"
                            />
                            <p className="mt-1 text-[10px] text-gray-400">
                                {isMarkdown
                                    ? <>Each <code>.md</code> file = one conversation. Expected format: <code>## Prompt:</code> / <code>## Response:</code> sections.</>
                                    : <>Tip: unzip the export first — you only need the <code>conversations.json</code> inside.</>
                                }
                            </p>
                            {isMarkdown && files.length > 0 && (
                                <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                                    Selected <strong>{files.length}</strong> file{files.length === 1 ? '' : 's'}.
                                </p>
                            )}
                        </div>

                        <label className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={extractMemories}
                                onChange={e => setExtractMemories(e.target.checked)}
                                className="mt-0.5"
                            />
                            <span>
                                Distill long-term memories from my user messages after import.
                                <span className="block text-[10px] text-gray-400 mt-0.5">
                                    Runs in background, ~US$0.10–0.30 per 1000 messages on gpt-4o-mini.
                                </span>
                            </span>
                        </label>

                        {error && (
                            <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">{error}</div>
                        )}

                        <div className="flex justify-end gap-2 pt-1">
                            <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-3 py-1.5 cursor-pointer">
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!files.length || uploading}
                                className="text-xs bg-black dark:bg-white text-white dark:text-black px-4 py-1.5 rounded-lg font-medium hover:opacity-80 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {parsing ? 'Parsing…' : uploading ? 'Importing…' : 'Import'}
                            </button>
                        </div>
                    </form>
                ) : (
                    <div className="px-5 py-5 space-y-3 text-sm">
                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold">
                            <i className="fa-solid fa-circle-check" /> Imported
                        </div>
                        <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                            <li>· <strong>{result.conversations}</strong> conversations</li>
                            <li>· <strong>{result.messages}</strong> messages ({result.userMessages} from you)</li>
                            {result.truncated && (
                                <li className="text-amber-600 dark:text-amber-400">
                                    · Export was very large — capped to the most recent 2000 conversations / 60 000 messages. Older items were skipped.
                                </li>
                            )}
                            {result.memoryJobQueued && (
                                <li className="text-purple-600 dark:text-purple-400">
                                    · Memory extraction running in the background — Muse will start recalling these in a few minutes.
                                </li>
                            )}
                        </ul>
                        <div className="flex justify-end pt-2">
                            <button onClick={onImported} className="text-xs bg-black dark:bg-white text-white dark:text-black px-4 py-1.5 rounded-lg font-medium hover:opacity-80 transition cursor-pointer">
                                Done
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
