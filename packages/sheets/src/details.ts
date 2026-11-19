// Planos de detalle generados desde el modelo (Paso 9):
//  - Fachadas por estilo (varios pisos y cubiertas plana, a una, dos y cuatro aguas)
//  - Cortes longitudinal y transversal
//  - Carpintería: cuadro y alzados de puertas y de ventanas
//  - Clósets y muebles en madera (alzados y especificación)
//  - Cuadros de acabados por espacio

import { getOfKind, polygonArea, type Device, type Door, type Level, type ModelReader, type Opening, type PropertyValue, type SheetBlock, type Space, type Wall, type Window } from "@arken/core";
import type { Table } from "@arken/calc";
import { drawTable, type Pen } from "./index";

const BRAND = "#142339";
const INK = "#1a1d21";
const GLASS = "#cfe2f1";

type Props = Readonly<Record<string, PropertyValue>>;
const num = (p: Props, k: string, d: number) => (typeof p[k] === "number" ? (p[k] as number) : typeof p[k] === "string" && p[k] !== "" && !isNaN(Number(p[k])) ? Number(p[k]) : d);
const str = (p: Props, k: string, d: string) => (typeof p[k] === "string" ? (p[k] as string) : d);
const fmt = (n: number) => n.toFixed(2);

function projectProps(reader: ModelReader): Props {
  for (const e of reader.entities()) if (e.kind === "Project") return e.properties ?? {};
  return {};
}

function levelOf(reader: ModelReader, id: string): Level | undefined {
  const l = reader.indices.levelOfElement(id);
  const e = l ? reader.getEntity(l) : undefined;
  return e && e.kind === "Level" ? e : undefined;
}

interface Hole {
  u0: number;
  u1: number;
  z0: number;
  h: number;
  door: boolean;
  main: boolean;
}

// ─── Geometría de la cubierta vista en fachada ───────────────

interface RoofView {
  /** Altura de la cara superior del muro en u (para frontones). */
  wallTop: (u: number) => number;
  /** Polígonos de cubierta (u, z). */
  roof: [number, number][][];
  /** Alturas notables (para las cotas de nivel). */
  marks: number[];
}

function roofView(face: "S" | "N" | "E" | "W", width: number, W: number, L: number, H: number, type: string, slope: number, eave: number, t: number, high: "S" | "N" | "E" | "W" = "W"): RoofView {
  const along = face === "S" || face === "N"; // la fachada mira el ancho W
  const s = slope / 100;
  if (type === "plana") {
    return { wallTop: () => H + 0.9, roof: [[[-0.05, H], [width + 0.05, H], [width + 0.05, H + 0.35], [-0.05, H + 0.35]]], marks: [H, H + 0.9] };
  }
  if (type === "una-agua") {
    // Borde alto en la fachada `high`; la cubierta cae hacia la opuesta.
    const xAxis = high === "W" || high === "E";
    const span = xAxis ? W : L;
    if (along === xAxis) {
      // La pendiente se ve inclinada: u recorre la dirección de la pendiente.
      const distOf = (u: number) => {
        const x = face === "S" ? u : face === "N" ? W - u : 0;
        const y = face === "E" ? u : face === "W" ? L - u : 0;
        return high === "W" ? x : high === "E" ? W - x : high === "S" ? y : L - y;
      };
      const zE = (u: number) => H + s * (span - distOf(u));
      const p: [number, number][] = [[-eave, zE(-eave)], [width + eave, zE(width + eave)], [width + eave, zE(width + eave) + t], [-eave, zE(-eave) + t]];
      return { wallTop: zE, roof: [p], marks: [H, H + s * span] };
    }
    const top = face === high ? H + s * span : H;
    const eaveZ = face === high ? top + s * eave : top - s * eave;
    const far = face === high ? top : H + s * span;
    return { wallTop: () => top, roof: [[[-eave, eaveZ], [width + eave, eaveZ], [width + eave, Math.max(eaveZ, far) + t], [-eave, Math.max(eaveZ, far) + t]]], marks: [top] };
  }
  const ridgeAlongY = L >= W;
  if (type === "dos-aguas") {
    const span = ridgeAlongY ? W : L;
    const ridge = H + (s * span) / 2;
    const gableFace = ridgeAlongY ? along : !along;
    if (gableFace) {
      const z = (u: number) => H + s * (span / 2 - Math.abs(u - span / 2));
      const pL: [number, number][] = [[-eave, z(0) - s * eave], [span / 2, ridge], [span / 2, ridge + t], [-eave, z(0) - s * eave + t]];
      const pR: [number, number][] = [[span / 2, ridge], [width + eave, z(width) - s * eave], [width + eave, z(width) - s * eave + t], [span / 2, ridge + t]];
      return { wallTop: z, roof: [pL, pR], marks: [H, ridge] };
    }
    return { wallTop: () => H, roof: [[[-eave, H - s * eave], [width + eave, H - s * eave], [width + eave, ridge + t], [-eave, ridge + t]]], marks: [H, ridge] };
  }
  // Cuatro aguas
  const hmin = Math.min(W, L) / 2;
  const ridge = H + s * hmin;
  const longFace = ridgeAlongY ? !along : along; // fachada paralela a la cumbrera
  const z0 = H - s * eave;
  if (longFace) {
    const r = Math.abs(L - W) / 2;
    const c = width / 2;
    return { wallTop: () => H, roof: [[[-eave, z0], [width + eave, z0], [c + r, ridge + t], [c - r, ridge + t]]], marks: [H, ridge] };
  }
  return { wallTop: () => H, roof: [[[-eave, z0], [width + eave, z0], [width / 2, ridge + t]]], marks: [H, ridge] };
}

// ─── Texturas de materiales ──────────────────────────────────

function hatch(p: Pen, kind: string, poly: [number, number][], X: (u: number) => number, Y: (z: number) => number, color: string, mm: number): void {
  const xs = poly.map(([u]) => u);
  const zs = poly.map(([, z]) => z);
  const u0 = Math.min(...xs),
    u1 = Math.max(...xs),
    z0 = Math.min(...zs),
    z1 = Math.max(...zs);
  const ink = { weight: 0.06, color };
  // Las texturas se dibujan en un rectángulo; el polígono del muro las limita a su silueta en la
  // mayoría de los casos (los frontones se completan con el relleno del muro).
  const inside = (u: number, z: number) => pointIn(poly, u, z);
  const seg = (a: [number, number], b: [number, number]) => {
    if (inside(...a) && inside(...b)) p.line([[X(a[0]), Y(a[1])], [X(b[0]), Y(b[1])]], ink);
  };
  if (kind === "ladrillo") {
    const course = Math.max(0.15, 1.2 / mm);
    let row = 0;
    for (let z = z0 + course; z < z1; z += course, row++) {
      seg([u0, z], [u1, z]);
      for (let u = u0 + (row % 2 ? 0.15 : 0); u < u1; u += 0.3) seg([u, z - course], [u, z]);
    }
  } else if (kind === "piedra") {
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let z = z0; z < z1; z += 0.35) {
      seg([u0, z], [u1, z]);
      for (let u = u0 + rnd() * 0.4; u < u1; u += 0.35 + rnd() * 0.45) seg([u, z], [u + 0.05, z + 0.35]);
    }
  } else if (kind === "madera") {
    for (let u = u0 + 0.12; u < u1; u += 0.12) seg([u, z0], [u, z1]);
  } else if (kind === "concreto") {
    for (let z = z0 + 0.6; z < z1; z += 0.6) seg([u0, z], [u1, z]);
    for (let u = u0 + 1.2; u < u1; u += 1.2) seg([u, z0], [u, z1]);
    for (let z = z0 + 0.3; z < z1; z += 0.6) for (let u = u0 + 0.3; u < u1; u += 0.6) if (inside(u, z)) p.circle(X(u), Y(z), 0.25, { weight: 0.05, color });
  }
}

function pointIn(poly: [number, number][], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) c = !c;
  }
  return c;
}

