import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { createMemo, uploadMemoFile } from '../../scripts/api.js';

const SHARE_CACHE_NAME = 'share-target-cache';

function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function ShareReceivePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [sharedUrl, setSharedUrl] = useState('');
  const [sharedFile, setSharedFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [isEmpty, setIsEmpty] = useState(false);

  const [autoSaveStatus, setAutoSaveStatus] = useState(null);

  useEffect(() => {
    const t = searchParams.get('title') || '';
    const tx = searchParams.get('text') || '';
    const u = searchParams.get('url') || '';
    const hasFile = searchParams.get('hasFile') === '1';
    const auto = searchParams.get('auto');

    setTitle(t);
    setText(tx);
    setSharedUrl(u);

    if (!t && !tx && !u && !hasFile) {
      setIsEmpty(true);
      return;
    }

    if (hasFile) {
      loadSharedFile();
    }

    if (auto === 'memo') {
      autoSaveToMemo(t, tx, u);
    }
  }, [searchParams]);

  async function autoSaveToMemo(t, tx, u) {
    setAutoSaveStatus('saving');
    try {
      const parts = [];
      if (t) parts.push(t);
      if (tx) parts.push(tx);
      if (u) parts.push(u);
      const content = parts.join('\n\n') || '(shared content)';
      const memoTitle = t || (u ? u : '');
      await createMemo({ content, title: memoTitle });
      setAutoSaveStatus('done');
      setTimeout(() => window.close(), 1500);
    } catch (err) {
      console.error('Auto-save failed:', err);
      setAutoSaveStatus('error');
    }
  }

  async function loadSharedFile() {
    try {
      const cache = await caches.open(SHARE_CACHE_NAME);
      const response = await cache.match('/share-file-data');
      if (response) {
        const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
        const fileName = decodeURIComponent(response.headers.get('X-File-Name') || 'shared-file');
        const blob = await response.blob();
        const file = new File([blob], fileName, { type: contentType });
        setSharedFile(file);

        if (contentType.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (e) => setFilePreview(e.target.result);
          reader.readAsDataURL(blob);
        }

        await cache.delete('/share-file-data');
      }
    } catch (err) {
      console.error('Failed to load shared file:', err);
    }
  }

  function getContentText() {
    const parts = [];
    if (title) parts.push(title);
    if (text) parts.push(text);
    if (sharedUrl) parts.push(sharedUrl);
    return parts.join('\n\n');
  }

  async function handleSaveToMemo() {
    if (saving) return;
    setSaving(true);
    try {
      const content = getContentText();
      const memoTitle = title || (sharedUrl ? sharedUrl : '');
      const memo = await createMemo({
        content: content || '(shared content)',
        title: memoTitle,
      });

      if (sharedFile && memo?.id) {
        await uploadMemoFile(memo.id, sharedFile);
      }

      navigate('/?view=memo');
    } catch (err) {
      console.error('Failed to save memo:', err);
      setSaving(false);
    }
  }

  function handleAddToFlash() {
    const content = getContentText();
    sessionStorage.setItem('flash_shared_text', content);
    navigate('/?view=flash');
  }

  if (autoSaveStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-black dark:text-white p-6">
        <div className="text-center max-w-sm">
          {autoSaveStatus === 'saving' && (
            <>
              <div className="text-4xl mb-4"><i className="fa-solid fa-spinner fa-spin text-orange-500" /></div>
              <h2 className="text-xl font-bold mb-2">Saving to Memo...</h2>
            </>
          )}
          {autoSaveStatus === 'done' && (
            <>
              <div className="text-5xl mb-4"><i className="fa-solid fa-check-circle text-green-500" /></div>
              <h2 className="text-xl font-bold mb-2">Saved!</h2>
              <p className="text-sm text-gray-400">This window will close automatically.</p>
            </>
          )}
          {autoSaveStatus === 'error' && (
            <>
              <div className="text-5xl mb-4"><i className="fa-solid fa-exclamation-circle text-red-500" /></div>
              <h2 className="text-xl font-bold mb-2">Save Failed</h2>
              <p className="text-sm text-gray-400 mb-4">You may need to log in first.</p>
              <button
                onClick={() => { setAutoSaveStatus(null); }}
                className="px-6 py-2.5 bg-black dark:bg-white text-white dark:text-black rounded-xl font-medium text-sm hover:opacity-80 transition cursor-pointer"
              >
                Try Manually
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-black dark:text-white p-6">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">📋</div>
          <h2 className="text-xl font-bold mb-2">Nothing to share</h2>
          <p className="text-sm text-gray-400 mb-6">
            No shared content was received. Try sharing something from another app.
          </p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-2.5 bg-black dark:bg-white text-white dark:text-black rounded-xl font-medium text-sm hover:opacity-80 transition cursor-pointer"
          >
            Go to Planner
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black dark:text-white p-6">
      <div className="max-w-lg mx-auto pt-8">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">📥</div>
          <h2 className="text-xl font-bold mb-1">Shared Content</h2>
          <p className="text-sm text-gray-400">Choose where to save this</p>
        </div>

        <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-6 bg-gray-50 dark:bg-gray-900">
          {filePreview && (
            <div className="mb-3 rounded-lg overflow-hidden">
              <img src={filePreview} alt="Shared" className="w-full max-h-64 object-contain bg-gray-100 dark:bg-gray-800" />
            </div>
          )}

          {sharedFile && !filePreview && (
            <div className="mb-3 flex items-center gap-2 text-sm text-gray-500">
              <i className="fa-solid fa-paperclip" />
              <span>{sharedFile.name}</span>
              <span className="text-xs text-gray-400">({(sharedFile.size / 1024).toFixed(1)} KB)</span>
            </div>
          )}

          {title && (
            <h3 className="font-medium text-sm mb-2">{title}</h3>
          )}

          {text && (
            <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap mb-2">{text}</p>
          )}

          {sharedUrl && (
            isSafeUrl(sharedUrl) ? (
              <a
                href={sharedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:underline break-all"
              >
                {sharedUrl}
              </a>
            ) : (
              <p className="text-xs text-gray-500 break-all">{sharedUrl}</p>
            )
          )}
        </div>

        <div className="space-y-3">
          <button
            onClick={handleSaveToMemo}
            disabled={saving}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl hover:bg-orange-100 dark:hover:bg-orange-900/40 transition cursor-pointer disabled:opacity-50"
          >
            <i className="fa-regular fa-note-sticky text-orange-500 text-lg" />
            <div className="text-left">
              <div className="font-medium text-sm">Save to Memo</div>
              <div className="text-xs text-gray-400">Save as a note with attachments</div>
            </div>
          </button>

          <button
            onClick={handleAddToFlash}
            disabled={saving}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl hover:bg-yellow-100 dark:hover:bg-yellow-900/40 transition cursor-pointer disabled:opacity-50"
          >
            <i className="fa-solid fa-bolt text-yellow-500 text-lg" />
            <div className="text-left">
              <div className="font-medium text-sm">Add to Flash</div>
              <div className="text-xs text-gray-400">Brain dump it for sorting later</div>
            </div>
          </button>
        </div>

        <button
          onClick={() => navigate('/')}
          className="w-full mt-4 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 py-2 cursor-pointer transition"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
