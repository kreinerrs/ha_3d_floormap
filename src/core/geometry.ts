import type{Connector,Floorplan,Opening,Room,Visuals}from'./types';import{connectorPoint,pointInRoom,roomEdges,roomPolygon}from'./outline';export interface WallLine{key:string;axis:'x'|'z';fixed:number;start:number;end:number}
export interface FloorplanBounds{minX:number;maxX:number;minY:number;maxY:number}
export function floorplanBounds(floorplan:Floorplan,includeAreas:boolean):FloorplanBounds {
 const rooms=floorplan.rooms.filter(room=>room.id!=='outside');
 const layouts=[...rooms.map(room=>room.layout),...(includeAreas?floorplan.areas??[]:[]).map(area=>area.layout)];
 if(!layouts.length)throw new Error('Floorplan needs at least one room to calculate its bounds');
 return{
  minX:Math.min(...layouts.map(layout=>layout.x)),
  maxX:Math.max(...layouts.map(layout=>layout.x+layout.width)),
  minY:Math.min(...layouts.map(layout=>layout.y)),
  maxY:Math.max(...layouts.map(layout=>layout.y+layout.height)),
 };
}
function roomContainsPoint(floorplan:Floorplan,x:number,z:number):boolean {
 return floorplan.rooms.some(room=>room.id!=='outside'&&pointInRoom(room,x,z));
}
export interface WallSegmentPart {
 start:number;
 end:number;
 beforeOccupied:boolean;
 afterOccupied:boolean;
}
export function classifyWallSegment(floorplan:Floorplan,axis:'x'|'z',fixed:number,start:number,end:number):WallSegmentPart[] {
 const cuts=new Set([start,end]);
 for(const room of floorplan.rooms){
  if(room.id==='outside')continue;
  for(const corner of roomPolygon(room)){
   const value=axis==='x'?corner[0]:corner[1];
   if(value>start&&value<end)cuts.add(value);
  }
 }
 const points=[...cuts].sort((a,b)=>a-b);
 const epsilon=0.02;
 const parts:WallSegmentPart[]=[];
 for(let index=0;index<points.length-1;index++){
  const partStart=points[index];
  const partEnd=points[index+1];
  if(partEnd-partStart<0.001)continue;
  const along=(partStart+partEnd)/2;
  parts.push({
   start:partStart,
   end:partEnd,
   beforeOccupied:axis==='x'
    ?roomContainsPoint(floorplan,along,fixed-epsilon)
    :roomContainsPoint(floorplan,fixed-epsilon,along),
   afterOccupied:axis==='x'
    ?roomContainsPoint(floorplan,along,fixed+epsilon)
    :roomContainsPoint(floorplan,fixed+epsilon,along),
  });
 }
 return parts;
}
export function wallSegmentOpaqueFromCameraSide(
 part:Pick<WallSegmentPart,'beforeOccupied'|'afterOccupied'>,
 axis:'x'|'z',
 fixed:number,
 cameraX:number,
 cameraZ:number,
):boolean {
 const cameraBefore=axis==='x'?cameraZ<fixed:cameraX<fixed;
 const cameraOccupied=cameraBefore?part.beforeOccupied:part.afterOccupied;
 const oppositeOccupied=cameraBefore?part.afterOccupied:part.beforeOccupied;
 return cameraOccupied&&!oppositeOccupied;
}
export function point(r:Room,c:Connector){return connectorPoint(r,c)}
export function resolveOpenings(f: Floorplan, visuals: Visuals): Opening[] {
  const rooms = new Map(f.rooms.map(room => [room.id, room]));
  const connectors = new Map(f.rooms.flatMap(room => room.connectors.map(connector => [connector.id, connector] as const)));
  const links = new Map<string, string>();
  const openingMetadata = new Map<string, Connector>();
  f.relationships.forEach(relationship => {
    links.set(relationship.connectorA, relationship.connectorB);
    links.set(relationship.connectorB, relationship.connectorA);
    const connectorA = connectors.get(relationship.connectorA);
    const connectorB = connectors.get(relationship.connectorB);
    const configured = connectorA?.door || connectorA?.window
      ? connectorA
      : connectorB?.door || connectorB?.window ? connectorB : undefined;
    if (configured) {
      openingMetadata.set(relationship.connectorA, configured);
      openingMetadata.set(relationship.connectorB, configured);
    }
  });

  const used = new Set<string>();
  const openings: Opening[] = [];
  for (const room of f.rooms) {
    for (const connector of room.connectors) {
      if (used.has(connector.id)) continue;
      const pairedConnector = connectors.get(links.get(connector.id) ?? '');
      const pairedRoom = pairedConnector ? rooms.get(pairedConnector.roomId) : undefined;
      const position = point(room, connector);
      const pairedPosition = pairedConnector && pairedRoom ? point(pairedRoom, pairedConnector) : undefined;
      const tolerance = Math.max(visuals.matchingTolerance, visuals.wallThickness);
      const matched = !!pairedConnector && pairedConnector.type === connector.type
        && !!pairedPosition
        && Math.hypot(position.x - pairedPosition.x, position.z - pairedPosition.z) <= tolerance;

      used.add(connector.id);
      if (matched && pairedConnector) used.add(pairedConnector.id);

      const axis = connector.side === 'top' || connector.side === 'bottom' ? 'x' : 'z';
      const fixed = axis === 'x' ? position.z : position.x;
      const centre = axis === 'x' ? position.x : position.z;
      openings.push({
        id: matched && pairedConnector ? [connector.id, pairedConnector.id].sort().join('--') : connector.id,
        type: connector.type,
        lineKey: `${axis}:${fixed.toFixed(3)}`,
        axis,
        fixed,
        centre,
        width: connector.width ?? pairedConnector?.width
          ?? (connector.type === 'window' ? visuals.defaultWindowWidth : visuals.defaultDoorWidth),
        connector: {
          ...connector,
          door: openingMetadata.get(connector.id)?.door ?? connector.door,
          window: openingMetadata.get(connector.id)?.window ?? connector.window,
        },
      });
    }
  }
  return openings;
}
export function wallLines(f:Floorplan){const raw:WallLine[]=[];for(const r of f.rooms.filter(x=>x.id!=='outside')){for(const e of roomEdges(r))raw.push({key:`${e.axis}:${e.fixed.toFixed(3)}`,axis:e.axis,fixed:e.fixed,start:e.start,end:e.end})}const g=new Map<string,WallLine[]>();raw.forEach(x=>g.set(x.key,[...(g.get(x.key)??[]),x]));const out:WallLine[]=[];for(const a of g.values()){a.sort((x,y)=>x.start-y.start);let c={...a[0]};for(const n of a.slice(1)){if(n.start<=c.end+.001)c.end=Math.max(c.end,n.end);else{out.push(c);c={...n}}}out.push(c)}return out}
export function splitLine(w:WallLine,ops:Opening[]){const cuts=ops.filter(o=>o.lineKey===w.key&&o.centre>=w.start&&o.centre<=w.end).map(o=>({a:Math.max(w.start,o.centre-o.width/2),b:Math.min(w.end,o.centre+o.width/2),o})).sort((a,b)=>a.a-b.a);const segments:{a:number;b:number}[]=[];let cur=w.start;for(const c of cuts){if(c.a>cur)segments.push({a:cur,b:c.a});cur=Math.max(cur,c.b)}if(cur<w.end)segments.push({a:cur,b:w.end});return{segments,cuts}}
export function junctionPoints(lines:WallLine[]){const m=new Map<string,{x:number;z:number}>(),add=(x:number,z:number)=>m.set(`${x.toFixed(3)}:${z.toFixed(3)}`,{x,z});for(const l of lines)l.axis==='x'?(add(l.start,l.fixed),add(l.end,l.fixed)):(add(l.fixed,l.start),add(l.fixed,l.end));for(const a of lines.filter(x=>x.axis==='x'))for(const b of lines.filter(x=>x.axis==='z'))if(b.fixed>=a.start-.001&&b.fixed<=a.end+.001&&a.fixed>=b.start-.001&&a.fixed<=b.end+.001)add(b.fixed,a.fixed);return[...m.values()]}
