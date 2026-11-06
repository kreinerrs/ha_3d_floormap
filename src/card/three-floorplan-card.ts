import type { Binding, EntityState, Floorplan } from '../core/types';
import { normalizeEntityPlacementCoordinates, resolveBindings, sanitizeEntityPlacements, validateEntityPlacements } from '../core/entity-placement';
import { HomeAssistantActionProvider } from '../adapters/action-adapter';
import { HomeAssistantStateProvider, type HomeAssistant } from '../adapters/home-assistant-adapter';
import { doorView, lightView } from '../state/state';
import { presencePosition } from '../core/presence';
import { sunPosition } from '../core/sun';
import { coverPosition } from '../core/cover';
import { debugObjectStates, deriveObjectState, resolveObject, statusEntityOf } from '../core/objects';
import { debugEntityPrefix, debugState, debugStates, syntheticBindings } from '../core/debug-states';
import { lockView } from '../core/lock';
import { formatIgnoredElements, listIgnoredElements } from '../core/ignored-elements';
import { roomStatusColor } from '../core/room-status';
import { Renderer, type CameraCoordinates } from '../renderer/renderer';
import { normalizeOpenings } from '../core/openings';
import { filterFloorplanRooms } from '../core/room-filter';
import { mergeBindingsFile, parseCardConfig, type GlobalBindingsFile, resolveCelestialConfig, type ParsedCardConfig, type ThreeFloorplanCardConfig } from './card-config';

const styles = `
  :host { display: block; }
  .card { position: relative; height: var(--three-floorplan-card-height, 480px); min-height: 240px; overflow: hidden; border-radius: var(--ha-card-border-radius, 12px); background: #101821; }
  .canvas { width: 100%; height: 100%; }
  .canvas:focus-visible { outline: 2px solid #78d9b8; outline-offset: -2px; }
  .toolbar { position: absolute; z-index: 1; top: 12px; left: 12px; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px; border: 1px solid #ffffff24; border-radius: 12px; background: #101821e8; color: #f3f6f8; box-shadow: 0 8px 24px #0006; backdrop-filter: blur(8px); font: 13px/1.4 system-ui, sans-serif; }
  .toolbar[data-position="right"] { right: 12px; left: auto; }
  .toolbar[data-position="top"], .toolbar[data-position="bottom"] { left: 50%; flex-direction: row; transform: translateX(-50%); }
  .toolbar[data-position="top"] { top: 12px; }
  .toolbar[data-position="bottom"] { top: auto; bottom: 12px; }
  .toolbar[data-position="top"] .room-nav, .toolbar[data-position="bottom"] .room-nav { flex-direction: row; }
  .toolbar[data-position="top"] .filters, .toolbar[data-position="bottom"] .filters { flex-direction: row; }
  .toolbar[hidden] { display: none; }
  .room-nav { display: flex; flex-direction: column; align-items: center; gap: 7px; }
  .room-nav select { width: 148px; min-height: 38px; padding: 4px 8px; border: 1px solid #ffffff30; border-radius: 7px; background: #1d2a35; color: inherit; font: inherit; }
  .room-nav .areas-toggle { width: 42px; height: 42px; }
  .room-nav .cutaway-toggle { width: 42px; height: 42px; }
  .room-nav .coordinates-toggle { width: 42px; height: 42px; }
  .filters { display: flex; flex-direction: column; gap: 6px; }
  .toolbar button { position: relative; display: grid; width: 42px; height: 42px; min-height: 42px; place-items: center; padding: 6px; border: 1px solid #ffffff24; border-radius: 9px; background: #233441; color: inherit; cursor: pointer; touch-action: manipulation; user-select: none; }
  .toolbar button[hidden] { display: none; }
  .toolbar button svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .toolbar button[aria-pressed="true"] { border-color: #66c7a4; background: #174c42; }
  .toolbar button:focus-visible, .room-nav select:focus-visible { outline: 2px solid #78d9b8; outline-offset: 2px; }
  .toolbar .home { flex: none; }
  .floor-buttons { display: flex; flex-direction: column; gap: 6px; }
  .floor-buttons:empty { display: none; }
  .toolbar[data-position="top"] .floor-buttons, .toolbar[data-position="bottom"] .floor-buttons { flex-direction: row; }
  .toolbar button.floor { font: 600 14px system-ui, sans-serif; }
  .toolbar .dots { position: absolute; left: 0; right: 0; bottom: 3px; display: flex; justify-content: center; gap: 3px; pointer-events: none; }
  .toolbar .dots i { width: 5px; height: 5px; border-radius: 50%; background: #ffffff40; }
  .toolbar .dots i.on { background: #fff; }
  .room-nav .objects-toggle { width: 42px; height: 42px; }
  .room-nav .trees-toggle { width: 42px; height: 42px; }
  .room-nav .ignored-toggle { width: 42px; height: 42px; }
  .ignored-overlay { position: absolute; z-index: 3; inset: 12px 12px 12px 76px; display: flex; flex-direction: column; padding: 12px; border: 1px solid #ffffff30; border-radius: 10px; background: #101821f2; color: #f3f6f8; box-shadow: 0 8px 24px #0006; font: 12px/1.5 system-ui, sans-serif; }
  .ignored-overlay[hidden] { display: none; }
  .ignored-overlay pre { flex: 1; margin: 6px 0 0; overflow: auto; color: #ffd9a8; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; user-select: text; white-space: pre-wrap; }
  .camera-coordinates { position: absolute; z-index: 2; right: 12px; bottom: 12px; max-width: min(420px, calc(100% - 24px)); padding: 12px; border: 1px solid #ffffff30; border-radius: 10px; background: #101821ed; color: #f3f6f8; box-shadow: 0 8px 24px #0006; backdrop-filter: blur(8px); font: 12px/1.5 system-ui, sans-serif; }
  .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .panel-close { width: 28px; height: 28px; padding: 0; border: 1px solid #ffffff30; border-radius: 7px; background: #233441; color: inherit; font: 18px/1 system-ui, sans-serif; cursor: pointer; }
  .debug-panel { position: absolute; z-index: 3; top: 12px; right: 12px; bottom: 12px; width: min(340px, calc(100% - 24px)); display: flex; flex-direction: column; padding: 12px; border: 1px solid #ffffff30; border-radius: 10px; background: #101821f2; color: #f3f6f8; box-shadow: 0 8px 24px #0006; font: 12px/1.5 system-ui, sans-serif; }
  .debug-panel[hidden] { display: none; }
  .debug-list { flex: 1; margin-top: 8px; overflow: auto; }
  .debug-list h4 { margin: 10px 0 4px; color: #bfe9d8; font-size: 11px; text-transform: uppercase; }
  .debug-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 3px 0; }
  .debug-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .debug-row button { min-width: 84px; padding: 3px 8px; border: 1px solid #ffffff30; border-radius: 7px; background: #233441; color: inherit; font: inherit; cursor: pointer; }
  .debug-row button[aria-pressed="true"] { border-color: #66c7a4; background: #174c42; }
  .debug-row input[type="range"] { width: 120px; }
  .camera-coordinates[hidden] { display: none; }
  .camera-coordinates pre { margin: 6px 0 0; overflow: auto; color: #bfe9d8; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; user-select: text; }
  @media (max-width: 480px) {
    .toolbar { top: 8px; left: 8px; padding: 6px; }
    .toolbar[data-position="right"] { right: 8px; }
    .toolbar[data-position="top"] { top: 8px; left: 50%; }
    .toolbar[data-position="bottom"] { top: auto; bottom: 8px; left: 50%; }
  }
  .status { position: absolute; inset: 0; display: grid; place-items: center; padding: 20px; color: #fff; font: 14px/1.5 system-ui, sans-serif; text-align: center; pointer-events: none; }
  .status[hidden] { display: none; }
  .status.error { align-items: start; justify-items: start; color: #ffc9c9; background: #101821e8; text-align: left; white-space: pre-wrap; }
`;

