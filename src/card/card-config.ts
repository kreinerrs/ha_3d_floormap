import type { Binding, CameraView, CelestialConfig, CelestialConfigOverride, Config, Floorplan, RoomStatusRule, VisualStyle } from '../core/types';
import { defaults } from '../core/config';
import type { DisplayDefaults, ObjectCategory, ObjectDisplay } from '../core/objects';
import type { EffectKind, EffectSpec } from '../core/effects';

export type CardActionName = 'toggle' | 'more-info' | 'none';
export interface CardAction { action: CardActionName }
export interface CardBindingConfig {
  entity: string;
  target?: string;
  kind?: Binding['kind'];
  mode?: 'tilt' | 'open';
  display?: Binding['display'];
  label?: string;
  precision?: number;
  tap_action?: CardAction | CardActionName;
  hold_action?: CardAction | CardActionName;
}
export interface CardAlertConfig {
  entity: string;
  state?: string;
  effects: Array<EffectSpec & { colour?: string }>;
}
export interface CardRoomStatusConfig {
  room: string;
  entity: string;
  attribute?: string;
  states?: Record<string, string>;
  ranges?: Array<{ max?: number; color: string }>;
}
export interface ThreeFloorplanCardConfig {
  type: 'custom:three-floorplan-card';
  floorplan: string | { source: string };
  height?: number;
  rooms?: string[];
  bindings_file?: string;
  debug?: boolean;
  toolbar?: { position?: 'left' | 'right' | 'top' | 'bottom' };
  camera?: Partial<Record<'allow_rotation' | 'allow_zoom' | 'allow_pan', boolean>>;
  appearance?: { style?: VisualStyle; line_thickness?: number; shadows?: boolean; ambient_intensity?: number; sunlight_intensity?: number; max_pixel_ratio?: number };
  bindings?: Record<string, CardBindingConfig>;
  celestial?: {
    sun?: { entity?: string; position?: [number, number]; radius?: number };
    moon?: { entity?: string; position?: [number, number]; radius?: number };
  };
  sun?: { entity?: string; position?: [number, number]; radius?: number };
  alerts?: CardAlertConfig[];
  room_status?: CardRoomStatusConfig[];
  camera_views?: CameraView[];
  objects?: { display?: ObjectDisplay; appliance?: ObjectDisplay; furniture?: ObjectDisplay };
}
export interface ParsedCardConfig {
  source: string;
  height?: number;
  rooms?: string[];
  toolbarPosition: 'left' | 'right' | 'top' | 'bottom';
  debug: boolean;
  renderer: Config;
  bindings: Binding[];
  celestial?: CelestialConfigOverride;
  actions: Map<string, { entityId: string; tap: CardActionName; hold: CardActionName }>;
  alerts: Array<{ entity: string; state: string; effects: EffectSpec[] }>;
  roomStatus: RoomStatusRule[];
  cameraViews: CameraView[];
  objects: DisplayDefaults;
}

