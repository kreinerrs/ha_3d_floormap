import type { Connector, Room, Side } from './types';

export interface RoomEdge {
  axis: 'x' | 'z';
  fixed: number;
  start: number;
  end: number;
  side: Side;
}

type Layout = Room['layout'];

/**
 * Outline corners as absolute floorplan coordinates.
 * @param room Room with an optional outline (corners in metres from the top-left of its layout).
 * @returns The corners, or the four corners of the layout rectangle when there is no usable outline.
 */
export const roomPolygon = (room: Pick<Room, 'layout' | 'outline'>): [number, number][] => {
  const { x, y, width, height } = room.layout;
  const outline = room.outline;
  if (Array.isArray(outline) && outline.length >= 4
    && outline.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) {
    return outline.map(([px, py]) => [x + px, y + py]);
  }
  return [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
};

/**
 * Absolute corners of an outline for any rectangle-based item.
 * @param layout The bounding box.
 * @param outline Optional corners relative to the top-left of the bounding box.
 * @returns Absolute corners (the rectangle when there is no usable outline).
 */
export const outlinePolygon = (layout: Layout, outline?: [number, number][]): [number, number][] =>
  roomPolygon({ layout, outline });

/**
 * Axis-aligned wall edges of a room. The outline runs clockwise on the plan (y down),
 * so rightwards is a top wall, downwards a right wall, leftwards a bottom wall, upwards a left wall.
 * @param room The room.
 * @returns One edge per side of the outline; diagonal edges are skipped.
 */
export const roomEdges = (room: Pick<Room, 'layout' | 'outline'>): RoomEdge[] => {
  const polygon = roomPolygon(room);
  const edges: RoomEdge[] = [];
  polygon.forEach(([x1, y1], index) => {
    const [x2, y2] = polygon[(index + 1) % polygon.length];
    if (Math.abs(y1 - y2) < 1e-6 && Math.abs(x1 - x2) > 1e-6) {
      edges.push({ axis: 'x', fixed: y1, start: Math.min(x1, x2), end: Math.max(x1, x2), side: x2 > x1 ? 'top' : 'bottom' });
    } else if (Math.abs(x1 - x2) < 1e-6 && Math.abs(y1 - y2) > 1e-6) {
      edges.push({ axis: 'z', fixed: x1, start: Math.min(y1, y2), end: Math.max(y1, y2), side: y2 > y1 ? 'right' : 'left' });
    }
  });
  return edges;
};

/**
 * Whether a point lies strictly inside a room (outline-aware).
 * @param room The room.
 * @param x Plan x in metres.
 * @param z Plan y in metres.
 * @returns True when the point is inside the room shape.
 */
export const pointInRoom = (room: Pick<Room, 'layout' | 'outline'>, x: number, z: number): boolean => {
  const polygon = roomPolygon(room);
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > z) !== (yj > z) && x < (xj - xi) * (z - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/**
 * Whether a point is inside a room or on its boundary.
 * @param room The room.
 * @param x Plan x in metres.
 * @param z Plan y in metres.
 * @returns True when the point touches the room.
 */
export const roomTouchesPoint = (room: Pick<Room, 'layout' | 'outline'>, x: number, z: number): boolean => {
  const tolerance = 0.001;
  return pointInRoom(room, x, z) || roomEdges(room).some(edge => {
    const along = edge.axis === 'x' ? x : z;
    const across = edge.axis === 'x' ? z : x;
    return Math.abs(across - edge.fixed) <= tolerance && along >= edge.start - tolerance && along <= edge.end + tolerance;
  });
};

/**
 * Plan coordinate of a connector on its wall.
 * With an outline, the wall is the edge that faces the connector's side and covers its offset
 * (offsets are measured from the bounding box); `wallAt` picks the wall, otherwise the outermost one.
 * @param room The room owning the connector.
 * @param connector The connector.
 * @returns Plan position of the connector centre.
 */
export const connectorPoint = (room: Room, connector: Connector): { x: number; z: number } => {
  const { x, y, width, height } = room.layout;
  const horizontal = connector.side === 'top' || connector.side === 'bottom';
  const along = (horizontal ? x : y) + connector.offset;
  const outer = connector.side === 'top' ? y : connector.side === 'bottom' ? y + height
    : connector.side === 'left' ? x : x + width;
  let fixed = outer;
  if (room.outline) {
    const candidates = roomEdges(room).filter(edge => edge.side === connector.side
      && along >= edge.start - 1e-6 && along <= edge.end + 1e-6);
    if (connector.wallAt !== undefined && Number.isFinite(connector.wallAt)) {
      const wanted = (horizontal ? y : x) + connector.wallAt;
      const best = [...candidates].sort((a, b) => Math.abs(a.fixed - wanted) - Math.abs(b.fixed - wanted))[0];
      if (best) fixed = best.fixed;
    } else if (candidates.length) {
      const outward = connector.side === 'top' || connector.side === 'left' ? -1 : 1;
      fixed = candidates.reduce((best, edge) => (edge.fixed * outward > best * outward ? edge.fixed : best), candidates[0].fixed);
    }
  }
  return horizontal ? { x: along, z: fixed } : { x: fixed, z: along };
};
