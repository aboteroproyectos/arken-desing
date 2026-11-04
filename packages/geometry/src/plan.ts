// Motor de geometría de PLANTA (Paso 3, versión mínima).
//
// Todo se calcula en el marco local del muro (u a lo largo del eje, n normal en planta) y se
// pasa a coordenadas del nivel al final. La planta se genera desde los parámetros, no cortando
// un 3D. Las uniones en L (inglete) y en T (tope) recortan los extremos de los muros.
// Pendiente para más adelante: la representación 3D (Body).

import {
  TOLERANCE,
  getOfKind,
  wallDirection,
  wallLength,
  type Door,
  type Id,
  type Meters,
  type ModelReader,
  type Opening,
  type Vec2,
  type Wall,
  type Window,
} from "@arken/core";

// ─── Tipos de salida ────────────────────────────────────────

/** Estilo semántico; la vista decide colores, grosores y tramas. */
export type StyleKey = string; // "capa:<materialId>", "muro:contorno", "simbolo:puerta", "oculto"...

export type PlanPrimitive =
  | { readonly kind: "polygon"; readonly points: readonly Vec2[]; readonly style: StyleKey }
  | { readonly kind: "polyline"; readonly points: readonly Vec2[]; readonly style: StyleKey }
  | {
      readonly kind: "arc";
      readonly center: Vec2;
      readonly radius: Meters;
      /** Ángulos en radianes; el arco va en sentido antihorario de start a end. */
      readonly startAngle: number;
      readonly endAngle: number;
      readonly style: StyleKey;
    };

