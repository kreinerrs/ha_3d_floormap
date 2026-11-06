import type { Binding, EnvironmentMeasure, EntityPlacement, Floorplan, FloorplanArea, Visuals } from './types';
import { resolveOpenings } from './geometry';

function isValidPosition(
  position: [number, number],
  layout: { x: number; y: number; width: number; height: number },
  area?: FloorplanArea,
): boolean {
  if (!Array.isArray(position) || position.length !== 2 || !position.every(Number.isFinite)) return false;
  const [x, y] = position;
  if (x < layout.x || x > layout.x + layout.width || y < layout.y || y > layout.y + layout.height) return false;
  return !area || area.shape !== 'ellipse'
    || (((x - (layout.x + layout.width / 2)) / (layout.width / 2)) ** 2
      + ((y - (layout.y + layout.height / 2)) / (layout.height / 2)) ** 2 <= 1);
}

/** Schema 3.0 lists measures as plain names; expand them to { name, attribute } objects. */
function normalizeMeasures(floorplan: Floorplan): Floorplan {
  const needsWork = floorplan.entityPlacements?.some(placement => placement?.type === 'environment-sensor'
    && (placement.measures as unknown[] | undefined)?.some(measure => typeof measure === 'string'));
  if (!needsWork) return floorplan;
  return {
    ...floorplan,
    entityPlacements: floorplan.entityPlacements?.map(placement => {
      if (placement?.type !== 'environment-sensor' || !Array.isArray(placement.measures)) return placement;
      const measures = (placement.measures as unknown[]).map(measure =>
        typeof measure === 'string' ? { name: measure, attribute: measure } : measure) as EnvironmentMeasure[];
      return { ...placement, measures };
    }),
  };
}

/**
 * Converts schema 3.0 placements to the card's internal form (room-relative positions become floorplan positions, string measures become objects).
 * @param input The parsed floorplan.
 * @returns A normalised copy.
 */
export function normalizeEntityPlacementCoordinates(input: Floorplan): Floorplan {
  const floorplan = normalizeMeasures(input);
  if ((floorplan.entitySettings?.coordinates ?? 'floorplan') === 'floorplan') return floorplan;

  const rooms = new Map(floorplan.rooms.map(room => [room.id, room]));
  const areas = new Map((floorplan.areas ?? []).map(area => [area.id, area]));
  return {
    ...floorplan,
    entitySettings: { ...floorplan.entitySettings, coordinates: 'floorplan' },
    entityPlacements: floorplan.entityPlacements?.map(placement => {
      if (!('position' in placement) || !Array.isArray(placement.position) || placement.position.length !== 2
        || !placement.position.every(Number.isFinite)) {
        return placement;
      }
      const layout = 'roomId' in placement && placement.roomId
        ? rooms.get(placement.roomId)?.layout
        : 'areaId' in placement && placement.areaId
          ? areas.get(placement.areaId)?.layout
          : undefined;
      if (!layout) return placement;
      return {
        ...placement,
        position: [
          layout.x + placement.position[0],
          layout.y + placement.position[1],
        ] as [number, number],
      };
    }),
  };
}

function spatialTargetId(placement: EntityPlacement): string | undefined {
  switch (placement.type) {
    case 'light':
    case 'water-leak':
    case 'environment-sensor':
    case 'motion-sensor':
    case 'presence-sensor':
      return placement.areaId ?? placement.roomId;
    default:
      return undefined;
  }
}

