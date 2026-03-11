export const INFERENCE_STATUS_CLASS = {
  applied: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  pending: 'text-yellow-300 border-yellow-500/40 bg-yellow-500/10',
  rejected: 'text-red-300 border-red-500/40 bg-red-500/10',
  duplicate: 'text-yellow-200 border-yellow-500/40 bg-yellow-500/10',
  rolled_back: 'text-orange-300 border-orange-500/40 bg-orange-500/10',
  rollback_failed: 'text-red-200 border-red-500/40 bg-red-500/10',
  timed_out: 'text-orange-300 border-orange-500/40 bg-orange-500/10',
  publish_failed: 'text-red-200 border-red-500/40 bg-red-500/10',
  none: 'text-gray-300 border-gray-700 bg-gray-800/40',
};

export const INFERENCE_FIELD_META = {
  NVIDIA_DRIVER_CAPABILITIES: { label: 'NVIDIA Driver Capabilities', type: 'text' },
  MODEL_PATH: { label: 'Model Path', type: 'text' },
  CAMERA_URL: { label: 'Camera URL', type: 'text' },
  PAYLOAD_DIR: { label: 'Payload Dir', type: 'text' },
  TOWER_ID: { label: 'Tower ID', type: 'text' },
  MODEL_NAME: { label: 'Model Name', type: 'text' },
  CONFIDENCE: { label: 'Confidence', type: 'float', min: 0, max: 1, step: 0.01 },
  DEVICE: { label: 'Device', type: 'text' },
  IMGSZ: { label: 'Imgsz', type: 'int', min: 0, step: 1 },
  CLASSES: { label: 'Classes', type: 'array' },
  TRACKER_CONFIG: { label: 'Tracker Config', type: 'text' },
  TEMPORAL_WINDOW_SEC: { label: 'Temporal Window Sec', type: 'float', min: 0, step: 0.1 },
  TEMPORAL_RATIO: { label: 'Temporal Ratio', type: 'float', min: 0, max: 1, step: 0.01 },
  DRIFT_BASE: { label: 'Drift Base', type: 'float', min: 0, step: 0.1 },
  DRIFT_SCALE: { label: 'Drift Scale', type: 'float', min: 0, step: 0.01 },
  MIN_EXPANSION_RATE: { label: 'Min Expansion Rate', type: 'float', min: 0, step: 0.001 },
  STATIC_AREA_CV: { label: 'Static Area CV', type: 'float', min: 0, max: 1, step: 0.001 },
  VERTICAL_GROWTH_RATIO: { label: 'Vertical Growth Ratio', type: 'float', min: 0, max: 1, step: 0.01 },
  ALARM_COOLDOWN_SEC: { label: 'Alarm Cooldown Sec', type: 'float', min: 0, step: 0.1 },
  VIDEO_ENABLED: { label: 'Video Enabled', type: 'boolean' },
  VIDEO_DIR: { label: 'Video Dir', type: 'text' },
  VIDEO_FPS: { label: 'Video FPS', type: 'int', min: 0, step: 1 },
  VIDEO_SEGMENT_MIN: { label: 'Video Segment Min', type: 'int', min: 0, step: 1 },
};

export const INFERENCE_FIELD_GROUPS = [
  {
    id: 'runtime',
    label: 'Runtime',
    fields: ['NVIDIA_DRIVER_CAPABILITIES', 'DEVICE', 'PAYLOAD_DIR', 'TOWER_ID', 'VIDEO_ENABLED', 'VIDEO_DIR'],
  },
  {
    id: 'model',
    label: 'Model',
    fields: ['MODEL_PATH', 'MODEL_NAME', 'TRACKER_CONFIG', 'IMGSZ', 'CLASSES'],
  },
  {
    id: 'camera',
    label: 'Camera',
    fields: ['CAMERA_URL'],
  },
  {
    id: 'detection',
    label: 'Detection',
    fields: [
      'CONFIDENCE',
      'TEMPORAL_WINDOW_SEC',
      'TEMPORAL_RATIO',
      'DRIFT_BASE',
      'DRIFT_SCALE',
      'MIN_EXPANSION_RATE',
      'STATIC_AREA_CV',
      'VERTICAL_GROWTH_RATIO',
      'ALARM_COOLDOWN_SEC',
      'VIDEO_FPS',
      'VIDEO_SEGMENT_MIN',
    ],
  },
];