export function updatePlacementBinding(
  config: ThreeFloorplanCardConfig,
  placementId: string,
  entityId: string,
  kind: Binding['kind'],
): ThreeFloorplanCardConfig {
  const bindings = { ...config.bindings };
  if (!entityId) {
    delete bindings[placementId];
  } else {
    bindings[placementId] = {
      ...bindings[placementId],
      entity: entityId,
      kind,
    };
  }
  return { ...config, bindings };
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

function isBindingKind(value: unknown): value is Binding['kind'] {
  return value === 'light' || value === 'water-leak' || value === 'door-contact' || value === 'cover' || value === 'lock'
    || value === 'environment-sensor'
    || value === 'motion-sensor' || value === 'presence-sensor';
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
  const height = raw.height === undefined ? undefined : numberOption(raw, 'height', 480, 240);

  const roomsRaw = raw.rooms;
  if (roomsRaw !== undefined && (!Array.isArray(roomsRaw) || roomsRaw.length === 0
    || roomsRaw.some(id => typeof id !== 'string' || !id))) {
    throw new Error('rooms must be a non-empty list of room IDs');
  }

  const cameraRaw = raw.camera === undefined ? {} : record(raw.camera, 'camera');
  const toolbarRaw = raw.toolbar === undefined ? {} : record(raw.toolbar, 'toolbar');
  const toolbarPosition = toolbarRaw.position ?? 'left';
  if (toolbarPosition !== 'left' && toolbarPosition !== 'right'
    && toolbarPosition !== 'top' && toolbarPosition !== 'bottom') {
    throw new Error('toolbar.position must be left, right, top, or bottom');
  }
  const appearance = raw.appearance === undefined ? {} : record(raw.appearance, 'appearance');
  const style = appearance.style ?? 'standard';
  if (style !== 'standard' && style !== 'comic' && style !== 'futuristic') {
    throw new Error('appearance.style must be standard, comic, or futuristic');
  }
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
  const lineThickness = numberOption(appearance, 'line_thickness', defaults.lineThickness, 1);
  const renderer: Config = {
    ...defaults,
    floorplanUrl: source,
    camera,
    visuals,
    style,
    lineThickness,
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
    if (target !== undefined && (typeof target !== 'string' || !target)) {
      throw new Error(`bindings.${ref}.target must be a room or connector ID`);
    }
    const domain = binding.entity.split('.')[0];
    const inferredKind: Binding['kind'] = domain === 'light' || domain === 'switch' ? 'light'
      : domain === 'cover' ? 'cover'
        : domain === 'lock' ? 'lock'
        : domain === 'sensor' ? 'environment-sensor' : 'door-contact';
    const kind = binding.kind ?? inferredKind;
    if (!isBindingKind(kind)) {
      throw new Error(`bindings.${ref}.kind must be light, water-leak, door-contact, lock, cover, environment-sensor, motion-sensor, or presence-sensor`);
    }
    if (binding.mode !== undefined && binding.mode !== 'tilt' && binding.mode !== 'open') {
      throw new Error(`bindings.${ref}.mode must be tilt or open`);
    }
    const display = binding.display ?? 'label-value';
    if (display !== 'value' && display !== 'label-value') {
      throw new Error(`bindings.${ref}.display must be value or label-value`);
    }
    if (binding.label !== undefined && (typeof binding.label !== 'string' || !binding.label.trim())) {
      throw new Error(`bindings.${ref}.label must be a non-empty string`);
    }
    const precision = binding.precision;
    if (precision !== undefined
      && (typeof precision !== 'number' || !Number.isInteger(precision) || precision < 0 || precision > 4)) {
      throw new Error(`bindings.${ref}.precision must be an integer from 0 to 4`);
    }
    const fallbackTap = kind === 'light' ? 'toggle' : 'more-info';
    bindings.push({
      ref,
      entityId: binding.entity,
      targetId: typeof target === 'string' ? target : undefined,
      kind,
      ...(binding.mode ? { mode: binding.mode } : {}),
      ...(kind === 'environment-sensor' ? {
        display,
        label: typeof binding.label === 'string' ? binding.label : undefined,
        ...(precision === undefined ? {} : { precision }),
      } : {}),
    });
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

  const roomStatusRaw = raw.room_status ?? [];
  if (!Array.isArray(roomStatusRaw)) throw new Error('room_status must be an array');
  const roomStatusRooms = new Set<string>();
  const roomStatus: RoomStatusRule[] = roomStatusRaw.map((value, index) => {
    const config = record(value, `room_status[${index}]`);
    if (typeof config.room !== 'string' || !config.room.trim()) {
      throw new Error(`room_status[${index}].room must be a non-empty room ID`);
    }
    if (roomStatusRooms.has(config.room)) {
      throw new Error(`room_status cannot configure room "${config.room}" more than once`);
    }
    roomStatusRooms.add(config.room);
    if (typeof config.entity !== 'string' || !config.entity.includes('.')) {
      throw new Error(`room_status[${index}].entity must be a Home Assistant entity ID`);
    }
    if (config.attribute !== undefined && (typeof config.attribute !== 'string' || !config.attribute.trim())) {
      throw new Error(`room_status[${index}].attribute must be a non-empty attribute name`);
    }
    const hasStates = config.states !== undefined;
    const hasRanges = config.ranges !== undefined;
    if (hasStates === hasRanges) {
      throw new Error(`room_status[${index}] must configure exactly one of states or ranges`);
    }
    const colorIsValid = (color: unknown): color is string =>
      typeof color === 'string' && /^#[\da-fA-F]{6}$/.test(color);
    let states: Record<string, string> | undefined;
    let ranges: RoomStatusRule['ranges'];
    if (hasStates) {
      const rawStates = record(config.states, `room_status[${index}].states`);
      const entries = Object.entries(rawStates);
      if (!entries.length || entries.some(([state, color]) => !state || !colorIsValid(color))) {
        throw new Error(`room_status[${index}].states must map state names to #RRGGBB colors`);
      }
      const parsedStates: Record<string, string> = {};
      entries.forEach(([state, color]) => {
        if (colorIsValid(color)) parsedStates[state] = color;
      });
      states = parsedStates;
    } else {
      if (!Array.isArray(config.ranges) || !config.ranges.length) {
        throw new Error(`room_status[${index}].ranges must be a non-empty array`);
      }
      let previousMax = Number.NEGATIVE_INFINITY;
      const parsedRanges = config.ranges.map((value, rangeIndex) => {
        const range = record(value, `room_status[${index}].ranges[${rangeIndex}]`);
        if (range.max !== undefined
          && (typeof range.max !== 'number' || !Number.isFinite(range.max) || range.max <= previousMax)) {
          throw new Error(`room_status[${index}].ranges max values must be finite and strictly increasing`);
        }
        if (!colorIsValid(range.color)) {
          throw new Error(`room_status[${index}].ranges[${rangeIndex}].color must be a #RRGGBB color`);
        }
        const parsedRange = {
          ...(range.max === undefined ? {} : { max: range.max }),
          color: range.color,
        };
        if (range.max !== undefined) previousMax = range.max;
        return parsedRange;
      });
      if (parsedRanges.some((range, rangeIndex) => range.max === undefined && rangeIndex !== parsedRanges.length - 1)) {
        throw new Error(`room_status[${index}] may only omit max on the last range`);
      }
      ranges = parsedRanges;
    }
    return {
      roomId: config.room,
      entityId: config.entity,
      ...(typeof config.attribute === 'string' ? { attribute: config.attribute } : {}),
      ...(states ? { states } : {}),
      ...(ranges ? { ranges } : {}),
    };
  });

  const cameraViewsRaw = raw.camera_views ?? [];
  if (!Array.isArray(cameraViewsRaw)) throw new Error('camera_views must be an array');
  const cameraViewIds = new Set<string>();
  const cameraViews: CameraView[] = cameraViewsRaw.map((value, index) => {
    const view = record(value, `camera_views[${index}]`);
    if (typeof view.id !== 'string' || !view.id.trim()) {
      throw new Error(`camera_views[${index}].id must be a non-empty string`);
    }
    if (cameraViewIds.has(view.id)) {
      throw new Error(`camera_views cannot contain duplicate ID "${view.id}"`);
    }
    cameraViewIds.add(view.id);
    if (typeof view.name !== 'string' || !view.name.trim()) {
      throw new Error(`camera_views[${index}].name must be a non-empty string`);
    }
    const coordinate = (key: 'position' | 'target'): [number, number, number] => {
      const point = view[key];
      if (!Array.isArray(point) || point.length !== 3
        || !point.every(item => typeof item === 'number' && Number.isFinite(item))) {
        throw new Error(`camera_views[${index}].${key} must be three finite coordinates [x, height, y]`);
      }
      return [point[0], point[1], point[2]];
    };
    const position = coordinate('position');
    const target = coordinate('target');
    if (position.every((item, coordinateIndex) => item === target[coordinateIndex])) {
      throw new Error(`camera_views[${index}].position and target must differ`);
    }
    return { id: view.id, name: view.name, position, target };
  });

  if (raw.celestial !== undefined && raw.sun !== undefined) {
    throw new Error('Configure celestial instead of sun; do not set both');
  }

  const celestialRaw = raw.celestial === undefined
    ? raw.sun === undefined ? undefined : { sun: raw.sun }
    : record(raw.celestial, 'celestial');
  let celestial: CelestialConfigOverride | undefined;
  if (celestialRaw !== undefined) {
    celestial = {};
    for (const body of ['sun', 'moon'] as const) {
      const bodyValue = celestialRaw[body];
      if (bodyValue === undefined) continue;
      const bodyRaw = record(bodyValue, `celestial.${body}`);
      const defaultEntity = body === 'sun' ? 'sun.sun' : undefined;
      const entityId = bodyRaw.entity ?? defaultEntity;
      if (typeof entityId !== 'string' || !entityId.includes('.')) {
        throw new Error(`celestial.${body}.entity must be a Home Assistant entity ID`);
      }
      const position = bodyRaw.position;
      if (position !== undefined && (!Array.isArray(position) || position.length !== 2
        || !position.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate)))) {
        throw new Error(`celestial.${body}.position must be a pair of finite floorplan coordinates`);
      }
      celestial[body] = {
        entityId,
        ...(Array.isArray(position) ? { position: [position[0], position[1]] as [number, number] } : {}),
        radius: numberOption(bodyRaw, 'radius', 2.5, Number.EPSILON),
      };
    }
    if (!celestial.sun && !celestial.moon) {
      throw new Error('celestial must configure at least one of sun or moon');
    }
  }

  const objectsRaw = raw.objects === undefined ? {} : record(raw.objects, 'objects');
  const displays = ['shown', 'transparent', 'hidden', 'active', 'active-else-transparent'];
  const displayOption = (key: string): ObjectDisplay | undefined => {
    const value = objectsRaw[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !displays.includes(value)) throw new Error(`objects.${key} must be one of ${displays.join(', ')}`);
    return value as ObjectDisplay;
  };
  const categories: Partial<Record<ObjectCategory, ObjectDisplay>> = {};
  for (const category of ['appliance', 'furniture'] as const) {
    const value = displayOption(category);
    if (value) categories[category] = value;
  }
  const objects: DisplayDefaults = { all: displayOption('display'), categories };
  return { source, height, rooms: roomsRaw as string[] | undefined, toolbarPosition, debug: booleanOption(raw, 'debug', false), renderer, bindings, celestial, actions, alerts, roomStatus, cameraViews, objects };
}

