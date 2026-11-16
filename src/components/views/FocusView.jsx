import React, { useState, useEffect, useRef } from 'react';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_HEADERS = ['m', 't', 'w', 't', 'f', 's', 's'];

function MiniCal({ year, month }) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startDay = (new Date(year, month, 1).getDay() + 6) % 7;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
    const todayDate = isCurrentMonth ? today.getDate() : null;

    const cells = [];
    for (let i = 0; i < startDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) {
        const row = cells.slice(i, i + 7);
        while (row.length < 7) row.push(null);
        weeks.push(row);
    }

    return (
        <div className="text-[9px] leading-tight">
            <div className="font-bold text-[11px] mb-0.5">{MONTH_NAMES[month]}</div>
            <div className="grid grid-cols-7 gap-0">
                {DAY_HEADERS.map((d, i) => (
                    <span key={i} className="text-gray-400 text-center font-medium">{d}</span>
                ))}
                {weeks.flat().map((d, i) => (
                    <span key={i} className={`text-center ${
                        d === todayDate ? 'text-blue-500 font-bold' :
                        d ? 'text-gray-600 dark:text-gray-400' : ''
                    }`}>
                        {d || ''}
                    </span>
                ))}
            </div>
        </div>
    );
}

function FocusColumn({ yearMonth }) {
    const [focus, setFocus] = useState({ line1: "", line2: "", line3: "" });
    const loaded = useRef(false);

    useEffect(() => {
        loaded.current = false;
        fetch(`/api/month-focus/${yearMonth}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
        })
            .then(r => r.ok ? r.json() : { line1: "", line2: "", line3: "" })
            .then(data => {
                setFocus({ line1: data.line1 || "", line2: data.line2 || "", line3: data.line3 || "" });
                loaded.current = true;
            });
    }, [yearMonth]);

    function handleBlur() {
        if (loaded.current) {
            fetch(`/api/month-focus/${yearMonth}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
                },
                body: JSON.stringify(focus),
            });
        }
    }

    return (
        <div className="flex flex-col gap-1 flex-1">
            {['line1', 'line2', 'line3'].map((key, i) => (
                <input key={key}
                       type="text"
                       value={focus[key]}
                       onChange={e => setFocus(prev => ({ ...prev, [key]: e.target.value }))}
                       onBlur={handleBlur}
                       placeholder=""
                       className="text-xs bg-transparent border-b border-gray-200 dark:border-gray-700 focus:border-blue-400 focus:outline-none py-1 w-full"
                />
            ))}
        </div>
    );
}

export default function FocusView() {
    const year = new Date().getFullYear();

    const firstHalf = [0, 1, 2, 3, 4, 5];
    const secondHalf = [6, 7, 8, 9, 10, 11];

    function renderRow(months) {
        return (
            <div>
                <div className="grid grid-cols-6 gap-4 border-b border-gray-300 dark:border-gray-600 pb-3">
                    {months.map(m => {
                        const ym = `${year}-${String(m + 1).padStart(2, '0')}`;
                        return (
                            <div key={m}>
                                <MiniCal year={year} month={m} />
                            </div>
                        );
                    })}
                </div>
                <div className="grid grid-cols-6 gap-4 pt-2" style={{ minHeight: '180px' }}>
                    {months.map(m => {
                        const ym = `${year}-${String(m + 1).padStart(2, '0')}`;
                        return (
                            <div key={m} className={`${m < months[months.length - 1] ? 'border-r border-gray-200 dark:border-gray-700 pr-4' : ''}`}>
                                <FocusColumn yearMonth={ym} />
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    return (
        <div className="padding-x py-4 max-lg:mt-12 dark:bg-black dark:text-white min-h-screen">
            <div className="mb-6">
                <h2 className="text-3xl font-black leading-none tracking-tight">{year}</h2>
                <p className="text-sm text-gray-400 mt-1">Focus</p>
            </div>

            <div className="flex flex-col gap-10">
                {renderRow(firstHalf)}
                {renderRow(secondHalf)}
            </div>
        </div>
    );
}
