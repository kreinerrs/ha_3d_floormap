import { describe, expect, it } from 'vitest';
import { defaults } from '../src/core/config';
import {
  normalizeEntityPlacementCoordinates,
  resolveBindings,
  validateEntityPlacements,
} from '../src/core/entity-placement';
import type { Floorplan } from '../src/core/types';

const floorplan: Floorplan = {
  schemaVersion: '2.0',
  id: 'test-home',
  name: 'Test Home',
  rooms: [
    {
      id: 'room-a',
      name: 'Room A',
      type: 'bedroom',
      layout: { x: 0, y: 0, width: 4, height: 3 },
      connectors: [{ id: 'a-door', roomId: 'room-a', side: 'right', type: 'door', offset: 1.5 }],
    },
    {
      id: 'room-b',
      name: 'Room B',
      type: 'hall',
      layout: { x: 4, y: 0, width: 2, height: 3 },
      connectors: [{ id: 'b-door', roomId: 'room-b', side: 'left', type: 'door', offset: 1.5 }],
    },
  ],
  relationships: [{ id: 'shared-door', connectorA: 'a-door', connectorB: 'b-door' }],
  entityPlacements: [
    { id: 'ceiling-light', type: 'light', roomId: 'room-a', position: [1.5, 1], height: 2.2 },
    { id: 'door-contact', type: 'door-contact', connectorId: 'a-door' },
    { id: 'blind', type: 'cover', connectorId: 'a-door' },
    {
      id: 'temperature',
      type: 'environment-sensor',
      roomId: 'room-a',
      position: [2, 1],
      label: 'Temperature',
      measures: [{ name: 'Temperature', attribute: 'temp_c', unit: '°C', precision: 1 }],
    },
    {
      id: 'presence-sensor',
      type: 'presence-sensor',
      roomId: 'room-a',
      position: [2, 1.5],
      facingDegrees: 90,
      fieldOfViewDegrees: 100,
      range: 3,
    },
  ],
};

