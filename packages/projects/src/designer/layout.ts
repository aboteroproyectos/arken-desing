// Distribución de la vivienda por pisos (sin IA): bandas de módulos a lado y lado de un hall.
//
//   x →   0.1 ── banda occidental ── xa ── hall ── xb ── banda oriental ── xe
//   y ↑   cada banda es una pila de módulos de sur (acceso) a norte; la suite principal ocupa
//         el extremo norte del hall y la banda oriental en el piso más alto.
//
// Todos los pisos tienen la misma huella; la escalera está en el mismo sitio en todos los pisos.

import type { Footprint, HouseProgram } from "./program";

export type ModKind =
  | "servicio"
  | "alcoba-servicio"
  | "bano-social"
  | "cocina"
  | "comedor"
  | "sala"
  | "estudio"
  | "estar"
  | "alcoba"
  | "bano"
  | "escalera"
  | "deposito"
  /** Paso del hall de un pabellón a la galería que lo une con otro pabellón. */
  | "conexion";

export interface Mod {
  readonly kind: ModKind;
  depth: number;
  /** Peso para repartir el largo sobrante (0 = no crece). */
  readonly grow: number;
  /** Habitación: número (2, 3…) o "H" huéspedes. Baño: a quién sirve. */
  readonly label?: string;
  /** Baño privado de la habitación siguiente (puerta desde la habitación). */
  readonly privateFor?: string;
  /** Habitación con baño privado inmediatamente al sur. */
  readonly ensuite?: boolean;
}

export interface FloorPlan {
  readonly index: number; // 1 = primer piso
  readonly west: Mod[];
  readonly east: Mod[];
  readonly suite: boolean;
}

export interface Dims {
  readonly k: number;
  readonly Ws: number;
  readonly corr: number;
  readonly We: number;
  readonly suiteBed: number;
  readonly suiteBack: number;
  readonly flight: number;
  readonly floorH: number;
}

/**
 * Colocación de un pabellón: sus coordenadas locales (las de la barra de tres bandas) giradas un
 * número de cuartos de vuelta antihorarios y trasladadas al origen (ox, oy) del proyecto.
 */
export interface Place {
  readonly ox: number;
  readonly oy: number;
  readonly turn: 0 | 1 | 3;
}
export const IDENTITY: Place = { ox: 0, oy: 0, turn: 0 };

export function toGlobal(pl: Place, x: number, y: number): { x: number; y: number } {
  if (pl.turn === 1) return { x: round4(pl.ox - y), y: round4(pl.oy + x) };
  if (pl.turn === 3) return { x: round4(pl.ox + y), y: round4(pl.oy - x) };
  return { x: round4(pl.ox + x), y: round4(pl.oy + y) };
}
export function toLocal(pl: Place, x: number, y: number): { x: number; y: number } {
  if (pl.turn === 1) return { x: round4(y - pl.oy), y: round4(pl.ox - x) };
  if (pl.turn === 3) return { x: round4(pl.oy - y), y: round4(x - pl.ox) };
  return { x: round4(x - pl.ox), y: round4(y - pl.oy) };
}
export type Face = "S" | "N" | "E" | "W";
const FACE_V: Record<Face, [number, number]> = { S: [0, -1], N: [0, 1], E: [1, 0], W: [-1, 0] };
/** Orientación global de una fachada local del pabellón. */
export function faceToGlobal(pl: Place, f: Face): Face {
  const [x, y] = FACE_V[f];
  const g = pl.turn === 1 ? [-y, x] : pl.turn === 3 ? [y, -x] : [x, y];
  return (Object.keys(FACE_V) as Face[]).find((k) => FACE_V[k][0] === g[0] && FACE_V[k][1] === g[1])!;
}
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Un pabellón: barra de tres bandas (cualquiera de las dos bandas puede faltar). */
export interface Wing {
  readonly key: "A" | "B" | "C";
  readonly name: string;
  readonly floors: readonly FloorPlan[];
  readonly xa: number;
  readonly xb: number;
  readonly xe: number;
  readonly W: number;
  readonly L: number;
  readonly place: Place;
  /** Vanos de fachada hacia las galerías (coordenadas locales sobre el eje del muro). */
  readonly gaps: readonly { readonly face: Face; readonly a: number; readonly b: number }[];
}

