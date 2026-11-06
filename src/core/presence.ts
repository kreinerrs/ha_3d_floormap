import type { EntityState } from './types';
import type { WallLine } from './geometry';

export function presencePosition(
  state: EntityState | undefined,
  attributeName: string | undefined,
): [number, number] | undefined {
  if (!state || !attributeName) return undefined;
  const value = state.attributes[attributeName];
  if (Array.isArray(value) && value.length >= 2
    && typeof value[0] === 'number' && Number.isFinite(value[0])
    && typeof value[1] === 'number' && Number.isFinite(value[1])) {
    return [value[0], value[1]];
  }
  if (value && typeof value === 'object' && 'x' in value && 'y' in value) {
    const { x, y } = value;
    if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
      return [x, y];
    }
  }
  return undefined;
}

export function sensorSectorPoint(
  position: [number, number],
  angleDegrees: number,
  distance: number,
): [number, number] {
  const radians = angleDegrees * Math.PI / 180;
  return [position[0] + Math.sin(radians) * distance, position[1] - Math.cos(radians) * distance];
}

export function sensorVisibilityPolygon(
  origin: [number, number],
  facingDegrees: number,
  fieldOfViewDegrees: number,
  range: number,
  walls: WallLine[],
): [number, number][] {
  const halfFov = fieldOfViewDegrees / 2;
  const offsets = new Set<number>();
  const rayCount = Math.max(1, Math.ceil(fieldOfViewDegrees / 3));
  for (let index = 0; index <= rayCount; index += 1) {
    offsets.add(-halfFov + fieldOfViewDegrees * index / rayCount);
  }

  for (const wall of walls) {
    const endpoints: [number, number][] = wall.axis === 'x'
      ? [[wall.start, wall.fixed], [wall.end, wall.fixed]]
      : [[wall.fixed, wall.start], [wall.fixed, wall.end]];
    for (const [x, y] of endpoints) {
      const absoluteAngle = Math.atan2(x - origin[0], -(y - origin[1])) * 180 / Math.PI;
      const offset = normalizeDegrees(absoluteAngle - facingDegrees);
      if (offset < -halfFov || offset > halfFov) continue;
      offsets.add(Math.max(-halfFov, offset - 0.05));
      offsets.add(offset);
      offsets.add(Math.min(halfFov, offset + 0.05));
    }
  }

  return [...offsets]
    .sort((a, b) => a - b)
    .map(offset => {
      const angle = (facingDegrees + offset) * Math.PI / 180;
      const direction: [number, number] = [Math.sin(angle), -Math.cos(angle)];
      const distance = nearestWallDistance(origin, direction, range, walls);
      return [origin[0] + direction[0] * distance, origin[1] + direction[1] * distance];
    });
}

function normalizeDegrees(degrees: number): number {
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}

function nearestWallDistance(
  origin: [number, number],
  direction: [number, number],
  range: number,
  walls: WallLine[],
): number {
  let nearest = range;
  for (const wall of walls) {
    const [start, end] = wall.axis === 'x'
      ? [[wall.start, wall.fixed], [wall.end, wall.fixed]] as const
      : [[wall.fixed, wall.start], [wall.fixed, wall.end]] as const;
    const segment: [number, number] = [end[0] - start[0], end[1] - start[1]];
    const relative: [number, number] = [start[0] - origin[0], start[1] - origin[1]];
    const denominator = direction[0] * segment[1] - direction[1] * segment[0];
    if (Math.abs(denominator) < 1e-9) continue;
    const distance = (relative[0] * segment[1] - relative[1] * segment[0]) / denominator;
    const alongWall = (relative[0] * direction[1] - relative[1] * direction[0]) / denominator;
    if (distance > 1e-6 && alongWall >= -1e-9 && alongWall <= 1 + 1e-9) {
      nearest = Math.min(nearest, distance);
    }
  }
  return nearest;
}