export function resolveBindings(floorplan: Floorplan, bindings: Binding[], visuals: Visuals): Binding[] {
  const roomIds = new Set(floorplan.rooms.map(room => room.id));
  const areaIds = new Set((floorplan.areas ?? []).map(area => area.id));
  const placements = new Map((floorplan.entityPlacements ?? []).map(placement => [placement.id, placement]));
  const openings = resolveOpenings(floorplan, { ...visuals, ...floorplan.buildingDefaults });

  return bindings.map(binding => {
    const placement = placements.get(binding.ref);
    const placementKind = placement?.type === 'light' || placement?.type === 'water-leak' || placement?.type === 'door-contact' || placement?.type === 'window-contact'
      || placement?.type === 'cover' || placement?.type === 'environment-sensor'
      ? placement.type
      : placement?.type;
    const expectedKind = placementKind === 'window-contact' ? 'door-contact' : placementKind;
    if (expectedKind && expectedKind !== binding.kind) {
      throw new Error(`Binding "${binding.ref}" kind "${binding.kind}" does not match its ${placementKind} placement`);
    }
    const placementTargetId = placement
      ? spatialTargetId(placement) ?? (placement.type === 'door-contact' || placement.type === 'window-contact' || placement.type === 'cover' || placement.type === 'lock'
        ? placement.connectorId
        : undefined)
      : undefined;
    if (placementTargetId && binding.targetId && binding.targetId !== placementTargetId) {
      throw new Error(`Binding "${binding.ref}" target "${binding.targetId}" conflicts with its placement target "${placementTargetId}"`);
    }
    const targetId = placementTargetId ?? binding.targetId;
    if (!targetId) {
      throw new Error(`Binding "${binding.ref}" needs a matching floorplan placement or a target`);
    }
    const found = binding.kind === 'light' || binding.kind === 'water-leak' || binding.kind === 'environment-sensor'
      || binding.kind === 'motion-sensor' || binding.kind === 'presence-sensor'
      ? roomIds.has(targetId) || areaIds.has(targetId)
      : openings.some(opening => opening.id === targetId || opening.id.split('--').includes(targetId));
    if (!found) {
      throw new Error(`Binding "${binding.ref}" target "${targetId}" was not found in the floorplan`);
    }
    const mode = placement?.type === 'door-contact' || placement?.type === 'window-contact'
      ? placement.role === 'tilt' ? 'tilt' as const : binding.mode
      : binding.mode;
    return mode ? { ...binding, targetId, mode } : { ...binding, targetId };
  });
}

