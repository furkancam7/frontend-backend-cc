export const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export const calculateETA = (distanceKm, speedKmh = 50, batteryPct = 100) => {
  const etaHours = distanceKm / speedKmh;
  const etaMinutes = etaHours * 60;
  const etaSeconds = etaMinutes * 60;
  const roundTripKm = distanceKm * 2;
  const maxFlightMinutes = (batteryPct / 100) * 30;
  const maxRangeKm = (maxFlightMinutes / 60) * speedKmh;
  const isReachable = roundTripKm <= maxRangeKm;

  let etaFormatted;
  if (etaSeconds < 60) {
    etaFormatted = `${Math.round(etaSeconds)}s`;
  } else if (etaMinutes < 60) {
    const mins = Math.floor(etaMinutes);
    const secs = Math.round((etaMinutes - mins) * 60);
    etaFormatted = secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  } else {
    const hrs = Math.floor(etaHours);
    const mins = Math.round((etaHours - hrs) * 60);
    etaFormatted = `${hrs}h ${mins}m`;
  }

  return { etaMinutes, etaFormatted, roundTripKm, isReachable, maxRangeKm, distanceKm };
};

const normalizeWeight = (val) => {
  if (val == null || val === 0) return 0.5;
  if (val > 1) return Math.min(val / 100, 1);
  return val;
};

export const createHeatmapGeoJSON = (detections) => {
  const features = detections
    .filter(d => d.location?.latitude && d.location?.longitude)
    .map(d => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [d.location.longitude, d.location.latitude]
      },
      properties: {
        weight: normalizeWeight(d.accuracy ?? d.confidence),
        class: d.class || d.class_name || 'unknown'
      }
    }));
  return { type: 'FeatureCollection', features };
};

export const createETALineGeoJSON = (hqLat, hqLng, targetLat, targetLng, isReachable) => {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[hqLng, hqLat], [targetLng, targetLat]]
      },
      properties: { reachable: isReachable }
    }]
  };
};

export const getMidpoint = (lat1, lng1, lat2, lng2) => ({
  lat: (lat1 + lat2) / 2,
  lng: (lng1 + lng2) / 2
});

export const spreadOverlappingDetections = (crops, radiusMeters = 30) => {
  const offsets = new Map();
  const groups = {};
  const precision = 4; 
  crops.forEach(c => {
    if (!c.location?.latitude || !c.location?.longitude) return;
    const key = `${c.location.latitude.toFixed(precision)},${c.location.longitude.toFixed(precision)}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  });

  Object.values(groups).forEach(group => {
    if (group.length <= 1) return; 
    const centerLat = group[0].location.latitude;
    const latOffset = radiusMeters / 111320;
    const lngOffset = radiusMeters / (111320 * Math.cos(centerLat * Math.PI / 180));
    group.forEach((crop, i) => {
      const angle = (2 * Math.PI * i) / group.length;
      offsets.set(crop.crop_id, {
        lng: crop.location.longitude + lngOffset * Math.cos(angle),
        lat: crop.location.latitude + latOffset * Math.sin(angle)
      });
    });
  });

  return offsets;
};
