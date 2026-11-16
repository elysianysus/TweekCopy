import React, { useState } from 'react';

export default function BookmarkletSetup({ onClose }) {
    const [copied, setCopied] = useState('');

    async function copyToClipboard(text, label) {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(label);
            setTimeout(() => setCopied(''), 2000);
        } catch {}
    }

    const appUrl = window.location.origin;

    const sharePageBookmarklet = `javascript:void(window.open('${appUrl}/share?title='+encodeURIComponent(document.title)+'&url='+encodeURIComponent(location.href),'_blank'))`;

    const quickSaveBookmarklet = `javascript:void(window.open('${appUrl}/share?title='+encodeURIComponent(document.title)+'&url='+encodeURIComponent(location.href)+'&auto=memo','analogue_save','width=400,height=300'))`;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center lg:p-4"
             onClick={onClose}>
            <div className="w-full lg:max-w-lg max-h-[90vh] overflow-y-auto max-lg:rounded-t-2xl lg:rounded-xl bg-white dark:bg-gray-900 p-5"
                 onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <i className="fa-solid fa-bookmark text-lg" />
                        <h3 className="font-bold text-base">Desktop Share Setup</h3>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer">
                        <i className="fa-solid fa-xmark text-lg" />
                    </button>
                </div>

                <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
                    Save webpages to Analogue from any desktop browser using a bookmarklet.
                </p>

                <div className="space-y-5">
                    <div>
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Option 1: Share & Choose</h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                            Opens Analogue with the page info. You choose to save to Memo or Flash.
                        </p>
                        <div className="flex items-center gap-3 mb-2">
                            <a
                                href={sharePageBookmarklet}
                                onClick={e => e.preventDefault()}
                                draggable="true"
                                className="inline-flex items-center gap-2 px-5 py-3 bg-black dark:bg-white text-white dark:text-black rounded-xl font-bold text-sm hover:opacity-80 transition cursor-grab active:cursor-grabbing select-none"
                            >
                                <i className="fa-solid fa-share-from-square" />
                                Share to Analogue
                            </a>
                            <button
                                onClick={() => copyToClipboard(sharePageBookmarklet, 'share')}
                                className="shrink-0 px-3 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition cursor-pointer text-sm"
                                title="Copy bookmarklet code"
                            >
                                {copied === 'share' ? <i className="fa-solid fa-check text-green-500" /> : <i className="fa-regular fa-copy" />}
                            </button>
                        </div>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-700 pt-5">
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Option 2: Quick Save to Memo</h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                            Opens a small popup that auto-saves the page to Memo and closes itself.
                        </p>
                        <div className="flex items-center gap-3 mb-2">
                            <a
                                href={quickSaveBookmarklet}
                                onClick={e => e.preventDefault()}
                                draggable="true"
                                className="inline-flex items-center gap-2 px-5 py-3 bg-orange-500 text-white rounded-xl font-bold text-sm hover:opacity-80 transition cursor-grab active:cursor-grabbing select-none"
                            >
                                <i className="fa-solid fa-bolt" />
                                Quick Save
                            </a>
                            <button
                                onClick={() => copyToClipboard(quickSaveBookmarklet, 'quick')}
                                className="shrink-0 px-3 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition cursor-pointer text-sm"
                                title="Copy bookmarklet code"
                            >
                                {copied === 'quick' ? <i className="fa-solid fa-check text-green-500" /> : <i className="fa-regular fa-copy" />}
                            </button>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-1">
                            Requires you to be logged in to Analogue in this browser.
                        </p>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-700 pt-5">
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">How to Install</h4>
                        <ol className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
                            <li className="flex gap-3">
                                <span className="shrink-0 w-6 h-6 bg-black dark:bg-white text-white dark:text-black rounded-full flex items-center justify-center text-xs font-bold">1</span>
                                <span>Show your browser's <strong>bookmarks bar</strong> (Cmd+Shift+B on Mac, Ctrl+Shift+B on Windows)</span>
                            </li>
                            <li className="flex gap-3">
                                <span className="shrink-0 w-6 h-6 bg-black dark:bg-white text-white dark:text-black rounded-full flex items-center justify-center text-xs font-bold">2</span>
                                <span><strong>Drag the button above</strong> to your bookmarks bar</span>
                            </li>
                            <li className="flex gap-3">
                                <span className="shrink-0 w-6 h-6 bg-black dark:bg-white text-white dark:text-black rounded-full flex items-center justify-center text-xs font-bold">3</span>
                                <span>That's it! Click it on any webpage to share to Analogue</span>
                            </li>
                        </ol>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                        <details className="group">
                            <summary className="text-xs font-bold text-gray-400 uppercase tracking-wider cursor-pointer flex items-center gap-1">
                                <i className="fa-solid fa-chevron-right text-[8px] transition-transform group-open:rotate-90" />
                                Alternative: Manual Install
                            </summary>
                            <div className="mt-3 space-y-3 text-sm text-gray-600 dark:text-gray-300">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    If dragging doesn't work, you can copy the bookmarklet code and create a bookmark manually:
                                </p>
                                <ol className="space-y-2 text-xs text-gray-500 dark:text-gray-400">
                                    <li>1. Click the <i className="fa-regular fa-copy" /> copy button next to the bookmarklet above</li>
                                    <li>2. Create a new bookmark in your browser</li>
                                    <li>3. Set the name to "Share to Analogue" (or "Quick Save")</li>
                                    <li>4. Paste the copied code as the URL/address</li>
                                    <li>5. Save the bookmark</li>
                                </ol>
                            </div>
                        </details>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3">
                            <div className="flex items-start gap-2">
                                <i className="fa-solid fa-circle-info text-blue-500 mt-0.5" />
                                <div className="text-xs text-blue-700 dark:text-blue-300">
                                    <p className="font-medium mb-1">Works everywhere</p>
                                    <p>Safari, Chrome, Firefox, Edge, Brave — any desktop browser with a bookmarks bar.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
