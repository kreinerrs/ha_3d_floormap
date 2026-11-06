import * as THREE from 'three';

export interface PrimitiveBuild {
  group: THREE.Group;
  /** Parts that turn while the object is active (a fan's blades). */
  spinner?: THREE.Object3D;
}

interface Size {
  width: number;
  depth: number;
  height: number;
}

type Builder = (size: Size, parts: Parts) => THREE.Object3D | void;

/** Creates meshes in a frame where x is the width, z the depth (front at -z) and y goes up from the bottom of the object. */
class Parts {
  readonly group = new THREE.Group();
  constructor(private readonly body: THREE.Material, private readonly accent: THREE.Material) {}

  box(width: number, height: number, depth: number, x: number, y: number, z: number, accent = false): THREE.Mesh {
    return this.add(new THREE.BoxGeometry(width, height, depth), x, y, z, accent);
  }

  cylinder(radius: number, height: number, x: number, y: number, z: number, accent = false, axis: 'y' | 'z' = 'y', segments = 20): THREE.Mesh {
    const mesh = this.add(new THREE.CylinderGeometry(radius, radius, height, segments), x, y, z, accent);
    if (axis === 'z') mesh.rotation.x = Math.PI / 2;
    return mesh;
  }

  private add(geometry: THREE.BufferGeometry, x: number, y: number, z: number, accent: boolean): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, accent ? this.accent : this.body);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }
}

const EDGE = 0.012;

const cabinet = (size: Size, p: Parts, split?: number): void => {
  const { width, depth, height } = size;
  p.box(width, height, depth, 0, height / 2, 0);
  if (split !== undefined) p.box(width * 0.96, EDGE, EDGE, 0, height * split, -depth / 2 - EDGE / 2, true);
};

const handle = (p: Parts, x: number, y: number, z: number, length: number): void => {
  p.box(0.025, length, 0.03, x, y, z - 0.015, true);
};

const frontLoader = (size: Size, p: Parts): void => {
  const { width, depth, height } = size;
  cabinet(size, p);
  p.box(width * 0.9, height * 0.12, EDGE, 0, height * 0.9, -depth / 2 - EDGE / 2, true);
  p.cylinder(Math.min(width, height) * 0.36, EDGE * 2, 0, height * 0.45, -depth / 2 - EDGE, true, 'z');
};

const seat = (size: Size, p: Parts, armWidth: number, baseFraction: number): void => {
  const { width, depth, height } = size;
  const base = height * baseFraction;
  p.box(width, base, depth, 0, base / 2, 0);
  p.box(width, height - base, depth * 0.22, 0, base + (height - base) / 2, depth / 2 - depth * 0.11);
  const armHeight = height * 0.65;
  for (const side of [-1, 1]) p.box(armWidth, armHeight - base, depth * 0.78, side * (width / 2 - armWidth / 2), base + (armHeight - base) / 2, -depth * 0.11);
  p.box(width - armWidth * 2, 0.06, depth * 0.72, 0, base + 0.03, -depth * 0.1, true);
};

const legs = (p: Parts, width: number, depth: number, height: number, inset: number, thickness: number): void => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    p.box(thickness, height, thickness, sx * (width / 2 - inset), height / 2, sz * (depth / 2 - inset));
  }
};

