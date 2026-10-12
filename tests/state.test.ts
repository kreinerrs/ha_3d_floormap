import { describe, expect, it } from 'vitest';
import type { EntityState, MockDoc } from '../src/core/types';
import { doorView, lightView, MockProvider } from '../src/state/state';
import { HomeAssistantStateProvider } from '../src/adapters/home-assistant-adapter';

const entity = (state: string, attributes: Record<string, unknown> = {}): EntityState => ({
  entity_id: 'light.test',
  state,
  attributes,
});

describe('entity state adapters', () => {
  it('normalises missing and unavailable light states', () => {
    expect(lightView()).toMatchObject({ available: false, on: false });
    expect(lightView(entity('unavailable'))).toMatchObject({ available: false, on: false });
  });

  it('normalises light brightness and RGB colour', () => {
    expect(lightView(entity('on', { brightness: 128, rgb_color: [30, 80, 160] }))).toEqual({
      available: true,
      on: true,
      brightness: 128 / 255,
      color: 'rgb(30,80,160)',
    });
  });

  it('marks unknown door contacts unavailable and preserves open state', () => {
    expect(doorView(entity('unknown'))).toEqual({ available: false, open: false });
    expect(doorView(entity('on'))).toEqual({ available: true, open: true });
  });

  it('exposes mock and Home Assistant entities through the provider boundary', () => {
    const doc: MockDoc = { bindings: [], states: [entity('on')] };
    const mock = new MockProvider(doc);
    expect(mock.getState('light.test')).toBe('on');
    expect(mock.getEntity('light.test')).toEqual(entity('on'));

    const provider = new HomeAssistantStateProvider({
      states: { 'light.test': entity('off') },
      callService: async () => undefined,
    });
    expect(provider.getState('light.test')).toBe('off');
    provider.setHass({ states: {}, callService: async () => undefined });
    expect(provider.getEntity('light.test')).toBeUndefined();
  });
});
