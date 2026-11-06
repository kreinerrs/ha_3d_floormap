import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Binding, CameraView, CelestialConfig, Config, EntityState, StateProvider, EntityPlacement, EnvironmentMeasure, Floorplan, FloorplanArea, Opening, RoomStatusRule } from '../core/types';
import type { EffectSpec } from '../core/effects';
import { outlinePolygon, roomPolygon } from '../core/outline';
import { elevationOf, junctionTop, openingLevels, roomTop, wallTop } from '../core/elevation';
import { classifyWallSegment, floorplanBounds, junctionPoints, resolveOpenings, splitLine, wallLines, wallSegmentOpaqueFromCameraSide } from '../core/geometry';
import { resolveObject, statusEntityOf, type DisplayDefaults } from '../core/objects';
import { ObjectsLayer } from './objects-layer';
import { lockColor, type LockStatus } from '../core/lock';
import { animateDoorAngle, doorPose } from '../core/door-motion';
import { environmentMeasureValue, environmentValue } from '../core/environment';
import { sensorVisibilityPolygon } from '../core/presence';
import { compassTickRotation, sunDirection, type SunPosition } from '../core/sun';

type InteractionHandler = (target: string, held: boolean) => void;
type RoomSelectionHandler = (roomId: string) => void;
export type CameraCoordinates = { position: [number, number, number]; target: [number, number, number] };
type PointerTarget = { id: string; room: boolean };
type OpeningMotion = {
  pivot: THREE.Group;
  panels: THREE.Object3D[];
  mode: 'rotate' | 'slide' | 'scale-slide';
  axis: 'x' | 'y' | 'z';
  closed: number;
  open: number;
  current: number;
  from: number;
  target: number;
  startedAt: number;
  closedPositions: THREE.Vector3[];
  openPositions: THREE.Vector3[];
  closedScales?: THREE.Vector3[];
  openScales?: THREE.Vector3[];
  rotations?: Array<{ pivot: THREE.Group; closed: number; open: number }>;
  doorLeaf?: THREE.Mesh;
};
const tiltSuffix = '::tilt';
type EnvironmentVisual = {
  sprite: THREE.Sprite;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  display: NonNullable<Binding['display']>;
  label: string;
  precision?: number;
  measures?: EnvironmentMeasure[];
};
type WaterLeakVisual = { parts: THREE.Mesh[] };
type CutawayWall = {
  mesh: THREE.Mesh;
  material: THREE.Material;
  edgeMaterial?: LineMaterial;
  edgeOpacity?: number;
  edgeTransparent?: boolean;
  axis?: 'x' | 'z';
  fixed: number;
  beforeOccupied: boolean;
  afterOccupied: boolean;
  applied?: string;
  base?: { y: number; scaleY: number; minY: number; maxY: number };
};

export class Renderer {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(47, 1, 0.1, 150);
  gl = new THREE.WebGLRenderer({ antialias: true });
  controls: OrbitControls;
  root = new THREE.Group();
  siteAreasGroup = new THREE.Group();
  siteAreasVisible = false;
  treesGroup = new THREE.Group();
  treesVisible = false;
  cutawayEnabled = false;
  cutawayMode: 'off' | 'fade' | 'hide' = 'off';
  /** Debug option: height in metres of faded walls; undefined keeps their full height. */
  fadedWallHeight?: number;
  offset = { x: 0, z: 0 };
  centres = new Map<string, THREE.Vector3>();
  roomMeshes = new Map<string, THREE.Mesh>();
  private readonly roomStatusMeshes = new Map<string, THREE.Mesh>();
  lights = new Map<string, { lamp: THREE.PointLight; bulb: THREE.Mesh }>();
  sensors = new Map<string, { coverage: THREE.Mesh; marker: THREE.Mesh }>();
  environmentSensors = new Map<string, EnvironmentVisual>();
  waterLeakSensors = new Map<string, WaterLeakVisual>();
  openingMotions = new Map<string, OpeningMotion>();
  effects = new Map<string, { spec: EffectSpec; start: number }>();

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly resizeObserver?: ResizeObserver;
  private readonly resizeListener = () => this.resize();
  private interactionHandler?: InteractionHandler;
  private readonly objectsLayer = new ObjectsLayer();
  private roomSelectionHandler?: RoomSelectionHandler;
  private cameraCoordinatesHandler?: (coordinates: CameraCoordinates) => void;
  private pointerStart?: { x: number; y: number; target: PointerTarget; held: boolean };
  private holdTimer?: number;
  private frame = 0;
  private disposed = false;
  private readonly entityGroups = new Map<Binding['kind'], Set<THREE.Object3D>>();
  private readonly roomColors = new Map<string, THREE.Color>();
  private readonly cutawayWalls: CutawayWall[] = [];
  private readonly styleEdgeMaterials = new Set<LineMaterial>();
  private lastCutawayUpdate = 0;
  private currentRooms = new Map<string, Floorplan['rooms'][number]>();
  private cameraViews = new Map<string, CameraView>();
  private focusRoomId?: string;
  private focusCameraViewId?: string;
  private cameraTransition?: {
    startedAt: number;
    duration: number;
    fromPosition: THREE.Vector3;
    toPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
  };
  private roomOverviewPosition = new THREE.Vector3(15, 17, 17);
  private roomOverviewTarget = new THREE.Vector3(0, 0, 0);
  private siteOverviewPosition = new THREE.Vector3(15, 17, 17);
  private siteOverviewTarget = new THREE.Vector3(0, 0, 0);
  private roomBounds?: ReturnType<typeof floorplanBounds>;
  private siteBounds?: ReturnType<typeof floorplanBounds>;
  private readonly celestialMarkers = new Map<'sun' | 'moon', { marker: THREE.Mesh; origin: THREE.Vector3; radius: number }>();
  private readonly coverBindings = new Set<string>();
  private readonly lockTargets = new Set<string>();
  private readonly lockVisuals = new Map<string, Array<{ material: THREE.MeshBasicMaterial; shackles: THREE.Object3D[] }>>();
  private readonly sunlight: THREE.DirectionalLight;
  private readonly defaultSunlightPosition = new THREE.Vector3(-12, 18, 9);
  private sunNorthDegrees = 0;
  private floorSurfaceHeight = 0;
  private readonly floorGroups = new Map<string, THREE.Group>();
  private currentFloor?: string;
  private addTarget?: THREE.Object3D;
  private openingWall?: { axis: 'x' | 'z'; fixed: number; beforeOccupied: boolean; afterOccupied: boolean };
  private levels = new Map<string, number>();
  private floorOfRoom = new Map<string, string>();
  private floorOfConnector = new Map<string, string>();

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
    this.controls.addEventListener('start', () => { this.cameraTransition = undefined; });
    this.scene.add(this.root, new THREE.HemisphereLight(0xbfdcff, 0x202820, cfg.visuals.ambientIntensity));
    const sunlight = new THREE.DirectionalLight(0xfff0d0, cfg.visuals.sunlightIntensity);
    sunlight.position.copy(this.defaultSunlightPosition);
    sunlight.castShadow = cfg.visuals.shadows;
    // Bias avoids shadow acne (dark streaks) on large flat surfaces such as ground and areas.
    sunlight.shadow.mapSize.set(2048, 2048);
    sunlight.shadow.bias = -0.0005;
    sunlight.shadow.normalBias = 0.04;
    this.scene.add(sunlight);
    this.sunlight = sunlight;

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

  /** Home Assistant entity behind an object (for its more-info dialog). */
  objectEntity(objectId: string): string | undefined {
    return this.objectsLayer.entityOf(objectId);
  }

  get objectCount(): number {
    return this.objectsLayer.count;
  }

  /** Runtime override per category; undefined returns to the configured display. */
  setObjectCategoryDisplay(category: 'appliance' | 'furniture', display?: 'hidden'): void {
    this.objectsLayer.setCategoryOverride(category, display);
  }

  setObjectDisplayDefaults(defaults: DisplayDefaults): void {
    this.objectsLayer.setDefaults(defaults);
  }

  updateObjects(states: Pick<StateProvider, 'getEntity'>): void {
    this.objectsLayer.refresh(states, Date.now());
  }

  private buildObjects(floorplan: Floorplan): void {
    this.objectsLayer.clear();
    for (const source of floorplan.objects ?? []) {
      const room = source.roomId ? this.currentRooms.get(source.roomId) : undefined;
      const area = source.areaId ? floorplan.areas?.find(item => item.id === source.areaId) : undefined;
      const host = room ?? area;
      if (!host || !Array.isArray(source.position)) continue;
      const resolved = resolveObject(source, floorplan.objectTypes);
      const origin = new THREE.Vector3(
        host.layout.x + source.position[0] - this.offset.x,
        (room ? elevationOf(room) : elevationOf(area!)) + this.floorSurfaceHeight,
        host.layout.y + source.position[1] - this.offset.z,
      );
      this.currentFloor = room ? this.floorOfRoom.get(room.id) : undefined;
      this.addToFloor(this.objectsLayer.create(source, resolved, statusEntityOf(source, floorplan.entityPlacements), origin));
    }
    this.currentFloor = undefined;
  }

  setInteractionHandler(handler: InteractionHandler): void {
    this.interactionHandler = handler;
  }

  setRoomSelectionHandler(handler: RoomSelectionHandler): void {
    this.roomSelectionHandler = handler;
  }

  setCameraCoordinatesHandler(handler?: (coordinates: CameraCoordinates) => void): void {
    this.cameraCoordinatesHandler = handler;
  }

