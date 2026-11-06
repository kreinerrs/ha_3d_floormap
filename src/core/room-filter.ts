import type { Floorplan } from './types';

/**
 * Restricts a floorplan to a selection of rooms. Site areas, stairs and objects are dropped,
 * and only relationships, joints and entity placements that belong to the kept rooms remain.
 * @param floorplan The full floorplan.
 * @param roomIds IDs of the rooms to keep.
 * @returns A new floorplan containing only the selected rooms.
 */
export function filterFloorplanRooms(floorplan: Floorplan, roomIds: readonly string[]): Floorplan {
  const keep = new Set(roomIds);
  const rooms = floorplan.rooms.filter(room => keep.has(room.id));
  const connectorIds = new Set(rooms.flatMap(room => room.connectors.map(connector => connector.id)));
  const relationships = floorplan.relationships.filter(
    item => connectorIds.has(item.connectorA) && connectorIds.has(item.connectorB),
  );
  const relationshipIds = new Set(relationships.map(item => item.id));
  const floorIds = new Set(rooms.map(room => room.floor).filter((id): id is string => id !== undefined));
  const { ground: _ground, areas: _areas, stairs: _stairs, objects: _objects, ...rest } = floorplan;
  return {
    ...rest,
    floors: floorplan.floors?.filter(floor => floorIds.has(floor.id)),
    rooms,
    relationships,
    joints: floorplan.joints?.filter(joint => relationshipIds.has(joint.relationshipId)),
    entityPlacements: floorplan.entityPlacements?.filter(placement => 'connectorId' in placement
      ? connectorIds.has(placement.connectorId)
      : placement.roomId !== undefined && keep.has(placement.roomId)),
  };
}
