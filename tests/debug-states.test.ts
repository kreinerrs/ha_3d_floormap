import { describe, expect, it } from 'vitest';
import { debugState, debugStates, syntheticBindings } from '../src/core/debug-states';
import type { Binding } from '../src/core/types';

const binding = (kind: Binding['kind'], entityId: string): Binding => ({ ref: entityId, entityId, kind });

describe('debugStates', () => {
  const bindings = [binding('light', 'light.a'), binding('lock', 'lock.a'), binding('cover', 'cover.a'), binding('door-contact', 'binary_sensor.a')];

  it('activates entities in phase 1', () => {
    const states = debugStates(bindings, [], 1);
    expect(states.get('light.a')?.state).toBe('on');
    expect(states.get('lock.a')?.state).toBe('unlocked');
    expect(states.get('cover.a')?.attributes.current_position).toBe(100);
    expect(states.get('binary_sensor.a')?.state).toBe('on');
  });

  it('inverts them in phase 2', () => {
    const states = debugStates(bindings, [], 2);
    expect(states.get('light.a')?.state).toBe('off');
    expect(states.get('lock.a')?.state).toBe('locked');
    expect(states.get('cover.a')?.state).toBe('closed');
  });

  it('creates bindings only for unbound placements', () => {
    const result = syntheticBindings([
      { id: 'a', type: 'lock', connectorId: 'c1' },
      { id: 'b', type: 'door-contact', connectorId: 'c2', role: 'tilt' },
      { id: 'light.a', type: 'cover', connectorId: 'c3' },
    ], [{ ref: 'light.a', entityId: 'x', kind: 'cover' }]);
    expect(result.map(item => item.ref)).toEqual(['a', 'b']);
    expect(result[0]).toMatchObject({ entityId: 'debug.a', kind: 'lock', targetId: 'c1' });
    expect(result[1].mode).toBe('tilt');
  });

  it('uses an explicit cover level', () => {
    const state = debugState(binding('cover', 'cover.a'), undefined, true, 40);
    expect(state.attributes.current_position).toBe(40);
    expect(state.state).toBe('open');
  });
});
