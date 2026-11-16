import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import StepsView from './StepsView.jsx';
import BloodPressureView from './BloodPressureView.jsx';
import MedicineView from './MedicineView.jsx';
import HealthOverview from './HealthOverview.jsx';
import FoodView from './FoodView.jsx';
import SleepView from './SleepView.jsx';

const TABS = [
  { key: 'overview', label: 'Overview', icon: 'fa-solid fa-chart-line' },
  { key: 'food', label: 'Food', icon: 'fa-solid fa-utensils' },
  { key: 'steps', label: 'Steps', icon: 'fa-solid fa-shoe-prints' },
  { key: 'bp', label: 'BP', icon: 'fa-solid fa-heart-pulse' },
  { key: 'sleep', label: 'Sleep', icon: 'fa-solid fa-moon' },
  { key: 'medicine', label: 'Medicine', icon: 'fa-solid fa-pills' },
  { key: 'distance', label: 'Distance', icon: 'fa-solid fa-route' },
  { key: 'walktime', label: 'Walk Time', icon: 'fa-solid fa-stopwatch' },
  { key: 'remarks', label: 'Remarks', icon: 'fa-solid fa-pen-clip' },
];

export default function HealthView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = TABS.some(t => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t && TABS.some(x => x.key === t) && t !== activeTab) setActiveTab(t);
  }, [searchParams]);

  const selectTab = (key) => {
    setActiveTab(key);
    setSearchParams(prev => {
      if (key === 'overview') prev.delete('tab');
      else prev.set('tab', key);
      return prev;
    }, { replace: true });
  };

  return (
    <div className="padding-x py-4 max-lg:mt-12 dark:bg-black dark:text-white min-h-screen pb-20">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-baseline justify-between mb-3 px-1">
          <h2 className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-2">
            <i className="fa-solid fa-heart text-pink-400" />
            Health
          </h2>
        </div>

        <div className="flex items-center gap-1 mb-4 overflow-x-auto no-scrollbar">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => selectTab(tab.key)}
              className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg whitespace-nowrap transition cursor-pointer ${
                activeTab === tab.key
                  ? 'bg-black text-white dark:bg-white dark:text-black font-semibold'
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <i className={`${tab.icon} text-[10px]`} />
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && <HealthOverview />}
        {activeTab === 'food' && <FoodView />}
        {activeTab === 'steps' && <StepsPanel />}
        {activeTab === 'bp' && <BPPanel />}
        {activeTab === 'sleep' && <SleepView embedded />}
        {activeTab === 'medicine' && <MedicinePanel />}
        {activeTab === 'distance' && <DistancePanel />}
        {activeTab === 'walktime' && <WalkTimePanel />}
        {activeTab === 'remarks' && <RemarksPanel />}
      </div>
    </div>
  );
}

function StepsPanel() {
  return <StepsView embedded />;
}

function BPPanel() {
  return <BloodPressureView embedded />;
}

function MedicinePanel() {
  return <MedicineView embedded />;
}

function DistancePanel() {
  return <StepsView embedded filterField="distance" />;
}

function WalkTimePanel() {
  return <StepsView embedded filterField="walkTime" />;
}

function RemarksPanel() {
  return <StepsView embedded filterField="remarks" />;
}
