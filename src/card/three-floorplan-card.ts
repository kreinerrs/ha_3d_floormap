import type { EntityState, Floorplan } from '../core/types';
import { resolveOpenings } from '../core/geometry';
import { HomeAssistantActionProvider } from '../adapters/action-adapter';
import { HomeAssistantStateProvider, type HomeAssistant } from '../adapters/home-assistant-adapter';
import { doorView, lightView } from '../state/state';
import { Renderer } from '../renderer/renderer';
import { parseCardConfig, type ParsedCardConfig, type ThreeFloorplanCardConfig } from './card-config';

const styles = `
  :host { display: block; }
  .card { position: relative; height: var(--three-floorplan-card-height, 480px); min-height: 240px; overflow: hidden; border-radius: var(--ha-card-border-radius, 12px); background: #101821; }
  .canvas { width: 100%; height: 100%; }
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
  if (typeof candidate.schemaVersion !== 'string' || !candidate.schemaVersion.startsWith('2.')) {
    throw new Error(`Unsupported floorplan schema version: ${String(candidate.schemaVersion ?? 'missing')}`);
  }
  if (!Array.isArray(candidate.rooms) || candidate.rooms.length === 0) {
    throw new Error('Floorplan must contain at least one room');
  }
  for (const room of candidate.rooms) {
    if (!room || typeof room.id !== 'string' || !room.layout
      || ![room.layout.x, room.layout.y, room.layout.width, room.layout.height].every(Number.isFinite)
      || room.layout.width <= 0 || room.layout.height <= 0
      || !Array.isArray(room.connectors)) {
      throw new Error('Floorplan contains a room with invalid layout or connectors');
    }
  }
  return candidate as Floorplan;
}

function validateTargets(floorplan: Floorplan, config: ParsedCardConfig): void {
  const roomIds = new Set(floorplan.rooms.map(room => room.id));
  const openings = resolveOpenings(floorplan, {
    ...config.renderer.visuals,
    ...floorplan.buildingDefaults,
  });
  for (const binding of config.bindings) {
    const found = binding.kind === 'light'
      ? roomIds.has(binding.targetId)
      : openings.some(opening => opening.id === binding.targetId || opening.id.split('--').includes(binding.targetId));
    if (!found) {
      throw new Error(`Binding "${binding.ref}" target "${binding.targetId}" was not found in the floorplan`);
    }
  }
  for (const alert of config.alerts) {
    for (const effect of alert.effects) {
      if (!roomIds.has(effect.target)) {
        throw new Error(`Alert target "${effect.target}" was not found in the floorplan`);
      }
    }
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
  private config?: ParsedCardConfig;
  private homeAssistant?: HomeAssistant;
  private renderer?: Renderer;
  private stateProvider?: HomeAssistantStateProvider;
  private actionProvider?: HomeAssistantActionProvider;
  private readonly signatures = new Map<string, string>();
  private readonly shadow: ShadowRoot;
  private readonly stage: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private generation = 0;
  private loadingGeneration?: number;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `<style>${styles}</style><div class="card"><div class="canvas"></div><div class="status" role="status" aria-live="polite">Waiting for Home Assistant.</div></div>`;
    this.stage = this.shadow.querySelector<HTMLDivElement>('.canvas')!;
    this.status = this.shadow.querySelector<HTMLDivElement>('.status')!;
  }

  setConfig(config: ThreeFloorplanCardConfig): void {
    this.config = parseCardConfig(config);
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
      const floorplan = await loadFloorplan(this.config.source);
      if (generation !== this.generation || !this.isConnected || !this.config || !this.homeAssistant) return;
      validateTargets(floorplan, this.config);
      this.renderer = new Renderer(this.stage, this.config.renderer);
      this.renderer.build(floorplan, this.config.bindings);
      this.renderer.setInteractionHandler((target, held) => this.handleInteraction(target, held));
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

  private updateEntities(force = false): void {
    if (!this.config || !this.stateProvider || !this.renderer) return;
    const tracked = new Set([
      ...this.config.bindings.map(binding => binding.entityId),
      ...this.config.alerts.map(alert => alert.entity),
    ]);
    const changed = new Set<string>();
    for (const entityId of tracked) {
      const signature = entitySignature(this.stateProvider.getEntity(entityId));
      if (force || this.signatures.get(entityId) !== signature) changed.add(entityId);
      this.signatures.set(entityId, signature);
    }
    for (const binding of this.config.bindings) {
      if (!changed.has(binding.entityId)) continue;
      const entity = this.stateProvider.getEntity(binding.entityId);
      if (binding.kind === 'light') {
        this.renderer.updateLight(binding.ref, lightView(entity));
      } else {
        this.renderer.updateDoor(binding.targetId, doorView(entity));
      }
    }

    for (const [index, alert] of this.config.alerts.entries()) {
      if (!changed.has(alert.entity)) continue;
      const entity = this.stateProvider.getEntity(alert.entity);
      const enabled = entity?.state === alert.state;
      alert.effects.forEach((effect, effectIndex) => {
        this.renderer?.setEffect(`alert:${index}:${effectIndex}`, effect, enabled);
      });
    }
    const missing = [...tracked].filter(entityId => !this.stateProvider?.getEntity(entityId));
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
    const binding = this.config.bindings.find(item => item.ref === target)
      ?? this.config.bindings.find(item => item.kind === 'door-contact'
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

  private setStatus(message: string, error = false): void {
    this.status.textContent = message;
    this.status.hidden = false;
    this.status.classList.toggle('error', error);
    this.status.setAttribute('role', error ? 'alert' : 'status');
  }

  private teardownRenderer(): void {
    this.renderer?.dispose();
    this.renderer = undefined;
    this.stateProvider = undefined;
    this.actionProvider = undefined;
    this.signatures.clear();
    this.stage.replaceChildren();
  }
}
