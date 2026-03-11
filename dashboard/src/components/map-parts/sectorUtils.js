
export const SOLO_ZONE_CONFIG = {
  sensor: {
    angle: 120,
    radius: 30, 
    color: '#22c55e', 
    fillOpacity: 0.15,
    outlineOpacity: 0.6,
    outlineWidth: 2
  },
  detection: {
    angle: 70,
    radius: 120, 
    color: '#3b82f6', 
    fillOpacity: 0.1,
    outlineOpacity: 0.5,
    outlineWidth: 1.5
  }
};

const metersToDegreesAtLatitude = (meters, latitude) => {
  const metersPerDegreeLat = 111320; 
  const metersPerDegreeLng = 111320 * Math.cos((latitude * Math.PI) / 180);
  
  return {
    latDegrees: meters / metersPerDegreeLat,
    lngDegrees: meters / metersPerDegreeLng
  };
};

export const createSectorPolygon = (center, direction, angle, radius, segments = 24) => {
  if (!center || center.length !== 2) {
    console.warn('[sectorUtils] Invalid center coordinates');
    return [];
  }
  
  const [lng, lat] = center;
  const { latDegrees, lngDegrees } = metersToDegreesAtLatitude(radius, lat);
  const directionRad = ((90 - direction) * Math.PI) / 180;
  const halfAngleRad = (angle / 2) * Math.PI / 180;
  const points = [];
  points.push([lng, lat]);
  const startAngle = directionRad - halfAngleRad;
  const endAngle = directionRad + halfAngleRad;
  
  for (let i = 0; i <= segments; i++) {
    const currentAngle = startAngle + (endAngle - startAngle) * (i / segments);
    const x = Math.cos(currentAngle) * lngDegrees;
    const y = Math.sin(currentAngle) * latDegrees;
    points.push([lng + x, lat + y]);
  }
  
  points.push([lng, lat]);
  
  return points;
};

export const createSectorFeature = (center, direction, angle, radius, properties = {}) => {
  const coordinates = createSectorPolygon(center, direction, angle, radius);
  
  if (coordinates.length < 4) {
    return null;
  }
  
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [coordinates]
    },
    properties: {
      ...properties,
      direction,
      angle,
      radius
    }
  };
};


export const createSoloZonesGeoJSON = (devices, zoneType, allConfigs = null) => {
  const defaultConfig = SOLO_ZONE_CONFIG[zoneType];
  if (!defaultConfig) {
    console.warn(`[sectorUtils] Unknown zone type: ${zoneType}`);
    return { type: 'FeatureCollection', features: [] };
  }
  
  const isPerDeviceConfig = allConfigs && (allConfigs['default'] || Object.keys(allConfigs).some(k => k.startsWith('SOLO')));
  
  const features = [];
  
  devices.forEach(device => {
    if (!device.location?.latitude || !device.location?.longitude) return;
    
    let deviceZoneConfig;
    if (isPerDeviceConfig) {
      const deviceConfig = allConfigs[device.id] || allConfigs['default'] || {};
      deviceZoneConfig = deviceConfig[zoneType] ? { ...defaultConfig, ...deviceConfig[zoneType] } : defaultConfig;
      var defaultHeading = deviceConfig.defaultHeading ?? 0;
    } else {
      deviceZoneConfig = allConfigs ? { ...defaultConfig, ...allConfigs } : defaultConfig;
      var defaultHeading = allConfigs?.defaultHeading ?? 0;
    }
    
    if (deviceZoneConfig.enabled === false) {
      return; 
    }
    
    const direction = device.direction ?? device.raw?.direction ?? defaultHeading;
    const center = [device.location.longitude, device.location.latitude];
    const feature = createSectorFeature(
      center,
      direction,
      deviceZoneConfig.angle,
      deviceZoneConfig.radius,
      {
        deviceId: device.id,
        zoneType,
        color: deviceZoneConfig.color
      }
    );
    
    if (feature) {
      features.push(feature);
    }
  });
  
  return {
    type: 'FeatureCollection',
    features
  };
};

export const getZonePaintProperties = (zoneType) => {
  const config = SOLO_ZONE_CONFIG[zoneType];
  if (!config) return {};
  
  return {
    fill: {
      'fill-color': config.color,
      'fill-opacity': config.fillOpacity
    },
    outline: {
      'line-color': config.color,
      'line-width': config.outlineWidth,
      'line-opacity': config.outlineOpacity
    }
  };
};

export default {
  SOLO_ZONE_CONFIG,
  createSectorPolygon,
  createSectorFeature,
  createSoloZonesGeoJSON,
  getZonePaintProperties
};
