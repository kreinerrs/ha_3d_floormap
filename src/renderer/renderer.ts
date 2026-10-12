import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Binding, Config, Floorplan, Opening } from '../core/types';
import type { EffectSpec } from '../core/effects';
import { junctionPoints, resolveOpenings, splitLine, wallLines } from '../core/geometry';

type InteractionHandler = (target: string, held: boolean) => void;

export class Renderer {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(47, 1, 0.1, 150);
  gl = new THREE.WebGLRenderer({ antialias: true });
  controls: OrbitControls;
  root = new THREE.Group();
  offset = { x: 0, z: 0 };
  centres = new Map<string, THREE.Vector3>();
  roomMeshes = new Map<string, THREE.Mesh>();
  lights = new Map<string, { lamp: THREE.PointLight; bulb: THREE.Mesh }>();
  doors = new Map<string, { pivot: THREE.Group; leaf: THREE.Mesh; closed: number; open: number }>();
  effects = new Map<string, { spec: EffectSpec; start: number }>();

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly resizeObserver?: ResizeObserver;
  private readonly resizeListener = () => this.resize();
  private interactionHandler?: InteractionHandler;
  private pointerStart?: { x: number; y: number; target: string; held: boolean };
  private holdTimer?: number;
  private frame = 0;
  private disposed = false;

