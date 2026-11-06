import * as THREE from 'three';
import {
  deriveObjectState, deriveRemaining, displayLook, formatRemaining, resolveDisplay,
  type DisplayDefaults, type ObjectDisplay, type ObjectIndicator, type ObjectState, type ResolvedObject, type FloorplanObject,
} from '../core/objects';
import type { StateProvider } from '../core/types';
import { buildPrimitive } from './object-primitives';

const BODY_COLORS = { appliance: 0xd8dde2, furniture: 0xb08d6a } as const;
const ACTIVE_COLOR = new THREE.Color(0x2e9bff);
const DONE_COLOR = new THREE.Color(0x35c46a);
const UNAVAILABLE_COLOR = new THREE.Color(0x777777);

interface ObjectVisual {
  source: FloorplanObject;
  resolved: ResolvedObject;
  group: THREE.Group;
  body: THREE.Object3D;
  material: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  spinner?: THREE.Object3D;
  baseColor: THREE.Color;
  indicator: ObjectIndicator;
  statusEntity?: string;
  label?: { sprite: THREE.Sprite; canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; texture: THREE.CanvasTexture; last: string };
  ring?: THREE.Mesh;
  state: ObjectState;
  display: ObjectDisplay;
}

/**
 * Draws floorplan objects as boxes and keeps their look in step with Home Assistant states.
 * The renderer owns placement in the scene; this class owns materials, indicators and display modes.
 */
export class ObjectsLayer {
  private readonly visuals = new Map<string, ObjectVisual>();
  private defaults: DisplayDefaults = {};
  private runtime = new Map<string, ObjectDisplay>();
  private lastRefresh = 0;
  private states?: Pick<StateProvider, 'getEntity'>;

  setDefaults(defaults: DisplayDefaults): void {
    this.defaults = defaults;
    this.visuals.forEach(visual => { visual.display = this.displayOf(visual); });
    if (this.states) this.refresh(this.states, Date.now());
  }

  /** Temporary override for one category ('appliance' / 'furniture') or undefined to clear it. */
  setCategoryOverride(category: 'appliance' | 'furniture', display?: ObjectDisplay): void {
    if (display) this.runtime.set(category, display);
    else this.runtime.delete(category);
    this.visuals.forEach(visual => { visual.display = this.displayOf(visual); });
    if (this.states) this.refresh(this.states, Date.now());
  }

  private displayOf(visual: ObjectVisual): ObjectDisplay {
    return resolveDisplay(visual.resolved, this.defaults, this.runtime.get(visual.resolved.category));
  }

