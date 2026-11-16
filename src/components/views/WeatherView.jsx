import React, { useState, useEffect } from 'react';

const HKO_ICONS = {
    50: { icon: 'fa-sun', desc: '陽光充沛', color: 'text-yellow-500' },
    51: { icon: 'fa-sun', desc: '間有陽光', color: 'text-yellow-400' },
    52: { icon: 'fa-cloud-sun', desc: '短暫陽光', color: 'text-gray-500' },
    53: { icon: 'fa-cloud', desc: '多雲', color: 'text-gray-400' },
    54: { icon: 'fa-cloud-rain', desc: '多雲有驟雨', color: 'text-blue-400' },
    60: { icon: 'fa-cloud-sun-rain', desc: '間有陽光驟雨', color: 'text-blue-400' },
    61: { icon: 'fa-cloud-sun-rain', desc: '間有陽光幾陣驟雨', color: 'text-blue-500' },
    62: { icon: 'fa-cloud-showers-heavy', desc: '有雨', color: 'text-blue-600' },
    63: { icon: 'fa-cloud-bolt', desc: '有雨及雷暴', color: 'text-purple-500' },
    64: { icon: 'fa-cloud-bolt', desc: '大雨及雷暴', color: 'text-purple-600' },
    65: { icon: 'fa-cloud-bolt', desc: '暴雨及雷暴', color: 'text-purple-700' },
    70: { icon: 'fa-sun', desc: '天色良好', color: 'text-yellow-500' },
    71: { icon: 'fa-sun', desc: '天色良好', color: 'text-yellow-500' },
    72: { icon: 'fa-cloud-sun', desc: '短暫陽光', color: 'text-gray-500' },
    73: { icon: 'fa-cloud', desc: '多雲', color: 'text-gray-400' },
    74: { icon: 'fa-cloud-rain', desc: '多雲有驟雨', color: 'text-blue-400' },
    75: { icon: 'fa-cloud-sun-rain', desc: '間有陽光驟雨', color: 'text-blue-400' },
    76: { icon: 'fa-smog', desc: '大致多雲', color: 'text-gray-400' },
    77: { icon: 'fa-sun', desc: '天晴', color: 'text-yellow-500' },
    80: { icon: 'fa-wind', desc: '大風', color: 'text-teal-500' },
    81: { icon: 'fa-wind', desc: '乾燥', color: 'text-orange-400' },
    82: { icon: 'fa-droplet', desc: '潮濕', color: 'text-blue-300' },
    83: { icon: 'fa-temperature-high', desc: '霧', color: 'text-gray-300' },
    84: { icon: 'fa-smog', desc: '薄霧', color: 'text-gray-300' },
    85: { icon: 'fa-smog', desc: '煙霞', color: 'text-gray-400' },
    90: { icon: 'fa-temperature-high', desc: '酷熱', color: 'text-red-500' },
    91: { icon: 'fa-temperature-low', desc: '寒冷', color: 'text-cyan-500' },
    92: { icon: 'fa-sun', desc: '陽光充沛及炎熱', color: 'text-orange-500' },
    93: { icon: 'fa-sun', desc: '陽光充沛及乾燥', color: 'text-orange-400' },
};

