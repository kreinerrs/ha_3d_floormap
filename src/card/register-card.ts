import { ThreeFloorplanCard } from './three-floorplan-card';

declare global {
  interface Window {
    customCards?: Array<{ type: string; name: string; description: string; preview?: boolean }>;
  }
}

if (!customElements.get('three-floorplan-card')) {
  customElements.define('three-floorplan-card', ThreeFloorplanCard);
}

window.customCards = window.customCards ?? [];
if (!window.customCards.some(card => card.type === 'three-floorplan-card')) {
  window.customCards.push({
    type: 'three-floorplan-card',
    name: 'Three Floorplan Card',
    description: 'Interactive 3D floorplan powered by Home Assistant entities.',
    preview: false,
  });
}
