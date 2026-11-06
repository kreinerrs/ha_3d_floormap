import type { Connector, Floorplan } from './types';

const windowAliases: Record<string, NonNullable<NonNullable<Connector['window']>['type']>> = {
  'slide-horizontal': 'sliding',
  turn: 'hinged',
  'tilt-and-turn': 'tilt-turn',
  tilt_turn: 'tilt-turn',
  tilt_and_turn: 'tilt-turn',
  tiltturn: 'tilt-turn',
};
const windowTypes = ['fixed', 'tilt', 'sliding', 'slide-vertical', 'hinged', 'tilt-turn'];
const sides = ['start', 'end'];

const validAngle = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max;

function normalizeWindow(connector: Connector, warn: (message: string) => void): Connector {
  const source = connector.window;
  if (!source) return connector;
  const window: NonNullable<Connector['window']> = { ...source };
  const drop = (field: string) => {
    warn(`Window connector "${connector.id}" has an invalid ${field}; the setting was ignored.`);
  };
  if (window.type !== undefined) {
    const mapped = windowAliases[window.type as string] ?? window.type;
    if (windowTypes.includes(mapped)) window.type = mapped;
    else { drop('type'); delete window.type; }
  }
  if (window.slide !== undefined || window.slideDirection !== undefined) {
    const value = window.slide ?? window.slideDirection;
    if (sides.includes(value as string)) window.slideDirection = value;
    else { drop('slide'); delete window.slideDirection; }
  }
  delete window.slide;
  if (window.hinge !== undefined && window.hinge !== 'left' && window.hinge !== 'right') { drop('hinge'); delete window.hinge; }
  if (window.swing !== undefined && window.swing !== 'inward' && window.swing !== 'outward') { drop('swing'); delete window.swing; }
  if (window.openAngle !== undefined && !validAngle(window.openAngle, 180)) { drop('openAngle'); delete window.openAngle; }
  return { ...connector, window };
}

function normalizeDoor(connector: Connector, warn: (message: string) => void): Connector {
  const door: NonNullable<Connector['door']> = { ...connector.door };
  const drop = (field: string) => {
    warn(`Door connector "${connector.id}" has an invalid ${field}; the setting was ignored.`);
  };
  const glass = connector.glazing === 'glass';
  const doorType = connector.doorType?.toLowerCase();
  if (doorType === 'sliding') door.style = glass ? 'sliding-glass' : 'sliding';
  else if (doorType === 'pocket') door.style = 'pocket-sliding';
  else if (doorType === 'double' || doorType?.startsWith('hinged-double')) door.style = 'double';
  else if (doorType?.startsWith('hinged')) door.style = 'hinged';
  else if (doorType !== undefined) warn(`Door connector "${connector.id}" has an unknown doorType "${connector.doorType}"; a hinged door is used.`);
  if (door.style === 'hinged' || door.style === 'double' || door.style === undefined) {
    if (glass) door.glass = true;
  }
  const slideStyle = door.style === 'sliding' || door.style === 'sliding-glass' || door.style === 'pocket-sliding';
  if (door.slide !== undefined || door.slideDirection !== undefined || (doorType && slideStyle)) {
    const value = door.slide ?? door.slideDirection ?? 'start';
    if (sides.includes(value)) door.slideDirection = value;
    else { drop('slide'); delete door.slideDirection; }
  }
  delete door.slide;
  if (door.hinge !== undefined && door.hinge !== 'left' && door.hinge !== 'right') { drop('hinge'); delete door.hinge; }
  if (door.swing !== undefined && door.swing !== 'inward' && door.swing !== 'outward') { drop('swing'); delete door.swing; }
  if (door.openAngle !== undefined && !validAngle(door.openAngle, 180)) { drop('openAngle'); delete door.openAngle; }
  if (door.visibleFraction !== undefined && !validAngle(door.visibleFraction, 0.5)) { drop('visibleFraction'); delete door.visibleFraction; }
  if (door.tilt !== undefined && typeof door.tilt !== 'boolean') { drop('tilt'); delete door.tilt; }
  return { ...connector, door };
}

/**
 * Converts the door and window fields of the file format (`doorType`, `glazing`, `door.slide`,
 * `door.tilt`, `window.type`, `window.slide`) into the settings the renderer draws. Invalid
 * motion settings are dropped with a console warning instead of rejecting the floorplan.
 * @param floorplan A parsed floorplan.
 * @param warn Receives one message per ignored setting; defaults to `console.warn`.
 * @returns A copy of the floorplan with normalized door and window settings.
 */
export function normalizeOpenings(floorplan: Floorplan, warn: (message: string) => void = message => console.warn(message)): Floorplan {
  return {
    ...floorplan,
    rooms: floorplan.rooms.map(room => ({
      ...room,
      connectors: room.connectors.map(connector => {
        if (connector.type === 'window') return normalizeWindow(connector, warn);
        if (connector.type === 'door') return normalizeDoor(connector, warn);
        return connector;
      }),
    })),
  };
}
