import React, { useState, useEffect } from 'react';
import { getShareToken } from '../../scripts/api.js';

export default function AndroidAutoCaptureSetup({ onClose }) {
    const [token, setToken] = useState('');
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState('');

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

    async function copyToClipboard(text, label) {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(label);
            setTimeout(() => setCopied(''), 2000);
        } catch {}
    }

    const appUrl = window.location.origin;
    const webhookUrl = `${appUrl}/api/expenses/auto-capture`;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center lg:p-4"
             onClick={onClose}>
            <div className="w-full lg:max-w-lg max-h-[90vh] overflow-y-auto max-lg:rounded-t-2xl lg:rounded-xl bg-white dark:bg-gray-900 p-5"
                 onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <i className="fa-brands fa-android text-lg text-green-500" />
                        <h3 className="font-bold text-base dark:text-white">自動記帳設定</h3>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer">
                        <i className="fa-solid fa-xmark text-lg" />
                    </button>
                </div>

                <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
                    透過 Android 自動化工具（Tasker / MacroDroid / Automate），將付款通知自動轉發到 Analogue，AI 會自動解析並記帳。
                </p>

                <div className="space-y-4">
                    <div>
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Webhook URL</h4>
                        <div className="flex gap-2">
                            <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm font-mono break-all select-all dark:text-white">
                                {webhookUrl}
                            </div>
                            <button
                                onClick={() => copyToClipboard(webhookUrl, 'url')}
                                className="shrink-0 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition cursor-pointer text-sm"
                            >
                                {copied === 'url' ? <i className="fa-solid fa-check text-green-500" /> : <i className="fa-regular fa-copy" />}
                            </button>
                        </div>
                    </div>

                    <div>
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Share Token</h4>
                        <div className="flex gap-2">
                            <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm font-mono break-all select-all dark:text-white">
                                {loading ? '...' : token}
                            </div>
                            <button
                                onClick={() => copyToClipboard(token, 'token')}
                                className="shrink-0 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition cursor-pointer text-sm"
                            >
                                {copied === 'token' ? <i className="fa-solid fa-check text-green-500" /> : <i className="fa-regular fa-copy" />}
                            </button>
                        </div>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                            <i className="fa-solid fa-wand-magic-sparkles text-purple-500 mr-1" />
                            Tasker 設定教學
                        </h4>
                        <ol className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
                            <li className="flex gap-3">
                                <span className="shrink-0 w-6 h-6 bg-black dark:bg-white text-white dark:text-black rounded-full flex items-center justify-center text-xs font-bold">1</span>
                                <div>
                                    <span className="font-medium">建立 Profile</span>
                                    <p className="text-xs text-gray-400 mt-0.5">Event &rarr; UI &rarr; Notification &rarr; 選擇付款 app（Google Pay、八達通、銀行 app 等）</p>
                                </div>
                            </li>
                            <li className="flex gap-3">
                                <span className="shrink-0 w-6 h-6 bg-black dark:bg-white text-white dark:text-black rounded-full flex items-center justify-center text-xs font-bold">2</span>
                                <div>
                                    <span className="font-medium">建立 Task</span>
                                    <p className="text-xs text-gray-400 mt-0.5">加入 Action: Net &rarr; HTTP Request</p>
                                </div>
                            </li>
                            <li className="flex gap-3">
                                <span className="shrink-0 w-6 h-6 bg-black dark:bg-white text-white dark:text-black rounded-full flex items-center justify-center text-xs font-bold">3</span>
                                <div>
                                    <span className="font-medium">設定 HTTP Request</span>
                                    <ul className="mt-1.5 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                                        <li>Method: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">POST</code></li>
                                        <li>URL: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-[10px] break-all">{webhookUrl}</code></li>
                                        <li>Headers: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">X-Share-Token: {loading ? '...' : token}</code></li>
                                        <li>Content Type: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">application/json</code></li>
                                        <li>Body: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{'{"text": "%evtprm1 %evtprm2 %evtprm3"}'}</code></li>
                                    </ul>
                                </div>
                            </li>
                            <li className="flex gap-3">
                                <span className="shrink-0 w-6 h-6 bg-black dark:bg-white text-white dark:text-black rounded-full flex items-center justify-center text-xs font-bold">4</span>
                                <div>
                                    <span className="font-medium">完成！</span>
                                    <p className="text-xs text-gray-400 mt-0.5">之後每次碌卡或拍卡付款，Tasker 會自動將通知傳送到 Analogue 記帳</p>
                                </div>
                            </li>
                        </ol>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                            <i className="fa-solid fa-robot text-blue-500 mr-1" />
                            MacroDroid 設定教學
                        </h4>
                        <ol className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
                            <li className="flex gap-3">
                                <span className="shrink-0 w-6 h-6 bg-black dark:bg-white text-white dark:text-black rounded-full flex items-center justify-center text-xs font-bold">1</span>
                                <div>
                                    <span className="font-medium">新增 Macro</span>
                                    <p className="text-xs text-gray-400 mt-0.5">Trigger: Notification Received &rarr; 選擇付款 app</p>
                                </div>
                            </li>
                            <li className="flex gap-3">
                                <span className="shrink-0 w-6 h-6 bg-black dark:bg-white text-white dark:text-black rounded-full flex items-center justify-center text-xs font-bold">2</span>
                                <div>
                                    <span className="font-medium">加入 Action</span>
                                    <p className="text-xs text-gray-400 mt-0.5">Actions &rarr; HTTP Request (POST)</p>
                                </div>
                            </li>
                            <li className="flex gap-3">
                                <span className="shrink-0 w-6 h-6 bg-black dark:bg-white text-white dark:text-black rounded-full flex items-center justify-center text-xs font-bold">3</span>
                                <div>
                                    <span className="font-medium">設定同 Tasker 一樣</span>
                                    <p className="text-xs text-gray-400 mt-0.5">URL、Header、Body 同上。Body 用 <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{'{"text": "{notification_title} {notification_text}"}'}</code></p>
                                </div>
                            </li>
                        </ol>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3">
                            <div className="flex items-start gap-2">
                                <i className="fa-solid fa-circle-info text-blue-500 mt-0.5" />
                                <div className="text-xs text-blue-700 dark:text-blue-300">
                                    <p className="font-medium mb-1">支援嘅付款通知</p>
                                    <p>Google Pay、八達通、HSBC、恒生銀行、中銀、PayMe、Tap & Go、WeChat Pay、Alipay HK 等。AI 會自動辨認商戶名、金額同分類。</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-3">
                            <div className="flex items-start gap-2">
                                <i className="fa-solid fa-shield-halved text-yellow-600 mt-0.5" />
                                <p className="text-xs text-yellow-700 dark:text-yellow-300">
                                    Share Token 等同密碼，請妥善保管。如果懷疑洩露，可以喺 iOS Share Setup 頁面重新產生。
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">cURL 測試</h4>
                        <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 text-xs font-mono break-all text-gray-600 dark:text-gray-300 leading-relaxed">
                            curl -X POST "{webhookUrl}" \<br/>
                            &nbsp;&nbsp;-H "Content-Type: application/json" \<br/>
                            &nbsp;&nbsp;-H "X-Share-Token: {loading ? '...' : token}" \<br/>
                            &nbsp;&nbsp;-d '{'"text": "Google Pay 已付款 HK$45.00 McDonald\'s"'}'
                        </div>
                        <button
                            onClick={() => copyToClipboard(
                                `curl -X POST "${webhookUrl}" -H "Content-Type: application/json" -H "X-Share-Token: ${token}" -d '{"text": "Google Pay 已付款 HK$45.00 McDonald'\\''s"}'`,
                                'curl'
                            )}
                            className="mt-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition cursor-pointer"
                        >
                            {copied === 'curl' ? <><i className="fa-solid fa-check text-green-500 mr-1" />Copied!</> : <><i className="fa-regular fa-copy mr-1" />Copy cURL</>}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
