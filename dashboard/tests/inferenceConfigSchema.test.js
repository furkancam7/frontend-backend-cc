import { describe, expect, it } from 'vitest';

import { buildInferencePatch, toInferenceFormState } from '../src/constants/inferenceConfig';

describe('inference config schema helpers', () => {
  it('serializes CLASSES into editable JSON text', () => {
    const formState = toInferenceFormState({
      CLASSES: ['smoke', 'fire'],
      CONFIDENCE: 0.25,
    });

    expect(formState.CLASSES).toContain('smoke');
    expect(formState.CONFIDENCE).toBe('0.25');
  });

  it('rejects invalid JSON array and ratio overflow', () => {
    const result = buildInferencePatch(
      { CONFIDENCE: 0.25, CLASSES: [] },
      {
        ...toInferenceFormState({ CONFIDENCE: 0.25, CLASSES: [] }),
        CONFIDENCE: '1.2',
        CLASSES: '{"broken":true}',
      }
    );

    expect(result.errors.CONFIDENCE).toContain('<= 1');
    expect(result.errors.CLASSES).toContain('JSON array');
  });
});
