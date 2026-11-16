import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";

const PRIMARY_TABS = [
    { key: "eisenhower", label: "Matrix", icon: "fa-solid fa-table-cells-large" },
    { key: "day", label: "Today", icon: "fa-solid fa-calendar-day" },
    { key: "week", label: "Week", icon: "fa-solid fa-calendar-week" },
    { key: "flash", label: "Flash", icon: "fa-solid fa-bolt" },
    { key: "muse", label: "Muse", icon: "fa-solid fa-wand-magic-sparkles" },
    { key: "more", label: "More", icon: "fa-solid fa-grip" },
];

const MORE_TABS = [
    { key: "journal", label: "Journal", icon: "fa-solid fa-feather" },
    { key: "month", label: "Month", icon: "fa-solid fa-calendar" },
    { key: "year", label: "Year", icon: "fa-solid fa-calendar-check" },
    { key: "focus", label: "Focus", icon: "fa-solid fa-crosshairs" },
    { key: "all", label: "All", icon: "fa-solid fa-list" },
    { key: "cheer", label: "Cheer", icon: "fa-solid fa-heart" },
    { key: "memo", label: "Memo", icon: "fa-solid fa-note-sticky" },
    { key: "think", label: "Think", icon: "fa-solid fa-shapes" },
    { key: "white", label: "White", icon: "fa-solid fa-paintbrush" },
    { key: "feed", label: "Feed", icon: "fa-solid fa-rss" },
    { key: "podcast", label: "Podcast", icon: "fa-solid fa-podcast" },
    { key: "life", label: "World", icon: "fa-solid fa-globe" },
    { key: "weather", label: "Weather", icon: "fa-solid fa-cloud-sun" },
    { key: "expenses", label: "Spend", icon: "fa-solid fa-receipt" },
    { key: "health", label: "Health", icon: "fa-solid fa-heart" },
    { key: "last30days", label: "Last 30d", icon: "fa-solid fa-newspaper" },
    { key: "office", label: "Office", icon: "fa-solid fa-building" },
];

export default function MobileNav() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [showMore, setShowMore] = useState(false);
    const view = searchParams.get("view") || "week";

    function navTo(v) {
        setShowMore(false);
        if (v === "day") {
            const today = new Date();
            const dateStr = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
            setSearchParams(prev => {
                prev.set("view", "day");
                prev.set("viewDate", dateStr);
                prev.delete("weekShift");
                prev.delete("viewYear");
                prev.delete("viewMonth");
                return prev;
            });
        } else if (v === "month") {
            const now = new Date();
            setSearchParams(prev => {
                prev.set("view", "month");
                prev.set("viewYear", now.getFullYear());
                prev.set("viewMonth", now.getMonth());
                prev.delete("weekShift");
                prev.delete("viewDate");
                return prev;
            });
        } else if (v === "year") {
            const now = new Date();
            setSearchParams(prev => {
                prev.set("view", "year");
                prev.set("viewYear", now.getFullYear());
                prev.delete("weekShift");
                prev.delete("viewMonth");
                prev.delete("viewDate");
                return prev;
            });
        } else {
            setSearchParams(prev => {
                prev.set("view", v);
                prev.delete("weekShift");
                prev.delete("viewYear");
                prev.delete("viewMonth");
                prev.delete("viewDate");
                return prev;
            });
        }
    }

    const isActive = (v) => {
        if (v === "more") return MORE_TABS.some(t => t.key === view);
        return view === v;
    };

    return (
        <>
            {showMore && (
                <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setShowMore(false)}>
                    <div className="absolute bottom-[calc(env(safe-area-inset-bottom,0px)+56px)] left-0 right-0 bg-white dark:bg-gray-950 border-t border-gray-100 dark:border-gray-800 rounded-t-2xl shadow-2xl px-2 py-3"
                         onClick={e => e.stopPropagation()}>
                        <div className="grid grid-cols-4 gap-1">
                            {MORE_TABS.map(tab => (
                                <button
                                    key={tab.key}
                                    onClick={() => navTo(tab.key)}
                                    className={`flex flex-col items-center gap-1 py-3 rounded-xl transition ${
                                        view === tab.key
                                            ? "bg-black dark:bg-white text-white dark:text-black"
                                            : "text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800"
                                    }`}
                                >
                                    <i className={`${tab.icon} text-base`} />
                                    <span className="text-[10px] font-medium">{tab.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-white/90 dark:bg-black/90 backdrop-blur-lg border-t border-gray-200/50 dark:border-gray-800/50"
                 style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
                <div className="flex items-center justify-around px-1 h-14">
                    {PRIMARY_TABS.map(tab => {
                        const active = isActive(tab.key);
                        if (tab.key === "more") {
                            return (
                                <button
                                    key="more"
                                    onClick={() => setShowMore(!showMore)}
                                    className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition ${
                                        active || showMore
                                            ? "text-black dark:text-white"
                                            : "text-gray-400 dark:text-gray-500"
                                    }`}
                                >
                                    <i className={`${tab.icon} text-lg`} />
                                    <span className="text-[10px] font-medium">{tab.label}</span>
                                </button>
                            );
                        }
                        return (
                            <button
                                key={tab.key}
                                onClick={() => navTo(tab.key)}
                                className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition ${
                                    active
                                        ? "text-black dark:text-white"
                                        : "text-gray-400 dark:text-gray-500"
                                }`}
                            >
                                <div className={`relative ${active ? "" : ""}`}>
                                    <i className={`${tab.icon} text-lg`} />
                                    {active && <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-black dark:bg-white" />}
                                </div>
                                <span className="text-[10px] font-medium">{tab.label}</span>
                            </button>
                        );
                    })}
                </div>
            </nav>
        </>
    );
}