/** Galería acristalada que une el hall del pabellón A con el de otro pabellón (coordenadas globales). */
export interface Link {
  readonly to: "B" | "C";
  readonly side: "E" | "W";
  /** Ejes de los muros de la galería (y). */
  readonly c0: number;
  readonly c1: number;
  /** Eje de la fachada de A y eje de la fachada del otro pabellón (x). */
  readonly xA: number;
  readonly xW: number;
}

export interface Layout {
  readonly shape: Footprint;
  /** Pabellones: A (acceso, zona social y servicios) primero. */
  readonly wings: readonly Wing[];
  readonly links: readonly Link[];
  /** Muro de cierre del patio (casa cuadrada), en coordenadas globales. */
  readonly closure?: { readonly a: { x: number; y: number }; readonly b: { x: number; y: number } };
  /** Rectángulo del patio central (U y cuadrada). */
  readonly patio?: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  readonly dims: Dims;
  readonly floors: readonly FloorPlan[];
  /** Ejes: banda occidental, hall, banda oriental. */
  readonly xa: number;
  readonly xb: number;
  readonly xe: number;
  /** Huella exterior. */
  readonly W: number;
  readonly L: number;
  readonly notes: readonly string[];
  readonly baths: { readonly total: number; readonly social: boolean; readonly service: boolean };
}

export const FLOOR_H = 3.0;
export const RISER_MAX = 0.18;
export const TREAD = 0.28;

export function stairGeometry(floorH: number, flight: number) {
  const n = Math.ceil(floorH / RISER_MAX - 1e-9);
  const riser = floorH / n;
  const n1 = Math.ceil(n / 2);
  const n2 = n - n1;
  const run1 = (n1 - 1) * TREAD;
  const run2 = (n2 - 1) * TREAD;
  return { n, riser, n1, n2, run1, run2, depth: run1 + flight };
}

const SIZE_K = { compacta: 0.88, estandar: 1, amplia: 1.14 } as const;

function dimsFor(p: HouseProgram, k: number): Dims {
  const Ws = Math.max(3.6, 4.7 * k);
  const We = Math.max(3.4, 4.2 * k);
  const corr = (p.tamano === "amplia" ? 1.5 : p.tamano === "compacta" ? 1.2 : 1.35) + 0.12;
  const flight = Math.min(1.2, Math.max(0.95, (We - 0.12 - 0.1) / 2));
  return { k, Ws, corr, We, suiteBed: Math.max(3.8, 4.2 * k), suiteBack: Math.max(2.7, 2.9 * k), flight, floorH: FLOOR_H };
}

function depthOf(kind: ModKind, d: Dims): number {
  const k = d.k;
  switch (kind) {
    case "servicio": return 2.7;
    case "alcoba-servicio": return 3.1;
    case "bano-social": return 2.1;
    case "cocina": return Math.max(3.2, 3.7 * k);
    case "comedor": return Math.max(3.0, 3.5 * k);
    case "sala": return Math.max(4.0, 4.8 * k);
    case "estudio": return Math.max(2.8, 3.2 * k);
    case "estar": return Math.max(3.2, 3.8 * k);
    case "alcoba": return Math.max(3.3, 3.7 * k);
    case "bano": return Math.max(2.2, 2.35 * Math.min(k, 1.15));
    case "escalera": return round2(stairGeometry(d.floorH, d.flight).depth + 0.36);
    case "deposito": return 1.6;
    case "conexion": return d.corr;
  }
}

const GROW: Partial<Record<ModKind, number>> = { sala: 3, comedor: 1.2, cocina: 1, estar: 2, estudio: 1, alcoba: 1.2 };
const round2 = (n: number) => Math.round(n * 100) / 100;

function mod(kind: ModKind, d: Dims, extra: Partial<Mod> = {}): Mod {
  return { kind, depth: depthOf(kind, d), grow: GROW[kind] ?? 0, ...extra };
}

