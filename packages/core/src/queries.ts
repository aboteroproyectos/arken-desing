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

/** Área de un polígono simple (fórmula del área de Gauss), siempre positiva. */
export function polygonArea(points: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Perímetro de un polígono cerrado. */
export function polygonPerimeter(points: readonly Vec2[]): number {
  let l = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    l += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return l;
}

/** Longitud de una polilínea abierta. */
export function polylineLength(points: readonly Vec2[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return l;
}

/** ¿Está el punto dentro del polígono? (regla par-impar) */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Centroide de un polígono (para colocar su etiqueta). */
export function polygonCentroid(points: readonly Vec2[]): Vec2 {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-12) {
    const n = points.length || 1;
    return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}
