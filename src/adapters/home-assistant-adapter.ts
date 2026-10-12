import type { EntityState, StateProvider } from '../core/types';

export interface HomeAssistant {
  states: Record<string, EntityState>;
  callService(domain: string, service: string, data: Record<string, unknown>): Promise<unknown>;
}

export class HomeAssistantStateProvider implements StateProvider {
  constructor(private hass: HomeAssistant) {}

  setHass(hass: HomeAssistant): void {
    this.hass = hass;
  }

  getEntity(entityId: string): EntityState | undefined {
    return this.hass.states[entityId];
  }

  getState(entityId: string): string | undefined {
    return this.getEntity(entityId)?.state;
  }
}
