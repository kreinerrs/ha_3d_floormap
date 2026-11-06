import { describe, expect, it } from 'vitest';
import { normalizeOpenings } from '../src/core/openings';
import type { Connector, Floorplan } from '../src/core/types';

const plan = (connector: Partial<Connector>): Floorplan => ({
  schemaVersion: '3.0', id: 'x', name: 'x', relationships: [],
  rooms: [{
    id: 'r', name: 'r', type: 'other', layout: { x: 0, y: 0, width: 3, height: 3 },
    connectors: [{ id: 'c', roomId: 'r', side: 'top', type: 'window', offset: 1, ...connector }],
  }],
});
const first = (floorplan: Floorplan) => floorplan.rooms[0].connectors[0];
const quiet = () => undefined;

describe('normalizeOpenings windows', () => {
  it('maps editor spellings and slide direction', () => {
    expect(first(normalizeOpenings(plan({ window: { type: 'tilt-and-turn' as 'tilt' } }), quiet)).window?.type).toBe('tilt-turn');
    const slid = first(normalizeOpenings(plan({ window: { type: 'slide-horizontal', slide: 'end' } }), quiet)).window;
    expect(slid).toMatchObject({ type: 'sliding', slideDirection: 'end' });
  });
  it('keeps every documented type and a 90 degree hinged angle', () => {
    for (const type of ['fixed', 'tilt', 'slide-vertical', 'hinged', 'tilt-turn'] as const) {
      expect(first(normalizeOpenings(plan({ window: { type, openAngle: 90 } }), quiet)).window?.type).toBe(type);
    }
  });
  it('drops invalid settings with a warning instead of failing', () => {
    const warnings: string[] = [];
    const result = first(normalizeOpenings(plan({ window: { type: 'bogus' as 'tilt', openAngle: -3 } }), message => warnings.push(message)));
    expect(result.window).toEqual({});
    expect(warnings).toHaveLength(2);
  });
});

describe('normalizeOpenings doors', () => {
  const door = (extra: Partial<Connector>) => first(normalizeOpenings(plan({ type: 'door', ...extra }), quiet)).door;
  it('maps doorType and glazing', () => {
    expect(door({ doorType: 'sliding' })).toMatchObject({ style: 'sliding', slideDirection: 'start' });
    expect(door({ doorType: 'sliding', glazing: 'glass', door: { slide: 'end' } })).toMatchObject({ style: 'sliding-glass', slideDirection: 'end' });
    expect(door({ doorType: 'pocket', door: { slide: 'end' } })).toMatchObject({ style: 'pocket-sliding', slideDirection: 'end' });
    expect(door({ glazing: 'glass', door: { hinge: 'left', swing: 'inward', openAngle: 85 } })?.glass).toBe(true);
    expect(door({ door: { tilt: true, hinge: 'left' } })?.tilt).toBe(true);
  });
});

describe('sanitizeEntityPlacements', () => {
  it('skips unsupported and invalid placements with a warning', async () => {
    const { sanitizeEntityPlacements } = await import('../src/core/entity-placement');
    const base = plan({ type: 'door' });
    const floorplan = { ...base, entityPlacements: [
      { id: 'a', type: 'door-contact', connectorId: 'c' },
      { id: 'b', type: 'camera', connectorId: 'c' },
      { id: 'd', type: 'cover', connectorId: 'missing' },
    ] } as unknown as Floorplan;
    const warnings: string[] = [];
    const result = sanitizeEntityPlacements(floorplan, message => warnings.push(message));
    expect(result.entityPlacements?.map(item => item.id)).toEqual(['a']);
    expect(warnings).toHaveLength(2);
  });
});

describe('junctionTop', () => {
  it('uses only the walls that meet at the corner', async () => {
    const { junctionTop } = await import('../src/core/elevation');
    const room = (id: string, x: number, wallHeights: Record<string, number>) => ({
      id, name: id, type: 'other', layout: { x, y: 0, width: 2, height: 2 }, connectors: [], wallHeights,
    }) as unknown as Floorplan['rooms'][number];
    const rooms = [room('a', 0, { top: 3, right: 3, bottom: 3, left: 3 }), room('b', 2, { top: 2, right: 2, bottom: 2, left: 3 })];
    const lines = [
      { axis: 'x' as const, fixed: 0, start: 0, end: 2 }, { axis: 'x' as const, fixed: 0, start: 2, end: 4 },
      { axis: 'z' as const, fixed: 4, start: 0, end: 2 },
    ];
    expect(junctionTop(rooms, undefined, lines, 4, 0, 2.4)).toBe(2);
    expect(junctionTop(rooms, undefined, lines, 2, 0, 2.4)).toBe(3);
  });
});
