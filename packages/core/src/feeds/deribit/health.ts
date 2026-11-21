import type { VenueHealthContext } from '@oggregator/protocol';
import type { DeribitPlatformState, DeribitPublicStatus } from './types.js';

export interface DeribitHealthState {
  lockedPriceIndexes: Set<string>;
  platformMaintenance: boolean;
  publicStatus: DeribitPublicStatus | null;
  publicStatusError: string | null;
}

export function createDeribitHealthState(): DeribitHealthState {
  return {
    lockedPriceIndexes: new Set(),
    platformMaintenance: false,
    publicStatus: null,
    publicStatusError: null,
  };
}

export function applyDeribitPlatformState(
  state: DeribitHealthState,
  update: DeribitPlatformState,
): void {
  if (update.maintenance != null) state.platformMaintenance = update.maintenance;
  if (update.price_index == null || update.locked == null) return;
  if (update.locked) state.lockedPriceIndexes.add(update.price_index);
  else state.lockedPriceIndexes.delete(update.price_index);
}

export function applyDeribitPublicStatus(
  state: DeribitHealthState,
  status: DeribitPublicStatus | null,
  error?: unknown,
): void {
  if (error != null || status == null) {
    state.publicStatusError =
      error == null ? 'public status probe failed' : `public status probe failed: ${String(error)}`;
    return;
  }
  state.publicStatus = status;
  state.publicStatusError = null;
}

interface DeribitHealth {
  status: 'connected' | 'degraded';
  message: string;
  health: VenueHealthContext;
}

function result(
  status: DeribitHealth['status'],
  message: string,
  code: VenueHealthContext['code'],
  scope: VenueHealthContext['scope'] = 'venue',
  affectedIndices: string[] = [],
): DeribitHealth {
  return { status, message, health: { code, scope, affectedIndices, exchangeState: status } };
}

export function deriveDeribitPlatformHealth(state: DeribitHealthState): DeribitHealth {
  if (state.platformMaintenance) return result('degraded', 'platform maintenance', 'maintenance');
  if (state.publicStatusError != null)
    return result('degraded', state.publicStatusError, 'status-probe');
  const publicStatus = state.publicStatus;
  const locked = publicStatus?.locked;
  const targets = publicStatus?.locked_indices ?? publicStatus?.locked_currencies ?? [];
  if (locked === true || locked === 'true' || (locked === 'partial' && targets.length === 0)) {
    return result(
      'degraded',
      targets.length ? `public status locked: ${targets.join(', ')}` : 'public status locked',
      'index-lock',
      'venue',
      targets,
    );
  }
  const indices = [
    ...new Set([...state.lockedPriceIndexes, ...(locked === 'partial' ? targets : [])]),
  ].sort();
  if (indices.length > 0) {
    const prefix = locked === 'partial' ? 'public status locked' : 'locked indices';
    return result('degraded', `${prefix}: ${indices.join(', ')}`, 'index-lock', 'indices', indices);
  }
  return result('connected', 'platform healthy', 'healthy');
}

export function deriveDeribitPublicStatusHealth(
  state: DeribitHealthState,
  status: DeribitPublicStatus | null,
  error?: unknown,
): DeribitHealth {
  const snapshot = { ...state };
  applyDeribitPublicStatus(snapshot, status, error);
  return deriveDeribitPlatformHealth(snapshot);
}
