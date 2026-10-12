import { describe, expect, it } from 'vitest';
import { parseCardConfig } from '../src/card/card-config';

describe('Home Assistant card configuration', () => {
  it('normalises a light binding and uses safe light actions by default', () => {
    const parsed = parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: { source: '/local/floorplans/home.json' },
      bindings: { dining: { entity: 'light.dining', target: 'dining-room' } },
    });
    expect(parsed.source).toBe('/local/floorplans/home.json');
    expect(parsed.bindings).toEqual([{
      ref: 'dining',
      entityId: 'light.dining',
      targetId: 'dining-room',
      kind: 'light',
    }]);
    expect(parsed.actions.get('dining')).toEqual({
      entityId: 'light.dining',
      tap: 'toggle',
      hold: 'more-info',
    });
  });

  it('rejects incomplete floorplan and entity configuration', () => {
    expect(() => parseCardConfig({ type: 'custom:three-floorplan-card' }))
      .toThrow('Set floorplan to a URL or to { source: URL }');
    expect(() => parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/home.json',
      bindings: { light: { entity: 'not-an-entity', target: 'room' } },
    })).toThrow('bindings.light.entity must be a Home Assistant entity ID');
  });

  it('supports switch visualization and rejects malformed appearance values', () => {
    const parsed = parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/home.json',
      appearance: { ambient_intensity: 0 },
      bindings: { fan: { entity: 'switch.fan', target: 'utility-room' } },
    });
    expect(parsed.bindings[0].kind).toBe('light');
    expect(parsed.actions.get('fan')?.tap).toBe('toggle');
    expect(parsed.renderer.visuals.ambientIntensity).toBe(0);
    expect(() => parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/home.json',
      camera: { allow_zoom: 'yes' },
    })).toThrow('allow_zoom must be true or false');
  });
});
