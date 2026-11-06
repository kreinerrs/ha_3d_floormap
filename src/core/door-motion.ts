import type { Opening } from './types';

export function doorPose(opening: Opening, x: number, z: number): {
  closed: number;
  open: number;
  hingeX: number;
  hingeZ: number;
  leafDirection: number;
} {
  const hinge = opening.connector.door?.hinge ?? 'left';
  const leftHinge = hinge === 'left';
  const sideDirection = opening.axis === 'x'
    ? opening.connector.side === 'top' ? -1 : 1
    : opening.connector.side === 'right' ? -1 : 1;
  const hingeDirection = sideDirection * (leftHinge ? 1 : -1);
  const leafDirection = opening.axis === 'x' ? -hingeDirection : hingeDirection;
  const closed = opening.axis === 'x' ? 0 : Math.PI / 2;
  const door = opening.connector.door;
  const swing = opening.connector.door?.swing;
  const swingDirection = swing === 'outward' ? -1 : 1;
  const inwardSideDirection = opening.connector.side === 'top' || opening.connector.side === 'left' ? 1 : -1;
  const openDirection = door?.style === 'double'
    ? -(leftHinge ? 1 : -1) * (swing === undefined ? 1 : swingDirection * inwardSideDirection)
    : (leftHinge ? -1 : 1) * swingDirection;

  return {
    closed,
    open: closed + openDirection * (door?.openAngle ?? 82) * Math.PI / 180,
    hingeX: x + (opening.axis === 'x' ? hingeDirection * opening.width / 2 : 0),
    hingeZ: z + (opening.axis === 'z' ? hingeDirection * opening.width / 2 : 0),
    leafDirection,
  };
}

export function animateDoorAngle(from: number, to: number, startedAt: number, now: number, duration = 400): number {
  const progress = Math.max(0, Math.min(1, (now - startedAt) / duration));
  const eased = progress * progress * (3 - 2 * progress);
  return from + (to - from) * eased;
}