describe('floorplan entity placements', () => {
  it('converts room-relative placement coordinates to floorplan coordinates', () => {
    const roomRelative: Floorplan = {
      ...floorplan,
      rooms: floorplan.rooms.map(room => room.id === 'room-a'
        ? { ...room, layout: { ...room.layout, x: -8, y: 5 } }
        : room),
      entitySettings: { coordinates: 'room' },
      entityPlacements: [{
        id: 'room-relative-light',
        type: 'light',
        roomId: 'room-a',
        position: [1.5, 1],
      }],
    };

    expect(normalizeEntityPlacementCoordinates(roomRelative).entityPlacements?.[0]).toMatchObject({
      position: [-6.5, 6],
    });
    expect(normalizeEntityPlacementCoordinates(roomRelative).entitySettings?.coordinates).toBe('floorplan');
  });

  it('supports area-relative entity placements and resolves their bindings to the area', () => {
    const areaRelative: Floorplan = {
      ...floorplan,
      areas: [{
        id: 'deck',
        name: 'Deck',
        kind: 'deck',
        shape: 'rect',
        layout: { x: 10, y: 20, width: 4, height: 3 },
      }],
      entitySettings: { coordinates: 'room' },
      entityPlacements: [
        { id: 'deck-light', type: 'light', areaId: 'deck', position: [1, 1] },
        {
          id: 'deck-presence',
          type: 'presence-sensor',
          areaId: 'deck',
          position: [2, 1],
          facingDegrees: 180,
          fieldOfViewDegrees: 90,
          range: 3,
        },
      ],
    };
    const normalized = normalizeEntityPlacementCoordinates(areaRelative);

    validateEntityPlacements(normalized);
    expect(normalized.entityPlacements?.map(placement => 'position' in placement ? placement.position : undefined))
      .toEqual([[11, 21], [12, 21]]);
    expect(resolveBindings(normalized, [
      { ref: 'deck-light', entityId: 'light.deck', kind: 'light' },
      { ref: 'deck-presence', entityId: 'binary_sensor.deck_presence', kind: 'presence-sensor' },
    ], defaults.visuals).map(binding => binding.targetId)).toEqual(['deck', 'deck']);
  });

  it('rejects area placements outside an elliptical area', () => {
    expect(() => validateEntityPlacements({
      ...floorplan,
      areas: [{
        id: 'pond',
        name: 'Pond',
        kind: 'pond',
        shape: 'ellipse',
        layout: { x: 0, y: 0, width: 4, height: 2 },
      }],
      entityPlacements: [{
        id: 'pond-sensor',
        type: 'water-leak',
        areaId: 'pond',
        position: [0, 0],
      }],
    })).toThrow('invalid room, position, or height');
  });

  it('preserves absolute placement coordinates when the setting is omitted or floorplan', () => {
    const absolute = {
      ...floorplan,
      entityPlacements: [{
        id: 'absolute-light',
        type: 'light' as const,
        roomId: 'room-a',
        position: [1.5, 1] as [number, number],
      }],
    };
    expect(normalizeEntityPlacementCoordinates(absolute)).toBe(absolute);
    expect(normalizeEntityPlacementCoordinates({
      ...absolute,
      entitySettings: { coordinates: 'floorplan' },
    }).entityPlacements?.[0]).toMatchObject({ position: [1.5, 1] });
  });

  it('resolves HA bindings by placement ID', () => {
    const resolved = resolveBindings(floorplan, [
      { ref: 'ceiling-light', entityId: 'light.room_a', kind: 'light' },
      { ref: 'door-contact', entityId: 'binary_sensor.room_a_door', kind: 'door-contact' },
    ], defaults.visuals);

    expect(resolved.map(binding => binding.targetId)).toEqual(['room-a', 'a-door']);
  });

  it('validates and resolves room-positioned water-leak placements', () => {
    const plan: Floorplan = {
      ...floorplan,
      entitySettings: { coordinates: 'room' },
      entityPlacements: [{
        id: 'kitchen-water-leak',
        type: 'water-leak',
        roomId: 'room-a',
        position: [1, 1],
        height: 0.1,
      }],
    };
    const normalized = normalizeEntityPlacementCoordinates(plan);
    validateEntityPlacements(normalized);
    expect(resolveBindings(normalized, [
      { ref: 'kitchen-water-leak', entityId: 'binary_sensor.kitchen_leak', kind: 'water-leak' },
    ], defaults.visuals)[0].targetId).toBe('room-a');
  });

  it('allows a door-contact placement to reference a window connector', () => {
    const homeWithWindow: Floorplan = {
      ...floorplan,
      rooms: floorplan.rooms.map(room => room.id === 'room-a'
        ? {
          ...room,
          connectors: [
            ...room.connectors,
            {
              id: 'a-window',
              roomId: room.id,
              side: 'top',
              type: 'window',
              offset: 1.5,
              window: { type: 'tilt' },
            },
          ],
        }
        : room),
      entityPlacements: [{
        id: 'window-contact',
        type: 'door-contact',
        connectorId: 'a-window',
      }],
    };

    validateEntityPlacements(homeWithWindow);
    expect(resolveBindings(homeWithWindow, [
      { ref: 'window-contact', entityId: 'binary_sensor.room_a_window', kind: 'door-contact' },
    ], defaults.visuals)[0].targetId).toBe('a-window');
  });

  it('resolves cover and environmental sensor placements', () => {
    const resolved = resolveBindings(floorplan, [
      { ref: 'blind', entityId: 'cover.room_blind', kind: 'cover' },
      { ref: 'temperature', entityId: 'sensor.room_temperature', kind: 'environment-sensor' },
    ], defaults.visuals);
    expect(resolved.map(binding => binding.targetId)).toEqual(['a-door', 'room-a']);
  });

  it('rejects empty or invalid environmental measure definitions', () => {
    expect(() => validateEntityPlacements({
      ...floorplan,
      entityPlacements: [{
        id: 'empty-measures',
        type: 'environment-sensor',
        roomId: 'room-a',
        position: [2, 1],
        measures: [],
      }],
    })).toThrow('has invalid measures');
  });

  it('keeps legacy target-based bindings supported', () => {
    const resolved = resolveBindings(floorplan, [
      { ref: 'legacy-light', entityId: 'light.room_a', kind: 'light', targetId: 'room-a' },
    ], defaults.visuals);

    expect(resolved[0].targetId).toBe('room-a');
  });

  it('resolves sensor bindings to room placements and validates sensor geometry', () => {
    const resolved = resolveBindings(floorplan, [
      { ref: 'presence-sensor', entityId: 'binary_sensor.room_a_presence', kind: 'presence-sensor' },
    ], defaults.visuals);
    expect(resolved[0].targetId).toBe('room-a');
    expect(() => validateEntityPlacements({
      ...floorplan,
      entityPlacements: [{
        id: 'bad-sensor',
        type: 'motion-sensor',
        roomId: 'room-a',
        position: [1, 1],
        facingDegrees: 0,
        fieldOfViewDegrees: 400,
        range: 2,
      }],
    })).toThrow('invalid room, position, or sensor range/orientation');
  });

  it('rejects invalid placements and mismatched bindings', () => {
    expect(() => validateEntityPlacements({
      ...floorplan,
      entityPlacements: [{ id: 'bad-light', type: 'light', roomId: 'room-a', position: [8, 1] }],
    })).toThrow('invalid room, position, or height');
    expect(() => resolveBindings(floorplan, [
      { ref: 'ceiling-light', entityId: 'binary_sensor.light', kind: 'door-contact' },
    ], defaults.visuals)).toThrow('does not match its light placement');
    expect(() => resolveBindings(floorplan, [
      { ref: 'ceiling-light', entityId: 'light.room_a', kind: 'light', targetId: 'room-b' },
    ], defaults.visuals)).toThrow('conflicts with its placement target');
    expect(() => resolveBindings(floorplan, [
      { ref: 'unplaced', entityId: 'light.unplaced', kind: 'light' },
    ], defaults.visuals)).toThrow('needs a matching floorplan placement or a target');
  });
});
