// Topografía en la app: vista 3D del terreno con la casa, plano de implantación, DXF topográfico
// y el capítulo de topografía y movimiento de tierras de las memorias.

import { type ModelReader, type Project, type Sheet, type Vec2 } from "@arken/core";
import { escHtml, type ReportChapter } from "@arken/calc";
import { arcPoints, type ElementPlanGeometry, type PlanPrimitive } from "@arken/geometry";
import { Terrain, earthwork, toSite, type Earthwork, type P3, type Placement } from "@arken/terrain";
import { toDxf, type DxfEntity } from "./paint";
import type { Visible } from "./scene";

export interface Site {
  readonly terrain: Terrain;
  readonly placement: Placement;
  /** Huella de la casa en coordenadas del modelo. */
  readonly footprint: readonly Vec2[];
  /** Altura de la casa sobre el NPT (para el 3D). */
  readonly height: number;
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

export function houseFootprint(reader: ModelReader, project: Project | undefined): Vec2[] {
  const p = project?.properties ?? {};
  const x0 = num(p["casa_xmin"], NaN),
    x1 = num(p["casa_xmax"], NaN),
    y0 = num(p["casa_ymin"], NaN),
    y1 = num(p["casa_ymax"], NaN);
  if ([x0, x1, y0, y1].every(Number.isFinite) && x1 > x0 && y1 > y0) return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const e of reader.entities())
    if (e.kind === "Wall")
      for (const q of [e.start, e.end]) {
        minX = Math.min(minX, q.x);
        minY = Math.min(minY, q.y);
        maxX = Math.max(maxX, q.x);
        maxY = Math.max(maxY, q.y);
      }
  if (!Number.isFinite(minX)) return [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  return [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
}

export const siteEarthwork = (s: Site): Earthwork => earthwork(s.terrain, s.placement, s.footprint);

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");

// ─── Vista 3D (pintor por profundidad, sin WebGL) ────────────

const HYPSO = ["#2f6b3a", "#4f8a3c", "#7aa547", "#a8bd5a", "#cdbf6c", "#c79a55", "#a87442", "#8a5a3a"];

function mixHex(hex: string, k: number): string {
  const v = parseInt(hex.slice(1), 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => Math.max(0, Math.min(255, Math.round(x * k))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export class TerrainView {
  yaw = -0.6;
  pitch = 0.8;
  zoom = 1;
  exag = 1.5;
  site: Site | undefined;
  private drag: { x: number; y: number } | undefined;

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.addEventListener("pointerdown", (e) => {
      this.drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      this.yaw += (e.clientX - this.drag.x) * 0.008;
      this.pitch = Math.max(0.08, Math.min(Math.PI / 2, this.pitch + (e.clientY - this.drag.y) * 0.006));
      this.drag = { x: e.clientX, y: e.clientY };
      this.draw();
    });
    canvas.addEventListener("pointerup", () => (this.drag = undefined));
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoom = Math.max(0.3, Math.min(8, this.zoom * Math.exp(-e.deltaY * 0.0015)));
        this.draw();
      },
      { passive: false },
    );
  }

  topView(): void {
    this.yaw = 0;
    this.pitch = Math.PI / 2;
    this.draw();
  }

  draw(): void {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth,
      H = c.clientHeight;
    if (c.width !== Math.round(W * dpr)) c.width = Math.round(W * dpr);
    if (c.height !== Math.round(H * dpr)) c.height = Math.round(H * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#dfe6ef");
    bg.addColorStop(1, "#f6f7f9");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const s = this.site;
    if (!s) {
      ctx.fillStyle = "#5f6b7d";
      ctx.font = "14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Carga el levantamiento del topógrafo (DXF, CSV o TXT) para ver el terreno en 3D.", W / 2, H / 2);
      return;
    }
    const t = s.terrain;
    const cx = (t.box.minX + t.box.maxX) / 2,
      cy = (t.box.minY + t.box.maxY) / 2,
      cz = (t.zMin + t.zMax) / 2;
    const size = Math.max(t.box.maxX - t.box.minX, t.box.maxY - t.box.minY, 1);
    const sc = (Math.min(W, H) / size) * 0.78 * this.zoom;
    const cyaw = Math.cos(this.yaw),
      syaw = Math.sin(this.yaw),
      cp = Math.cos(this.pitch),
      sp = Math.sin(this.pitch);
    const ex = this.exag;
    // Cámara: giro en z (yaw) y luego inclinación (pitch). Devuelve [sx, sy, profundidad].
    const P = (x: number, y: number, z: number): [number, number, number] => {
      const X = x - cx,
        Y = y - cy,
        Z = (z - cz) * ex;
      const x1 = X * cyaw - Y * syaw;
      const y1 = X * syaw + Y * cyaw;
      const yv = y1 * cp - Z * sp; // profundidad (mayor = más lejos)
      const zv = y1 * sp + Z * cp; // vertical en pantalla; pitch = π/2 es la vista en planta
      return [W / 2 + x1 * sc, H / 2 - zv * sc, yv];
    };
    const light = [-0.45, 0.35, 0.82];
    const ln = Math.hypot(...light);
    type Face = { pts: [number, number][]; d: number; fill: string; stroke?: string };
    const faces: Face[] = [];
    const step = t.contourInterval();
    const pts = t.tin.points;
    const proj = pts.map((p) => P(p.x, p.y, p.z));
    for (const [a, b, c2] of t.tin.tris) {
      const A = pts[a]!,
        B = pts[b]!,
        C = pts[c2]!;
      const ux = B.x - A.x,
        uy = B.y - A.y,
        uz = (B.z - A.z) * ex;
      const vx = C.x - A.x,
        vy = C.y - A.y,
        vz = (C.z - A.z) * ex;
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const shade = 0.55 + 0.5 * Math.max(0, (nx * light[0]! + ny * light[1]! + nz * light[2]!) / nl / ln);
      const zm = (A.z + B.z + C.z) / 3;
      const band = Math.floor((zm - t.zMin) / (step * 2));
      const nb = Math.max(1, Math.ceil((t.zMax - t.zMin) / (step * 2)));
      const col = HYPSO[Math.min(HYPSO.length - 1, Math.floor((band / nb) * HYPSO.length))]!;
      const pa = proj[a]!,
        pb = proj[b]!,
        pc = proj[c2]!;
      faces.push({ pts: [[pa[0], pa[1]], [pb[0], pb[1]], [pc[0], pc[1]]], d: (pa[2] + pb[2] + pc[2]) / 3, fill: mixHex(col, shade) });
    }
    // Casa: caja extruida desde la plataforma hasta la cubierta.
    const ring = s.footprint.map((q) => toSite(s.placement, q));
    const z0 = s.placement.npt,
      z1 = s.placement.npt + s.height;
    const ew = siteEarthwork(s);
    const base = Math.min(z0 - 0.35, Number.isFinite(ew.zMin) ? ew.zMin : z0);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!;
      const q = [P(a.x, a.y, base), P(b.x, b.y, base), P(b.x, b.y, z0), P(a.x, a.y, z0)];
      faces.push({ pts: q.map((v) => [v[0], v[1]] as [number, number]), d: q.reduce((t2, v) => t2 + v[2], 0) / 4 - 0.01, fill: "#b9b2a6", stroke: "#7d766b" });
      const w = [P(a.x, a.y, z0), P(b.x, b.y, z0), P(b.x, b.y, z1), P(a.x, a.y, z1)];
      faces.push({ pts: w.map((v) => [v[0], v[1]] as [number, number]), d: w.reduce((t2, v) => t2 + v[2], 0) / 4 - 0.01, fill: i % 2 ? "#dfe8f1" : "#cbd8e6", stroke: "#142339" });
    }
    const roof = ring.map((q) => P(q.x, q.y, z1));
    faces.push({ pts: roof.map((v) => [v[0], v[1]] as [number, number]), d: Math.min(...roof.map((v) => v[2])) - 0.02, fill: "#142339", stroke: "#ba985b" });
    faces.sort((u, v) => v.d - u.d);
    for (const fc of faces) {
      ctx.beginPath();
      fc.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = fc.fill;
      ctx.fill();
      ctx.strokeStyle = fc.stroke ?? fc.fill;
      ctx.lineWidth = fc.stroke ? 1.2 : 0.6;
      ctx.stroke();
    }
    // Vista en planta: curvas de nivel encima.
    if (this.pitch > 1.45) {
      for (const cl of t.contours(step)) {
        ctx.strokeStyle = cl.major ? "rgba(40,30,20,0.85)" : "rgba(40,30,20,0.45)";
        ctx.lineWidth = cl.major ? 1.4 : 0.7;
        for (const l of cl.lines) {
          ctx.beginPath();
          l.forEach((p, i) => {
            const v = P(p.x, p.y, p.z);
            if (i) ctx.lineTo(v[0], v[1]);
            else ctx.moveTo(v[0], v[1]);
          });
          ctx.stroke();
        }
      }
    }
    // Norte
    const n0 = P(cx, cy, cz),
      n1 = P(cx, cy + 1, cz);
    const ang = Math.atan2(n1[0] - n0[0], -(n1[1] - n0[1]));
    ctx.save();
    ctx.translate(W - 40, 44);
    ctx.rotate(ang);
    ctx.fillStyle = "#142339";
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(8, 12);
    ctx.lineTo(0, 6);
    ctx.lineTo(-8, 12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ba985b";
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("N", 0, -24);
    ctx.restore();
  }
}

// ─── Plano de implantación (hoja virtual T-01) ───────────────

function sitePrims(reader: ModelReader, s: Site, geoms: Iterable<ElementPlanGeometry>, scale: number, opts: { labels: boolean }): { prims: PlanPrimitive[]; box: { minX: number; minY: number; maxX: number; maxY: number } } {
  const t = s.terrain;
  const mm = scale / 1000; // metros por mm de papel
  const prims: PlanPrimitive[] = [];
  const step = t.contourInterval();
  for (const cl of t.contours(step)) {
    for (const l of cl.lines) {
      prims.push({ kind: "polyline", points: l.map((p) => ({ x: p.x, y: p.y })), style: "topo:curva", color: cl.major ? "#6b4f2a" : "#a88d63", weight: cl.major ? 0.35 : 0.15 });
      if (cl.major && opts.labels && l.length > 3) {
        const i = Math.floor(l.length / 2);
        const a = l[i - 1]!,
          b = l[i]!;
        let ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (ang > Math.PI / 2) ang -= Math.PI;
        if (ang < -Math.PI / 2) ang += Math.PI;
        prims.push({ kind: "text", at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, text: f(cl.z, 1).replace(/\./g, ""), height: 1.8 * mm, align: "center", rotation: ang, style: "topo:cota", color: "#6b4f2a" });
      }
    }
  }
  if (opts.labels && t.survey.points.length <= 600)
    for (const p of t.survey.points) {
      prims.push({ kind: "polyline", points: [{ x: p.x - 0.6 * mm, y: p.y }, { x: p.x + 0.6 * mm, y: p.y }], style: "topo:punto", color: "#4a4f57", weight: 0.13 });
      prims.push({ kind: "polyline", points: [{ x: p.x, y: p.y - 0.6 * mm }, { x: p.x, y: p.y + 0.6 * mm }], style: "topo:punto", color: "#4a4f57", weight: 0.13 });
      prims.push({ kind: "text", at: { x: p.x + 0.9 * mm, y: p.y + 0.9 * mm }, text: f(p.z, 2).replace(/\./g, ""), height: 1.2 * mm, align: "left", style: "topo:cota", color: "#4a4f57" });
    }
  // Casa: huella rellena + muros, puertas y ventanas trasladados al sitio.
  const ring = s.footprint.map((q) => toSite(s.placement, q));
  prims.push({ kind: "polygon", points: ring, style: "casa:huella", color: "#142339", fill: "tint", weight: 0.5 });
  for (const g of geoms) {
    if (g.kind !== "Wall" && g.kind !== "Window" && g.kind !== "Door") continue;
    for (const p of g.primitives) {
      if (p.kind === "text" || p.kind === "image") continue;
      const pts = p.kind === "arc" ? arcPoints(p, 12) : p.points;
      prims.push({ kind: p.kind === "polygon" ? "polygon" : "polyline", points: pts.map((q) => toSite(s.placement, q)), style: "casa:muro", color: "#142339", weight: p.kind === "polygon" ? 0.25 : 0.13, fill: p.kind === "polygon" && g.kind === "Wall" ? "solid" : undefined });
    }
  }
  const ew = siteEarthwork(s);
  const c = ring.reduce((a, q) => ({ x: a.x + q.x / ring.length, y: a.y + q.y / ring.length }), { x: 0, y: 0 });
  prims.push({ kind: "text", at: { x: c.x, y: c.y + 2.6 * mm }, text: `NPT ±0.00 = ${f(s.placement.npt, 2)}`, height: 2.6 * mm, align: "center", bold: true, style: "casa:npt", color: "#142339" });
  prims.push({ kind: "text", at: { x: c.x, y: c.y - 1.4 * mm }, text: `Corte ${f(ew.cut, 1)} m³ · Lleno ${f(ew.fill, 1)} m³`, height: 1.9 * mm, align: "center", style: "casa:npt", color: "#142339" });
  ew.corners.forEach((k, i) => {
    const p = ring[i]!;
    const dx = p.x - c.x,
      dy = p.y - c.y;
    const l = Math.hypot(dx, dy) || 1;
    const at = { x: p.x + (dx / l) * 4 * mm, y: p.y + (dy / l) * 4 * mm };
    prims.push({ kind: "text", at, text: `T ${k.zTerrain === undefined ? "—" : f(k.zTerrain, 2)}`, height: 1.7 * mm, align: "center", style: "casa:esquina", color: "#b3261e" });
  });
  return { prims, box: t.box };
}

const STATUS_SCALES = [100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 5000];

/** Hoja de implantación: una hoja virtual (no se guarda en el modelo) con el mismo rótulo y marco del juego. */
export function implantationSheet(reader: ModelReader, s: Site, ref: Sheet | undefined, geoms: Iterable<ElementPlanGeometry>, ew: Earthwork): { sheet: Sheet; items: Visible[] } {
  const vp = ref?.viewport ?? { x: 30, y: 15, w: 616, h: 564 };
  const t = s.terrain;
  const w = t.box.maxX - t.box.minX,
    h = t.box.maxY - t.box.minY;
  const usable = { w: vp.w - 24, h: vp.h - 24 };
  const scale = STATUS_SCALES.find((k) => (w * 1000) / k <= usable.w && (h * 1000) / k <= usable.h) ?? 5000;
  const notes = [
    `Levantamiento: ${t.survey.source} · ${t.survey.points.length} puntos · cotas ${f(t.zMin, 2)} a ${f(t.zMax, 2)} m.`,
    `Coordenadas locales: origen E ${f(t.survey.origin.x, 0)} · N ${f(t.survey.origin.y, 0)} (sumar para coordenadas del topógrafo).`,
    `Curvas de nivel cada ${f(t.contourInterval(), 2)} m; maestras cada ${f(t.contourInterval() * 5, 2)} m.`,
    `Implantación: origen de la casa en (${f(s.placement.x, 2)} ; ${f(s.placement.y, 2)}), giro ${f(s.placement.rotDeg, 1)}°.`,
    `NPT ±0.00 = ${f(s.placement.npt, 2)} m. Subrasante de la plataforma ${f(ew.platform, 2)} m (piso de 0,35 m).`,
    `Terreno bajo la casa: ${f(ew.zMin, 2)} a ${f(ew.zMax, 2)} m, pendiente media ${f(ew.slopePct, 1)} %.`,
    `Movimiento de tierras de la plataforma: corte ${f(ew.cut, 1)} m³, lleno ${f(ew.fill, 1)} m³ (volúmenes geométricos, sin abundamiento).`,
    `NPT de equilibrio corte = lleno: ${f(ew.balancedNpt, 2)} m.`,
    "T = cota del terreno natural en cada esquina de la casa.",
    "Verificar el levantamiento en campo, linderos y retiros de la parcelación antes de replantear.",
  ];
  const sheet: Sheet = {
    id: "topo-implantacion",
    kind: "Sheet",
    number: "T-01",
    title: "Topografía e implantación",
    levelId: "",
    disciplines: ["ARQ"],
    background: [],
    paper: ref?.paper ?? "A1",
    scale,
    viewCenter: { x: (t.box.minX + t.box.maxX) / 2, y: (t.box.minY + t.box.maxY) / 2 },
    viewport: vp,
    blocks: [{ type: "notas", x: 657, y: 300, w: 170, h: 180, title: "TOPOGRAFÍA E IMPLANTACIÓN", lines: notes }],
    fields: { hoja: "T-01", escala: `1:${scale}` },
    order: 0,
  } as Sheet;
  const { prims, box } = sitePrims(reader, s, geoms, scale, { labels: true });
  const geom: ElementPlanGeometry = { elementId: "topo", kind: "Annotation", discipline: "ARQ", levelId: "", primitives: prims, box, snapPoints: [] };
  return { sheet, items: [{ geom, background: false }] };
}

/** DXF topográfico en coordenadas del topógrafo (m): puntos, curvas, casa implantada. */
export function topoDxf(reader: ModelReader, s: Site, geoms: Iterable<ElementPlanGeometry>): string {
  const o = s.terrain.survey.origin;
  const { prims } = sitePrims(reader, s, geoms, 200, { labels: true });
  const shift = (q: Vec2) => ({ x: q.x + o.x, y: q.y + o.y });
  const layer = (st: string) => ({ "topo:curva": "TOPO-CURVAS", "topo:cota": "TOPO-COTAS", "topo:punto": "TOPO-PUNTOS", "casa:huella": "CASA-HUELLA", "casa:muro": "CASA-MUROS", "casa:npt": "CASA-NPT", "casa:esquina": "CASA-COTAS" })[st] ?? "TOPO";
  const ents: DxfEntity[] = prims.map((p) => ({ layer: p.style === "topo:curva" && (p as { weight?: number }).weight === 0.35 ? "TOPO-CURVAS-MAESTRAS" : layer(p.style), prim: p }));
  return toDxf(reader, ents, { toPaper: shift, mmPerM: 1 }, { widths: false });
}

/** Cotas 3D del terreno como texto (para el paquete). */
export function surveyCsv(s: Site): string {
  const o = s.terrain.survey.origin;
  return ["P,N,E,Z,D", ...s.terrain.survey.points.map((p: P3, i) => `${i + 1},${(p.y + o.y).toFixed(3)},${(p.x + o.x).toFixed(3)},${p.z.toFixed(3)},TN`)].join("\r\n");
}

// ─── Capítulo de memorias ────────────────────────────────────

export function topoChapter(s: Site): ReportChapter {
  const t = s.terrain;
  const ew = siteEarthwork(s);
  const kv = (rows: [string, string][]) => `<table class="kv">${rows.map(([k, v]) => `<tr><th>${escHtml(k)}</th><td>${v}</td></tr>`).join("")}</table>`;
  let html = `<ul class="norms"><li>Modelo digital del terreno por red de triángulos irregulares (TIN) de Delaunay sobre los puntos del levantamiento.</li><li>Volúmenes por integración numérica en malla de 0,25 m bajo la huella de la casa.</li></ul>`;
  html += kv([
    ["Levantamiento", escHtml(t.survey.source)],
    ["Puntos usados", `${t.survey.points.length} (de ${t.survey.stats["leidos"] ?? t.survey.points.length} leídos)`],
    ["Triángulos del TIN", String(t.tin.tris.length)],
    ["Rango de cotas", `${f(t.zMin, 3)} a ${f(t.zMax, 3)} m`],
    ["Origen local", `E ${f(t.survey.origin.x, 0)} · N ${f(t.survey.origin.y, 0)}`],
    ["Implantación", `(${f(s.placement.x, 2)} ; ${f(s.placement.y, 2)}) m, giro ${f(s.placement.rotDeg, 1)}°`],
  ]);
  html += `<h3>Método</h3><div class="eq">z(x, y) = λ<sub>1</sub>·z<sub>A</sub> + λ<sub>2</sub>·z<sub>B</sub> + λ<sub>3</sub>·z<sub>C</sub> &nbsp; (coordenadas baricéntricas del triángulo que contiene el punto)</div>`;
  html += `<div class="eq">V<sub>corte</sub> = Σ max(z<sub>T</sub> − z<sub>P</sub>, 0)·ΔA &nbsp;&nbsp; V<sub>lleno</sub> = Σ max(z<sub>P</sub> − z<sub>T</sub>, 0)·ΔA &nbsp;&nbsp; ΔA = 0,25 × 0,25 m²</div>`;
  html += `<div class="eq">z<sub>P</sub> = NPT − e<sub>piso</sub> = ${f(s.placement.npt, 2)} − 0,35 = <b>${f(ew.platform, 2)} m</b></div>`;
  html += `<h3>Resultados</h3>`;
  html += `<figure class="tbl"><figcaption>MOVIMIENTO DE TIERRAS DE LA PLATAFORMA</figcaption><table><tbody>
<tr><td>Área de la plataforma</td><td class="n">${f(ew.area, 2)} m²</td></tr>
<tr><td>Terreno bajo la casa (mín · medio · máx)</td><td class="n">${f(ew.zMin, 2)} · ${f(ew.zMean, 2)} · ${f(ew.zMax, 2)} m</td></tr>
<tr><td>Pendiente media del terreno bajo la casa</td><td class="n">${f(ew.slopePct, 1)} %</td></tr>
<tr class="b"><td>Volumen de corte</td><td class="n">${f(ew.cut, 2)} m³</td></tr>
<tr class="b"><td>Volumen de lleno</td><td class="n">${f(ew.fill, 2)} m³</td></tr>
<tr><td>Balance (corte − lleno)</td><td class="n">${f(ew.cut - ew.fill, 2)} m³</td></tr>
<tr><td>NPT de equilibrio</td><td class="n">${f(ew.balancedNpt, 2)} m</td></tr>
${ew.corners.map((k, i) => `<tr><td>Esquina ${i + 1} (${f(k.x, 2)} ; ${f(k.y, 2)}) del modelo</td><td class="n">T ${k.zTerrain === undefined ? "fuera del levantamiento" : f(k.zTerrain, 2) + " m · " + (k.zTerrain > ew.platform ? "corte " : "lleno ") + f(Math.abs(k.zTerrain - ew.platform), 2) + " m"}</td></tr>`).join("")}
</tbody></table><ul class="notes"><li>Volúmenes geométricos en banco, sin factor de abundamiento ni taludes; el lleno debe compactarse por capas de 0,20 m al 95 % del Proctor modificado.</li></ul></figure>`;
  const inside = ew.outside === 0;
  return {
    title: "Topografía e implantación",
    html,
    checks: [
      { item: "Casa dentro del levantamiento", ok: inside, detail: inside ? "Toda la huella tiene terreno levantado" : `${f(ew.outside, 1)} m² de la huella sin levantamiento` },
      { item: "Diferencia de cotas bajo la casa", ok: ew.zMax - ew.zMin <= 3, detail: `${f(ew.zMax - ew.zMin, 2)} m (≤ 3,00 m sin muros de contención altos)` },
    ],
  };
}

