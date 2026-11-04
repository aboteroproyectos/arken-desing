// Uniones entre muros (Paso 3, §5): detección y mantenimiento de RelConnectsWalls.
//
// Las uniones son relaciones explícitas del modelo (no geometría), pero se detectan solas:
// cada comando que crea o mueve muros llama a reconnectWalls() dentro de su transacción,
// así que deshacer/rehacer las restaura sin código extra.
//
//   L: el extremo de un muro coincide con el extremo de otro   → endB = "start" | "end"
//   T: el extremo de un muro cae sobre el eje de otro (a mitad) → endB = "middle"

import type { Id, Meters, RelConnectsWalls, Vec2, Wall } from "./model";
import { getOfKind, wallLength, type ModelReader } from "./queries";
import { newId, type Transaction } from "./store";

/** Distancia máxima para considerar que dos puntos se tocan. Generosa frente a TOLERANCE porque viene del dibujo. */
export const JOIN_TOLERANCE: Meters = 1e-3;

type End = "start" | "end";
const ENDS: readonly End[] = ["start", "end"];

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Posición u de un punto proyectado sobre el eje del muro y su distancia al eje. */
function projectOnAxis(w: Wall, p: Vec2): { u: Meters; d: Meters } {
  const len = wallLength(w);
  const ux = (w.end.x - w.start.x) / len;
  const uy = (w.end.y - w.start.y) / len;
  const dx = p.x - w.start.x;
  const dy = p.y - w.start.y;
  return { u: dx * ux + dy * uy, d: Math.abs(dx * uy - dy * ux) };
}

export interface DetectedJoin {
  readonly wallA: Id;
  readonly endA: End;
  readonly wallB: Id;
  readonly endB: End | "middle";
}

/** Uniones en las que participa `wall` con los demás muros de la lista. */
export function detectJoins(wall: Wall, others: readonly Wall[], tol: Meters = JOIN_TOLERANCE): DetectedJoin[] {
  const out: DetectedJoin[] = [];
  if (wallLength(wall) <= tol) return out;
  for (const o of others) {
    if (o.id === wall.id || wallLength(o) <= tol) continue;
    // Extremos de `wall` contra `o`: L con sus extremos, o T sobre su eje.
    for (const e of ENDS) {
      const p = wall[e];
      const l = ENDS.find((oe) => dist(p, o[oe]) <= tol);
      if (l) {
        out.push({ wallA: wall.id, endA: e, wallB: o.id, endB: l });
        continue;
      }
      const { u, d } = projectOnAxis(o, p);
      if (d <= tol && u > tol && u < wallLength(o) - tol) out.push({ wallA: wall.id, endA: e, wallB: o.id, endB: "middle" });
    }
    // Extremos de `o` que caen a mitad del eje de `wall`: T donde `wall` es la barra.
    for (const oe of ENDS) {
      const p = o[oe];
      if (ENDS.some((e) => dist(p, wall[e]) <= tol)) continue; // ya contada como L
      const { u, d } = projectOnAxis(wall, p);
      if (d <= tol && u > tol && u < wallLength(wall) - tol) out.push({ wallA: o.id, endA: oe, wallB: wall.id, endB: "middle" });
    }
  }
  return out;
}

const joinKey = (j: { wallA: Id; endA: string; wallB: Id; endB: string }) => {
  // Una L es simétrica: A.end–B.start es la misma unión que B.start–A.end.
  if (j.endB !== "middle" && j.wallB < j.wallA) return `${j.wallB}:${j.endB}|${j.wallA}:${j.endA}`;
  return `${j.wallA}:${j.endA}|${j.wallB}:${j.endB}`;
};

function wallsOfSameLevel(reader: ModelReader, wallId: Id): Wall[] {
  const levelId = reader.indices.levelOfElement(wallId);
  if (!levelId) return [];
  const out: Wall[] = [];
  for (const id of reader.indices.elementsOfLevel(levelId)) {
    const w = getOfKind(reader, id, "Wall");
    if (w) out.push(w);
  }
  return out;
}

/**
 * Recalcula las uniones de los muros indicados: borra las que ya no se cumplen y crea las nuevas.
 * Las que siguen igual se conservan (mismo id), para no generar cambios innecesarios.
 *
 * Nota de rendimiento: compara con todos los muros del nivel (O(n) por muro). Suficiente por ahora;
 * cuando haga falta, se cambiará por una consulta al índice espacial.
 */
export function reconnectWalls(tx: Transaction, wallIds: Iterable<Id>): void {
  const wanted = new Map<string, DetectedJoin>();
  const affected = new Set<Id>();
  for (const id of wallIds) {
    const w = getOfKind(tx, id, "Wall");
    if (!w) continue;
    affected.add(id);
    for (const j of detectJoins(w, wallsOfSameLevel(tx, id))) wanted.set(joinKey(j), j);
  }

  const existing = new Map<string, RelConnectsWalls>();
  for (const id of affected) {
    for (const relId of tx.indices.relationsOf(id)) {
      const r = tx.getRelation(relId);
      if (r?.kind === "RelConnectsWalls") existing.set(joinKey(r), r);
    }
  }

  for (const [key, rel] of existing) if (!wanted.has(key)) tx.apply({ type: "deleteRelation", id: rel.id });
  for (const [key, j] of wanted) {
    if (existing.has(key)) continue;
    tx.apply({ type: "putRelation", relation: { id: newId(), kind: "RelConnectsWalls", ...j } });
  }
}
