import type { Binding, Config } from '../core/types';
import { defaults } from '../core/config';
import type { EffectKind, EffectSpec } from '../core/effects';

export type CardActionName = 'toggle' | 'more-info' | 'none';
export interface CardAction { action: CardActionName }
export interface CardBindingConfig {
  entity: string;
  target: string;
  kind?: 'light' | 'door-contact';
  tap_action?: CardAction | CardActionName;
  hold_action?: CardAction | CardActionName;
}
export interface CardAlertConfig {
  entity: string;
  state?: string;
  effects: Array<EffectSpec & { colour?: string }>;
}
export interface ThreeFloorplanCardConfig {
  type: 'custom:three-floorplan-card';
  floorplan: string | { source: string };
  camera?: Partial<Record<'allow_rotation' | 'allow_zoom' | 'allow_pan', boolean>>;
  appearance?: { shadows?: boolean; ambient_intensity?: number; sunlight_intensity?: number; max_pixel_ratio?: number };
  bindings?: Record<string, CardBindingConfig>;
  alerts?: CardAlertConfig[];
}
export interface ParsedCardConfig {
  source: string;
  renderer: Config;
  bindings: Binding[];
  actions: Map<string, { entityId: string; tap: CardActionName; hold: CardActionName }>;
  alerts: Array<{ entity: string; state: string; effects: EffectSpec[] }>;
}

function actionName(value: CardAction | CardActionName | undefined, fallback: CardActionName): CardActionName {
  if (value === undefined) return fallback;
  const action = typeof value === 'string'
    ? value
    : typeof value === 'object' && value !== null
      ? value.action
      : undefined;
  if (action === 'toggle' || action === 'more-info' || action === 'none') return action;
  throw new Error(`Unsupported card action: ${String(action)}`);
}

function booleanOption(options: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = options[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${key} must be true or false`);
  return value;
}

function numberOption(options: Record<string, unknown>, key: string, fallback: number, minimum = 0): number {
  const value = options[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${key} must be a number greater than or equal to ${minimum}`);
  }
  return value;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function parseCardConfig(value: unknown): ParsedCardConfig {
  const raw = record(value, 'Card configuration');
  if (raw.type !== 'custom:three-floorplan-card') {
    throw new Error('Card type must be custom:three-floorplan-card');
  }
  const floorplan = raw.floorplan;
  const source = typeof floorplan === 'string'
    ? floorplan
    : typeof floorplan === 'object' && floorplan !== null && 'source' in floorplan
      ? (floorplan as Record<'source', unknown>).source
      : undefined;
  if (typeof source !== 'string' || !source.trim()) {
    throw new Error('Set floorplan to a URL or to { source: URL }');
  }

  const cameraRaw = raw.camera === undefined ? {} : record(raw.camera, 'camera');
  const appearance = raw.appearance === undefined ? {} : record(raw.appearance, 'appearance');
  const camera = {
    allowRotation: booleanOption(cameraRaw, 'allow_rotation', true),
    allowZoom: booleanOption(cameraRaw, 'allow_zoom', true),
    allowPan: booleanOption(cameraRaw, 'allow_pan', true),
  };
  const shadows = appearance.shadows;
  if (shadows !== undefined && typeof shadows !== 'boolean') {
    throw new Error('shadows must be true or false');
  }
  const visuals = {
    ...defaults.visuals,
    shadows: shadows ?? defaults.visuals.shadows,
    ambientIntensity: numberOption(appearance, 'ambient_intensity', defaults.visuals.ambientIntensity),
    sunlightIntensity: numberOption(appearance, 'sunlight_intensity', defaults.visuals.sunlightIntensity),
    maxPixelRatio: numberOption(appearance, 'max_pixel_ratio', defaults.visuals.maxPixelRatio, Number.EPSILON),
  };
  const renderer: Config = {
    ...defaults,
    floorplanUrl: source,
    camera,
    visuals,
  };

  const bindingsRaw = raw.bindings === undefined ? {} : record(raw.bindings, 'bindings');
  const bindings: Binding[] = [];
  const actions = new Map<string, { entityId: string; tap: CardActionName; hold: CardActionName }>();
  for (const [ref, entry] of Object.entries(bindingsRaw)) {
    const binding = record(entry, `bindings.${ref}`);
    if (typeof binding.entity !== 'string' || !binding.entity.includes('.')) {
      throw new Error(`bindings.${ref}.entity must be a Home Assistant entity ID`);
    }
    const target = binding.target;
    if (typeof target !== 'string' || !target) {
      throw new Error(`bindings.${ref}.target must be a room or connector ID`);
    }
    const domain = binding.entity.split('.')[0];
    const kind = binding.kind ?? (domain === 'light' || domain === 'switch' ? 'light' : 'door-contact');
    if (kind !== 'light' && kind !== 'door-contact') {
      throw new Error(`bindings.${ref}.kind must be light or door-contact`);
    }
    const fallbackTap = kind === 'light' ? 'toggle' : 'more-info';
    bindings.push({ ref, entityId: binding.entity, targetId: target, kind });
    actions.set(ref, {
      entityId: binding.entity,
      tap: actionName(binding.tap_action as CardAction | CardActionName | undefined, fallbackTap),
      hold: actionName(binding.hold_action as CardAction | CardActionName | undefined, 'more-info'),
    });
  }

  const alertsRaw = raw.alerts ?? [];
  if (!Array.isArray(alertsRaw)) throw new Error('alerts must be an array');
  const alerts = alertsRaw.map((value, index) => {
    const alert = record(value, `alerts[${index}]`);
    if (typeof alert.entity !== 'string' || !alert.entity.includes('.')) {
      throw new Error(`alerts[${index}].entity must be a Home Assistant entity ID`);
    }
    if (alert.state !== undefined && typeof alert.state !== 'string') {
      throw new Error(`alerts[${index}].state must be a string`);
    }
    if (!Array.isArray(alert.effects) || alert.effects.length === 0) {
      throw new Error(`alerts[${index}].effects must be a non-empty array`);
    }
    const effects = alert.effects.map((effect, effectIndex) => {
      const spec = record(effect, `alerts[${index}].effects[${effectIndex}]`);
      const kind = spec.effect;
      if (!['flash', 'pulse', 'highlight', 'room-wash', 'camera-focus'].includes(String(kind))) {
        throw new Error(`Unsupported alert effect: ${String(kind)}`);
      }
      if (typeof spec.target !== 'string' || !spec.target) {
        throw new Error(`alerts[${index}].effects[${effectIndex}].target is required`);
      }
      return {
        target: spec.target,
        effect: kind as EffectKind,
        color: typeof spec.color === 'string' ? spec.color : typeof spec.colour === 'string' ? spec.colour : undefined,
        intervalMs: typeof spec.intervalMs === 'number' ? spec.intervalMs : undefined,
        priority: typeof spec.priority === 'number' ? spec.priority : undefined,
      };
    });
    return { entity: alert.entity, state: typeof alert.state === 'string' ? alert.state : 'on', effects };
  });

  return { source, renderer, bindings, actions, alerts };
}
