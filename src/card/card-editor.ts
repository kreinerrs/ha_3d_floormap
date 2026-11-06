import type { EntityPlacement, Binding } from '../core/types';
import { updatePlacementBinding, type ThreeFloorplanCardConfig } from './card-config';
import type { HomeAssistant } from '../adapters/home-assistant-adapter';

type EntityPicker = HTMLElement & {
  hass?: HomeAssistant;
  value?: string;
  label?: string;
  includeDomains?: string[];
};

const domainsByPlacement: Record<EntityPlacement['type'], string[]> = {
  light: ['light', 'switch'],
  'water-leak': ['binary_sensor'],
  'door-contact': ['binary_sensor'],
  'window-contact': ['binary_sensor'],
  lock: ['lock'],
  cover: ['cover'],
  'environment-sensor': ['sensor'],
  'motion-sensor': ['binary_sensor'],
  'presence-sensor': ['binary_sensor'],
};

const placementGroups: Array<{ type: EntityPlacement['type']; label: string }> = [
  { type: 'light', label: 'Lights' },
  { type: 'water-leak', label: 'Water-leak sensors' },
  { type: 'door-contact', label: 'Door and window contacts' },
  { type: 'window-contact', label: 'Window contacts' },
  { type: 'lock', label: 'Door locks' },
  { type: 'cover', label: 'Covers' },
  { type: 'environment-sensor', label: 'Environmental sensors' },
  { type: 'motion-sensor', label: 'Motion sensors' },
  { type: 'presence-sensor', label: 'Presence sensors' },
];

function placementKind(placement: EntityPlacement): Binding['kind'] {
  switch (placement.type) {
    case 'window-contact':
      return 'door-contact';
    case 'light':
    case 'water-leak':
    case 'door-contact':
    case 'cover':
    case 'lock':
    case 'environment-sensor':
    case 'motion-sensor':
    case 'presence-sensor':
      return placement.type;
  }
}

export class ThreeFloorplanCardEditor extends HTMLElement {
  private _hass?: HomeAssistant;
  private config?: ThreeFloorplanCardConfig;
  private configuredSource?: string;
  private loadedSource?: string;
  private loadedPlacements?: EntityPlacement[];
  private loadGeneration = 0;
  private readonly expandedGroups = new Set<EntityPlacement['type']>();
  private readonly root: ShadowRoot;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    this.root.querySelectorAll<EntityPicker>('ha-entity-picker')
      .forEach(picker => { picker.hass = hass; });
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  setConfig(config: ThreeFloorplanCardConfig): void {
    this.config = {
      ...config,
      bindings: { ...config.bindings },
    };
    const source = typeof config.floorplan === 'string' ? config.floorplan : config.floorplan.source;
    this.render();
    if (source !== this.configuredSource) {
      this.configuredSource = source;
      this.loadedSource = undefined;
      this.loadedPlacements = undefined;
      this.loadGeneration += 1;
      void this.loadPlacements(source);
    } else if (this.loadedSource === this.configuredSource && this.loadedPlacements) {
      this.renderPlacements(this.loadedPlacements);
    }
  }

  private render(): void {
    this.root.innerHTML = `
      <style>
        :host { display: block; color: var(--primary-text-color); }
        .field { display: grid; gap: 8px; margin: 12px 0 20px; }
        input, select { box-sizing: border-box; width: 100%; min-height: 40px; padding: 8px 12px;
          border: 1px solid var(--divider-color); border-radius: 4px;
          background: var(--input-fill-color, var(--card-background-color)); color: inherit; }
        .placement { display: grid; grid-template-columns: minmax(140px, 1fr) minmax(220px, 2fr);
          align-items: center; gap: 16px; padding: 10px 0; border-top: 1px solid var(--divider-color); }
        details { margin: 8px 0; border: 1px solid var(--divider-color); border-radius: 6px; }
        summary { padding: 12px; cursor: pointer; font-weight: 500; }
        .group-content { padding: 0 12px 8px; }
        .name { font-weight: 500; }
        .detail, .hint { color: var(--secondary-text-color); font-size: 0.9em; }
        .message { margin: 12px 0; color: var(--secondary-text-color); }
        .error { color: var(--error-color, #b3261e); }
        @media (max-width: 520px) { .placement { grid-template-columns: 1fr; gap: 4px; } }
      </style>
      <label class="field">
        <span>Visualization style</span>
        <select class="style">
          <option value="standard">Standard</option>
          <option value="comic">Comic</option>
          <option value="futuristic">Futuristic</option>
        </select>
      </label>
      <label class="field">
        <span>Outline thickness (px; comic and futuristic)</span>
        <input class="line-thickness" type="number" min="1" step="0.5">
      </label>
      <label class="field">
        <span>Floorplan JSON URL</span>
        <input class="source" type="text" placeholder="/local/floorplans/home.json">
      </label>
      <p class="hint">Choose a Home Assistant entity for each placement. Assignments use stable placement IDs, so they remain linked when a placement moves.</p>
      <div class="message" role="status">Enter a floorplan URL to load its entity placements.</div>
      <div class="placements"></div>`;

    const sourceInput = this.root.querySelector<HTMLInputElement>('.source')!;
    const styleSelect = this.root.querySelector<HTMLSelectElement>('.style')!;
    styleSelect.value = this.config?.appearance?.style ?? 'standard';
    styleSelect.addEventListener('change', () => {
      if (!this.config) return;
      const style = styleSelect.value;
      if (style !== 'standard' && style !== 'comic' && style !== 'futuristic') return;
      this.dispatchConfig({
        ...this.config,
        appearance: { ...this.config.appearance, style },
      });
    });
    const lineThicknessInput = this.root.querySelector<HTMLInputElement>('.line-thickness')!;
    lineThicknessInput.value = String(this.config?.appearance?.line_thickness ?? 3);
    lineThicknessInput.addEventListener('change', () => {
      if (!this.config) return;
      const lineThickness = Number(lineThicknessInput.value);
      if (!Number.isFinite(lineThickness) || lineThickness < 1) return;
      this.dispatchConfig({
        ...this.config,
        appearance: { ...this.config.appearance, line_thickness: lineThickness },
      });
    });
    sourceInput.value = typeof this.config?.floorplan === 'string'
      ? this.config.floorplan
      : this.config?.floorplan.source ?? '';
    sourceInput.addEventListener('change', () => {
      const source = sourceInput.value.trim();
      if (!source || !this.config) return;
      const next = { ...this.config, floorplan: { source } };
      this.configuredSource = source;
      this.loadedSource = undefined;
      this.loadedPlacements = undefined;
      this.dispatchConfig(next);
      void this.loadPlacements(source);
    });
  }