function roofTexture(p: Pen, mat: string, poly: [number, number][], X: (u: number) => number, Y: (z: number) => number): void {
  const xs = poly.map(([u]) => u);
  const zs = poly.map(([, z]) => z);
  const u0 = Math.min(...xs),
    u1 = Math.max(...xs),
    z0 = Math.min(...zs),
    z1 = Math.max(...zs);
  const ink = { weight: 0.07, color: "#ffffff" };
  const segIn = (a: [number, number], b: [number, number]) => {
    // Recorta el segmento al polígono por muestreo (suficiente para texturas).
    const n = 24;
    let run: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const q: [number, number] = [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n];
      if (pointIn(poly, q[0], q[1])) run.push(q);
      else if (run.length > 1) p.line(run.map(([u, z]) => [X(u), Y(z)]), ink), (run = []);
      else run = [];
    }
    if (run.length > 1) p.line(run.map(([u, z]) => [X(u), Y(z)]), ink);
  };
  if (mat === "teja") for (let z = z0 + 0.12; z < z1; z += 0.18) segIn([u0, z], [u1, z]);
  else if (mat === "lamina") for (let u = u0 + 0.25; u < u1; u += 0.25) segIn([u, z0], [u, z1]);
  else if (mat === "paja-sintetica") for (let u = u0; u < u1; u += 0.12) segIn([u, z0], [u + 0.08, z1]);
}

// ─── Fachadas ────────────────────────────────────────────────

/** Volumen de la casa para fachadas: un pabellón o una galería (coordenadas globales de las caras). */
interface Vol {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  floors: number;
  type: string;
  high: "S" | "N" | "E" | "W";
  galeria: boolean;
}

function volumes(pr: Props): Vol[] {
  const type = str(pr, "cubierta_tipo", "dos-aguas");
  try {
    const raw = JSON.parse(str(pr, "volumenes", "")) as Partial<Vol>[];
    if (Array.isArray(raw) && raw.length)
      return raw.map((r) => ({ x0: r.x0 ?? 0, y0: r.y0 ?? 0, x1: r.x1 ?? 1, y1: r.y1 ?? 1, floors: r.floors ?? 1, type: r.galeria ? "plana" : r.type ?? type, high: r.high ?? "W", galeria: !!r.galeria }));
  } catch {
    /* modelo sin volúmenes: una sola barra */
  }
  return [{ x0: num(pr, "casa_xmin", 0), y0: num(pr, "casa_ymin", 0), x1: num(pr, "casa_xmax", 12), y1: num(pr, "casa_ymax", 15), floors: num(pr, "pisos", 1), type, high: "W", galeria: false }];
}

