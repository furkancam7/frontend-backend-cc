export const createGeoJSONCircle = (center, radiusInKm, points = 32) => {
  const coords = {
    latitude: center[1],
    longitude: center[0]
  };
  const km = radiusInKm;
  const ret = [];
  const distanceX = km / (111.320 * Math.cos(coords.latitude * Math.PI / 180));
  const distanceY = km / 110.574;

  let theta, x, y;
  for (let i = 0; i < points; i++) {
    theta = (i / points) * (2 * Math.PI);
    x = distanceX * Math.cos(theta);
    y = distanceY * Math.sin(theta);
    ret.push([coords.longitude + x, coords.latitude + y]);
  }
  ret.push(ret[0]);

  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [ret]
    }
  };
};

export const getThreatColor = (className) => {
  const cls = (className || '').toLowerCase();
  if (cls === 'person') return { 
    border: 'border-red-500', 
    text: 'text-red-400',
    dot: 'bg-red-400',
    labelBorder: 'border-red-900' 
  };
  if (['car', 'truck', 'motorcycle', 'bicycle', 'bus', 'horse', 'camel'].includes(cls)) return { 
    border: 'border-yellow-500', 
    text: 'text-yellow-400',
    dot: 'bg-yellow-400',
    labelBorder: 'border-yellow-900' 
  };
  return { 
    border: 'border-green-500', 
    text: 'text-green-400',
    dot: 'bg-green-400',
    labelBorder: 'border-green-900' 
  };
};
