import { describe, expect, it } from 'vitest';
import { presencePosition, sensorSectorPoint, sensorVisibilityPolygon } from '../src/core/presence';
import { compassTickRotation, sunDirection, sunPosition } from '../src/core/sun';

describe('presence sensor helpers', () => {
  it('maps bearings clockwise from the floorplan top edge', () => {
    const top = sensorSectorPoint([2, 3], 0, 4);
    const right = sensorSectorPoint([2, 3], 90, 4);
    expect(top[0]).toBeCloseTo(2);
    expect(top[1]).toBeCloseTo(-1);
    expect(right[0]).toBeCloseTo(6);
    expect(right[1]).toBeCloseTo(3);
  });

  it('clips the coverage polygon at walls across the field of view', () => {
    const polygon = sensorVisibilityPolygon([2, 3], 0, 90, 10, [
      { key: 'x:1.000', axis: 'x', fixed: 1, start: -100, end: 100 },
    ]);
    expect(polygon.length).toBeGreaterThan(2);
    for (const [, y] of polygon) {
      expect(y).toBeCloseTo(1, 2);
    }
  });

  it('reads only finite reported coordinates from the configured attribute', () => {
    expect(presencePosition({
      entity_id: 'binary_sensor.room_presence',
      state: 'on',
      attributes: { person_position: { x: 1.25, y: 2.5 } },
    }, 'person_position')).toEqual([1.25, 2.5]);
    expect(presencePosition({
      entity_id: 'binary_sensor.room_presence',
      state: 'on',
      attributes: { person_position: [1, 2] },
    }, 'person_position')).toEqual([1, 2]);
    expect(presencePosition({
      entity_id: 'binary_sensor.room_presence',
      state: 'on',
      attributes: { person_position: [1, 'bad'] },
    }, 'person_position')).toBeUndefined();
  });
});

describe('Home Assistant sun position helpers', () => {
  it('aligns compass tick bars with their north-rotated positions', () => {
    const northDegrees = 30;
    const northAngle = -northDegrees * Math.PI / 180;
    const tickAngle = compassTickRotation(northDegrees, 0);
    const radial = [Math.sin(northAngle), -Math.cos(northAngle)];
    const barAxis = [Math.sin(tickAngle), Math.cos(tickAngle)];

    expect(radial[0] * barAxis[1] - radial[1] * barAxis[0]).toBeCloseTo(0);
    expect(compassTickRotation(30, 1)).toBeCloseTo(-Math.PI / 3);
  });

  it('parses azimuth and elevation and maps compass bearings to the floorplan', () => {
    const position = sunPosition({
      attributes: { azimuth: 90, elevation: 30 },
    });
    expect(position).toEqual({ azimuth: 90, elevation: 30 });
    expect(sunDirection(position!, 0).x).toBeCloseTo(Math.cos(Math.PI / 6));
    expect(sunDirection(position!, 0).y).toBeCloseTo(0.5);
    expect(sunDirection(position!, 90).x).toBeCloseTo(0);
    expect(sunDirection(position!, 90).z).toBeCloseTo(-Math.cos(Math.PI / 6));
  });

  it('ignores missing or invalid HA sun attributes', () => {
    expect(sunPosition(undefined)).toBeUndefined();
    expect(sunPosition({ attributes: { azimuth: '90', elevation: 20 } })).toBeUndefined();
  });
});