export interface AABB2 {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface SnapPoint {
  readonly point: Vec2;
  readonly kind: "endpoint" | "midpoint";
}

export interface ElementPlanGeometry {
  readonly elementId: Id;
  readonly kind: "Wall" | "Door" | "Window";
  readonly levelId: Id;
  readonly primitives: readonly PlanPrimitive[];
  readonly box: AABB2;
  /** Eje del muro (para snap "sobre el eje"). */
  readonly axis?: readonly [Vec2, Vec2];
  readonly snapPoints: readonly SnapPoint[];
}

export interface PlanOptions {
  /** Altura del plano de corte sobre la base del muro. Típico: 1.2 m. */
  readonly cutHeight: Meters;
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = { cutHeight: 1.2 };

// ─── Marco local del muro ───────────────────────────────────

export interface WallFrame {
  readonly origin: Vec2;
  readonly u: Vec2;
  readonly n: Vec2;
  readonly length: Meters;
  readonly height: Meters;
  readonly thickness: Meters;
  readonly faceExt: Meters; // posición n de la cara exterior
  readonly faceInt: Meters; // posición n de la cara interior
  /** Franjas de capa de exterior a interior: nTop > nBottom. */
  readonly layers: readonly { readonly materialId: Id; readonly nTop: Meters; readonly nBottom: Meters }[];
}

export function buildWallFrame(reader: ModelReader, wall: Wall): WallFrame {
  const u = wallDirection(wall);
  const n = { x: -u.y, y: u.x }; // u girado 90° a la izquierda: lado "exterior"
  const set = getOfKind(reader, reader.indices.materialDefOf(wall.id), "MaterialLayerSet");
  const layers = set?.layers ?? [];
  const thickness = layers.reduce((s, l) => s + l.thickness, 0);
  const faceExt = wall.justification === "center" ? thickness / 2 : wall.justification === "exterior" ? 0 : thickness;
  let top = faceExt;
  const bands = layers.map((l) => {
    const band = { materialId: l.materialId, nTop: top, nBottom: top - l.thickness };
    top -= l.thickness;
    return band;
  });
  return {
    origin: wall.start,
    u,
    n,
    length: wallLength(wall),
    height: wall.height,
    thickness,
    faceExt,
    faceInt: faceExt - thickness,
    layers: bands,
  };
}

/** De coordenadas locales (u, n) a coordenadas del nivel. */
export function toWorld(f: WallFrame, u: Meters, n: Meters): Vec2 {
  return { x: f.origin.x + f.u.x * u + f.n.x * n, y: f.origin.y + f.u.y * u + f.n.y * n };
}

/** De coordenadas del nivel a locales del muro: { u, n }. */
export function toLocal(f: WallFrame, p: Vec2): { u: Meters; n: Meters } {
  const dx = p.x - f.origin.x;
  const dy = p.y - f.origin.y;
  return { u: dx * f.u.x + dy * f.u.y, n: dx * f.n.x + dy * f.n.y };
}

// ─── Uniones: recorte de los extremos del muro ─────────────

/**
 * Corte de un extremo del muro: dónde termina cada cara, en coordenada u.
 * Sin unión, el corte es perpendicular: uExt = uInt = 0 (inicio) o = longitud (fin).
 */
export interface EndCut {
  readonly uExt: Meters;
  readonly uInt: Meters;
}

const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

/** u en el que la cara n del muro corta la recta (c, dir). undefined si son paralelas. */
function faceHitsLine(f: WallFrame, n: Meters, c: Vec2, dir: Vec2): Meters | undefined {
  const den = cross(f.u, dir);
  if (Math.abs(den) < 1e-12) return undefined;
  return cross(sub(c, toWorld(f, 0, n)), dir) / den;
}

function faceIntersection(f: WallFrame, nf: Meters, g: WallFrame, ng: Meters): Vec2 | undefined {
  const u = faceHitsLine(f, nf, toWorld(g, 0, ng), g.u);
  return u === undefined ? undefined : toWorld(f, u, nf);
}

/** Por debajo de este ángulo, dos muros se consideran en línea y se cortan en recto. */
const MIN_JOIN_SIN = Math.sin((5 * Math.PI) / 180);

/** Inglete en L: la recta de corte es la diagonal del paralelogramo de caras que separa los dos muros. */
function miterLine(f: WallFrame, g: WallFrame): [Vec2, Vec2] | undefined {
  if (Math.abs(cross(f.u, g.u)) < MIN_JOIN_SIN) return undefined;
  const a = toWorld(f, f.length / 2, 0); // un punto de cada muro, lejos de la unión
  const b = toWorld(g, g.length / 2, 0);
  const candidates: [Vec2 | undefined, Vec2 | undefined][] = [
    [faceIntersection(f, f.faceExt, g, g.faceExt), faceIntersection(f, f.faceInt, g, g.faceInt)],
    [faceIntersection(f, f.faceExt, g, g.faceInt), faceIntersection(f, f.faceInt, g, g.faceExt)],
  ];
  for (const [p, q] of candidates) {
    if (!p || !q) continue;
    const d = sub(q, p);
    if (Math.hypot(d.x, d.y) < 1e-9) continue;
    if (cross(d, sub(a, p)) * cross(d, sub(b, p)) < 0) return [p, q];
  }
  return undefined;
}

export function wallEndCuts(reader: ModelReader, wall: Wall, f: WallFrame): { start: EndCut; end: EndCut } {
  const cuts: { start: EndCut; end: EndCut } = {
    start: { uExt: 0, uInt: 0 },
    end: { uExt: f.length, uInt: f.length },
  };
  const done = new Set<"start" | "end">();
  for (const relId of reader.indices.relationsOf(wall.id)) {
    const r = reader.getRelation(relId);
    if (r?.kind !== "RelConnectsWalls") continue;

    let myEnd: "start" | "end";
    let otherId: Id;
    let kind: "L" | "T";
    if (r.wallA === wall.id) {
      myEnd = r.endA;
      otherId = r.wallB;
      kind = r.endB === "middle" ? "T" : "L";
    } else if (r.endB !== "middle") {
      myEnd = r.endB;
      otherId = r.wallA;
      kind = "L";
    } else continue; // soy la barra de una T: no me recorto
    if (done.has(myEnd)) continue; // de momento, una unión por extremo

    const other = getOfKind(reader, otherId, "Wall");
    if (!other) continue;
    const g = buildWallFrame(reader, other);
    if (g.thickness <= TOLERANCE) continue;

    let line: [Vec2, Vec2] | undefined;
    if (kind === "L") {
      line = miterLine(f, g);
    } else {
      // Tope en T: el muro llega hasta la cara de la barra que mira hacia él.
      const side = toLocal(g, toWorld(f, f.length / 2, 0)).n;
      const n = side >= 0 ? g.faceExt : g.faceInt;
      line = [toWorld(g, 0, n), toWorld(g, 1, n)];
    }
    if (!line) continue;
    const dir = sub(line[1], line[0]);
    const uExt = faceHitsLine(f, f.faceExt, line[0], dir);
    const uInt = faceHitsLine(f, f.faceInt, line[0], dir);
    if (uExt === undefined || uInt === undefined) continue;

    // Límite de seguridad: un ángulo muy cerrado no puede estirar el muro sin fin ni cruzar el otro extremo.
    const reach = 4 * (f.thickness + g.thickness);
    const clamp = (u: number) =>
      myEnd === "start" ? Math.min(Math.max(u, -reach), f.length - TOLERANCE) : Math.max(Math.min(u, f.length + reach), TOLERANCE);
    cuts[myEnd] = { uExt: clamp(uExt), uInt: clamp(uInt) };
    done.add(myEnd);
  }
  return cuts;
}

/** u del corte a una profundidad n cualquiera (interpolación lineal entre las dos caras). */
function cutAt(c: EndCut, f: WallFrame, n: Meters): Meters {
  if (f.thickness <= TOLERANCE) return c.uExt;
  return c.uExt + ((c.uInt - c.uExt) * (f.faceExt - n)) / f.thickness;
}

// ─── Muro ───────────────────────────────────────────────────

function openingsOf(reader: ModelReader, wallId: Id): Opening[] {
  const out: Opening[] = [];
  for (const id of reader.indices.openingsOfHost(wallId)) {
    const o = getOfKind(reader, id, "Opening");
    if (o) out.push(o);
  }
  return out.sort((a, b) => a.offsetAlongAxis - b.offsetAlongAxis);
}

function crossesCut(o: Opening, opts: PlanOptions): boolean {
  return o.sillHeight < opts.cutHeight && o.sillHeight + o.height > opts.cutHeight;
}

/** Resta intervalos abiertos a [0, L]: devuelve los tramos macizos del muro. */
function solidSpans(length: Meters, cuts: [Meters, Meters][]): [Meters, Meters][] {
  const spans: [Meters, Meters][] = [];
  let cursor = 0;
  for (const [a0, b0] of [...cuts].sort((p, q) => p[0] - q[0])) {
    const a = Math.max(0, a0);
    const b = Math.min(length, b0);
    if (a - cursor > TOLERANCE) spans.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (length - cursor > TOLERANCE) spans.push([cursor, length]);
  return spans;
}

export function buildWallPlan(reader: ModelReader, wall: Wall, opts: PlanOptions): PlanPrimitive[] {
  const f = buildWallFrame(reader, wall);
  const prims: PlanPrimitive[] = [];
  if (f.thickness <= TOLERANCE) {
    prims.push({ kind: "polyline", points: [wall.start, wall.end], style: "muro:sin-capas" });
    return prims;
  }
  const openings = openingsOf(reader, wall.id);
  const cuts = openings.filter((o) => crossesCut(o, opts)).map((o) => [o.offsetAlongAxis, o.offsetAlongAxis + o.width] as [Meters, Meters]);

  const ends = wallEndCuts(reader, wall, f);
  for (const [a, b] of solidSpans(f.length, cuts)) {
    // Los tramos que tocan un extremo del muro usan el corte de la unión; los demás, corte recto.
    const ua = (n: Meters) => (a <= TOLERANCE ? cutAt(ends.start, f, n) : a);
    const ub = (n: Meters) => (b >= f.length - TOLERANCE ? cutAt(ends.end, f, n) : b);
    for (const l of f.layers) {
      prims.push({
        kind: "polygon",
        points: [toWorld(f, ua(l.nTop), l.nTop), toWorld(f, ub(l.nTop), l.nTop), toWorld(f, ub(l.nBottom), l.nBottom), toWorld(f, ua(l.nBottom), l.nBottom)],
        style: `capa:${l.materialId}`,
      });
    }
    const e = f.faceExt;
    const i = f.faceInt;
    prims.push({
      kind: "polyline",
      points: [toWorld(f, ua(e), e), toWorld(f, ub(e), e), toWorld(f, ub(i), i), toWorld(f, ua(i), i), toWorld(f, ua(e), e)],
      style: "muro:contorno",
    });
  }

  // Huecos que no cruzan el corte: el muro sigue cerrado y el hueco se marca en discontinua.
  for (const o of openings) {
    if (crossesCut(o, opts)) continue;
    const a = o.offsetAlongAxis;
    const b = a + o.width;
    prims.push({ kind: "polyline", points: [toWorld(f, a, f.faceExt), toWorld(f, b, f.faceExt)], style: "oculto" });
    prims.push({ kind: "polyline", points: [toWorld(f, a, f.faceInt), toWorld(f, b, f.faceInt)], style: "oculto" });
  }
  return prims;
}

// ─── Puerta y ventana ───────────────────────────────────────

function hostContext(reader: ModelReader, fillingId: Id): { opening: Opening; wall: Wall; frame: WallFrame } | undefined {
  const opening = getOfKind(reader, reader.indices.openingOfFilling(fillingId), "Opening");
  if (!opening) return undefined;
  const wall = getOfKind(reader, reader.indices.hostOfOpening(opening.id), "Wall");
  if (!wall) return undefined;
  return { opening, wall, frame: buildWallFrame(reader, wall) };
}

const angleOf = (v: Vec2) => Math.atan2(v.y, v.x);
const normAngle = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

export function buildDoorPlan(reader: ModelReader, door: Door): PlanPrimitive[] {
  const ctx = hostContext(reader, door.id);
  if (!ctx) return [];
  const { opening: o, frame: f } = ctx;
  const left = door.swingSide === "left";
  const inward = door.swingDirection === "inward";
  // Bisagra en una jamba, sobre la cara hacia la que abre la hoja.
  const hingeU = left ? o.offsetAlongAxis : o.offsetAlongAxis + o.width;
  const hingeN = inward ? f.faceInt : f.faceExt;
  const hinge = toWorld(f, hingeU, hingeN);
  const s = inward ? -1 : 1;
  const openDir = { x: f.n.x * s, y: f.n.y * s };
  const closedDir = left ? f.u : { x: -f.u.x, y: -f.u.y };
  const r = door.leafWidth;
  const leafEnd = { x: hinge.x + openDir.x * r, y: hinge.y + openDir.y * r };

  // El arco barre 90° entre la hoja cerrada y la abierta, en sentido antihorario.
  const a1 = angleOf(openDir);
  const a2 = angleOf(closedDir);
  const ccw = normAngle(a2 - a1) <= Math.PI;
  return [
    { kind: "polyline", points: [hinge, leafEnd], style: "simbolo:puerta:hoja" },
    { kind: "arc", center: hinge, radius: r, startAngle: ccw ? a1 : a2, endAngle: ccw ? a2 : a1, style: "simbolo:puerta:barrido" },
  ];
}

export function buildWindowPlan(reader: ModelReader, win: Window, opts: PlanOptions): PlanPrimitive[] {
  const ctx = hostContext(reader, win.id);
  if (!ctx) return [];
  const { opening: o, frame: f } = ctx;
  const a = o.offsetAlongAxis;
  const b = a + o.width;
  const mid = (f.faceExt + f.faceInt) / 2;
  const hidden = !crossesCut(o, opts);
  const style = hidden ? "simbolo:ventana:oculto" : "simbolo:ventana";
  return [
    { kind: "polygon", points: [toWorld(f, a, f.faceExt), toWorld(f, b, f.faceExt), toWorld(f, b, f.faceInt), toWorld(f, a, f.faceInt)], style: `${style}:marco` },
    { kind: "polyline", points: [toWorld(f, a, mid), toWorld(f, b, mid)], style: `${style}:vidrio` },
  ];
}

// ─── Cajas envolventes ──────────────────────────────────────

export function arcPoints(p: Extract<PlanPrimitive, { kind: "arc" }>, segments = 16): Vec2[] {
  let sweep = normAngle(p.endAngle - p.startAngle);
  if (sweep === 0) sweep = 2 * Math.PI;
  const pts: Vec2[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = p.startAngle + (sweep * i) / segments;
    pts.push({ x: p.center.x + Math.cos(a) * p.radius, y: p.center.y + Math.sin(a) * p.radius });
  }
  return pts;
}

export function boxOf(prims: readonly PlanPrimitive[]): AABB2 {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (p: Vec2) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const p of prims) {
    if (p.kind === "arc") {
      add(p.center);
      arcPoints(p).forEach(add);
    } else p.points.forEach(add);
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

// ─── Un elemento completo ───────────────────────────────────

export function buildElementPlan(reader: ModelReader, id: Id, opts: PlanOptions): ElementPlanGeometry | undefined {
  const e = reader.getEntity(id);
  if (!e || (e.kind !== "Wall" && e.kind !== "Door" && e.kind !== "Window")) return undefined;
  const levelId = reader.indices.levelOfElement(id);
  if (!levelId) return undefined;

  let primitives: PlanPrimitive[];
  let axis: [Vec2, Vec2] | undefined;
  let snapPoints: SnapPoint[] = [];
  if (e.kind === "Wall") {
    primitives = buildWallPlan(reader, e, opts);
    axis = [e.start, e.end];
    snapPoints = [
      { point: e.start, kind: "endpoint" },
      { point: e.end, kind: "endpoint" },
      { point: { x: (e.start.x + e.end.x) / 2, y: (e.start.y + e.end.y) / 2 }, kind: "midpoint" },
    ];
  } else if (e.kind === "Door") {
    primitives = buildDoorPlan(reader, e);
  } else {
    primitives = buildWindowPlan(reader, e, opts);
  }
  if (primitives.length === 0) return undefined;
  return { elementId: id, kind: e.kind, levelId, primitives, box: boxOf(primitives), ...(axis ? { axis } : {}), snapPoints };
}
