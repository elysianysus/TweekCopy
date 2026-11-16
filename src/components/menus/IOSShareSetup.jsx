import React, { useState, useEffect } from 'react';
import { getShareToken, regenerateShareToken, getStoredToken } from '../../scripts/api.js';

export default function IOSShareSetup({ onClose }) {
    const [token, setToken] = useState('');
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState('');
    const [regenerating, setRegenerating] = useState(false);
    const [downloading, setDownloading] = useState(false);

    useEffect(() => {
        loadToken();
    }, []);

    async function loadToken() {
        try {
            const data = await getShareToken();
            setToken(data.token);
        } catch (e) {
            console.error('Failed to load share token:', e);
        }
        setLoading(false);
    }

    async function handleRegenerate() {
        if (regenerating) return;
        setRegenerating(true);
        try {
            const data = await regenerateShareToken();
            setToken(data.token);
        } catch (e) {
            console.error('Failed to regenerate token:', e);
        }
        setRegenerating(false);
    }

    async function handleDownloadShortcut() {
        if (downloading) return;
        setDownloading(true);
        try {
            const authToken = getStoredToken();
            const res = await fetch('/api/share-shortcut', {
                headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
            });
            if (!res.ok) throw new Error('Download failed');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Save to Analogue.shortcut';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Failed to download shortcut:', e);
        }
        setDownloading(false);
    }

    async function copyToClipboard(text, label) {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(label);
            setTimeout(() => setCopied(''), 2000);
        } catch {}
    }

    const appUrl = window.location.origin;
    const endpointUrl = `${appUrl}/api/share-receive`;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center lg:p-4"
             onClick={onClose}>
            <div className="w-full lg:max-w-lg max-h-[90vh] overflow-y-auto max-lg:rounded-t-2xl lg:rounded-xl bg-white dark:bg-gray-900 p-5"
                 onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <i className="fa-brands fa-apple text-lg" />
                        <h3 className="font-bold text-base">iOS Share Setup</h3>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer">
                        <i className="fa-solid fa-xmark text-lg" />
                    </button>
                </div>

                <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
                    Share content from any iOS app directly to Analogue using an iOS Shortcut.
                </p>

                <div className="space-y-4">
                    <div>
                        <button
                            onClick={handleDownloadShortcut}
                            disabled={downloading || loading}
                            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-black dark:bg-white text-white dark:text-black rounded-xl font-bold text-sm hover:opacity-80 transition cursor-pointer disabled:opacity-50"
                        >
                            {downloading ? (
                                <><i className="fa-solid fa-spinner fa-spin" /> Downloading...</>
                            ) : (
                                <><i className="fa-solid fa-download" /> Add to Shortcuts</>
                            )}
                        </button>
                        <p className="text-xs text-gray-400 text-center mt-2">
                            Downloads a pre-configured "Save to Analogue" shortcut with your token built in.
                            Open the file on your iPhone/iPad to install it.
                        </p>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Your Share Token</h4>
                        <div className="flex gap-2">
                            <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm font-mono break-all select-all">
                                {loading ? '...' : token}
                            </div>
                            <button
                                onClick={() => copyToClipboard(token, 'token')}
                                className="shrink-0 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition cursor-pointer text-sm"
                            >
                                {copied === 'token' ? <i className="fa-solid fa-check text-green-500" /> : <i className="fa-regular fa-copy" />}
                            </button>
                        </div>
                        <button
                            onClick={handleRegenerate}
                            disabled={regenerating}
                            className="mt-2 text-xs text-red-400 hover:text-red-500 transition cursor-pointer disabled:opacity-50"
                        >
                            {regenerating ? 'Regenerating...' : 'Regenerate token'}
                        </button>
                    </div>

                    <div>
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">API Endpoint</h4>
                        <div className="flex gap-2">
                            <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm font-mono break-all select-all">
                                {endpointUrl}
                            </div>
                            <button
                                onClick={() => copyToClipboard(endpointUrl, 'url')}
                                className="shrink-0 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition cursor-pointer text-sm"
                            >
                                {copied === 'url' ? <i className="fa-solid fa-check text-green-500" /> : <i className="fa-regular fa-copy" />}
                            </button>
                        </div>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Manual Setup (Alternative)</h4>
                        <ol className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
                            <li className="flex gap-3">
                                <span className="shrink-0 w-6 h-6 bg-black dark:bg-white text-white dark:text-black rounded-full flex items-center justify-center text-xs font-bold">1</span>
                                <span>Open the <strong>Shortcuts</strong> app on your iPhone or iPad</span>
                            </li>
                            <li className="flex gap-3">
                                <span className="shrink-0 w-6 h-6 bg-black dark:bg-white text-white dark:text-black rounded-full flex items-center justify-center text-xs font-bold">2</span>
                                <span>Create a new Shortcut and add a <strong>"Get Contents of URL"</strong> action</span>
                            </li>
                            <li className="flex gap-3">
                                <span className="shrink-0 w-6 h-6 bg-black dark:bg-white text-white dark:text-black rounded-full flex items-center justify-center text-xs font-bold">3</span>
                                <div>
                                    <span>Configure it as follows:</span>
                                    <ul className="mt-1.5 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                                        <li>URL: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{endpointUrl}</code></li>
                                        <li>Method: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">POST</code></li>
                                        <li>Headers: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">X-Share-Token</code> = your token above</li>
                                        <li>Request Body (Form):
                                            <ul className="ml-3 mt-0.5 space-y-0.5">
                                                <li><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">text</code> = Shortcut Input (text)</li>
                                                <li><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">file</code> = Shortcut Input (file, for images)</li>
                                                <li><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">title</code> = (optional)</li>
                                                <li><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">url</code> = (optional, for shared URLs)</li>
                                            </ul>
                                        </li>
                                    </ul>
                                </div>
                            </li>
                            <li className="flex gap-3">
                                <span className="shrink-0 w-6 h-6 bg-black dark:bg-white text-white dark:text-black rounded-full flex items-center justify-center text-xs font-bold">4</span>
                                <span>In Shortcut settings, enable <strong>"Show in Share Sheet"</strong> and set input types to Text, URLs, and Images</span>
                            </li>
                            <li className="flex gap-3">
                                <span className="shrink-0 w-6 h-6 bg-black dark:bg-white text-white dark:text-black rounded-full flex items-center justify-center text-xs font-bold">5</span>
                                <span>Name it <strong>"Save to Analogue"</strong> and tap Done</span>
                            </li>
                        </ol>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3">
                            <div className="flex items-start gap-2">
                                <i className="fa-solid fa-circle-info text-blue-500 mt-0.5" />
                                <div className="text-xs text-blue-700 dark:text-blue-300">
                                    <p className="font-medium mb-1">Quick Shortcut Template</p>
                                    <p>Receive <strong>Shortcut Input</strong> &rarr; <strong>Get Contents of URL</strong> (POST to endpoint with token header and text body) &rarr; <strong>Show Notification</strong> "Saved to Analogue"</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-3">
                            <div className="flex items-start gap-2">
                                <i className="fa-solid fa-shield-halved text-yellow-600 mt-0.5" />
                                <p className="text-xs text-yellow-700 dark:text-yellow-300">
                                    Your share token is like a password. Keep it secret. If you think it's been compromised, regenerate it above.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