export function drawStyledElevations(p: Pen, reader: ModelReader, b: SheetBlock): void {
  const pr = projectProps(reader);
  const vols = volumes(pr);
  const X0 = Math.min(...vols.map((v) => v.x0));
  const X1 = Math.max(...vols.map((v) => v.x1));
  const Y0 = Math.min(...vols.map((v) => v.y0));
  const Y1 = Math.max(...vols.map((v) => v.y1));
  const W = X1 - X0;
  const L = Y1 - Y0;
  const floorsMax = Math.max(...vols.map((v) => v.floors));
  const fh = num(pr, "altura_piso_m", 3);
  const slope = num(pr, "cubierta_pendiente_pct", 30);
  const eave = num(pr, "cubierta_alero_m", 0.9);
  const t = num(pr, "cubierta_espesor_m", 0.25);
  const cellW = b.w / 2;
  const cellH = (b.h - 8) / 2;
  const cp = { x0: num(pr, "parqueadero_xmin", NaN), x1: num(pr, "parqueadero_xmax", NaN), y0: num(pr, "parqueadero_ymin", NaN), y1: num(pr, "parqueadero_ymax", NaN), h: num(pr, "parqueadero_altura_m", 2.8) };
  const hasCp = Number.isFinite(cp.x0);
  // Escala: la mayor escala normalizada con la que las cuatro fachadas caben en su casilla.
  const spanX = W + 2 * eave + 1 + (hasCp ? Math.max(0, X0 - cp.x0) + Math.max(0, cp.x1 - X1) : 0);
  const spanY = L + 2 * eave + 1;
  const tall = Math.max(...vols.map((v) => v.floors * fh + Math.max(v.x1 - v.x0, v.y1 - v.y0) * (slope / 100) * 0.5)) + 1.2;
  const fitMm = Math.min((cellW - 40) / Math.max(spanX, spanY), (cellH - 26) / tall);
  const scale = [50, 75, 100, 125, 150, 200, 250].find((sc) => 1000 / sc <= fitMm) ?? 250;
  const mm = 1000 / scale;
  const wallColor = str(pr, "estilo_muro_color", "#ece6da");
  const wallKind = str(pr, "estilo_muro", "estuco");
  const accent = str(pr, "estilo_acento", "madera");
  const accentColor = str(pr, "estilo_acento_color", "#9a6a43");
  const base = str(pr, "estilo_base", "piedra");
  const roofColor = str(pr, "estilo_cubierta_color", "#4a4f55");
  const roofMat = str(pr, "estilo_cubierta_material", "lamina");
  const frame = str(pr, "estilo_marco_color", "#2b2f33");
  const celosias = pr["estilo_celosias"] === true;

  const walls: Wall[] = [];
  for (const e of reader.entities()) if (e.kind === "Wall" && typeof e.properties?.["fachada"] === "string") walls.push(e);
  const faces: { key: "S" | "W" | "N" | "E"; name: string }[] = [
    { key: "S", name: "FACHADA PRINCIPAL (SUR)" },
    { key: "W", name: "FACHADA OCCIDENTAL" },
    { key: "N", name: "FACHADA POSTERIOR (NORTE)" },
    { key: "E", name: "FACHADA ORIENTAL" },
  ];
  p.text(b.title ?? `FACHADAS · ${str(pr, "estilo_nombre", "").toUpperCase()} · ESCALA 1:${scale}`, b.x, b.y + b.h - 3, 2.6, "left", true, BRAND);
  const fill = (pts: [number, number][], color: string) => p.out.push({ kind: "polygon", points: pts.map(([x, y]) => p.w(x, y)), style: "hoja", fill: "solid", color, weight: 0 });

  faces.forEach((fc, i) => {
    const along = fc.key === "S" || fc.key === "N";
    const width = along ? W : L;
    // u: coordenada horizontal de la fachada (de izquierda a derecha según se mira).
    const toU = (x: number, y: number) => (fc.key === "S" ? x - X0 : fc.key === "N" ? X1 - x : fc.key === "E" ? y - Y0 : Y1 - y);
    // Profundidad: mayor = más lejos del observador.
    const depthOf = (v: Vol) => (fc.key === "S" ? v.y0 : fc.key === "N" ? -v.y1 : fc.key === "E" ? -v.x1 : v.x0);
    const views = vols.map((v) => {
      const vu0 = Math.min(toU(v.x0, v.y0), toU(v.x1, v.y1));
      const vw = along ? v.x1 - v.x0 : v.y1 - v.y0;
      const Hv = v.floors * fh;
      const rv = roofView(fc.key, vw, v.x1 - v.x0, v.y1 - v.y0, Hv, v.type, v.galeria ? 1 : slope, v.galeria ? 0 : v.type === "plana" ? 0 : eave, v.galeria ? 0.3 : t, v.high);
      if (v.galeria) rv.wallTop = () => Hv + 0.35;
      return { v, vu0, vw, Hv, rv };
    });
    let uL = -eave - 0.5,
      uR = width + eave + 0.5;
    if (hasCp && along) {
      const a = toU(cp.x0, 0),
        c = toU(cp.x1, 0);
      uL = Math.min(uL, a, c);
      uR = Math.max(uR, a, c);
    }
    const top = Math.max(...views.flatMap((w) => [...w.rv.roof.flat().map(([, z]) => z), w.rv.wallTop(w.vw / 2)]));
    const drawW = (uR - uL) * mm;
    const col = i % 2,
      row = Math.floor(i / 2);
    const cx0 = b.x + col * cellW + 22 + (cellW - 30 - drawW) / 2 - uL * mm;
    const cy0 = b.y + (1 - row) * cellH + (cellH - top * mm) / 2 + 5;
    const Y = (z: number) => cy0 + z * mm;
    const zb = 0.6;

    for (const { v, vu0, vw, Hv, rv } of [...views].sort((a, c) => depthOf(c.v) - depthOf(a.v))) {
      const X = (u: number) => cx0 + (vu0 + u) * mm;
      const floors = v.floors;
      // Muro (con frontón si la cubierta lo genera)
      const N = 40;
      const wallPoly: [number, number][] = [[0, 0]];
      for (let k = 0; k <= N; k++) wallPoly.push([(vw * k) / N, rv.wallTop((vw * k) / N)]);
      wallPoly.push([vw, 0]);
      fill(wallPoly.map(([u, z]) => [X(u), Y(z)]), v.galeria ? "#e9ecee" : wallColor);
      if (wallKind !== "estuco" && !v.galeria) hatch(p, wallKind, wallPoly, X, Y, "#5c4a3c", mm);
      // Zócalo
      fill([[X(0), Y(0)], [X(vw), Y(0)], [X(vw), Y(zb)], [X(0), Y(zb)]], base === "piedra" ? "#9a958a" : base === "ladrillo" ? "#9c4e33" : base === "concreto" ? "#b4b2ac" : "#d9d3c6");
      if (base !== "estuco") hatch(p, base, [[0, 0], [vw, 0], [vw, zb], [0, zb]], X, Y, "#4b463f", mm);
      // Entrepisos
      for (let f = 1; f < floors; f++) {
        const z = f * fh;
        if (accent === "concreto") fill([[X(0), Y(z - 0.3)], [X(vw), Y(z - 0.3)], [X(vw), Y(z)], [X(0), Y(z)]], "#b9b7b1");
        else p.line([[X(0), Y(z - 0.12)], [X(vw), Y(z - 0.12)]], { weight: 0.12, color: "#6b6f74" });
      }
      p.line(wallPoly.map(([u, z]) => [X(u), Y(z)]), { weight: 0.5 });

      // Vanos de todos los pisos en los muros de esta fachada que pertenecen al volumen
      const holes: Hole[] = [];
      const inVol = (w: Wall) => {
        const mx = (w.start.x + w.end.x) / 2,
          my = (w.start.y + w.end.y) / 2;
        return mx >= v.x0 - 0.05 && mx <= v.x1 + 0.05 && my >= v.y0 - 0.05 && my <= v.y1 + 0.05;
      };
      for (const w of walls.filter((x) => x.properties?.["fachada"] === fc.key && inVol(x))) {
        const z0 = levelOf(reader, w.id)?.elevation ?? 0;
        const Lw = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
        const ux = (w.end.x - w.start.x) / Lw,
          uy = (w.end.y - w.start.y) / Lw;
        for (const oid of reader.indices.openingsOfHost(w.id) ?? []) {
          const o = getOfKind(reader, oid, "Opening") as Opening | undefined;
          if (!o) continue;
          const a = { x: w.start.x + ux * o.offsetAlongAxis, y: w.start.y + uy * o.offsetAlongAxis };
          const c = { x: a.x + ux * o.width, y: a.y + uy * o.width };
          const fl = reader.getEntity(reader.indices.fillingOfOpening(oid) ?? "");
          const u0 = Math.min(toU(a.x, a.y), toU(c.x, c.y)) - vu0;
          holes.push({ u0, u1: u0 + o.width, z0: z0 + o.sillHeight, h: o.height, door: fl?.kind === "Door", main: fl?.kind === "Door" && fl.properties?.["principal"] === true });
        }
      }
      // Acento: revestimiento alrededor del acceso.
      const main = holes.find((h) => h.main);
      if (main && accent !== "concreto" && accent !== "estuco") {
        const a0 = Math.max(0, main.u0 - 1.2),
          a1 = Math.min(vw, main.u1 + 1.2);
        const poly: [number, number][] = [[a0, zb], [a1, zb], [a1, fh], [a0, fh]];
        fill(poly.map(([u, z]) => [X(u), Y(z)]), accentColor);
        hatch(p, accent === "celosia" ? "madera" : accent, poly, X, Y, "#3d2a1c", mm);
      }
      if (accent === "concreto" && floors > 1) {
        // Volumen superior enmarcado en concreto
        fill([[X(-0.15), Y(Hv - 0.35)], [X(vw + 0.15), Y(Hv - 0.35)], [X(vw + 0.15), Y(Hv)], [X(-0.15), Y(Hv)]], "#a9a8a3");
      }
      for (const h of holes) {
        const x = X(h.u0),
          y = Y(h.z0),
          ww = (h.u1 - h.u0) * mm,
          hh = h.h * mm;
        if (h.door) {
          p.rect(x, y, ww, hh, { fill: "solid", color: h.main ? accentColor : "#8d949b", weight: 0 });
          if (h.main) for (let k = 1; k < 6; k++) p.line([[x + (ww * k) / 6, y], [x + (ww * k) / 6, y + hh]], { weight: 0.08, color: "#3d2a1c" });
          p.rect(x, y, ww, hh, { weight: 0.35, color: frame });
        } else {
          p.rect(x, y, ww, hh, { fill: "solid", color: GLASS, weight: 0 });
          const parts = Math.max(1, Math.round((h.u1 - h.u0) / 1.2));
          for (let k = 1; k < parts; k++) p.line([[x + (ww * k) / parts, y], [x + (ww * k) / parts, y + hh]], { weight: 0.3, color: frame });
          for (let k = 0; k < parts; k++) p.line([[x + (ww * k) / parts + (ww / parts) * 0.15, y + hh * 0.2], [x + (ww * k) / parts + (ww / parts) * 0.45, y + hh * 0.55]], { weight: 0.1, color: "#ffffff" });
          p.rect(x, y, ww, hh, { weight: 0.4, color: frame });
          // Celosías corredizas frente a las habitaciones (vanos altos de pisos superiores)
          if (celosias && h.z0 >= fh - 0.01 && h.h >= 1.4) {
            const cw = (h.u1 - h.u0) * 0.5;
            const c0 = h.u1 - cw;
            p.rect(X(c0), y, cw * mm, hh, { fill: "solid", color: accentColor, weight: 0.2 });
            for (let u = c0 + 0.07; u < h.u1; u += 0.07) p.line([[X(u), y], [X(u), y + hh]], { weight: 0.05, color: "#3d2a1c" });
          }
        }
      }
      // Cubierta
      for (const poly of rv.roof) {
        fill(poly.map(([u, z]) => [X(u), Y(z)]), roofColor);
        if (!v.galeria) roofTexture(p, roofMat, poly, X, Y);
        p.line([...poly, poly[0]!].map(([u, z]) => [X(u), Y(z)]), { weight: 0.4, color: INK });
      }
    }
    const X = (u: number) => cx0 + u * mm;
    // Parqueadero cubierto
    if (hasCp) {
      if (along) {
        const a = Math.min(toU(cp.x0, 0), toU(cp.x1, 0)),
          c = Math.max(toU(cp.x0, 0), toU(cp.x1, 0));
        fill([[X(a), Y(cp.h)], [X(c), Y(cp.h)], [X(c), Y(cp.h + 0.18)], [X(a), Y(cp.h + 0.18)]], roofColor);
        const far = fc.key === "S" ? a + 0.15 : c - 0.15;
        p.rect(X(far) - 0.08 * mm, Y(0), 0.16 * mm, cp.h * mm, { weight: 0.25, fill: "solid", color: "#5c6670" });
      } else if (fc.key === "W") {
        const a = toU(cp.x0, cp.y1),
          c = toU(cp.x0, cp.y0);
        fill([[X(a), Y(cp.h)], [X(c), Y(cp.h)], [X(c), Y(cp.h + 0.18)], [X(a), Y(cp.h + 0.18)]], roofColor);
        for (const u of [a + 0.15, c - 0.15]) p.rect(X(u) - 0.08 * mm, Y(0), 0.16 * mm, cp.h * mm, { weight: 0.25, fill: "solid", color: "#5c6670" });
      }
    }
    // Terreno
    p.line([[X(uL - 0.5), Y(0)], [X(uR + 0.5), Y(0)]], { weight: 0.7 });
    for (let u = uL - 0.5; u < uR + 0.5; u += 0.6) p.line([[X(u), Y(0)], [X(u - 0.3), Y(-0.3)]], { weight: 0.1 });
    // Niveles
    const lx = X(uL) - 4;
    const marks = [...new Set([0, ...Array.from({ length: floorsMax - 1 }, (_, f) => (f + 1) * fh), ...views.flatMap((w) => (w.v.galeria ? [] : w.rv.marks))].map((z) => Math.round(z * 100) / 100))].sort((a, c) => a - c);
    for (const z of marks) {
      const ly = Y(z);
      p.out.push({ kind: "polygon", points: [p.w(lx, ly), p.w(lx - 1.2, ly + 1.8), p.w(lx + 1.2, ly + 1.8)], style: "hoja", fill: "solid", color: INK, weight: 0 });
      p.line([[lx - 3, ly], [lx + 3, ly]], { weight: 0.18 });
      p.text(z === 0 ? "NPT ±0.00" : `N+${fmt(z)}`, lx - 3.4, ly + 1.0, 1.7, "right");
    }
    const dy = Y(0) - 6;
    p.line([[X(0), dy], [X(width), dy]], { weight: 0.18 });
    for (const u of [0, width]) p.line([[X(u), dy - 1.2], [X(u), dy + 1.2]], { weight: 0.18 }).line([[X(u) - 0.8, dy - 0.8], [X(u) + 0.8, dy + 0.8]], { weight: 0.35 });
    p.text(fmt(width), X(width / 2), dy + 1.3, 1.8, "center");
    p.text(fc.name, X(width / 2), dy - 4.6, 2.5, "center", true);
  });
}

