// Indexación espacial y selección (Paso 4, versión mínima).
//  - Un R-Tree por nivel con las cajas de planta, y otro con los puntos de snap.
//  - Clic en dos fases: fase gruesa en el R-Tree, prueba exacta sobre las primitivas.
//  - Selección por rectángulo (ventana / captura) y snapping con prioridades.

import RBush from "rbush";
import type { Id, Vec2 } from "@arken/core";
import { arcPoints, type AABB2, type ElementPlanGeometry, type GeometryUpdate, type PlanPrimitive } from "@arken/geometry";

// ─── Índice genérico ────────────────────────────────────────

interface Item extends AABB2 {
  readonly id: Id;
}

/** R-Tree con upsert por id. La implementación (rbush) se puede cambiar sin tocar el resto. */
export class SpatialIndex2D {
  private readonly tree = new RBush<Item>(16);
  private readonly items = new Map<Id, Item[]>();

  load(entries: { id: Id; boxes: AABB2[] }[]): void {
    this.clear();
    const all: Item[] = [];
    for (const { id, boxes } of entries) {
      const its = boxes.map((b) => ({ ...b, id }));
      this.items.set(id, its);
      all.push(...its);
    }
    this.tree.load(all); // carga masiva (STR)
  }

  /** Quita las cajas viejas del id e inserta las nuevas. Un id puede tener varias (p. ej. puntos de snap). */
  upsert(id: Id, boxes: AABB2[]): void {
    this.remove(id);
    const its = boxes.map((b) => ({ ...b, id }));
    this.items.set(id, its);
    for (const it of its) this.tree.insert(it);
  }

  remove(id: Id): void {
    const its = this.items.get(id);
    if (!its) return;
    for (const it of its) this.tree.remove(it);
    this.items.delete(id);
  }

  search(area: AABB2): Id[] {
    return [...new Set(this.tree.search(area).map((i) => i.id))];
  }

  clear(): void {
    this.tree.clear();
    this.items.clear();
  }

  get size(): number {
    return this.items.size;
  }