const WARNING_ICONS = {
    'WTCSGNL': { label: '熱帶氣旋警告', icon: 'fa-hurricane', color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-300 dark:border-red-800' },
    'WRAIN': { label: '暴雨警告', icon: 'fa-cloud-showers-heavy', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-300 dark:border-blue-800' },
    'WFROST': { label: '霜凍警告', icon: 'fa-snowflake', color: 'text-cyan-500', bg: 'bg-cyan-50 dark:bg-cyan-950/30', border: 'border-cyan-300 dark:border-cyan-800' },
    'WHOT': { label: '酷熱天氣警告', icon: 'fa-temperature-high', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-300 dark:border-red-800' },
    'WCOLD': { label: '寒冷天氣警告', icon: 'fa-temperature-low', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-300 dark:border-blue-800' },
    'WMSGNL': { label: '季候風警告', icon: 'fa-wind', color: 'text-teal-500', bg: 'bg-teal-50 dark:bg-teal-950/30', border: 'border-teal-300 dark:border-teal-800' },
    'WFIRE': { label: '火災危險警告', icon: 'fa-fire', color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-orange-300 dark:border-orange-800' },
    'WFNTSA': { label: '新界北部水浸特別報告', icon: 'fa-water', color: 'text-blue-700', bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-300 dark:border-blue-800' },
    'WL': { label: '山泥傾瀉警告', icon: 'fa-mountain', color: 'text-amber-700', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-300 dark:border-amber-800' },
    'WTMW': { label: '海嘯警告', icon: 'fa-water', color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-950/30', border: 'border-indigo-300 dark:border-indigo-800' },
    'WTS': { label: '雷暴警告', icon: 'fa-bolt', color: 'text-yellow-600', bg: 'bg-yellow-50 dark:bg-yellow-950/30', border: 'border-yellow-300 dark:border-yellow-800' },
};

const TC_SIGNAL_INFO = {
    'TC1': { signal: '一號戒備信號', level: 1, color: 'text-green-600', bg: 'bg-green-100 dark:bg-green-900/40' },
    'TC3': { signal: '三號強風信號', level: 3, color: 'text-yellow-600', bg: 'bg-yellow-100 dark:bg-yellow-900/40' },
    'TC8NE': { signal: '八號東北烈風或暴風信號', level: 8, color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-900/40' },
    'TC8SE': { signal: '八號東南烈風或暴風信號', level: 8, color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-900/40' },
    'TC8NW': { signal: '八號西北烈風或暴風信號', level: 8, color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-900/40' },
    'TC8SW': { signal: '八號西南烈風或暴風信號', level: 8, color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-900/40' },
    'TC9': { signal: '九號烈風或暴風風力增強信號', level: 9, color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/40' },
    'TC10': { signal: '十號颶風信號', level: 10, color: 'text-red-800', bg: 'bg-red-200 dark:bg-red-900/60' },
};

function getWeatherIcon(code) {
    return HKO_ICONS[code] || { icon: 'fa-cloud', desc: '未知', color: 'text-gray-400' };
}

function formatDate(dateStr) {
    if (!dateStr || dateStr.length !== 8) return dateStr;
    const m = dateStr.slice(4, 6);
    const d = dateStr.slice(6, 8);
    return `${parseInt(m)}/${parseInt(d)}`;
}

function formatTCTime(timeStr) {
    if (!timeStr) return '';
    try {
        const d = new Date(timeStr);
        if (isNaN(d.getTime())) return timeStr;
        return d.toLocaleString('zh-HK', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
        return timeStr;
    }
}

function TyphoonTrackMap({ tcData }) {
    if (!tcData || tcData.length === 0) return null;

    return (
        <div className="space-y-6">
            {tcData.map((tc, tcIdx) => {
                const pastTrack = tc.pastTrack || [];
                const forecastTrack = tc.forecastTrack || [];
                const current = pastTrack[pastTrack.length - 1];

                return (
                    <div key={tcIdx} className="border border-red-200 dark:border-red-800/50 rounded-xl overflow-hidden">
                        <div className="bg-red-50 dark:bg-red-950/40 px-4 py-3 border-b border-red-200 dark:border-red-800/50">
                            <div className="flex items-center gap-2">
                                <i className="fa-solid fa-hurricane text-red-500 animate-spin" style={{ animationDuration: '3s' }} />
                                <div>
                                    <h4 className="text-sm font-semibold text-red-700 dark:text-red-400">
                                        {tc.tcName || tc.tcId || '熱帶氣旋'}
                                    </h4>
                                    {tc.tcNameEN && (
                                        <span className="text-[10px] text-red-500/70 uppercase tracking-wider">{tc.tcNameEN}</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {current && (
                            <div className="px-4 py-3 bg-white dark:bg-black">
                                <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-2">最新位置</div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <span className="text-[10px] text-gray-400 block">位置</span>
                                        <span className="text-xs text-black dark:text-white font-mono">{current.lat}°N {current.lng}°E</span>
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-gray-400 block">時間</span>
                                        <span className="text-xs text-black dark:text-white">{formatTCTime(current.time)}</span>
                                    </div>
                                    {current.maxWind && (
                                        <div>
                                            <span className="text-[10px] text-gray-400 block">最高風速</span>
                                            <span className="text-xs text-black dark:text-white">{current.maxWind} km/h</span>
                                        </div>
                                    )}
                                    {current.minSLP && (
                                        <div>
                                            <span className="text-[10px] text-gray-400 block">中心氣壓</span>
                                            <span className="text-xs text-black dark:text-white">{current.minSLP} hPa</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {pastTrack.length > 1 && (
                            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                                <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-2">過往路徑</div>
                                <div className="space-y-1 max-h-40 overflow-y-auto">
                                    {pastTrack.slice().reverse().slice(0, 12).map((pt, i) => (
                                        <div key={i} className="flex items-center text-[11px] py-0.5">
                                            <span className={`w-2 h-2 rounded-full mr-2 shrink-0 ${i === 0 ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-700'}`} />
                                            <span className="text-gray-400 w-24 shrink-0">{formatTCTime(pt.time)}</span>
                                            <span className="text-gray-500 font-mono text-[10px]">{pt.lat}°N {pt.lng}°E</span>
                                            {pt.maxWind && <span className="text-gray-400 ml-auto">{pt.maxWind} km/h</span>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {forecastTrack.length > 0 && (
                            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                                <div className="text-[10px] text-amber-500 uppercase tracking-wider font-medium mb-2">預測路徑</div>
                                <div className="space-y-1">
                                    {forecastTrack.map((ft, i) => (
                                        <div key={i} className="flex items-center text-[11px] py-0.5">
                                            <span className="w-2 h-2 rounded-full bg-amber-400 mr-2 shrink-0" />
                                            <span className="text-gray-400 w-24 shrink-0">{formatTCTime(ft.time)}</span>
                                            <span className="text-gray-500 font-mono text-[10px]">{ft.lat}°N {ft.lng}°E</span>
                                            {ft.maxWind && <span className="text-amber-500 ml-auto">{ft.maxWind} km/h</span>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function WarningCard({ code, detail }) {
    const info = WARNING_ICONS[code] || { label: code, icon: 'fa-triangle-exclamation', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-300 dark:border-amber-800' };
    const tcCode = detail?.subtype;
    const tcInfo = tcCode ? TC_SIGNAL_INFO[tcCode] : null;

    return (
        <div className={`${info.bg} border ${info.border} rounded-lg px-3 py-2.5`}>
            <div className="flex items-center gap-2">
                <i className={`fa-solid ${info.icon} ${info.color} text-sm`} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${info.color}`}>{info.label}</span>
                        {tcInfo && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${tcInfo.bg} ${tcInfo.color} font-semibold`}>
                                {tcInfo.signal}
                            </span>
                        )}
                    </div>
                    {detail?.contents && detail.contents.length > 0 && (
                        <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">
                            {detail.contents.join(' ')}
                        </p>
                    )}
                    {detail?.actionCode && (
                        <span className="text-[10px] text-gray-400 mt-0.5 block">{detail.actionCode}</span>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function WeatherView() {
    const [current, setCurrent] = useState(null);
    const [forecast, setForecast] = useState(null);
    const [localForecast, setLocalForecast] = useState(null);
    const [warnSummary, setWarnSummary] = useState(null);
    const [warningInfo, setWarningInfo] = useState(null);
    const [tcTrack, setTcTrack] = useState(null);
    const [swt, setSwt] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        loadWeather();
    }, []);

    async function loadWeather() {
        setLoading(true);
        setError(null);
        try {
            const base = 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?lang=tc&dataType=';
            const [currentRes, forecastRes, localRes, warnRes, warnInfoRes, swtRes] = await Promise.all([
                fetch(base + 'rhrread'),
                fetch(base + 'fnd'),
                fetch(base + 'flw'),
                fetch(base + 'warnsum'),
                fetch(base + 'warningInfo'),
                fetch(base + 'swt'),
            ]);
            setCurrent(await currentRes.json());
            setForecast(await forecastRes.json());
            setLocalForecast(await localRes.json());
            const warnData = await warnRes.json();
            setWarnSummary(warnData);
            setWarningInfo(await warnInfoRes.json());

            const swtData = await swtRes.json();
            setSwt(swtData);

            const hasTC = warnData && Object.keys(warnData).some(k => k === 'WTCSGNL');
            if (hasTC) {
                try {
                    const tcRes = await fetch('https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=tctrack&lang=tc');
                    if (tcRes.ok) {
                        const tcData = await tcRes.json();
                        setTcTrack(tcData);
                    }
                } catch (e) {
                    console.log('TC track data not available');
                }
            } else {
                try {
                    const tcRes = await fetch('https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=tctrack&lang=tc');
                    if (tcRes.ok) {
                        const tcData = await tcRes.json();
                        if (tcData && ((tcData.tropicalCyclone && tcData.tropicalCyclone.length > 0) || (Array.isArray(tcData) && tcData.length > 0))) {
                            setTcTrack(tcData);
                        }
                    }
                } catch (e) {}
            }
        } catch (e) {
            setError('Failed to load weather data');
            console.error(e);
        }
        setLoading(false);
    }

    if (loading) {
        return (
            <div className="padding-x py-4 max-lg:mt-12 dark:bg-black dark:text-white min-h-screen flex items-center justify-center">
                <div className="text-gray-400 text-sm"><i className="fa-solid fa-spinner animate-spin mr-2" />Loading weather...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="padding-x py-4 max-lg:mt-12 dark:bg-black dark:text-white min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <p className="text-gray-400 text-sm">{error}</p>
                    <button onClick={loadWeather} className="mt-2 text-xs text-gray-500 hover:text-black dark:hover:text-white underline cursor-pointer">Retry</button>
                </div>
            </div>
        );
    }

    const hkoTemp = current?.temperature?.data?.find(t => t.place === '香港天文台');
    const mainIcon = current?.icon?.[0];
    const weatherInfo = getWeatherIcon(mainIcon);
    const uvData = current?.uvindex?.data?.[0];
    const humidity = current?.humidity?.data?.[0];
    const warnings = current?.warningMessage || [];
    const rainfallData = current?.rainfall?.data || [];
    const rainingPlaces = rainfallData.filter(r => r.max > 0);
    const forecasts = forecast?.weatherForecast || [];

    const activeWarnings = warnSummary ? Object.entries(warnSummary).filter(([k, v]) => v && typeof v === 'object' && v.code) : [];
    const warningDetails = warningInfo?.details || warningInfo || {};

    const tcWarning = activeWarnings.find(([k]) => k === 'WTCSGNL');
    const tcSignalCode = tcWarning ? tcWarning[1]?.subtype || tcWarning[1]?.code : null;
    const tcSignalInfo = tcSignalCode ? TC_SIGNAL_INFO[tcSignalCode] : null;

    const tcTracks = tcTrack?.tropicalCyclone || (Array.isArray(tcTrack) ? tcTrack : []);
    const hasTCActivity = tcSignalInfo || tcTracks.length > 0;

    const swtMessages = swt?.swt || [];

    return (
        <div className="padding-x py-4 max-lg:mt-12 dark:bg-black dark:text-white min-h-screen pb-20">
            <div className="max-w-2xl mx-auto">

                <div className="flex items-baseline justify-between mb-6 px-1">
                    <h2 className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Hong Kong Weather</h2>
                    <button onClick={loadWeather} className="text-[10px] text-gray-400 hover:text-black dark:hover:text-white transition cursor-pointer">
                        <i className="fa-solid fa-sync text-[9px] mr-1" />Refresh
                    </button>
                </div>

                <div className="border-t border-b border-gray-200 dark:border-gray-800 py-8 mb-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="flex items-end gap-2">
                                <span className="text-6xl font-light text-black dark:text-white tabular-nums">{hkoTemp?.value || '--'}</span>
                                <span className="text-2xl text-gray-400 mb-2">°C</span>
                            </div>
                            <p className="text-sm text-gray-500 mt-2">{weatherInfo.desc}</p>
                            {humidity && <p className="text-xs text-gray-400 mt-1">濕度 {humidity.value}%</p>}
                            {uvData && <p className="text-xs text-gray-400">紫外線 {uvData.value} ({uvData.desc})</p>}
                        </div>
                        <div className="text-right">
                            <i className={`fa-solid ${weatherInfo.icon} text-5xl ${weatherInfo.color} opacity-60`} />
                        </div>
                    </div>
                </div>

                {hasTCActivity && (
                    <div className="mb-6">
                        <h3 className="text-[10px] uppercase tracking-wider font-medium mb-3 px-1 flex items-center gap-1.5">
                            <i className="fa-solid fa-hurricane text-red-500" />
                            <span className="text-red-500">Tropical Cyclone</span>
                        </h3>

                        {tcSignalInfo && (
                            <div className={`${tcSignalInfo.bg} rounded-xl px-4 py-3 mb-3 border ${tcSignalInfo.level >= 8 ? 'border-red-400 dark:border-red-700' : 'border-gray-200 dark:border-gray-700'}`}>
                                <div className="flex items-center gap-3">
                                    <div className="text-3xl font-black text-center min-w-[48px]">
                                        <span className={tcSignalInfo.color}>
                                            {tcSignalCode?.replace('TC', '').replace('NE','').replace('SE','').replace('NW','').replace('SW','')}
                                        </span>
                                    </div>
                                    <div>
                                        <p className={`text-sm font-semibold ${tcSignalInfo.color}`}>{tcSignalInfo.signal}</p>
                                        {tcSignalInfo.level >= 8 && (
                                            <p className="text-[11px] text-red-500 dark:text-red-400 mt-0.5 font-medium">
                                                留在室內安全地方，遠離窗戶
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        <TyphoonTrackMap tcData={tcTracks} />
                    </div>
                )}

                {activeWarnings.length > 0 && (
                    <div className="mb-6">
                        <h3 className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-2 px-1">
                            Active Warnings ({activeWarnings.length})
                        </h3>
                        <div className="space-y-2">
                            {activeWarnings.map(([code, detail]) => (
                                <WarningCard
                                    key={code}
                                    code={code}
                                    detail={detail}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {warnings.length > 0 && activeWarnings.length === 0 && (
                    <div className="mb-6">
                        <h3 className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-2 px-1">Warnings</h3>
                        <div className="space-y-1">
                            {warnings.map((w, i) => (
                                <div key={i} className="text-xs text-amber-600 dark:text-amber-400 border-l-2 border-amber-400 pl-3 py-1">{w}</div>
                            ))}
                        </div>
                    </div>
                )}

                {swtMessages.length > 0 && (
                    <div className="mb-6">
                        <h3 className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-2 px-1 flex items-center gap-1.5">
                            <i className="fa-solid fa-circle-exclamation text-amber-500 text-[9px]" />
                            Special Weather Tips
                        </h3>
                        <div className="border border-amber-200 dark:border-amber-800/50 rounded-xl overflow-hidden">
                            {swtMessages.map((tip, i) => (
                                <div key={i} className="px-4 py-3 border-b border-amber-100 dark:border-amber-900/30 last:border-b-0 bg-amber-50/50 dark:bg-amber-950/20">
                                    <p className="text-[12px] leading-[1.8] text-gray-700 dark:text-gray-300">{tip.desc}</p>
                                    {tip.updateTime && (
                                        <p className="text-[10px] text-amber-400 mt-1">{formatTCTime(tip.updateTime)}</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {localForecast && (
                    <div className="mb-6">
                        <h3 className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-2 px-1">Today's Forecast</h3>
                        <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4">
                            <p className="text-[13px] leading-[1.8] text-gray-700 dark:text-gray-300">{localForecast.forecastDesc}</p>
                            {localForecast.outlook && (
                                <p className="text-xs text-gray-400 mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">{localForecast.outlook}</p>
                            )}
                        </div>
                    </div>
                )}

                <div className="mb-6">
                    <h3 className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-2 px-1">9-Day Forecast</h3>
                    <div className="border-t border-gray-200 dark:border-gray-800">
                        {forecasts.map((day, idx) => {
                            const dayIcon = getWeatherIcon(day.ForecastIcon);
                            const isToday = idx === 0;
                            return (
                                <div key={idx} className="flex items-center border-b border-gray-200 dark:border-gray-800 py-3 px-1">
                                    <div className="w-16 shrink-0">
                                        <span className={`text-xs ${isToday ? 'font-semibold text-black dark:text-white' : 'text-gray-500'}`}>
                                            {isToday ? '今日' : day.week}
                                        </span>
                                        <span className="text-[10px] text-gray-400 block">{formatDate(day.forecastDate)}</span>
                                    </div>
                                    <div className="w-8 text-center shrink-0">
                                        <i className={`fa-solid ${dayIcon.icon} ${dayIcon.color} text-sm`} />
                                    </div>
                                    <p className="flex-1 text-xs text-gray-500 dark:text-gray-400 px-3 line-clamp-1">{day.forecastWeather}</p>
                                    <div className="text-right shrink-0 w-20">
                                        <span className="text-xs tabular-nums text-gray-400">{day.forecastMintemp.value}°</span>
                                        <span className="text-gray-300 dark:text-gray-700 mx-1">—</span>
                                        <span className="text-xs tabular-nums font-medium text-black dark:text-white">{day.forecastMaxtemp.value}°</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="mb-6">
                    <h3 className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-2 px-1">
                        Temperature by District
                    </h3>
                    <div className="grid grid-cols-2 gap-px border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                        {(current?.temperature?.data || []).map((t, i) => (
                            <div key={i} className="flex items-center justify-between px-3 py-2 bg-white dark:bg-black">
                                <span className="text-[11px] text-gray-500">{t.place}</span>
                                <span className="text-[11px] font-medium text-black dark:text-white tabular-nums">{t.value}°C</span>
                            </div>
                        ))}
                    </div>
                </div>

                {rainingPlaces.length > 0 && (
                    <div className="mb-6">
                        <h3 className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-2 px-1">Rainfall</h3>
                        <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                            {rainingPlaces.map((r, i) => (
                                <div key={i} className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                                    <span className="text-[11px] text-gray-500">{r.place}</span>
                                    <span className="text-[11px] text-blue-500 font-medium tabular-nums">{r.max} mm</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {forecast?.generalSituation && (
                    <div className="mb-6">
                        <h3 className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-2 px-1">General Situation</h3>
                        <p className="text-[12px] leading-[1.8] text-gray-500 dark:text-gray-400 px-1">{forecast.generalSituation}</p>
                    </div>
                )}

                <div className="text-center py-4">
                    <p className="text-[10px] text-gray-300 dark:text-gray-700">
                        Data from Hong Kong Observatory
                        {current?.updateTime && ` · Updated ${new Date(current.updateTime).toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' })}`}
                    </p>
                </div>
            </div>
        </div>
    );
}
