import Blur from "../Blur.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useState, useEffect, useMemo } from "react";
import { isPushSupported, isSubscribedToPush, subscribeToPush, unsubscribeFromPush } from "../../scripts/pushNotifications.js";
import { getShareToken, getLastWeatherPush } from "../../scripts/api.js";
import { detectTimezone, getTimezoneOptions, getNextOccurrenceInTz, isValidTimezone } from "../../scripts/timezone.js";
import TimezoneCombobox from "./TimezoneCombobox.jsx";
import { getZoneAbbreviation } from "../../scripts/timezoneAbbr.js";
import { updateUserData } from "../../scripts/api.js";

export default function UpdateUserForm() {
    const { currentUser, updateUser } = useAuth();
    const accountExpandedGroups = currentUser?.tzExpandedGroups ?? null;
    const accountExpandedGroupsUpdatedAt = currentUser?.tzExpandedGroupsUpdatedAt ?? null;
    const [error, setError] = useState(null);
    const [pushSupported, setPushSupported] = useState(false);
    const [pushEnabled, setPushEnabled] = useState(false);
    const [pushLoading, setPushLoading] = useState(false);
    const [showAutoCapture, setShowAutoCapture] = useState(false);
    const [shareToken, setShareToken] = useState('');
    const [tokenLoading, setTokenLoading] = useState(false);
    const [copied, setCopied] = useState('');
    const detectedTimezone = useMemo(detectTimezone, []);
    const [timezone, setTimezone] = useState(currentUser?.timezone || detectedTimezone || "");
    const timezoneOptions = useMemo(() => getTimezoneOptions(detectedTimezone), [detectedTimezone]);
    const timezoneAbbr = useMemo(
        () => (timezone ? getZoneAbbreviation(timezone, new Date()) : ""),
        [timezone],
    );
    const detectedTimezoneAbbr = useMemo(
        () => (detectedTimezone ? getZoneAbbreviation(detectedTimezone, new Date()) : ""),
        [detectedTimezone],
    );
    const lineLinked = !!(currentUser?.lineLinked ?? currentUser?.lineUserId);
    const savedWeatherEnabled = currentUser?.dailyWeatherEnabled ?? true;
    const [weatherEnabled, setWeatherEnabled] = useState(savedWeatherEnabled);
    // Confidence chips on Muse Office worker results — default ON.
    const savedConfidenceChips = currentUser?.showConfidenceChips !== false;
    const [confidenceChips, setConfidenceChips] = useState(savedConfidenceChips);
    useEffect(() => {
        setConfidenceChips(currentUser?.showConfidenceChips !== false);
    }, [currentUser?.showConfidenceChips]);

    // Wiki auto-ingest toggles + weekly Lint schedule.
    const savedWikiAuto = {
        rss: !!currentUser?.wikiAutoIngestRssDigest,
        video: !!currentUser?.wikiAutoIngestVideoTranscript,
        line: !!currentUser?.wikiAutoIngestLineLog,
        last30: !!currentUser?.wikiAutoIngestLast30days,
    };
    const [wikiAutoRss, setWikiAutoRss] = useState(savedWikiAuto.rss);
    const [wikiAutoVideo, setWikiAutoVideo] = useState(savedWikiAuto.video);
    const [wikiAutoLine, setWikiAutoLine] = useState(savedWikiAuto.line);
    const [wikiAutoLast30, setWikiAutoLast30] = useState(savedWikiAuto.last30);
    useEffect(() => { setWikiAutoRss(!!currentUser?.wikiAutoIngestRssDigest); }, [currentUser?.wikiAutoIngestRssDigest]);
    useEffect(() => { setWikiAutoVideo(!!currentUser?.wikiAutoIngestVideoTranscript); }, [currentUser?.wikiAutoIngestVideoTranscript]);
    useEffect(() => { setWikiAutoLine(!!currentUser?.wikiAutoIngestLineLog); }, [currentUser?.wikiAutoIngestLineLog]);
    useEffect(() => { setWikiAutoLast30(!!currentUser?.wikiAutoIngestLast30days); }, [currentUser?.wikiAutoIngestLast30days]);

    const savedLint = {
        enabled: !!currentUser?.wikiLintEnabled,
        dow: currentUser?.wikiLintDow ?? 0,
        hour: currentUser?.wikiLintHour ?? 9,
        minute: currentUser?.wikiLintMinute ?? 0,
    };
    const [lintEnabled, setLintEnabled] = useState(savedLint.enabled);
    const [lintDow, setLintDow] = useState(savedLint.dow);
    const [lintHour, setLintHour] = useState(savedLint.hour);
    const [lintMinute, setLintMinute] = useState(savedLint.minute);
    useEffect(() => { setLintEnabled(!!currentUser?.wikiLintEnabled); }, [currentUser?.wikiLintEnabled]);
    useEffect(() => { setLintDow(currentUser?.wikiLintDow ?? 0); }, [currentUser?.wikiLintDow]);
    useEffect(() => { setLintHour(currentUser?.wikiLintHour ?? 9); }, [currentUser?.wikiLintHour]);
    useEffect(() => { setLintMinute(currentUser?.wikiLintMinute ?? 0); }, [currentUser?.wikiLintMinute]);
    const [weatherPushInfo, setWeatherPushInfo] = useState(null);
    const [weatherPushLoading, setWeatherPushLoading] = useState(false);
    const [weatherPushLoaded, setWeatherPushLoaded] = useState(false);

    useEffect(() => {
        if (currentUser?.timezone) setTimezone(currentUser.timezone);
    }, [currentUser?.timezone]);

    useEffect(() => {
        setWeatherEnabled(currentUser?.dailyWeatherEnabled ?? true);
    }, [currentUser?.dailyWeatherEnabled]);

    useEffect(() => {
        if (!lineLinked) return;
        let cancelled = false;
        setWeatherPushLoading(true);
        getLastWeatherPush()
            .then(data => {
                if (cancelled) return;
                setWeatherPushInfo(data || null);
                setWeatherPushLoaded(true);
            })
            .catch(() => {
                if (cancelled) return;
                setWeatherPushLoaded(true);
            })
            .finally(() => {
                if (!cancelled) setWeatherPushLoading(false);
            });
        return () => { cancelled = true; };
    }, [lineLinked, currentUser?.id, currentUser?.timezone, currentUser?.dailyWeatherEnabled]);

    const nextPushCopy = useMemo(() => {
        if (!weatherPushInfo) return null;
        const targetHour = weatherPushInfo.targetHour;
        const targetMinute = weatherPushInfo.targetMinute;
        const baseTz = weatherPushInfo.timezone;
        const previewTz = (timezone && isValidTimezone(timezone)) ? timezone : baseTz;
        if (!previewTz) return null;
        let next;
        if (previewTz === baseTz && weatherPushInfo.nextPushAt) {
            next = new Date(weatherPushInfo.nextPushAt);
        } else if (typeof targetHour === 'number' && typeof targetMinute === 'number') {
            try {
                next = getNextOccurrenceInTz(previewTz, targetHour, targetMinute);
            } catch {
                next = null;
            }
        }
        if (!next || Number.isNaN(next.getTime())) return null;
        const dayKey = (d) => new Intl.DateTimeFormat('en-CA', {
            timeZone: previewTz, year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(d);
        const todayKey = dayKey(new Date());
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const tomorrowKey = dayKey(tomorrow);
        const nextKey = dayKey(next);
        let dayLabel;
        if (nextKey === todayKey) dayLabel = 'today';
        else if (nextKey === tomorrowKey) dayLabel = 'tomorrow';
        else dayLabel = new Intl.DateTimeFormat(undefined, {
            timeZone: previewTz, weekday: 'short', month: 'short', day: 'numeric',
        }).format(next);
        const timeStr = new Intl.DateTimeFormat(undefined, {
            timeZone: previewTz, hour: 'numeric', minute: '2-digit',
        }).format(next);
        let tzAbbr = '';
        try {
            const parts = new Intl.DateTimeFormat(undefined, {
                timeZone: previewTz, hour: 'numeric', timeZoneName: 'short',
            }).formatToParts(next);
            tzAbbr = parts.find(p => p.type === 'timeZoneName')?.value || '';
        } catch {}
        return `Next push: ${dayLabel} at ${timeStr}${tzAbbr ? ' ' + tzAbbr : ''}`;
    }, [weatherPushInfo, timezone]);

    useEffect(() => {
        isPushSupported().then(ok => {
            setPushSupported(ok);
            if (ok) isSubscribedToPush().then(setPushEnabled);
        });
    }, []);

    async function loadShareToken() {
        if (shareToken) return;
        setTokenLoading(true);
        try {
            const data = await getShareToken();
            setShareToken(data.token);
        } catch (e) {
            console.error('Failed to load share token:', e);
        }
        setTokenLoading(false);
    }

    async function copyText(text, label) {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(label);
            setTimeout(() => setCopied(''), 2000);
        } catch {}
    }

    async function togglePush() {
        setPushLoading(true);
        try {
            if (pushEnabled) {
                await unsubscribeFromPush();
                setPushEnabled(false);
            } else {
                const sub = await subscribeToPush();
                setPushEnabled(!!sub);
                if (!sub && Notification.permission === 'denied') {
                    setError('Notifications blocked by browser. Please allow in browser settings.');
                }
            }
        } catch (err) {
            setError('Failed to toggle notifications');
        }
        setPushLoading(false);
    }

    function closeBlur(ev) {
        ev.preventDefault();
        const blur = document.querySelector('[data-id="update-user-form"]');
        blur.classList.remove("active");
    }

    async function handleSubmit(ev) {
        ev.preventDefault();
        const formData = new FormData(ev.target);
        const name = formData.get("name");
        const darkMode = formData.get("dark-mode") === "on";

        const payload = { name, darkMode };
        if (timezone && timezone !== currentUser?.timezone) {
            payload.timezone = timezone;
        }
        if (lineLinked && weatherEnabled !== savedWeatherEnabled) {
            payload.dailyWeatherEnabled = weatherEnabled;
        }
        if (confidenceChips !== savedConfidenceChips) {
            payload.showConfidenceChips = confidenceChips;
        }
        if (wikiAutoRss !== savedWikiAuto.rss) payload.wikiAutoIngestRssDigest = wikiAutoRss;
        if (wikiAutoVideo !== savedWikiAuto.video) payload.wikiAutoIngestVideoTranscript = wikiAutoVideo;
        if (wikiAutoLine !== savedWikiAuto.line) payload.wikiAutoIngestLineLog = wikiAutoLine;
        if (wikiAutoLast30 !== savedWikiAuto.last30) payload.wikiAutoIngestLast30days = wikiAutoLast30;
        if (lintEnabled !== savedLint.enabled) payload.wikiLintEnabled = lintEnabled;
        if (lintDow !== savedLint.dow) payload.wikiLintDow = Number(lintDow);
        if (lintHour !== savedLint.hour) payload.wikiLintHour = Number(lintHour);
        if (lintMinute !== savedLint.minute) payload.wikiLintMinute = Number(lintMinute);
        const result = await updateUser(payload);
        if (typeof result === "string") {
            setError(result);
        } else {
            if (darkMode) {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }
            const blur = document.querySelector('[data-id="update-user-form"]');
            blur.classList.remove("active");
        }
    }

    return (
        <Blur type="update-user-form">
            <div className="update-user-form relative top-10 bg-[#e5d7fa] top-10 rounded-xl p-4 lg:p-8 w-[28rem]
            z-20 text-gray-600 transition-all duration-500 ease-linear"
                 onClick={ev => ev.stopPropagation()}>
                <h3 className="font-bold text-xl tracking-tight">Account</h3>

                {error && typeof error === "string" && <h3
                    className="rounded-md px-2 text-sm bg-red-500 text-black py-3 my-1">
                    {error}</h3>}
                <form className="relative" onSubmit={handleSubmit}>

                    <div className="w-full flex gap-3 items-center my-4 pb-2 px-2 border-b border-black">
                        <i className="fa-solid fa-moon text-2xl"></i>
                        <div className="flex-1">
                            <p className="font-bold text-xs">Dark Mode</p>
                            <p className="leading-4 text-sm">Switch interface to dark theme</p>
                        </div>
                        <button type="button" className={`h-4 w-10 border border-black ${currentUser?.darkMode && "active"}
                        rounded-full relative top-1 [&.active]:bg-black group/dark-mode
                        `}
                        onClick={ev => {
                            ev.currentTarget.classList.toggle("active");
                            document.getElementById("dark-mode").checked = ev.currentTarget.classList.contains("active");
                        }}>
                            <div className="h-4 w-4 absolute rounded-full border border-black bg-black
                         top-[-1px] left-0 group-[.active]/dark-mode:left-6 group-[.active]/dark-mode:bg-[#e5d7fa] flex justify-center items-center">
                                <i className="fa-solid fa-check text-black text-xs"></i>
                            </div>
                        </button>
                    </div>
                    <input type="checkbox" defaultChecked={currentUser?.darkMode} name="dark-mode" id="dark-mode" className="hidden" />

                    <div className="w-full flex gap-3 items-center my-3 pb-2 px-2 border-b border-black/30">
                        <i className="fa-solid fa-shield-halved text-xl"></i>
                        <div className="flex-1">
                            <p className="font-bold text-xs">Confidence chips</p>
                            <p className="leading-4 text-sm">
                                {confidenceChips
                                    ? "Show High / Medium / Low chips on Muse Office worker results"
                                    : "Hide confidence chips on Muse Office worker results"}
                            </p>
                        </div>
                        <button type="button"
                            aria-pressed={confidenceChips}
                            aria-label="Toggle confidence chips"
                            className={`h-4 w-10 border border-black rounded-full relative top-1 group/conf ${confidenceChips ? 'active bg-black' : ''}`}
                            onClick={() => setConfidenceChips(v => !v)}>
                            <div className={`h-4 w-4 absolute rounded-full border border-black top-[-1px] flex justify-center items-center transition-all ${confidenceChips ? 'left-6 bg-[#e5d7fa]' : 'left-0 bg-black'}`}>
                                <i className={`fa-solid ${confidenceChips ? 'fa-check' : 'fa-xmark'} text-xs`}></i>
                            </div>
                        </button>
                    </div>

                    {pushSupported && (
                        <div className="w-full flex gap-3 items-center my-3 pb-2 px-2 border-b border-black/30">
                            <i className="fa-solid fa-bell text-xl"></i>
                            <div className="flex-1">
                                <p className="font-bold text-xs">Push Notifications</p>
                                <p className="leading-4 text-sm">{pushEnabled ? 'Reminders will be sent to this device' : 'Get task reminders on this device'}</p>
                            </div>
                            <button type="button" disabled={pushLoading}
                                className={`h-4 w-10 border border-black rounded-full relative top-1 group/push ${pushEnabled ? 'active bg-black' : ''}`}
                                onClick={togglePush}>
                                <div className={`h-4 w-4 absolute rounded-full border border-black top-[-1px] flex justify-center items-center transition-all ${pushEnabled ? 'left-6 bg-[#e5d7fa]' : 'left-0 bg-black'}`}>
                                    {pushLoading
                                        ? <i className="fa-solid fa-spinner fa-spin text-xs"></i>
                                        : <i className={`fa-solid ${pushEnabled ? 'fa-check' : 'fa-xmark'} text-xs`}></i>
                                    }
                                </div>
                            </button>
                        </div>
                    )}

                    <div className="w-full flex gap-3 items-center my-3 pb-2 px-2 border-b border-black/30">
                        <i className="fa-solid fa-bell text-xl"></i>
                        <div className="flex-1">
                            <p className="font-bold text-xs">自動記帳 Auto-Capture</p>
                            <p className="leading-4 text-sm">Android 通知自動記帳設定</p>
                        </div>
                        <button type="button"
                            className="text-xs px-2 py-1 border border-black/30 rounded-full hover:bg-black/10 transition"
                            onClick={() => { setShowAutoCapture(!showAutoCapture); if (!showAutoCapture) loadShareToken(); }}>
                            {showAutoCapture ? 'Hide' : 'Setup'}
                        </button>
                    </div>
                    {showAutoCapture && (
                        <div className="mb-3 px-2 space-y-2 text-xs">
                            <div>
                                <p className="font-bold text-[10px] text-gray-500 uppercase tracking-wider mb-1">Webhook URL</p>
                                <div className="flex gap-1">
                                    <div className="flex-1 bg-white/50 rounded px-2 py-1.5 font-mono text-[10px] break-all select-all">
                                        {window.location.origin}/api/expenses/auto-capture
                                    </div>
                                    <button type="button" onClick={() => copyText(`${window.location.origin}/api/expenses/auto-capture`, 'wh-url')}
                                        className="shrink-0 px-2 py-1 bg-white/50 rounded text-gray-500 hover:bg-white/80 transition text-[10px]">
                                        {copied === 'wh-url' ? <i className="fa-solid fa-check text-green-600" /> : <i className="fa-regular fa-copy" />}
                                    </button>
                                </div>
                            </div>
                            <div>
                                <p className="font-bold text-[10px] text-gray-500 uppercase tracking-wider mb-1">Share Token</p>
                                <div className="flex gap-1">
                                    <div className="flex-1 bg-white/50 rounded px-2 py-1.5 font-mono text-[10px] break-all select-all">
                                        {tokenLoading ? '...' : shareToken || '—'}
                                    </div>
                                    <button type="button" onClick={() => copyText(shareToken, 'wh-token')}
                                        className="shrink-0 px-2 py-1 bg-white/50 rounded text-gray-500 hover:bg-white/80 transition text-[10px]">
                                        {copied === 'wh-token' ? <i className="fa-solid fa-check text-green-600" /> : <i className="fa-regular fa-copy" />}
                                    </button>
                                </div>
                            </div>
                            <div className="bg-white/30 rounded-lg p-2 space-y-1.5">
                                <p className="font-bold text-[10px] text-gray-500 uppercase tracking-wider">Tasker 快速設定</p>
                                <ol className="space-y-1 text-[11px] text-gray-600 list-decimal list-inside">
                                    <li>Profile &rarr; Event &rarr; UI &rarr; Notification &rarr; 選擇付款 app</li>
                                    <li>Task &rarr; Net &rarr; HTTP Request (POST)</li>
                                    <li>URL 填上方 Webhook URL</li>
                                    <li>Header: <code className="bg-white/50 px-0.5 rounded">X-Share-Token: [你嘅 token]</code></li>
                                    <li>Body: <code className="bg-white/50 px-0.5 rounded">{'{"text":"%evtprm1 %evtprm2 %evtprm3"}'}</code></li>
                                </ol>
                            </div>
                            <p className="text-[10px] text-gray-400">支援 Google Pay、八達通、HSBC、恒生、中銀、PayMe 等付款通知</p>
                        </div>
                    )}

                    <input type="text" id="name" name="name" required placeholder="Name" defaultValue={currentUser?.name}
                           className="w-full my-2 py-1 border-b border-gray-600 bg-transparent indent-1 focus:outline-none" />

                    <div className="my-3 px-2">
                        <div className="flex items-baseline justify-between mb-1">
                            <label htmlFor="timezone" className="font-bold text-xs">
                                Timezone{timezone ? <>: <span className="font-normal text-gray-600">{timezone}{timezoneAbbr ? ` (${timezoneAbbr})` : ""}</span></> : null}
                            </label>
                            {detectedTimezone && timezone && timezone !== detectedTimezone && (
                                <button type="button"
                                    className="text-[10px] text-gray-500 underline"
                                    onClick={() => setTimezone(detectedTimezone)}>
                                    Use detected ({detectedTimezone}{detectedTimezoneAbbr ? `, ${detectedTimezoneAbbr}` : ""})
                                </button>
                            )}
                        </div>
                        <TimezoneCombobox
                            id="timezone"
                            value={timezone}
                            onChange={setTimezone}
                            options={timezoneOptions}
                            detected={detectedTimezone}
                            accountExpandedGroups={accountExpandedGroups}
                            accountExpandedGroupsUpdatedAt={accountExpandedGroupsUpdatedAt}
                            onAccountExpandedGroupsChange={(groups) => {
                                // Fire-and-forget background sync — never
                                // blocks the user and never surfaces an
                                // error toast for an opportunistic save.
                                updateUserData({ tzExpandedGroups: groups }).catch(() => {});
                            }}
                        />
                        <p className="text-[10px] text-gray-500 mt-1 leading-tight">
                            Used for daily summaries, reminders, and the morning weather push.
                        </p>
                    </div>

                    {lineLinked && (
                        <div className="my-3 px-2 pb-2 border-b border-black/30">
                            <div className="flex items-center gap-3">
                                <div className="flex-1">
                                    <p className="font-bold text-xs">LINE Weather Push</p>
                                    <p className="leading-4 text-[11px] text-gray-600">
                                        {weatherEnabled
                                            ? 'Morning weather will be pushed to LINE'
                                            : 'Morning weather push is paused'}
                                    </p>
                                </div>
                                <button type="button"
                                    aria-pressed={weatherEnabled}
                                    aria-label="Toggle daily weather push"
                                    className={`h-4 w-10 border border-black rounded-full relative top-1 group/weather ${weatherEnabled ? 'active bg-black' : ''}`}
                                    onClick={() => setWeatherEnabled(v => !v)}>
                                    <div className={`h-4 w-4 absolute rounded-full border border-black top-[-1px] flex justify-center items-center transition-all ${weatherEnabled ? 'left-6 bg-[#e5d7fa]' : 'left-0 bg-black'}`}>
                                        <i className={`fa-solid ${weatherEnabled ? 'fa-check' : 'fa-xmark'} text-xs`}></i>
                                    </div>
                                </button>
                            </div>
                            <p className={`text-[11px] leading-tight mt-1 ${weatherEnabled ? 'text-gray-600' : 'text-gray-400'}`}>
                                {weatherPushLoading && !weatherPushLoaded
                                    ? 'Checking last weather push…'
                                    : weatherPushInfo?.sentAt
                                        ? (weatherEnabled
                                            ? `Last sent ${new Date(weatherPushInfo.sentAt).toLocaleString()}`
                                            : `Push is off — last sent ${new Date(weatherPushInfo.sentAt).toLocaleString()}`)
                                        : (weatherEnabled
                                            ? 'No weather push sent yet.'
                                            : 'Push is off — no weather push sent yet.')}
                            </p>
                            {weatherPushLoaded && weatherEnabled && (
                                <p className="text-[11px] text-gray-600 leading-tight mt-0.5">
                                    {nextPushCopy || 'Next push time unavailable'}
                                </p>
                            )}
                        </div>
                    )}

                    <div className="my-3 px-2 pb-2 border-b border-black/30">
                        <p className="font-bold text-xs mb-1"><i className="fa-solid fa-book-open mr-1"></i>Wiki auto-ingest</p>
                        <p className="text-[11px] text-gray-600 leading-tight mb-2">
                            Automatically run the wiki Ingest agent on new captures. Off by default — turn on what you want compounding into your wiki.
                        </p>
                        {[
                            ["RSS daily digests", wikiAutoRss, setWikiAutoRss],
                            ["Video transcripts (YouTube auto-import + manual import)", wikiAutoVideo, setWikiAutoVideo],
                            ["LINE logs (food / expense / health)", wikiAutoLine, setWikiAutoLine],
                            ["Last 30 Days briefs (when the brief finishes)", wikiAutoLast30, setWikiAutoLast30],
                        ].map(([label, val, set]) => (
                            <div key={label} className="flex items-center gap-2 mb-1.5">
                                <button type="button"
                                    aria-pressed={val}
                                    aria-label={label}
                                    className={`h-4 w-10 border border-black rounded-full relative shrink-0 ${val ? 'active bg-black' : ''}`}
                                    onClick={() => set(v => !v)}>
                                    <div className={`h-4 w-4 absolute rounded-full border border-black top-[-1px] flex justify-center items-center transition-all ${val ? 'left-6 bg-[#e5d7fa]' : 'left-0 bg-black'}`}>
                                        <i className={`fa-solid ${val ? 'fa-check' : 'fa-xmark'} text-xs`}></i>
                                    </div>
                                </button>
                                <span className="text-[12px] leading-tight">{label}</span>
                            </div>
                        ))}
                    </div>

                    <div className="my-3 px-2 pb-2 border-b border-black/30">
                        <div className="flex items-center gap-3">
                            <div className="flex-1">
                                <p className="font-bold text-xs"><i className="fa-solid fa-broom mr-1"></i>Weekly wiki Lint</p>
                                <p className="leading-4 text-[11px] text-gray-600">
                                    {lintEnabled
                                        ? `Runs once a week — also sends a short LINE summary if linked.`
                                        : 'Disabled — no weekly Lint runs.'}
                                </p>
                            </div>
                            <button type="button"
                                aria-pressed={lintEnabled}
                                aria-label="Toggle weekly wiki lint"
                                className={`h-4 w-10 border border-black rounded-full relative top-1 ${lintEnabled ? 'active bg-black' : ''}`}
                                onClick={() => setLintEnabled(v => !v)}>
                                <div className={`h-4 w-4 absolute rounded-full border border-black top-[-1px] flex justify-center items-center transition-all ${lintEnabled ? 'left-6 bg-[#e5d7fa]' : 'left-0 bg-black'}`}>
                                    <i className={`fa-solid ${lintEnabled ? 'fa-check' : 'fa-xmark'} text-xs`}></i>
                                </div>
                            </button>
                        </div>
                        {lintEnabled && (
                            <div className="flex flex-wrap items-center gap-2 mt-2 text-[12px]">
                                <span>Every</span>
                                <select value={lintDow} onChange={e => setLintDow(Number(e.target.value))}
                                    className="bg-white/60 rounded px-1 py-0.5 border border-black/20">
                                    {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, i) => (
                                        <option key={d} value={i}>{d}</option>
                                    ))}
                                </select>
                                <span>at</span>
                                <select value={lintHour} onChange={e => setLintHour(Number(e.target.value))}
                                    className="bg-white/60 rounded px-1 py-0.5 border border-black/20">
                                    {Array.from({length: 24}, (_, i) => (
                                        <option key={i} value={i}>{String(i).padStart(2, "0")}</option>
                                    ))}
                                </select>
                                <span>:</span>
                                <select value={lintMinute} onChange={e => setLintMinute(Number(e.target.value))}
                                    className="bg-white/60 rounded px-1 py-0.5 border border-black/20">
                                    {[0, 15, 30, 45].map(m => (
                                        <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
                                    ))}
                                </select>
                                <span className="text-gray-500">({timezone || "your timezone"})</span>
                            </div>
                        )}
                    </div>

                    <div className="w-full flex justify-between items-center">
                        <button type="submit"
                            className="py-1 px-4 border border-black bg-gray-700 text-gray-100 rounded-full font-bold"
                        >Save
                        </button>
                        <button type="button"
                            className="my-2 py-1 rounded-full font-bold text-gray-400"
                            onClick={closeBlur}>
                            Cancel
                        </button>
                    </div>
                </form>
            </div>
        </Blur>
    )
}
