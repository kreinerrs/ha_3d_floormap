import { describe, expect, it } from 'vitest';
import { roomStatusColor } from '../src/core/room-status';

const entity = (state: string, attributes: Record<string, unknown> = {}) => ({
  entity_id: 'sensor.room_status',
  state,
  attributes,
});

describe('room status coloring', () => {
  it('maps discrete entity states to configured colors', () => {
    const rule = {
      roomId: 'living-room',
      entityId: 'binary_sensor.occupied',
      states: { on: '#22aa55', off: '#777777' },
    };
    expect(roomStatusColor(rule, entity('on'))).toBe('#22aa55');
    expect(roomStatusColor(rule, entity('unknown'))).toBeUndefined();
    expect(roomStatusColor(rule)).toBeUndefined();
  });

  it('uses numeric sensor values and configured attributes for ranges', () => {
    const rule = {
      roomId: 'bedroom',
      entityId: 'sensor.climate',
      attribute: 'temperature',
      ranges: [
        { max: 18, color: '#4488ff' },
        { max: 24, color: '#44bb66' },
        { color: '#ff5533' },
      ],
    };
    const state = entity('ok', { temperature: '18.5' });
    expect(roomStatusColor(rule, state)).toBe('#44bb66');
    expect(roomStatusColor(rule, entity('ok', { temperature: 29 }))).toBe('#ff5533');
    expect(roomStatusColor(rule, entity('ok', { temperature: 'unavailable' }))).toBeUndefined();
  });
});