/** Reparte habitaciones y baños por piso y arma los bloques de habitaciones (alcobas con su baño). */
function bedroomPlan(p: HouseProgram, d: Dims) {
  const notes: string[] = [];
  const F = p.pisos;
  const guest = F > 1 && p.habitacionPrimerPiso && p.habitaciones >= 2 ? 1 : 0;
  const nSec = p.habitaciones - 1 - guest;
  // Habitaciones secundarias por piso (la principal va en el piso más alto).
  const secBy = new Map<number, number>();
  const upper = F === 1 ? [1] : Array.from({ length: F - 1 }, (_, i) => i + 2);
  for (let i = 0; i < nSec; i++) {
    const f = upper[i % upper.length]!;
    secBy.set(f, (secBy.get(f) ?? 0) + 1);
  }
  // Baños: principal + social + huéspedes + compartidos (1 por cada 2 habitaciones).
  let social = F > 1 || p.banoSocial;
  let guestBath = guest === 1;
  const nb = new Map<number, number>();
  for (const [f, n] of secBy) nb.set(f, Math.ceil(n / 2));
  const count = () => 1 + (social ? 1 : 0) + (guestBath ? 1 : 0) + [...nb.values()].reduce((a, b) => a + b, 0);
  if (p.banos > 0) {
    let extra = p.banos - count();
    for (const [f, n] of secBy) while (extra > 0 && nb.get(f)! < n) nb.set(f, nb.get(f)! + 1), extra--;
    if (extra > 0 && !social) (social = true), extra--;
    if (extra > 0) notes.push(`Se pidieron ${p.banos} baños; el programa admite ${count()} sin baños redundantes.`);
    let short = count() - p.banos;
    if (short > 0 && guestBath) (guestBath = false), short--;
    if (short > 0 && social && F === 1) (social = false), short--;
    for (const [f] of secBy) while (short > 0 && nb.get(f)! > 1) nb.set(f, nb.get(f)! - 1), short--;
    if (short > 0) notes.push(`Con ${p.banos} baños no se cubre cada piso con habitaciones: el diseño deja ${count()} (mínimo recomendado).`);
  }

  // Bloques de habitaciones por piso.
  let bedNo = 2;
  const blocksFor = (f: number): Mod[][] => {
    const n = secBy.get(f) ?? 0;
    const baths = nb.get(f) ?? 0;
    if (!n) return [];
    const groups: number[] = [];
    for (let g = 0; g < baths; g++) groups.push(Math.floor(n / baths) + (g < n % baths ? 1 : 0));
    return groups.map((g) => {
      const labels = Array.from({ length: g }, () => String(bedNo++));
      if (g === 1) return [mod("bano", d, { privateFor: labels[0] }), mod("alcoba", d, { label: labels[0], ensuite: true })];
      const out: Mod[] = [mod("alcoba", d, { label: labels[0] }), mod("bano", d, { label: labels.slice(0, 2).join(" y ") }), mod("alcoba", d, { label: labels[1] })];
      for (const l of labels.slice(2)) out.push(mod("alcoba", d, { label: l }));
      return out;
    });
  };
  return { F, guest, guestBath, social, secBy, notes, count, blocksFor };
}

