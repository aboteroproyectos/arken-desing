// Consultas derivadas de solo lectura sobre el modelo.
// Nada de esto se guarda: siempre se calcula a partir de las entidades y relaciones.

import type { Indices } from "./indices";
import type { Entity, EntityKind, EntityOfKind, Id, Meters, Relation, Vec2, Wall } from "./model";

export interface ModelReader {
  getEntity(id: Id): Entity | undefined;
  getRelation(id: Id): Relation | undefined;
  entities(): IterableIterator<Entity>;
  relations(): IterableIterator<Relation>;
  readonly indices: Indices;
}

export function getOfKind<K extends EntityKind>(
  reader: ModelReader,
  id: Id | undefined,
  kind: K,
): EntityOfKind<K> | undefined {
  if (id === undefined) return undefined;
  const e = reader.getEntity(id);
  return e && e.kind === kind ? (e as EntityOfKind<K>) : undefined;
}

export function wallLength(wall: Wall): Meters {
  return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
}

export function wallDirection(wall: Wall): Vec2 {
  const len = wallLength(wall);
  if (len === 0) return { x: 1, y: 0 };
  return { x: (wall.end.x - wall.start.x) / len, y: (wall.end.y - wall.start.y) / len };
}

/** Espesor del muro = suma de las capas de su MaterialLayerSet (invariante 7). */
export function wallThickness(reader: ModelReader, wallId: Id): Meters {
  const set = getOfKind(reader, reader.indices.materialDefOf(wallId), "MaterialLayerSet");
  if (!set) return 0;
  return set.layers.reduce((sum, l) => sum + l.thickness, 0);
}
