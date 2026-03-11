import { describe, expect, it } from 'vitest';

import { buildInferencePatch, toInferenceFormState } from '../src/constants/inferenceConfig';

describe('inference config diff builder', () => {
  it('returns only changed keys', () => {
    const base = {
      CONFIDENCE: 0.25,
      VIDEO_ENABLED: false,
      CLASSES: [],
    };
    const formState = {
      ...toInferenceFormState(base),
      CONFIDENCE: '0.35',
      VIDEO_ENABLED: true,
    };

    const result = buildInferencePatch(base, formState);

    expect(result.changedKeys).toEqual(['CONFIDENCE', 'VIDEO_ENABLED']);
    expect(result.patch).toEqual({
      CONFIDENCE: 0.35,
      VIDEO_ENABLED: true,
    });
  });

  it('returns no diff when values are unchanged', () => {
    const base = {
      TEMPORAL_RATIO: 0.6,
      VIDEO_ENABLED: true,
      CLASSES: [],
    };

    const result = buildInferencePatch(base, toInferenceFormState(base));

    expect(result.changedKeys).toEqual([]);
    expect(result.patch).toEqual({});
    expect(result.errors).toEqual({});
  });
});
