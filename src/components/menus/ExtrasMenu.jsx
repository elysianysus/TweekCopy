import { ExtrasMenuBtn } from "./ExtrasMenuBtn.jsx";
import { useEffect, useState } from "react";
import { openForm } from "../../scripts/utils.js";
import { getUserTasks } from "../../scripts/api.js";
import IOSShareSetup from "./IOSShareSetup.jsx";
import BookmarkletSetup from "./BookmarkletSetup.jsx";
import AndroidAutoCaptureSetup from "./AndroidAutoCaptureSetup.jsx";

export default function ExtrasMenu() {
    const [copyMsg, setCopyMsg] = useState("");
    const [showIOSShare, setShowIOSShare] = useState(false);
    const [showBookmarklet, setShowBookmarklet] = useState(false);
    const [showAutoCapture, setShowAutoCapture] = useState(false);

    function closeExtrasMenu() {
        const extrasMenu = document.querySelector(".extras-menu");
        extrasMenu.classList.remove("active");
    }

    function openSearchForm() {
        openForm("search-form");
        closeExtrasMenu();
    }

    function handlePrint() {
        closeExtrasMenu();
        window.print();
    }

    function triggerDownload(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async function handleDownloadCSV() {
        closeExtrasMenu();
        const tasks = await getUserTasks();
        const headers = ["id", "name", "date", "done", "description", "color", "order"];
        const rows = tasks.map(t =>
            headers.map(h => {
                const val = t[h] instanceof Date ? t[h].toISOString().split("T")[0] : (t[h] ?? "");
                return `"${String(val).replace(/"/g, '""')}"`;
            }).join(",")
        );
        const csv = [headers.join(","), ...rows].join("\n");
        triggerDownload(csv, "tasks.csv", "text/csv");
    }

    async function handleDownloadJSON() {
        closeExtrasMenu();
        const tasks = await getUserTasks();
        const cleaned = tasks.map(t => ({
            ...t,
            date: t.date instanceof Date ? t.date.toISOString().split("T")[0] : t.date,
        }));
        triggerDownload(JSON.stringify(cleaned, null, 2), "tasks.json", "application/json");
    }

    function formatICSDate(date) {
        const d = date instanceof Date ? date : new Date(date);
        return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    }

    function escapeICSText(str) {
        return String(str || "")
            .replace(/\\/g, "\\\\")
            .replace(/;/g, "\\;")
            .replace(/,/g, "\\,")
            .replace(/\n/g, "\\n");
    }

    function nextDayDateVal(dateStr) {
        const d = new Date(dateStr + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + 1);
        return d.toISOString().slice(0, 10).replace(/-/g, "");
    }

    async function handleExportCalendar() {
        closeExtrasMenu();
        const tasks = await getUserTasks();
        const now = formatICSDate(new Date());
        const events = tasks.map(t => {
            const dateStr = t.date instanceof Date ? t.date.toISOString().split("T")[0] : t.date;
            const dateVal = dateStr.replace(/-/g, "");
            const uid = `task-${t.id}@planner`;
            const summary = escapeICSText(t.name);
            const desc = escapeICSText(t.description || "");
            return [
                "BEGIN:VEVENT",
                `UID:${uid}`,
                `DTSTAMP:${now}`,
                `DTSTART;VALUE=DATE:${dateVal}`,
                `DTEND;VALUE=DATE:${nextDayDateVal(dateStr)}`,
                `SUMMARY:${summary}`,
                desc ? `DESCRIPTION:${desc}` : null,
                `STATUS:${t.done ? "COMPLETED" : "NEEDS-ACTION"}`,
                "END:VEVENT",
            ].filter(Boolean).join("\r\n");
        });
        const ics = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Planner App//EN",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
            ...events,
            "END:VCALENDAR",
        ].join("\r\n");
        triggerDownload(ics, "tasks.ics", "text/calendar");
    }

    async function handleCopyToClipboard() {
        closeExtrasMenu();
        const tasks = await getUserTasks();

        const today = new Date();
        const dayOfWeek = today.getDay();
        const monday = new Date(today);
        monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        monday.setHours(0, 0, 0, 0);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);

        const weekTasks = tasks
            .filter(t => {
                const d = t.date instanceof Date ? t.date : new Date(t.date);
                return d >= monday && d <= sunday;
            })
            .sort((a, b) => {
                const da = a.date instanceof Date ? a.date : new Date(a.date);
                const db = b.date instanceof Date ? b.date : new Date(b.date);
                return da - db;
            });

        const grouped = {};
        const groupOrder = [];
        weekTasks.forEach(t => {
            const d = t.date instanceof Date ? t.date : new Date(t.date);
            const key = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
            if (!grouped[key]) {
                grouped[key] = [];
                groupOrder.push(key);
            }
            grouped[key].push(t);
        });

        const lines = [];
        groupOrder.forEach(day => {
            const dayTasks = grouped[day];
            lines.push(`## ${day}`);
            dayTasks.forEach(t => {
                lines.push(`- [${t.done ? "x" : " "}] ${t.name}`);
            });
            lines.push("");
        });

        const text = lines.join("\n").trim();
        await navigator.clipboard.writeText(text || "(No tasks this week)");
        setCopyMsg("Copied!");
        setTimeout(() => setCopyMsg(""), 2000);
    }

    const extrasBtns = [
        {
            text: "Search",
            icon: "fa-solid fa-magnifying-glass",
            onClick: openSearchForm,
        },
        {
            text: "Print",
            icon: "fa-solid fa-print",
            onClick: handlePrint,
        },
        {
            text: "Download CSV",
            icon: "fa-solid fa-file-csv",
            onClick: handleDownloadCSV,
        },
        {
            text: "Download JSON",
            icon: "fa-solid fa-file-code",
            onClick: handleDownloadJSON,
        },
        {
            text: "Export to Calendar",
            icon: "fa-solid fa-calendar-days",
            onClick: handleExportCalendar,
        },
        {
            text: copyMsg || "Copy to Clipboard",
            icon: copyMsg ? "fa-solid fa-check" : "fa-solid fa-clipboard",
            onClick: handleCopyToClipboard,
        },
        {
            text: "iOS Share Setup",
            icon: "fa-brands fa-apple",
            onClick: () => { closeExtrasMenu(); setShowIOSShare(true); },
        },
        {
            text: "Desktop Share",
            icon: "fa-solid fa-desktop",
            onClick: () => { closeExtrasMenu(); setShowBookmarklet(true); },
        },
        {
            text: "Auto-Capture",
            icon: "fa-solid fa-bell",
            onClick: () => { closeExtrasMenu(); setShowAutoCapture(true); },
        },
    ];

    useEffect(() => {
        window.addEventListener("click", () => {
            const extrasMenu = document.querySelector(".extras-menu");
            extrasMenu.classList.remove("active");
        })

        window.addEventListener("scroll", () => {
            const extrasMenu = document.querySelector(".extras-menu");
            extrasMenu.classList.remove("active");
        })
    }, []);

    return (
        <>
        <div
            className="extras-menu text-black bg-white dark:bg-stone-800 dark:text-white
             border border-black rounded-md w-40 py-2 text-center"
            onClick={ev => ev.stopPropagation()}>
            <ul>
                {
                    extrasBtns.map((btn, index) => (
                        <ExtrasMenuBtn {...btn} key={index} />
                    ))
                }
            </ul>
        </div>
        {showIOSShare && <IOSShareSetup onClose={() => setShowIOSShare(false)} />}
        {showBookmarklet && <BookmarkletSetup onClose={() => setShowBookmarklet(false)} />}
        {showAutoCapture && <AndroidAutoCaptureSetup onClose={() => setShowAutoCapture(false)} />}
        </>
    )
}