const RATIO_FIELDS = new Set(['CONFIDENCE', 'TEMPORAL_RATIO', 'STATIC_AREA_CV', 'VERTICAL_GROWTH_RATIO']);

const areEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export const toInferenceFormState = (settings = {}) => Object.entries(INFERENCE_FIELD_META).reduce((acc, [field, meta]) => {
  const value = settings[field];
  if (meta.type === 'boolean') {
    acc[field] = value === undefined || value === null ? null : value === true;
  } else if (meta.type === 'array') {
    acc[field] = value === undefined || value === null
      ? ''
      : JSON.stringify(Array.isArray(value) ? value : [], null, 2);
  } else if (meta.type === 'int' || meta.type === 'float') {
    acc[field] = value === undefined || value === null ? '' : String(value);
  } else {
    acc[field] = value ?? '';
  }
  return acc;
}, {});

const parseNumber = (field, rawValue, meta) => {
  if (rawValue === '') {
    return { empty: true };
  }
  const numericValue = Number(rawValue);
  if (Number.isNaN(numericValue)) {
    return { error: 'Invalid number' };
  }
  if (meta.type === 'int' && !Number.isInteger(numericValue)) {
    return { error: 'Must be an integer' };
  }
  if (meta.min !== undefined && numericValue < meta.min) {
    return { error: `Must be >= ${meta.min}` };
  }
  if (meta.max !== undefined && numericValue > meta.max) {
    return { error: `Must be <= ${meta.max}` };
  }
  if (RATIO_FIELDS.has(field) && (numericValue < 0 || numericValue > 1)) {
    return { error: 'Must be between 0 and 1' };
  }
  return { value: numericValue };
};

export const buildInferencePatch = (baseSettings = {}, formState = {}) => {
  const patch = {};
  const errors = {};
  const normalizedValues = {};

  Object.entries(INFERENCE_FIELD_META).forEach(([field, meta]) => {
    const rawValue = formState[field];
    if (meta.type === 'boolean') {
      if (rawValue === null && baseSettings[field] === undefined) {
        return;
      }
      normalizedValues[field] = rawValue === true;
      if (!areEqual(baseSettings[field], normalizedValues[field])) {
        patch[field] = normalizedValues[field];
      }
      return;
    }

    if (meta.type === 'array') {
      if ((!rawValue || !rawValue.trim()) && baseSettings[field] === undefined) {
        return;
      }
      try {
        const parsed = rawValue?.trim() ? JSON.parse(rawValue) : [];
        if (!Array.isArray(parsed)) {
          errors[field] = 'Must be a JSON array';
          return;
        }
        normalizedValues[field] = parsed;
        if (!areEqual(baseSettings[field] ?? [], parsed)) {
          patch[field] = parsed;
        }
      } catch {
        errors[field] = 'Invalid JSON array';
      }
      return;
    }

    if (meta.type === 'int' || meta.type === 'float') {
      const result = parseNumber(field, rawValue, meta);
      if (result.empty && baseSettings[field] === undefined) {
        return;
      }
      if (result.empty) {
        errors[field] = 'This field cannot be empty';
        return;
      }
      if (result.error) {
        errors[field] = result.error;
        return;
      }
      normalizedValues[field] = result.value;
      if (!areEqual(baseSettings[field], result.value)) {
        patch[field] = result.value;
      }
      return;
    }

    if ((rawValue ?? '') === '' && baseSettings[field] === undefined) {
      return;
    }
    normalizedValues[field] = rawValue ?? '';
    if (!areEqual(baseSettings[field] ?? '', normalizedValues[field])) {
      patch[field] = normalizedValues[field];
    }
  });

  return {
    patch,
    errors,
    changedKeys: Object.keys(patch),
    normalizedValues,
  };
};

export const formatStatusLabel = (value) => {
  if (!value) return 'UNKNOWN';
  return String(value).replace(/_/g, ' ').toUpperCase();
};
