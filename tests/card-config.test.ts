import { describe, expect, it } from 'vitest';
import { parseCardConfig, resolveCelestialConfig, updatePlacementBinding } from '../src/card/card-config';

describe('Home Assistant card configuration', () => {
  it('reads object display defaults and rejects unknown modes', () => {
    const base = { type: 'custom:three-floorplan-card' as const, floorplan: '/a.json' };
    expect(parseCardConfig(base).objects).toEqual({ all: undefined, categories: {} });
    expect(parseCardConfig({ ...base, objects: { display: 'transparent', furniture: 'hidden' } }).objects)
      .toEqual({ all: 'transparent', categories: { furniture: 'hidden' } });
    expect(() => parseCardConfig({ ...base, objects: { display: 'ghost' as never } })).toThrow(/objects.display/);
  });

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

  it('defaults to the standard style and accepts the comic and futuristic styles', () => {
    const config = (appearance?: Record<string, unknown>) => parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/home.json',
      appearance,
    });

    expect(config().renderer.style).toBe('standard');
    expect(config().renderer.lineThickness).toBe(3);
    expect(config({ style: 'comic' }).renderer.style).toBe('comic');
    expect(config({ style: 'futuristic' }).renderer.style).toBe('futuristic');
    expect(config({ style: 'comic', line_thickness: 4.5 }).renderer.lineThickness).toBe(4.5);
    expect(() => config({ style: 'watercolor' })).toThrow(
      'appearance.style must be standard, comic, or futuristic',
    );
    expect(() => config({ line_thickness: 0.5 })).toThrow(
      'line_thickness must be a number greater than or equal to 1',
    );
  });

  it('parses discrete and numeric room status rules', () => {
    const parsed = parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/home.json',
      room_status: [
        {
          room: 'living-room',
          entity: 'binary_sensor.living_occupied',
          states: { on: '#22aa55', off: '#777777' },
        },
        {
          room: 'bedroom',
          entity: 'sensor.bedroom_climate',
          attribute: 'temperature',
          ranges: [
            { max: 18, color: '#4488ff' },
            { max: 24, color: '#44bb66' },
            { color: '#ff5533' },
          ],
        },
      ],
    });
    expect(parsed.roomStatus).toEqual([
      {
        roomId: 'living-room',
        entityId: 'binary_sensor.living_occupied',
        states: { on: '#22aa55', off: '#777777' },
      },
      {
        roomId: 'bedroom',
        entityId: 'sensor.bedroom_climate',
        attribute: 'temperature',
        ranges: [
          { max: 18, color: '#4488ff' },
          { max: 24, color: '#44bb66' },
          { color: '#ff5533' },
        ],
      },
    ]);
    expect(parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/home.json',
    }).roomStatus).toEqual([]);
  });

  it('rejects invalid room status mappings and ranges', () => {
    const config = (roomStatus: unknown) => parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/home.json',
      room_status: roomStatus,
    });
    expect(() => config([{
      room: 'living-room',
      entity: 'binary_sensor.occupied',
      states: { on: 'green' },
    }])).toThrow('room_status[0].states must map state names to #RRGGBB colors');
    expect(() => config([{
      room: 'bedroom',
      entity: 'sensor.temperature',
      ranges: [{ max: 24, color: '#44bb66' }, { max: 18, color: '#4488ff' }],
    }])).toThrow('room_status[0].ranges max values must be finite and strictly increasing');
    expect(() => config([{
      room: 'bedroom',
      entity: 'sensor.temperature',
      ranges: [{ color: '#44bb66' }, { max: 30, color: '#ff5533' }],
    }])).toThrow('room_status[0] may only omit max on the last range');
  });

  it('parses named camera views and defaults to none', () => {
    const parsed = parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/home.json',
      camera_views: [
        {
          id: 'kitchen-entry',
          name: 'Kitchen from entry',
          position: [2, 5, -3],
          target: [8, 0, 4],
        },
      ],
    });
    expect(parsed.cameraViews).toEqual([{
      id: 'kitchen-entry',
      name: 'Kitchen from entry',
      position: [2, 5, -3],
      target: [8, 0, 4],
    }]);
    expect(parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/home.json',
    }).cameraViews).toEqual([]);
  });

  it('rejects invalid and duplicate camera view definitions', () => {
    const config = (cameraViews: unknown) => parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/home.json',
      camera_views: cameraViews,
    });
    expect(() => config([{
      id: 'kitchen',
      name: 'Kitchen',
      position: [2, 5],
      target: [8, 0, 4],
    }])).toThrow('camera_views[0].position must be three finite coordinates [x, height, y]');
    expect(() => config([
      { id: 'kitchen', name: 'Kitchen', position: [2, 5, -3], target: [8, 0, 4] },
      { id: 'kitchen', name: 'Kitchen again', position: [3, 5, -3], target: [8, 0, 4] },
    ])).toThrow('camera_views cannot contain duplicate ID "kitchen"');
    expect(() => config([{
      id: 'kitchen',
      name: 'Kitchen',
      position: [2, 5, -3],
      target: [2, 5, -3],
    }])).toThrow('camera_views[0].position and target must differ');
  });

  it('configures the display height in pixels', () => {
    expect(parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/home.json',
      height: 900,
    }).height).toBe(900);
    expect(parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/home.json',
    }).height).toBeUndefined();
    expect(() => parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/home.json',
      height: 200,
    })).toThrow('height must be a number greater than or equal to 240');
  });

  it('configures the toolbar position and rejects unsupported positions', () => {
    const parsed = parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/home.json',
      toolbar: { position: 'right' },
    });
    expect(parsed.toolbarPosition).toBe('right');
    expect(parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/home.json',
    }).toolbarPosition).toBe('left');
    for (const position of ['top', 'bottom'] as const) {
      expect(parseCardConfig({
        type: 'custom:three-floorplan-card',
        floorplan: '/local/home.json',
        toolbar: { position },
      }).toolbarPosition).toBe(position);
    }
    expect(() => parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/home.json',
      toolbar: { position: 'centre' },
    })).toThrow('toolbar.position must be left, right, top, or bottom');
  });

  it('allows an input_boolean helper to be configured as a virtual light', () => {
    const parsed = parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/home.json',
      bindings: {
        virtualLight: {
          entity: 'input_boolean.virtual_living_room_light',
          kind: 'light',
          target: 'living-room',
        },
      },
    });

    expect(parsed.bindings[0].kind).toBe('light');
    expect(parsed.actions.get('virtualLight')?.tap).toBe('toggle');
  });

  it('configures a water-leak binary sensor binding', () => {
    const parsed = parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/floorplans/home.json',
      bindings: {
        'kitchen-water-leak': {
          entity: 'binary_sensor.kitchen_water_leak',
          kind: 'water-leak',
        },
      },
    });

    expect(parsed.bindings[0]).toMatchObject({
      ref: 'kitchen-water-leak',
      entityId: 'binary_sensor.kitchen_water_leak',
      kind: 'water-leak',
    });
    expect(parsed.actions.get('kitchen-water-leak')?.tap).toBe('more-info');
  });

  it('updates or removes a placement binding without losing its action settings', () => {
    const config = {
      type: 'custom:three-floorplan-card' as const,
      floorplan: '/local/floorplans/home.json',
      bindings: {
        light: { entity: 'light.old', tap_action: 'none' as const },
      },
    };

    expect(updatePlacementBinding(config, 'light', 'light.new', 'light').bindings?.light)
      .toEqual({ entity: 'light.new', kind: 'light', tap_action: 'none' });
    expect(updatePlacementBinding(config, 'light', '', 'light').bindings).toEqual({});
    expect(config.bindings.light.entity).toBe('light.old');
  });

  it('allows an entity binding to identify its target through the floorplan placement key', () => {
    const parsed = parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/floorplans/home.json',
      bindings: {
        diningCeiling: { entity: 'light.dining' },
        bedroomContact: { entity: 'binary_sensor.bedroom_door' },
      },
    });

    expect(parsed.bindings.map(binding => [binding.ref, binding.kind, binding.targetId])).toEqual([
      ['diningCeiling', 'light', undefined],
      ['bedroomContact', 'door-contact', undefined],
    ]);
  });

  it('parses sensor bindings and configurable celestial bodies', () => {
    const parsed = parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/floorplans/home.json',
      bindings: { presence: { entity: 'binary_sensor.room_presence', kind: 'presence-sensor' } },
      celestial: {
        sun: { position: [18, 0], radius: 3 },
        moon: { entity: 'sensor.moon_position', position: [20, 0] },
      },
    });

    expect(parsed.bindings[0].kind).toBe('presence-sensor');
    expect(parsed.celestial).toEqual({
      sun: { entityId: 'sun.sun', position: [18, 0], radius: 3 },
      moon: { entityId: 'sensor.moon_position', position: [20, 0], radius: 2.5 },
    });
    expect(() => parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/floorplans/home.json',
      celestial: { sun: { position: [1, Number.NaN] } },
    })).toThrow('celestial.sun.position must be a pair of finite floorplan coordinates');
    expect(() => parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/floorplans/home.json',
      celestial: { moon: { position: [1, 2] } },
    })).toThrow('celestial.moon.entity must be a Home Assistant entity ID');
    const legacyConfig = parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/floorplans/home.json',
      sun: { position: [18, 0], radius: 3 },
    });
    expect(legacyConfig.celestial).toEqual({
      sun: { entityId: 'sun.sun', position: [18, 0], radius: 3 },
    });
  });

  it('uses floorplan celestial positions unless a card position overrides them', () => {
    const configured = parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/floorplans/home.json',
      celestial: {
        sun: { position: [18, 0] },
        moon: { entity: 'sensor.moon_position' },
      },
    }).celestial;
    const floorplan = {
      schemaVersion: '2.14',
      id: 'test',
      name: 'Test',
      rooms: [],
      relationships: [],
      celestial: {
        sun: { position: [10, 2] as [number, number] },
        moon: { position: [20, 3] as [number, number] },
      },
    };

    expect(resolveCelestialConfig(configured, floorplan)).toEqual({
      sun: { entityId: 'sun.sun', position: [18, 0], radius: 2.5 },
      moon: { entityId: 'sensor.moon_position', position: [20, 3], radius: 2.5 },
    });
    expect(() => resolveCelestialConfig(parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/floorplans/home.json',
      celestial: { sun: {} },
    }).celestial, { ...floorplan, celestial: undefined })).toThrow(
      'celestial.sun.position must be configured in the card or floorplan JSON',
    );
  });

  it('infers cover and environmental sensor bindings and configures label presentation', () => {
    const parsed = parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/floorplans/home.json',
      bindings: {
        blind: { entity: 'cover.kitchen_blind' },
        temperature: {
          entity: 'sensor.living_temperature',
          display: 'value',
          precision: 2,
        },
      },
    });
    expect(parsed.bindings.map(binding => [binding.kind, binding.display, binding.precision])).toEqual([
      ['cover', undefined, undefined],
      ['environment-sensor', 'value', 2],
    ]);
    expect(parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/floorplans/home.json',
      bindings: { humidity: { entity: 'sensor.humidity' } },
    }).bindings[0].precision).toBeUndefined();
    expect(() => parseCardConfig({
      type: 'custom:three-floorplan-card',
      floorplan: '/local/floorplans/home.json',
      bindings: { temperature: { entity: 'sensor.temperature', display: 'icon' } },
    })).toThrow('display must be value or label-value');
  });
});