  focusRoom(roomId: string): void {
    const centre = this.centres.get(roomId);
    const room = this.currentRooms.get(roomId);
    if (!centre || !room) return;
    this.controls.enabled = false;
    this.focusRoomId = roomId;
    this.focusCameraViewId = undefined;
    const bounds = this.host.getBoundingClientRect();
    const aspect = Math.max(0.1, bounds.width / Math.max(1, bounds.height));
    const roomSize = Math.max(room.layout.height, room.layout.width / aspect);
    const distance = Math.max(5, roomSize / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.35);
    this.transitionCamera(
      new THREE.Vector3(centre.x, distance, centre.z + distance * 0.08),
      new THREE.Vector3(centre.x, this.floorSurfaceHeight / 2, centre.z),
    );
    this.roomMeshes.forEach((mesh, id) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.color.set(id === roomId ? 0xffffff : 0x3a4650);
      material.emissive.set(id === roomId ? 0x080808 : 0);
    });
  }

  focusCameraView(viewId: string): void {
    const view = this.cameraViews.get(viewId);
    if (!view) return;
    this.focusRoomId = undefined;
    this.focusCameraViewId = viewId;
    this.controls.enabled = false;
    this.roomMeshes.forEach((mesh, id) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.color.copy(this.roomColors.get(id) ?? new THREE.Color(0xffffff));
      material.emissive.set(0);
    });
    this.transitionCamera(
      new THREE.Vector3(view.position[0] - this.offset.x, view.position[1], view.position[2] - this.offset.z),
      new THREE.Vector3(view.target[0] - this.offset.x, view.target[1], view.target[2] - this.offset.z),
    );
  }

  showOverview(): void {
    this.focusRoomId = undefined;
    this.focusCameraViewId = undefined;
    this.controls.enabled = false;
    this.roomMeshes.forEach((mesh, id) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.color.copy(this.roomColors.get(id) ?? new THREE.Color(0xffffff));
      material.emissive.set(0);
    });
    this.updateOverviewCameras();
    const [position, target] = this.activeOverview();
    this.transitionCamera(position, target);
  }

  setSiteAreasVisible(visible: boolean): void {
    if (visible === this.siteAreasVisible || !this.siteAreasGroup.children.length) return;
    this.siteAreasVisible = visible;
    this.siteAreasGroup.visible = visible;
    this.updateOverviewCameras();
    if (!this.focusRoomId && !this.focusCameraViewId) {
      this.controls.enabled = false;
      const [position, target] = this.activeOverview();
      this.transitionCamera(position, target);
    }
  }

  setTreesVisible(visible: boolean): void {
    this.treesVisible = visible;
    this.treesGroup.visible = visible;
  }

  get treeCount(): number {
    return this.treesGroup.children.length;
  }

  /** Camera-facing walls: 'fade' makes them see-through, 'hide' removes them (doors and windows stay). */
  setCutawayMode(mode: 'off' | 'fade' | 'hide'): void {
    this.cutawayMode = mode;
    this.cutawayEnabled = mode !== 'off';
    this.lastCutawayUpdate = 0;
    this.updateCutawayWalls(true);
  }

  setFadedWallHeight(height?: number): void {
    this.fadedWallHeight = height;
    this.lastCutawayUpdate = 0;
    this.updateCutawayWalls(true);
  }

  setCutawayEnabled(enabled: boolean): void {
    this.setCutawayMode(enabled ? 'fade' : 'off');
  }

  private activeOverview(): [THREE.Vector3, THREE.Vector3] {
    return this.siteAreasVisible
      ? [this.siteOverviewPosition, this.siteOverviewTarget]
      : [this.roomOverviewPosition, this.roomOverviewTarget];
  }

  setEntityTypeVisible(kind: Binding['kind'], visible: boolean): void {
    this.entityGroups.get(kind)?.forEach(group => { group.visible = visible; });
  }

  updateRoomStatus(roomId: string, color?: string): void {
    const overlay = this.roomStatusMeshes.get(roomId);
    if (!overlay) return;
    overlay.visible = color !== undefined;
    if (color !== undefined) {
      (overlay.material as THREE.MeshBasicMaterial).color.set(color);
    }
  }

  private addToFloor(...objects: THREE.Object3D[]): void {
    (this.addTarget ?? (this.currentFloor ? this.floorGroups.get(this.currentFloor) ?? this.root : this.root)).add(...objects);
  }

  /** Floor ids in file order with their rendered elevation (m) and ceiling height (m). */
  floorLevels(): { id: string; name: string; elevation: number; height: number }[] {
    return [...this.floorInfo];
  }

  private floorInfo: { id: string; name: string; elevation: number; height: number }[] = [];

  setFloorVisible(floorId: string, visible: boolean): void {
    const group = this.floorGroups.get(floorId);
    if (group) group.visible = visible;
  }

  private floorGapExpanded = false;
  private static readonly floorGap = 2;

  /** Spreads the floors apart vertically (or returns them to their normal spacing). */
  setFloorGapExpanded(expanded: boolean): void {
    this.floorGapExpanded = expanded;
    this.floorInfo.forEach((info, index) => {
      const group = this.floorGroups.get(info.id);
      if (group) group.position.y = info.elevation + (expanded ? index * Renderer.floorGap : 0);
    });
  }

  floorGapIsExpanded(): boolean {
    return this.floorGapExpanded;
  }

  floorVisible(floorId: string): boolean {
    return this.floorGroups.get(floorId)?.visible ?? false;
  }

  private placementFloor(placement: EntityPlacement | undefined): string | undefined {
    if (!placement) return undefined;
    if ('connectorId' in placement) return this.floorOfConnector.get(placement.connectorId);
    if ('roomId' in placement && placement.roomId) return this.floorOfRoom.get(placement.roomId);
    return undefined;
  }

  /** Elevation (m) of the room or area an entity stands in. */
  private levelOf(placement?: EntityPlacement, targetId?: string): number {
    const id = placement && 'roomId' in placement && placement.roomId ? placement.roomId
      : placement && 'areaId' in placement && placement.areaId ? placement.areaId
        : targetId;
    return (id ? this.levels.get(id) : undefined) ?? 0;
  }

  private registerEntityGroup(kind: Binding['kind'], group: THREE.Object3D): void {
    const groups = this.entityGroups.get(kind) ?? new Set<THREE.Object3D>();
    groups.add(group);
    this.entityGroups.set(kind, groups);
  }

  private transitionCamera(position: THREE.Vector3, target: THREE.Vector3): void {
    this.cameraTransition = {
      startedAt: performance.now(),
      duration: 700,
      fromPosition: this.camera.position.clone(),
      toPosition: position,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
    };
  }

  private animateCamera(now: number): void {
    const transition = this.cameraTransition;
    if (!transition) return;
    const raw = Math.min(1, (now - transition.startedAt) / transition.duration);
    const progress = raw * raw * (3 - 2 * raw);
    this.camera.position.lerpVectors(transition.fromPosition, transition.toPosition, progress);
    this.controls.target.lerpVectors(transition.fromTarget, transition.toTarget, progress);
    this.camera.lookAt(this.controls.target);
    if (raw >= 1) {
      this.cameraTransition = undefined;
      this.controls.enabled = true;
      this.controls.update();
    }
  }

  /** Plan polygon (absolute metres) to a shape in scene coordinates; shape y becomes scene z after rotating by +90 degrees about x. */
  private polygonShape(polygon: [number, number][]): THREE.Shape {
    const shape = new THREE.Shape();
    polygon.forEach(([px, py], index) => {
      if (index === 0) shape.moveTo(px - this.offset.x, py - this.offset.z);
      else shape.lineTo(px - this.offset.x, py - this.offset.z);
    });
    shape.closePath();
    return shape;
  }

  /** Solid prism of a plan shape with its top at `top` and the given depth. */
  private extrudedShape(shape: THREE.Shape, depth: number, top: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }), material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = top;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private box(width: number, height: number, depth: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private panelBox(
    axis: 'x' | 'z',
    width: number,
    height: number,
    depth: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh {
    return axis === 'x'
      ? this.box(width, height, depth, material, x, y, z)
      : this.box(depth, height, width, material, x, y, z);
  }

  /** Draws each straight stair as a flight of thin floating boards, nothing beneath them. */
  private buildStairs(floorplan: Floorplan, floorThickness: number): void {
    const material = new THREE.MeshStandardMaterial({ color: 0xc9b79c, roughness: 0.7 });
    const boardThickness = 0.04;
    for (const stair of floorplan.stairs ?? []) {
      const lower = this.floorInfo.find(info => info.id === stair.lower);
      const upper = this.floorInfo.find(info => info.id === stair.upper);
      if (!lower || !upper || !(stair.length > 0) || !(stair.width > 0)) continue;
      const rise = upper.elevation - lower.elevation;
      if (!(rise > 0)) continue;
      const steps = Number.isInteger(stair.steps) && stair.steps! >= 2 ? stair.steps! : Math.max(2, Math.ceil(rise / 0.18));
      const tread = stair.length / steps;
      const along = stair.direction === 'left' || stair.direction === 'up' ? -1 : 1;
      const alongX = stair.direction === 'left' || stair.direction === 'right';
      const centreX = stair.x + (alongX ? stair.length : stair.width) / 2 - this.offset.x;
      const centreZ = stair.y + (alongX ? stair.width : stair.length) / 2 - this.offset.z;
      this.currentFloor = lower.id;
      for (let index = 1; index <= steps; index++) {
        const shift = along * ((index - 0.5) * tread - stair.length / 2);
        const top = floorThickness + rise * index / steps;
        const board = this.box(
          alongX ? tread : stair.width,
          boardThickness,
          alongX ? stair.width : tread,
          material,
          centreX + (alongX ? shift : 0),
          top - boardThickness / 2,
          centreZ + (alongX ? 0 : shift),
        );
        this.addStyleEdges(board);
        this.addToFloor(board);
      }
    }
  }

  build(
    floorplan: Floorplan,
    bindings: Binding[],
    celestial?: CelestialConfig,
    roomStatus: RoomStatusRule[] = [],
    cameraViews: CameraView[] = [],
  ): void {
    if (floorplan.northDegrees !== undefined && !Number.isFinite(floorplan.northDegrees)) {
      throw new Error('Floorplan northDegrees must be a finite compass bearing');
    }
    this.sunNorthDegrees = floorplan.northDegrees ?? 0;
    const visuals = { ...this.cfg.visuals, ...floorplan.buildingDefaults };
    const floorVisuals = visuals;
    this.coverBindings.clear();
    this.lockTargets.clear();
    this.lockVisuals.clear();
    bindings.filter(binding => binding.kind === 'lock' && binding.targetId)
      .forEach(binding => this.lockTargets.add(binding.targetId!));
    bindings.filter(binding => binding.kind === 'cover' && binding.targetId)
      .forEach(binding => this.coverBindings.add(binding.targetId!));
    this.currentRooms = new Map(floorplan.rooms.map(room => [room.id, room]));
    this.cameraViews = new Map(cameraViews.map(view => [view.id, view]));
    this.floorSurfaceHeight = visuals.floorThickness;
    const roomStatusRoomIds = new Set(roomStatus.map(status => status.roomId));
    const roomBounds = floorplanBounds(floorplan, false);
    const siteBounds = floorplanBounds(floorplan, true);
    this.roomBounds = roomBounds;
    this.siteBounds = siteBounds;
    this.offset = { x: (roomBounds.minX + roomBounds.maxX) / 2, z: (roomBounds.minY + roomBounds.maxY) / 2 };
    this.buildGround(floorplan, siteBounds);
    this.siteAreasVisible = (floorplan.areas?.length ?? 0) > 0;
    this.siteAreasGroup.clear();
    this.siteAreasGroup.visible = this.siteAreasVisible;
    this.root.add(this.siteAreasGroup);
    this.treesGroup.clear();
    this.treesVisible = false;
    this.treesGroup.visible = false;
    this.root.add(this.treesGroup);
    const colors = this.cfg.style === 'comic'
      ? [0xf2c14e, 0x63c7b2, 0xf28482, 0x99a8ff, 0xb4d86b]
      : this.cfg.style === 'futuristic'
        ? [0x15344a, 0x182c48, 0x1b3550, 0x203149, 0x153d4a]
        : [0x8e7a53, 0x527f88, 0x746a99, 0x806b5f, 0x496641];
    const wallMaterial = this.cfg.style === 'comic'
      ? new THREE.MeshStandardMaterial({ color: 0xf5e6c8, roughness: 0.9, flatShading: true })
      : this.cfg.style === 'futuristic'
        ? new THREE.MeshStandardMaterial({
          color: 0x18283b,
          emissive: 0x073046,
          emissiveIntensity: 0.42,
          roughness: 0.48,
          metalness: 0.25,
          flatShading: true,
        })
        : new THREE.MeshStandardMaterial({ color: 0xb7b6ae, roughness: 0.82 });
    this.cutawayWalls.length = 0;
    this.levels = new Map([
      ...floorplan.rooms.map(room => [room.id, elevationOf(room)] as const),
      ...(floorplan.areas ?? []).map(area => [area.id, elevationOf(area)] as const),
    ]);

    this.floorGroups.forEach(group => group.removeFromParent());
    this.floorGroups.clear();
    this.floorOfRoom.clear();
    this.floorOfConnector.clear();
    const floorList = floorplan.floors ?? [];
    let previousTop = 0;
    this.floorInfo = floorList.map((floor, index) => {
      const height = Number.isFinite(floor.height) ? floor.height! : visuals.wallHeight;
      // The highest wall or raised room of the floor below decides the lowest allowed base of this floor.
      const minimum = index === 0 ? 0 : previousTop + visuals.floorThickness;
      const elevation = Math.max(Number.isFinite(floor.elevation) ? floor.elevation! : 0, minimum);
      const own = floorplan.rooms.filter(room => (room.floor && floorList.some(item => item.id === room.floor) ? room.floor : floorList[0]?.id) === floor.id);
      const top = Math.max(height, ...own.map(room => roomTop(room, floorList, visuals.wallHeight)));
      previousTop = elevation + top;
      return { id: floor.id, name: floor.name ?? `Floor ${index + 1}`, elevation, height };
    });
    this.floorGapExpanded = false;
    this.floorInfo.forEach((info, index) => {
      const group = new THREE.Group();
      group.position.y = info.elevation;
      this.floorGroups.set(info.id, group);
      this.root.add(group);
    });
    const defaultFloor = this.floorInfo[0]?.id;
    for (const room of floorplan.rooms) {
      const floorId = room.floor && this.floorGroups.has(room.floor) ? room.floor : defaultFloor;
      if (floorId) this.floorOfRoom.set(room.id, floorId);
      for (const connector of room.connectors) if (floorId) this.floorOfConnector.set(connector.id, floorId);
    }

    floorplan.rooms.forEach((room, index) => {
      this.currentFloor = this.floorOfRoom.get(room.id);
      const elevation = elevationOf(room);
      const x = room.layout.x + room.layout.width / 2 - this.offset.x;
      const z = room.layout.y + room.layout.height / 2 - this.offset.z;
      this.centres.set(room.id, new THREE.Vector3(x, 0, z));
      const outsideColor = this.cfg.style === 'comic' ? 0x74bd62
        : this.cfg.style === 'futuristic' ? 0x0b4b43 : 0x274c37;
      const roomColor = room.id === 'outside'
        ? new THREE.Color(outsideColor)
        : new THREE.Color(colors[index % colors.length]);
      const floorMaterial = new THREE.MeshStandardMaterial({
          color: roomColor,
          roughness: this.cfg.style === 'futuristic' ? 0.5 : 0.8,
          emissive: this.cfg.style === 'futuristic' ? roomColor.clone().multiplyScalar(0.12) : 0,
          metalness: this.cfg.style === 'futuristic' ? 0.2 : 0,
          flatShading: this.cfg.style === 'comic' || this.cfg.style === 'futuristic',
      });
      const roomShape = this.polygonShape(roomPolygon(room));
      const floor = room.outline
        ? this.extrudedShape(roomShape, visuals.floorThickness, elevation + visuals.floorThickness, floorMaterial)
        : this.box(room.layout.width, visuals.floorThickness, room.layout.height, floorMaterial, x, elevation + visuals.floorThickness / 2, z);
      floor.userData.roomId = room.id;
      if (elevation > 0) {
        const plinthMaterial = new THREE.MeshStandardMaterial({ color: roomColor.clone().multiplyScalar(0.55), roughness: 0.9 });
        const plinth = room.outline
          ? this.extrudedShape(roomShape, elevation, elevation, plinthMaterial)
          : this.box(room.layout.width, elevation, room.layout.height, plinthMaterial, x, elevation / 2, z);
        plinth.userData.roomId = room.id;
        this.addStyleEdges(plinth);
        this.addToFloor(plinth);
      }
      this.addStyleEdges(floor);
      this.addToFloor(floor);
      this.roomMeshes.set(room.id, floor);
      this.roomColors.set(room.id, roomColor);
      if (roomStatusRoomIds.has(room.id)) {
        const statusOverlay = new THREE.Mesh(
          room.outline
            ? new THREE.ShapeGeometry(roomShape)
            : new THREE.BoxGeometry(room.layout.width, 0.008, room.layout.height),
          new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.52,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        if (room.outline) {
          statusOverlay.rotation.x = Math.PI / 2;
          statusOverlay.position.set(0, elevation + visuals.floorThickness + 0.008, 0);
        }
        else statusOverlay.position.set(x, elevation + visuals.floorThickness + 0.004, z);
        statusOverlay.userData.roomId = room.id;
        statusOverlay.renderOrder = 1;
        statusOverlay.visible = false;
        this.addToFloor(statusOverlay);
        this.roomStatusMeshes.set(room.id, statusOverlay);
      }
    });
    this.buildStairs(floorplan, visuals.floorThickness);
    this.buildObjects(floorplan);
    this.currentFloor = undefined;
    // Lower areas first, larger before smaller at equal height, so each gets its own depth layer.
    (floorplan.areas ?? []).filter(area => area.kind === 'tree').forEach(area => this.buildTree(area));
    [...(floorplan.areas ?? [])]
      .filter(area => area.kind !== 'tree')
      .map((area, order) => ({ area, order }))
      .sort((a, b) => elevationOf(a.area) - elevationOf(b.area)
        || b.area.layout.width * b.area.layout.height - a.area.layout.width * a.area.layout.height
        || a.order - b.order)
      .forEach(({ area }, layer) => this.buildSiteArea(area, layer));
    this.roomOverviewTarget.set(
      (roomBounds.minX + roomBounds.maxX) / 2 - this.offset.x,
      this.floorSurfaceHeight / 2,
      (roomBounds.minY + roomBounds.maxY) / 2 - this.offset.z,
    );
    this.siteOverviewTarget.set(
      (siteBounds.minX + siteBounds.maxX) / 2 - this.offset.x,
      this.floorSurfaceHeight / 2,
      (siteBounds.minY + siteBounds.maxY) / 2 - this.offset.z,
    );
    this.updateOverviewCameras();
    this.camera.far = Math.max(150, this.siteOverviewPosition.distanceTo(this.siteOverviewTarget) * 3);
    this.camera.updateProjectionMatrix();

    const wallFloors: (string | undefined)[] = this.floorInfo.length ? this.floorInfo.map(info => info.id) : [undefined];
    const linesByFloor = new Map<string | undefined, ReturnType<typeof wallLines>>();
    for (const floorId of wallFloors) {
      this.currentFloor = floorId;
      const floorRooms = floorId ? floorplan.rooms.filter(room => this.floorOfRoom.get(room.id) === floorId) : floorplan.rooms;
      const connectorIds = new Set(floorRooms.flatMap(room => room.connectors.map(connector => connector.id)));
      const floorplate: Floorplan = {
        ...floorplan,
        rooms: floorRooms,
        relationships: floorplan.relationships.filter(item => connectorIds.has(item.connectorA) && connectorIds.has(item.connectorB)),
      };
      const visuals = floorVisuals;
      const floors = floorplan.floors;
      const openings = resolveOpenings(floorplate, visuals);
      const lines = wallLines(floorplate);
      linesByFloor.set(floorId, lines);
      for (const line of lines) {
        const { segments, cuts } = splitLine(line, openings);
        for (const segment of segments) {
          for (const part of classifyWallSegment(floorplate, line.axis, line.fixed, segment.a, segment.b)) {
            const length = part.end - part.start;
            const middle = (part.start + part.end) / 2;
            const top = wallTop(floorRooms, floors, line.axis, line.fixed, middle, visuals.wallHeight);
            const wall = line.axis === 'x'
              ? this.box(length, top, visuals.wallThickness, wallMaterial, middle - this.offset.x, top / 2, line.fixed - this.offset.z)
              : this.box(visuals.wallThickness, top, length, wallMaterial, line.fixed - this.offset.x, top / 2, middle - this.offset.z);
            this.addCutawayWall(wall, line.axis, line.fixed, part.beforeOccupied, part.afterOccupied);
          }
        }
        cuts.forEach(cut => {
          const { base, height } = openingLevels(floorRooms, cut.o, floors, visuals.wallHeight);
          const part = classifyWallSegment(floorplate, cut.o.axis, cut.o.fixed, cut.a, cut.b)
            .find(item => cut.o.centre >= item.start && cut.o.centre <= item.end);
          this.openingWall = {
            axis: cut.o.axis,
            fixed: cut.o.fixed,
            beforeOccupied: part?.beforeOccupied ?? false,
            afterOccupied: part?.afterOccupied ?? false,
          };
          this.opening(cut.o, { ...visuals, wallHeight: height }, wallMaterial, base);
          this.openingWall = undefined;
        });
      }
      junctionPoints(lines).forEach(point => {
        const postTop = junctionTop(floorRooms, floors, lines, point.x, point.z, visuals.wallHeight);
        const post = this.box(
          visuals.wallThickness,
          postTop,
          visuals.wallThickness,
          wallMaterial,
          point.x - this.offset.x,
          postTop / 2,
          point.z - this.offset.z,
        );
        this.addCutawayWall(post);
      });

    }
    this.currentFloor = undefined;

    const placements = new Map((floorplan.entityPlacements ?? []).map(placement => [placement.id, placement]));
    for (const binding of bindings.filter(item => item.kind === 'water-leak')) {
      const placement = placements.get(binding.ref);
      if (placement?.type !== 'water-leak') continue;
      this.currentFloor = this.placementFloor(placement);
      const group = new THREE.Group();
      group.position.set(
        placement.position[0] - this.offset.x,
        (placement.height ?? 0.12) + this.levelOf(placement),
        placement.position[1] - this.offset.z,
      );
      group.userData.interactionTarget = binding.ref;
      const material = new THREE.MeshStandardMaterial({
        color: 0x4b9ac2,
        emissive: 0x092b3b,
        roughness: 0.45,
      });
      const globe = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), material);
      globe.position.y = -0.035;
      globe.userData.interactionTarget = binding.ref;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.2, 16), material);
      tip.position.y = 0.085;
      tip.userData.interactionTarget = binding.ref;
      group.add(globe, tip);
      this.addToFloor(group);
      this.waterLeakSensors.set(binding.ref, { parts: [globe, tip] });
      this.registerEntityGroup('water-leak', group);
    }

    for (const binding of bindings.filter(item => item.kind === 'light')) {
      const placement = placements.get(binding.ref);
      const centre = binding.targetId ? this.centres.get(binding.targetId) : undefined;
      if (!centre && placement?.type !== 'light') continue;
      this.currentFloor = this.placementFloor(placement) ?? (binding.targetId ? this.floorOfRoom.get(binding.targetId) : undefined);
      const offset = binding.placement?.offset ?? [0, 0, 0];
      const position = placement?.type === 'light'
        ? new THREE.Vector3(placement.position[0] - this.offset.x, 0, placement.position[1] - this.offset.z)
        : centre!;
      const height = binding.placement?.height ?? (placement?.type === 'light'
        ? placement.height ?? visuals.wallHeight - 0.12
        : visuals.wallHeight - 0.12);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.11),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0 }),
      );
      bulb.position.set(position.x + offset[0], height + offset[1], position.z + offset[2]);
      bulb.userData.interactionTarget = binding.ref;
      const lamp = new THREE.PointLight(0xffd49a, 0, 6, 1.5);
      lamp.position.copy(bulb.position);
      const group = new THREE.Group();
      group.position.y = this.levelOf(placement, binding.targetId);
      group.add(bulb, lamp);
      this.addToFloor(group);
      this.lights.set(binding.ref, { lamp, bulb });
      this.registerEntityGroup('light', group);
    }

    for (const binding of bindings.filter(item => item.kind === 'environment-sensor')) {
      const placement = placements.get(binding.ref);
      const centre = binding.targetId ? this.centres.get(binding.targetId) : undefined;
      if (!centre && placement?.type !== 'environment-sensor') continue;
      this.currentFloor = this.placementFloor(placement) ?? (binding.targetId ? this.floorOfRoom.get(binding.targetId) : undefined);
      const position = placement?.type === 'environment-sensor'
        ? new THREE.Vector3(placement.position[0] - this.offset.x, 0, placement.position[1] - this.offset.z)
        : centre!;
      const height = placement?.type === 'environment-sensor' && placement.height !== undefined
        ? placement.height
        : visuals.wallHeight + 0.3;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Unable to create canvas context for environmental sensor labels');
      canvas.width = 512;
      canvas.height = 96;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
      sprite.userData.interactionTarget = binding.ref;
      sprite.position.set(
        position.x,
        height,
        position.z,
      );
      sprite.position.y += this.levelOf(placement, binding.targetId);
      sprite.visible = false;
      this.addToFloor(sprite);
      const visual: EnvironmentVisual = {
        sprite,
        texture,
        canvas,
        context,
        display: binding.display ?? 'label-value',
        label: binding.label ?? (placement?.type === 'environment-sensor' ? placement.label : undefined) ?? binding.ref,
        precision: binding.precision,
        measures: placement?.type === 'environment-sensor' ? placement.measures : undefined,
      };
      this.environmentSensors.set(binding.ref, visual);
      this.registerEntityGroup('environment-sensor', sprite);
    }

    for (const binding of bindings.filter(item => item.kind === 'motion-sensor' || item.kind === 'presence-sensor')) {
      const placement = placements.get(binding.ref);
      if (placement?.type !== 'motion-sensor' && placement?.type !== 'presence-sensor') continue;
      this.currentFloor = this.placementFloor(placement);
      // Use uncut wall lines so door/window openings never expose the sensor view.
      const points = sensorVisibilityPolygon(
        placement.position,
        placement.facingDegrees,
        placement.fieldOfViewDegrees,
        placement.range,
        linesByFloor.get(this.currentFloor) ?? [],
      );
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      points.forEach(([x, y]) => shape.lineTo(x - placement.position[0], y - placement.position[1]));
      shape.closePath();
      const coverage = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({
          color: 0x55d6a5,
          transparent: true,
          opacity: 0.13,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      coverage.rotation.x = Math.PI / 2;
      coverage.position.set(
        placement.position[0] - this.offset.x,
        this.floorSurfaceHeight + 0.015 + ('areaId' in placement && placement.areaId ? 0.06 : 0),
        placement.position[1] - this.offset.z,
      );
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0xff7043, emissive: 0x431000 }),
      );
      marker.visible = false;
      const group = new THREE.Group();
      group.position.y = this.levelOf(placement);
      group.add(coverage, marker);
      this.addToFloor(group);
      this.registerEntityGroup(binding.kind, group);
      this.sensors.set(binding.ref, { coverage, marker });
    }

    this.currentFloor = undefined;
    if (celestial?.sun) this.buildCelestialArtwork('sun', celestial.sun);
    if (celestial?.moon) this.buildCelestialArtwork('moon', celestial.moon);
    const [overviewPosition, overviewTarget] = this.activeOverview();
    this.camera.position.copy(overviewPosition);
    this.controls.target.copy(overviewTarget);
    this.controls.update();
  }

  private addCutawayWall(
    mesh: THREE.Mesh,
    axis?: 'x' | 'z',
    fixed = 0,
    beforeOccupied = false,
    afterOccupied = false,
  ): void {
    const material = (mesh.material as THREE.Material).clone();
    mesh.material = material;
    this.addToFloor(mesh);
    const edgeMaterial = this.addStyleEdges(mesh);
    this.cutawayWalls.push({
      mesh,
      material,
      edgeMaterial,
      edgeOpacity: edgeMaterial?.opacity,
      edgeTransparent: edgeMaterial?.transparent,
      axis,
      fixed,
      beforeOccupied,
      afterOccupied,
    });
  }

  private addStyleEdges(mesh: THREE.Mesh): LineMaterial | undefined {
    if (this.cfg.style === 'standard') return undefined;
    const comic = this.cfg.style === 'comic';
    const material = new LineMaterial({
      color: comic ? 0x28222a : 0x45eaff,
      transparent: !comic,
      opacity: comic ? 1 : 0.9,
      linewidth: this.cfg.lineThickness,
      depthWrite: false,
      toneMapped: false,
    });
    this.gl.getDrawingBufferSize(material.resolution);
    this.styleEdgeMaterials.add(material);
    const edgeGeometry = new THREE.EdgesGeometry(mesh.geometry, 18);
    const positions = edgeGeometry.getAttribute('position').array;
    const geometry = new LineSegmentsGeometry().setPositions(Array.from(positions));
    edgeGeometry.dispose();
    const edges = new LineSegments2(geometry, material);
    edges.renderOrder = 3;
    mesh.add(edges);
    return material;
  }

  private addOpeningWallSection(mesh: THREE.Mesh): void {
    const wall = this.openingWall;
    if (!wall) {
      this.addStyleEdges(mesh);
      this.addToFloor(mesh);
      return;
    }
    // Wall pieces above doors and windows and below windows fade with the rest of the wall.
    mesh.material = (mesh.material as THREE.Material).clone();
    this.addToFloor(mesh);
    this.cutawayWalls.push({
      mesh,
      material: mesh.material as THREE.Material,
      ...this.edgeInfo(this.addStyleEdges(mesh)),
      axis: wall.axis,
      fixed: wall.fixed,
      beforeOccupied: wall.beforeOccupied,
      afterOccupied: wall.afterOccupied,
    });
  }

  private edgeInfo(edgeMaterial?: LineMaterial) {
    return { edgeMaterial, edgeOpacity: edgeMaterial?.opacity, edgeTransparent: edgeMaterial?.transparent };
  }

  private updateCutawayWalls(force = false): void {
    const now = performance.now();
    if (this.cutawayEnabled && !force) {
      if (now - this.lastCutawayUpdate < 40) return;
    }
    this.lastCutawayUpdate = now;
    const cameraX = this.camera.position.x + this.offset.x;
    const cameraZ = this.camera.position.z + this.offset.z;
    for (const wall of this.cutawayWalls) {
      const faded = this.cutawayEnabled && !(wall.axis !== undefined
        && wallSegmentOpaqueFromCameraSide(
          { beforeOccupied: wall.beforeOccupied, afterOccupied: wall.afterOccupied },
          wall.axis,
          wall.fixed,
          cameraX,
          cameraZ,
        ));
      const hidden = faded && this.cutawayMode === 'hide';
      const height = faded && this.cutawayMode === 'fade' ? this.fadedWallHeight : undefined;
      const key = `${faded}|${hidden}|${height ?? ''}`;
      if (wall.applied === key) continue;
      wall.applied = key;
      if (!wall.base) {
        wall.mesh.geometry.computeBoundingBox();
        const box = wall.mesh.geometry.boundingBox!;
        wall.base = { y: wall.mesh.position.y, scaleY: wall.mesh.scale.y, minY: box.min.y, maxY: box.max.y };
      }
      const { base } = wall;
      // Lowered walls keep their bottom edge; pieces that start above the new height disappear.
      let scale = base.scaleY;
      let y = base.y;
      let cut = false;
      if (height !== undefined) {
        const bottom = base.y + base.minY * base.scaleY;
        const top = base.y + base.maxY * base.scaleY;
        if (bottom >= height) cut = true;
        else if (top > height) {
          scale = base.scaleY * (height - bottom) / (top - bottom);
          y = base.y + base.minY * (base.scaleY - scale);
        }
      }
      wall.mesh.scale.y = scale;
      wall.mesh.position.y = y;
      wall.mesh.visible = !hidden && !cut;
      wall.material.transparent = faded;
      wall.material.opacity = faded ? 0.3 : 1;
      wall.material.depthWrite = !faded;
      wall.mesh.castShadow = !faded;
      wall.material.needsUpdate = true;
      if (wall.edgeMaterial) {
        wall.edgeMaterial.opacity = faded ? 0.3 : wall.edgeOpacity ?? 1;
        wall.edgeMaterial.transparent = faded || (wall.edgeTransparent ?? false);
        wall.edgeMaterial.needsUpdate = true;
      }
    }
  }

  private overviewCameraPosition(
    bounds: ReturnType<typeof floorplanBounds>,
    target: THREE.Vector3,
  ): THREE.Vector3 {
    const rect = this.host.getBoundingClientRect();
    const aspect = Math.max(0.1, rect.width / Math.max(1, rect.height));
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const widthDistance = (bounds.maxX - bounds.minX) / (2 * Math.tan(horizontalFov / 2));
    const heightDistance = (bounds.maxY - bounds.minY) / (2 * Math.tan(verticalFov / 2));
    const distance = Math.max(5, widthDistance, heightDistance) * 1.3;
    return target.clone().add(new THREE.Vector3(0.72, 1, 0.72).normalize().multiplyScalar(distance));
  }

  private updateOverviewCameras(): void {
    if (!this.roomBounds || !this.siteBounds) return;
    this.roomOverviewPosition.copy(this.overviewCameraPosition(this.roomBounds, this.roomOverviewTarget));
    this.siteOverviewPosition.copy(this.overviewCameraPosition(this.siteBounds, this.siteOverviewTarget));
  }

  /** A tree is a trunk with a ball canopy; the area's ellipse gives the canopy size and the centre is the trunk. */
  private buildTree(area: FloorplanArea): void {
    const { x, y, width, height } = area.layout;
    const radiusX = width / 2;
    const radiusZ = height / 2;
    const radius = Math.max(0.3, Math.min(radiusX, radiusZ));
    const trunkHeight = Math.max(1, radius * 1.2);
    const trunkRadius = Math.min(0.25, Math.max(0.06, radius * 0.08));
    const comic = this.cfg.style === 'comic';
    const futuristic = this.cfg.style === 'futuristic';
    const group = new THREE.Group();
    group.position.set(x + radiusX - this.offset.x, this.floorSurfaceHeight + elevationOf(area), y + radiusZ - this.offset.z);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(trunkRadius * 0.8, trunkRadius, trunkHeight, 10),
      new THREE.MeshStandardMaterial({ color: futuristic ? 0x1d4a52 : 0x6b4a2f, roughness: 0.9, flatShading: comic || futuristic }),
    );
    trunk.position.y = trunkHeight / 2;
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshStandardMaterial({
        color: comic ? 0x62bf62 : futuristic ? 0x0f725f : 0x3f7a45,
        roughness: 0.85,
        flatShading: comic || futuristic,
        emissive: futuristic ? 0x04251f : 0,
      }),
    );
    canopy.scale.set(radiusX, radius, radiusZ);
    canopy.position.y = trunkHeight + radius * 0.5;
    trunk.castShadow = canopy.castShadow = true;
    trunk.receiveShadow = canopy.receiveShadow = true;
    group.add(trunk, canopy);
    this.treesGroup.add(group);
  }

  private buildSiteArea(area: FloorplanArea, layer: number): void {
    const elevation = elevationOf(area);
    const surfaceY = elevation + this.floorSurfaceHeight + 0.008 + layer * 0.002;
    const { x, y, width, height } = area.layout;
    const left = x - this.offset.x;
    const top = y - this.offset.z;
    const right = left + width;
    const bottom = top + height;
    const shape = new THREE.Shape();
    if (area.shape === 'ellipse') {
      shape.absellipse(left + width / 2, top + height / 2, width / 2, height / 2, 0, Math.PI * 2, false, 0);
    } else {
      outlinePolygon(area.layout, area.outline).forEach(([px, py], index) => {
        if (index === 0) shape.moveTo(px - this.offset.x, py - this.offset.z);
        else shape.lineTo(px - this.offset.x, py - this.offset.z);
      });
      shape.closePath();
    }

    const colors: Record<string, number> = {
      garden: this.cfg.style === 'comic' ? 0x62bf62 : this.cfg.style === 'futuristic' ? 0x0f725f : 0x47794c,
      deck: this.cfg.style === 'comic' ? 0xd99042 : area.roofed ? 0x765b3e : 0x98764d,
      driveway: this.cfg.style === 'comic' ? 0x9ca4ad : area.roofed ? 0x5d6268 : 0x777d83,
      pond: this.cfg.style === 'comic' ? 0x43bde0 : this.cfg.style === 'futuristic' ? 0x007da3 : 0x32849a,
    };
    const color = colors[area.kind] ?? 0x68735d;
    const surfaceColor = area.roofed
      ? new THREE.Color(color).lerp(new THREE.Color(0x30343a), 0.18)
      : color;
    const surface = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({
        color: surfaceColor,
        transparent: true,
        opacity: area.kind === 'pond' ? 0.88 : 0.94,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    surface.rotation.x = Math.PI / 2;
    surface.position.y = surfaceY;
    surface.renderOrder = 1 + layer * 2;
    this.siteAreasGroup.add(surface);
    if (elevation > 0) {
      const plinth = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, { depth: surfaceY - 0.002, bevelEnabled: false }),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.9 }),
      );
      plinth.rotation.x = Math.PI / 2;
      plinth.position.y = surfaceY - 0.002;
      this.addStyleEdges(plinth);
      this.siteAreasGroup.add(plinth);
    }

    const outlinePoints = area.shape === 'ellipse'
      ? Array.from({ length: 49 }, (_, index) => {
        const angle = index / 48 * Math.PI * 2;
        return new THREE.Vector3(
          left + width / 2 + Math.cos(angle) * width / 2,
          surfaceY + 0.004,
          top + height / 2 + Math.sin(angle) * height / 2,
        );
      })
      : outlinePolygon(area.layout, area.outline).map(([px, py]) => new THREE.Vector3(
        px - this.offset.x,
        surfaceY + 0.004,
        py - this.offset.z,
      ));
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(outlinePoints),
      new THREE.LineBasicMaterial({
        color: this.cfg.style === 'comic' ? 0x28222a
          : this.cfg.style === 'futuristic' ? 0x45eaff
            : area.roofed ? 0x4a4236 : color,
        transparent: true,
        opacity: 0.85,
        toneMapped: this.cfg.style !== 'futuristic',
      }),
    );
    outline.renderOrder = 2 + layer * 2;
    this.siteAreasGroup.add(outline);

  }

  private buildGround(
    floorplan: Floorplan,
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
  ): void {
    const margin = Math.max(2, Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.1);
    const reach = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2 + margin;
    const camera = this.sunlight.shadow.camera;
    camera.left = camera.bottom = -reach;
    camera.right = camera.top = reach;
    camera.near = 0.5;
    camera.far = 80;
    camera.updateProjectionMatrix();
    const polygon = floorplan.ground?.polygon ?? [
      [bounds.minX - margin, bounds.minY - margin],
      [bounds.maxX + margin, bounds.minY - margin],
      [bounds.maxX + margin, bounds.maxY + margin],
      [bounds.minX - margin, bounds.maxY + margin],
    ];
    const shape = new THREE.Shape();
    polygon.forEach(([x, y], index) => {
      if (index === 0) shape.moveTo(x - this.offset.x, y - this.offset.z);
      else shape.lineTo(x - this.offset.x, y - this.offset.z);
    });
    shape.closePath();
    const defaultGroundColor = this.cfg.style === 'comic' ? '#527b91'
      : this.cfg.style === 'futuristic' ? '#071321' : '#193d2d';
    const groundColor = floorplan.ground?.color ?? defaultGroundColor;
    const ground = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color: groundColor, side: THREE.DoubleSide }),
    );
    ground.rotation.x = Math.PI / 2;
    ground.position.y = -0.035;
    ground.renderOrder = -1;
    this.addToFloor(ground);

    const borderPoints = polygon.map(([x, y]) => new THREE.Vector3(
      x - this.offset.x,
      -0.02,
      y - this.offset.z,
    ));
    const border = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(borderPoints),
      new THREE.LineBasicMaterial({
        color: this.cfg.style === 'comic' ? 0x28222a : this.cfg.style === 'futuristic' ? 0x45eaff : '#547b5f',
        toneMapped: this.cfg.style !== 'futuristic',
      }),
    );
    border.renderOrder = 1;
    this.addToFloor(border);
  }

  private buildCelestialArtwork(
    body: 'sun' | 'moon',
    config: NonNullable<CelestialConfig['sun']>,
  ): void {
    const x = config.position[0] - this.offset.x;
    const z = config.position[1] - this.offset.z;
    const ground = new THREE.Group();
    ground.position.set(x, this.floorSurfaceHeight + 0.035, z);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(config.radius * 0.34, 0.025, 8, 48),
      new THREE.MeshBasicMaterial({ color: body === 'sun' ? 0xf5d76e : 0xb7c9ff }),
    );
    ring.rotation.x = Math.PI / 2;
    ground.add(ring);
    const northAngle = -this.sunNorthDegrees * Math.PI / 180;
    for (let index = 0; index < 4; index += 1) {
      const angle = northAngle + index * Math.PI / 2;
      const tick = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 0.025, index === 0 ? config.radius * 0.25 : config.radius * 0.16),
        new THREE.MeshBasicMaterial({ color: body === 'sun' ? 0xf5d76e : 0xb7c9ff }),
      );
      tick.position.set(Math.sin(angle) * config.radius * 0.34, 0, -Math.cos(angle) * config.radius * 0.34);
      tick.rotation.y = compassTickRotation(this.sunNorthDegrees, index);
      ground.add(tick);
    }
    this.addToFloor(ground);

    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.12, config.radius * 0.055), 20, 16),
      new THREE.MeshStandardMaterial({
        color: body === 'sun' ? 0xffd54f : 0xd8e2ff,
        emissive: body === 'sun' ? 0xff8f00 : 0x6279c4,
        emissiveIntensity: 1.1,
      }),
    );
    marker.position.set(x, 0, z);
    marker.visible = false;
    this.addToFloor(marker);
    this.celestialMarkers.set(body, {
      marker,
      origin: new THREE.Vector3(x, this.floorSurfaceHeight, z),
      radius: config.radius,
    });
  }

  updateCelestial(body: 'sun' | 'moon', position?: SunPosition): void {
    const artwork = this.celestialMarkers.get(body);
    if (!artwork || !position) {
      if (artwork) artwork.marker.visible = false;
      if (body === 'sun' && this.celestialMarkers.has('sun')) {
        this.sunlight.position.copy(this.defaultSunlightPosition);
        this.sunlight.intensity = this.cfg.visuals.sunlightIntensity;
      }
      return;
    }
    const direction = sunDirection(position, this.sunNorthDegrees);
    artwork.marker.visible = position.elevation >= 0;
    artwork.marker.position.set(
      artwork.origin.x + direction.x * artwork.radius,
      Math.max(this.floorSurfaceHeight + 0.06, artwork.origin.y + direction.y * artwork.radius),
      artwork.origin.z + direction.z * artwork.radius,
    );
    if (body === 'sun') {
      this.sunlight.position.set(direction.x * 20, direction.y * 20, direction.z * 20);
      this.sunlight.intensity = position.elevation >= 0 ? this.cfg.visuals.sunlightIntensity : 0;
    }
  }

  updateSensor(id: string, active: boolean, detectedPosition?: [number, number]): void {
    const sensor = this.sensors.get(id);
    if (!sensor) return;
    const material = sensor.coverage.material as THREE.MeshBasicMaterial;
    material.opacity = active ? 0.28 : 0.1;
    material.color.set(active ? 0x55d6a5 : 0x6c8791);
    sensor.marker.visible = detectedPosition !== undefined;
    if (detectedPosition) {
      sensor.marker.position.set(
        detectedPosition[0] - this.offset.x,
        this.floorSurfaceHeight + 0.14,
        detectedPosition[1] - this.offset.z,
      );
    }
  }

  updateEnvironmentSensor(id: string, entity: EntityState | undefined): void {
    const visual = this.environmentSensors.get(id);
    if (!visual) return;
    const lines = visual.measures
      ? entity
        ? visual.measures.map(measure =>
          `${measure.name}: ${environmentMeasureValue(entity, measure, visual.precision) ?? '—'}`)
        : []
      : (() => {
        const value = environmentValue(entity, visual.precision);
        return value === undefined
          ? []
          : [visual.display === 'value' ? value : `${visual.label}: ${value}`];
      })();
    visual.sprite.visible = lines.length > 0;
    if (!lines.length) return;
    const context = visual.context;
    const fontSize = visual.measures ? 30 : 38;
    const lineHeight = visual.measures ? 46 : 70;
    context.font = `600 ${fontSize}px system-ui, sans-serif`;
    const textWidth = Math.ceil(Math.max(...lines.map(line => context.measureText(line).width)));
    const padding = 24;
    visual.canvas.width = textWidth + padding * 2;
    visual.canvas.height = lineHeight * lines.length + padding;
    context.font = `600 ${fontSize}px system-ui, sans-serif`;
    context.fillStyle = '#101821e8';
    context.strokeStyle = '#ffffff55';
    context.lineWidth = 3;
    const left = 2;
    const top = 2;
    const right = visual.canvas.width - 2;
    const bottom = visual.canvas.height - 2;
    const radius = 18;
    context.beginPath();
    context.moveTo(left + radius, top);
    context.lineTo(right - radius, top);
    context.quadraticCurveTo(right, top, right, top + radius);
    context.lineTo(right, bottom - radius);
    context.quadraticCurveTo(right, bottom, right - radius, bottom);
    context.lineTo(left + radius, bottom);
    context.quadraticCurveTo(left, bottom, left, bottom - radius);
    context.lineTo(left, top + radius);
    context.quadraticCurveTo(left, top, left + radius, top);
    context.closePath();
    context.fill();
    context.stroke();
    context.fillStyle = '#f3f6f8';
    context.textAlign = visual.measures ? 'left' : 'center';
    context.textBaseline = 'middle';
    lines.forEach((line, index) => {
      context.fillText(
        line,
        visual.measures ? padding : visual.canvas.width / 2,
        padding / 2 + lineHeight * (index + 0.5),
      );
    });
    visual.texture.needsUpdate = true;
    const width = Math.min(3.4, Math.max(1, visual.canvas.width / 130));
    visual.sprite.scale.set(width, width * visual.canvas.height / visual.canvas.width, 1);
  }

  private opening(opening: Opening, visuals: Config['visuals'], wallMaterial: THREE.Material, base = 0): void {
    if (base <= 0) {
      this.buildOpening(opening, visuals, wallMaterial);
      return;
    }
    // Everything of the opening is built relative to its sill level; the wall below is filled solid.
    const group = new THREE.Group();
    group.position.y = base;
    this.addToFloor(group);
    const previous = this.addTarget;
    this.addTarget = group;
    try {
      this.buildOpening(opening, visuals, wallMaterial);
    } finally {
      this.addTarget = previous;
    }
    const x = (opening.axis === 'x' ? opening.centre : opening.fixed) - this.offset.x;
    const z = (opening.axis === 'x' ? opening.fixed : opening.centre) - this.offset.z;
    this.addOpeningWallSection(opening.axis === 'x'
      ? this.box(opening.width, base, visuals.wallThickness, wallMaterial, x, base / 2, z)
      : this.box(visuals.wallThickness, base, opening.width, wallMaterial, x, base / 2, z));
  }

  private buildOpening(opening: Opening, visuals: Config['visuals'], wallMaterial: THREE.Material): void {
    const x = (opening.axis === 'x' ? opening.centre : opening.fixed) - this.offset.x;
    const z = (opening.axis === 'x' ? opening.fixed : opening.centre) - this.offset.z;
    const thickness = visuals.wallThickness;
    const hasBlind = this.coverBindings.has(opening.id)
      || opening.id.split('--').some(connectorId => this.coverBindings.has(connectorId));
    if (opening.type === 'open-passage') return;
    if (opening.type === 'door') {
      const top = Math.max(0, visuals.wallHeight - visuals.doorHeight);
      if (top) {
        this.addOpeningWallSection(opening.axis === 'x'
          ? this.box(opening.width, top, thickness, wallMaterial, x, visuals.doorHeight + top / 2, z)
          : this.box(thickness, top, opening.width, wallMaterial, x, visuals.doorHeight + top / 2, z));
      }
      const jambMaterial = new THREE.MeshStandardMaterial({ color: 0xc7c3b8 });
      const jambWidth = Math.min(0.06, thickness * 0.4);
      if (opening.axis === 'x') {
        this.addToFloor(
          this.box(jambWidth, visuals.doorHeight, thickness + 0.012, jambMaterial, x - opening.width / 2, visuals.doorHeight / 2, z),
          this.box(jambWidth, visuals.doorHeight, thickness + 0.012, jambMaterial, x + opening.width / 2, visuals.doorHeight / 2, z),
        );
      } else {
        this.addToFloor(
          this.box(thickness + 0.012, visuals.doorHeight, jambWidth, jambMaterial, x, visuals.doorHeight / 2, z - opening.width / 2),
          this.box(thickness + 0.012, visuals.doorHeight, jambWidth, jambMaterial, x, visuals.doorHeight / 2, z + opening.width / 2),
        );
      }
      const door = opening.connector.door;
      const glassLeaf = door?.glass === true || door?.style === 'sliding-glass';
      const material = glassLeaf
        ? new THREE.MeshStandardMaterial({ color: 0x78c7ef, transparent: true, opacity: 0.42, side: THREE.DoubleSide })
        : new THREE.MeshStandardMaterial({ color: 0x815535 });
      if (door?.style === 'sliding-glass' || door?.style === 'sliding') {
        const frame = new THREE.MeshStandardMaterial({ color: 0xd1d1c8, roughness: 0.7 });
        const glass = door.style === 'sliding'
          ? material
          : new THREE.MeshStandardMaterial({
            color: 0x78c7ef,
            transparent: true,
            opacity: 0.42,
            side: THREE.DoubleSide,
          });
        const panelWidth = opening.width / 2 + 0.025;
        const slider = new THREE.Group();
        slider.position.set(x, 0, z);
        slider.userData.interactionTarget = opening.id;
        const stationary = this.buildWindowPanel(opening.axis, panelWidth, visuals.doorHeight, 0.055, glass, frame, 0, visuals.doorHeight / 2, 0);
        const moving = this.buildWindowPanel(opening.axis, panelWidth, visuals.doorHeight, 0.055, glass, frame, 0, visuals.doorHeight / 2, 0);
        stationary.position[opening.axis] = -opening.width / 4;
        moving.position[opening.axis] = opening.width / 4;
        moving.userData.interactionTarget = opening.id;
        slider.add(stationary, moving);
        this.attachLock(opening, moving, opening.axis, panelWidth, visuals.doorHeight, 0.055, 0, true);
        this.addToFloor(slider);
        const openPosition = moving.position.clone();
        openPosition[opening.axis] += (door.slideDirection === 'start' ? -1 : 1) * opening.width / 2;
        this.registerOpeningMotion(opening.id, slider, [moving], 'slide', opening.axis, 1, [openPosition]);
        if (hasBlind) this.buildBlind(opening, x, z, 0, visuals.doorHeight, thickness);
        return;
      }

      if (door?.style === 'double') {
        const pose = doorPose(opening, x, z);
        const assembly = new THREE.Group();
        assembly.position.set(x, 0, z);
        assembly.rotation.y = pose.closed;
        assembly.userData.interactionTarget = opening.id;
        const halfWidth = opening.width / 2 - 0.006;
        const rotation = pose.open - pose.closed;
        const rotations: NonNullable<OpeningMotion['rotations']> = [];
        const leaves: THREE.Group[] = [];
        for (const side of [-1, 1]) {
          const hinge = new THREE.Group();
          hinge.position.x = side * opening.width / 2;
          hinge.userData.interactionTarget = opening.id;
          const leaf = this.box(
            halfWidth,
            visuals.doorHeight,
            0.055,
            material,
            -side * halfWidth / 2,
            visuals.doorHeight / 2,
            0,
          );
          leaf.userData.interactionTarget = opening.id;
          hinge.add(leaf);
          if (side === 1) this.attachLock(opening, leaf, 'x', halfWidth, visuals.doorHeight, 0.055, side * 0.3 * halfWidth);
          assembly.add(hinge);
          leaves.push(hinge);
          rotations.push({
            pivot: hinge,
            closed: 0,
            open: side === -1 ? rotation : -rotation,
          });
        }
        this.addToFloor(assembly);
        this.registerOpeningMotion(opening.id, assembly, leaves, 'rotate', 'y', 1, [], undefined, 0, rotations);
        return;
      }

      const pivot = new THREE.Group();
      pivot.userData.interactionTarget = opening.id;
      if (door?.style === 'pocket-sliding') {
        pivot.position.set(x, 0, z);
        const leaf = this.panelBox(
          opening.axis,
          opening.width - 0.012,
          visuals.doorHeight,
          0.055,
          material,
          0,
          visuals.doorHeight / 2,
          0,
        );
        leaf.userData.interactionTarget = opening.id;
        pivot.add(leaf);
        this.attachLock(opening, leaf, opening.axis, opening.width - 0.012, visuals.doorHeight, 0.055, 0);
        const direction = door.slideDirection === 'end' ? 1 : -1;
        const visibleFraction = door.visibleFraction ?? 0.1;
        const slide = new THREE.Vector3();
        slide[opening.axis] = direction * opening.width * (1 - visibleFraction);
        this.addToFloor(pivot);
        this.registerOpeningMotion(opening.id, pivot, [leaf], 'slide', opening.axis, 1, [leaf.position.clone().add(slide)], leaf);
      } else {
        const pose = doorPose(opening, x, z);
        pivot.position.set(pose.hingeX, 0, pose.hingeZ);
        const leaf = this.box(
          opening.width - 0.012,
          visuals.doorHeight,
          0.055,
          material,
          pose.leafDirection * (opening.width - 0.012) / 2,
          visuals.doorHeight / 2,
          0,
        );
        leaf.userData.interactionTarget = opening.id;
        pivot.rotation.y = pose.closed;
        this.attachLock(opening, leaf, 'x', opening.width - 0.012, visuals.doorHeight, 0.055, pose.leafDirection * (opening.width - 0.012) * 0.38);
        this.addToFloor(pivot);
        if (door?.tilt) {
          // Tilt-and-turn: the leaf tilts in from the top about its lower edge, separate from the turn.
          const tiltPivot = new THREE.Group();
          tiltPivot.position.x = leaf.position.x;
          leaf.position.x = 0;
          tiltPivot.add(leaf);
          pivot.add(tiltPivot);
          const tiltAngle = (door.openAngle && door.openAngle < 30 ? door.openAngle : 10) * Math.PI / 180;
          const swingSign = door.swing === 'outward' ? -1 : 1;
          this.registerOpeningMotion(opening.id, pivot, [tiltPivot], 'rotate', 'y', pose.open, [tiltPivot.position.clone()], leaf, pose.closed);
          this.registerOpeningMotion(`${opening.id}${tiltSuffix}`, tiltPivot, [leaf], 'rotate', 'x', swingSign * tiltAngle, [leaf.position.clone()]);
        } else {
          pivot.add(leaf);
          this.registerOpeningMotion(opening.id, pivot, [leaf], 'rotate', 'y', pose.open, [leaf.position.clone()], leaf, pose.closed);
        }
      }
      return;
    }

    const window = opening.connector.window;
    const sill = window?.sillHeight ?? visuals.windowSillHeight;
    const head = window?.headHeight ?? visuals.windowHeadHeight;
    const above = Math.max(0, visuals.wallHeight - head);
    if (sill) {
      this.addOpeningWallSection(opening.axis === 'x'
        ? this.box(opening.width, sill, thickness, wallMaterial, x, sill / 2, z)
        : this.box(thickness, sill, opening.width, wallMaterial, x, sill / 2, z));
    }
    if (above) {
      this.addOpeningWallSection(opening.axis === 'x'
        ? this.box(opening.width, above, thickness, wallMaterial, x, head + above / 2, z)
        : this.box(thickness, above, opening.width, wallMaterial, x, head + above / 2, z));
    }
    const height = head - sill;
    if (height <= 0) return;
    const frame = new THREE.MeshStandardMaterial({ color: 0xd1d1c8, roughness: 0.7 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x78c7ef,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
    });
    const frameDepth = window?.frameDepth ?? visuals.frameDepth;
    const jambWidth = Math.min(0.055, opening.width * 0.08);
    this.addToFloor(
      this.panelBox(opening.axis, jambWidth, height, frameDepth, frame, x - (opening.axis === 'x' ? opening.width / 2 - jambWidth / 2 : 0), (sill + head) / 2, z - (opening.axis === 'z' ? opening.width / 2 - jambWidth / 2 : 0)),
      this.panelBox(opening.axis, jambWidth, height, frameDepth, frame, x + (opening.axis === 'x' ? opening.width / 2 - jambWidth / 2 : 0), (sill + head) / 2, z + (opening.axis === 'z' ? opening.width / 2 - jambWidth / 2 : 0)),
      this.panelBox(opening.axis, opening.width, jambWidth, frameDepth, frame, x, sill + jambWidth / 2, z),
      this.panelBox(opening.axis, opening.width, jambWidth, frameDepth, frame, x, head - jambWidth / 2, z),
    );

    if (window?.type === 'sliding') {
      const panelWidth = opening.width / 2 + jambWidth / 2;
      const slider = new THREE.Group();
      slider.position.set(x, 0, z);
      slider.userData.interactionTarget = opening.id;
      const stationary = this.buildWindowPanel(opening.axis, panelWidth, height, frameDepth, glass, frame, 0, (sill + head) / 2, 0);
      const moving = this.buildWindowPanel(opening.axis, panelWidth, height, frameDepth, glass, frame, 0, (sill + head) / 2, 0);
      stationary.position[opening.axis] = -opening.width / 4;
      moving.position[opening.axis] = opening.width / 4;
      slider.add(stationary, moving);
      this.addToFloor(slider);
      const openPosition = moving.position.clone();
      openPosition[opening.axis] += (window.slideDirection === 'end' ? 1 : -1) * opening.width / 2;
      this.registerOpeningMotion(opening.id, slider, [moving], 'slide', opening.axis, 1, [openPosition]);
      if (hasBlind) this.buildBlind(opening, x, z, sill, head, frameDepth);
      return;
    }

    if (window?.type === 'slide-vertical') {
      const panelHeight = height / 2 + jambWidth / 2;
      const slider = new THREE.Group();
      slider.position.set(x, 0, z);
      slider.userData.interactionTarget = opening.id;
      const stationary = this.buildWindowPanel(opening.axis, opening.width - jambWidth * 2, panelHeight, frameDepth * 0.65, glass, frame, 0, sill + height / 4, 0);
      const moving = this.buildWindowPanel(opening.axis, opening.width - jambWidth * 2, panelHeight, frameDepth, glass, frame, 0, sill + height * 3 / 4, 0);
      moving.userData.interactionTarget = opening.id;
      slider.add(stationary, moving);
      this.addToFloor(slider);
      // The lower sash slides up; the upper one is fixed.
      const lowered = moving.position.clone();
      lowered.y = sill + height / 4;
      const raised = lowered.clone();
      raised.y += height / 2 - jambWidth / 2;
      moving.position.copy(lowered);
      stationary.position.y = sill + height * 3 / 4;
      this.registerOpeningMotion(opening.id, slider, [moving], 'slide', 'y', 1, [raised]);
      if (hasBlind) this.buildBlind(opening, x, z, sill, head, frameDepth);
      return;
    }

    if (window?.type === 'hinged' || window?.type === 'tilt-turn') {
      const paneWidth = opening.width - jambWidth * 2;
      const hingeAtStart = (window.hinge ?? 'left') === 'left';
      const direction = hingeAtStart ? 1 : -1;
      const hingeX = x + (opening.axis === 'x' ? -direction * paneWidth / 2 : 0);
      const hingeZ = z + (opening.axis === 'z' ? -direction * paneWidth / 2 : 0);
      const turnPivot = new THREE.Group();
      turnPivot.position.set(hingeX, sill, hingeZ);
      turnPivot.userData.interactionTarget = opening.id;
      const side = opening.connector.side;
      const inward = (side === 'top' || side === 'left') !== (window.swing === 'outward');
      // Swing towards the room: +90° or -90° about y depending on wall orientation, side and hinge end.
      const turnSign = (opening.axis === 'x' ? (inward ? -1 : 1) : (inward ? 1 : -1)) * direction;
      const turnAngle = turnSign * (window.type === 'hinged' ? (window.openAngle ?? 90) : 90) * Math.PI / 180;
      this.addToFloor(turnPivot);
      if (window.type === 'hinged') {
        const pane = this.buildWindowPanel(opening.axis, paneWidth, height - jambWidth, frameDepth * 0.65, glass, frame, 0, height / 2, 0);
        pane.position[opening.axis] = direction * paneWidth / 2;
        turnPivot.add(pane);
        this.registerOpeningMotion(opening.id, turnPivot, [pane], 'rotate', 'y', turnAngle, [pane.position.clone()]);
      } else {
        const tiltPivot = new THREE.Group();
        tiltPivot.position[opening.axis] = direction * paneWidth / 2;
        const pane = this.buildWindowPanel(opening.axis, paneWidth, height - jambWidth, frameDepth * 0.65, glass, frame, 0, height / 2, 0);
        tiltPivot.add(pane);
        turnPivot.add(tiltPivot);
        const tiltSign = opening.axis === 'x' ? (inward ? 1 : -1) : (inward ? -1 : 1);
        const tiltAngle = tiltSign * (window.openAngle ?? 12) * Math.PI / 180;
        this.registerOpeningMotion(opening.id, turnPivot, [tiltPivot], 'rotate', 'y', turnAngle, [tiltPivot.position.clone()]);
        this.registerOpeningMotion(`${opening.id}${tiltSuffix}`, tiltPivot, [pane], 'rotate', opening.axis === 'x' ? 'x' : 'z', tiltAngle, [pane.position.clone()]);
      }
      if (hasBlind) this.buildBlind(opening, x, z, sill, head, frameDepth);
      return;
    }

    if (window?.type === 'tilt') {
      const pivot = new THREE.Group();
      pivot.position.set(x, sill, z);
      pivot.userData.interactionTarget = opening.id;
      const pane = this.buildWindowPanel(opening.axis, opening.width - jambWidth * 2, height - jambWidth, frameDepth * 0.65, glass, frame, 0, height / 2, 0);
      pivot.add(pane);
      const rotationAxis = opening.axis === 'x' ? 'x' : 'z';
      const inward = opening.connector.side === 'top' || opening.connector.side === 'left';
      const sign = opening.axis === 'x' ? (inward ? 1 : -1) : (inward ? -1 : 1);
      const openAngle = sign * (window.openAngle ?? 12) * Math.PI / 180;
      this.addToFloor(pivot);
      this.registerOpeningMotion(opening.id, pivot, [pane], 'rotate', rotationAxis, openAngle, [pane.position.clone()]);
      if (hasBlind) this.buildBlind(opening, x, z, sill, head, frameDepth);
      return;
    }

    this.addToFloor(this.panelBox(opening.axis, opening.width - jambWidth * 2, height - jambWidth, frameDepth * 0.65, glass, x, (sill + head) / 2, z));
    if (hasBlind) this.buildBlind(opening, x, z, sill, head, frameDepth);
  }

  private buildBlind(
    opening: Opening,
    x: number,
    z: number,
    sill: number,
    head: number,
    depth: number,
  ): void {
    const height = head - sill;
    if (height <= 0) return;
    const blindMaterial = new THREE.MeshStandardMaterial({ color: 0x8f8067, roughness: 0.9 });
    const panel = this.panelBox(
      opening.axis,
      opening.width - 0.12,
      height,
      Math.max(0.025, depth * 0.2),
      blindMaterial,
      x,
      sill + height / 2,
      z,
    );
    panel.userData.interactionTarget = opening.id;
    const roller = this.panelBox(
      opening.axis,
      opening.width - 0.08,
      0.07,
      Math.max(0.05, depth * 0.45),
      blindMaterial,
      x,
      head - 0.035,
      z,
    );
    this.addToFloor(panel, roller);
    const raised = panel.position.clone();
    raised.y = head - 0.04;
    this.registerOpeningMotion(
      opening.id,
      new THREE.Group(),
      [panel],
      'scale-slide',
      'y',
      1,
      [raised],
      undefined,
      0,
      undefined,
      [panel.scale.clone()],
      [new THREE.Vector3(1, 0.025, 1)],
    );
    this.registerEntityGroup('cover', panel);
  }

  private buildWindowPanel(
    axis: 'x' | 'z',
    width: number,
    height: number,
    depth: number,
    glass: THREE.Material,
    frame: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): THREE.Group {
    const panel = new THREE.Group();
    panel.position.set(x, y, z);
    panel.add(this.panelBox(axis, width, height, depth * 0.45, glass, 0, 0, 0));
    const rail = Math.min(0.045, width * 0.1, height * 0.1);
    panel.add(
      this.panelBox(axis, width, rail, depth, frame, 0, -height / 2 + rail / 2, 0),
      this.panelBox(axis, width, rail, depth, frame, 0, height / 2 - rail / 2, 0),
      this.panelBox(axis, rail, height, depth, frame, axis === 'x' ? -width / 2 + rail / 2 : 0, 0, axis === 'z' ? -width / 2 + rail / 2 : 0),
      this.panelBox(axis, rail, height, depth, frame, axis === 'x' ? width / 2 - rail / 2 : 0, 0, axis === 'z' ? width / 2 - rail / 2 : 0),
    );
    return panel;
  }

  private registerOpeningMotion(
    id: string,
    pivot: THREE.Group,
    panels: THREE.Object3D[],
    mode: OpeningMotion['mode'],
    axis: OpeningMotion['axis'],
    open: number,
    openPositions: THREE.Vector3[],
    doorLeaf?: THREE.Mesh,
    closed = 0,
    rotations?: OpeningMotion['rotations'],
    closedScales?: THREE.Vector3[],
    openScales?: THREE.Vector3[],
  ): void {
    this.openingMotions.set(id, {
      pivot,
      panels,
      mode,
      axis,
      closed,
      open,
      current: closed,
      from: closed,
      target: closed,
      startedAt: 0,
      closedPositions: panels.map(panel => panel.position.clone()),
      openPositions,
      closedScales,
      openScales,
      rotations,
      doorLeaf,
    });
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

  updateWaterLeak(id: string, entity?: EntityState): void {
    const visual = this.waterLeakSensors.get(id);
    if (!visual) return;
    const available = !!entity && !['unknown', 'unavailable'].includes(entity.state);
    const leaking = available && entity.state === 'on';
    const color = leaking ? 0xff394a : available ? 0x4b9ac2 : 0x777777;
    const emissive = leaking ? 0x6b0712 : available ? 0x092b3b : 0x111111;
    for (const part of visual.parts) {
      const material = part.material as THREE.MeshStandardMaterial;
      material.color.setHex(color);
      material.emissive.setHex(emissive);
    }
  }

  private readonly windowStates = new Map<string, { tilt: number; open: number }>();

  /**
   * Opens or closes a door or window. A tilt-and-turn window has two sensors:
   * mode "tilt" drives the tilt, anything else the turn; the turn hides the tilt while open.
   */
  private lockTarget(opening: Opening): string | undefined {
    if (this.lockTargets.has(opening.id)) return opening.id;
    return opening.id.split('--').find(connectorId => this.lockTargets.has(connectorId));
  }

  private attachLock(
    opening: Opening,
    leaf: THREE.Object3D,
    axis: 'x' | 'z',
    width: number,
    height: number,
    depth: number,
    along: number,
    originAtFloor = false,
  ): void {
    const target = this.lockTarget(opening);
    if (!target) return;
    const material = new THREE.MeshBasicMaterial({ color: lockColor('unavailable') });
    const group = new THREE.Group();
    group.userData.interactionTarget = opening.id;
    const stripWidth = width * 0.9;
    const strip = (y: number): THREE.Mesh => this.panelBox(axis, stripWidth, 0.03, depth + 0.006, material, 0, y, 0);
    group.add(strip(-height / 2 + 0.05), strip(height / 2 - 0.05));
    const shackles: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      const symbol = new THREE.Group();
      const offset = depth / 2 + 0.008;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.016), material);
      body.position.y = -0.035;
      const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 8, 16, Math.PI), material);
      shackle.position.y = 0;
      symbol.add(body, shackle);
      symbol.position.set(0, 0, 0);
      const placement = new THREE.Group();
      placement.add(symbol);
      symbol.position.z = side * offset;
      if (side === -1) symbol.rotation.y = Math.PI;
      placement.position[axis] = along;
      placement.position.y = -0.05;
      if (axis === 'z') placement.rotation.y = Math.PI / 2;
      group.add(placement);
      shackles.push(shackle);
    }
    if (originAtFloor) group.position.y = height / 2;
    leaf.add(group);
    this.registerEntityGroup('lock', group);
    const list = this.lockVisuals.get(target) ?? [];
    list.push({ material, shackles });
    this.lockVisuals.set(target, list);
  }

  updateLock(id: string, status: LockStatus): void {
    for (const [key, visuals] of this.lockVisuals) {
      if (key !== id && !key.split('--').includes(id) && !id.split('--').includes(key)) continue;
      for (const item of visuals) {
        item.material.color.set(lockColor(status));
        for (const shackle of item.shackles) {
          shackle.position.y = status === 'unlocked' ? 0.02 : 0;
          shackle.position.x = status === 'unlocked' ? 0.012 : 0;
          shackle.rotation.z = status === 'unlocked' ? -0.35 : 0;
        }
      }
    }
  }

  updateDoor(id: string, state: { open: boolean; available?: boolean }, mode?: 'tilt' | 'open'): void {
    const value = state.open ? 1 : 0;
    if (this.hasTilt(id)) {
      const window = this.windowStates.get(id) ?? { tilt: 0, open: 0 };
      if (mode === 'tilt') window.tilt = value;
      else window.open = value;
      this.windowStates.set(id, window);
      this.animateOpeningTo(id, window.open);
      this.animateOpeningTo(id, window.open ? 0 : window.tilt, tiltSuffix);
    } else {
      this.animateOpeningTo(id, value);
    }
    for (const [key, motion] of this.openingMotions) {
      if (key === id || key.includes(id)) {
        if (motion.doorLeaf) {
          (motion.doorLeaf.material as THREE.MeshStandardMaterial).color.set(state.available === false ? '#777' : '#815535');
        }
      }
    }
  }

  private hasTilt(id: string): boolean {
    return [...this.openingMotions.keys()].some(key => key.endsWith(tiltSuffix) && key.slice(0, -tiltSuffix.length).split('--').includes(id));
  }

  updateCover(id: string, position: number | undefined): void {
    if (position === undefined) return;
    this.animateOpeningTo(id, Math.max(0, Math.min(1, position / 100)));
  }

  private animateOpeningTo(id: string, value: number, suffix = ''): void {
    for (const [key, motion] of this.openingMotions) {
      if (suffix ? !key.endsWith(suffix) : key.endsWith(tiltSuffix)) continue;
      const base = suffix ? key.slice(0, -suffix.length) : key;
      if (base !== id && !base.split('--').includes(id)) continue;
      const target = motion.closed + (motion.open - motion.closed) * value;
      if (motion.target !== target) {
        motion.from = motion.current;
        motion.target = target;
        motion.startedAt = performance.now();
      }
    }
  }

  private animateDoors(now: number): void {
    for (const motion of this.openingMotions.values()) {
      if (motion.current === motion.target && motion.startedAt === 0) continue;
      const progress = animateDoorAngle(motion.from, motion.target, motion.startedAt, now);
      motion.current = progress;
      if (motion.mode === 'rotate') {
        if (motion.rotations) {
          motion.rotations.forEach(item => {
            item.pivot.rotation.y = item.closed + (item.open - item.closed)
              * ((progress - motion.closed) / (motion.open - motion.closed || 1));
          });
        } else {
          motion.pivot.rotation[motion.axis] = progress;
        }
      } else {
        motion.panels.forEach((panel, index) => {
          panel.position.lerpVectors(motion.closedPositions[index], motion.openPositions[index], progress);
          if (motion.mode === 'scale-slide' && motion.closedScales && motion.openScales) {
            panel.scale.lerpVectors(motion.closedScales[index], motion.openScales[index], progress);
          }
        });
      }
      if (progress === motion.target) motion.startedAt = 0;
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
        if (centre && !this.focusRoomId && !this.cameraTransition) this.controls.target.lerp(centre, 0.08);
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

  private targetAt(event: PointerEvent): PointerTarget | undefined {
    const bounds = this.gl.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const intersection of this.raycaster.intersectObjects(this.root.children, true)) {
      let hidden = false;
      for (let node: THREE.Object3D | null = intersection.object; node; node = node.parent) {
        if (!node.visible) { hidden = true; break; }
      }
      if (hidden) continue;
      let object: THREE.Object3D | null = intersection.object;
      while (object && object !== this.root) {
        const target = object.userData.interactionTarget;
        if (typeof target === 'string') return { id: target, room: false };
        const roomId = object.userData.roomId;
        if (typeof roomId === 'string') return { id: roomId, room: true };
        object = object.parent;
      }
    }
    return undefined;
  }

  private onPointerDown = (event: PointerEvent): void => {
    const target = this.targetAt(event);
    if (!target) return;
    this.pointerStart = { x: event.clientX, y: event.clientY, target, held: false };
    if (target.room) return;
    this.holdTimer = window.setTimeout(() => {
      if (!this.pointerStart) return;
      this.pointerStart.held = true;
      this.interactionHandler?.(this.pointerStart.target.id, true);
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
    const end = this.targetAt(event);
    if (!start.held && !moved && end?.id === start.target.id && end.room === start.target.room) {
      if (start.target.room) this.roomSelectionHandler?.(start.target.id);
      else this.interactionHandler?.(start.target.id, false);
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
    this.styleEdgeMaterials.forEach(material => this.gl.getDrawingBufferSize(material.resolution));
    if (this.roomBounds && this.siteBounds && !this.focusRoomId && !this.focusCameraViewId) {
      this.cameraTransition = undefined;
      this.updateOverviewCameras();
      const [position, target] = this.activeOverview();
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.enabled = true;
      this.controls.update();
    }
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
      if (object instanceof THREE.Sprite) {
        object.material.map?.dispose();
        object.material.dispose();
      } else if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
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
    this.animateDoors(performance.now());
    this.animateCamera(performance.now());
    this.objectsLayer.tick(Date.now());
    this.applyEffects();
    this.controls.update();
    if (this.cutawayEnabled) this.updateCutawayWalls();
    this.cameraCoordinatesHandler?.({
      position: [
        this.camera.position.x + this.offset.x,
        this.camera.position.y,
        this.camera.position.z + this.offset.z,
      ],
      target: [
        this.controls.target.x + this.offset.x,
        this.controls.target.y,
        this.controls.target.z + this.offset.z,
      ],
    });
    this.gl.render(this.scene, this.camera);
  };
}
