import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from './app-store';

beforeEach(() => {
  useAppStore.setState({ tourActive: false, tourStep: 0 });
});

describe('onboarding store slice', () => {
  it('startTour activates the tour at step 0', () => {
    useAppStore.setState({ tourActive: false, tourStep: 3 });
    useAppStore.getState().startTour();
    expect(useAppStore.getState().tourActive).toBe(true);
    expect(useAppStore.getState().tourStep).toBe(0);
  });

  it('endTour deactivates the tour and resets the step', () => {
    useAppStore.setState({ tourActive: true, tourStep: 3 });
    useAppStore.getState().endTour();
    expect(useAppStore.getState().tourActive).toBe(false);
    expect(useAppStore.getState().tourStep).toBe(0);
  });

  it('nextStep advances the step index', () => {
    useAppStore.getState().nextStep();
    expect(useAppStore.getState().tourStep).toBe(1);
  });

  it('prevStep decrements but clamps at 0', () => {
    useAppStore.setState({ tourStep: 1 });
    useAppStore.getState().prevStep();
    expect(useAppStore.getState().tourStep).toBe(0);
    useAppStore.getState().prevStep();
    expect(useAppStore.getState().tourStep).toBe(0);
  });
});
