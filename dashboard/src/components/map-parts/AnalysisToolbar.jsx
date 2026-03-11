import React, { memo } from 'react';

const AnalysisToolbar = memo(({
  showHeatmap,
  showHistory,
  onToggleHeatmap,
  onToggleHistory
}) => {
  return (
    <div className="absolute bottom-20 right-4 z-[100]">
      <div className="bg-black/80 backdrop-blur-sm rounded-lg sm:rounded-xl p-1.5 sm:p-2 flex gap-1.5 sm:gap-2 shadow-2xl shadow-black/50 border border-gray-700/50">
        <AnalysisButton
          label="DENSITY"
          iconType="fire"
          active={showHeatmap}
          onClick={onToggleHeatmap}
          activeColor="border-orange-500 text-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.4)]"
        />
        <AnalysisButton
          label="HISTORY"
          iconType="history"
          active={showHistory}
          onClick={onToggleHistory}
          activeColor="border-cyan-500 text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.4)]"
        />
      </div>
    </div>
  );
});
AnalysisToolbar.displayName = 'AnalysisToolbar';

function AnalysisButton({ label, iconType, active, onClick, activeColor }) {
  const baseClass = 'w-12 h-11 sm:w-16 sm:h-14 rounded-md sm:rounded-lg flex flex-col items-center justify-center gap-0.5 sm:gap-1 transition-all duration-200 cursor-pointer select-none';
  const stateClass = active
    ? `bg-gray-900/80 border ${activeColor}`
    : 'bg-black/40 border border-gray-700/50 text-gray-500 hover:text-white hover:border-gray-500';

  return (
    <button onClick={onClick} className={`${baseClass} ${stateClass}`} title={label}>
      <AnalysisIcon type={iconType} />
      <span className="text-[6px] sm:text-[7px] font-bold uppercase tracking-wider leading-none">{label}</span>
    </button>
  );
}

function AnalysisIcon({ type }) {
  const paths = {
    fire: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z',
    history: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
  };
  return (
    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={paths[type]} />
    </svg>
  );
}

export default AnalysisToolbar;