// ─── Cortes ──────────────────────────────────────────────────

export function drawSections(p: Pen, reader: ModelReader, b: SheetBlock): void {
  const pr = projectProps(reader);
  // Marco del corte: el pabellón cortado (sus coordenadas locales); por defecto, la casa entera.
  const turn = num(pr, "corte_giro", 0);
  const ox = num(pr, "corte_ox", 0);
  const oy = num(pr, "corte_oy", 0);
  const loc = (q: { x: number; y: number }) => (turn === 1 ? { x: q.y - oy, y: ox - q.x } : turn === 3 ? { x: oy - q.y, y: q.x - ox } : { x: q.x - ox, y: q.y - oy });
  const W = num(pr, "corte_W", num(pr, "casa_xmax", 12));
  const L = num(pr, "corte_L", num(pr, "casa_ymax", 15));
  const floors = num(pr, "corte_pisos", num(pr, "pisos", 1));
  const fh = num(pr, "altura_piso_m", 3);
  const H = floors * fh;
  const type = str(pr, "cubierta_tipo", "dos-aguas");
  const slope = num(pr, "cubierta_pendiente_pct", 30);
  const eave = num(pr, "cubierta_alero_m", 0.9);
  const t = num(pr, "cubierta_espesor_m", 0.25);
  const tallS = floors * fh + Math.max(W, L) * (slope / 100) * 0.5 + 1.2;
  const fitS = Math.min((b.w - 60) / (Math.max(W, L) + 2 * eave), ((b.h - 10) / 2 - 24) / tallS);
  const scale = [50, 75, 100, 125, 150, 200, 250].find((sc) => 1000 / sc <= fitS) ?? 250;
  const mm = 1000 / scale;
  const ceiling = 2.7;
  const cutX = num(pr, "corte_x", W / 2);
  const cutY = num(pr, "corte_y", L / 2);
  const roofColor = str(pr, "estilo_cubierta_color", "#4a4f55");
  p.text(b.title ?? `CORTES · ESCALA 1:${scale}`, b.x, b.y + b.h - 3, 2.6, "left", true, BRAND);
  const sections: { name: string; width: number; face: "E" | "S"; at: number }[] = [
    { name: "CORTE LONGITUDINAL A-A", width: L, face: "E", at: cutX },
    { name: "CORTE TRANSVERSAL B-B", width: W, face: "S", at: cutY },
  ];
  const framed = typeof pr["corte_W"] === "number";
  const inside = (q: { x: number; y: number }) => !framed || (q.x >= -0.25 && q.x <= W + 0.25 && q.y >= -0.25 && q.y <= L + 0.25);
  const walls = [...reader.entities()]
    .filter((e): e is Wall => e.kind === "Wall")
    .map((w) => ({ ...w, start: loc(w.start), end: loc(w.end) }))
    .filter((w) => inside(w.start) && inside(w.end));
  const spaces = [...reader.entities()]
    .filter((e): e is Space => e.kind === "Space" && e.properties?.["exterior"] !== true)
    .map((s) => ({ ...s, boundary: s.boundary.map(loc) }))
    .filter((s) => s.boundary.every(inside));
  const fill = (pts: [number, number][], color: string) => p.out.push({ kind: "polygon", points: pts.map(([x, y]) => p.w(x, y)), style: "hoja", fill: "solid", color, weight: 0 });
  const cellH = (b.h - 10) / 2;
  sections.forEach((sec, i) => {
    const rv = roofView(sec.face, sec.width, W, L, H, type, slope, eave, t);
    const top = Math.max(...rv.roof.flat().map(([, z]) => z));
    const cx0 = b.x + 24 + (b.w - 40 - (sec.width + 2 * eave) * mm) / 2 + eave * mm;
    const cy0 = b.y + (1 - i) * cellH + (cellH - top * mm) / 2 + 6;
    const X = (u: number) => cx0 + u * mm;
    const Y = (z: number) => cy0 + z * mm;
    // Losas
    for (let f = 0; f <= floors; f++) {
      const z = f * fh;
      if (f === floors && type !== "plana") continue;
      fill([[X(0), Y(z - (f === 0 ? 0.15 : 0.25))], [X(sec.width), Y(z - (f === 0 ? 0.15 : 0.25))], [X(sec.width), Y(z)], [X(0), Y(z)]], "#3b3f44");
    }
    // Cielos falsos
    for (let f = 0; f < floors; f++) p.line([[X(0.2), Y(f * fh + ceiling)], [X(sec.width - 0.2), Y(f * fh + ceiling)]], { weight: 0.2, dash: [1.5, 0.8], color: "#6b6f74" });
    // Muros cortados
    for (const w of walls) {
      const z0 = levelOf(reader, w.id)?.elevation ?? 0;
      const vert = Math.abs(w.end.x - w.start.x) < 1e-6; // muro norte-sur
      let u: number | undefined;
      if (sec.face === "E" && !vert) {
        const x0 = Math.min(w.start.x, w.end.x),
          x1 = Math.max(w.start.x, w.end.x);
        if (sec.at >= x0 && sec.at <= x1) u = w.start.y;
      }
      if (sec.face === "S" && vert) {
        const y0 = Math.min(w.start.y, w.end.y),
          y1 = Math.max(w.start.y, w.end.y);
        if (sec.at >= y0 && sec.at <= y1) u = w.start.x;
      }
      if (u === undefined) continue;
      const th = w.properties?.["fachada"] ? 0.2 : 0.12;
      const wallTop = w.properties?.["fachada"] ? Math.min(rv.wallTop(u), z0 + fh + (z0 + fh >= H - 0.01 ? rv.wallTop(u) - H : 0)) : z0 + fh - 0.25;
      fill([[X(u - th / 2), Y(z0)], [X(u + th / 2), Y(z0)], [X(u + th / 2), Y(wallTop)], [X(u - th / 2), Y(wallTop)]], "#1f2225");
    }
    // Escalera
    const sx0 = num(pr, "escalera_x0", NaN);
    if (Number.isFinite(sx0) && floors > 1 && sec.face === "E") {
      const sy = num(pr, "escalera_y0", 0);
      const n1 = num(pr, "escalera_n1", 9);
      const riser = num(pr, "escalera_ch", 0.176);
      const tread = num(pr, "escalera_h", 0.28);
      for (let f = 0; f < floors - 1; f++) {
        const pts: [number, number][] = [];
        for (let k = 0; k < n1; k++) pts.push([sy + k * tread, f * fh + k * riser], [sy + k * tread, f * fh + (k + 1) * riser], [sy + (k + 1) * tread, f * fh + (k + 1) * riser]);
        p.line(pts.map(([u, z]) => [X(u), Y(z)]), { weight: 0.35 });
      }
    }
    // Cubierta: el faldón que se ve más allá del corte en gris claro y el perfil cortado en negro.
    for (const poly of rv.roof) {
      fill(poly.map(([u, z]) => [X(u), Y(z)]), "#e4e3df");
      p.line([...poly, poly[0]!].map(([u, z]) => [X(u), Y(z)]), { weight: 0.18, color: "#6b6f74" });
    }
    const prof: [number, number][] = [];
    for (let k = 0; k <= 60; k++) {
      const u = -eave + ((sec.width + 2 * eave) * k) / 60;
      const zs = rv.roof.filter((poly) => u >= Math.min(...poly.map((q) => q[0])) - 1e-6 && u <= Math.max(...poly.map((q) => q[0])) + 1e-6).map((poly) => Math.max(...poly.map((q) => q[1])) >= 0 ? topAt(poly, u) : 0);
      if (zs.length) prof.push([u, Math.max(...zs)]);
    }
    if (type === "plana") fill([[X(-0.1), Y(H)], [X(sec.width + 0.1), Y(H)], [X(sec.width + 0.1), Y(H + t)], [X(-0.1), Y(H + t)]], "#3b3f44");
    else if (prof.length > 1) {
      const band = [...prof, ...[...prof].reverse().map(([u, z]) => [u, z - t] as [number, number])];
      fill(band.map(([u, z]) => [X(u), Y(z)]), roofColor);
      p.line(prof.map(([u, z]) => [X(u), Y(z)]), { weight: 0.5, color: INK });
    }
    // Nombres de los espacios cortados
    for (const s of spaces) {
      const z0 = levelOf(reader, s.id)?.elevation ?? 0;
      const xs = s.boundary.map((q) => q.x),
        ys = s.boundary.map((q) => q.y);
      const [a0, a1] = sec.face === "E" ? [Math.min(...xs), Math.max(...xs)] : [Math.min(...ys), Math.max(...ys)];
      if (sec.at < a0 || sec.at > a1) continue;
      const [b0, b1] = sec.face === "E" ? [Math.min(...ys), Math.max(...ys)] : [Math.min(...xs), Math.max(...xs)];
      if (b1 - b0 < 1.2) continue;
      p.text((s.name ?? "").toUpperCase(), X((b0 + b1) / 2), Y(z0 + 1.2), 2.2, "center", true, "#41454b");
    }
    // Terreno y niveles
    p.line([[X(-eave - 1), Y(-0.15)], [X(sec.width + eave + 1), Y(-0.15)]], { weight: 0.7 });
    const lx = X(-eave) - 6;
    for (const z of [...new Set([0, ...Array.from({ length: floors }, (_, f) => f * fh + ceiling), ...Array.from({ length: floors - 1 }, (_, f) => (f + 1) * fh), ...rv.marks])].sort((a, c) => a - c)) {
      const ly = Y(z);
      p.line([[lx - 3, ly], [lx + 3, ly]], { weight: 0.18 });
      p.text(z === 0 ? "NPT ±0.00" : `N+${fmt(z)}`, lx - 3.4, ly + 1.0, 1.6, "right");
    }
    p.text(sec.name, X(sec.width / 2), Y(-0.15) - 6, 2.5, "center", true);
  });
}

