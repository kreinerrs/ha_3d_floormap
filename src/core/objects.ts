import type { EntityState, StateProvider } from './types';

export type ObjectCategory = 'appliance' | 'furniture';
export type ObjectDisplay = 'shown' | 'transparent' | 'hidden' | 'active' | 'active-else-transparent';
export type ObjectIndicator = 'tint' | 'bar' | 'label' | 'pulse' | 'ring';
export type RemainingKind = 'timestamp' | 'duration' | 'timer' | 'percent';
export type ObjectState = 'inactive' | 'active' | 'unavailable';

export interface ObjectVisual {
  kind?: 'box' | 'primitive' | 'model' | 'outline';
  model?: string;
  rotationDegrees?: number;
  offset?: [number, number, number];
  color?: string;
}

export interface ObjectRemaining {
  entity?: string;
  attribute?: string;
  kind: RemainingKind;
  unit?: 's' | 'min' | 'h';
  total?: number | string;
}

export interface ObjectStatus {
  entity?: string;
  activeWhen?: { states?: string[]; above?: number; below?: number };
  remaining?: ObjectRemaining;
}

export interface ObjectTypeDef {
  id: string;
  label?: string;
  category?: ObjectCategory;
  width?: number;
  depth?: number;
  height?: number;
  elevation?: number;
  clearance?: number;
  visual?: ObjectVisual;
  display?: ObjectDisplay;
  indicator?: ObjectIndicator;
}

export interface FloorplanObject {
  id: string;
  type: string;
  name?: string;
  roomId?: string;
  areaId?: string;
  position: [number, number];
  facingDegrees?: number;
  width?: number;
  depth?: number;
  height?: number;
  elevation?: number;
  category?: ObjectCategory;
  visual?: ObjectVisual;
  display?: ObjectDisplay;
  indicator?: ObjectIndicator;
  status?: ObjectStatus;
}

const A = 'appliance';
const F = 'furniture';
const def = (id: string, label: string, category: ObjectCategory, width: number, depth: number, height: number, elevation?: number, clearance?: number): ObjectTypeDef =>
  ({ id, label, category, width, depth, height, ...(elevation !== undefined ? { elevation } : {}), ...(clearance !== undefined ? { clearance } : {}) });

export const BUILT_IN_OBJECT_TYPES: ObjectTypeDef[] = [
  def('refrigerator', 'Refrigerator', A, 0.6, 0.65, 1.85, undefined, 0.7),
  def('freezer', 'Freezer', A, 0.6, 0.65, 1.4, undefined, 0.7),
  def('stove', 'Stove', A, 0.6, 0.6, 0.9, undefined, 0.6),
  def('dishwasher', 'Dishwasher', A, 0.6, 0.6, 0.85, undefined, 0.6),
  def('microwave', 'Microwave', A, 0.45, 0.35, 0.28, 0.9),
  def('washing-machine', 'Washing machine', A, 0.6, 0.6, 0.85, undefined, 0.6),
  def('dryer', 'Dryer', A, 0.6, 0.6, 0.85, undefined, 0.6),
  def('water-heater', 'Water heater', A, 0.55, 0.55, 1.5),
  def('tv', 'TV', A, 1.2, 0.08, 0.7, 0.9),
  def('fan', 'Fan', A, 1.2, 1.2, 0.3, 2.1),
  def('sofa', 'Sofa', F, 2, 0.9, 0.85),
  def('armchair', 'Armchair', F, 0.85, 0.85, 0.9),
  def('bed-single', 'Single bed', F, 0.9, 2, 0.5),
  def('bed-double', 'Double bed', F, 1.6, 2, 0.5),
  def('wardrobe', 'Wardrobe', F, 1, 0.6, 2, undefined, 0.6),
  def('table', 'Table', F, 1.6, 0.9, 0.75),
  def('chair', 'Chair', F, 0.45, 0.45, 0.9),
  def('desk', 'Desk', F, 1.4, 0.7, 0.75),
];

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export interface ResolvedObject {
  id: string;
  type: string;
  name: string;
  width: number;
  depth: number;
  height: number;
  elevation: number;
  category: ObjectCategory;
  visual: ObjectVisual;
  display?: ObjectDisplay;
  indicator?: ObjectIndicator;
}

/**
 * Fills an object's size, category, visual, display and indicator from its type.
 * A custom type replaces a built-in type with the same id; values on the object win over the type.
 * @param object The object as written in the file.
 * @param customTypes The file's objectTypes.
 * @returns The object with every dimension set (unknown types fall back to a 0.5 m cube).
 */