const BUILDERS: Record<string, Builder> = {
  refrigerator: (size, p) => {
    cabinet(size, p, 0.68);
    handle(p, size.width * 0.38, size.height * 0.82, -size.depth / 2, size.height * 0.2);
    handle(p, size.width * 0.38, size.height * 0.5, -size.depth / 2, size.height * 0.35);
  },
  freezer: (size, p) => {
    cabinet(size, p);
    handle(p, size.width * 0.38, size.height * 0.6, -size.depth / 2, size.height * 0.3);
  },
  stove: (size, p) => {
    const { width, depth, height } = size;
    cabinet(size, p);
    p.box(width * 0.8, height * 0.4, EDGE, 0, height * 0.42, -depth / 2 - EDGE / 2, true);
    p.box(width * 0.7, 0.025, 0.025, 0, height * 0.78, -depth / 2 - 0.02, true);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      p.cylinder(Math.min(width, depth) * 0.17, 0.012, sx * width * 0.22, height + 0.006, sz * depth * 0.22, true);
    }
  },
  dishwasher: (size, p) => {
    const { width, depth, height } = size;
    cabinet(size, p);
    p.box(width * 0.9, height * 0.1, EDGE, 0, height * 0.92, -depth / 2 - EDGE / 2, true);
    p.box(width * 0.5, 0.025, 0.03, 0, height * 0.8, -depth / 2 - 0.015, true);
  },
  'washing-machine': frontLoader,
  dryer: frontLoader,
  microwave: (size, p) => {
    const { width, depth, height } = size;
    cabinet(size, p);
    p.box(width * 0.65, height * 0.7, EDGE, -width * 0.12, height / 2, -depth / 2 - EDGE / 2, true);
    p.box(width * 0.16, height * 0.7, EDGE, width * 0.38, height / 2, -depth / 2 - EDGE / 2, true);
  },
  'water-heater': (size, p) => {
    const radius = Math.min(size.width, size.depth) / 2;
    p.cylinder(radius, size.height, 0, size.height / 2, 0);
    p.cylinder(radius * 1.02, size.height * 0.06, 0, size.height * 0.88, 0, true);
  },
  tv: (size, p) => {
    const { width, depth, height } = size;
    p.box(width, height, depth, 0, height / 2, 0);
    p.box(width * 0.96, height * 0.92, EDGE, 0, height / 2, -depth / 2 - EDGE / 2, true);
  },
  fan: (size, p) => {
    const { width, depth, height } = size;
    p.cylinder(Math.min(width, depth) * 0.09, height, 0, height / 2, 0);
    const blades = new THREE.Group();
    blades.position.y = height * 0.35;
    for (let index = 0; index < 4; index++) {
      const arm = new THREE.Group();
      arm.rotation.y = index * Math.PI / 2;
      const blade = p.box(width * 0.42, 0.012, Math.min(width, depth) * 0.12, width * 0.28, 0, 0, true);
      p.group.remove(blade);
      arm.add(blade);
      blades.add(arm);
    }
    p.group.add(blades);
    return blades;
  },
  sofa: (size, p) => seat(size, p, size.width * 0.1, 0.45),
  armchair: (size, p) => seat(size, p, size.width * 0.14, 0.45),
  'bed-single': (size, p) => bed(size, p, 1),
  'bed-double': (size, p) => bed(size, p, 2),
  wardrobe: (size, p) => {
    cabinet(size, p);
    p.box(EDGE, size.height * 0.96, EDGE, 0, size.height / 2, -size.depth / 2 - EDGE / 2, true);
    for (const side of [-1, 1]) handle(p, side * size.width * 0.06, size.height * 0.5, -size.depth / 2, size.height * 0.15);
  },
  table: (size, p) => {
    const { width, depth, height } = size;
    p.box(width, 0.05, depth, 0, height - 0.025, 0);
    legs(p, width, depth, height - 0.05, 0.05, 0.06);
  },
  desk: (size, p) => {
    const { width, depth, height } = size;
    p.box(width, 0.04, depth, 0, height - 0.02, 0);
    for (const side of [-1, 1]) p.box(0.04, height - 0.04, depth * 0.95, side * (width / 2 - 0.03), (height - 0.04) / 2, 0);
    p.box(width - 0.12, height * 0.3, 0.02, 0, height * 0.7, depth * 0.4, true);
  },
  chair: (size, p) => {
    const { width, depth, height } = size;
    const seatHeight = height * 0.5;
    p.box(width, 0.04, depth, 0, seatHeight, 0);
    legs(p, width, depth, seatHeight, 0.03, 0.04);
    p.box(width, height - seatHeight, 0.04, 0, seatHeight + (height - seatHeight) / 2, depth / 2 - 0.02);
  },
  shelf: (size, p) => {
    const { width, depth, height } = size;
    for (const side of [-1, 1]) p.box(0.03, height, depth, side * (width / 2 - 0.015), height / 2, 0);
    p.box(width, height, 0.01, 0, height / 2, depth / 2 - 0.005, true);
    for (let index = 0; index <= 4; index++) p.box(width - 0.06, 0.03, depth, 0, 0.015 + index * (height - 0.03) / 4, 0);
  },
  counter: (size, p) => {
    const { width, depth, height } = size;
    p.box(width, height - 0.04, depth, 0, (height - 0.04) / 2, 0);
    p.box(width + 0.02, 0.04, depth + 0.02, 0, height - 0.02, 0, true);
    p.box(EDGE, height * 0.8, EDGE, 0, height * 0.42, -depth / 2 - EDGE / 2, true);
    for (const side of [-1, 1]) handle(p, side * width * 0.08, height * 0.75, -depth / 2, 0.12);
  },
};

function bed(size: Size, p: Parts, pillows: number): void {
  const { width, depth, height } = size;
  const frame = height * 0.45;
  p.box(width, frame, depth, 0, frame / 2, 0);
  p.box(width * 0.96, height * 0.4, depth * 0.94, 0, frame + height * 0.2, -depth * 0.01, true);
  p.box(width, height, 0.06, 0, height / 2, depth / 2 - 0.03);
  const pillowWidth = width / pillows * 0.72;
  for (let index = 0; index < pillows; index++) {
    const x = pillows === 1 ? 0 : (index - 0.5) * width / 2;
    p.box(pillowWidth, 0.1, depth * 0.16, x, frame + height * 0.4 + 0.05, depth * 0.36);
  }
}

/**
 * Whether a simplified shape exists for the type.
 * @param type Object type id.
 */
export const hasPrimitive = (type: string): boolean => type in BUILDERS;

/**
 * Builds a simplified 3D shape for a built-in object type, filling width x depth x height with the front at -z.
 * @param type Object type id.
 * @param size Width, depth and height in metres.
 * @param body Material for the main parts (tinted by status).
 * @param accent Material for doors, handles and cushions.
 * @returns The shape and its optional spinning part, or undefined when the type has no shape.
 */
export const buildPrimitive = (type: string, size: Size, body: THREE.Material, accent: THREE.Material): PrimitiveBuild | undefined => {
  const builder = BUILDERS[type];
  if (!builder) return undefined;
  const parts = new Parts(body, accent);
  const spinner = builder(size, parts);
  return { group: parts.group, ...(spinner ? { spinner } : {}) };
};
