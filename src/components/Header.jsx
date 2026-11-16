import React from "react"
import HeaderBtn from "./HeaderBtn"
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import ProfileMenu from "./menus/ProfileMenu.jsx";
import ExtrasMenu from "./menus/ExtrasMenu.jsx";

const Header = ({ onTasksChanged }) => {

    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const [searchParams, setSearchParams] = useSearchParams();

    const view = searchParams.get("view") || "week";

    const newDate = new Date();
    if (searchParams.get("weekShift")) {
        newDate.setDate(newDate.getDate() + (+searchParams.get("weekShift") * 7));
    }

    const viewYear = parseInt(searchParams.get("viewYear")) || newDate.getFullYear();
    const viewMonth = parseInt(searchParams.get("viewMonth")) ?? newDate.getMonth();
    const viewDateStr = searchParams.get("viewDate");

    function getDisplayInfo() {
        if (view === "year") {
            return { title: `${viewYear}`, subtitle: null };
        }
        if (view === "month") {
            return { title: months[viewMonth], subtitle: `${viewYear}` };
        }
        if (view === "day" && viewDateStr) {
            const parts = viewDateStr.split("-");
            const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            return { title: months[d.getMonth()], subtitle: `${d.getFullYear()}` };
        }
        if (view === "eisenhower" || view === "white" || view === "year" || view === "muse" || view === "office" || view === "podcast" || view === "flash" || view === "feed" || view === "weather" || view === "expenses" || view === "life" || view === "bp" || view === "steps" || view === "health" || view === "today" || view === "think") {
            return { title: "", subtitle: null };
        }
        return { title: months[newDate.getMonth()], subtitle: `${newDate.getFullYear()}` };
    }

    const { title, subtitle } = getDisplayInfo();

    function openProfileMenu(ev) {
        ev.stopPropagation();
        const profileMenu = document.querySelector(".profile-menu");
        profileMenu.classList.add("active");
        document.querySelector(".extras-menu").classList.remove("active");
        const buttonPos = ev.currentTarget.getBoundingClientRect();
        profileMenu.style.left = `${Math.round(buttonPos.left + buttonPos.width / 2)}px`;
        profileMenu.style.top = `${Math.round(buttonPos.bottom) + 8}px`;
    }

    function openExtrasMenu(ev) {
        ev.stopPropagation();
        const extrasMenu = document.querySelector(".extras-menu");
        extrasMenu.classList.add("active");
        document.querySelector(".profile-menu").classList.remove("active");
        const buttonPos = ev.currentTarget.getBoundingClientRect();
        extrasMenu.style.right = `${Math.round(window.innerWidth - buttonPos.right - 15)}px`;
        extrasMenu.style.top = `${Math.round(buttonPos.bottom) + 8}px`;
    }

    function handleTitleClick() {
        if (view === "week") {
            setSearchParams(prev => {
                prev.set("view", "month");
                prev.set("viewYear", newDate.getFullYear());
                prev.set("viewMonth", newDate.getMonth());
                return prev;
            });
        } else if (view === "month") {
            setSearchParams(prev => {
                prev.set("view", "week");
                prev.delete("viewYear");
                prev.delete("viewMonth");
                prev.delete("weekShift");
                return prev;
            });
        } else if (view === "day") {
            if (viewDateStr) {
                const parts = viewDateStr.split("-");
                setSearchParams(prev => {
                    prev.set("view", "month");
                    prev.set("viewYear", parts[0]);
                    prev.set("viewMonth", parseInt(parts[1]) - 1);
                    prev.delete("viewDate");
                    return prev;
                });
            }
        } else if (view === "year") {
            setSearchParams(prev => {
                prev.set("view", "week");
                prev.delete("viewYear");
                prev.delete("weekShift");
                return prev;
            });
        } else if (view === "eisenhower") {
            setSearchParams(prev => {
                prev.set("view", "week");
                return prev;
            });
        }
    }

    function handleSubtitleClick(ev) {
        ev.stopPropagation();
        if (view === "week" || view === "month" || view === "day") {
            setSearchParams(prev => {
                prev.set("view", "year");
                prev.set("viewYear", subtitle);
                prev.delete("viewMonth");
                prev.delete("viewDate");
                prev.delete("weekShift");
                return prev;
            });
        }
    }

    function navigatePrev() {
        if (view === "week") {
            let curShift = +searchParams.get("weekShift") || 0;
            setSearchParams(prev => { prev.set("weekShift", `${--curShift}`); return prev; });
        } else if (view === "month") {
            let m = viewMonth - 1, y = viewYear;
            if (m < 0) { m = 11; y--; }
            setSearchParams(prev => { prev.set("viewMonth", m); prev.set("viewYear", y); return prev; });
        } else if (view === "year") {
            setSearchParams(prev => { prev.set("viewYear", viewYear - 1); return prev; });
        } else if (view === "day" && viewDateStr) {
            const parts = viewDateStr.split("-");
            const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            d.setDate(d.getDate() - 1);
            setSearchParams(prev => { prev.set("viewDate", `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`); return prev; });
        }
    }

    function navigateNext() {
        if (view === "week") {
            let curShift = +searchParams.get("weekShift") || 0;
            setSearchParams(prev => { prev.set("weekShift", `${++curShift}`); return prev; });
        } else if (view === "month") {
            let m = viewMonth + 1, y = viewYear;
            if (m > 11) { m = 0; y++; }
            setSearchParams(prev => { prev.set("viewMonth", m); prev.set("viewYear", y); return prev; });
        } else if (view === "year") {
            setSearchParams(prev => { prev.set("viewYear", viewYear + 1); return prev; });
        } else if (view === "day" && viewDateStr) {
            const parts = viewDateStr.split("-");
            const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            d.setDate(d.getDate() + 1);
            setSearchParams(prev => { prev.set("viewDate", `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`); return prev; });
        }
    }

    function goToToday() {
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
    }

    const { currentUser } = useAuth();

    const headerBtns = [
        {
            textColor: "black",
            bgColor: "purple-200",
            icon: "fa-solid fa-ellipsis-vertical",
            tooltip: "Extras",
            onClick: openExtrasMenu,
        },
        {
            textColor: "white",
            bgColor: "black dark:bg-stone-800",
            icon: "fa-solid fa-chevron-left",
            onClick: navigatePrev,
        },
        {
            textColor: "white",
            bgColor: "black dark:bg-stone-800",
            icon: "fa-solid fa-chevron-right",
            onClick: navigateNext,
        },
    ]

    const [isSmall, setIsSmall] = React.useState(window.innerWidth < 1024);

    const handleResize = () => {
        setIsSmall(window.innerWidth < 1024);
    }

    React.useEffect(() => {
        window.addEventListener("resize", handleResize)
        return () => {
            window.removeEventListener("resize", handleResize)
        }
    }, [])

    let displayTitle = title;
    if (isSmall && view !== "year") displayTitle = title.slice(0, 4) + (title.length > 4 ? '.' : '');

    const viewLabels = { week: 'Week', month: 'Month', year: 'Year', day: 'Day', eisenhower: 'Matrix', white: 'White', think: 'Think', expenses: 'Spend', weather: 'Weather', life: 'World Graph', feed: 'Feed', podcast: 'Podcast', muse: 'Muse', office: 'Office', flash: 'Flash', bp: 'BP', steps: 'Steps', health: 'Health' };

    const tabClass = (v) => `text-xs transition cursor-pointer ${view === v ? 'text-black dark:text-white font-bold' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`;
    const pillClass = (v) => `text-[11px] px-2.5 py-1 rounded-md transition cursor-pointer whitespace-nowrap ${view === v ? 'bg-white dark:bg-gray-700 text-black dark:text-white font-semibold shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}`;
    const navTo = (v, extra) => () => setSearchParams(prev => { prev.set("view", v); prev.delete("weekShift"); prev.delete("viewYear"); prev.delete("viewMonth"); prev.delete("viewDate"); if (extra) extra(prev); return prev; });
    const sep = <span className="text-gray-200 dark:text-gray-700 text-xs max-lg:hidden">/</span>;

    const showNavArrows = view === 'week' || view === 'month' || view === 'year' || view === 'day';

    const mobileViewNames = {
        eisenhower: 'Matrix', week: 'Week', month: 'Month', year: 'Year',
        day: 'Today', flash: 'Flash', muse: 'Muse', all: 'All',
        focus: 'Focus', cheer: 'Cheer', memo: 'Memo', white: 'White', feed: 'Feed',
        life: 'World Graph', weather: 'Weather', expenses: 'Spend', bp: 'BP', steps: 'Steps', health: 'Health',
    };

    return (
        <header
            className="max-container flex flex-col lg:flex-row lg:justify-between max-lg:border-b max-lg:border-gray-100
            w-full padding-x py-2 lg:py-6 bg-white/90 dark:bg-black/90 max-lg:backdrop-blur-lg max-lg:fixed top-0 left-0
            dark:text-white z-10"
            style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 8px)" }}>

            <div className="lg:hidden flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                    {showNavArrows && (
                        <>
                            <button onClick={navigatePrev} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800 transition">
                                <i className="fa-solid fa-chevron-left text-xs" />
                            </button>
                        </>
                    )}
                    <div className="flex items-baseline gap-1.5 cursor-pointer" onClick={handleTitleClick}>
                        {title ? (
                            <>
                                <h1 className="text-base font-bold tracking-tight">{displayTitle}</h1>
                                {subtitle && <span className="text-xs text-gray-400" onClick={handleSubtitleClick}>{subtitle}</span>}
                            </>
                        ) : (
                            <span className="text-sm font-semibold text-gray-500">{mobileViewNames[view] || view}</span>
                        )}
                    </div>
                    {showNavArrows && (
                        <button onClick={navigateNext} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800 transition">
                            <i className="fa-solid fa-chevron-right text-xs" />
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={openExtrasMenu} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800 transition">
                        <i className="fa-solid fa-ellipsis-vertical text-sm" />
                    </button>
                    {currentUser && (
                        <button className="h-7 w-7 bg-blue-200 dark:bg-stone-800 rounded-full flex justify-center items-center overflow-hidden" onClick={openProfileMenu}>
                            {currentUser.profileImageUrl ?
                                <img src={currentUser.profileImageUrl} alt="" className="h-full w-full rounded-full object-cover" /> :
                                <span className="text-xs font-bold">{" ".concat(...currentUser?.name.split(" ").slice(0, 2).map(w => w[0].toUpperCase()))}</span>
                            }
                        </button>
                    )}
                </div>
            </div>

            <div className="hidden lg:flex items-baseline gap-2">
                {view !== 'month' && view !== 'day' && view !== 'week' && view !== 'all' && view !== 'focus' && view !== 'cheer' && view !== 'memo' && (
                    <>
                        <h1 className="text-4xl tracking-tighter font-[700] cursor-pointer hover:text-blue-600 transition"
                            onClick={handleTitleClick}>
                            {displayTitle || viewLabels[view] || ''}
                        </h1>
                        {subtitle && (
                            <span className="text-xl text-gray-400 cursor-pointer hover:text-blue-600 transition"
                                  onClick={handleSubtitleClick}>
                                {subtitle}
                            </span>
                        )}
                        {displayTitle && (
                            <span className="text-xs text-gray-400 ml-1">
                                {viewLabels[view]}
                            </span>
                        )}
                    </>
                )}
            </div>

            <div className="hidden lg:flex gap-3 items-center justify-end">
                <div className="flex items-center bg-gray-100 dark:bg-gray-800/60 rounded-lg p-0.5">
                    <button onClick={navTo('today')} className={pillClass('today')}>Hub</button>
                    <button onClick={navTo('eisenhower')} className={pillClass('eisenhower')}>Matrix</button>
                    <button onClick={goToToday} className={pillClass('day')}>Today</button>
                    <button onClick={navTo('week', p => { p.delete("viewDate"); })} className={pillClass('week')}>Week</button>
                    <button onClick={() => { const now = new Date(); setSearchParams(prev => { prev.set("view", "month"); prev.set("viewYear", now.getFullYear()); prev.set("viewMonth", now.getMonth()); prev.delete("weekShift"); prev.delete("viewDate"); return prev; }); }} className={pillClass('month')}>Month</button>
                    <button onClick={() => { const now = new Date(); setSearchParams(prev => { prev.set("view", "year"); prev.set("viewYear", now.getFullYear()); prev.delete("weekShift"); prev.delete("viewMonth"); prev.delete("viewDate"); return prev; }); }} className={pillClass('year')}>Year</button>
                </div>
                <div className="w-px h-5 bg-gray-200 dark:bg-gray-700" />
                <div className="flex items-center bg-gray-100 dark:bg-gray-800/60 rounded-lg p-0.5">
                    <button onClick={navTo('focus')} className={pillClass('focus')}>Focus</button>
                    <button onClick={navTo('flash')} className={pillClass('flash')}>Flash</button>
                    <button onClick={navTo('all')} className={pillClass('all')}>All</button>
                    <button onClick={navTo('cheer')} className={pillClass('cheer')}>Cheer</button>
                </div>
                <div className="w-px h-5 bg-gray-200 dark:bg-gray-700" />
                <div className="flex items-center bg-gray-100 dark:bg-gray-800/60 rounded-lg p-0.5">
                    <button onClick={navTo('memo')} className={pillClass('memo')}>Memo</button>
                    <button onClick={navTo('think')} className={pillClass('think')}>Think</button>
                    <button onClick={navTo('white')} className={pillClass('white')}>White</button>
                    <button onClick={navTo('life')} className={pillClass('life')}>World</button>
                    <button onClick={navTo('feed')} className={pillClass('feed')}>Feed</button>
                    <button onClick={navTo('podcast')} className={pillClass('podcast')}>Podcast</button>
                    <button onClick={navTo('last30days')} className={pillClass('last30days')}>Last 30d</button>
                </div>
                <div className="w-px h-5 bg-gray-200 dark:bg-gray-700" />
                <div className="flex items-center bg-gray-100 dark:bg-gray-800/60 rounded-lg p-0.5">
                    <button onClick={navTo('muse')} className={pillClass('muse')}>Muse</button>
                    <button onClick={navTo('office')} className={pillClass('office')}>Office</button>
                </div>
                <div className="w-px h-5 bg-gray-200 dark:bg-gray-700" />
                <div className="flex items-center bg-gray-100 dark:bg-gray-800/60 rounded-lg p-0.5">
                    <button onClick={navTo('expenses')} className={pillClass('expenses')}>Spend</button>
                    <button onClick={navTo('weather')} className={pillClass('weather')}>Weather</button>
                    <button onClick={navTo('health')} className={pillClass('health')}>Health</button>
                </div>
                {currentUser ?
                    <button className="w-10 h-10 text-lg flex-1 hover:shadow-lg relative group
                    dark:border dark:border-gray-200 dark:bg-stone-800
                    bg-blue-200 rounded-full mx-auto flex justify-center items-center" onClick={openProfileMenu}>
                        {currentUser.profileImageUrl ?
                            <img src={currentUser.profileImageUrl} alt="" className="h-full w-full rounded-full object-cover" /> :
                            <h2>{" ".concat(...currentUser?.name.split(" ").slice(0, 2).map(w => w[0].toUpperCase()))}</h2>
                        }
                        <p className="absolute left-1/2 -translate-x-[50%] top-[120%]
        opacity-0 group-hover:opacity-100 transition ease-linear duration-200
         text-white bg-gray-800 rounded text-xs p-1">Profile</p>
                    </button>
                    : <HeaderBtn {...{
                        textColor: "black dark:text-white",
                        bgColor: "blue-200 dark:bg-black",
                        icon: "fa-regular fa-user",
                        onClick: () => window.open("/api/login", "_top"),
                        tooltip: "Login",
                    }} />}
                {
                    headerBtns
                        .filter((_, index) => (view !== "eisenhower" && view !== "all" && view !== "focus" && view !== "cheer" && view !== "memo" && view !== "muse" && view !== "podcast" && view !== "flash" && view !== "feed" && view !== "life" && view !== "expenses" && view !== "weather" && view !== "bp" && view !== "steps" && view !== "health") || index === 0)
                        .map((btn, index) => (
                            <HeaderBtn {...btn} key={index} />
                        ))
                }
            </div>
            <ProfileMenu />
            <ExtrasMenu />
        </header>
    )
}

export default Header