// ─── Carpintería: puertas ────────────────────────────────────

interface DoorItem {
  name: string;
  width: number;
  height: number;
  kind: string;
}

function doorKind(name: string, principal: boolean): string {
  const n = name.toLowerCase();
  if (principal) return "principal";
  if (/corrediza/.test(n)) return "corrediza";
  if (/aluminio|exterior/.test(n)) return "aluminio";
  if (/lámina|rejilla/.test(n)) return "metalica";
  if (/vaivén/.test(n)) return "vaiven";
  if (/roble/.test(n)) return "roble";
  return "lacada";
}

const DOOR_SPEC: Record<string, string> = {
  principal: "Puerta principal (ver especificación del estilo)",
  corrediza: "Puerta corrediza en madera con riel oculto y cierre lento",
  aluminio: "Puerta en aluminio arquitectónico y vidrio templado",
  metalica: "Puerta en lámina cold rolled cal. 18 con rejilla de ventilación, pintura electrostática",
  vaiven: "Puerta de vaivén en madera lacada con bisagra de piso",
  roble: "Puerta entamborada con chapa de roble natural, marco en roble",
  lacada: "Puerta entamborada en MDF 30 mm lacada blanca, marco en madera",
};

export function drawDoorSchedule(p: Pen, reader: ModelReader, b: SheetBlock): void {
  const items: DoorItem[] = [];
  const opOf = openingsByFilling(reader);
  const opening = (id: string) => opOf.get(id);
  for (const e of reader.entities()) {
    if (e.kind !== "Door") continue;
    const d = e as Door;
    const o = opening(d.id);
    items.push({ name: d.name ?? "", width: o?.width ?? d.leafWidth, height: o?.height ?? d.leafHeight, kind: doorKind(d.name ?? "", d.properties?.["principal"] === true || /principal/i.test(d.name ?? "") && /pivotante|portón|puerta principal/i.test(d.name ?? "")) });
  }
  const groups = groupBy(items, (d) => `${d.kind}|${d.width.toFixed(2)}|${d.height.toFixed(2)}`);
  const types = [...groups.values()].sort((a, c) => c[0]!.width - a[0]!.width);

  // Alzados en cuadrícula (parte superior), cuadro abajo.
  const tableH = Math.min(b.h * 0.42, 10 + types.length * 3.6);
  const gridTop = b.y + b.h - 8;
  const gridBottom = b.y + tableH + 18;
  const cols = Math.min(10, Math.max(4, types.length));
  const cw = b.w / cols;
  const rows = Math.ceil(types.length / cols);
  const ch = (gridTop - gridBottom) / Math.max(1, rows);
  const mm = snapMm(Math.min(20, (ch - 14) / 2.8, (cw - 8) / 1.8));
  p.text(b.title ?? `CUADRO DE PUERTAS · ALZADOS · ESCALA 1:${Math.round(1000 / mm)}`, b.x, b.y + b.h - 3, 2.6, "left", true, BRAND);
  types.forEach((g, i) => {
    const d = g[0]!;
    const cx = b.x + (i % cols) * cw + cw / 2;
    const by = gridTop - Math.floor(i / cols) * ch - ch + 10;
    const w = d.width * mm,
      h = d.height * mm;
    const x = cx - w / 2;
    const color = d.kind === "principal" ? "#a8744c" : d.kind === "roble" ? "#c39a6b" : d.kind === "aluminio" ? GLASS : d.kind === "metalica" ? "#9aa1a8" : "#f3f1ec";
    p.rect(x - 0.06 * mm, by, w + 0.12 * mm, h + 0.06 * mm, { weight: 0.4 });
    p.rect(x, by, w, h, { fill: "solid", color, weight: 0.25 });
    if (d.kind === "corrediza") p.line([[x + w * 0.5, by + h * 0.5], [x + w * 0.85, by + h * 0.5]], { weight: 0.25 }).line([[x + w * 0.78, by + h * 0.55], [x + w * 0.85, by + h * 0.5], [x + w * 0.78, by + h * 0.45]], { weight: 0.25 });
    else {
      p.line([[x, by + h], [x + w, by + h / 2], [x, by]], { weight: 0.15, dash: [1.2, 0.8] });
      p.line([[x + w - 0.12 * mm, by + 1.0 * mm], [x + w - 0.12 * mm, by + 1.15 * mm]], { weight: 0.5 });
    }
    if (d.kind === "metalica") for (let k = 1; k < 6; k++) p.line([[x + w * 0.2, by + (h * k) / 14], [x + w * 0.8, by + (h * k) / 14]], { weight: 0.1 });
    p.text(fmt(d.width), cx, by - 2.2, 1.6, "center");
    p.text(fmt(d.height), x - 1.2, by + h / 2, 1.6, "right");
    p.text(`P${i + 1}`, cx, by + h + 3.2, 2.4, "center", true, BRAND);
    p.text(`${g.length} UND`, cx, by - 4.6, 1.6, "center");
  });
  const t: Table = {
    title: "CUADRO DE PUERTAS",
    columns: ["TIPO", "CANT.", "VANO (A × H)", "DESCRIPCIÓN", "UBICACIÓN"],
    widths: [0.6, 0.6, 1.2, 4.2, 4.4],
    rows: types.map((g, i) => ({ cells: [`P${i + 1}`, String(g.length), `${fmt(g[0]!.width)} × ${fmt(g[0]!.height)}`, DOOR_SPEC[g[0]!.kind] ?? "", g.map((d) => d.name.split(" ")[0]).join(", ")] })),
  };
  drawTable(p, t, b.x, b.y + 10 + tableH, b.w, tableH);
}