  private async loadPlacements(source: string): Promise<void> {
    if (!source) return;
    const generation = ++this.loadGeneration;
    this.showMessage('Loading placements…');
    try {
      const response = await fetch(source, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || !Array.isArray((value as { entityPlacements?: unknown }).entityPlacements)) {
        throw new Error('Floorplan does not contain an entityPlacements array');
      }
      if (generation !== this.loadGeneration) return;
      const all = (value as { entityPlacements: unknown[] }).entityPlacements;
      const placements = all.filter(placement => !!placement && typeof placement === 'object'
        && typeof (placement as { id?: unknown }).id === 'string'
        && typeof (placement as { type?: unknown }).type === 'string'
        && Object.hasOwn(domainsByPlacement, (placement as { type: string }).type));
      const skipped = all.length - placements.length;
      if (skipped) console.warn(`${skipped} entity placement${skipped === 1 ? '' : 's'} with an unsupported type or no ID were skipped in the card editor`);
      this.loadedSource = source;
      this.loadedPlacements = placements as EntityPlacement[];
      this.renderPlacements(this.loadedPlacements);
    } catch (error) {
      if (generation === this.loadGeneration) this.showMessage(`Unable to load floorplan placements: ${String(error)}`, true);
    }
  }

  private renderPlacements(placements: EntityPlacement[]): void {
    const container = this.root.querySelector<HTMLDivElement>('.placements');
    if (!container || !this.config) return;
    container.replaceChildren();
    const validIds = new Set(placements.map(placement => placement.id));
    const staleBindings = Object.keys(this.config.bindings ?? {}).filter(id => !validIds.has(id));
    this.showMessage(placements.length
      ? `${placements.length} placement${placements.length === 1 ? '' : 's'} found.`
      : 'No entity placements are defined in this floorplan.');

    for (const group of placementGroups) {
      const items = placements.filter(placement => placement.type === group.type);
      if (!items.length) continue;
      const assignedCount = items.filter(placement => this.config?.bindings?.[placement.id]?.entity).length;
      const section = document.createElement('details');
      section.open = this.expandedGroups.has(group.type);
      section.addEventListener('toggle', () => {
        if (section.open) this.expandedGroups.add(group.type);
        else this.expandedGroups.delete(group.type);
      });
      const summary = document.createElement('summary');
      summary.textContent = `${group.label} (${assignedCount}/${items.length} assigned)`;
      const content = document.createElement('div');
      content.className = 'group-content';

      for (const placement of items) {
        const row = document.createElement('div');
        row.className = 'placement';
        const title = document.createElement('div');
        title.innerHTML = `<div class="name"></div><div class="detail"></div>`;
        title.querySelector('.name')!.textContent = placement.id;
        title.querySelector('.detail')!.textContent = 'areaId' in placement
          ? placement.areaId ?? ''
          : 'roomId' in placement
            ? placement.roomId ?? ''
            : placement.connectorId;
        const picker = document.createElement('ha-entity-picker') as EntityPicker;
        picker.hass = this._hass;
        picker.label = 'Home Assistant entity';
        picker.includeDomains = domainsByPlacement[placement.type];
        picker.value = this.config.bindings?.[placement.id]?.entity ?? '';
        picker.addEventListener('value-changed', event => {
          const entityId = (event as CustomEvent<{ value?: string }>).detail?.value ?? '';
          if (!this.config) return;
          this.dispatchConfig(updatePlacementBinding(
            this.config,
            placement.id,
            entityId,
            placementKind(placement),
          ));
        });
        row.append(title, picker);
        content.append(row);
      }

      section.append(summary, content);
      container.append(section);
    }

    for (const id of staleBindings) {
      const note = document.createElement('p');
      note.className = 'message';
      note.textContent = `Saved binding "${id}" is not present in the current floorplan. It has been preserved.`;
      container.append(note);
    }
  }

  private showMessage(message: string, error = false): void {
    const status = this.root.querySelector<HTMLParagraphElement>('.message');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  private dispatchConfig(config: ThreeFloorplanCardConfig): void {
    this.config = config;
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config },
      bubbles: true,
      composed: true,
    }));
  }
}
