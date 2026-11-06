import { describe, expect, it } from 'vitest';
import { filterFloorplanRooms } from '../src/core/room-filter';
import type { Floorplan, Room } from '../src/core/types';

const room = (id: string, connectorId: string, floor = 'f1'): Room => ({
  id, name: id, type: 'other', floor,
  connectors: [{ id: connectorId, roomId: id, side: 'right', type: 'door', offset: 1 }],
  layout: { x: 0, y: 0, width: 4, height: 4 },
});
const full: Floorplan = {
  schemaVersion: '3.0', id: 'x', name: 'x',
  ground: { polygon: [[0, 0], [1, 0], [1, 1]] },
  areas: [{ id: 'a', name: 'a', kind: 'lawn', shape: 'rect', layout: { x: 0, y: 0, width: 1, height: 1 } }],
  floors: [{ id: 'f1' }, { id: 'f2' }],
  rooms: [room('living', 'c1'), room('dining', 'c2'), room('bed', 'c3', 'f2')],
  relationships: [{ id: 'r1', connectorA: 'c1', connectorB: 'c2' }, { id: 'r2', connectorA: 'c2', connectorB: 'c3' }],
  entityPlacements: [
    { id: 'p1', type: 'door-contact', connectorId: 'c3' },
    { id: 'p2', type: 'door-contact', connectorId: 'c1' },
  ],
};

describe('filterFloorplanRooms', () => {
  it('keeps only selected rooms and drops site elements', () => {
    const result = filterFloorplanRooms(full, ['living', 'dining']);
    expect(result.rooms.map(item => item.id)).toEqual(['living', 'dining']);
    expect(result.areas).toBeUndefined();
    expect(result.ground).toBeUndefined();
    expect(result.floors?.map(item => item.id)).toEqual(['f1']);
    expect(result.relationships.map(item => item.id)).toEqual(['r1']);
    expect(result.entityPlacements?.map(item => item.id)).toEqual(['p2']);
  });
});

import { mergeBindingsFile } from '../src/card/card-config';

describe('mergeBindingsFile', () => {
  it('lets the card override file entries', () => {
    const merged = mergeBindingsFile(
      {
        type: 'custom:three-floorplan-card', floorplan: 'x',
        bindings: { a: { entity: 'light.card' } },
        room_status: [{ room: 'r1', entity: 'sensor.card' }],
      },
      {
        bindings: { a: { entity: 'light.file' }, b: { entity: 'light.b' } },
        alerts: [{ entity: 'binary_sensor.x', effects: [] }],
        room_status: [{ room: 'r1', entity: 'sensor.file' }, { room: 'r2', entity: 'sensor.r2' }],
      },
    );
    expect(merged.bindings).toEqual({ a: { entity: 'light.card' }, b: { entity: 'light.b' } });
    expect(merged.alerts).toHaveLength(1);
    expect(merged.room_status?.map(item => item.entity)).toEqual(['sensor.r2', 'sensor.card']);
  });
});