// ─── Carpintería: ventanas ───────────────────────────────────

export function drawWindowSchedule(p: Pen, reader: ModelReader, b: SheetBlock): void {
  interface Win {
    name: string;
    width: number;
    height: number;
    sill: number;
    op: string;
  }
  const items: Win[] = [];
  const opOf = openingsByFilling(reader);
  for (const e of reader.entities()) {
    if (e.kind !== "Window") continue;
    const w = e as Window;
    const o = opOf.get(w.id);
    items.push({ name: w.name ?? "", width: o?.width ?? w.frameWidth, height: o?.height ?? w.frameHeight, sill: o?.sillHeight ?? 0, op: w.operation });
  }
  const groups = groupBy(items, (w) => `${w.op}|${w.width.toFixed(2)}|${w.height.toFixed(2)}|${w.sill.toFixed(2)}`);
  const types = [...groups.values()].sort((a, c) => c[0]!.width * c[0]!.height - a[0]!.width * a[0]!.height);

  const tableH = Math.min(b.h * 0.45, 10 + types.length * 3.6);
  const gridTop = b.y + b.h - 8;
  const gridBottom = b.y + tableH + 18;
  const cols = Math.min(7, Math.max(3, Math.ceil(Math.sqrt(types.length * 2))));
  const cw = b.w / cols;
  const rows = Math.ceil(types.length / cols);
  const ch = (gridTop - gridBottom) / Math.max(1, rows);
  const maxW = Math.max(...types.map((g) => g[0]!.width), 1);
  const maxH = Math.max(...types.map((g) => g[0]!.height + g[0]!.sill), 1);
  const mm = snapMm(Math.min(20, (cw - 10) / maxW, (ch - 14) / maxH));
  p.text(b.title ?? `CUADRO DE VENTANAS · ALZADOS · ESCALA 1:${Math.round(1000 / mm)}`, b.x, b.y + b.h - 3, 2.6, "left", true, BRAND);
  types.forEach((g, i) => {
    const w0 = g[0]!;
    const cx = b.x + (i % cols) * cw + cw / 2;
    const fy = gridTop - Math.floor(i / cols) * ch - ch + 9; // piso
    const w = w0.width * mm,
      h = w0.height * mm;
    const x = cx - w / 2,
      y = fy + w0.sill * mm;
    p.line([[x - 3, fy], [x + w + 3, fy]], { weight: 0.15, dash: [1, 0.6] });
    p.rect(x, y, w, h, { fill: "solid", color: GLASS, weight: 0.45 });
    const parts = Math.max(1, Math.round(w0.width / 1.2));
    for (let k = 1; k < parts; k++) p.line([[x + (w * k) / parts, y], [x + (w * k) / parts, y + h]], { weight: 0.35 });
    if (w0.op === "sliding" && parts > 1)
      for (let k = 0; k < parts; k++) {
        const ax = x + (w * (k + 0.5)) / parts;
        const dir = k % 2 ? -1 : 1;
        p.line([[ax - dir * 2, y + h / 2], [ax + dir * 2, y + h / 2]], { weight: 0.2 }).line([[ax + dir * 1.2, y + h / 2 + 0.7], [ax + dir * 2, y + h / 2], [ax + dir * 1.2, y + h / 2 - 0.7]], { weight: 0.2 });
      }
    if (w0.op === "fixed") p.text("F", cx, y + h / 2, 2, "center", true, "#5b6068");
    p.text(fmt(w0.width), cx, fy - 2.2, 1.5, "center");
    p.text(fmt(w0.height), x - 1, y + h / 2, 1.5, "right");
    if (w0.sill > 0) p.text(`ant. ${fmt(w0.sill)}`, x + w + 1, fy + (w0.sill * mm) / 2, 1.4, "left", false, "#5b6068");
    p.text(`V${i + 1}`, cx, y + h + 3, 2.3, "center", true, BRAND);
    p.text(`${g.length} UND`, cx, fy - 4.4, 1.5, "center");
  });
  const opName: Record<string, string> = { fixed: "Fija", sliding: "Corrediza", casement: "Batiente", tilt_turn: "Oscilobatiente" };
  const t: Table = {
    title: "CUADRO DE VENTANAS",
    columns: ["TIPO", "CANT.", "VANO (A × H)", "ANTEPECHO", "OPERACIÓN", "UBICACIÓN"],
    widths: [0.6, 0.6, 1.2, 0.9, 1.1, 6.6],
    rows: types.map((g, i) => ({ cells: [`V${i + 1}`, String(g.length), `${fmt(g[0]!.width)} × ${fmt(g[0]!.height)}`, fmt(g[0]!.sill), opName[g[0]!.op] ?? g[0]!.op, g.map((w) => w.name.replace(/^V-\d+\s*/, "")).filter((v, k, a) => a.indexOf(v) === k).join(" · ")] })),
  };
  drawTable(p, t, b.x, b.y + 10 + tableH, b.w, tableH);
}

// ─── Clósets y muebles en madera ─────────────────────────────

