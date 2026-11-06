import type { EntityState, RoomStatusRule } from './types';

export function roomStatusColor(rule: RoomStatusRule, entity?: EntityState): string | undefined {
  if (!entity) return undefined;
  const value = rule.attribute ? entity.attributes[rule.attribute] : entity.state;
  if (rule.states) {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    return rule.states[String(value)];
  }
  if (!rule.ranges || (typeof value !== 'number'
    && (typeof value !== 'string' || value.trim() === ''))) return undefined;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return undefined;
  return rule.ranges.find(range => range.max === undefined || numericValue <= range.max)?.color;
}
