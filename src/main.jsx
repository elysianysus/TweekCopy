import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import HomePage from './HomePage'
import NotFound from "./components/NotFound";
import ShareReceivePage from "./components/views/ShareReceivePage";
import AdminHealthView from "./components/views/AdminHealthView";
import './index.css'
import { Route, createBrowserRouter, createRoutesFromElements, RouterProvider } from 'react-router-dom'
import AuthProvider from "./contexts/AuthContext";
import TaskMenuContext from "./contexts/TaskMenuContext";
import Error from "./components/Error.jsx";

function AccessGate({ children }) {
    const [unlocked, setUnlocked] = useState(sessionStorage.getItem('access_ok') === '1');
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [shake, setShake] = useState(false);
    const [showCode, setShowCode] = useState(false);
    const [loading, setLoading] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => {
        if (!unlocked) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [unlocked]);

    if (unlocked) return children;

    async function handleSubmit(e) {
        e.preventDefault();
        if (!code.trim() || loading) return;
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/access-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: code.trim() }),
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                sessionStorage.setItem('access_ok', '1');
                setUnlocked(true);
            } else {
                setError('Wrong access code');
                setCode('');
                setShake(true);
                setTimeout(() => { setShake(false); inputRef.current?.focus(); }, 500);
            }
        } catch {
            setError('Connection error');
        }
        setLoading(false);
    }

    return (
        <div className="min-w-screen min-h-screen bg-white dark:bg-black flex items-center justify-center">
            <div className="w-full max-w-xs px-6 text-center">
                <h1 className="text-3xl font-extrabold tracking-tight mb-6 text-gray-800 dark:text-white">analogue planner</h1>
                <p className="text-sm font-normal text-gray-400 mb-6">Enter the access code to continue</p>
                <form onSubmit={handleSubmit}>
                    <div className={`relative ${shake ? 'animate-shake' : ''}`}>
                        <input
                            ref={inputRef}
                            type={showCode ? 'text' : 'password'}
                            value={code}
                            onChange={e => { setCode(e.target.value); setError(''); }}
                            placeholder="Access code"
                            disabled={loading}
                            className={`w-full text-center text-sm py-3 pl-2 pr-9 bg-transparent border-0 border-b focus:outline-none focus:ring-0 transition dark:text-white placeholder-gray-400 ${error ? 'border-red-400' : 'border-gray-300 dark:border-gray-700 focus:border-black dark:focus:border-white'}`}
                            autoComplete="off"
                        />
                        <button
                            type="button"
                            onClick={() => setShowCode(s => !s)}
                            tabIndex={-1}
                            className="absolute right-1 top-1/2 -translate-y-1/2 px-2 py-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer text-sm"
                            aria-label={showCode ? 'Hide code' : 'Show code'}
                        >
                            <i className={`fa-regular ${showCode ? 'fa-eye-slash' : 'fa-eye'}`} />
                        </button>
                    </div>
                    {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
                    <button
                        type="submit"
                        disabled={loading || !code.trim()}
                        className="mt-6 text-sm font-medium tracking-wide text-gray-800 dark:text-gray-200 hover:text-black dark:hover:text-white transition disabled:opacity-30 cursor-pointer"
                    >
                        {loading ? <><i className="fa-solid fa-spinner fa-spin mr-2" />Verifying</> : 'Enter →'}
                    </button>
                </form>
            </div>
        </div>
    );
}

function App() {
    const router = createBrowserRouter(createRoutesFromElements(
        <>
            <Route path="/" element={<HomePage />} errorElement={<Error />} />
            <Route path="/share" element={<ShareReceivePage />} />
            <Route path="/admin/health" element={<AdminHealthView />} />
            <Route path="*" element={<NotFound />} />
        </>
    ))

    return (
        <RouterProvider router={router} />
    )
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <AccessGate>
            <AuthProvider>
                <TaskMenuContext>
                    <App />
                </TaskMenuContext>
            </AuthProvider>
        </AccessGate>
    </React.StrictMode>,
)