export function drawFurniture(p: Pen, reader: ModelReader, b: SheetBlock): void {
  interface Item {
    name: string;
    w: number;
    d: number;
    tipo: string;
    sym: string;
  }
  const items: Item[] = [];
  for (const e of reader.entities()) {
    if (e.kind !== "Device") continue;
    const dv = e as Device;
    const pr = dv.properties ?? {};
    if (dv.symbol !== "mueble" && !(dv.symbol === "lavamanos" && pr["carpinteria"])) continue;
    const name = str(pr, "carpinteria", str(pr, "rotulo", "") || (pr["tipo"] === "closet" ? "Clóset" : "Mueble"));
    items.push({ name, w: num(pr, "ancho_m", 1.2), d: num(pr, "fondo_m", 0.6), tipo: dv.symbol === "lavamanos" ? "lavamanos" : str(pr, "tipo", ""), sym: dv.symbol });
  }
  const groups = groupBy(items, (m) => `${m.name}|${m.w.toFixed(2)}|${m.d.toFixed(2)}|${m.tipo}`);
  const types = [...groups.values()].sort((a, c) => (c[0]!.tipo === "closet" ? 1 : 0) - (a[0]!.tipo === "closet" ? 1 : 0) || c[0]!.w - a[0]!.w);

  const tableH = Math.min(b.h * 0.45, 10 + types.length * 3.6);
  const gridTop = b.y + b.h - 8;
  const gridBottom = b.y + tableH + 18;
  const cols = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(types.length * 1.6))));
  const cw = b.w / cols;
  const rows = Math.ceil(types.length / cols);
  const ch = (gridTop - gridBottom) / Math.max(1, rows);
  const heightOf = (m: Item) => (m.tipo === "closet" || m.tipo === "alto" ? 2.4 : /escritorio/i.test(m.name) ? 0.75 : /tv/i.test(m.name) ? 0.55 : /isla|cocina|lavadero|bbq|buffet/i.test(m.name) ? 0.9 : m.tipo === "lavamanos" ? 0.85 : 0.45);
  const maxW = Math.max(...types.map((g) => g[0]!.w), 1);
  const mm = snapMm(Math.min(20, (cw - 10) / maxW, (ch - 16) / 2.5));
  p.text(b.title ?? `CLÓSETS Y MUEBLES EN MADERA · ALZADOS FRONTALES · ESCALA 1:${Math.round(1000 / mm)}`, b.x, b.y + b.h - 3, 2.6, "left", true, BRAND);
  const wood = "#d8bf9c";
  types.forEach((g, i) => {
    const m = g[0]!;
    const cx = b.x + (i % cols) * cw + cw / 2;
    const fy = gridTop - Math.floor(i / cols) * ch - ch + 11;
    const H = heightOf(m);
    const lift = /tv/i.test(m.name) ? 0.35 : 0;
    const w = m.w * mm,
      h = H * mm;
    const x = cx - w / 2,
      y = fy + lift * mm;
    p.line([[x - 2, fy], [x + w + 2, fy]], { weight: 0.15 });
    p.rect(x, y, w, h, { fill: "solid", color: wood, weight: 0.4 });
    if (m.tipo === "closet") {
      const mal = 0.4 * mm;
      p.line([[x, y + h - mal], [x + w, y + h - mal]], { weight: 0.25 });
      p.line([[x, y + 0.1 * mm], [x + w, y + 0.1 * mm]], { weight: 0.15 });
      const n = Math.max(2, Math.round(m.w / 0.55));
      for (let k = 1; k < n; k++) p.line([[x + (w * k) / n, y + 0.1 * mm], [x + (w * k) / n, y + h]], { weight: 0.2 });
      for (let k = 0; k < n; k++) {
        const hx = x + (w * (k + (k % 2 ? 0.12 : 0.88))) / n;
        p.line([[hx, y + 0.95 * mm], [hx, y + 1.25 * mm]], { weight: 0.45 });
      }
      // Interior (líneas ocultas): barra de colgar y entrepaños
      p.line([[x + 0.05 * mm, y + 1.8 * mm], [x + w * 0.5, y + 1.8 * mm]], { weight: 0.12, dash: [1, 0.6] });
      for (const z of [0.5, 0.9, 1.3, 1.7]) p.line([[x + w * 0.55, y + z * mm], [x + w - 0.05 * mm, y + z * mm]], { weight: 0.12, dash: [1, 0.6] });
    } else if (m.tipo === "alto") {
      for (const z of [0.4, 0.8, 1.2, 1.6, 2.0]) p.line([[x, y + z * mm], [x + w, y + z * mm]], { weight: 0.15 });
      const n = Math.max(1, Math.round(m.w / 0.6));
      for (let k = 1; k < n; k++) p.line([[x + (w * k) / n, y], [x + (w * k) / n, y + h]], { weight: 0.2 });
    } else {
      const n = Math.max(1, Math.round(m.w / 0.6));
      for (let k = 1; k < n; k++) p.line([[x + (w * k) / n, y], [x + (w * k) / n, y + h]], { weight: 0.2 });
      if (H >= 0.7) p.line([[x, y + h - 0.18 * mm], [x + w, y + h - 0.18 * mm]], { weight: 0.15 });
      p.rect(x - 0.02 * mm, y + h, w + 0.04 * mm, 0.03 * mm + 0.4, { fill: "solid", color: "#e7e4dd", weight: 0.2 });
      if (/cocina/i.test(m.name)) {
        // Alacena superior
        p.rect(x, fy + 1.5 * mm, w, 0.7 * mm, { fill: "solid", color: wood, weight: 0.35 });
        for (let k = 1; k < n; k++) p.line([[x + (w * k) / n, fy + 1.5 * mm], [x + (w * k) / n, fy + 2.2 * mm]], { weight: 0.2 });
      }
    }
    p.text(fmt(m.w), cx, fy - 2.2, 1.5, "center");
    p.text(fmt(H), x - 1, y + h / 2, 1.5, "right");
    p.text(`M${i + 1}`, cx, fy + Math.max(h + lift * mm, /cocina/i.test(m.name) ? 2.2 * mm : 0) + 3, 2.2, "center", true, BRAND);
    p.text(`${g.length} UND · fondo ${fmt(m.d)}`, cx, fy - 4.4, 1.4, "center");
  });
  const spec = (m: Item) =>
    m.tipo === "closet"
      ? "Clóset en MDF RH 18 mm, frentes en chapa de roble, maletero, barra de colgar, entrepaños, cajones con corredera de cierre lento"
      : m.tipo === "alto"
        ? "Mueble alto en MDF RH 18 mm con entrepaños graduables y puertas en chapa de roble"
        : /cocina|isla/i.test(m.name)
          ? "Módulos en MDF RH 18 mm laca poliuretano, encimera en cuarzo 20 mm, herrajes de cierre lento"
          : m.tipo === "lavamanos"
            ? "Mueble flotante en MDF RH con chapa de roble y encimera en cuarzo o mármol"
            : "Mueble en MDF 18 mm con chapa de roble natural y laca mate";
  const t: Table = {
    title: "CUADRO DE MUEBLES EN MADERA",
    columns: ["TIPO", "CANT.", "MUEBLE", "ANCHO × FONDO × ALTO", "ESPECIFICACIÓN"],
    widths: [0.6, 0.6, 3.2, 1.6, 6.4],
    rows: types.map((g, i) => ({ cells: [`M${i + 1}`, String(g.length), g[0]!.name, `${fmt(g[0]!.w)} × ${fmt(g[0]!.d)} × ${fmt(heightOf(g[0]!))}`, spec(g[0]!)] })),
  };
  drawTable(p, t, b.x, b.y + 10 + tableH, b.w, tableH);
}

// ─── Acabados ────────────────────────────────────────────────

function spacesSorted(reader: ModelReader, levelId?: string): Space[] {
  const out: Space[] = [];
  for (const e of reader.entities()) if (e.kind === "Space" && (!levelId || reader.indices.levelOfElement(e.id) === levelId)) out.push(e);
  return out.sort((a, c) => a.number.localeCompare(c.number, "es", { numeric: true }));
}

export function finishesTable(reader: ModelReader): Table {
  const rows = spacesSorted(reader).map((s) => {
    const q = s.properties ?? {};
    return { cells: [s.number, s.name ?? "", str(q, "acabado_piso", str(q, "piso", "")), str(q, "acabado_guardaescoba", "—"), str(q, "acabado_muros", "—"), str(q, "acabado_enchape", "—"), str(q, "acabado_cielo", "—"), q["altura_cielo_m"] !== undefined ? fmt(num(q, "altura_cielo_m", 0)) : "—"] };
  });
  return { title: "CUADRO GENERAL DE ACABADOS", columns: ["N.º", "ESPACIO", "PISO", "GUARDAESCOBA", "MUROS Y PINTURA", "ENCHAPES Y ESPECIALES", "CIELO", "H. CIELO"], widths: [0.45, 1.5, 3.1, 1.7, 2.4, 2.4, 2.5, 0.55], rows };
}

export function floorFinishTable(reader: ModelReader, levelId: string): Table {
  const rows = spacesSorted(reader, levelId).map((s) => ({ cells: [s.number, s.name ?? "", str(s.properties ?? {}, "piso", ""), fmt(polygonArea(s.boundary))] }));
  return { title: "ACABADOS DE PISO", columns: ["N.º", "ESPACIO", "PISO", "m²"], widths: [0.7, 2.6, 2.2, 0.8], rows };
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    m.set(k, [...(m.get(k) ?? []), it]);
  }
  return m;
}

function openingsByFilling(reader: ModelReader): Map<string, Opening> {
  const m = new Map<string, Opening>();
  for (const e of reader.entities()) {
    if (e.kind !== "Opening") continue;
    const f = reader.indices.fillingOfOpening(e.id);
    if (f) m.set(f, e as Opening);
  }
  return m;
}

/** Altura del borde superior de un polígono de cubierta en la abscisa u. */
function topAt(poly: [number, number][], u: number): number {
  let best = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [a0, z0] = poly[i]!;
    const [a1, z1] = poly[(i + 1) % poly.length]!;
    if (Math.abs(a1 - a0) < 1e-9) continue;
    const t = (u - a0) / (a1 - a0);
    if (t < -1e-9 || t > 1 + 1e-9) continue;
    best = Math.max(best, z0 + (z1 - z0) * t);
  }
  return best;
}

/** Milímetros por metro de la mayor escala normalizada que no pasa de `max`. */
function snapMm(max: number): number {
  const sc = [50, 75, 100, 125, 150, 200].find((k) => 1000 / k <= max) ?? 200;
  return 1000 / sc;
}

// ─── Esquema vertical de montantes y bajantes ────────────────

