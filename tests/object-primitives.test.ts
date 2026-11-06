import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_OBJECT_TYPES } from '../src/core/objects';
import { buildPrimitive, hasPrimitive } from '../src/renderer/object-primitives';

describe('object primitives', () => {
  const body = new THREE.MeshStandardMaterial();
  const accent = new THREE.MeshStandardMaterial();

  it.each(BUILT_IN_OBJECT_TYPES.map(type => [type.id, type] as const))('%s fits its footprint', (id, type) => {
    expect(hasPrimitive(id)).toBe(true);
    const size = { width: type.width!, depth: type.depth!, height: type.height! };
    const shape = buildPrimitive(id, size, body, accent)!;
    const box = new THREE.Box3().setFromObject(shape.group);
    const tolerance = 0.06;
    expect(box.min.x).toBeGreaterThanOrEqual(-size.width / 2 - tolerance);
    expect(box.max.x).toBeLessThanOrEqual(size.width / 2 + tolerance);
    expect(box.min.z).toBeGreaterThanOrEqual(-size.depth / 2 - tolerance);
    expect(box.max.z).toBeLessThanOrEqual(size.depth / 2 + tolerance);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.001);
    expect(box.max.y).toBeLessThanOrEqual(size.height + 0.03);
    expect(box.max.y).toBeGreaterThan(size.height * 0.5);
  });

  it('gives only the fan a spinning part and returns nothing for unknown types', () => {
    expect(buildPrimitive('fan', { width: 1.2, depth: 1.2, height: 0.3 }, body, accent)?.spinner).toBeDefined();
    expect(buildPrimitive('sofa', { width: 2, depth: 0.9, height: 0.85 }, body, accent)?.spinner).toBeUndefined();
    expect(buildPrimitive('mystery', { width: 1, depth: 1, height: 1 }, body, accent)).toBeUndefined();
  });
});
