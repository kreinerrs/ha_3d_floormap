import { describe, expect, it } from 'vitest';
import {
  debugObjectStates, deriveObjectState, deriveRemaining, displayLook, formatRemaining, resolveDisplay, resolveObject, statusEntityOf,
} from '../src/core/objects';
import type { EntityState } from '../src/core/types';

const entity = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): EntityState => ({ entity_id, state, attributes });
const provider = (...items: EntityState[]) => ({ getEntity: (id: string) => items.find(item => item.entity_id === id) });

describe('resolveObject', () => {
  it('takes size from the built-in type and lets the object win', () => {
    const resolved = resolveObject({ id: 'o', type: 'refrigerator', position: [0, 0], width: 0.7 });
    expect(resolved).toMatchObject({ width: 0.7, depth: 0.65, height: 1.85, elevation: 0, category: 'appliance', name: 'Refrigerator' });
  });
  it('lets a custom type replace a built-in one and falls back for unknown types', () => {
    const custom = [{ id: 'sofa', width: 3, depth: 1, height: 1, category: 'furniture' as const }];
    expect(resolveObject({ id: 'o', type: 'sofa', position: [0, 0] }, custom).width).toBe(3);
    expect(resolveObject({ id: 'o', type: 'mystery', position: [0, 0] }).height).toBe(0.5);
  });
  it('merges visual, display and indicator from the type', () => {
    const custom = [{ id: 'printer', visual: { kind: 'model' as const, model: '/local/p.glb' }, display: 'active' as const, indicator: 'bar' as const }];
    const resolved = resolveObject({ id: 'o', type: 'printer', position: [0, 0], visual: { color: '#fff' } }, custom);
    expect(resolved.visual).toEqual({ kind: 'model', model: '/local/p.glb', color: '#fff' });
    expect(resolved.display).toBe('active');
    expect(resolved.indicator).toBe('bar');
  });
});

describe('display', () => {
  it('resolves in order of precedence and defaults to shown', () => {
    expect(resolveDisplay({ category: 'furniture' })).toBe('shown');
    expect(resolveDisplay({ category: 'furniture' }, { all: 'hidden', categories: { furniture: 'transparent' } })).toBe('transparent');
    expect(resolveDisplay({ category: 'furniture', display: 'active' }, { all: 'hidden' })).toBe('active');
    expect(resolveDisplay({ category: 'furniture', display: 'active' }, {}, 'hidden')).toBe('hidden');
  });
  it('maps mode and state to a look', () => {
    expect(displayLook('shown', 'inactive')).toEqual({ visible: true, opacity: 1 });
    expect(displayLook('hidden', 'active').visible).toBe(false);
    expect(displayLook('active', 'inactive').visible).toBe(false);
    expect(displayLook('active', 'active').visible).toBe(true);
    expect(displayLook('active-else-transparent', 'inactive').opacity).toBe(0.25);
    expect(displayLook('active-else-transparent', 'active').opacity).toBe(1);
  });
});

describe('deriveObjectState', () => {
  it('uses a default rule', () => {
    expect(deriveObjectState(undefined)).toBe('unavailable');
    expect(deriveObjectState(entity('a', 'unavailable'))).toBe('unavailable');
    expect(deriveObjectState(entity('a', 'off'))).toBe('inactive');
    expect(deriveObjectState(entity('a', 'running'))).toBe('active');
  });
  it('honours states and numeric thresholds', () => {
    expect(deriveObjectState(entity('a', 'printing'), { states: ['printing'] })).toBe('active');
    expect(deriveObjectState(entity('a', 'idle'), { states: ['printing'] })).toBe('inactive');
    expect(deriveObjectState(entity('a', '12'), { above: 5 })).toBe('active');
    expect(deriveObjectState(entity('a', '3'), { above: 5 })).toBe('inactive');
    expect(deriveObjectState(entity('a', 'x'), { above: 5 })).toBe('inactive');
  });
});

