// Topografía (Paso 8): lectura del levantamiento del topógrafo, modelo digital del terreno (TIN),
// curvas de nivel, cotas en cualquier punto, implantación de la casa y movimiento de tierras.
//
// Entradas aceptadas:
//   · DXF (AutoCAD / Civil 3D / TopoCal): POINT, INSERT (con atributo de cota), LINE y POLYLINE 3D,
//     LWPOLYLINE y POLYLINE 2D con elevación (curvas de nivel), 3DFACE y textos numéricos de cota.
//   · Archivos de puntos .csv / .txt: P,N,E,Z[,D] (formato PNEZD habitual) o E,N,Z.
// Todas las coordenadas se guardan relativas a un origen local (la esquina mínima) para no perder
// precisión con coordenadas MAGNA-SIRGAS de siete dígitos; el origen se conserva para exportar.

export interface P3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Survey {
  /** Puntos en coordenadas locales (m), relativos a `origin`. */
  readonly points: readonly P3[];
  /** Origen local en coordenadas del topógrafo (E, N). */
  readonly origin: { readonly x: number; readonly y: number };
  readonly source: string;
  /** Resumen de lo leído (para mostrar al usuario). */
  readonly stats: Readonly<Record<string, number>>;
}

// ─── Lectura DXF ─────────────────────────────────────────────

type Rec = { type: string; codes: [number, string][] };

function dxfRecords(text: string): Rec[] {
  const lines = text.split(/\r?\n/);
  const out: Rec[] = [];
  let cur: Rec | undefined;
  let inEntities = false;
  let inBlocks = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i]!.trim(), 10);
    const val = lines[i + 1]!.trim();
    if (Number.isNaN(code)) continue;
    if (code === 0) {
      if (cur) out.push(cur);
      cur = undefined;
      if (val === "SECTION") continue;
      if (val === "ENDSEC") {
        inEntities = inBlocks = false;
        continue;
      }
      if (inEntities) cur = { type: val, codes: [] };
      continue;
    }
    if (code === 2 && !cur && !inEntities && !inBlocks) {
      if (val === "ENTITIES") inEntities = true;
      else if (val === "BLOCKS") inBlocks = true;
      continue;
    }
    cur?.codes.push([code, val]);
  }
  if (cur) out.push(cur);
  return out;
}

const g = (r: Rec, code: number, d = NaN) => {
  const v = r.codes.find(([c]) => c === code);
  return v ? Number(v[1]) : d;
};
const gs = (r: Rec, code: number) => r.codes.find(([c]) => c === code)?.[1] ?? "";
const NUM = /^[+-]?\d+(?:[.,]\d+)?$/;
const ELEV_LAYER = /cota|elev|nivel|pto|punto|point|spot|alt/i;
const ELEV_TAG = /cota|elev|^z$|alt|nivel|height/i;

