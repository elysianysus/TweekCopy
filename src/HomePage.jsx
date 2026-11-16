import React, { useEffect, useState } from 'react'
import Header from './components/Header'
import TaskListContainer from './components/tasks/TaskListContainer'
import { useAuth } from "./contexts/AuthContext";
import UpdateUserForm from "./components/forms/UpdateUserForm";
import TaskMenu from "./components/tasks/TaskMenu";
import SearchTaskForm from "./components/forms/SearchTaskForm.jsx";
import Loading from "./components/Loading.jsx";
import MobileNav from "./components/MobileNav.jsx";
import PushToast from "./components/PushToast.jsx";
import JournalNudge from "./components/JournalNudge.jsx";
import TimezoneBackfillPrompt from "./components/TimezoneBackfillPrompt.jsx";
import TimezoneCombobox from "./components/forms/TimezoneCombobox.jsx";
import { detectTimezone, getTimezoneOptions } from "./scripts/timezone.js";
import { getZoneAbbreviation } from "./scripts/timezoneAbbr.js";

function AuthForm() {
    const { login, signup } = useAuth();
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [name, setName] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [detectedTimezone] = useState(detectTimezone);
    const [timezone, setTimezone] = useState(detectedTimezone);
    const timezoneOptions = React.useMemo(() => getTimezoneOptions(detectedTimezone), [detectedTimezone]);
    const detectedAbbr = React.useMemo(
        () => (detectedTimezone ? getZoneAbbreviation(detectedTimezone, new Date()) : ""),
        [detectedTimezone],
    );

    async function handleSubmit(e) {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            if (isLogin) {
                await login(email, password);
            } else {
                if (!name.trim()) {
                    setError("Name is required");
                    setLoading(false);
                    return;
                }
                await signup(email, password, name, timezone || undefined);
            }
        } catch (err) {
            setError(err.message || "Something went wrong");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="min-w-screen min-h-screen bg-white dark:bg-black flex items-center justify-center">
            <div className="w-full max-w-sm px-6">
                <h1 className="text-4xl font-extrabold tracking-tight mb-2 text-center text-gray-800 dark:text-white">analogue planner</h1>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {!isLogin && (
                        <input
                            type="text"
                            placeholder="Name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gray-400"
                        />
                    )}
                    <input
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gray-400"
                    />
                    <div className="relative">
                        <input
                            type={showPassword ? "text" : "password"}
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={6}
                            className="w-full px-4 py-3 pr-11 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gray-400"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(s => !s)}
                            tabIndex={-1}
                            className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                            <i className={`fa-regular ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`} />
                        </button>
                    </div>

                    {!isLogin && (
                        <div className="space-y-1">
                            <label htmlFor="timezone" className="block text-xs text-gray-500 dark:text-gray-400">
                                Timezone: <span className="font-medium text-gray-700 dark:text-gray-300">{detectedTimezone || "Unknown"}</span>
                                {detectedTimezone && detectedAbbr && (
                                    <span className="ml-1 text-gray-500 dark:text-gray-400">({detectedAbbr})</span>
                                )}
                                {detectedTimezone && timezone && timezone !== detectedTimezone && (
                                    <span className="ml-1 text-gray-400">(changed)</span>
                                )}
                            </label>
                            <TimezoneCombobox
                                id="timezone"
                                value={timezone}
                                onChange={setTimezone}
                                options={timezoneOptions}
                                detected={detectedTimezone}
                            />
                            <p className="text-xs text-gray-400">
                                Used for daily summaries and reminders. Change it if this looks wrong.
                            </p>
                        </div>
                    )}

                    {error && (
                        <p className="text-red-500 text-sm text-center">{error}</p>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full px-4 py-3 bg-gray-800 text-white rounded-lg font-bold hover:bg-gray-700 transition disabled:opacity-50 cursor-pointer"
                    >
                        {loading ? "Please wait..." : isLogin ? "Log In" : "Sign Up"}
                    </button>
                </form>

                <p className="text-center text-gray-500 mt-4 text-sm">
                    {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
                    <button
                        onClick={() => { setIsLogin(!isLogin); setError(""); }}
                        className="text-gray-800 dark:text-gray-300 font-medium hover:underline cursor-pointer"
                    >
                        {isLogin ? "Sign Up" : "Log In"}
                    </button>
                </p>
            </div>
        </div>
    );
}

function HomePage() {
    const { currentUser, isLoading } = useAuth();

    useEffect(() => {
        const metaTheme = document.getElementById('theme-color-meta');
        if (currentUser?.darkMode) {
            document.documentElement.classList.add('dark');
            if (metaTheme) metaTheme.setAttribute('content', '#000000');
        } else {
            document.documentElement.classList.remove('dark');
            if (metaTheme) metaTheme.setAttribute('content', '#ffffff');
        }
    }, [currentUser]);

    if (isLoading) {
        return <Loading text="Loading" />;
    }

    if (!currentUser) {
        return <AuthForm />;
    }

    return (
        <div className="min-w-screen min-h-screen bg-white dark:bg-black">
            <main className="max-container pb-16 lg:pb-0">
                <TaskListContainer />
                <SearchTaskForm />
                <UpdateUserForm />
                <TaskMenu />
            </main>
            <MobileNav />
            <PushToast />
            <JournalNudge />
            <TimezoneBackfillPrompt />
        </div>
    )
}

export default HomePage
