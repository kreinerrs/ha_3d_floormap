import { describe, expect, it } from 'vitest';
import { connectorPoint, pointInRoom, roomEdges, roomTouchesPoint } from '../src/core/outline';
import { classifyWallSegment, resolveOpenings, wallLines } from '../src/core/geometry';
import { defaults } from '../src/core/config';
import type { Floorplan, Room } from '../src/core/types';

const lShape: Room = {
  id: 'l', name: 'l', type: 'other', connectors: [],
  layout: { x: 10, y: 20, width: 6, height: 4 },
  outline: [[0, 0], [6, 0], [6, 4], [2, 4], [2, 2], [0, 2]],
};

describe('room outlines', () => {
  it('derives edges with their facing side', () => {
    const edges = roomEdges(lShape);
    expect(edges).toHaveLength(6);
    expect(edges.filter(edge => edge.side === 'bottom').map(edge => edge.fixed).sort()).toEqual([22, 24]);
    expect(edges.find(edge => edge.side === 'left' && edge.fixed === 10)?.end).toBe(22);
  });

  it('tests points against the shape, not the bounding box', () => {
    expect(pointInRoom(lShape, 14, 21)).toBe(true);
    expect(pointInRoom(lShape, 11, 23)).toBe(false);
    expect(roomTouchesPoint(lShape, 12, 22.5)).toBe(true);
  });

  it('places a connector on the outermost wall that covers its offset', () => {
    const base = { id: 'c', roomId: 'l', side: 'bottom' as const, type: 'door' as const };
    expect(connectorPoint(lShape, { ...base, offset: 4 })).toEqual({ x: 14, z: 24 });
    expect(connectorPoint(lShape, { ...base, offset: 1 })).toEqual({ x: 11, z: 22 });
    const bay: Room = { ...lShape, layout: { x: 0, y: 0, width: 6, height: 4 }, outline: [[0, 0], [6, 0], [6, 4], [0, 4]] };
    expect(connectorPoint(bay, { ...base, offset: 2, wallAt: 4 })).toEqual({ x: 2, z: 4 });
  });

  it('marks the notch as outside when classifying walls and resolves openings', () => {
    const room: Room = { ...lShape, connectors: [{ id: 'c', roomId: 'l', side: 'bottom', type: 'door', offset: 1 }] };
    const fp = { rooms: [room], relationships: [] } as unknown as Floorplan;
    const lines = wallLines(fp);
    expect(lines.some(line => line.axis === 'x' && line.fixed === 22)).toBe(true);
    const parts = classifyWallSegment(fp, 'x', 22, 10, 12);
    expect(parts[0]).toMatchObject({ beforeOccupied: true, afterOccupied: false });
    expect(resolveOpenings(fp, defaults.visuals)[0]).toMatchObject({ fixed: 22, centre: 11 });
  });
});