describe('deriveRemaining', () => {
  const now = Date.parse('2026-01-01T10:00:00Z');
  it('reads a finish timestamp', () => {
    const states = provider(entity('t', '2026-01-01T10:10:00Z'));
    expect(deriveRemaining({ entity: 't', kind: 'timestamp' }, states, now).seconds).toBe(600);
    expect(deriveRemaining({ entity: 't', kind: 'timestamp' }, states, now + 1e9).seconds).toBe(0);
  });
  it('reads a duration with unit and computes progress from a total', () => {
    const states = provider(entity('d', '30'), entity('total', '120'));
    expect(deriveRemaining({ entity: 'd', kind: 'duration', unit: 'min' }, states, now).seconds).toBe(1800);
    const info = deriveRemaining({ entity: 'd', kind: 'duration', unit: 'min', total: 'total' }, states, now);
    expect(info.progress).toBeCloseTo(0.75);
    expect(deriveRemaining({ entity: 'd', kind: 'duration', unit: 'min', total: 60 }, states, now).progress).toBeCloseTo(0.5);
  });
  it('reads an attribute and clock text', () => {
    const states = provider(entity('p', 'printing', { time_left: 90 }), entity('c', '1:02:03'));
    expect(deriveRemaining({ entity: 'p', attribute: 'time_left', kind: 'duration' }, states, now).seconds).toBe(90);
    expect(deriveRemaining({ entity: 'c', kind: 'duration' }, states, now).seconds).toBe(3723);
  });
  it('reads a timer helper and a percent entity', () => {
    const timer = provider(entity('timer.x', 'active', { finishes_at: '2026-01-01T10:01:00Z' }));
    expect(deriveRemaining({ entity: 'timer.x', kind: 'timer' }, timer, now).seconds).toBe(60);
    expect(deriveRemaining({ entity: 'pc', kind: 'percent' }, provider(entity('pc', '40')), now)).toEqual({ progress: 0.4 });
  });
  it('returns nothing for missing, unavailable or malformed sources', () => {
    expect(deriveRemaining(undefined, provider(), now)).toEqual({});
    expect(deriveRemaining({ entity: 'x', kind: 'duration' }, provider(), now)).toEqual({});
    expect(deriveRemaining({ entity: 'x', kind: 'duration' }, provider(entity('x', 'unavailable')), now)).toEqual({});
    expect(deriveRemaining({ entity: 'x', kind: 'duration' }, provider(entity('x', 'soon')), now)).toEqual({});
  });
});

describe('formatRemaining', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatRemaining(45)).toBe('45 s');
    expect(formatRemaining(720)).toBe('12 min');
    expect(formatRemaining(3900)).toBe('1 h 05 min');
  });
});

describe('statusEntityOf', () => {
  const placements = [{ id: 'e', objectId: 'o', haEntityId: 'sensor.anchored' }];
  it('prefers the own status entity, then an anchored placement', () => {
    expect(statusEntityOf({ id: 'o', status: { entity: 'sensor.own' } }, placements)).toBe('sensor.own');
    expect(statusEntityOf({ id: 'o' }, placements)).toBe('sensor.anchored');
    expect(statusEntityOf({ id: 'other' }, placements)).toBeUndefined();
  });
});

describe('debugObjectStates', () => {
  const now = Date.parse('2026-01-01T10:00:00Z');
  const washer = {
    id: 'w', type: 'washing-machine', position: [0, 0] as [number, number],
    status: {
      entity: 'sensor.state', activeWhen: { states: ['running'] },
      remaining: { entity: 'sensor.finish', kind: 'timestamp' as const, unit: 'min' as const, total: 60 },
    },
  };
  it('makes an active object that derives as active with the expected time left', () => {
    const states = debugObjectStates([washer], [], true, 0.5, now);
    const provider = { getEntity: (id: string) => states.get(id) };
    expect(deriveObjectState(states.get('sensor.state'), washer.status.activeWhen)).toBe('active');
    const info = deriveRemaining(washer.status.remaining, provider, now);
    expect(info.seconds).toBeCloseTo(1800);
    expect(info.progress).toBeCloseTo(0.5);
  });
  it('makes an idle object inactive and covers other kinds, attributes and anchored entities', () => {
    const idle = debugObjectStates([washer], [], false, 0.5, now);
    expect(deriveObjectState(idle.get('sensor.state'), washer.status.activeWhen)).toBe('inactive');
    expect(idle.has('sensor.finish')).toBe(false);
    const printer = {
      id: 'p', type: 'x', position: [0, 0] as [number, number],
      status: { entity: 'sensor.p', activeWhen: { above: 5 }, remaining: { entity: 'sensor.p', kind: 'duration' as const, attribute: 'left', unit: 'min' as const, total: 'sensor.total' } },
    };
    const states = debugObjectStates([printer], [], true, 0.25, now);
    const provider = { getEntity: (id: string) => states.get(id) };
    expect(deriveObjectState(states.get('sensor.p'), printer.status.activeWhen)).toBe('active');
    expect(deriveRemaining(printer.status.remaining, provider, now).progress).toBeCloseTo(0.25);
    const anchored = debugObjectStates([{ id: 'f', type: 'fan', position: [0, 0] as [number, number] }], [{ objectId: 'f', haEntityId: 'fan.x' }], true, 0, now);
    expect(anchored.get('fan.x')?.state).toBe('on');
    expect(debugObjectStates([{ id: 'n', type: 'sofa', position: [0, 0] as [number, number] }], [], true, 0, now).size).toBe(0);
  });
});
