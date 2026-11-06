import type { EntityState } from './types';

export function coverPosition(state: EntityState | undefined): number | undefined {
  if (!state || state.state === 'unknown' || state.state === 'unavailable') return undefined;
  const position = state.attributes.current_position;
  if (typeof position === 'number' && Number.isFinite(position)) {
    return Math.max(0, Math.min(100, position));
  }
  if (state.state === 'open' || state.state === 'opening') return 100;
  if (state.state === 'closed' || state.state === 'closing') return 0;
  return undefined;
}