  /** Solo para tests: ids y cajas en forma canónica. */
  dump(): string {
    return JSON.stringify([...this.items.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }
}

// ─── Geometría exacta (fase fina) ───────────────────────────

const pointBox = (p: Vec2): AABB2 => ({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y });

export function distPointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToPolyline(p: Vec2, pts: readonly Vec2[], closed: boolean): number {
  let d = Infinity;
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) d = Math.min(d, distPointSegment(p, pts[i]!, pts[i + 1]!));
  if (closed && n > 2) d = Math.min(d, distPointSegment(p, pts[n - 1]!, pts[0]!));
  return d;
}

function angleInArc(a: number, start: number, end: number): boolean {
  const tau = 2 * Math.PI;
  const norm = (x: number) => ((x % tau) + tau) % tau;
  return norm(a - start) <= norm(end - start);
}

/** Distancia exacta de un punto a una primitiva de planta (0 si está dentro de un polígono). */
export function distanceToPrimitive(p: Vec2, prim: PlanPrimitive): number {
  switch (prim.kind) {
    case "polygon":
      return pointInPolygon(p, prim.points) ? 0 : distToPolyline(p, prim.points, true);
    case "polyline":
      return distToPolyline(p, prim.points, false);
    case "arc": {
      const ang = Math.atan2(p.y - prim.center.y, p.x - prim.center.x);
      if (angleInArc(ang, prim.startAngle, prim.endAngle)) {
        return Math.abs(Math.hypot(p.x - prim.center.x, p.y - prim.center.y) - prim.radius);
      }
      const pts = arcPoints(prim, 1);
      return Math.min(Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y), Math.hypot(p.x - pts[1]!.x, p.y - pts[1]!.y));
    }
  }
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (o: Vec2, p: Vec2, q: Vec2) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

const inBox = (p: Vec2, r: AABB2) => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
const boxContains = (outer: AABB2, inner: AABB2) =>
  inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;

/** ¿La primitiva toca el rectángulo? (fase fina de la selección por captura) */
export function primitiveTouchesRect(prim: PlanPrimitive, r: AABB2): boolean {
  const pts = prim.kind === "arc" ? arcPoints(prim) : prim.points;
  if (pts.some((p) => inBox(p, r))) return true;
  const corners: Vec2[] = [
    { x: r.minX, y: r.minY },
    { x: r.maxX, y: r.minY },
    { x: r.maxX, y: r.maxY },
    { x: r.minX, y: r.maxY },
  ];
  if (prim.kind === "polygon" && corners.some((c) => pointInPolygon(c, prim.points))) return true;
  const closed = prim.kind === "polygon";
  const segs = pts.length - (closed ? 0 : 1);
  for (let i = 0; i < segs; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    for (let k = 0; k < 4; k++) if (segmentsIntersect(a, b, corners[k]!, corners[(k + 1) % 4]!)) return true;
  }
  return false;
}

// ─── Índices por nivel ──────────────────────────────────────

interface LevelIndices {
  readonly plan: SpatialIndex2D;
  readonly snap: SpatialIndex2D;
}

export interface PickHit {
  readonly elementId: Id;
  readonly distance: number;
  readonly isHosted: boolean;
  readonly area: number;
}

export type SnapKind = "endpoint" | "midpoint" | "onAxis" | "grid";

export interface SnapResult {
  readonly point: Vec2;
  readonly kind: SnapKind;
  readonly sourceIds: readonly Id[];
}

const SNAP_PRIORITY: Record<SnapKind, number> = { endpoint: 0, midpoint: 1, onAxis: 2, grid: 3 };

/**
 * Mantiene los R-Trees al día a partir de las actualizaciones del motor de geometría
 * y responde a clic, rectángulo y snap.
 */
export class SpatialIndexManager {
  private readonly levels = new Map<Id, LevelIndices>();
  private readonly geometry = new Map<Id, ElementPlanGeometry>();

  private forLevel(levelId: Id): LevelIndices {
    let l = this.levels.get(levelId);
    if (!l) this.levels.set(levelId, (l = { plan: new SpatialIndex2D(), snap: new SpatialIndex2D() }));
    return l;
  }

  rebuildAll(geoms: Iterable<ElementPlanGeometry>): void {
    this.levels.clear();
    this.geometry.clear();
    const byLevel = new Map<Id, ElementPlanGeometry[]>();
    for (const g of geoms) {
      this.geometry.set(g.elementId, g);
      let arr = byLevel.get(g.levelId);
      if (!arr) byLevel.set(g.levelId, (arr = []));
      arr.push(g);
    }
    for (const [levelId, arr] of byLevel) {
      const l = this.forLevel(levelId);
      l.plan.load(arr.map((g) => ({ id: g.elementId, boxes: [g.box] })));
      l.snap.load(arr.map((g) => ({ id: g.elementId, boxes: g.snapPoints.map((s) => pointBox(s.point)) })));
    }
  }

  applyGeometryUpdate(u: GeometryUpdate): void {
    for (const id of u.removed) this.removeElement(id);
    for (const g of u.updated) {
      const prev = this.geometry.get(g.elementId);
      if (prev && prev.levelId !== g.levelId) this.removeElement(g.elementId);
      this.geometry.set(g.elementId, g);
      const l = this.forLevel(g.levelId);
      l.plan.upsert(g.elementId, [g.box]);
      l.snap.upsert(g.elementId, g.snapPoints.map((s) => pointBox(s.point)));
    }
  }

  private removeElement(id: Id): void {
    const prev = this.geometry.get(id);
    if (!prev) return;
    const l = this.levels.get(prev.levelId);
    l?.plan.remove(id);
    l?.snap.remove(id);
    this.geometry.delete(id);
  }