/** Reparte baños y habitaciones; arma los módulos de cada piso. */
function program2floors(p: HouseProgram, d: Dims): { floors: FloorPlan[]; notes: string[]; baths: Layout["baths"] } {
  const { F, guest, guestBath, social, secBy, notes, count, blocksFor } = bedroomPlan(p, d);
  const floors: FloorPlan[] = [];
  for (let f = 1; f <= F; f++) {
    const west: Mod[] = [];
    const east: Mod[] = [];
    if (f === 1) {
      west.push(mod("servicio", d));
      if (p.servicio) west.push(mod("alcoba-servicio", d));
      if (social) west.push(mod("bano-social", d));
      west.push(mod("cocina", d), mod("comedor", d), mod("sala", d));
      if (F > 1) east.push(mod("escalera", d));
      if (guest) east.push(mod("bano", d, { privateFor: "H" }), mod("alcoba", d, { label: "H", ensuite: guestBath }));
      if (guest && !guestBath) east.splice(east.length - 2, 1);
      if (p.estudio) east.push(mod("estudio", d));
      if (p.estar && F === 1) east.push(mod("estar", d));
    } else {
      east.push(mod("escalera", d));
      if (p.estar && f === 2) west.push(mod("estar", d));
    }
    const suite = f === F;
    const blocks = blocksFor(f).sort((a, b) => sum(b) - sum(a));
    const insertAt = f === 1 ? west.findIndex((m) => m.kind === "cocina") : west.length;
    let wExtra: Mod[] = [];
    for (const blk of blocks) {
      const wl = sum(west) + sum(wExtra);
      const el = sum(east) + (suite ? d.suiteBed + d.suiteBack : 0);
      if (el <= wl) east.push(...blk);
      else wExtra = [...wExtra, ...blk];
    }
    west.splice(insertAt, 0, ...wExtra);
    if (f > 1 && !west.length) west.push(mod(p.estar || f > 2 ? "estar" : "estudio", d));
    if (f > 1 && !(secBy.get(f) ?? 0) && !suite && !west.some((m) => m.kind === "estar")) west.push(mod("estar", d));
    floors.push({ index: f, west, east, suite });
  }
  return { floors, notes, baths: { total: count() + (p.servicio ? 1 : 0), social, service: p.servicio } };
}

const sum = (ms: readonly Mod[]) => ms.reduce((t, m) => t + m.depth, 0);

/** Distribución completa a un factor de tamaño `k`. */
function layoutAt(p: HouseProgram, k: number): Layout {
  const d = dimsFor(p, k);
  const { floors, notes, baths } = program2floors(p, d);
  // Largo común de la huella: el de la banda más larga de todos los pisos.
  const strips = floors.flatMap((f) => [{ mods: f.west, fixed: 0 }, { mods: f.east, fixed: f.suite ? d.suiteBed + d.suiteBack : 0 }]);
  const Lc = Math.max(...strips.map((s) => sum(s.mods) + s.fixed));
  for (const s of strips) {
    let deficit = Lc - sum(s.mods) - s.fixed;
    if (deficit < 1e-6) continue;
    const growers = s.mods.filter((m) => m.grow > 0);
    // Un hueco grande en una banda sin espacios que crezcan se vuelve depósito o estar.
    if (!growers.length || deficit > 3.2 * growers.length) {
      const filler = deficit >= 3 ? mod("estar", d) : mod("deposito", d);
      filler.depth = deficit;
      s.mods.push(filler);
      continue;
    }
    const wsum = growers.reduce((t, m) => t + m.grow, 0);
    for (const m of growers) m.depth += (deficit * m.grow) / wsum;
    deficit = 0;
  }
  for (const s of strips) for (const m of s.mods) m.depth = round2(m.depth);
  // Ajuste fino del redondeo: el último módulo absorbe la diferencia.
  for (const s of strips) {
    const diff = round2(Lc - sum(s.mods) - s.fixed);
    if (Math.abs(diff) > 0 && s.mods.length) s.mods[s.mods.length - 1]!.depth = round2(s.mods[s.mods.length - 1]!.depth + diff);
  }
  const xa = round2(0.1 + d.Ws);
  const xb = round2(xa + d.corr);
  const xe = round2(xb + d.We);
  const W = round2(xe + 0.1);
  const L = round2(Lc + 0.2);
  const A: Wing = { key: "A", name: "Casa", floors, xa, xb, xe, W, L, place: IDENTITY, gaps: [] };
  return { shape: "rectangular", wings: [A], links: [], dims: d, floors, xa, xb, xe, W, L, notes, baths };
}