function entitySignature(state?: EntityState): string {
  if (!state) return 'missing';
  return `${state.state}:${JSON.stringify(state.attributes)}`;
}

function validateFloorplan(value: unknown, source: string): Floorplan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Floorplan at ${source} must contain a JSON object`);
  }
  const candidate = value as Partial<Floorplan>;
  if (typeof candidate.schemaVersion !== 'string' || !/^[23]\./.test(candidate.schemaVersion)) {
    throw new Error(`Unsupported floorplan schema version: ${String(candidate.schemaVersion ?? 'missing')}`);
  }
  if (!Array.isArray(candidate.rooms) || candidate.rooms.length === 0) {
    throw new Error('Floorplan must contain at least one room');
  }
  if (candidate.northDegrees !== undefined && !Number.isFinite(candidate.northDegrees)) {
    throw new Error('Floorplan northDegrees must be a finite compass bearing');
  }
  if (candidate.entitySettings !== undefined
    && (!candidate.entitySettings || typeof candidate.entitySettings !== 'object'
      || Array.isArray(candidate.entitySettings)
      || (candidate.entitySettings.coordinates !== undefined
        && candidate.entitySettings.coordinates !== 'room'
        && candidate.entitySettings.coordinates !== 'floorplan'))) {
    throw new Error('Floorplan entitySettings.coordinates must be room or floorplan');
  }
  if (candidate.celestial !== undefined) {
    if (!candidate.celestial || typeof candidate.celestial !== 'object' || Array.isArray(candidate.celestial)) {
      throw new Error('Floorplan celestial must be an object');
    }
    for (const body of ['sun', 'moon'] as const) {
      const celestial = candidate.celestial[body];
      if (celestial !== undefined) {
        if (!celestial || typeof celestial !== 'object' || Array.isArray(celestial)
          || !Array.isArray(celestial.position) || celestial.position.length !== 2
          || !celestial.position.every(Number.isFinite)) {
          throw new Error(`Floorplan celestial.${body}.position must be a pair of finite coordinates`);
        }
      }
    }
  }
  if (candidate.ground !== undefined) {
    const ground = candidate.ground;
    const polygon = ground && typeof ground === 'object' ? ground.polygon : undefined;
    const color = ground && typeof ground === 'object' ? ground.color : undefined;
    if (!Array.isArray(polygon) || polygon.length < 3
      || polygon.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite))
      || (color !== undefined && (typeof color !== 'string' || !color.trim()))) {
      throw new Error('Floorplan ground must have a polygon of at least three finite [x, y] points and an optional color');
    }
  }
  for (const room of candidate.rooms) {
    if (!room || typeof room.id !== 'string' || !room.layout
      || ![room.layout.x, room.layout.y, room.layout.width, room.layout.height].every(Number.isFinite)
      || room.layout.width <= 0 || room.layout.height <= 0
      || !Array.isArray(room.connectors)) {
      throw new Error('Floorplan contains a room with invalid layout or connectors');
    }
  }
  if (candidate.areas !== undefined && (!Array.isArray(candidate.areas)
    || candidate.areas.some(area => !area || typeof area.id !== 'string' || !area.id
      || typeof area.name !== 'string' || typeof area.kind !== 'string'
      || (area.shape !== 'rect' && area.shape !== 'ellipse')
      || !area.layout || ![area.layout.x, area.layout.y, area.layout.width, area.layout.height].every(Number.isFinite)
      || area.layout.width <= 0 || area.layout.height <= 0
      || (area.roofed !== undefined && typeof area.roofed !== 'boolean')))) {
    throw new Error('Floorplan areas must have an ID, name, kind, rect or ellipse shape, valid positive layout, and optional roofed flag');
  }
  return normalizeOpenings(sanitizeEntityPlacements(normalizeEntityPlacementCoordinates(candidate as Floorplan)));
}

function validateTargets(floorplan: Floorplan, config: ParsedCardConfig): Binding[] {
  validateEntityPlacements(floorplan);
  const roomIds = new Set(floorplan.rooms.map(room => room.id));
  const viewIds = new Set(config.cameraViews.map(view => view.id));
  for (const viewId of viewIds) {
    if (roomIds.has(viewId)) {
      throw new Error(`Camera view ID "${viewId}" conflicts with a floorplan room ID`);
    }
  }
  for (const status of config.roomStatus) {
    if (!roomIds.has(status.roomId)) {
      throw new Error(`Room status target "${status.roomId}" was not found in the floorplan`);
    }
  }
  for (const alert of config.alerts) {
    for (const effect of alert.effects) {
      const targetExists = effect.effect === 'camera-focus'
        ? roomIds.has(effect.target) || viewIds.has(effect.target)
        : roomIds.has(effect.target);
      if (!targetExists) {
        throw new Error(effect.effect === 'camera-focus'
          ? `Camera-focus target "${effect.target}" was not found in the floorplan or camera_views`
          : `Alert target "${effect.target}" was not found in the floorplan`);
      }
    }
  }
  return resolveBindings(floorplan, config.bindings, config.renderer.visuals);
}

/** Applies the card's `rooms` selection, pruning bindings, alerts and room status that point at hidden rooms. */
function selectRooms(full: Floorplan, config: ParsedCardConfig): Floorplan {
  if (!config.rooms) return full;
  const known = new Set(full.rooms.map(room => room.id));
  const missing = config.rooms.filter(id => !known.has(id));
  if (missing.length) throw new Error(`Unknown room ID(s) in rooms: ${missing.join(', ')}`);
  const floorplan = filterFloorplanRooms(full, config.rooms);
  const targets = new Set([
    ...floorplan.rooms.map(room => room.id),
    ...floorplan.rooms.flatMap(room => room.connectors.map(connector => connector.id)),
  ]);
  const views = new Set(config.cameraViews.map(view => view.id));
  const hidden = new Set(full.rooms.filter(room => !targets.has(room.id)).map(room => room.id));
  config.bindings = config.bindings.filter(binding => !binding.targetId || targets.has(binding.targetId));
  config.roomStatus = config.roomStatus.filter(status => targets.has(status.roomId));
  config.alerts = config.alerts
    .map(alert => ({ ...alert, effects: alert.effects.filter(effect => !hidden.has(effect.target) || views.has(effect.target)) }))
    .filter(alert => alert.effects.length > 0);
  return floorplan;
}

async function loadBindingsFile(source: string): Promise<GlobalBindingsFile | undefined> {
  try {
    const response = await fetch(source, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json: unknown = await response.json();
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('not a JSON object');
    return json as GlobalBindingsFile;
  } catch (error) {
    console.warn(`three-floorplan-card: bindings_file ${source} ignored, using card configuration only: ${String(error)}`);
    return undefined;
  }
}

async function loadFloorplan(source: string): Promise<Floorplan> {
  let response: Response;
  try {
    response = await fetch(source, { cache: 'no-store' });
  } catch (error) {
    throw new Error(`Unable to load floorplan from ${source}: ${String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`Unable to load floorplan from ${source}: HTTP ${response.status}`);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    throw new Error(`Floorplan at ${source} is not valid JSON: ${String(error)}`);
  }
  return validateFloorplan(json, source);
}

