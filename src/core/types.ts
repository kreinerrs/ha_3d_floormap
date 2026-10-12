export type Side='top'|'right'|'bottom'|'left';export type CType='door'|'window'|'open-passage';
export interface Connector{id:string;roomId:string;side:Side;type:CType;offset:number;width?:number;door?:{hinge?:'left'|'right';swing?:'inward'|'outward';openAngle?:number};window?:{type?:string;sillHeight?:number;headHeight?:number;frameDepth?:number}}
export interface Room{id:string;name:string;type:string;connectors:Connector[];layout:{x:number;y:number;width:number;height:number}}
export interface Visuals{wallThickness:number;wallHeight:number;floorThickness:number;doorHeight:number;defaultDoorWidth:number;windowSillHeight:number;windowHeadHeight:number;defaultWindowWidth:number;frameDepth:number;ambientIntensity:number;sunlightIntensity:number;shadows:boolean;matchingTolerance:number;maxPixelRatio:number}
export interface Floorplan{schemaVersion:string;id:string;name:string;buildingDefaults?:Partial<Visuals>;rooms:Room[];relationships:{id:string;connectorA:string;connectorB:string}[]}
export interface Config{floorplanUrl:string;mockStateUrl:string;effectsUrl:string;visuals:Visuals;camera:{allowRotation:boolean;allowZoom:boolean;allowPan:boolean}}
export interface Binding{ref:string;entityId:string;targetId:string;kind:'light'|'door-contact';placement?:{height?:number;offset?:[number,number,number]}}
export interface EntityState{entity_id:string;state:string;attributes:Record<string,unknown>}export interface MockDoc{bindings:Binding[];states:EntityState[]}
export interface StateProvider{getEntity(entityId:string):EntityState|undefined;getState(entityId:string):string|undefined}
export interface ActionProvider{toggle(entityId:string):Promise<void>;moreInfo(entityId:string):void}
export interface Opening{id:string;type:CType;lineKey:string;axis:'x'|'z';fixed:number;centre:number;width:number;connector:Connector}