export function validateEntityPlacements(floorplan: Floorplan): void {
  if (floorplan.entityPlacements === undefined) return;
  if (!Array.isArray(floorplan.entityPlacements)) {
    throw new Error('Floorplan entityPlacements must be an array');
  }

  const ids = new Set<string>();
  const rooms = new Map(floorplan.rooms.map(room => [room.id, room]));
  const areas = new Map((floorplan.areas ?? []).map(area => [area.id, area]));
  const connectors = new Map(floorplan.rooms.flatMap(room => room.connectors.map(connector => [connector.id, connector] as const)));
  for (const placement of floorplan.entityPlacements) {
    if (!placement || typeof placement.id !== 'string' || !placement.id.trim() || ids.has(placement.id)) {
      throw new Error('Floorplan entity placements must have unique, non-empty IDs');
    }
    ids.add(placement.id);
    if (placement.type === 'light' || placement.type === 'water-leak' || placement.type === 'environment-sensor') {
      const hasRoom = typeof placement.roomId === 'string';
      const hasArea = typeof placement.areaId === 'string';
      const roomLayout = hasRoom ? rooms.get(placement.roomId)?.layout : undefined;
      const area = hasArea ? areas.get(placement.areaId) : undefined;
      const layout = roomLayout ?? area?.layout;
      if (hasRoom === hasArea || !layout || !isValidPosition(placement.position, layout, area)
        || (placement.height !== undefined && (!Number.isFinite(placement.height) || placement.height < 0))) {
        const name = placement.type === 'light' ? 'Light'
          : placement.type === 'water-leak' ? 'Water-leak sensor' : 'Environmental sensor';
        throw new Error(`${name} placement "${placement.id}" has an invalid room, position, or height`);
      }
      if (placement.type === 'environment-sensor' && placement.label !== undefined
        && (typeof placement.label !== 'string' || !placement.label.trim())) {
        throw new Error(`Environmental sensor placement "${placement.id}" has an invalid label`);
      }
      if (placement.type === 'environment-sensor' && placement.measures !== undefined) {
        if (!Array.isArray(placement.measures) || placement.measures.length === 0
          || placement.measures.some(measure => !measure
            || typeof measure.name !== 'string' || !measure.name.trim()
            || typeof measure.attribute !== 'string' || !measure.attribute.trim()
            || (measure.unit !== undefined && (typeof measure.unit !== 'string' || !measure.unit.trim()))
            || (measure.precision !== undefined
              && (!Number.isInteger(measure.precision) || measure.precision < 0 || measure.precision > 4)))) {
          throw new Error(`Environmental sensor placement "${placement.id}" has invalid measures`);
        }
      }
    } else if (placement.type === 'door-contact' || placement.type === 'window-contact') {
      const openingType = connectors.get(placement.connectorId)?.type;
      if (openingType !== 'door' && openingType !== 'window') {
        throw new Error(`Door-contact placement "${placement.id}" must reference a door or window connector`);
      }
    } else if (placement.type === 'lock') {
      if (connectors.get(placement.connectorId)?.type !== 'door' || (placement.side !== undefined && placement.side !== 'A' && placement.side !== 'B')) {
        throw new Error(`Lock placement "${placement.id}" must reference a door connector`);
      }
    } else if (placement.type === 'cover') {
      const connector = connectors.get(placement.connectorId);
      if (connector?.type !== 'window' && connector?.type !== 'door') {
        throw new Error(`Cover placement "${placement.id}" must reference a door or window connector`);
      }
    } else if (placement.type === 'motion-sensor' || placement.type === 'presence-sensor') {
      const hasRoom = typeof placement.roomId === 'string';
      const hasArea = typeof placement.areaId === 'string';
      const roomLayout = hasRoom ? rooms.get(placement.roomId)?.layout : undefined;
      const area = hasArea ? areas.get(placement.areaId) : undefined;
      const layout = roomLayout ?? area?.layout;
      if (hasRoom === hasArea || !layout || !isValidPosition(placement.position, layout, area)
        || !Number.isFinite(placement.facingDegrees)
        || !Number.isFinite(placement.fieldOfViewDegrees)
        || placement.fieldOfViewDegrees <= 0 || placement.fieldOfViewDegrees > 360
        || !Number.isFinite(placement.range) || placement.range <= 0
        || (placement.height !== undefined && (!Number.isFinite(placement.height) || placement.height < 0))
        || (placement.detectionPositionAttribute !== undefined
          && (typeof placement.detectionPositionAttribute !== 'string' || !placement.detectionPositionAttribute))) {
        throw new Error(`Sensor placement "${placement.id}" has an invalid room, position, or sensor range/orientation`);
      }
    } else {
      throw new Error(`Unsupported entity placement type: ${String((placement as { type?: unknown }).type)}`);
    }
  }
}

/**
 * Removes placements that would fail validation (unknown types such as `lock`, bad targets or positions)
 * so one faulty entry does not stop the floorplan from loading.
 * @param floorplan A normalised floorplan.
 * @param warn Receives one message per removed placement; defaults to `console.warn`.
 * @returns The floorplan without the invalid placements.
 */
export function sanitizeEntityPlacements(floorplan: Floorplan, warn: (message: string) => void = message => console.warn(message)): Floorplan {
  if (!Array.isArray(floorplan.entityPlacements)) return floorplan;
  const kept: EntityPlacement[] = [];
  const seen = new Set<string>();
  for (const placement of floorplan.entityPlacements) {
    try {
      validateEntityPlacements({ ...floorplan, entityPlacements: [placement] });
      if (seen.has(placement.id)) throw new Error(`Duplicate entity placement ID "${placement.id}"`);
      seen.add(placement.id);
      kept.push(placement);
    } catch (error) {
      const id = (placement as { id?: unknown } | undefined)?.id;
      warn(`Entity placement ${typeof id === 'string' ? `"${id}" ` : ''}was skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return kept.length === floorplan.entityPlacements.length ? floorplan : { ...floorplan, entityPlacements: kept };
}
