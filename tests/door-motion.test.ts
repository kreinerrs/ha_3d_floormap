import { describe, expect, it } from 'vitest';
import { animateDoorAngle, doorPose } from '../src/core/door-motion';
import type { Opening } from '../src/core/types';

describe('door motion', () => {
  it('places a vertical-wall door leaf across its opening when closed', () => {
    const opening: Opening = {
      id: 'door-a--door-b',
      type: 'door',
      lineKey: 'z:4.000',
      axis: 'z',
      fixed: 4,
      centre: 2,
      width: 0.8,
      connector: {
        id: 'door-a',
        roomId: 'room-a',
        side: 'left',
        type: 'door',
        offset: 2,
        door: { hinge: 'left', swing: 'inward', openAngle: 70 },
      },
    };

    const pose = doorPose(opening, 4, 2);
    expect(pose.closed).toBe(Math.PI / 2);
    expect(pose.hingeX).toBe(4);
    expect(pose.hingeZ).toBe(2.4);
    expect(pose.leafDirection).toBe(1);
    expect(pose.open).toBeCloseTo(Math.PI / 2 - (70 * Math.PI / 180));
  });

  it('places a right-wall left hinge at the north end from inside the room', () => {
    const opening: Opening = {
      id: 'front-hall-right-door',
      type: 'door',
      lineKey: 'z:5.8',
      axis: 'z',
      fixed: 5.8,
      centre: 1.2,
      width: 0.9,
      connector: {
        id: 'front-hall-right-door',
        roomId: 'front-hall',
        side: 'right',
        type: 'door',
        offset: 0.8,
        door: { hinge: 'left', swing: 'inward', openAngle: 85 },
      },
    };

    const pose = doorPose(opening, -5.8, 1.2);
    expect(pose.hingeZ).toBeCloseTo(0.75);
    expect(pose.leafDirection).toBe(-1);
    expect(pose.open).toBeCloseTo(Math.PI / 2 - (85 * Math.PI / 180));
  });

  it('places a bottom-wall left hinge at the east end from inside the room', () => {
    const opening: Opening = {
      id: 'bottom-door',
      type: 'door',
      lineKey: 'x:5',
      axis: 'x',
      fixed: 5,
      centre: 2,
      width: 0.8,
      connector: {
        id: 'bottom-door',
        roomId: 'room-a',
        side: 'bottom',
        type: 'door',
        offset: 2,
        door: { hinge: 'left', swing: 'inward', openAngle: 70 },
      },
    };

    const pose = doorPose(opening, 2, 5);
    expect(pose.hingeX).toBe(2.4);
    expect(pose.leafDirection).toBe(-1);
    expect(pose.open).toBeCloseTo(-70 * Math.PI / 180);
  });

  it('smoothly animates between closed and open angles', () => {
    expect(animateDoorAngle(0, 1, 100, 100)).toBe(0);
    expect(animateDoorAngle(0, 1, 100, 300)).toBeCloseTo(0.5);
    expect(animateDoorAngle(0, 1, 100, 500)).toBe(1);
  });
});
