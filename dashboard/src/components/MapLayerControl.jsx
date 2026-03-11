import React, { useState, useRef, useEffect, useCallback, memo, useId } from 'react';

const STYLES = [
  { id: 'satellite', name: 'Satellite', url: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'dark', name: 'Dark Mode', url: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'navigation', name: 'Navigation', url: 'mapbox://styles/mapbox/navigation-night-v1' },
  { id: 'outdoors', name: 'Terrain', url: 'mapbox://styles/mapbox/outdoors-v12' },
  { id: 'light', name: 'Light', url: 'mapbox://styles/mapbox/light-v11' },
];

const MapIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 7m0 13V7m0 0L9.553 4.553A1 1 0 009 7" />
  </svg>
);

const ChevronIcon = ({ isOpen }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const MapLayerControl = memo(({ currentStyle, onStyleChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const menuId = useId();
  const containerRef = useRef(null);
  const itemsRef = useRef([]);

  useEffect(() => {
    const handleOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('pointerdown', handleOutside);
      document.addEventListener('keydown', handleEsc);
    }
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const idx = STYLES.findIndex(s => s.url === currentStyle);
      setFocusedIndex(idx !== -1 ? idx : 0);
    } else {
      itemsRef.current = [];
    }
  }, [isOpen, currentStyle]);

  useEffect(() => {
    if (isOpen && itemsRef.current[focusedIndex]) {
      requestAnimationFrame(() => {
        itemsRef.current[focusedIndex]?.focus();
      });
    }
  }, [isOpen, focusedIndex]);

  const activeStyleName = STYLES.find(s => s.url === currentStyle)?.name || 'Select Map';

  const handleOptionClick = useCallback((e) => {
    const url = e.currentTarget.dataset.url;
    if (url) {
      try {
        onStyleChange(url);
      } finally {
        setIsOpen(false);
      }
    }
  }, [onStyleChange]);

  const handleMenuKeyDown = useCallback((e) => {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        setFocusedIndex(prev => (prev + 1) % STYLES.length);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        setFocusedIndex(prev => (prev - 1 + STYLES.length) % STYLES.length);
        break;
      }
      case 'Home': {
        e.preventDefault();
        setFocusedIndex(0);
        break;
      }
      case 'End': {
        e.preventDefault();
        setFocusedIndex(STYLES.length - 1);
        break;
      }
    }
  }, []);

  return (
    <div ref={containerRef} className="absolute top-4 right-4 z-50 flex flex-col items-end pointer-events-auto font-sans">
      <button
        type="button"
        onClick={() => setIsOpen(v => !v)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={menuId}
        className="flex items-center gap-2 bg-zinc-950/90 backdrop-blur border border-zinc-800 
                   text-xs text-gray-200 px-3 py-1.5 rounded hover:border-cyan-500/50 transition-all shadow-lg group"
      >
        <MapIcon />
        <span className="font-medium group-hover:text-cyan-50 transition-colors">{activeStyleName}</span>
        <ChevronIcon isOpen={isOpen} />
      </button>

      {isOpen && (
        <div
          id={menuId}
          role="menu"
          aria-label="Map style"
          onKeyDown={handleMenuKeyDown}
          className="mt-1 w-40 bg-zinc-950/95 backdrop-blur border border-zinc-800 rounded shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-right"
        >
          {STYLES.map((style, index) => (
            <button
              key={style.id}
              ref={el => itemsRef.current[index] = el}
              role="menuitemradio"
              aria-checked={currentStyle === style.url}
              tabIndex={focusedIndex === index ? 0 : -1}
              data-url={style.url}
              onClick={handleOptionClick}
              className={`w-full text-left px-3 py-2 text-[11px] hover:bg-zinc-900 transition-colors flex items-center justify-between outline-none focus:bg-zinc-800 focus:text-cyan-400
                ${currentStyle === style.url ? 'text-cyan-400 bg-cyan-950/20' : 'text-gray-400'}
              `}
            >
              {style.name}
              {currentStyle === style.url && (
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-500"></div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default MapLayerControl;
