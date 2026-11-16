import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext.jsx";

function detectBrowserTimezone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
        return "";
    }
}

function isValidTimezone(tz) {
    if (typeof tz !== "string" || !tz || tz.length > 64) return false;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

function dismissedKey(userId) {
    return `tz-backfill-handled:${userId}`;
}

function readDismissed(userId) {
    try {
        return window.localStorage.getItem(dismissedKey(userId));
    } catch {
        return null;
    }
}

function writeDismissed(userId, value) {
    try {
        window.localStorage.setItem(dismissedKey(userId), value);
    } catch {
        // ignore quota / privacy mode failures
    }
}

export default function TimezoneBackfillPrompt() {
    const { currentUser, updateUser } = useAuth();
    const [detected] = useState(detectBrowserTimezone);
    const [hidden, setHidden] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const savedTz = currentUser?.timezone || "";
    const userId = currentUser?.id;
    const serverHandledAt = currentUser?.timezoneAutoBackfillHandledAt || null;

    const shouldPrompt = useMemo(() => {
        if (!userId) return false;
        if (!detected || !isValidTimezone(detected)) return false;
        if (!savedTz || !isValidTimezone(savedTz)) return false;
        if (detected === savedTz) return false;
        // Server-side flag: once the user has accepted/dismissed on any device, never prompt again.
        if (serverHandledAt) return false;
        // Legacy per-browser flag for users who already responded before the server flag existed.
        const handled = readDismissed(userId);
        if (handled && handled === `${savedTz}->${detected}`) return false;
        return true;
    }, [userId, savedTz, detected, serverHandledAt]);

    useEffect(() => {
        // Reset transient UI state when the relevant context changes.
        setHidden(false);
        setError("");
    }, [userId, savedTz, detected]);

    if (!shouldPrompt || hidden) return null;

    function markHandledLocal() {
        writeDismissed(userId, `${savedTz}->${detected}`);
    }

    async function persistHandledOnServer(extra = {}) {
        const result = await updateUser({ timezoneAutoBackfillHandled: true, ...extra });
        if (typeof result === "string") {
            return result;
        }
        return null;
    }

    async function handleUpdate() {
        setSaving(true);
        setError("");
        try {
            const errMsg = await persistHandledOnServer({ timezone: detected });
            if (errMsg) {
                setError(errMsg);
                setSaving(false);
                return;
            }
            markHandledLocal();
            setHidden(true);
        } catch (e) {
            setError(e?.message || "Could not update timezone");
        } finally {
            setSaving(false);
        }
    }

    async function handleDismiss() {
        setSaving(true);
        setError("");
        try {
            const errMsg = await persistHandledOnServer();
            if (errMsg) {
                // Even if the server call failed, fall back to localStorage so this browser stops nagging.
                markHandledLocal();
                setHidden(true);
                return;
            }
            markHandledLocal();
            setHidden(true);
        } catch {
            markHandledLocal();
            setHidden(true);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div
            data-testid="timezone-backfill-prompt"
            className="fixed top-2 left-1/2 -translate-x-1/2 z-50 w-[min(94vw,28rem)]
                       rounded-xl border border-black/10 bg-white/90 dark:bg-gray-900/90 dark:border-white/10
                       backdrop-blur-md shadow-lg p-3 text-sm text-gray-700 dark:text-gray-200"
        >
            <div className="flex items-start gap-2">
                <i className="fa-solid fa-globe mt-0.5 text-gray-500 dark:text-gray-400"></i>
                <div className="flex-1 min-w-0">
                    <p className="font-medium leading-snug">Update your timezone?</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug mt-0.5">
                        Looks like you&apos;re in <span className="font-mono">{detected}</span>, but your account is set to{" "}
                        <span className="font-mono">{savedTz}</span>. Updating helps reminders and daily summaries
                        arrive at the right local time.
                    </p>
                    {error && (
                        <p className="text-xs text-red-500 mt-1">{error}</p>
                    )}
                    <div className="flex gap-2 mt-2">
                        <button
                            type="button"
                            onClick={handleUpdate}
                            disabled={saving}
                            className="text-xs px-3 py-1 rounded-full bg-gray-800 text-white dark:bg-white dark:text-gray-900 disabled:opacity-60"
                        >
                            {saving ? "Updating…" : `Use ${detected}`}
                        </button>
                        <button
                            type="button"
                            onClick={handleDismiss}
                            disabled={saving}
                            className="text-xs px-3 py-1 rounded-full border border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-300"
                        >
                            Keep {savedTz}
                        </button>
                    </div>
                </div>
                <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={handleDismiss}
                    disabled={saving}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-1"
                >
                    <i className="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>
    );
}