/** Distribución final: ajusta el tamaño de los espacios al área buscada, si la hay. */
export function layoutHouse(p: HouseProgram): Layout {
  const k0 = SIZE_K[p.tamano];
  const at = (k: number) => (p.huella && p.huella !== "rectangular" ? pavilionsAt(p, k) : layoutAt(p, k));
  if (!p.areaObjetivo) return at(k0);
  const area = (k: number) => builtArea(at(k));
  let lo = 0.62;
  let hi = 2.4;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (area(mid) < p.areaObjetivo) lo = mid;
    else hi = mid;
  }
  const l = at((lo + hi) / 2);
  const got = builtArea(l);
  const notes = [...l.notes];
  if (Math.abs(got - p.areaObjetivo) / p.areaObjetivo > 0.08)
    notes.push(`El programa pedido da ${got.toFixed(0)} m² y no se acerca más a los ${p.areaObjetivo} m² buscados sin espacios por fuera de los mínimos de diseño.`);
  return { ...l, notes };
}

/** Área construida: pabellones por sus pisos más las galerías. */
export function builtArea(l: Layout): number {
  let a = 0;
  for (const w of l.wings) a += w.W * w.L * w.floors.length;
  for (const k of l.links) a += Math.abs(k.xW - k.xA) * (k.c1 - k.c0);
  return a;
}

/** Galería entre pabellones: largo entre las fachadas (m). */
export const LINK_LEN = 3.6;

/** Completa una lista de módulos hasta un largo dado (crecen los que pueden; si no, depósito o estar). */
function fillTo(mods: Mod[], target: number, d: Dims): void {
  const deficit = target - sum(mods);
  if (deficit < 1e-6) return;
  const growers = mods.filter((m) => m.grow > 0);
  if (!growers.length || deficit > 3.2 * growers.length) {
    const filler = deficit >= 3 ? mod("estar", d) : mod("deposito", d);
    filler.depth = deficit;
    mods.push(filler);
    return;
  }
  const wsum = growers.reduce((t, m) => t + m.grow, 0);
  for (const m of growers) m.depth += (deficit * m.grow) / wsum;
}
/** Redondea a centímetros y deja el total exacto (el último módulo absorbe la diferencia). */
function settle(mods: Mod[], target: number): void {
  for (const m of mods) m.depth = round2(m.depth);
  const diff = round2(target - sum(mods));
  const last = [...mods].reverse().find((m) => m.kind !== "conexion");
  if (Math.abs(diff) > 0 && last) last.depth = round2(last.depth + diff);
}

type WingDraft = { key: "B" | "C"; floors: { west: Mod[]; east: Mod[]; suite: boolean }[] };

/**
 * Casa por pabellones (L, T, U, cruz y cuadrada con patio). El pabellón A (un piso) tiene el acceso,
 * la zona social y los servicios; el B es la zona privada con la habitación principal al fondo (y la
 * escalera si la casa tiene más de un piso); el C (U, cruz y cuadrada) recibe habitaciones, estudio,
 * estar o huéspedes. Cada pabellón es una barra de tres bandas; las galerías acristaladas unen los halls.
 */
