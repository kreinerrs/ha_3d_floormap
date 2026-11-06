import { elevationOf } from './elevation';
import type { Floorplan } from './types';

export interface IgnoredElement {
  category: string;
  id: string;
  reason: string;
}

const SUPPORTED_PLACEMENTS = new Set([
  'light', 'water-leak', 'door-contact', 'window-contact', 'cover', 'lock', 'environment-sensor', 'motion-sensor', 'presence-sensor',
]);

/**
 * Lists floorplan elements that the card reads but does not render or use yet.
 * @param floorplan A validated floorplan (schema 2.x or 3.x).
 * @returns One entry per ignored element, in file order.
 */
export const listIgnoredElements = (floorplan: Floorplan): IgnoredElement[] => {
  const out: IgnoredElement[] = [];
  const add = (category: string, id: string, reason: string): void => {
    out.push({ category, id, reason });
  };

  floorplan.wallAlignments?.forEach(item => add('wall alignment', item.id, 'editor-only constraint'));
  floorplan.joints?.forEach(joint => add('joint', joint.relationshipId, 'detached walls are not rendered'));

  for (const room of floorplan.rooms) {
    if (room.elevation !== undefined && elevationOf(room) !== room.elevation) add('room elevation', room.id, 'outside 0..10 m, clamped');
  }
  for (const area of floorplan.areas ?? []) {
    if (area.elevation !== undefined && elevationOf(area) !== area.elevation) add('area elevation', area.id, 'outside 0..10 m, clamped');
  }
  for (const placement of floorplan.entityPlacements ?? []) {
    const loose = placement as { id: string; type: string; objectId?: string };
    if (!SUPPORTED_PLACEMENTS.has(loose.type)) add('entity', loose.id, `type "${loose.type}" is not supported`);
    else if (loose.objectId !== undefined) add('entity', loose.id, 'object anchor is not supported');
  }
  return out;
};

/**
 * Formats ignored elements as grouped plain text for display.
 * @param items Elements returned by listIgnoredElements.
 * @returns A multi-line text, or a short note when nothing is ignored.
 */
export const formatIgnoredElements = (items: IgnoredElement[]): string => {
  if (items.length === 0) return 'No ignored elements.';
  const groups = new Map<string, IgnoredElement[]>();
  for (const item of items) groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
  return [...groups].map(([category, list]) =>
    `${category} (${list.length})\n${list.map(item => `  ${item.id}: ${item.reason}`).join('\n')}`).join('\n\n');
};
