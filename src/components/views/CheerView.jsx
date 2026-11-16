import React, { useState, useEffect } from 'react';

const COLORS = [
    { name: 'blue', text: 'text-blue-500', bg: 'bg-blue-500' },
    { name: 'red', text: 'text-red-500', bg: 'bg-red-500' },
    { name: 'purple', text: 'text-purple-500', bg: 'bg-purple-500' },
    { name: 'orange', text: 'text-orange-500', bg: 'bg-orange-500' },
    { name: 'green', text: 'text-green-500', bg: 'bg-green-500' },
    { name: 'pink', text: 'text-pink-500', bg: 'bg-pink-500' },
    { name: 'gray', text: 'text-gray-400', bg: 'bg-gray-400' },
    { name: 'teal', text: 'text-teal-500', bg: 'bg-teal-500' },
];

const SIZES = [
    { name: 'xs', cls: 'text-xs', label: 'XS' },
    { name: 'sm', cls: 'text-sm', label: 'S' },
    { name: 'md', cls: 'text-xl', label: 'M' },
    { name: 'lg', cls: 'text-3xl', label: 'L' },
    { name: 'xl', cls: 'text-5xl', label: 'XL' },
];

function getColorClass(name) {
    return COLORS.find(c => c.name === name)?.text || 'text-blue-500';
}

function getSizeClass(name) {
    return SIZES.find(s => s.name === name)?.cls || 'text-xl';
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : ''}` };
function getHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token')}` };
}

export default function CheerView() {
    const [cheers, setCheers] = useState([]);
    const [showAdd, setShowAdd] = useState(false);
    const [newText, setNewText] = useState('');
    const [newColor, setNewColor] = useState('blue');
    const [newSize, setNewSize] = useState('md');

    useEffect(() => {
        fetch('/api/cheers', { headers: getHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(setCheers);
    }, []);

    async function handleAdd() {
        if (!newText.trim()) return;
        const x = randomInt(5, 85);
        const y = randomInt(10, 80);
        const res = await fetch('/api/cheers', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ text: newText.trim(), color: newColor, size: newSize, x, y }),
        });
        if (res.ok) {
            const created = await res.json();
            setCheers(prev => [...prev, created]);
        }
        setNewText('');
        setShowAdd(false);
    }

    async function handleDelete(id) {
        await fetch(`/api/cheers/${id}`, { method: 'DELETE', headers: getHeaders() });
        setCheers(prev => prev.filter(c => c.id !== id));
    }

    return (
        <div className="relative w-full min-h-screen max-lg:mt-12 dark:bg-black overflow-hidden"
             style={{ background: 'radial-gradient(ellipse at center, rgba(200,180,255,0.15) 0%, transparent 70%)' }}>

            <button
                onClick={() => setShowAdd(true)}
                className="absolute top-4 right-6 z-20 w-10 h-10 rounded-full bg-black dark:bg-white text-white dark:text-black flex items-center justify-center text-xl hover:scale-110 transition cursor-pointer shadow-lg"
                title="Add a quote">
                <i className="fa-solid fa-plus" />
            </button>

            {cheers.map(cheer => (
                <div key={cheer.id}
                     className={`absolute group cursor-default select-none ${getColorClass(cheer.color)} ${getSizeClass(cheer.size)} font-semibold`}
                     style={{
                         left: `${cheer.x}%`,
                         top: `${cheer.y}%`,
                         transform: 'translate(-50%, -50%)',
                         opacity: ['xs', 'sm'].includes(cheer.size) ? 0.6 : 0.9,
                     }}>
                    <span className="italic">{cheer.text}</span>
                    <button
                        onClick={() => handleDelete(cheer.id)}
                        className="hidden group-hover:inline-block ml-2 text-xs text-red-400 hover:text-red-600 align-top"
                        title="Remove">
                        <i className="fa-solid fa-xmark" />
                    </button>
                </div>
            ))}

            {cheers.length === 0 && !showAdd && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <p className="text-gray-300 dark:text-gray-600 text-lg">
                        Press + to add your first quote
                    </p>
                </div>
            )}

            {showAdd && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/20 dark:bg-white/5"
                     onClick={(e) => { if (e.target === e.currentTarget) setShowAdd(false); }}>
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-80 flex flex-col gap-4">
                        <h3 className="font-bold text-lg dark:text-white">Add Quote</h3>
                        <input
                            type="text"
                            value={newText}
                            onChange={e => setNewText(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAdd()}
                            placeholder="Your words of wisdom..."
                            className="border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
                            autoFocus
                        />
                        <div>
                            <p className="text-xs text-gray-400 mb-1">Color</p>
                            <div className="flex gap-2 flex-wrap">
                                {COLORS.map(c => (
                                    <button key={c.name}
                                            onClick={() => setNewColor(c.name)}
                                            className={`w-6 h-6 rounded-full ${c.bg} ${newColor === c.name ? 'ring-2 ring-offset-2 ring-gray-400' : ''} cursor-pointer`} />
                                ))}
                            </div>
                        </div>
                        <div>
                            <p className="text-xs text-gray-400 mb-1">Size</p>
                            <div className="flex gap-2">
                                {SIZES.map(s => (
                                    <button key={s.name}
                                            onClick={() => setNewSize(s.name)}
                                            className={`px-3 py-1 rounded-full text-xs border cursor-pointer ${
                                                newSize === s.name
                                                    ? 'bg-black text-white dark:bg-white dark:text-black'
                                                    : 'border-gray-300 dark:border-gray-600 dark:text-gray-300'
                                            }`}>
                                        {s.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setShowAdd(false)}
                                    className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 cursor-pointer">
                                Cancel
                            </button>
                            <button onClick={handleAdd}
                                    className="px-4 py-2 text-sm bg-black dark:bg-white text-white dark:text-black rounded-lg hover:opacity-80 cursor-pointer">
                                Add
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