function pavilionsAt(p: HouseProgram, k: number): Layout {
  const shape = p.huella;
  const d = dimsFor(p, k);
  const R = bedroomPlan(p, d);
  const F = p.pisos;
  const notes = [...R.notes];
  const suiteLen = d.suiteBed + d.suiteBack;

  // Pabellón A: acceso, servicios y zona social.
  const aWest: Mod[] = [mod("servicio", d)];
  if (p.servicio) aWest.push(mod("alcoba-servicio", d));
  if (R.social) aWest.push(mod("bano-social", d));
  aWest.push(mod("cocina", d), mod("comedor", d), mod("sala", d));
  const extras: Mod[][] = [];
  if (p.estar) extras.push([mod("estar", d)]);
  if (p.estudio) extras.push([mod("estudio", d)]);
  if (R.guest) extras.push(R.guestBath ? [mod("bano", d, { privateFor: "H" }), mod("alcoba", d, { label: "H", ensuite: true })] : [mod("alcoba", d, { label: "H" })]);
  const exLen = extras.reduce((t, b) => t + sum(b), 0);
  // Si estudio, estar y huéspedes no alcanzan para media banda, A queda de una sola crujía con galería.
  let aEast: Mod[] = [];
  let moved: Mod[][] = [];
  if (exLen >= 0.45 * sum(aWest)) aEast = extras.flat();
  else moved = extras;

  // Pabellones B y C.
  const blocks: Mod[][] = [];
  for (let f = 1; f <= F; f++) blocks.push(...R.blocksFor(f));
  const two = shape === "U" || shape === "X" || shape === "cuadrada";
  const B: WingDraft = { key: "B", floors: Array.from({ length: F }, (_, i) => ({ west: [], east: i === 0 && F > 1 ? [mod("escalera", d)] : [], suite: i === F - 1 })) };
  const C: WingDraft | null = two ? { key: "C", floors: [{ west: [], east: [], suite: false }] } : null;
  const bandLen = (w: WingDraft, fi: number, side: "west" | "east") => sum(w.floors[fi]![side]) + (side === "east" && w.floors[fi]!.suite ? suiteLen : 0);
  const load = (w: WingDraft) => w.floors.reduce((t, _, fi) => t + bandLen(w, fi, "west") + bandLen(w, fi, "east"), 0);
  const put = (w: WingDraft, blk: Mod[], onlyFirst = false) => {
    let best = { fi: 0, side: "west" as "west" | "east", l: Infinity };
    w.floors.forEach((_, fi) => (onlyFirst && fi > 0 ? [] : (["west", "east"] as const)).forEach((side) => {
      const l = bandLen(w, fi, side);
      if (l < best.l - 1e-6) best = { fi, side, l };
    }));
    w.floors[best.fi]![best.side].push(...blk);
  };
  const target = C ?? B;
  for (const blk of moved) put(target, blk, true);
  for (const blk of [...blocks].sort((a, c) => sum(c) - sum(a))) {
    if (C && F === 1) put(load(C) < load(B) ? C : B, blk);
    else put(B, blk);
  }
  if (C && load(C) === 0) {
    // El pabellón C necesita programa: la habitación más pequeña baja al primer piso, o un estar familiar.
    const cand = B.floors.flatMap((fl) => [fl.west, fl.east]).find((band) => band.some((m) => m.kind === "alcoba"));
    const blk = blocks.length ? blocks.reduce((a, c) => (sum(c) < sum(a) ? c : a)) : undefined;
    if (blk && cand) {
      for (const fl of B.floors) for (const side of ["west", "east"] as const) fl[side] = fl[side].filter((m) => !blk.includes(m));
      put(C, blk);
    } else {
      put(C, [mod("estar", d)]);
      notes.push("El pabellón de huéspedes no tenía programa: se le asignó un estar familiar.");
    }
  }

  // Geometría de B y C: bandas vacías en todos los pisos no se construyen (crujía sencilla).
  const mkWing = (w: WingDraft) => {
    const hasW = w.floors.some((fl) => fl.west.length);
    const hasE = w.floors.some((fl) => fl.east.length || fl.suite);
    const Ws = hasW ? d.Ws : 0;
    const We = hasE ? d.We : 0;
    const Lc = Math.max(...w.floors.flatMap((fl) => [sum(fl.west), sum(fl.east) + (fl.suite ? suiteLen : 0)]));
    const floors: FloorPlan[] = w.floors.map((fl, i) => {
      if (hasW) fillTo(fl.west, Lc, d), settle(fl.west, Lc);
      if (hasE) fillTo(fl.east, Lc - (fl.suite ? suiteLen : 0), d), settle(fl.east, Lc - (fl.suite ? suiteLen : 0));
      return { index: i + 1, west: fl.west, east: fl.east, suite: fl.suite };
    });
    const xa = round2(0.1 + Ws);
    const xb = round2(xa + d.corr);
    const xe = round2(xb + We);
    return { key: w.key, floors, xa, xb, xe, W: round2(xe + 0.1), L: round2(Lc + 0.2), Ws, We };
  };
  const wB = mkWing(B);
  const wC = C ? mkWing(C) : null;

  // Pabellón A: conexiones según la forma.
  const corr = d.corr;
  const hasEastA = aEast.length > 0;
  const eastConns: ("start" | "mid" | "end")[] = shape === "L" ? ["end"] : shape === "T" || shape === "X" ? ["mid"] : ["start", "end"];
  const westMid = shape === "X";
  let Lc = Math.max(sum(aWest) + (westMid ? corr : 0), hasEastA ? sum(aEast) + eastConns.length * corr : 0);
  if (shape === "U" || shape === "cuadrada") Lc = Math.max(Lc, 2 * corr + (wC!.xa - 0.1) + (wB.xe - wB.xb) + 6.0);
  // Segmentos de cada banda alrededor de una conexión intermedia.
  const split = (mods: Mod[], at: number) => [mods.slice(0, at), mods.slice(at)] as const;
  let wPre: Mod[] = aWest;
  let wPost: Mod[] = [];
  if (westMid) {
    // La galería occidental sale entre los servicios y la cocina (la zona social abierta queda entera).
    let at = aWest.findIndex((m) => m.kind === "cocina");
    const clear = p.parqueaderos > 0 ? 8.85 + (wC!.xa - 0.1) : 0;
    while (at < aWest.length - 1 && sum(aWest.slice(0, at)) < clear - 2.5) at++;
    [wPre, wPost] = split(aWest, at).map((x) => [...x]) as [Mod[], Mod[]];
  }
  let ePre: Mod[] = [];
  let ePost: Mod[] = [];
  if (hasEastA && eastConns[0] === "mid") {
    let at = 0;
    const half = sum(aEast) / 2;
    while (at < aEast.length && sum(aEast.slice(0, at + 1)) <= half + 0.5) at++;
    [ePre, ePost] = split(aEast, at).map((x) => [...x]) as [Mod[], Mod[]];
  }
  let yM = 0;
  if (eastConns[0] === "mid") {
    const clear = westMid && p.parqueaderos > 0 ? 8.85 + (wC!.xa - 0.1) : 0;
    yM = Math.max(westMid ? sum(wPre) : 0, hasEastA ? sum(ePre) : 0, clear, shape === "T" ? (Lc - corr) / 2 : 0);
    yM = round2(yM);
    Lc = Math.max(Lc, yM + corr + Math.max(westMid ? sum(wPost) : 0, hasEastA ? sum(ePost) : 0));
  }
  Lc = round2(Lc);
  // Bandas definitivas de A.
  let west: Mod[];
  if (westMid) {
    fillTo(wPre, yM, d), settle(wPre, yM);
    fillTo(wPost, Lc - yM - corr, d), settle(wPost, Lc - yM - corr);
    west = [...wPre, mod("conexion", d, { label: "C" }), ...wPost];
  } else {
    west = [...aWest];
    fillTo(west, Lc, d), settle(west, Lc);
  }
  let east: Mod[] = [];
  if (hasEastA) {
    if (eastConns[0] === "mid") {
      fillTo(ePre, yM, d), settle(ePre, yM);
      fillTo(ePost, Lc - yM - corr, d), settle(ePost, Lc - yM - corr);
      east = [...ePre, mod("conexion", d, { label: "B" }), ...ePost];
    } else {
      const items = [...aEast];
      const n = eastConns.length;
      fillTo(items, Lc - n * corr, d), settle(items, Lc - n * corr);
      east = n === 2 ? [mod("conexion", d, { label: "C" }), ...items, mod("conexion", d, { label: "B" })] : [...items, mod("conexion", d, { label: "B" })];
    }
  }
  const xa = round2(0.1 + d.Ws);
  const xb = round2(xa + corr);
  const xe = round2(xb + (hasEastA ? d.We : 0));
  const WA = round2(xe + 0.1);
  const LA = round2(Lc + 0.2);
  const aFloor: FloorPlan = { index: 1, west, east, suite: false };

  // Posición de cada conexión (ejes) y colocación de los pabellones.
  const pos = (kind: "start" | "mid" | "end") => (kind === "start" ? 0.1 : kind === "end" ? round2(0.1 + Lc - corr) : round2(0.1 + yM));
  const links: Link[] = [];
  const wings: Wing[] = [];
  const aGaps: { face: Face; a: number; b: number }[] = [];
  const attach = (w: NonNullable<typeof wC>, side: "E" | "W", kind: "start" | "mid" | "end", name: string) => {
    const c0 = pos(kind);
    const c1 = round2(c0 + corr);
    const place: Place = side === "E" ? { ox: round2(xe + LINK_LEN - 0.1), oy: round2(c1 + w.xa), turn: 3 } : { ox: round2(0.2 - LINK_LEN), oy: round2(c0 - w.xa), turn: 1 };
    links.push({ to: w.key, side, c0, c1, xA: side === "E" ? xe : 0.1, xW: side === "E" ? round2(xe + LINK_LEN) : round2(0.1 - LINK_LEN) });
    aGaps.push({ face: side, a: c0, b: c1 });
    wings.push({ key: w.key, name, floors: w.floors, xa: w.xa, xb: w.xb, xe: w.xe, W: w.W, L: w.L, place, gaps: [{ face: "S", a: w.xa, b: w.xb }] });
  };
  const A: Wing = { key: "A", name: "Pabellón social", floors: [aFloor], xa, xb, xe, W: WA, L: LA, place: IDENTITY, gaps: aGaps };
  wings.push(A);
  if (shape === "L") attach(wB, "E", "end", "Pabellón privado");
  else if (shape === "T") attach(wB, "E", "mid", "Pabellón privado");
  else if (shape === "X") attach(wB, "E", "mid", "Pabellón privado"), attach(wC!, "W", "mid", "Pabellón de huéspedes");
  else attach(wB, "E", "end", "Pabellón privado"), attach(wC!, "E", "start", "Pabellón de huéspedes");

  // Patio (U y cuadrada) y muro de cierre de la casa cuadrada.
  let patio: Layout["patio"];
  let closure: Layout["closure"];
  if (shape === "U" || shape === "cuadrada") {
    const lB = links.find((x) => x.to === "B")!;
    const lC = links.find((x) => x.to === "C")!;
    const wb = wings.find((x) => x.key === "B")!;
    const wc = wings.find((x) => x.key === "C")!;
    const farB = round2(lB.xW + wb.L - 0.2);
    const farC = round2(lC.xW + wc.L - 0.2);
    const xw = Math.min(farB, farC);
    const y0 = round2(lC.c1 + (wc.xa - 0.1));
    const y1 = round2(lB.c0 - (wb.xe - wb.xb));
    patio = { x0: xe, y0, x1: xw, y1 };
    if (shape === "cuadrada") closure = { a: { x: xw, y: y0 }, b: { x: xw, y: y1 } };
  }
  const names: Record<string, string> = { L: "en L", T: "en T", U: "en U", X: "en cruz", cuadrada: "cuadrada con patio central" };
  notes.unshift(`Planta ${names[shape]}: ${wings.length} pabellones unidos por galerías acristaladas de ${LINK_LEN.toFixed(1)} m.`);
  if (F > 1) notes.push(`El pabellón privado tiene ${F} pisos con la escalera; los demás pabellones son de un piso.`);
  return { shape, wings, links, ...(patio ? { patio } : {}), ...(closure ? { closure } : {}), dims: d, floors: [aFloor], xa, xb, xe, W: WA, L: LA, notes, baths: { total: R.count() + (p.servicio ? 1 : 0), social: R.social, service: p.servicio } };
}

/** Rectángulo global que envuelve todos los pabellones (caras exteriores). */
export function footprintBox(l: Layout): { x0: number; y0: number; x1: number; y1: number } {
  const pts = l.wings.flatMap((w) => [toGlobal(w.place, 0, 0), toGlobal(w.place, w.W, w.L)]);
  return { x0: Math.min(...pts.map((q) => q.x)), y0: Math.min(...pts.map((q) => q.y)), x1: Math.max(...pts.map((q) => q.x)), y1: Math.max(...pts.map((q) => q.y)) };
}
