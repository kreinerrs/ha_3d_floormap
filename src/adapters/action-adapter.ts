import type { ActionProvider } from '../core/types';
import type { HomeAssistant } from './home-assistant-adapter';

export class HomeAssistantActionProvider implements ActionProvider {
  constructor(private hass: HomeAssistant, private host: HTMLElement) {}

  setHass(hass: HomeAssistant): void {
    this.hass = hass;
  }

  async toggle(entityId: string): Promise<void> {
    const domain = entityId.split('.')[0];
    if (!domain || !['light', 'switch'].includes(domain)) {
      throw new Error(`Toggle is only supported for light and switch entities: ${entityId}`);
    }
    await this.hass.callService(domain, 'toggle', { entity_id: entityId });
  }

  moreInfo(entityId: string): void {
    this.host.dispatchEvent(new CustomEvent('hass-more-info', {
      bubbles: true,
      composed: true,
      detail: { entityId },
    }));
  }
}
