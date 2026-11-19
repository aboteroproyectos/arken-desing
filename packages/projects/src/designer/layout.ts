// Distribución de la vivienda por pisos (sin IA): bandas de módulos a lado y lado de un hall.
//
//   x →   0.1 ── banda occidental ── xa ── hall ── xb ── banda oriental ── xe
//   y ↑   cada banda es una pila de módulos de sur (acceso) a norte; la suite principal ocupa
//         el extremo norte del hall y la banda oriental en el piso más alto.
//
// Todos los pisos tienen la misma huella; la escalera está en el mismo sitio en todos los pisos.

import type { HouseProgram } from "./program";

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
  | "deposito";

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

export interface Layout {
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
  }
}

const GROW: Partial<Record<ModKind, number>> = { sala: 3, comedor: 1.2, cocina: 1, estar: 2, estudio: 1, alcoba: 1.2 };
const round2 = (n: number) => Math.round(n * 100) / 100;

function mod(kind: ModKind, d: Dims, extra: Partial<Mod> = {}): Mod {
  return { kind, depth: depthOf(kind, d), grow: GROW[kind] ?? 0, ...extra };
}

/** Reparte baños y habitaciones; arma los módulos de cada piso. */
function program2floors(p: HouseProgram, d: Dims): { floors: FloorPlan[]; notes: string[]; baths: Layout["baths"] } {
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
  return { dims: d, floors, xa, xb, xe, W: round2(xe + 0.1), L: round2(Lc + 0.2), notes, baths };
}

/** Distribución final: ajusta el tamaño de los espacios al área buscada, si la hay. */
export function layoutHouse(p: HouseProgram): Layout {
  const k0 = SIZE_K[p.tamano];
  if (!p.areaObjetivo) return layoutAt(p, k0);
  const area = (k: number) => {
    const l = layoutAt(p, k);
    return l.W * l.L * p.pisos;
  };
  let lo = 0.62;
  let hi = 2.4;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (area(mid) < p.areaObjetivo) lo = mid;
    else hi = mid;
  }
  const l = layoutAt(p, (lo + hi) / 2);
  const got = l.W * l.L * p.pisos;
  const notes = [...l.notes];
  if (Math.abs(got - p.areaObjetivo) / p.areaObjetivo > 0.08)
    notes.push(`El programa pedido da ${got.toFixed(0)} m² y no se acerca más a los ${p.areaObjetivo} m² buscados sin espacios por fuera de los mínimos de diseño.`);
  return { ...l, notes };
}
