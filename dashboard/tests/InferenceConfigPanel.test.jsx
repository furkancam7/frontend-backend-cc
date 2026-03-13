import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import InferenceConfigPanel from '../src/components/InferenceConfigPanel';

const apiMock = vi.hoisted(() => ({
  getInferenceConfig: vi.fn(),
  publishInferenceConfig: vi.fn(),
}));

vi.mock('../src/services/api', () => ({
  default: apiMock,
}));

describe('InferenceConfigPanel', () => {
  it('blocks publish when deviceId is not a canonical string', async () => {
    render(
      <InferenceConfigPanel
        deviceId={{ id: 'TOWER-001' }}
        deviceStatus="online"
        mqttOk
        isActive
      />
    );

    expect(await screen.findByText(/Invalid device selection/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Publish Inference Config/i })).toBeDisabled();
    expect(apiMock.getInferenceConfig).not.toHaveBeenCalled();
  });
});
