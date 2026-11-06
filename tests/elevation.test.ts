import { describe, expect, it } from 'vitest';
import { elevationOf, junctionTop, openingLevels, resolveWallHeight, wallTop } from '../src/core/elevation';
import type { Opening, Room } from '../src/core/types';

const room = (id: string, x: number, extra: Partial<Room> = {}): Room => ({
  id, name: id, type: 'other', connectors: [], layout: { x, y: 0, width: 4, height: 3 }, ...extra,
});
const floors = [{ id: 'f1', height: 2.6 }];

describe('elevation', () => {
  it('clamps elevation to 0..10', () => {
    expect(elevationOf({})).toBe(0);
    expect(elevationOf({ elevation: -1 })).toBe(0);
    expect(elevationOf({ elevation: 12 })).toBe(10);
    expect(elevationOf({ elevation: 0.5 })).toBe(0.5);
  });

  it('resolves wall height in the documented order', () => {
    const r = room('a', 0, { wallHeights: { top: 1 }, wallHeight: 3 });
    expect(resolveWallHeight(r, 'top', floors, 2.4)).toBe(1);
    expect(resolveWallHeight(r, 'left', floors, 2.4)).toBe(3);
    expect(resolveWallHeight(room('b', 0), 'left', floors, 2.4)).toBe(2.6);
    expect(resolveWallHeight(room('b', 0), 'left', undefined, 2.4)).toBe(2.4);
  });

  it('uses the larger top on a shared wall', () => {
    const rooms = [room('low', 0), room('high', 4, { elevation: 1 })];
    expect(wallTop(rooms, undefined, 'z', 4, 1.5, 2.4)).toBe(3.4);
    expect(wallTop(rooms, undefined, 'z', 0, 1.5, 2.4)).toBe(2.4);
    expect(junctionTop(rooms, undefined, [{ axis: 'z', fixed: 4, start: 0, end: 4 }], 4, 1.5, 2.4)).toBe(3.4);
  });

  it('puts an opening at the higher room level', () => {
    const rooms = [
      room('low', 0, { connectors: [{ id: 'c1', roomId: 'low', side: 'right', type: 'door', offset: 1 }] }),
      room('high', 4, { elevation: 0.5, connectors: [{ id: 'c2', roomId: 'high', side: 'left', type: 'door', offset: 1 }] }),
    ];
    const opening = { id: 'c1--c2' } as Opening;
    expect(openingLevels(rooms, opening, undefined, 2.4)).toEqual({ base: 0.5, height: 2.4 });
  });
});