export const resolveObject = (object: FloorplanObject, customTypes: ObjectTypeDef[] = []): ResolvedObject => {
  const type = customTypes.find(item => item.id === object.type) ?? BUILT_IN_OBJECT_TYPES.find(item => item.id === object.type);
  const size = (own: number | undefined, fromType: number | undefined, fallback: number): number =>
    finite(own) && own > 0 ? own : finite(fromType) && fromType > 0 ? fromType : fallback;
  return {
    id: object.id,
    type: object.type,
    name: object.name ?? type?.label ?? object.type,
    width: size(object.width, type?.width, 0.5),
    depth: size(object.depth, type?.depth, 0.5),
    height: size(object.height, type?.height, 0.5),
    elevation: finite(object.elevation) && object.elevation >= 0 ? object.elevation : finite(type?.elevation) ? type!.elevation! : 0,
    category: object.category ?? type?.category ?? 'appliance',
    visual: { ...type?.visual, ...object.visual },
    display: object.display ?? type?.display,
    indicator: object.indicator ?? type?.indicator,
  };
};

export interface DisplayDefaults {
  all?: ObjectDisplay;
  categories?: Partial<Record<ObjectCategory, ObjectDisplay>>;
}

/**
 * Picks the display mode. Later wins: card default, card category, type/object, runtime toggle.
 * @param object A resolved object.
 * @param defaults Card-level options.
 * @param runtime A temporary override from a toolbar toggle.
 * @returns The display mode, 'shown' when nothing is set.
 */
export const resolveDisplay = (object: Pick<ResolvedObject, 'category' | 'display'>, defaults: DisplayDefaults = {}, runtime?: ObjectDisplay): ObjectDisplay =>
  runtime ?? object.display ?? defaults.categories?.[object.category] ?? defaults.all ?? 'shown';

export interface DisplayLook {
  visible: boolean;
  opacity: number;
}

/**
 * Turns a display mode and the current state into how the body is drawn.
 * @param display The resolved display mode.
 * @param state The derived object state; unavailable objects count as inactive for the mode.
 * @returns Whether the body is drawn and how opaque it is.
 */
export const displayLook = (display: ObjectDisplay, state: ObjectState): DisplayLook => {
  const active = state === 'active';
  switch (display) {
    case 'hidden': return { visible: false, opacity: 0 };
    case 'transparent': return { visible: true, opacity: 0.25 };
    case 'active': return { visible: active, opacity: 1 };
    case 'active-else-transparent': return { visible: true, opacity: active ? 1 : 0.25 };
    default: return { visible: true, opacity: 1 };
  }
};

const INACTIVE_STATES = new Set(['off', 'idle', 'standby', 'closed', 'false', 'paused', 'none', '']);
const UNAVAILABLE_STATES = new Set(['unavailable', 'unknown']);

/**
 * Decides whether an object is running.
 * @param entity The status entity state, or undefined when the entity is missing.
 * @param rule The object's activeWhen rule; the default is any state except off/idle/standby/closed and similar.
 * @returns 'unavailable' for a missing or unknown entity, otherwise 'active' or 'inactive'.
 */
export const deriveObjectState = (entity: EntityState | undefined, rule?: ObjectStatus['activeWhen']): ObjectState => {
  if (!entity || UNAVAILABLE_STATES.has(entity.state)) return 'unavailable';
  if (rule?.states) return rule.states.includes(entity.state) ? 'active' : 'inactive';
  if (rule?.above !== undefined || rule?.below !== undefined) {
    const value = Number(entity.state);
    if (!Number.isFinite(value)) return 'inactive';
    if (rule.above !== undefined && !(value > rule.above)) return 'inactive';
    if (rule.below !== undefined && !(value < rule.below)) return 'inactive';
    return 'active';
  }
  return INACTIVE_STATES.has(entity.state.toLowerCase()) ? 'inactive' : 'active';
};

const UNIT_SECONDS = { s: 1, min: 60, h: 3600 } as const;

const readValue = (entity: EntityState | undefined, attribute?: string): unknown => (attribute ? entity?.attributes[attribute] : entity?.state);