  /** Clic en dos fases. Devuelve los aciertos ordenados por la regla de desempate (Paso 4, §5). */
  pick(levelId: Id, p: Vec2, tolerance: number, exclude?: ReadonlySet<Id>): PickHit[] {
    const l = this.levels.get(levelId);
    if (!l) return [];
    // Fase gruesa: cajas que tocan un cuadrado alrededor del cursor.
    const candidates = l.plan.search({ minX: p.x - tolerance, minY: p.y - tolerance, maxX: p.x + tolerance, maxY: p.y + tolerance });
    // Fase fina: distancia exacta a las primitivas.
    const hits: PickHit[] = [];
    for (const id of candidates) {
      if (exclude?.has(id)) continue;
      const g = this.geometry.get(id);
      if (!g) continue;
      let d = Infinity;
      for (const prim of g.primitives) d = Math.min(d, distanceToPrimitive(p, prim));
      if (d <= tolerance) {
        const b = g.box;
        hits.push({ elementId: id, distance: d, isHosted: g.kind !== "Wall", area: (b.maxX - b.minX) * (b.maxY - b.minY) });
      }
    }
    // Desempate: alojados antes que su anfitrión, luego más cerca, luego más pequeño.
    return hits.sort((a, b) => Number(b.isHosted) - Number(a.isHosted) || a.distance - b.distance || a.area - b.area);
  }

  /** Ventana (de izquierda a derecha): totalmente dentro. Captura (de derecha a izquierda): lo que toca. */
  boxSelect(levelId: Id, r: AABB2, mode: "window" | "crossing"): Id[] {
    const l = this.levels.get(levelId);
    if (!l) return [];
    const out: Id[] = [];
    for (const id of l.plan.search(r)) {
      const g = this.geometry.get(id);
      if (!g) continue;
      if (mode === "window" ? boxContains(r, g.box) : g.primitives.some((prim) => primitiveTouchesRect(prim, r))) out.push(id);
    }
    return out;
  }

  /** Snap con prioridades: extremo > punto medio > sobre el eje > rejilla. */
  snap(levelId: Id, p: Vec2, tolerance: number, opts: { exclude?: ReadonlySet<Id>; grid?: number } = {}): SnapResult | undefined {
    const l = this.levels.get(levelId);
    const area = { minX: p.x - tolerance, minY: p.y - tolerance, maxX: p.x + tolerance, maxY: p.y + tolerance };
    const found: (SnapResult & { d: number })[] = [];
    if (l) {
      for (const id of l.snap.search(area)) {
        if (opts.exclude?.has(id)) continue;
        for (const s of this.geometry.get(id)?.snapPoints ?? []) {
          const d = Math.hypot(s.point.x - p.x, s.point.y - p.y);
          if (d <= tolerance) found.push({ point: s.point, kind: s.kind, sourceIds: [id], d });
        }
      }
      for (const id of l.plan.search(area)) {
        if (opts.exclude?.has(id)) continue;
        const axis = this.geometry.get(id)?.axis;
        if (!axis) continue;
        const q = closestPointOnSegment(p, axis[0], axis[1]);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d <= tolerance) found.push({ point: q, kind: "onAxis", sourceIds: [id], d });
      }
    }
    found.sort((a, b) => SNAP_PRIORITY[a.kind] - SNAP_PRIORITY[b.kind] || a.d - b.d);
    const best = found[0];
    if (best) return { point: best.point, kind: best.kind, sourceIds: best.sourceIds };
    if (opts.grid && opts.grid > 0) {
      const g = opts.grid;
      return { point: { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g }, kind: "grid", sourceIds: [] };
    }
    return undefined;
  }

  /** Solo para tests: estado canónico de los índices de un nivel. */
  debugDump(levelId: Id): string {
    const l = this.levels.get(levelId);
    return l ? l.plan.dump() + "|" + l.snap.dump() : "";
  }
}