export class ThreeFloorplanCard extends HTMLElement {
  static getConfigElement(): HTMLElement {
    return document.createElement('three-floorplan-card-editor');
  }

  static getStubConfig(): ThreeFloorplanCardConfig {
    return {
      type: 'custom:three-floorplan-card',
      floorplan: '/local/floorplans/home.json',
    };
  }

  private config?: ParsedCardConfig;
  private rawConfig?: ThreeFloorplanCardConfig;
  private homeAssistant?: HomeAssistant;
  private renderer?: Renderer;
  private stateProvider?: HomeAssistantStateProvider;
  private debugPhase: 0 | 1 | 2 = 0;
  private debugOverride = new Map<string, EntityState>();
  private debugButton?: HTMLButtonElement;
  private debugPanelButton?: HTMLButtonElement;
  private debugPanel!: HTMLDivElement;
  private actionProvider?: HomeAssistantActionProvider;
  private readonly signatures = new Map<string, string>();
  private readonly shadow: ShadowRoot;
  private readonly cardElement: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly toolbar: HTMLDivElement;
  private readonly roomSelect: HTMLSelectElement;
  private readonly homeButton: HTMLButtonElement;
  private readonly coordinatesButton: HTMLButtonElement;
  private readonly coordinatesPanel: HTMLDivElement;
  private readonly coordinatesText: HTMLPreElement;
  private readonly floorButtons: HTMLDivElement;
  private readonly treesButton: HTMLButtonElement;
  private readonly objectsButton: HTMLButtonElement;
  private objectsMode: 'configured' | 'no-furniture' | 'none' = 'configured';
  private readonly ignoredButton: HTMLButtonElement;
  private readonly ignoredPanel: HTMLDivElement;
  private readonly areasButton: HTMLButtonElement;
  private readonly cutawayButton: HTMLButtonElement;
  private readonly filterButtons = new Map<Binding['kind'], HTMLButtonElement>();
  private readonly visibleKinds = new Map<Binding['kind'], boolean>([
    ['light', true],
    ['cover', true],
    ['lock', true],
    ['environment-sensor', true],
    ['water-leak', true],
    ['motion-sensor', true],
    ['presence-sensor', true],
  ]);
  private generation = 0;
  private loadingGeneration?: number;
  private floorplan?: Floorplan;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `<style>${styles}</style><div class="card"><div class="canvas"></div><div class="toolbar" role="toolbar" aria-label="Floorplan controls"><div class="room-nav"><select aria-label="Choose a room or saved camera view"><option value="">Rooms</option></select><button class="areas-toggle" type="button" aria-label="Hide site areas" title="Hide site areas" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18M5 17l3-4 3 2 4-7 4 3v6"/><circle cx="8" cy="7" r="2"/></svg></button><button class="cutaway-toggle" type="button" aria-label="Enable wall cutaway" title="Fade camera-facing walls" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V5l8-2 8 2v15M4 5l8 3 8-3M12 8v12M4 20l8-3 8 3"/><path d="m8 11 1.5 1.5L12 10"/></svg></button><button class="coordinates-toggle" type="button" aria-label="Show camera coordinates" title="Show camera coordinates (C)" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v5m0 8v5M3 12h5m8 0h5"/><circle cx="12" cy="12" r="4"/></svg></button><button class="trees-toggle" type="button" aria-label="Show trees" title="Show trees" aria-pressed="false" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="6"/><path d="M12 15v6M9 21h6"/></svg></button><button class="objects-toggle" type="button" aria-label="Objects: as configured" title="Objects: as configured" aria-pressed="true" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg></button><button class="ignored-toggle" type="button" aria-label="Show ignored elements" title="Show ignored elements" aria-pressed="false" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3.5v.5"/></svg></button><button class="home" type="button" aria-label="Show whole floorplan" title="Show whole floorplan" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9M9 21v-7h6v7"/></svg></button></div><div class="floor-buttons" aria-label="Floor visibility"></div><div class="filters" aria-label="Entity visibility filters"></div></div><div class="camera-coordinates" role="region" aria-label="Camera view coordinates" hidden><div class="panel-head"><strong>Camera view coordinates · press C to hide</strong><button class="panel-close" type="button" aria-label="Close camera coordinates">×</button></div><pre></pre></div><div class="ignored-overlay" role="region" aria-label="Ignored floorplan elements" hidden><div class="panel-head"><strong>Ignored floorplan elements</strong><button class="panel-close" type="button" aria-label="Close ignored elements">×</button></div><pre></pre></div><div class="debug-panel" role="region" aria-label="Debug entity tester" hidden><div class="panel-head"><strong>Debug · entity tester</strong><button class="panel-close" type="button" aria-label="Close debug panel">×</button></div><div class="debug-list"></div></div><div class="status" role="status" aria-live="polite">Waiting for Home Assistant.</div></div>`;
    this.cardElement = this.shadow.querySelector<HTMLDivElement>('.card')!;
    this.stage = this.shadow.querySelector<HTMLDivElement>('.canvas')!;
    this.stage.tabIndex = 0;
    this.stage.setAttribute('aria-label', 'Interactive floorplan. Focus and press C to show camera coordinates.');
    this.stage.addEventListener('pointerdown', this.focusStage);
    this.stage.addEventListener('keydown', this.onStageKeyDown);
    this.status = this.shadow.querySelector<HTMLDivElement>('.status')!;
    this.toolbar = this.shadow.querySelector<HTMLDivElement>('.toolbar')!;
    this.toolbar.hidden = true;
    this.roomSelect = this.shadow.querySelector<HTMLSelectElement>('.room-nav select')!;
    this.homeButton = this.shadow.querySelector<HTMLButtonElement>('.home')!;
    this.coordinatesButton = this.shadow.querySelector<HTMLButtonElement>('.coordinates-toggle')!;
    this.coordinatesPanel = this.shadow.querySelector<HTMLDivElement>('.camera-coordinates')!;
    this.coordinatesText = this.coordinatesPanel.querySelector<HTMLPreElement>('pre')!;
    this.floorButtons = this.shadow.querySelector<HTMLDivElement>('.floor-buttons')!;
    this.treesButton = this.shadow.querySelector<HTMLButtonElement>('.trees-toggle')!;
    this.objectsButton = this.shadow.querySelector<HTMLButtonElement>('.objects-toggle')!;
    this.ignoredButton = this.shadow.querySelector<HTMLButtonElement>('.ignored-toggle')!;
    this.ignoredPanel = this.shadow.querySelector<HTMLDivElement>('.ignored-overlay')!;
    this.debugPanel = this.shadow.querySelector<HTMLDivElement>('.debug-panel')!;
    this.shadow.querySelector('.ignored-overlay .panel-close')!.addEventListener('click', () => this.setIgnoredVisible(false));
    this.shadow.querySelector('.camera-coordinates .panel-close')!.addEventListener('click', () => this.setCameraCoordinatesVisible(false));
    this.shadow.querySelector('.debug-panel .panel-close')!.addEventListener('click', () => this.setDebugPanelVisible(false));
    this.areasButton = this.shadow.querySelector<HTMLButtonElement>('.areas-toggle')!;
    this.cutawayButton = this.shadow.querySelector<HTMLButtonElement>('.cutaway-toggle')!;
    this.roomSelect.addEventListener('change', () => {
      const separator = this.roomSelect.value.indexOf(':');
      if (separator < 0) return;
      const kind = this.roomSelect.value.slice(0, separator);
      const id = this.roomSelect.value.slice(separator + 1);
      if (!id) return;
      if (kind === 'room') this.focusRoom(id);
      else if (kind === 'view') this.focusCameraView(id);
    });
    this.homeButton.addEventListener('click', () => this.showOverview());
    this.coordinatesButton.addEventListener('click', () => this.setCameraCoordinatesVisible(this.coordinatesPanel.hidden));
    this.ignoredButton.addEventListener('click', () => this.setIgnoredVisible(this.ignoredPanel.hidden));
    this.objectsButton.addEventListener('click', () => {
      this.objectsMode = this.objectsMode === 'configured' ? 'no-furniture' : this.objectsMode === 'no-furniture' ? 'none' : 'configured';
      this.updateObjectsButton();
    });
    this.treesButton.addEventListener('click', () => {
      this.renderer?.setTreesVisible(!this.renderer.treesVisible);
      this.updateTreesButton();
    });
    this.areasButton.addEventListener('click', () => {
      this.renderer?.setSiteAreasVisible(!this.renderer.siteAreasVisible);
      this.updateAreasButton();
    });
    this.cutawayButton.addEventListener('click', () => {
      const modes = ['off', 'fade', 'hide'] as const;
      const next = modes[(modes.indexOf(this.renderer?.cutawayMode ?? 'off') + 1) % modes.length];
      this.renderer?.setCutawayMode(next);
      this.updateCutawayButton();
    });
    this.createFilterButtons();
  }

  setConfig(config: ThreeFloorplanCardConfig): void {
    this.config = parseCardConfig(config);
    this.rawConfig = config;
    this.cardElement.style.height = this.config.height === undefined ? '' : `${this.config.height}px`;
    this.generation += 1;
    this.teardownRenderer();
    this.setStatus('Waiting for Home Assistant.');
    void this.start(this.generation);
  }

  set hass(hass: HomeAssistant) {
    this.homeAssistant = hass;
    this.stateProvider?.setHass(hass);
    this.actionProvider?.setHass(hass);
    if (this.renderer && this.stateProvider) this.updateEntities();
    else if (this.config) void this.start(this.generation);
  }

  connectedCallback(): void {
    if (this.config) void this.start(this.generation);
  }

  disconnectedCallback(): void {
    this.generation += 1;
    this.teardownRenderer();
    this.signatures.clear();
  }

  getCardSize(): number {
    return 8;
  }

  getGridOptions(): { columns: number; min_columns: number; rows: number; min_rows: number } {
    return { columns: 12, min_columns: 6, rows: 6, min_rows: 4 };
  }

  private async start(generation: number): Promise<void> {
    if (!this.isConnected || !this.config || !this.homeAssistant || this.renderer
      || this.loadingGeneration === generation) return;
    this.loadingGeneration = generation;
    this.setStatus('Loading floorplan…');
    try {
      if (this.rawConfig?.bindings_file) {
        const file = await loadBindingsFile(this.rawConfig.bindings_file);
        if (file) this.config = parseCardConfig(mergeBindingsFile(this.rawConfig, file));
        if (generation !== this.generation || !this.config) return;
      }
      const floorplan = selectRooms(await loadFloorplan(this.config.source), this.config);
      if (generation !== this.generation || !this.isConnected || !this.config || !this.homeAssistant) return;
      this.config.bindings = validateTargets(floorplan, this.config);
      if (this.config.debug) {
        this.config.bindings.push(...syntheticBindings(floorplan.entityPlacements ?? [], this.config.bindings));
      }
      this.floorplan = floorplan;
      this.populateRoomPicker(floorplan);
      this.areasButton.hidden = !floorplan.areas?.length;
      if (this.debugButton) this.debugButton.hidden = !this.config?.debug;
      if (this.debugPanelButton) this.debugPanelButton.hidden = !this.config?.debug;
      this.setDebugPanelVisible(false);
      this.debugPhase = 0;
      this.debugOverride = new Map();
      const ignored = listIgnoredElements(floorplan);
      this.ignoredPanel.querySelector('pre')!.textContent = formatIgnoredElements(ignored);
      this.ignoredButton.hidden = ignored.length === 0;
      this.setIgnoredVisible(false);
      this.filterButtons.forEach((button, kind) => {
        button.hidden = !this.config?.bindings.some(binding => binding.kind === kind);
      });
      this.toolbar.dataset.position = this.config.toolbarPosition;
      this.toolbar.hidden = false;
      this.renderer = new Renderer(this.stage, this.config.renderer);
      this.setCameraCoordinatesVisible(false);
      this.renderer.build(
        floorplan,
        this.config.bindings,
        resolveCelestialConfig(this.config.celestial, floorplan),
        this.config.roomStatus,
        this.config.cameraViews,
      );
      this.createFloorButtons();
      this.updateAreasButton();
      this.updateTreesButton();
      this.objectsMode = 'configured';
      this.updateObjectsButton();
      this.updateCutawayButton();
      this.renderer.setObjectDisplayDefaults(this.config.objects);
      this.renderer.setInteractionHandler((target, held) => this.handleInteraction(target, held));
      this.renderer.setRoomSelectionHandler(roomId => this.focusRoom(roomId));
      this.applyEntityFilters();
      this.stateProvider = new HomeAssistantStateProvider(this.homeAssistant);
      this.actionProvider = new HomeAssistantActionProvider(this.homeAssistant, this);
      this.status.hidden = true;
      this.updateEntities(true);
    } catch (error) {
      if (generation === this.generation) {
        this.teardownRenderer();
        this.setStatus(String(error), true);
      }
    } finally {
      if (this.loadingGeneration === generation) this.loadingGeneration = undefined;
    }
  }

  private createFloorButtons(): void {
    this.floorButtons.replaceChildren();
    const levels = this.renderer?.floorLevels() ?? [];
    if (levels.length < 2) return;
    levels.forEach((level, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'floor';
      button.textContent = String(index + 1);
      button.title = `Double-click to spread floors. ${level.name} (${level.elevation} m, height ${level.height} m)`;
      button.setAttribute('aria-label', `Toggle ${level.name}`);
      button.setAttribute('aria-pressed', 'true');
      button.addEventListener('click', () => {
        const visible = !this.renderer?.floorVisible(level.id);
        this.renderer?.setFloorVisible(level.id, visible);
        button.setAttribute('aria-pressed', String(visible));
      });
      button.addEventListener('dblclick', () => {
        this.renderer?.setFloorGapExpanded(!this.renderer.floorGapIsExpanded());
      });
      this.floorButtons.append(button);
    });
  }

  private setIgnoredVisible(visible: boolean): void {
    this.ignoredPanel.hidden = !visible;
    this.ignoredButton.setAttribute('aria-pressed', String(visible));
  }

  private entityFor(entityId: string): EntityState | undefined {
    return this.debugOverride.get(entityId) ?? this.stateProvider?.getEntity(entityId);
  }

  private setDebugPanelVisible(visible: boolean): void {
    this.debugPanel.hidden = !visible;
    this.debugPanelButton?.setAttribute('aria-pressed', String(visible));
    if (visible) this.renderDebugPanel();
  }

  private renderDebugPanel(): void {
    const list = this.debugPanel.querySelector<HTMLDivElement>('.debug-list')!;
    list.replaceChildren();
    const placements = new Map((this.floorplan?.entityPlacements ?? []).map(placement => [placement.id, placement]));
    const groups = new Map<Binding['kind'], Binding[]>();
    for (const binding of this.config?.bindings ?? []) {
      groups.set(binding.kind, [...(groups.get(binding.kind) ?? []), binding]);
    }
    const names: Record<Binding['kind'], string> = {
      light: 'Lights', 'water-leak': 'Water leaks', 'door-contact': 'Doors and windows', lock: 'Locks', cover: 'Covers',
      'environment-sensor': 'Environment sensors', 'motion-sensor': 'Motion', 'presence-sensor': 'Presence',
    };
    for (const [kind, bindings] of groups) {
      const heading = document.createElement('h4');
      heading.textContent = names[kind];
      list.append(heading);
      for (const binding of bindings) {
        const row = document.createElement('div');
        row.className = 'debug-row';
        const label = document.createElement('span');
        label.textContent = binding.ref;
        label.title = binding.ref;
        const current = this.entityFor(binding.entityId);
        const apply = (on: boolean, level?: number): void => {
          this.debugOverride.set(binding.entityId, debugState(binding, placements.get(binding.ref), on, level));
          this.updateEntities(true);
        };
        if (kind === 'cover' || kind === 'environment-sensor') {
          const slider = document.createElement('input');
          slider.type = 'range';
          slider.min = kind === 'cover' ? '0' : '-10';
          slider.max = kind === 'cover' ? '100' : '40';
          slider.value = String(kind === 'cover'
            ? Number(current?.attributes.current_position ?? 0)
            : Number(current?.state) || 20);
          slider.setAttribute('aria-label', `${binding.ref} value`);
          slider.addEventListener('input', () => apply(Number(slider.value) > 0, Number(slider.value)));
          row.append(label, slider);
        } else {
          const activeStates = ['on', 'unlocked', 'open'];
          const button = document.createElement('button');
          button.type = 'button';
          const labelFor = (active: boolean): string => kind === 'lock' ? (active ? 'Unlocked' : 'Locked')
            : kind === 'door-contact' ? (active ? 'Open' : 'Closed') : active ? 'On' : 'Off';
          let active = activeStates.includes(current?.state ?? '');
          button.textContent = labelFor(active);
          button.setAttribute('aria-pressed', String(active));
          button.addEventListener('click', () => {
            active = !active;
            button.textContent = labelFor(active);
            button.setAttribute('aria-pressed', String(active));
            apply(active);
          });
          row.append(label, button);
        }
        list.append(row);
      }
    }
    const wallRow = document.createElement('div');
    wallRow.className = 'debug-row';
    const wallLabel = document.createElement('span');
    wallLabel.textContent = 'Faded wall height';
    const wallValue = document.createElement('span');
    const wallSlider = document.createElement('input');
    wallSlider.type = 'range';
    wallSlider.min = '0';
    wallSlider.max = '3';
    wallSlider.step = '0.1';
    wallSlider.value = String(this.renderer?.fadedWallHeight ?? 3);
    const showWallValue = (): void => { wallValue.textContent = this.renderer?.fadedWallHeight === undefined ? 'full' : `${this.renderer.fadedWallHeight.toFixed(1)} m`; };
    wallSlider.setAttribute('aria-label', 'Height of faded walls');
    wallSlider.addEventListener('input', () => {
      const value = Number(wallSlider.value);
      this.renderer?.setFadedWallHeight(value >= 3 ? undefined : value);
      if (this.renderer && this.renderer.cutawayMode !== 'fade') { this.renderer.setCutawayMode('fade'); this.updateCutawayButton(); }
      showWallValue();
    });
    showWallValue();
    wallRow.append(wallLabel, wallValue, wallSlider);
    const wallHeading = document.createElement('h4');
    wallHeading.textContent = 'Walls';
    list.append(wallHeading, wallRow);
    const objects = (this.floorplan?.objects ?? []).filter(object => statusEntityOf(object, this.floorplan?.entityPlacements));
    if (objects.length > 0) {
      const heading = document.createElement('h4');
      heading.textContent = 'Objects';
      list.append(heading);
    }
    for (const object of objects) {
      const row = document.createElement('div');
      row.className = 'debug-row';
      const label = document.createElement('span');
      label.textContent = resolveObject(object, this.floorplan?.objectTypes).name;
      label.title = object.id;
      const button = document.createElement('button');
      button.type = 'button';
      let active = false;
      let progress = 0.4;
      const apply = (): void => {
        button.textContent = active ? 'Running' : 'Idle';
        button.setAttribute('aria-pressed', String(active));
        const next = debugObjectStates([object], this.floorplan?.entityPlacements ?? [], active, progress, Date.now());
        next.forEach((state, entityId) => this.debugOverride.set(entityId, state));
        this.updateEntities(true);
      };
      button.addEventListener('click', () => { active = !active; apply(); });
      const entityId = statusEntityOf(object, this.floorplan?.entityPlacements);
      const current = entityId ? this.entityFor(entityId) : undefined;
      active = deriveObjectState(current, object.status?.activeWhen) === 'active';
      button.textContent = active ? 'Running' : 'Idle';
      button.setAttribute('aria-pressed', String(active));
      row.append(label, button);
      if (object.status?.remaining?.entity) {
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '100';
        slider.value = String(progress * 100);
        slider.setAttribute('aria-label', `${label.textContent} progress`);
        slider.addEventListener('input', () => { progress = Number(slider.value) / 100; active = true; apply(); });
        row.append(slider);
      }
      list.append(row);
    }
    if (groups.size === 0 && objects.length === 0) list.append(document.createTextNode('No entities in this floorplan.'));
  }

  private cycleDebug(): void {
    if (!this.config) return;
    this.debugPhase = ((this.debugPhase + 1) % 3) as 0 | 1 | 2;
    this.debugOverride = this.debugPhase === 0
      ? new Map()
      : new Map([
        ...debugStates(this.config.bindings, this.floorplan?.entityPlacements ?? [], this.debugPhase),
        ...debugObjectStates(this.floorplan?.objects ?? [], this.floorplan?.entityPlacements ?? [], this.debugPhase === 1, 0.4, Date.now()),
      ]);
    if (this.debugButton) {
      this.debugButton.setAttribute('aria-pressed', String(this.debugPhase > 0));
      this.debugButton.title = ['Debug: test all entities', 'Debug: all active (click for opposite)', 'Debug: all inactive (click for live)'][this.debugPhase];
    }
    this.updateEntities(true);
  }

  private updateEntities(force = false): void {
    if (!this.config || !this.stateProvider || !this.renderer) return;
    const tracked = new Set([
      ...this.config.bindings.map(binding => binding.entityId),
      ...this.config.alerts.map(alert => alert.entity),
      ...this.config.roomStatus.map(status => status.entityId),
      ...(['sun', 'moon'] as const)
        .map(body => this.config?.celestial?.[body]?.entityId)
        .filter((entityId): entityId is string => entityId !== undefined),
    ]);
    const changed = new Set<string>();
    for (const entityId of tracked) {
      const signature = entitySignature(this.entityFor(entityId));
      if (force || this.signatures.get(entityId) !== signature) changed.add(entityId);
      this.signatures.set(entityId, signature);
    }
    for (const binding of this.config.bindings) {
      if (!changed.has(binding.entityId)) continue;
      const entity = this.entityFor(binding.entityId);
      if (binding.kind === 'light') {
        this.renderer.updateLight(binding.ref, lightView(entity));
      } else if (binding.kind === 'water-leak') {
        this.renderer.updateWaterLeak(binding.ref, entity);
      } else if (binding.kind === 'environment-sensor') {
        this.renderer.updateEnvironmentSensor(binding.ref, entity);
      } else if (binding.kind === 'lock' && binding.targetId) {
        this.renderer.updateLock(binding.targetId, lockView(entity?.state));
      } else if (binding.kind === 'cover' && binding.targetId) {
        this.renderer.updateCover(binding.targetId, coverPosition(entity));
      } else if (binding.kind === 'motion-sensor' || binding.kind === 'presence-sensor') {
        const placement = this.floorplan?.entityPlacements?.find(item => item.id === binding.ref);
        const detected = placement?.type === 'motion-sensor' || placement?.type === 'presence-sensor'
          ? presencePosition(entity, placement.detectionPositionAttribute)
          : undefined;
        this.renderer.updateSensor(binding.ref, entity?.state === 'on', detected);
      } else if (binding.targetId) {
        this.renderer.updateDoor(binding.targetId, doorView(entity), binding.mode);
      }
    }

    this.renderer.updateObjects({ getEntity: entityId => this.entityFor(entityId) });

    for (const body of ['sun', 'moon'] as const) {
      const entityId = this.config.celestial?.[body]?.entityId;
      if (entityId && changed.has(entityId)) {
        this.renderer.updateCelestial(body, sunPosition(this.stateProvider.getEntity(entityId)));
      }
    }

    for (const [index, alert] of this.config.alerts.entries()) {
      if (!changed.has(alert.entity)) continue;
      const entity = this.stateProvider.getEntity(alert.entity);
      const enabled = entity?.state === alert.state;
      alert.effects.forEach((effect, effectIndex) => {
        this.renderer?.setEffect(`alert:${index}:${effectIndex}`, effect, enabled);
        if (enabled && effect.effect === 'camera-focus'
          && this.config?.cameraViews.some(view => view.id === effect.target)) {
          this.focusCameraView(effect.target);
        }
      });
    }
    for (const status of this.config.roomStatus) {
      if (!force && !changed.has(status.entityId)) continue;
      this.renderer.updateRoomStatus(
        status.roomId,
        roomStatusColor(status, this.stateProvider.getEntity(status.entityId)),
      );
    }
    const missing = [...tracked].filter(entityId => !entityId.startsWith(debugEntityPrefix) && !this.stateProvider?.getEntity(entityId));
    const unavailable = [...tracked].filter(entityId => {
      const state = this.stateProvider?.getState(entityId);
      return state === 'unknown' || state === 'unavailable';
    });
    if (missing.length > 0) {
      this.setStatus(`Home Assistant entities not found: ${missing.join(', ')}`, true);
    } else if (unavailable.length > 0) {
      this.setStatus(`Home Assistant entities unavailable: ${unavailable.join(', ')}`, true);
    } else if (this.status.textContent?.startsWith('Home Assistant entities ')) {
      this.status.hidden = true;
    }
  }

  private handleInteraction(target: string, held: boolean): void {
    if (!this.config || !this.actionProvider) return;
    if (target.startsWith('object:')) {
      const entityId = this.renderer?.objectEntity(target.slice('object:'.length));
      if (entityId) this.actionProvider.moreInfo(entityId);
      return;
    }
    const binding = this.config.bindings.find(item => item.ref === target)
      ?? this.config.bindings.find(item => (item.kind === 'door-contact' || item.kind === 'cover')
        && item.targetId !== undefined
        && (item.targetId === target || target.includes(item.targetId)));
    if (!binding) return;
    const actions = this.config.actions.get(binding.ref);
    const action = held ? actions?.hold : actions?.tap;
    if (action === 'more-info') {
      this.actionProvider.moreInfo(binding.entityId);
    } else if (action === 'toggle') {
      void this.actionProvider.toggle(binding.entityId).catch(error => {
        this.setStatus(`Unable to toggle ${binding.entityId}: ${String(error)}`, true);
      });
    }
  }

  private createFilterButtons(): void {
    const labels: Array<[Binding['kind'], string, string]> = [
      ['lock', 'Locks', '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'],
      ['cover', 'Covers', '<path d="M4 4h16v16H4zM4 8h16M4 12h16M4 16h16"/>'],
      ['environment-sensor', 'Environmental values', '<path d="M8 3v11a4 4 0 1 0 8 0V3"/><path d="M8 7h8M8 11h8"/>'],
      ['light', 'Lights', '<circle cx="12" cy="12" r="3"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>'],
      ['water-leak', 'Water leaks', '<path d="M12 2C9.2 6.1 5 10.3 5 14.5a7 7 0 0 0 14 0C19 10.3 14.8 6.1 12 2Z"/><path d="M9 15a3 3 0 0 0 3 3"/>'],
      ['motion-sensor', 'Motion', '<path d="M3 12h3l2-7 4 14 2-7h7"/>'],
      ['presence-sensor', 'Presence', '<circle cx="12" cy="7" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>'],
    ];
    const container = this.shadow.querySelector<HTMLDivElement>('.filters')!;
    const debug = document.createElement('button');
    debug.type = 'button';
    debug.hidden = true;
    debug.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/></svg>';
    debug.title = 'Debug: test all entities';
    debug.setAttribute('aria-label', 'Test all entities');
    debug.setAttribute('aria-pressed', 'false');
    debug.addEventListener('click', () => this.cycleDebug());
    container.append(debug);
    const panelButton = document.createElement('button');
    panelButton.type = 'button';
    panelButton.hidden = true;
    panelButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>';
    panelButton.title = 'Debug: entity tester';
    panelButton.setAttribute('aria-label', 'Open entity tester');
    panelButton.setAttribute('aria-pressed', 'false');
    panelButton.addEventListener('click', () => this.setDebugPanelVisible(this.debugPanel.hidden));
    container.append(panelButton);
    this.debugPanelButton = panelButton;
    this.debugButton = debug;
    for (const [kind, label, icon] of labels) {
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
      button.setAttribute('aria-label', `Toggle ${label.toLowerCase()}`);
      button.setAttribute('aria-pressed', 'true');
      button.title = label;
      let holdTimer: number | undefined;
      let isolated = false;
      button.addEventListener('pointerdown', () => {
        isolated = false;
        holdTimer = window.setTimeout(() => {
          isolated = true;
          for (const candidate of this.visibleKinds.keys()) {
            this.visibleKinds.set(candidate, candidate === kind);
          }
          this.applyEntityFilters();
          this.updateFilterButtons();
        }, 500);
      });
      const cancelHold = () => {
        if (holdTimer !== undefined) window.clearTimeout(holdTimer);
        holdTimer = undefined;
      };
      button.addEventListener('pointerup', cancelHold);
      button.addEventListener('pointercancel', cancelHold);
      button.addEventListener('pointerleave', cancelHold);
      button.addEventListener('click', () => {
        if (isolated) {
          isolated = false;
          return;
        }
        this.visibleKinds.set(kind, !this.visibleKinds.get(kind));
        this.applyEntityFilters();
        this.updateFilterButtons();
      });
      this.filterButtons.set(kind, button);
      container.append(button);
    }
    const showAll = document.createElement('button');
    showAll.type = 'button';
    showAll.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="8" cy="7" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="10" cy="17" r="1"/></svg>';
    showAll.setAttribute('aria-label', 'Show all entity types');
    showAll.title = 'Show all';
    showAll.addEventListener('click', () => {
      for (const kind of this.visibleKinds.keys()) this.visibleKinds.set(kind, true);
      this.applyEntityFilters();
      this.updateFilterButtons();
    });
    container.append(showAll);
  }

  private updateFilterButtons(): void {
    this.filterButtons.forEach((button, kind) => {
      button.setAttribute('aria-pressed', String(this.visibleKinds.get(kind) ?? true));
    });
  }

  private updateObjectsButton(): void {
    if (!this.renderer) return;
    this.objectsButton.hidden = this.renderer.objectCount === 0;
    this.renderer.setObjectCategoryDisplay('furniture', this.objectsMode === 'configured' ? undefined : 'hidden');
    this.renderer.setObjectCategoryDisplay('appliance', this.objectsMode === 'none' ? 'hidden' : undefined);
    const label = this.objectsMode === 'configured' ? 'Objects: as configured'
      : this.objectsMode === 'no-furniture' ? 'Objects: furniture hidden' : 'Objects: all hidden';
    this.objectsButton.setAttribute('aria-pressed', String(this.objectsMode === 'configured'));
    this.objectsButton.setAttribute('aria-label', label);
    this.objectsButton.title = `${label} (click for next)`;
    this.setStateDots(this.objectsButton, 3, ['configured', 'no-furniture', 'none'].indexOf(this.objectsMode));
  }

  private updateTreesButton(): void {
    if (!this.renderer) return;
    const visible = this.renderer.treesVisible;
    this.treesButton.hidden = this.renderer.treeCount === 0;
    this.treesButton.setAttribute('aria-pressed', String(visible));
    this.treesButton.setAttribute('aria-label', visible ? 'Hide trees' : 'Show trees');
    this.treesButton.title = visible ? 'Hide trees' : 'Show trees';
  }

  private updateAreasButton(): void {
    if (!this.renderer) return;
    const visible = this.renderer.siteAreasVisible;
    this.areasButton.setAttribute('aria-pressed', String(visible));
    this.areasButton.setAttribute('aria-label', visible ? 'Hide site areas' : 'Show site areas');
    this.areasButton.title = visible ? 'Hide site areas and zoom in' : 'Show site areas and zoom out';
  }

  private updateCutawayButton(): void {
    if (!this.renderer) return;
    const mode = this.renderer.cutawayMode;
    const label = mode === 'off' ? 'Walls: solid' : mode === 'fade' ? 'Walls: camera-facing walls faded' : 'Walls: camera-facing walls hidden';
    this.cutawayButton.setAttribute('aria-pressed', String(mode !== 'off'));
    this.cutawayButton.setAttribute('aria-label', label);
    this.cutawayButton.title = `${label} (click for next)`;
    this.setStateDots(this.cutawayButton, 3, ['off', 'fade', 'hide'].indexOf(mode));
  }

  /** Shows every state of a multi-state button as dots, the current one filled. */
  private setStateDots(button: HTMLButtonElement, count: number, index: number): void {
    let dots = button.querySelector<HTMLSpanElement>('.dots');
    if (!dots || dots.childElementCount !== count) {
      dots?.remove();
      dots = document.createElement('span');
      dots.className = 'dots';
      for (let item = 0; item < count; item++) dots.append(document.createElement('i'));
      button.append(dots);
    }
    Array.from(dots.children).forEach((dot, item) => dot.classList.toggle('on', item === index));
  }

  private setCameraCoordinatesVisible(visible: boolean): void {
    this.coordinatesPanel.hidden = !visible;
    this.coordinatesButton.setAttribute('aria-pressed', String(visible));
    this.coordinatesButton.setAttribute(
      'aria-label',
      visible ? 'Hide camera coordinates' : 'Show camera coordinates',
    );
    this.coordinatesButton.title = visible
      ? 'Hide camera coordinates (C)'
      : 'Show camera coordinates (C)';
    this.renderer?.setCameraCoordinatesHandler(
      visible ? coordinates => this.updateCameraCoordinates(coordinates) : undefined,
    );
  }

  private updateCameraCoordinates({ position, target }: CameraCoordinates): void {
    const format = (values: number[]) =>
      `[${values.map(value => (Math.abs(value) < 0.0005 ? 0 : value).toFixed(3)).join(', ')}]`;
    this.coordinatesText.textContent = `position: ${format(position)}\ntarget:   ${format(target)}`;
  }

  private focusStage = (): void => {
    this.stage.focus({ preventScroll: true });
  };

  private onStageKeyDown = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    if (event.key.toLowerCase() === 'c') {
      event.preventDefault();
      this.setCameraCoordinatesVisible(this.coordinatesPanel.hidden);
    } else if (event.key === 'Escape' && !this.coordinatesPanel.hidden) {
      this.setCameraCoordinatesVisible(false);
    }
  };

  private applyEntityFilters(): void {
    this.visibleKinds.forEach((visible, kind) => this.renderer?.setEntityTypeVisible(kind, visible));
  }

  private populateRoomPicker(floorplan: Floorplan): void {
    this.roomSelect.replaceChildren(new Option('Choose a view or room…', ''));
    const rooms = document.createElement('optgroup');
    rooms.label = 'Rooms';
    for (const room of floorplan.rooms) {
      if (room.id === 'outside') continue;
      rooms.append(new Option(room.name, `room:${room.id}`));
    }
    this.roomSelect.append(rooms);
    if (this.config?.cameraViews.length) {
      const views = document.createElement('optgroup');
      views.label = 'Saved camera views';
      this.config.cameraViews.forEach(view => views.append(new Option(view.name, `view:${view.id}`)));
      this.roomSelect.append(views);
    }
  }

  private focusRoom(roomId: string): void {
    const room = this.floorplan?.rooms.find(item => item.id === roomId);
    if (!room) return;
    this.renderer?.focusRoom(roomId);
    this.roomSelect.value = `room:${roomId}`;
    this.roomSelect.hidden = false;
    this.roomSelect.setAttribute('aria-label', `Focused room: ${room.name}`);
    this.homeButton.hidden = false;
  }

  private focusCameraView(viewId: string): void {
    const view = this.config?.cameraViews.find(item => item.id === viewId);
    if (!view) return;
    this.renderer?.focusCameraView(viewId);
    this.roomSelect.value = `view:${viewId}`;
    this.roomSelect.hidden = false;
    this.roomSelect.setAttribute('aria-label', `Focused camera view: ${view.name}`);
    this.homeButton.hidden = false;
  }

  private showOverview(): void {
    this.renderer?.showOverview();
    this.roomSelect.value = '';
    this.roomSelect.hidden = false;
    this.roomSelect.setAttribute('aria-label', 'Choose a room or saved camera view');
    this.homeButton.hidden = true;
  }

  private setStatus(message: string, error = false): void {
    this.status.textContent = message;
    this.status.hidden = false;
    this.status.classList.toggle('error', error);
    this.status.setAttribute('role', error ? 'alert' : 'status');
  }

  private teardownRenderer(): void {
    this.renderer?.dispose();
    this.renderer = undefined;
    this.setCameraCoordinatesVisible(false);
    this.toolbar.hidden = true;
    this.stateProvider = undefined;
    this.actionProvider = undefined;
    this.signatures.clear();
    this.floorplan = undefined;
    this.stage.replaceChildren();
  }
}