  /**
   * Creates the group for one object, centred on its footprint with the front facing the given direction.
   * @param source The object as written in the file.
   * @param resolved The object with sizes and defaults applied.
   * @param statusEntity The Home Assistant entity that tells its status, if any.
   * @param origin World position of the footprint centre at floor level (y = top of the floor).
   * @returns The group to add to the scene.
   */
  create(source: FloorplanObject, resolved: ResolvedObject, statusEntity: string | undefined, origin: THREE.Vector3): THREE.Group {
    const group = new THREE.Group();
    group.position.copy(origin);
    group.rotation.y = -THREE.MathUtils.degToRad(source.facingDegrees ?? 0);
    const baseColor = new THREE.Color(resolved.visual.color ?? BODY_COLORS[resolved.category]);
    const material = new THREE.MeshStandardMaterial({ color: baseColor.clone(), roughness: 0.7 });
    const accent = new THREE.MeshStandardMaterial({ color: baseColor.clone().multiplyScalar(0.55), roughness: 0.8 });
    const kind = resolved.visual.kind ?? 'primitive';
    const primitive = kind === 'box' ? undefined
      : buildPrimitive(resolved.type, { width: resolved.width, depth: resolved.depth, height: resolved.height }, material, accent);
    let body: THREE.Object3D;
    if (primitive) {
      body = primitive.group;
    } else {
      const box = new THREE.Group();
      const block = new THREE.Mesh(new THREE.BoxGeometry(resolved.width, resolved.height, resolved.depth), material);
      block.position.y = resolved.height / 2;
      block.castShadow = true;
      block.receiveShadow = true;
      // A darker strip on the front face shows which way the object faces.
      const strip = new THREE.Mesh(new THREE.BoxGeometry(resolved.width * 0.9, Math.min(0.05, resolved.height * 0.2), 0.01), accent);
      strip.position.set(0, resolved.height * 0.9, -resolved.depth / 2 - 0.004);
      box.add(block, strip);
      body = box;
    }
    body.position.y = resolved.elevation;
    group.add(body);
    if (statusEntity) group.userData.interactionTarget = `object:${source.id}`;
    const indicator = resolved.indicator ?? (source.status?.remaining ? 'bar' : 'tint');
    const visual: ObjectVisual = {
      source, resolved, group, body, material, accent, spinner: primitive?.spinner, baseColor, indicator, statusEntity, state: 'inactive', display: 'shown',
    };
    if (indicator === 'bar' || indicator === 'label') this.addLabel(visual);
    if (indicator === 'ring') {
      const radius = Math.max(resolved.width, resolved.depth) / 2 + 0.12;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius, radius + 0.06, 40),
        new THREE.MeshBasicMaterial({ color: ACTIVE_COLOR, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.012;
      ring.visible = false;
      group.add(ring);
      visual.ring = ring;
    }
    visual.display = this.displayOf(visual);
    this.visuals.set(source.id, visual);
    return group;
  }

  private addLabel(visual: ObjectVisual): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) return;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.scale.set(0.9, 0.225, 1);
    sprite.position.y = visual.resolved.elevation + visual.resolved.height + 0.2;
    sprite.visible = false;
    visual.group.add(sprite);
    visual.label = { sprite, canvas, context, texture, last: '' };
  }

  /** Home Assistant entity of an object, used for the more-info dialog. */
  entityOf(objectId: string): string | undefined {
    return this.visuals.get(objectId)?.statusEntity;
  }

  get count(): number {
    return this.visuals.size;
  }

  clear(): void {
    this.visuals.forEach(visual => {
      visual.group.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
          (object as THREE.Mesh).geometry?.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => { (material as THREE.SpriteMaterial).map?.dispose(); material.dispose(); });
        }
      });
      visual.accent.dispose();
      visual.group.removeFromParent();
    });
    this.visuals.clear();
  }

  /**
   * Re-reads every object's state and updates body, indicator and label.
   * @param states Entity state provider.
   * @param nowMs Current time in milliseconds.
   */
  refresh(states: Pick<StateProvider, 'getEntity'>, nowMs: number): void {
    this.states = states;
    this.lastRefresh = nowMs;
    for (const visual of this.visuals.values()) {
      const status = visual.source.status;
      const entity = visual.statusEntity ? states.getEntity(visual.statusEntity) : undefined;
      visual.state = visual.statusEntity ? deriveObjectState(entity, status?.activeWhen) : 'inactive';
      const look = displayLook(visual.display, visual.state);
      const remaining = visual.state === 'active' ? deriveRemaining(status?.remaining, states, nowMs) : {};
      this.applyLook(visual, look, remaining.progress);
      this.applyLabel(visual, remaining, entity?.state);
    }
  }

  /** Re-reads states about once a second so countdowns tick. */
  tick(nowMs: number): void {
    if (this.states && nowMs - this.lastRefresh >= 1000) this.refresh(this.states, nowMs);
    for (const visual of this.visuals.values()) {
      if (visual.spinner && visual.state === 'active') visual.spinner.rotation.y = nowMs / 1000 * 4;
      if (visual.indicator === 'pulse' && visual.state === 'active') {
        visual.material.emissiveIntensity = 0.35 + 0.35 * Math.sin(nowMs / 1000 * Math.PI * 2);
      }
    }
  }

  private applyLook(visual: ObjectVisual, look: { visible: boolean; opacity: number }, progress?: number): void {
    visual.group.visible = true;
    visual.body.visible = look.visible;
    const material = visual.material;
    for (const item of [material, visual.accent]) {
      item.transparent = look.opacity < 1;
      item.opacity = look.opacity;
      item.depthWrite = look.opacity >= 1;
    }
    visual.body.traverse(part => { if (part instanceof THREE.Mesh) part.castShadow = look.opacity >= 1; });
    material.color.copy(visual.state === 'unavailable' ? UNAVAILABLE_COLOR : visual.baseColor);
    visual.accent.color.copy(material.color).multiplyScalar(0.55);
    material.emissive.set(0x000000);
    material.emissiveIntensity = 1;
    if (visual.state === 'active' && (visual.indicator === 'tint' || visual.indicator === 'pulse')) {
      const colour = progress === undefined ? ACTIVE_COLOR : ACTIVE_COLOR.clone().lerp(DONE_COLOR, progress);
      material.emissive.copy(colour);
      material.emissiveIntensity = visual.indicator === 'pulse' ? 0.5 : 0.45;
    }
    if (visual.ring) {
      visual.ring.visible = visual.state === 'active';
      const colour = progress === undefined ? ACTIVE_COLOR : ACTIVE_COLOR.clone().lerp(DONE_COLOR, progress);
      (visual.ring.material as THREE.MeshBasicMaterial).color.copy(colour);
    }
  }

  private applyLabel(visual: ObjectVisual, remaining: { seconds?: number; progress?: number }, state?: string): void {
    const label = visual.label;
    if (!label) return;
    const show = visual.state === 'active';
    label.sprite.visible = show;
    if (!show) return;
    const text = remaining.seconds !== undefined ? formatRemaining(remaining.seconds)
      : remaining.progress !== undefined ? `${Math.round(remaining.progress * 100)} %`
        : state ?? '';
    const progress = visual.indicator === 'bar' ? remaining.progress ?? -1 : -2;
    const key = `${text}|${progress.toFixed(3)}`;
    if (key === label.last) return;
    label.last = key;
    const { context, canvas, texture } = label;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(15, 23, 32, 0.78)';
    context.beginPath();
    context.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 14);
    context.fill();
    if (progress >= 0) {
      context.fillStyle = 'rgba(255, 255, 255, 0.18)';
      context.fillRect(14, 44, canvas.width - 28, 10);
      context.fillStyle = `#${ACTIVE_COLOR.clone().lerp(DONE_COLOR, progress).getHexString()}`;
      context.fillRect(14, 44, (canvas.width - 28) * progress, 10);
    }
    context.fillStyle = '#ffffff';
    context.font = '600 26px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, progress >= 0 || progress === -1 ? 24 : 32);
    texture.needsUpdate = true;
  }
}
