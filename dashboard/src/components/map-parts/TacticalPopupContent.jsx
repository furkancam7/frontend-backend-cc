import React, { useState, useEffect, useCallback } from 'react';
import { getThreatColor } from './mapUtils';
import { useUiTranslation } from '../../i18n/useUiTranslation';

const THREAT_HEX = {
  person: '#ef4444',
  vehicle: '#eab308',
  default: '#22c55e'
};

const getThreatHex = (className) => {
  const cls = (className || '').toLowerCase();
  if (cls === 'person') return THREAT_HEX.person;
  if (['car', 'truck', 'motorcycle', 'bicycle', 'bus', 'horse', 'camel'].includes(cls)) return THREAT_HEX.vehicle;
  return THREAT_HEX.default;
};

const TacticalPopupContent = ({ crop, isAdmin }) => {
  const { t } = useUiTranslation(['mapPopup']);
  const [editState, setEditState] = useState({ field: null, value: '' });
  const [imageError, setImageError] = useState(false);
  const cropId = crop?.crop_id;
  useEffect(() => {
    setImageError(false);
    setEditState({ field: null, value: '' });
  }, [cropId]);

  const className = crop?.class || t('mapPopup.unknown');
  const accuracy = crop?.accuracy ?? 0;
  const lat = crop?.location?.latitude;
  const lng = crop?.location?.longitude;
  const recordId = crop?.record_id;
  const threatHex = getThreatHex(className);
  const threatColors = getThreatColor(className);
  const startEdit = useCallback((field, currentValue) => {
    if (!isAdmin) return;
    setEditState({ field, value: String(currentValue) });
  }, [isAdmin]);

  const cancelEdit = useCallback(() => {
    setEditState({ field: null, value: '' });
  }, []);

  const handleUpdate = useCallback(async (field) => {
    const value = editState.value.trim();
    if (!value || !cropId) {
      cancelEdit();
      return;
    }

    const payload = field === 'class' 
      ? { class: value } 
      : { confidence: parseFloat(value) };

    if (field === 'accuracy' && !Number.isFinite(payload.confidence)) {
      cancelEdit();
      return;
    }

    try {
      const res = await fetch(`/api/crop/${cropId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) console.error('Update failed:', res.status);
    } catch (e) {
      console.error('Update error:', e);
    } finally {
      cancelEdit();
    }
  }, [cropId, editState.value, cancelEdit]);

  const handleKeyDown = useCallback((e, field) => {
    if (e.key === 'Enter') handleUpdate(field);
    if (e.key === 'Escape') cancelEdit();
  }, [handleUpdate, cancelEdit]);

  if (!crop) return null;

  return (
    <div 
      className={`tactical-box ${threatColors.border}`} 
      style={{ borderColor: threatHex }}
    >
      <div className="tactical-header">
        {editState.field === 'class' ? (
          <input
            autoFocus
            value={editState.value}
            onChange={e => setEditState(s => ({ ...s, value: e.target.value }))}
            onBlur={() => handleUpdate('class')}
            onKeyDown={e => handleKeyDown(e, 'class')}
            className="bg-black text-cyan-400 border border-cyan-500 w-24 text-xs outline-none uppercase font-bold"
            aria-label={t('mapPopup.editClassName')}
          />
        ) : (
          <span
            className={`tactical-id ${isAdmin ? 'cursor-pointer hover:text-white' : ''}`}
            onClick={() => startEdit('class', className)}
            role={isAdmin ? 'button' : undefined}
            tabIndex={isAdmin ? 0 : undefined}
            onKeyDown={isAdmin ? (e) => e.key === 'Enter' && startEdit('class', className) : undefined}
          >
            {className.toUpperCase()} {isAdmin && ''}
          </span>
        )}
        <span className="tactical-status">{t('mapPopup.tracking')}</span>
      </div>

      <div className="tactical-image-container">
        {!imageError && cropId ? (
          <img
            src={`/api/image/crop/${cropId}`}
            className="tactical-image"
            onError={() => setImageError(true)}
            alt={`${className} ${t('mapPopup.detection')}`}
          />
        ) : (
          <div className="no-image">{t('mapPopup.noSignal')}</div>
        )}
        <div className="tactical-overlay" />
      </div>

      <div className="tactical-footer">
        <div className="flex items-center gap-1">
          {t('mapPopup.acc')}:
          {editState.field === 'accuracy' ? (
            <input
              autoFocus
              type="number"
              value={editState.value}
              onChange={e => setEditState(s => ({ ...s, value: e.target.value }))}
              onBlur={() => handleUpdate('accuracy')}
              onKeyDown={e => handleKeyDown(e, 'accuracy')}
              className="bg-black text-white border border-cyan-500 w-12 text-[9px] outline-none"
              aria-label={t('mapPopup.editAccuracy')}
            />
          ) : (
            <span
              className={`value ${isAdmin ? 'cursor-pointer hover:text-white' : ''}`}
              onClick={() => startEdit('accuracy', accuracy)}
              role={isAdmin ? 'button' : undefined}
              tabIndex={isAdmin ? 0 : undefined}
            >
              {accuracy}% {isAdmin && ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {t('mapPopup.id')}: <span className="value">{recordId ? recordId.slice(0, 12) : t('mapPopup.unk')}</span>
        </div>
      </div>

      <div className="tactical-coords">
        <div>{t('mapPopup.sensorLat')}: <span className="value">{lat != null ? lat.toFixed(5) : t('mapPopup.na')}</span></div>
        <div>{t('mapPopup.sensorLng')}: <span className="value">{lng != null ? lng.toFixed(5) : t('mapPopup.na')}</span></div>
      </div>
    </div>
  );
};

export default TacticalPopupContent;
