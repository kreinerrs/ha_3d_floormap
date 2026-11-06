import { describe, expect, it } from 'vitest';
import { coverPosition } from '../src/core/cover';
import { environmentMeasureValue, environmentValue } from '../src/core/environment';

describe('environment sensor and cover states', () => {
  it('formats numeric readings with HA units and selected precision', () => {
    expect(environmentValue({
      entity_id: 'sensor.temperature',
      state: '21.46',
      attributes: { unit_of_measurement: '°C' },
    }, 1)).toBe('21.5 °C');
    expect(environmentValue({
      entity_id: 'sensor.humidity',
      state: '48',
      attributes: { unit_of_measurement: '%' },
    }, 0)).toBe('48 %');
    expect(environmentValue({
      entity_id: 'sensor.humidity',
      state: '48',
      attributes: { unit_of_measurement: '%' },
    })).toBe('48 %');
  });

  it('passes through text states and hides missing or unavailable readings', () => {
    expect(environmentValue({
      entity_id: 'sensor.air_quality',
      state: 'Good',
      attributes: {},
    })).toBe('Good');
    expect(environmentValue(undefined)).toBeUndefined();
    expect(environmentValue({
      entity_id: 'sensor.temperature',
      state: 'unavailable',
      attributes: {},
    })).toBeUndefined();
  });

  it('formats selected sensor attributes using per-measure units and precision', () => {
    const entity = {
      entity_id: 'sensor.air_monitor',
      state: 'online',
      attributes: {
        temperature: 21.46,
        humidity: 48,
        carbon_dioxide: 620,
        voc: 85,
        unit_of_measurement: '°C',
      },
    };
    expect(environmentMeasureValue(entity, {
      name: 'Temperature',
      attribute: 'temperature',
      unit: '°C',
      precision: 1,
    })).toBe('21.5 °C');
    expect(environmentMeasureValue(entity, {
      name: 'CO₂',
      attribute: 'carbon_dioxide',
      unit: 'ppm',
      precision: 0,
    })).toBe('620 ppm');
    expect(environmentMeasureValue(entity, {
      name: 'VOC',
      attribute: 'voc',
      precision: 0,
    })).toBe('85');
    expect(environmentMeasureValue(entity, {
      name: 'State value',
      attribute: 'state',
    })).toBe('online °C');
    expect(environmentMeasureValue(entity, {
      name: 'Pressure',
      attribute: 'pressure',
    })).toBeUndefined();
  });

  it('uses cover position percentages and open/closed fallback states', () => {
    expect(coverPosition({
      entity_id: 'cover.blind',
      state: 'open',
      attributes: { current_position: 65 },
    })).toBe(65);
    expect(coverPosition({
      entity_id: 'cover.blind',
      state: 'closed',
      attributes: {},
    })).toBe(0);
    expect(coverPosition({
      entity_id: 'cover.blind',
      state: 'open',
      attributes: {},
    })).toBe(100);
    expect(coverPosition(undefined)).toBeUndefined();
  });
});
