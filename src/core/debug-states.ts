import type { Binding, EntityPlacement, EntityState } from './types';

export const debugEntityPrefix = 'debug.';

/**
 * Creates a synthetic entity state for one binding.
 * @param binding The binding the state is for.
 * @param placement The floorplan placement of the binding, if any (used for environment measure attributes).
 * @param on True for the active state (light on, door open, lock unlocked, sensor triggered, cover open).
 * @param level Optional 0-100 cover position or environment value overriding the default for `on`.
 * @returns The synthetic entity state.
 */
export function debugState(binding: Binding, placement: EntityPlacement | undefined, on: boolean, level?: number): EntityState {
  let state: string;
  let attributes: Record<string, unknown> = {};
  switch (binding.kind) {
    case 'light':
      state = on ? 'on' : 'off';
      attributes = { brightness: 255 };
      break;
    case 'lock':
      state = on ? 'unlocked' : 'locked';
      break;
    case 'cover': {
      const position = level ?? (on ? 100 : 0);
      state = position > 0 ? 'open' : 'closed';
      attributes = { current_position: position };
      break;
    }
    case 'environment-sensor': {
      const value = level ?? (on ? 21.4 : 10.7);
      state = String(value);
      attributes = {
        temperature: value, humidity: value * 2.2, carbon_dioxide: value * 29,
        illuminance: value * 14.7, pressure: 1013, voc: value * 4,
      };
      if (placement?.type === 'environment-sensor') {
        for (const measure of placement.measures ?? []) attributes[measure.attribute] ??= value * 2;
      }
      break;
    }
    default:
      state = on ? 'on' : 'off';
  }
  return { entity_id: binding.entityId, state, attributes };
}

/**
 * Builds synthetic entity states for every binding so all visuals can be exercised without Home Assistant.
 * @param bindings Resolved card bindings.
 * @param placements Floorplan entity placements.
 * @param phase 1 gives the "active" set; 2 gives the opposite.
 * @returns Map from entity ID to a synthetic state.
 */
export function debugStates(
  bindings: Binding[],
  placements: EntityPlacement[],
  phase: 1 | 2,
): Map<string, EntityState> {
  const byId = new Map(placements.map(placement => [placement.id, placement]));
  return new Map(bindings.map(binding => [
    binding.entityId,
    debugState(binding, byId.get(binding.ref), phase === 1),
  ]));
}

/**
 * Creates bindings for placements that have none, backed by `debug.<id>` entities that only exist in debug mode.
 * @param placements Floorplan entity placements.
 * @param bindings Existing bindings; placements already bound (by `ref`) are skipped.
 * @returns The new synthetic bindings.
 */
export function syntheticBindings(placements: EntityPlacement[], bindings: Binding[]): Binding[] {
  const bound = new Set(bindings.map(binding => binding.ref));
  const result: Binding[] = [];
  for (const placement of placements) {
    if (bound.has(placement.id)) continue;
    const entityId = `${debugEntityPrefix}${placement.id}`;
    switch (placement.type) {
      case 'light':
      case 'water-leak':
      case 'environment-sensor':
      case 'motion-sensor':
      case 'presence-sensor':
        result.push({ ref: placement.id, entityId, kind: placement.type, targetId: placement.areaId ?? placement.roomId });
        break;
      case 'door-contact':
      case 'window-contact':
        result.push({
          ref: placement.id, entityId, kind: 'door-contact', targetId: placement.connectorId,
          ...(placement.role === 'tilt' ? { mode: 'tilt' as const } : {}),
        });
        break;
      case 'lock':
      case 'cover':
        result.push({ ref: placement.id, entityId, kind: placement.type, targetId: placement.connectorId });
        break;
    }
  }
  return result;
}
