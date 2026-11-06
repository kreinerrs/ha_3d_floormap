import './style.css';
import { active } from './core/effects';
import { lockView } from './core/lock';
import { coverPosition } from './core/cover';
import { loadConfig } from './core/config';
import type { Floorplan, MockDoc } from './core/types';
import { normalizeEntityPlacementCoordinates, sanitizeEntityPlacements } from './core/entity-placement';
import { normalizeOpenings } from './core/openings';
import type { EffectsDoc } from './core/effects';
import { Renderer } from './renderer/renderer';
import { doorView, lightView, MockProvider } from './state/state';

const json = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json() as Promise<T>;
};

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('Preview app root was not found');
  const stage = document.createElement('main');
  app.append(stage);

  try {
    const config = await loadConfig();
    const [loadedFloorplan, mock, effects] = await Promise.all([
      json<Floorplan>(config.floorplanUrl),
      json<MockDoc>(config.mockStateUrl),
      json<EffectsDoc>(config.effectsUrl),
    ]);
    const floorplan = normalizeOpenings(sanitizeEntityPlacements(normalizeEntityPlacementCoordinates(loadedFloorplan)));
    const renderer = new Renderer(stage, config);
    renderer.build(floorplan, mock.bindings);
    const provider = new MockProvider(mock);
    const bindings = new Map(mock.bindings.map(binding => [binding.entityId, binding]));
    const panel = document.createElement('aside');
    panel.innerHTML = '<h1>Interactive preview</h1><p>Adjust values and openings to test the floorplan visuals.</p>';

    mock.bindings.forEach(binding => {
      if (binding.kind === 'environment-sensor') {
        const entity = provider.getEntity(binding.entityId);
        const placement = floorplan.entityPlacements?.find(item => item.id === binding.ref);
        const measures = placement?.type === 'environment-sensor' ? placement.measures : undefined;
        for (const measure of measures ?? [undefined]) {
          const attributeValue = measure
            ? measure.attribute === 'state' ? entity?.state : entity?.attributes[measure.attribute]
            : entity?.state;
          const unitValue = measure
            ? measure.unit ?? (measure.attribute === 'state'
              ? entity?.attributes.unit_of_measurement
              : entity?.attributes[`${measure.attribute}_unit`])
            : entity?.attributes.unit_of_measurement;
          const unit = typeof unitValue === 'string' ? unitValue : '';
          const initialValue = Number(attributeValue);
          const isTemperature = measure?.name.toLowerCase().includes('temperature')
            || unit === '°C' || unit === '°F';
          const label = document.createElement('label');
          label.className = 'preview-value';
          const title = document.createElement('span');
          title.textContent = measure?.name ?? binding.label ?? binding.ref;
          const output = document.createElement('output');
          output.textContent = `${Number.isFinite(initialValue) ? initialValue : '—'}${unit ? ` ${unit}` : ''}`;
          const slider = document.createElement('input');
          slider.type = 'range';
          slider.min = String(isTemperature ? -10 : 0);
          slider.max = String(isTemperature ? 40 : measure?.name.toLowerCase().includes('humidity') ? 100 : 2000);
          slider.step = measure?.precision === 0 ? '1' : '0.1';
          slider.value = String(Number.isFinite(initialValue) ? initialValue : 0);
          slider.addEventListener('input', () => {
            output.textContent = `${slider.value}${unit ? ` ${unit}` : ''}`;
            if (measure) {
              if (measure.attribute === 'state') provider.setState(binding.entityId, slider.value);
              else provider.setState(binding.entityId, entity?.state ?? slider.value, {
                  [measure.attribute]: Number(slider.value),
                });
            } else {
              provider.setState(binding.entityId, slider.value);
            }
          });
          label.append(title, output, slider);
          panel.append(label);
        }
        return;
      }

      const button = document.createElement('button');
      button.textContent = binding.kind === 'cover' ? `Move ${binding.ref}` : `Toggle ${binding.ref}`;
      button.addEventListener('click', () => {
        if (binding.kind === 'cover') {
          const current = coverPosition(provider.getEntity(binding.entityId)) ?? 0;
          const nextPosition = current > 0 ? 0 : 100;
          provider.setState(binding.entityId, nextPosition === 100 ? 'open' : 'closed', { current_position: nextPosition });
        } else if (binding.kind === 'lock') {
          provider.setState(binding.entityId, provider.getState(binding.entityId) === 'locked' ? 'unlocked' : 'locked');
        } else {
          provider.toggle(binding.entityId);
        }
      });
      panel.append(button);
    });
    app.append(panel);

    const evaluate = () => effects.rules.forEach(rule => {
      rule.effects.forEach((effect, index) => {
        renderer.setEffect(`${rule.id}:${index}`, effect, active(rule, provider));
      });
    });
    provider.subscribe(state => {
      const binding = bindings.get(state.entity_id);
      if (binding) {
        if (binding.kind === 'light') renderer.updateLight(binding.ref, lightView(state));
        else if (binding.kind === 'water-leak') renderer.updateWaterLeak(binding.ref, state);
        else if (binding.kind === 'environment-sensor') renderer.updateEnvironmentSensor(binding.ref, state);
        else if (binding.kind === 'lock' && binding.targetId) renderer.updateLock(binding.targetId, lockView(state.state));
        else if (binding.kind === 'cover' && binding.targetId) {
          renderer.updateCover(binding.targetId, coverPosition(state));
        } else if (binding.targetId) renderer.updateDoor(binding.targetId, doorView(state));
      }
      evaluate();
    });
    evaluate();
  } catch (error) {
    stage.innerHTML = `<pre>${String(error)}</pre>`;
  }
}

void main();
