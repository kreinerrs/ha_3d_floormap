import { describe, expect, it } from 'vitest';
import { defaults } from '../src/core/config';
import { classifyWallSegment, floorplanBounds, resolveOpenings, wallLines, junctionPoints, splitLine, wallSegmentOpaqueFromCameraSide } from '../src/core/geometry';
import type { Floorplan } from '../src/core/types';

describe('M4 geometry', () => {
  it('classifies shared walls and camera-facing versus far exterior walls', () => {
    const floorplan: Floorplan = {
      schemaVersion: '2.0',
      id: 'two-rooms',
      name: 'Two rooms',
      rooms: [
        { id: 'a', name: 'A', type: 'room', layout: { x: 0, y: 0, width: 4, height: 3 }, connectors: [] },
        { id: 'b', name: 'B', type: 'room', layout: { x: 4, y: 0, width: 4, height: 3 }, connectors: [] },
      ],
      relationships: [],
    };
    const topWall = classifyWallSegment(floorplan, 'x', 0, 0, 4)[0];
    const bottomWall = classifyWallSegment(floorplan, 'x', 3, 0, 4)[0];
    const sharedWall = classifyWallSegment(floorplan, 'z', 4, 0, 3)[0];
    expect(wallSegmentOpaqueFromCameraSide(topWall, 'x', 0, 2, -2)).toBe(false);
    expect(wallSegmentOpaqueFromCameraSide(bottomWall, 'x', 3, 2, -2)).toBe(true);
    expect(wallSegmentOpaqueFromCameraSide(topWall, 'x', 0, 2, 5)).toBe(true);
    expect(wallSegmentOpaqueFromCameraSide(bottomWall, 'x', 3, 2, 5)).toBe(false);
    expect(wallSegmentOpaqueFromCameraSide(sharedWall, 'z', 4, 5, 1)).toBe(false);
  });

  it('splits a long wall where room adjacency changes', () => {
    const floorplan: Floorplan = {
      schemaVersion: '2.0',
      id: 'two-rooms',
      name: 'Two rooms',
      rooms: [
        { id: 'a', name: 'A', type: 'room', layout: { x: 0, y: 0, width: 3, height: 3 }, connectors: [] },
        { id: 'b', name: 'B', type: 'room', layout: { x: 3, y: 0, width: 3, height: 3 }, connectors: [] },
      ],
      relationships: [],
    };
    expect(classifyWallSegment(floorplan, 'x', 0, 0, 6)).toEqual([
      { start: 0, end: 3, beforeOccupied: false, afterOccupied: true },
      { start: 3, end: 6, beforeOccupied: false, afterOccupied: true },
    ]);
    expect(classifyWallSegment(floorplan, 'z', 3, 0, 3)).toEqual([
      { start: 0, end: 3, beforeOccupied: true, afterOccupied: true },
    ]);
  });

  it('includes optional site areas in site bounds but not room bounds', () => {
    const floorplan: Floorplan = {
      schemaVersion: '2.0',
      id: 'site',
      name: 'Site',
      rooms: [{
        id: 'living',
        name: 'Living',
        type: 'room',
        layout: { x: 2, y: 3, width: 6, height: 4 },
        connectors: [],
      }],
      areas: [{
        id: 'garden',
        name: 'Garden',
        kind: 'garden',
        shape: 'rect',
        layout: { x: -8, y: -5, width: 20, height: 15 },
      }],
      relationships: [],
    };

    expect(floorplanBounds(floorplan, false)).toEqual({ minX: 2, maxX: 8, minY: 3, maxY: 7 });
    expect(floorplanBounds(floorplan, true)).toEqual({ minX: -8, maxX: 12, minY: -5, maxY: 10 });
  });

  it('matches different local offsets at the same world point', () => {
    const floorplan: Floorplan = {
      schemaVersion: '2.0',
      id: 'test',
      name: 'Test',
      rooms: [
        {
          id: 'a',
          name: 'A',
          type: 'room',
          layout: { x: 0, y: 0, width: 4, height: 3 },
          connectors: [{ id: 'a1', roomId: 'a', side: 'right', type: 'door', offset: 1.55 }],
        },
        {
          id: 'b',
          name: 'B',
          type: 'room',
          layout: { x: 4, y: 1, width: 4, height: 3 },
          connectors: [{ id: 'b1', roomId: 'b', side: 'left', type: 'door', offset: 0.55 }],
        },
      ],
      relationships: [{ id: 'r', connectorA: 'a1', connectorB: 'b1' }],
    };

    expect(resolveOpenings(floorplan, defaults.visuals)).toHaveLength(1);
  });

  it('keeps a paired door visible and uses swing metadata from either connector', () => {
    const floorplan: Floorplan = {
      schemaVersion: '2.0',
      id: 'test',
      name: 'Test',
      rooms: [
        {
          id: 'main-bedroom',
          name: 'Main Bedroom',
          type: 'bedroom',
          layout: { x: 0, y: 0, width: 5, height: 3 },
          connectors: [{ id: 'right-door', roomId: 'main-bedroom', side: 'right', type: 'door', offset: 1.5 }],
        },
        {
          id: 'bedroom-front',
          name: 'Bedroom Front',
          type: 'bedroom',
          layout: { x: 5, y: 0, width: 4, height: 3 },
          connectors: [{
            id: 'left-door',
            roomId: 'bedroom-front',
            side: 'left',
            type: 'door',
            offset: 1.5,
            door: { hinge: 'right', swing: 'inward', openAngle: 65 },
          }],
        },
      ],
      relationships: [{ id: 'paired-door', connectorA: 'right-door', connectorB: 'left-door' }],
    };

    const openings = resolveOpenings(floorplan, defaults.visuals);
    expect(openings).toHaveLength(1);
    expect(openings[0].id).toBe('left-door--right-door');
    expect(openings[0].lineKey).toBe('z:5.000');
    expect(openings[0].connector.door).toEqual({ hinge: 'right', swing: 'inward', openAngle: 65 });
    expect(splitLine(wallLines(floorplan).find(line => line.key === 'z:5.000')!, openings).cuts)
      .toHaveLength(1);
  });

  it('keeps an unpaired door visible as a standalone opening', () => {
    const floorplan: Floorplan = {
      schemaVersion: '2.0',
      id: 'test',
      name: 'Test',
      rooms: [{
        id: 'hall',
        name: 'Hall',
        type: 'hall',
        layout: { x: 0, y: 0, width: 3, height: 2 },
        connectors: [{
          id: 'hall-door',
          roomId: 'hall',
          side: 'right',
          type: 'door',
          offset: 1,
          width: 0.9,
        }],
      }],
      relationships: [],
    };

    expect(resolveOpenings(floorplan, defaults.visuals).map(opening => opening.id)).toEqual(['hall-door']);
  });

  it('uses connectorA door settings when both paired connectors define a door', () => {
    const floorplan: Floorplan = {
      schemaVersion: '2.0',
      id: 'test',
      name: 'Test',
      rooms: [
        {
          id: 'a',
          name: 'A',
          type: 'room',
          layout: { x: 0, y: 0, width: 4, height: 3 },
          connectors: [{
            id: 'a-door',
            roomId: 'a',
            side: 'right',
            type: 'door',
            offset: 1.5,
            door: { hinge: 'left', swing: 'inward', openAngle: 60 },
          }],
        },
        {
          id: 'b',
          name: 'B',
          type: 'room',
          layout: { x: 4, y: 0, width: 4, height: 3 },
          connectors: [{
            id: 'b-door',
            roomId: 'b',
            side: 'left',
            type: 'door',
            offset: 1.5,
            door: { hinge: 'right', swing: 'outward', openAngle: 20 },
          }],
        },
      ],
      relationships: [{ id: 'paired-door', connectorA: 'a-door', connectorB: 'b-door' }],
    };

    expect(resolveOpenings(floorplan, defaults.visuals)[0].connector.door)
      .toEqual({ hinge: 'left', swing: 'inward', openAngle: 60 });
  });

  it('carries paired sliding-window metadata to the rendered opening', () => {
    const floorplan: Floorplan = {
      schemaVersion: '2.0',
      id: 'test',
      name: 'Test',
      rooms: [
        {
          id: 'a',
          name: 'A',
          type: 'room',
          layout: { x: 0, y: 0, width: 4, height: 3 },
          connectors: [{
            id: 'a-window',
            roomId: 'a',
            side: 'right',
            type: 'window',
            offset: 1.5,
            window: { type: 'sliding', sillHeight: 0, headHeight: 2.1 },
          }],
        },
        {
          id: 'b',
          name: 'B',
          type: 'room',
          layout: { x: 4, y: 0, width: 4, height: 3 },
          connectors: [{
            id: 'b-window',
            roomId: 'b',
            side: 'left',
            type: 'window',
            offset: 1.5,
          }],
        },
      ],
      relationships: [{ id: 'paired-window', connectorA: 'a-window', connectorB: 'b-window' }],
    };

    const [opening] = resolveOpenings(floorplan, defaults.visuals);
    expect(opening.connector.window).toEqual({ type: 'sliding', sillHeight: 0, headHeight: 2.1 });
    expect(opening.connector.side).toBe('right');
  });

  it('carries double-door style metadata from either paired connector', () => {
    const floorplan: Floorplan = {
      schemaVersion: '2.0',
      id: 'test',
      name: 'Test',
      rooms: [
        {
          id: 'a',
          name: 'A',
          type: 'room',
          layout: { x: 0, y: 0, width: 4, height: 3 },
          connectors: [{ id: 'a-door', roomId: 'a', side: 'right', type: 'door', offset: 1.5 }],
        },
        {
          id: 'b',
          name: 'B',
          type: 'room',
          layout: { x: 4, y: 0, width: 4, height: 3 },
          connectors: [{
            id: 'b-door',
            roomId: 'b',
            side: 'left',
            type: 'door',
            offset: 1.5,
            door: { style: 'double' },
          }],
        },
      ],
      relationships: [{ id: 'paired-door', connectorA: 'a-door', connectorB: 'b-door' }],
    };

    expect(resolveOpenings(floorplan, defaults.visuals)[0].connector.door).toEqual({ style: 'double' });
  });

  it('creates intersection posts', () => {
    const floorplan: Floorplan = {
      schemaVersion: '2.0',
      id: 'test',
      name: 'Test',
      rooms: [{
        id: 'a',
        name: 'A',
        type: 'room',
        layout: { x: 0, y: 0, width: 2, height: 2 },
        connectors: [],
      }],
      relationships: [],
    };

    expect(junctionPoints(wallLines(floorplan))).toHaveLength(4);
  });
});