/**
 * Esquema vertical (isométrico simplificado) de la red: montantes de agua fría, caliente y retorno,
 * bajantes sanitarias con su ventilación y bajantes de aguas lluvias, con diámetros y niveles.
 */
export function drawRiserDiagram(p: Pen, reader: ModelReader, b: SheetBlock): void {
  const levels = [...reader.entities()].filter((e): e is Level => e.kind === "Level").sort((a, c) => a.elevation - c.elevation);
  if (!levels.length) return;
  const devices = [...reader.entities()].filter((e): e is Device => e.kind === "Device");
  const runs = [...reader.entities()].filter((e) => e.kind === "Run") as unknown as { tag?: string; system: string; discipline: string; properties?: Props }[];
  const top = levels[levels.length - 1]!.elevation;
  const zmin = -1.2;
  const zmax = top + 1.2;
  p.text(b.title ?? "ESQUEMA VERTICAL DE MONTANTES Y BAJANTES · SIN ESCALA", b.x, b.y + b.h - 3, 2.6, "left", true, BRAND);
  const y0 = b.y + 12;
  const hgt = b.h - 26;
  const Y = (z: number) => y0 + ((z - zmin) / (zmax - zmin)) * hgt;
  const x0 = b.x + 30;
  // Niveles
  for (const l of levels) {
    p.line([[x0 - 4, Y(l.elevation)], [b.x + b.w - 4, Y(l.elevation)]], { weight: 0.2, dash: [3, 1.2], color: "#8a8f96" });
    p.text((l.name ?? "").toUpperCase(), b.x, Y(l.elevation) + 1.2, 2.4, "left", true, INK);
    p.text(`N ${l.elevation >= 0 ? "+" : ""}${fmt(l.elevation)}`, b.x, Y(l.elevation) - 3.0, 2.0, "left", false, "#555a60");
  }
  p.line([[x0 - 4, Y(-0.6)], [b.x + b.w - 4, Y(-0.6)]], { weight: 0.15, dash: [1, 1], color: "#a0a5ab" });
  p.text("TERRENO / REDES ENTERRADAS", b.x, Y(-0.6) - 2.6, 1.6, "left", false, "#555a60");
  const floors = levels.filter((l) => l.name !== "Cubierta");
  const nf = floors.length;
  const runBy = (tag: string) => runs.find((r) => typeof r.properties?.["tramo"] === "string" && (r.properties["tramo"] as string).startsWith(tag + " "));
  const diam = (tag: string, d: string) => {
    const r = runBy(tag);
    const s = r ? str(r.properties ?? {}, "diametro", d) : d;
    return s.replace("Multicapa ", "Ø").replace(" aislada", "").replace(" RDE 21", "");
  };
  type Col = { name: string; color: string; z0: number; z1: number; segs: { z0: number; z1: number; label: string }[]; foot: string; head?: string; stubs: { z: number; label: string }[] };
  const cols: Col[] = [];
  const HID = "#1565c0", HOT = "#c62828", RET = "#ef6c00", SAN = "#5d4037", LLU = "#00838f", VEN = "#7b8a8b";
  const fz = (i: number) => floors[i]!.elevation;
  const ap = runBy("AP-1");
  const trunk = (sys: string, f: number) => {
    const t = runBy(`${sys}-${f}.T1`) ?? runBy(`${sys}-${f}.1`);
    return t ? `Piso ${f}: ${str(t.properties ?? {}, "diametro", "").replace("Multicapa ", "Ø").replace(" aislada", "")}` : `Piso ${f}`;
  };
  cols.push({ name: "MH · AGUA FRÍA", color: HID, z0: -0.6, z1: fz(nf - 1) + 0.4, segs: [{ z0: -0.6, z1: fz(0), label: ap ? diam("AP-1", "") : "" }, ...floors.slice(0, -1).map((l, i) => ({ z0: l.elevation + 0.4, z1: fz(i + 1) + 0.4, label: diam(`MH-${i + 1}`, "") }))], foot: "Desde equipo de presión y tanque de reserva", stubs: floors.map((l, i) => ({ z: l.elevation + 0.4, label: trunk("AF", i + 1) })) });
  cols.push({ name: "MC · AGUA CALIENTE", color: HOT, z0: fz(0) + 0.4, z1: fz(nf - 1) + 0.4, segs: floors.slice(0, -1).map((l, i) => ({ z0: l.elevation + 0.4, z1: fz(i + 1) + 0.4, label: diam(`MC-${i + 1}`, "") })), foot: "Desde calentador de acumulación", stubs: floors.map((l, i) => ({ z: l.elevation + 0.4, label: trunk("AC", i + 1) })) });
  if (nf > 1) cols.push({ name: "RC · RETORNO", color: RET, z0: fz(0) + 0.6, z1: fz(nf - 1) + 0.6, segs: [{ z0: fz(0) + 0.6, z1: fz(nf - 1) + 0.6, label: "Ø16 aislada" }], foot: "A bomba de recirculación", stubs: [] });
  // Bajantes sanitarias
  const ban = new Map<string, { zs: number[]; name: string }>();
  for (const d of devices)
    if (d.symbol === "bajante-an" && d.tag) {
      const it = ban.get(d.tag) ?? { zs: [], name: d.name ?? "" };
      it.zs.push(levelOf(reader, d.id)?.elevation ?? 0);
      ban.set(d.tag, it);
    }
  for (const [tag, it] of [...ban].sort((a, c) => a[0].localeCompare(c[0], "es", { numeric: true }))) {
    const zt = Math.max(...it.zs);
    const room = /\(([^,]+),/.exec(it.name)?.[1] ?? "";
    cols.push({ name: `${tag} · AGUAS NEGRAS`, color: SAN, z0: -0.6, z1: zt, segs: [{ z0: -0.6, z1: zt, label: "Ø4\" PVC sanitaria" }], foot: "A caja de inspección", head: "Ventilación Ø2\" + 0.60 m", stubs: [{ z: zt, label: room }] });
  }
  // Bajantes de aguas lluvias
  const ball = new Set(devices.filter((d) => d.symbol === "bajante" && d.tag?.startsWith("BALL")).map((d) => d.tag!));
  if (ball.size) cols.push({ name: `BALL ×${ball.size} · LLUVIAS`, color: LLU, z0: -0.6, z1: top, segs: [{ z0: -0.6, z1: top, label: "Ø4\" PVC aguas lluvias" }], foot: "A cajas de aguas lluvias", stubs: [{ z: top, label: "Canal / sifón" }] });
  const step = Math.min(78, (b.w - 50) / Math.max(1, cols.length));
  cols.forEach((c, i) => {
    const x = x0 + 14 + i * step;
    if (c.head) {
      p.line([[x, Y(c.z1)], [x, Y(top + 0.6)]], { weight: 0.4, dash: [1.8, 0.9], color: VEN });
      p.line([[x - 1.6, Y(top + 0.6)], [x + 1.6, Y(top + 0.6)]], { weight: 0.5, color: VEN });
      p.text(c.head, x + 2, Y(top + 0.6) + 1, 1.8, "left", false, VEN);
    }
    p.line([[x, Y(c.z0)], [x, Y(c.z1)]], { weight: 0.9, color: c.color });
    for (const sg of c.segs) if (sg.label) p.text(sg.label, x - 1.4, (Y(sg.z0) + Y(sg.z1)) / 2, 2.0, "center", true, c.color, Math.PI / 2);
    for (const st of c.stubs) {
      p.line([[x, Y(st.z)], [x + 9, Y(st.z)]], { weight: 0.6, color: c.color });
      p.circle(x, Y(st.z), 0.8, { fill: "solid", color: c.color, weight: 0.1 });
      if (st.label) p.text(st.label, x + 2, Y(st.z) + 1.4, 1.8, "left", false, c.color);
    }
    p.text(c.name, x, Y(zmax) - 1, 2.2, "center", true, c.color);
    p.text(c.foot, x, Y(zmin) - 1, 1.7, "center", false, "#555a60");
    p.circle(x, Y(c.z0), 1.0, { weight: 0.35, color: c.color });
  });
  p.text("Derivaciones a cada piso según las plantas H y S. Diámetros calculados con NTC 1500 (Hunter / unidades de descarga).", b.x, b.y + 3, 2.0, "left", false, "#555a60");
}