/** Lee los puntos con cota de un DXF ASCII. */
export function parseDxfSurvey(text: string): P3[] {
  const recs = dxfRecords(text);
  const pts: P3[] = [];
  const texts: P3[] = [];
  const stats = { point: 0, insert: 0, line: 0, poly: 0, contour: 0, face: 0, text: 0 };
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i]!;
    switch (r.type) {
      case "POINT":
        pts.push({ x: g(r, 10), y: g(r, 20), z: g(r, 30, 0) });
        stats.point++;
        break;
      case "INSERT": {
        let z = g(r, 30, 0);
        // Atributos que siguen al bloque: se toma el de cota.
        for (let j = i + 1; j < recs.length && recs[j]!.type === "ATTRIB"; j++) {
          const a = recs[j]!;
          const v = gs(a, 1).replace(",", ".");
          if (ELEV_TAG.test(gs(a, 2)) && NUM.test(v)) z = Number(v);
        }
        pts.push({ x: g(r, 10), y: g(r, 20), z });
        stats.insert++;
        break;
      }
      case "LINE":
        pts.push({ x: g(r, 10), y: g(r, 20), z: g(r, 30, 0) }, { x: g(r, 11), y: g(r, 21), z: g(r, 31, 0) });
        stats.line++;
        break;
      case "3DFACE":
        for (const k of [0, 1, 2, 3]) pts.push({ x: g(r, 10 + k), y: g(r, 20 + k), z: g(r, 30 + k, 0) });
        stats.face++;
        break;
      case "LWPOLYLINE": {
        const z = g(r, 38, 0);
        let x = NaN;
        for (const [c, v] of r.codes) {
          if (c === 10) x = Number(v);
          else if (c === 20 && !Number.isNaN(x)) pts.push({ x, y: Number(v), z });
        }
        stats.contour++;
        break;
      }
      case "POLYLINE": {
        const z0 = g(r, 30, 0);
        let n = 0;
        for (let j = i + 1; j < recs.length && recs[j]!.type === "VERTEX"; j++, n++) {
          const v = recs[j]!;
          const z = g(v, 30, NaN);
          pts.push({ x: g(v, 10), y: g(v, 20), z: Number.isNaN(z) || z === 0 ? z0 : z });
        }
        if (n) stats.poly++;
        break;
      }
      case "TEXT":
      case "MTEXT": {
        const raw = gs(r, 1).replace(/\\[A-Za-z][^;]*;|[{}]/g, "").trim().replace(",", ".");
        if (NUM.test(raw)) {
          texts.push({ x: g(r, 10), y: g(r, 20), z: Number(raw) });
          if (ELEV_LAYER.test(gs(r, 8))) stats.text++;
        }
        break;
      }
    }
  }
  let good = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  const withZ = good.filter((p) => p.z !== 0);
  if (withZ.length >= 3) good = withZ;
  // Textos de cota: se usan cuando no hay puntos con Z, o cuando están en una capa de cotas.
  const zs = withZ.map((p) => p.z).sort((a, b) => a - b);
  const lo = zs.length ? zs[0]! - 50 : -Infinity;
  const hi = zs.length ? zs[zs.length - 1]! + 50 : Infinity;
  if (withZ.length < 3 || stats.text > 0) for (const t of texts) if (t.z > lo && t.z < hi && t.z !== 0) good.push(t);
  return good;
}

/** Lee un archivo de puntos PNEZD (o ENZ) separado por comas, punto y coma, tabuladores o espacios. */
export function parseCsvSurvey(text: string): P3[] {
  const out: P3[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.trim().split(/[;,\t ]+/).filter(Boolean);
    const nums = cells.map((c) => Number(c));
    if (cells.length < 3) continue;
    if (cells.length >= 4 && nums.slice(1, 4).every(Number.isFinite)) out.push({ x: nums[2]!, y: nums[1]!, z: nums[3]! });
    else if (nums.slice(0, 3).every(Number.isFinite)) out.push({ x: nums[0]!, y: nums[1]!, z: nums[2]! });
  }
  return out;
}

/** Une puntos repetidos y reduce a `max` puntos con una rejilla, conservando la extensión. */
export function thinPoints(points: readonly P3[], max = 6000, tol = 0.02): P3[] {
  let cell = tol;
  const bb = bounds(points);
  const area = Math.max((bb.maxX - bb.minX) * (bb.maxY - bb.minY), 1e-6);
  for (;;) {
    const seen = new Map<string, P3>();
    for (const p of points) {
      const k = `${Math.round(p.x / cell)},${Math.round(p.y / cell)}`;
      if (!seen.has(k)) seen.set(k, p);
    }
    if (seen.size <= max) return [...seen.values()];
    cell = Math.max(cell * 1.5, Math.sqrt(area / max) * 0.7);
  }
}

