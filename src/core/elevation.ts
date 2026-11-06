import { pointInRoom } from './outline';
import type { Floorplan, FloorplanArea, Opening, Room, Side } from './types';

export const MAX_ELEVATION = 10;
const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
const EPSILON = 0.02;

type Floors = Floorplan['floors'];

/**
 * Elevation of a room or area above the baseline of its floor.
 * @param item Room or area; a missing or non-finite value counts as 0.
 * @returns Metres, clamped to 0..MAX_ELEVATION.
 */
export const elevationOf = (item: Pick<Room | FloorplanArea, 'elevation'>): number =>
  Number.isFinite(item.elevation) ? Math.min(MAX_ELEVATION, Math.max(0, item.elevation!)) : 0;

/**
 * Wall height of one side of a room.
 * Order: wallHeights[side], wallHeight, height of the room's floor, fallback.
 * @param room The room owning the wall.
 * @param side Which wall of the room.
 * @param floors The floorplan floors (the first floor is used when the room names none).
 * @param fallback Building default wall height in metres.
 * @returns Wall height in metres, measured from the room's own floor.
 */
export const resolveWallHeight = (room: Room, side: Side, floors: Floors, fallback: number): number => {
  const valid = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value) && value > 0;
  const floor = floors?.find(item => item.id === room.floor) ?? floors?.[0];
  const candidates = [room.wallHeights?.[side], room.wallHeight, floor?.height];
  return candidates.find(valid) ?? fallback;
};

/**
 * Top of the highest wall of a room, measured from the floor baseline.
 * @param room The room.
 * @param floors The floorplan floors.
 * @param fallback Building default wall height in metres.
 * @returns Elevation plus the largest wall height, in metres.
 */
export const roomTop = (room: Room, floors: Floors, fallback: number): number =>
  elevationOf(room) + Math.max(...SIDES.map(side => resolveWallHeight(room, side, floors, fallback)));

const contains = (room: Room, x: number, z: number): boolean => room.id !== 'outside' && pointInRoom(room, x, z);

/**
 * Top of a wall piece. Where two rooms share the wall the larger top wins.
 * @param rooms Rooms of one floor.
 * @param floors The floorplan floors.
 * @param axis 'x' for a wall running along x (fixed z), 'z' for a wall along z (fixed x).
 * @param fixed Coordinate of the wall line.
 * @param along Coordinate along the wall where the piece is measured.
 * @param fallback Building default wall height in metres.
 * @returns Top in metres above the floor baseline.
 */
export const wallTop = (
  rooms: Room[],
  floors: Floors,
  axis: 'x' | 'z',
  fixed: number,
  along: number,
  fallback: number,
): number => {
  const tops: number[] = [];
  for (const room of rooms) {
    const before = axis === 'x' ? contains(room, along, fixed - EPSILON) : contains(room, fixed - EPSILON, along);
    const after = axis === 'x' ? contains(room, along, fixed + EPSILON) : contains(room, fixed + EPSILON, along);
    if (before) tops.push(elevationOf(room) + resolveWallHeight(room, axis === 'x' ? 'bottom' : 'right', floors, fallback));
    if (after) tops.push(elevationOf(room) + resolveWallHeight(room, axis === 'x' ? 'top' : 'left', floors, fallback));
  }
  return tops.length ? Math.max(...tops) : fallback;
};

/**
 * Top of a wall corner or junction post: the highest top of the wall pieces that meet at the point.
 * Other walls of the rooms touching the point do not count.
 * @param rooms Rooms of one floor.
 * @param floors The floorplan floors.
 * @param lines Merged wall lines of the floor (axis, fixed coordinate, start and end along the line).
 * @param x Point x in floorplan metres.
 * @param z Point y (plan) in floorplan metres.
 * @param fallback Building default wall height in metres.
 * @returns Highest adjacent wall top in metres above the floor baseline.
 */
export const junctionTop = (
  rooms: Room[],
  floors: Floors,
  lines: { axis: 'x' | 'z'; fixed: number; start: number; end: number }[],
  x: number,
  z: number,
  fallback: number,
): number => {
  const tops: number[] = [];
  for (const line of lines) {
    const along = line.axis === 'x' ? x : z;
    const across = line.axis === 'x' ? z : x;
    if (Math.abs(across - line.fixed) > 0.001 || along < line.start - 0.001 || along > line.end + 0.001) continue;
    for (const delta of [-2 * EPSILON, 2 * EPSILON]) {
      const probe = along + delta;
      if (probe >= line.start && probe <= line.end) tops.push(wallTop(rooms, floors, line.axis, line.fixed, probe, fallback));
    }
  }
  return tops.length ? Math.max(...tops) : fallback;
};

/**
 * Vertical placement of an opening. Its sill is at the higher of the rooms it joins,
 * so a drop is left towards the lower room.
 * @param rooms Rooms of one floor.
 * @param opening The opening (its id may join two connector ids with "--").
 * @param floors The floorplan floors.
 * @param fallback Building default wall height in metres.
 * @returns base: floor level of the opening; height: wall height above that base.
 */
export const openingLevels = (
  rooms: Room[],
  opening: Opening,
  floors: Floors,
  fallback: number,
): { base: number; height: number } => {
  const ids = new Set(opening.id.split('--'));
  const owners = rooms.flatMap(room => room.connectors.filter(connector => ids.has(connector.id)).map(connector => ({ room, side: connector.side })));
  if (!owners.length) return { base: 0, height: fallback };
  const base = Math.max(...owners.map(({ room }) => elevationOf(room)));
  const top = Math.max(...owners.map(({ room, side }) => elevationOf(room) + resolveWallHeight(room, side, floors, fallback)));
  return { base, height: Math.max(0.1, top - base) };
};
