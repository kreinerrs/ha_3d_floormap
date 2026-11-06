import type{FloorplanObject,ObjectTypeDef}from'./objects';
export type Side='top'|'right'|'bottom'|'left';export type CType='door'|'window'|'open-passage';
export interface EnvironmentMeasure{name:string;attribute:string;unit?:string;precision?:number}
export interface Connector{id:string;roomId:string;side:Side;type:CType;offset:number;wallAt?:number;width?:number;doorType?:string;glazing?:'solid'|'glass';door?:{style?:'hinged'|'pocket-sliding'|'sliding'|'sliding-glass'|'double';hinge?:'left'|'right';swing?:'inward'|'outward';openAngle?:number;slide?:'start'|'end';slideDirection?:'start'|'end';visibleFraction?:number;tilt?:boolean;glass?:boolean};window?:{type?:'fixed'|'tilt'|'sliding'|'slide-horizontal'|'slide-vertical'|'hinged'|'tilt-turn';hinge?:'left'|'right';swing?:'inward'|'outward';openAngle?:number;slide?:'start'|'end';slideDirection?:'start'|'end';sillHeight?:number;headHeight?:number;frameDepth?:number}}
export interface Room{id:string;name:string;type:string;floor?:string;elevation?:number;wallHeight?:number;wallHeights?:Partial<Record<Side,number>>;outline?:[number,number][];connectors:Connector[];layout:{x:number;y:number;width:number;height:number}}
export interface FloorplanArea{id:string;name:string;kind:string;shape:'rect'|'ellipse';layout:{x:number;y:number;width:number;height:number};roofed?:boolean;elevation?:number;outline?:[number,number][];species?:string}
export interface Visuals{wallThickness:number;wallHeight:number;floorThickness:number;doorHeight:number;defaultDoorWidth:number;windowSillHeight:number;windowHeadHeight:number;defaultWindowWidth:number;frameDepth:number;ambientIntensity:number;sunlightIntensity:number;shadows:boolean;matchingTolerance:number;maxPixelRatio:number}
export type VisualStyle='standard'|'comic'|'futuristic';
export interface RoomStatusRange{max?:number;color:string}
export interface RoomStatusRule{roomId:string;entityId:string;attribute?:string;states?:Record<string,string>;ranges?:RoomStatusRange[]}
export interface CameraView{id:string;name:string;position:[number,number,number];target:[number,number,number]}
type EntityPlacementLocation={roomId:string;areaId?:never}|{areaId:string;roomId?:never};
type PositionedEntityPlacement=EntityPlacementLocation&{position:[number,number];height?:number};
export type EntityPlacement=
  | ({id:string;type:'light'}&PositionedEntityPlacement)
  | ({id:string;type:'water-leak'}&PositionedEntityPlacement)
  | {id:string;type:'door-contact'|'window-contact';connectorId:string;role?:'open'|'tilt'}
  | {id:string;type:'lock';connectorId:string;side?:'A'|'B'}
  | {id:string;type:'cover';connectorId:string}
  | ({id:string;type:'environment-sensor';label?:string;measures?:EnvironmentMeasure[]}&PositionedEntityPlacement)
  | ({id:string;type:'motion-sensor'|'presence-sensor';facingDegrees:number;fieldOfViewDegrees:number;range:number;detectionPositionAttribute?:string}&PositionedEntityPlacement);
export interface Floorplan{schemaVersion:string;id:string;name:string;northDegrees?:number;ground?:{polygon:[number,number][];color?:string};areas?:FloorplanArea[];celestial?:Partial<Record<'sun'|'moon',{position:[number,number]}>>;entitySettings?:{coordinates?:'floorplan'|'room'};buildingDefaults?:Partial<Visuals>;floors?:{id:string;name?:string;height?:number;elevation?:number}[];stairs?:{id:string;lower?:string;upper?:string;x:number;y:number;length:number;width:number;direction?:'right'|'left'|'up'|'down';steps?:number}[];objects?:FloorplanObject[];objectTypes?:ObjectTypeDef[];wallAlignments?:{id:string}[];joints?:{relationshipId:string}[];rooms:Room[];relationships:{id:string;connectorA:string;connectorB:string}[];entityPlacements?:EntityPlacement[]}
export interface Config{floorplanUrl:string;mockStateUrl:string;effectsUrl:string;visuals:Visuals;style:VisualStyle;lineThickness:number;camera:{allowRotation:boolean;allowZoom:boolean;allowPan:boolean}}
export type BindingKind='light'|'water-leak'|'door-contact'|'lock'|'cover'|'environment-sensor'|'motion-sensor'|'presence-sensor';
export interface Binding{ref:string;entityId:string;targetId?:string;kind:BindingKind;mode?:'tilt'|'open';display?:'value'|'label-value';label?:string;precision?:number;placement?:{height?:number;offset?:[number,number,number]}}
export interface CelestialBodyConfig{entityId:string;position:[number,number];radius:number}
export interface CelestialConfig{sun?:CelestialBodyConfig;moon?:CelestialBodyConfig}
export interface CelestialConfigOverride{sun?:Omit<CelestialBodyConfig,'position'>&{position?:[number,number]};moon?:Omit<CelestialBodyConfig,'position'>&{position?:[number,number]}}
export interface EntityState{entity_id:string;state:string;attributes:Record<string,unknown>}export interface MockDoc{bindings:Array<Binding&{targetId:string}>;states:EntityState[]}
export interface StateProvider{getEntity(entityId:string):EntityState|undefined;getState(entityId:string):string|undefined}
export interface ActionProvider{toggle(entityId:string):Promise<void>;moreInfo(entityId:string):void}
export interface Opening{id:string;type:CType;lineKey:string;axis:'x'|'z';fixed:number;centre:number;width:number;connector:Connector}
