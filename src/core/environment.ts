import type { EntityState, EnvironmentMeasure } from './types';

function formatValue(value: unknown, unit: unknown, precision?: number): string | undefined {
  if ((typeof value !== 'number' && typeof value !== 'string')
    || (typeof value === 'string' && (!value.trim() || ['unknown', 'unavailable'].includes(value.toLowerCase())))) {
    return undefined;
  }
  const numeric = Number(value);
  let formatted: string;
  if (Number.isFinite(numeric)) {
    const decimals = precision ?? 1;
    const fixed = numeric.toFixed(decimals);
    formatted = precision === undefined ? fixed.replace(/\.0+$/, '') : fixed;
  } else {
    formatted = String(value);
  }
  return typeof unit === 'string' && unit ? `${formatted} ${unit}` : formatted;
}

export function environmentValue(
  state: EntityState | undefined,
  precision?: number,
): string | undefined {
  return state ? formatValue(state.state, state.attributes.unit_of_measurement, precision) : undefined;
}

export function environmentMeasureValue(
  state: EntityState | undefined,
  measure: EnvironmentMeasure,
  fallbackPrecision?: number,
): string | undefined {
  if (!state || state.state === 'unknown' || state.state === 'unavailable') return undefined;
  const value = measure.attribute === 'state' ? state.state : state.attributes[measure.attribute];
  const attributeUnit = measure.attribute === 'state'
    ? state.attributes.unit_of_measurement
    : state.attributes[`${measure.attribute}_unit`];
  return formatValue(
    value,
    measure.unit ?? attributeUnit,
    measure.precision ?? fallbackPrecision,
  );
}