export function resolveCelestialConfig(
  configured: CelestialConfigOverride | undefined,
  floorplan: Floorplan,
): CelestialConfig | undefined {
  if (!configured) return undefined;
  const resolved: CelestialConfig = {};
  for (const body of ['sun', 'moon'] as const) {
    const bodyConfig = configured[body];
    if (!bodyConfig) continue;
    const position = bodyConfig.position ?? floorplan.celestial?.[body]?.position;
    if (!position) {
      throw new Error(`celestial.${body}.position must be configured in the card or floorplan JSON`);
    }
    const resolvedBody = { entityId: bodyConfig.entityId, position, radius: bodyConfig.radius };
    if (body === 'sun') resolved.sun = resolvedBody;
    else resolved.moon = resolvedBody;
  }
  return resolved;
}

/** Bindings, alerts and room status shared by every card using a floorplan. Same shape as the card options. */
export interface GlobalBindingsFile {
  bindings?: Record<string, CardBindingConfig>;
  alerts?: CardAlertConfig[];
  room_status?: CardRoomStatusConfig[];
}

/**
 * Merges a global bindings file into a card configuration; the card wins.
 * Bindings are matched by placement ID, alerts by entity and room status by room.
 * @param config The raw card configuration.
 * @param file The parsed global bindings file.
 * @returns A new card configuration that includes the global entries.
 */
export function mergeBindingsFile(config: ThreeFloorplanCardConfig, file: GlobalBindingsFile): ThreeFloorplanCardConfig {
  const cardAlerts = config.alerts ?? [];
  const cardStatus = config.room_status ?? [];
  const alertEntities = new Set(cardAlerts.map(alert => alert.entity));
  const statusRooms = new Set(cardStatus.map(status => status.room));
  return {
    ...config,
    bindings: { ...file.bindings, ...config.bindings },
    alerts: [...(file.alerts ?? []).filter(alert => !alertEntities.has(alert.entity)), ...cardAlerts],
    room_status: [...(file.room_status ?? []).filter(status => !statusRooms.has(status.room)), ...cardStatus],
  };
}