  constructor(private host: HTMLElement, private cfg: Config) {
    this.scene.background = new THREE.Color(0x101821);
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.visuals.maxPixelRatio));
    this.gl.domElement.style.display = 'block';
    this.gl.domElement.style.width = '100%';
    this.gl.domElement.style.height = '100%';
    this.gl.shadowMap.enabled = cfg.visuals.shadows;
    host.append(this.gl.domElement);
    this.controls = new OrbitControls(this.camera, this.gl.domElement);
    Object.assign(this.controls, {
      enableRotate: cfg.camera.allowRotation,
      enableZoom: cfg.camera.allowZoom,
      enablePan: cfg.camera.allowPan,
    });
    this.scene.add(this.root, new THREE.HemisphereLight(0xbfdcff, 0x202820, cfg.visuals.ambientIntensity));
    const sunlight = new THREE.DirectionalLight(0xfff0d0, cfg.visuals.sunlightIntensity);
    sunlight.position.set(-12, 18, 9);
    sunlight.castShadow = cfg.visuals.shadows;
    this.scene.add(sunlight);

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.resize());
      observer.observe(host);
      this.resizeObserver = observer;
    } else {
      window.addEventListener('resize', this.resizeListener);
    }
    this.gl.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.gl.domElement.addEventListener('pointermove', this.onPointerMove);
    this.gl.domElement.addEventListener('pointerup', this.onPointerUp);
    this.gl.domElement.addEventListener('pointercancel', this.onPointerCancel);
    this.resize();
    this.loop();
  }

  setInteractionHandler(handler: InteractionHandler): void {
    this.interactionHandler = handler;
  }

  private box(width: number, height: number, depth: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  build(floorplan: Floorplan, bindings: Binding[]): void {
    const visuals = { ...this.cfg.visuals, ...floorplan.buildingDefaults };
    const rooms = floorplan.rooms.filter(room => room.id !== 'outside');
    const minX = Math.min(...rooms.map(room => room.layout.x));
    const maxX = Math.max(...rooms.map(room => room.layout.x + room.layout.width));
    const minY = Math.min(...rooms.map(room => room.layout.y));
    const maxY = Math.max(...rooms.map(room => room.layout.y + room.layout.height));
    this.offset = { x: (minX + maxX) / 2, z: (minY + maxY) / 2 };
    const colors = [0x8e7a53, 0x527f88, 0x746a99, 0x806b5f, 0x496641];
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xb7b6ae, roughness: 0.82 });

    floorplan.rooms.forEach((room, index) => {
      const x = room.layout.x + room.layout.width / 2 - this.offset.x;
      const z = room.layout.y + room.layout.height / 2 - this.offset.z;
      this.centres.set(room.id, new THREE.Vector3(x, 0, z));
      const floor = this.box(
        room.layout.width,
        visuals.floorThickness,
        room.layout.height,
        new THREE.MeshStandardMaterial({ color: colors[index % colors.length], roughness: 0.8, emissive: 0 }),
        x,
        visuals.floorThickness / 2,
        z,
      );
      this.root.add(floor);
      this.roomMeshes.set(room.id, floor);
    });

    const openings = resolveOpenings(floorplan, visuals);
    const lines = wallLines(floorplan);
    for (const line of lines) {
      const { segments, cuts } = splitLine(line, openings);
      for (const segment of segments) {
        const length = segment.b - segment.a;
        const middle = (segment.a + segment.b) / 2;
        this.root.add(line.axis === 'x'
          ? this.box(length, visuals.wallHeight, visuals.wallThickness, wallMaterial, middle - this.offset.x, visuals.wallHeight / 2, line.fixed - this.offset.z)
          : this.box(visuals.wallThickness, visuals.wallHeight, length, wallMaterial, line.fixed - this.offset.x, visuals.wallHeight / 2, middle - this.offset.z));
      }
      cuts.forEach(cut => this.opening(cut.o, visuals, wallMaterial));
    }
    junctionPoints(lines).forEach(point => {
      this.root.add(this.box(
        visuals.wallThickness,
        visuals.wallHeight,
        visuals.wallThickness,
        wallMaterial,
        point.x - this.offset.x,
        visuals.wallHeight / 2,
        point.z - this.offset.z,
      ));
    });

    for (const binding of bindings.filter(item => item.kind === 'light')) {
      const centre = this.centres.get(binding.targetId);
      if (!centre) continue;
      const offset = binding.placement?.offset ?? [0, 0, 0];
      const height = binding.placement?.height ?? visuals.wallHeight - 0.12;
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.11),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0 }),
      );
      bulb.position.set(centre.x + offset[0], height + offset[1], centre.z + offset[2]);
      bulb.userData.interactionTarget = binding.ref;
      const lamp = new THREE.PointLight(0xffd49a, 0, 6, 1.5);
      lamp.position.copy(bulb.position);
      this.root.add(bulb, lamp);
      this.lights.set(binding.ref, { lamp, bulb });
    }

    this.camera.position.set(15, 17, 17);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  private opening(opening: Opening, visuals: Config['visuals'], wallMaterial: THREE.Material): void {
    const x = (opening.axis === 'x' ? opening.centre : opening.fixed) - this.offset.x;
    const z = (opening.axis === 'x' ? opening.fixed : opening.centre) - this.offset.z;
    const thickness = visuals.wallThickness;
    if (opening.type === 'open-passage') return;
    if (opening.type === 'door') {
      const top = Math.max(0, visuals.wallHeight - visuals.doorHeight);
      if (top) {
        this.root.add(opening.axis === 'x'
          ? this.box(opening.width, top, thickness, wallMaterial, x, visuals.doorHeight + top / 2, z)
          : this.box(thickness, top, opening.width, wallMaterial, x, visuals.doorHeight + top / 2, z));
      }
      const jambMaterial = new THREE.MeshStandardMaterial({ color: 0xc7c3b8 });
      const jambWidth = Math.min(0.06, thickness * 0.4);
      if (opening.axis === 'x') {
        this.root.add(
          this.box(jambWidth, visuals.doorHeight, thickness + 0.012, jambMaterial, x - opening.width / 2, visuals.doorHeight / 2, z),
          this.box(jambWidth, visuals.doorHeight, thickness + 0.012, jambMaterial, x + opening.width / 2, visuals.doorHeight / 2, z),
        );
      } else {
        this.root.add(
          this.box(thickness + 0.012, visuals.doorHeight, jambWidth, jambMaterial, x, visuals.doorHeight / 2, z - opening.width / 2),
          this.box(thickness + 0.012, visuals.doorHeight, jambWidth, jambMaterial, x, visuals.doorHeight / 2, z + opening.width / 2),
        );
      }
      const hinge = opening.connector.door?.hinge ?? 'left';
      const sign = hinge === 'left' ? 1 : -1;
      const closed = opening.axis === 'x' ? 0 : Math.PI / 2;
      const pivot = new THREE.Group();
      pivot.position.set(
        x + (opening.axis === 'x' ? -sign * opening.width / 2 : 0),
        0,
        z + (opening.axis === 'z' ? -sign * opening.width / 2 : 0),
      );
      pivot.userData.interactionTarget = opening.id;
      const leaf = this.box(
        opening.width - 0.012,
        visuals.doorHeight,
        0.055,
        new THREE.MeshStandardMaterial({ color: 0x815535 }),
        sign * (opening.width - 0.012) / 2,
        visuals.doorHeight / 2,
        0,
      );
      pivot.add(leaf);
      pivot.rotation.y = closed;
      this.root.add(pivot);
      this.doors.set(opening.id, {
        pivot,
        leaf,
        closed,
        open: closed - sign * (opening.connector.door?.openAngle ?? 82) * Math.PI / 180,
      });
      return;
    }

    const window = opening.connector.window;
    const sill = window?.sillHeight ?? visuals.windowSillHeight;
    const head = window?.headHeight ?? visuals.windowHeadHeight;
    const above = Math.max(0, visuals.wallHeight - head);
    if (sill) {
      this.root.add(opening.axis === 'x'
        ? this.box(opening.width, sill, thickness, wallMaterial, x, sill / 2, z)
        : this.box(thickness, sill, opening.width, wallMaterial, x, sill / 2, z));
    }
    if (above) {
      this.root.add(opening.axis === 'x'
        ? this.box(opening.width, above, thickness, wallMaterial, x, head + above / 2, z)
        : this.box(thickness, above, opening.width, wallMaterial, x, head + above / 2, z));
    }
    const glass = new THREE.MeshStandardMaterial({ color: 0x78c7ef, transparent: true, opacity: 0.42 });
    this.root.add(opening.axis === 'x'
      ? this.box(opening.width, head - sill, visuals.frameDepth, glass, x, (sill + head) / 2, z)
      : this.box(visuals.frameDepth, head - sill, opening.width, glass, x, (sill + head) / 2, z));
  }

  updateLight(id: string, state: { available: boolean; on: boolean; brightness: number; color: string }): void {
    const object = this.lights.get(id);
    if (!object) return;
    object.lamp.visible = state.available;
    object.lamp.intensity = state.on ? 3 + 16 * Math.pow(state.brightness, 1.6) : 0;
    object.lamp.color.set(state.color);
    const material = object.bulb.material as THREE.MeshStandardMaterial;
    material.color.set(state.available ? (state.on ? state.color : '#999') : '#666');
    material.emissive.set(state.available && state.on ? state.color : '#000');
  }

  updateDoor(id: string, state: { open: boolean; available?: boolean }): void {
    for (const [key, door] of this.doors) {
      if (key === id || key.includes(id)) {
        door.pivot.rotation.y = state.open ? door.open : door.closed;
        (door.leaf.material as THREE.MeshStandardMaterial).color.set(state.available === false ? '#777' : '#815535');
      }
    }
  }

  setEffect(id: string, spec: EffectSpec, enabled: boolean): void {
    if (enabled) this.effects.set(id, { spec, start: performance.now() });
    else this.effects.delete(id);
  }

  private applyEffects(): void {
    for (const mesh of this.roomMeshes.values()) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.emissive.setHex(0);
      material.emissiveIntensity = 0;
    }
    const selected = new Map<string, { spec: EffectSpec; start: number }>();
    for (const effect of this.effects.values()) {
      const previous = selected.get(effect.spec.target);
      if (!previous || (effect.spec.priority ?? 0) > (previous.spec.priority ?? 0)) {
        selected.set(effect.spec.target, effect);
      }
    }
    for (const [id, effect] of selected) {
      if (effect.spec.effect === 'camera-focus') {
        const centre = this.centres.get(id);
        if (centre) this.controls.target.lerp(centre, 0.08);
        continue;
      }
      const mesh = this.roomMeshes.get(id);
      if (!mesh) continue;
      const material = mesh.material as THREE.MeshStandardMaterial;
      const elapsed = (performance.now() - effect.start) / (effect.spec.intervalMs ?? 500);
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const intensity = reducedMotion
        ? 1
        : effect.spec.effect === 'flash'
          ? Math.floor(elapsed) % 2 ? 0 : 1
          : 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(elapsed * Math.PI * 2));
      material.emissive.set(effect.spec.color ?? '#ff2020');
      material.emissiveIntensity = 1.8 * intensity;
    }
  }

  private targetAt(event: PointerEvent): string | undefined {
    const bounds = this.gl.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const intersection of this.raycaster.intersectObjects(this.root.children, true)) {
      let object: THREE.Object3D | null = intersection.object;
      while (object && object !== this.root) {
        const target = object.userData.interactionTarget;
        if (typeof target === 'string') return target;
        object = object.parent;
      }
    }
    return undefined;
  }

  private onPointerDown = (event: PointerEvent): void => {
    const target = this.targetAt(event);
    if (!target) return;
    this.pointerStart = { x: event.clientX, y: event.clientY, target, held: false };
    this.holdTimer = window.setTimeout(() => {
      if (!this.pointerStart) return;
      this.pointerStart.held = true;
      this.interactionHandler?.(this.pointerStart.target, true);
    }, 500);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.pointerStart) return;
    if (Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 8) {
      this.clearPointer();
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    const start = this.pointerStart;
    if (!start) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8;
    if (!start.held && !moved && this.targetAt(event) === start.target) {
      this.interactionHandler?.(start.target, false);
    }
    this.clearPointer();
  };

  private onPointerCancel = (): void => this.clearPointer();

  private clearPointer(): void {
    if (this.holdTimer !== undefined) window.clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
    this.pointerStart = undefined;
  }

  resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.gl.setSize(width, height);
  }

  dispose(): void {
    this.disposed = true;
    window.cancelAnimationFrame(this.frame);
    this.clearPointer();
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.resizeListener);
    this.gl.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.gl.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.gl.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.gl.domElement.removeEventListener('pointercancel', this.onPointerCancel);
    this.controls.dispose();
    this.root.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material.dispose());
      }
    });
    this.gl.dispose();
    this.gl.domElement.remove();
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.frame = window.requestAnimationFrame(this.loop);
    this.applyEffects();
    this.controls.update();
    this.gl.render(this.scene, this.camera);
  };
}