export function bounds(points: readonly { x: number; y: number }[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Lee un levantamiento (DXF o puntos) y lo deja en coordenadas locales. */
export function readSurvey(text: string, source: string): Survey {
  const isDxf = /\.dxf$/i.test(source) || /^\s*0\s*\r?\n\s*SECTION/m.test(text.slice(0, 2000));
  const raw = isDxf ? parseDxfSurvey(text) : parseCsvSurvey(text);
  if (raw.length < 3) throw new Error("No se encontraron puntos con cota en el archivo. Se necesitan al menos 3 (puntos, polilíneas 3D o curvas de nivel con elevación).");
  const thin = thinPoints(raw);
  const bb = bounds(thin);
  const origin = { x: Math.floor(bb.minX), y: Math.floor(bb.minY) };
  const points = thin.map((p) => ({ x: round3(p.x - origin.x), y: round3(p.y - origin.y), z: round3(p.z) }));
  const zs = points.map((p) => p.z);
  return { points, origin, source, stats: { leidos: raw.length, usados: points.length, zMin: Math.min(...zs), zMax: Math.max(...zs) } };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

// ─── Modelo digital del terreno (TIN de Delaunay) ────────────

export interface Tin {
  readonly points: readonly P3[];
  /** Triángulos como índices de `points` (antihorario). */
  readonly tris: readonly (readonly [number, number, number])[];
}

/** Triangulación de Delaunay (Bowyer-Watson) con recorte de triángulos largos del borde (casco cóncavo). */
export function delaunay(points: readonly P3[]): Tin {
  const n = points.length;
  const bb = bounds(points);
  const d = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) || 1;
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  const P: { x: number; y: number }[] = points.map((p) => ({ x: p.x, y: p.y }));
  P.push({ x: cx - 20 * d, y: cy - d }, { x: cx, y: cy + 20 * d }, { x: cx + 20 * d, y: cy - d });
  type T = { a: number; b: number; c: number; x: number; y: number; r2: number };
  const circ = (a: number, b: number, c: number): T => {
    const A = P[a]!,
      B = P[b]!,
      C = P[c]!;
    const D = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
    const a2 = A.x * A.x + A.y * A.y,
      b2 = B.x * B.x + B.y * B.y,
      c2 = C.x * C.x + C.y * C.y;
    const x = (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / D;
    const y = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / D;
    return { a, b, c, x, y, r2: (A.x - x) ** 2 + (A.y - y) ** 2 };
  };
  // Inserción en orden espacial (rejilla en serpentina) para que la búsqueda sea local.
  const order = [...Array(n).keys()];
  const gsz = Math.max(1, Math.ceil(Math.sqrt(n / 4)));
  const key = (i: number) => {
    const gx = Math.min(gsz - 1, Math.floor(((P[i]!.x - bb.minX) / d) * gsz));
    const gy = Math.min(gsz - 1, Math.floor(((P[i]!.y - bb.minY) / d) * gsz));
    return gy * gsz + (gy % 2 ? gsz - 1 - gx : gx);
  };
  order.sort((i, j) => key(i) - key(j));
  let tris: T[] = [circ(n, n + 1, n + 2)];
  for (const i of order) {
    const p = P[i]!;
    const bad: T[] = [];
    const keep: T[] = [];
    for (const t of tris) ((p.x - t.x) ** 2 + (p.y - t.y) ** 2 < t.r2 * (1 + 1e-12) ? bad : keep).push(t);
    const edges = new Map<string, [number, number]>();
    for (const t of bad)
      for (const [u, v] of [
        [t.a, t.b],
        [t.b, t.c],
        [t.c, t.a],
      ] as [number, number][]) {
        const k = u < v ? `${u},${v}` : `${v},${u}`;
        if (edges.has(k)) edges.delete(k);
        else edges.set(k, [u, v]);
      }
    for (const [u, v] of edges.values()) keep.push(circ(u, v, i));
    tris = keep;
  }
  let out = tris.filter((t) => t.a < n && t.b < n && t.c < n).map((t) => [t.a, t.b, t.c] as [number, number, number]);
  // Orientación antihoraria.
  out = out.map(([a, b, c]) => {
    const A = P[a]!,
      B = P[b]!,
      C = P[c]!;
    return (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) < 0 ? [a, c, b] : [a, b, c];
  });
  // Recorte del borde: se quitan, de afuera hacia adentro, triángulos de borde con lados muy largos.
  const len = (i: number, j: number) => Math.hypot(P[i]!.x - P[j]!.x, P[i]!.y - P[j]!.y);
  const all = out.flatMap(([a, b, c]) => [len(a, b), len(b, c), len(c, a)]).sort((x, y) => x - y);
  const limit = (all[Math.floor(all.length / 2)] ?? 1) * 8;
  for (let pass = 0; pass < 50; pass++) {
    const count = new Map<string, number>();
    const ek = (i: number, j: number) => (i < j ? `${i},${j}` : `${j},${i}`);
    for (const [a, b, c] of out) for (const k of [ek(a, b), ek(b, c), ek(c, a)]) count.set(k, (count.get(k) ?? 0) + 1);
    const before = out.length;
    out = out.filter(([a, b, c]) => {
      for (const [i, j] of [
        [a, b],
        [b, c],
        [c, a],
      ] as [number, number][])
        if (count.get(ek(i, j)) === 1 && len(i, j) > limit) return false;
      return true;
    });
    if (out.length === before) break;
  }
  return { points, tris: out };
}

/** Índice espacial de triángulos para consultar cotas rápido. */
export class Terrain {
  readonly tin: Tin;
  private readonly grid = new Map<number, number[]>();
  private readonly cell: number;
  readonly box: { minX: number; minY: number; maxX: number; maxY: number };
  readonly zMin: number;
  readonly zMax: number;

  constructor(readonly survey: Survey) {
    this.tin = delaunay(survey.points);
    this.box = bounds(survey.points);
    const zs = survey.points.map((p) => p.z);
    this.zMin = Math.min(...zs);
    this.zMax = Math.max(...zs);
    const w = this.box.maxX - this.box.minX || 1;
    const h = this.box.maxY - this.box.minY || 1;
    this.cell = Math.sqrt((w * h) / Math.max(this.tin.tris.length, 1)) * 2;
    this.tin.tris.forEach((t, i) => {
      const ps = t.map((k) => this.tin.points[k]!);
      const b = bounds(ps);
      for (let gx = this.gi(b.minX); gx <= this.gi(b.maxX); gx++) for (let gy = this.gi(b.minY); gy <= this.gi(b.maxY); gy++) {
        const k = gx * 100003 + gy;
        let l = this.grid.get(k);
        if (!l) this.grid.set(k, (l = []));
        l.push(i);
      }
    });
  }

  private gi(v: number): number {
    return Math.floor(v / this.cell);
  }

  /** Cota del terreno en (x, y) locales, o undefined fuera del levantamiento. */
  z(x: number, y: number): number | undefined {
    const l = this.grid.get(this.gi(x) * 100003 + this.gi(y));
    if (!l) return undefined;
    for (const i of l) {
      const [a, b, c] = this.tin.tris[i]!;
      const A = this.tin.points[a]!,
        B = this.tin.points[b]!,
        C = this.tin.points[c]!;
      const det = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
      if (Math.abs(det) < 1e-12) continue;
      const l1 = ((B.y - C.y) * (x - C.x) + (C.x - B.x) * (y - C.y)) / det;
      const l2 = ((C.y - A.y) * (x - C.x) + (A.x - C.x) * (y - C.y)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * A.z + l2 * B.z + l3 * C.z;
    }
    return undefined;
  }

  /** Intervalo de curvas "bonito" para unas 15 a 40 curvas. */
  contourInterval(): number {
    const range = this.zMax - this.zMin;
    for (const s of [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50]) if (range / s <= 40) return s;
    return 100;
  }

  /** Curvas de nivel como polilíneas (unidas por sus extremos). */
  contours(step = this.contourInterval()): { z: number; major: boolean; lines: P3[][] }[] {
    const out: { z: number; major: boolean; lines: P3[][] }[] = [];
    const P = this.tin.points;
    for (let z = Math.ceil(this.zMin / step) * step; z <= this.zMax + 1e-9; z += step) {
      const zz = Math.round(z * 1000) / 1000;
      const segs: [P3, P3][] = [];
      for (const [a, b, c] of this.tin.tris) {
        const cut: P3[] = [];
        for (const [i, j] of [
          [a, b],
          [b, c],
          [c, a],
        ] as [number, number][]) {
          const A = P[i]!,
            B = P[j]!;
          const za = A.z === zz ? zz + 1e-7 : A.z;
          const zb = B.z === zz ? zz + 1e-7 : B.z;
          if ((za - zz) * (zb - zz) < 0) {
            const t = (zz - za) / (zb - za);
            cut.push({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t, z: zz });
          }
        }
        if (cut.length === 2) segs.push([cut[0]!, cut[1]!]);
      }
      out.push({ z: zz, major: Math.abs(zz / (step * 5) - Math.round(zz / (step * 5))) < 1e-6, lines: joinSegments(segs) });
    }
    return out;
  }
}

function joinSegments(segs: [P3, P3][]): P3[][] {
  const k = (p: P3) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
  const ends = new Map<string, number[]>();
  segs.forEach(([a, b], i) => {
    for (const p of [a, b]) {
      const key = k(p);
      const l = ends.get(key);
      if (l) l.push(i);
      else ends.set(key, [i]);
    }
  });
  const used = new Uint8Array(segs.length);
  const lines: P3[][] = [];
  const next = (p: P3): [P3, P3] | undefined => {
    for (const i of ends.get(k(p)) ?? []) {
      if (used[i]) continue;
      used[i] = 1;
      const [a, b] = segs[i]!;
      return k(a) === k(p) ? [a, b] : [b, a];
    }
    return undefined;
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line = [segs[i]![0], segs[i]![1]];
    for (let s = next(line[line.length - 1]!); s; s = next(line[line.length - 1]!)) line.push(s[1]);
    for (let s = next(line[0]!); s; s = next(line[0]!)) line.unshift(s[1]);
    lines.push(line);
  }
  return lines;
}

// ─── Implantación y movimiento de tierras ────────────────────

export interface Placement {
  /** Posición (locales del levantamiento) del origen del modelo de la casa. */
  readonly x: number;
  readonly y: number;
  /** Giro de la casa en grados, antihorario. */
  readonly rotDeg: number;
  /** Cota del nivel de piso terminado (NPT ±0.00), absoluta. */
  readonly npt: number;
}

/** Punto del modelo de la casa → coordenadas locales del levantamiento. */
export function toSite(pl: Placement, p: { x: number; y: number }): { x: number; y: number } {
  const a = (pl.rotDeg * Math.PI) / 180;
  return { x: pl.x + p.x * Math.cos(a) - p.y * Math.sin(a), y: pl.y + p.x * Math.sin(a) + p.y * Math.cos(a) };
}

/** Coordenadas locales del levantamiento → modelo de la casa. */
export function toModel(pl: Placement, p: { x: number; y: number }): { x: number; y: number } {
  const a = (-pl.rotDeg * Math.PI) / 180;
  const dx = p.x - pl.x;
  const dy = p.y - pl.y;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

export interface Earthwork {
  /** Área de la plataforma (m²) y área fuera del levantamiento. */
  readonly area: number;
  readonly outside: number;
  readonly zMin: number;
  readonly zMax: number;
  readonly zMean: number;
  /** Cota de la plataforma (subrasante) = NPT − espesor del piso. */
  readonly platform: number;
  readonly cut: number;
  readonly fill: number;
  /** NPT que equilibra corte y lleno (redondeado a 5 cm), con el mismo espesor de piso. */
  readonly balancedNpt: number;
  /** Pendiente media del terreno bajo la casa (%). */
  readonly slopePct: number;
  /** Cotas del terreno en las esquinas de la plataforma (modelo → terreno). */
  readonly corners: readonly { x: number; y: number; zTerrain: number | undefined }[];
}

/**
 * Movimiento de tierras para una plataforma horizontal bajo la huella `poly` (coordenadas del modelo):
 * se muestrea el terreno en una malla de `cell` m y se integra la diferencia con la subrasante.
 */
export function earthwork(t: Terrain, pl: Placement, poly: readonly { x: number; y: number }[], floorThk = 0.35, cell = 0.25): Earthwork {
  const bb = bounds(poly);
  const inside = (x: number, y: number) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!,
        b = poly[j]!;
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  const platform = pl.npt - floorThk;
  const zs: number[] = [];
  let cut = 0,
    fill = 0,
    outside = 0,
    area = 0;
  let sx = 0,
    sy = 0,
    sz = 0,
    sxx = 0,
    syy = 0,
    sxy = 0,
    sxz = 0,
    syz = 0;
  for (let x = bb.minX + cell / 2; x < bb.maxX; x += cell)
    for (let y = bb.minY + cell / 2; y < bb.maxY; y += cell) {
      if (!inside(x, y)) continue;
      const a = cell * cell;
      area += a;
      const s = toSite(pl, { x, y });
      const z = t.z(s.x, s.y);
      if (z === undefined) {
        outside += a;
        continue;
      }
      zs.push(z);
      if (z > platform) cut += (z - platform) * a;
      else fill += (platform - z) * a;
      sx += s.x;
      sy += s.y;
      sz += z;
      sxx += s.x * s.x;
      syy += s.y * s.y;
      sxy += s.x * s.y;
      sxz += s.x * z;
      syz += s.y * z;
    }
  const n = zs.length;
  const zMean = n ? sz / n : NaN;
  // Plano de mejor ajuste z = a·x + b·y + c → pendiente = |∇z|.
  let slopePct = 0;
  if (n >= 3) {
    const mx = sx / n,
      my = sy / n,
      mz = sz / n;
    const cxx = sxx / n - mx * mx,
      cyy = syy / n - my * my,
      cxy = sxy / n - mx * my,
      cxz = sxz / n - mx * mz,
      cyz = syz / n - my * mz;
    const det = cxx * cyy - cxy * cxy;
    if (Math.abs(det) > 1e-12) slopePct = Math.hypot((cxz * cyy - cyz * cxy) / det, (cyz * cxx - cxz * cxy) / det) * 100;
  }
  const corners = poly.map((p) => {
    const s = toSite(pl, p);
    return { x: p.x, y: p.y, zTerrain: t.z(s.x, s.y) };
  });
  return {
    area,
    outside,
    zMin: n ? Math.min(...zs) : NaN,
    zMax: n ? Math.max(...zs) : NaN,
    zMean,
    platform,
    cut,
    fill,
    balancedNpt: n ? Math.round((zMean + floorThk) * 20) / 20 : pl.npt,
    slopePct,
    corners,
  };
}

/** Implantación inicial: casa centrada en el levantamiento, NPT equilibrado. */
export function defaultPlacement(t: Terrain, house: { minX: number; minY: number; maxX: number; maxY: number }): Placement {
  const cx = (t.box.minX + t.box.maxX) / 2 - (house.minX + house.maxX) / 2;
  const cy = (t.box.minY + t.box.maxY) / 2 - (house.minY + house.maxY) / 2;
  const base = { x: cx, y: cy, rotDeg: 0, npt: 0 };
  const poly = [
    { x: house.minX, y: house.minY },
    { x: house.maxX, y: house.minY },
    { x: house.maxX, y: house.maxY },
    { x: house.minX, y: house.maxY },
  ];
  const ew = earthwork(t, base, poly);
  return { ...base, npt: Number.isFinite(ew.balancedNpt) ? ew.balancedNpt : (t.zMin + t.zMax) / 2 };
}

// ─── Persistencia compacta (en las propiedades del proyecto) ──

export function encodeSurvey(s: Survey): string {
  return JSON.stringify({ o: [s.origin.x, s.origin.y], s: s.source, p: s.points.flatMap((p) => [p.x, p.y, p.z]) });
}

export function decodeSurvey(json: string): Survey | undefined {
  try {
    const d = JSON.parse(json) as { o: [number, number]; s: string; p: number[] };
    const points: P3[] = [];
    for (let i = 0; i + 2 < d.p.length; i += 3) points.push({ x: d.p[i]!, y: d.p[i + 1]!, z: d.p[i + 2]! });
    if (points.length < 3) return undefined;
    const zs = points.map((p) => p.z);
    return { points, origin: { x: d.o[0], y: d.o[1] }, source: d.s, stats: { leidos: points.length, usados: points.length, zMin: Math.min(...zs), zMax: Math.max(...zs) } };
  } catch {
    return undefined;
  }
}

/** Levantamiento de ejemplo (ladera hacia el occidente, como en el Alto de Las Palmas) en formato DXF. */
export function sampleSurveyDxf(): string {
  const L: string[] = ["0", "SECTION", "2", "ENTITIES"];
  const E0 = 836420,
    N0 = 1175310;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.08;
  for (let i = 0; i <= 18; i++)
    for (let j = 0; j <= 20; j++) {
      const x = i * 2.5 + (j % 2) * 0.6;
      const y = j * 2.5;
      const z = 2478 + x * 0.115 + y * 0.03 + 0.6 * Math.sin(x / 9) * Math.cos(y / 14) + rnd();
      L.push("0", "POINT", "8", "PUNTOS", "10", (E0 + x).toFixed(3), "20", (N0 + y).toFixed(3), "30", z.toFixed(3));
    }
  L.push("0", "ENDSEC", "0", "EOF");
  return L.join("\r\n");
}
