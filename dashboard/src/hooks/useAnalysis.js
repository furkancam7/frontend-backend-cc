import { useState, useCallback } from 'react';

export default function useAnalysis() {
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const toggleHeatmap = useCallback(() => setShowHeatmap(p => !p), []);
  const toggleHistory = useCallback(() => setShowHistory(p => !p), []);

  const clearAnalysis = useCallback(() => {
    setShowHeatmap(false);
    setShowHistory(false);
  }, []);

  return {
    showHeatmap,
    showHistory,
    toggleHeatmap,
    toggleHistory,
    clearAnalysis
  };
}
