import React from 'react';

export default function ETAInfoPanel({ distance, eta, isReachable, maxRange }) {
  return (
    <div style={{
      background: 'rgba(10,10,10,0.95)',
      border: `1px solid ${isReachable ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)'}`,
      borderRadius: '8px',
      padding: '10px 14px',
      minWidth: '180px',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '11px',
      color: '#e4e4e7'
    }}>
      <div style={{
        fontSize: '9px',
        color: '#71717a',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        marginBottom: '8px',
        fontWeight: 700
      }}>
        Response Analysis
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <Row label="Distance" value={`${distance.toFixed(2)} km`} />
        <Row label="ETA" value={eta} />
        <Row label="Max Range" value={`${maxRange.toFixed(1)} km`} />
        <Row
          label="Status"
          value={isReachable ? 'REACHABLE' : 'OUT OF RANGE'}
          valueColor={isReachable ? '#4ade80' : '#f87171'}
        />
      </div>
    </div>
  );
}

function Row({ label, value, valueColor = '#ffffff' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
      <span style={{ color: '#9ca3af' }}>{label}</span>
      <span style={{ color: valueColor, fontWeight: 600 }}>{value}</span>
    </div>
  );
}
