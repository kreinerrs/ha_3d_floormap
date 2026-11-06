import { describe, expect, it } from 'vitest';
import { formatIgnoredElements, listIgnoredElements } from '../src/core/ignored-elements';
import { normalizeEntityPlacementCoordinates, validateEntityPlacements } from '../src/core/entity-placement';
import { resolveOpenings } from '../src/core/geometry';
import { defaults } from '../src/core/config';
import type { Floorplan } from '../src/core/types';

import sampleJson from '../public/floorplans/floorplan_scheme_3_0.json';

const sample = sampleJson as unknown as Floorplan;

describe('ignored elements', () => {
  it('reports unsupported parts of a 3.0 file', () => {
    const items = listIgnoredElements(sample);
    const categories = new Set(items.map(item => item.category));
    expect(categories).not.toContain('floor');
    expect(categories).not.toContain('stairs');
    expect(categories).not.toContain('object');
  });

  it('flags unsupported entity types only', () => {
    const fp = { rooms: [], relationships: [], entityPlacements: [
      { id: 'a', type: 'light', roomId: 'r', position: [0, 0] },
      { id: 'b', type: 'camera', roomId: 'r', position: [0, 0] },
    ] } as unknown as Floorplan;
    expect(listIgnoredElements(fp)).toEqual([{ category: 'entity', id: 'b', reason: 'type "camera" is not supported' }]);
  });

  it('reports nothing for a plain file', () => {
    expect(formatIgnoredElements([])).toBe('No ignored elements.');
  });

  it('still loads the 3.0 sample', () => {
    const fp = normalizeEntityPlacementCoordinates(sample);
    expect(() => validateEntityPlacements(fp)).not.toThrow();
    expect(resolveOpenings(fp, { ...defaults.visuals, ...fp.buildingDefaults }).length).toBeGreaterThan(0);
  });
});