const toNumber = (value: unknown): number | undefined => {
  if (value === null || value === '' || typeof value === 'boolean') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const parseDuration = (text: string): number | undefined => {
  const match = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(text.trim());
  if (!match) return undefined;
  return match[3] === undefined ? Number(match[1]) * 3600 + Number(match[2]) * 60 : Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
};

export interface RemainingInfo {
  seconds?: number;
  progress?: number;
}

/**
 * Computes remaining time and progress from a status source.
 * @param remaining The object's remaining config.
 * @param states Provider of entity states (for the source and a total given as entity id).
 * @param nowMs Current time in milliseconds, so countdowns are testable.
 * @returns remaining seconds (never negative) and progress 0..1 when it can be told; an empty object otherwise.
 */
export const deriveRemaining = (remaining: ObjectRemaining | undefined, states: Pick<StateProvider, 'getEntity'>, nowMs: number): RemainingInfo => {
  if (!remaining?.entity) return {};
  const entity = states.getEntity(remaining.entity);
  if (!entity || UNAVAILABLE_STATES.has(entity.state)) return {};
  const raw = remaining.kind === 'timer' && !remaining.attribute ? entity.attributes.finishes_at : readValue(entity, remaining.attribute);
  let seconds: number | undefined;
  let progress: number | undefined;
  if (remaining.kind === 'percent') {
    const value = toNumber(raw);
    if (value !== undefined) progress = Math.min(1, Math.max(0, value / 100));
  } else if (remaining.kind === 'timestamp' || remaining.kind === 'timer') {
    const time = typeof raw === 'string' || typeof raw === 'number' ? Date.parse(String(raw)) : NaN;
    if (Number.isFinite(time)) seconds = Math.max(0, (time - nowMs) / 1000);
    else if (remaining.kind === 'timer' && entity.state === 'active') {
      const text = entity.attributes.remaining;
      seconds = typeof text === 'string' ? parseDuration(text) : undefined;
    }
  } else {
    const value = toNumber(raw);
    if (value !== undefined) seconds = Math.max(0, value * UNIT_SECONDS[remaining.unit ?? 's']);
    else if (typeof raw === 'string') seconds = parseDuration(raw);
  }
  if (seconds !== undefined && remaining.total !== undefined) {
    const totalValue = finite(remaining.total) ? remaining.total : toNumber(states.getEntity(remaining.total)?.state) ?? 0;
    const total = totalValue * UNIT_SECONDS[remaining.unit ?? 's'];
    if (total > 0) progress = Math.min(1, Math.max(0, 1 - seconds / total));
  }
  return { ...(seconds !== undefined ? { seconds } : {}), ...(progress !== undefined ? { progress } : {}) };
};

/**
 * Formats remaining seconds for a label.
 * @param seconds Remaining time in seconds.
 * @returns For example "45 s", "12 min" or "1 h 05 min".
 */
export const formatRemaining = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
};

/**
 * Finds the entity that tells an object's status.
 * The object's own status.entity wins; otherwise the first entity placed on the object with an HA entity id.
 * @param object The object.
 * @param placements All entity placements of the floorplan (loosely typed, as they come from the file).
 * @returns The Home Assistant entity id, or undefined.
 */
export const statusEntityOf = (object: Pick<FloorplanObject, 'id' | 'status'>, placements: ReadonlyArray<unknown> = []): string | undefined => {
  if (object.status?.entity) return object.status.entity;
  const found = (placements as Array<{ objectId?: string; haEntityId?: string }>).find(item => item.objectId === object.id && item.haEntityId);
  return found?.haEntityId;
};

const DEFAULT_DEBUG_TOTAL_SECONDS = 3600;

/**
 * Creates synthetic entity states for objects with a status entity, so they can be tried without Home Assistant.
 * Active gives a state the object's activeWhen accepts and a remaining-time source that matches its kind and unit.
 * @param objects Floorplan objects.
 * @param placements Entity placements (an entity placed on an object can supply the status entity).
 * @param active True for running, false for idle.
 * @param progress 0..1 share of the run that is done (only used while active).
 * @param nowMs Current time in milliseconds, used for finish timestamps.
 * @returns Map from entity id to a synthetic state; objects without any entity are skipped.
 */
export const debugObjectStates = (
  objects: ReadonlyArray<FloorplanObject>,
  placements: ReadonlyArray<unknown>,
  active: boolean,
  progress: number,
  nowMs: number,
): Map<string, EntityState> => {
  const result = new Map<string, EntityState>();
  const put = (id: string, state: string, attributes: Record<string, unknown> = {}): void => {
    const previous = result.get(id);
    result.set(id, { entity_id: id, state: previous && state === 'on' ? previous.state : state, attributes: { ...previous?.attributes, ...attributes } });
  };
  for (const object of objects) {
    const entityId = statusEntityOf(object, placements);
    if (!entityId) continue;
    const rule = object.status?.activeWhen;
    const states = rule?.states;
    let state: string;
    if (states) state = active ? states[0] ?? 'on' : 'off';
    else if (rule?.above !== undefined) state = String(active ? rule.above + 1 : rule.above - 1);
    else if (rule?.below !== undefined) state = String(active ? rule.below - 1 : rule.below + 1);
    else state = active ? 'on' : 'off';
    put(entityId, state);
    const remaining = object.status?.remaining;
    if (!active || !remaining?.entity) continue;
    const unit = UNIT_SECONDS[remaining.unit ?? 's'];
    const totalSeconds = finite(remaining.total) ? remaining.total * unit : DEFAULT_DEBUG_TOTAL_SECONDS;
    if (typeof remaining.total === 'string') put(remaining.total, String(totalSeconds / unit));
    const left = (1 - Math.min(1, Math.max(0, progress))) * totalSeconds;
    const finish = new Date(nowMs + left * 1000).toISOString();
    const value = remaining.kind === 'percent' ? String(Math.round(progress * 100))
      : remaining.kind === 'duration' ? String(Math.round(left / unit * 100) / 100)
        : finish;
    if (remaining.kind === 'timer' && !remaining.attribute) put(remaining.entity, 'active', { finishes_at: finish });
    else if (remaining.attribute) put(remaining.entity, 'on', { [remaining.attribute]: remaining.kind === 'percent' || remaining.kind === 'duration' ? Number(value) : value });
    else put(remaining.entity, value);
  }
  return result;
};
