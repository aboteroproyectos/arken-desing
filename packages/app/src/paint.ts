// Pintura de primitivas de planta: una sola regla de estilos para la pantalla, el SVG y el DXF.
// Los grosores y los trazos vienen en mm de papel, así el plano impreso tiene grosores normalizados.

import type { ModelReader, Vec2 } from "@arken/core";
import { arcPoints, type PlanPrimitive } from "@arken/geometry";

export const DISCIPLINE_COLORS: Readonly<Record<string, string>> = {
  ARQ: "#23262b",
  EST: "#5c6670",
  ELE: "#c4372b",
  ILU: "#c27c00",
  DOM: "#7b3fb5",
  HID: "#1c6dd0",
  SAN: "#7a4a1e",
  GAS: "#b8860b",
  SOL: "#e8590c",
};
const INK = "#23262b";
const GLASS = "#3b8fd6";
const BACKGROUND_INK = "#a9adb3";

export interface ResolvedPaint {
  /** Color de trazo; undefined = sin trazo. */
  readonly stroke: string | undefined;
  /** Grosor en mm de papel. */
  readonly weight: number;
  readonly dash: readonly number[] | undefined;
  readonly fill: string | undefined;
  readonly fillOpacity: number;
}

export interface PaintMode {
  /** Dibujar en gris, como fondo de referencia de otra disciplina. */
  readonly background?: boolean;
  /** Resaltado de selección o paso del cursor. */
  readonly highlight?: string;
}

function discColor(style: string): string {
  if (style.startsWith("d:")) return DISCIPLINE_COLORS[style.slice(2, 5)] ?? INK;
  return INK;
}

export function resolvePaint(model: ModelReader, p: PlanPrimitive, mode: PaintMode = {}): ResolvedPaint {
  const s = p.style;
  let weight = 0.25;
  let dash: readonly number[] | undefined;
  let stroke: string | undefined = discColor(s);
  let fill: string | undefined;
  let fillOpacity = 1;

  if (s.startsWith("capa:")) {
    const mat = model.getEntity(s.slice(5));
    fill = mat && mat.kind === "Material" ? (mat.displayColor ?? "#cccccc") : "#cccccc";
    stroke = "rgba(35,38,43,0.45)";
    weight = 0.09;
  } else if (s === "muro:contorno") weight = 0.6;
  else if (s === "muro:sin-capas") weight = 0.6;
  else if (s === "oculto") (weight = 0.18), (dash = [3, 1.5]);
  else if (s === "simbolo:puerta:hoja") weight = 0.35;
  else if (s === "simbolo:puerta:barrido") (weight = 0.13), (dash = [1, 1]);
  else if (s === "simbolo:puerta" || s.startsWith("simbolo:puerta")) weight = 0.25;
  else if (s.startsWith("simbolo:ventana")) {
    weight = 0.25;
    if (s.endsWith(":marco")) fill = "#ffffff";
    if (s.endsWith(":vidrio")) (stroke = GLASS), (weight = 0.18);
    if (s.includes(":oculto")) dash = [3, 1.5];
  }

  if ("weight" in p && p.weight !== undefined) weight = p.weight;
  if ("dash" in p && p.dash !== undefined) dash = p.dash;
  if (p.color) stroke = p.color;
  if ("fill" in p && p.fill) {
    if (p.fill === "white") (fill = "#ffffff"), (fillOpacity = 1);
    else if (p.fill === "solid") fill = stroke ?? INK;
    else if (p.fill === "tint") (fill = stroke ?? INK), (fillOpacity = s === "d:ARQ:espacio" ? 0.035 : 0.1);
  }
  if (weight === 0) stroke = undefined;

  if (mode.background) {
    if (stroke) stroke = BACKGROUND_INK;
    if (fill && fill !== "#ffffff") {
      if (s.startsWith("capa:")) fill = "#e4e2dd";
      else (fill = BACKGROUND_INK), (fillOpacity = Math.min(fillOpacity, 0.08));
    }
    weight = Math.min(weight, 0.25);
  }
  if (mode.highlight) {
    stroke = mode.highlight;
    weight = Math.max(weight, 0.18) + 0.25;
  }
  return { stroke, weight, dash, fill, fillOpacity };
}

export function primitivePoints(p: PlanPrimitive): readonly Vec2[] {
  if (p.kind === "arc") return arcPoints(p, 24);
  if (p.kind === "text") return [p.at];
  return p.points;
}

export function textColor(p: Extract<PlanPrimitive, { kind: "text" }>, mode: PaintMode): string {
  if (mode.highlight) return mode.highlight;
  if (mode.background) return BACKGROUND_INK;
  return p.color ?? discColor(p.style);
}

/** Tamaño de letra (em) por unidad de altura de texto del modelo: coincide con el ancho estimado 0.6·h por carácter. */
export const TEXT_EM = 1.1;
export const FONT = 'Arial, "Helvetica Neue", Helvetica, sans-serif';

// ─── Imágenes (logos) ───────────────────────────────────────

const IMAGES = new Map<string, HTMLImageElement>();
let imageListener: (() => void) | undefined;

/** Se llama cuando termina de cargar una imagen que ya se pidió dibujar (para redibujar). */
export function onImageLoaded(fn: () => void): void {
  imageListener = fn;
}

export function imageFor(src: string): HTMLImageElement | undefined {
  let img = IMAGES.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => imageListener?.();
    img.src = src;
    IMAGES.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : undefined;
}

/** Espera a que carguen las imágenes de estas primitivas (antes de exportar). */
export async function preloadImages(prims: Iterable<PlanPrimitive>): Promise<void> {
  const waits: Promise<void>[] = [];
  for (const p of prims) {
    if (p.kind !== "image") continue;
    imageFor(p.src);
    const img = IMAGES.get(p.src)!;
    if (!img.complete) waits.push(new Promise((res) => img.addEventListener("load", () => res(), { once: true })));
  }
  await Promise.all(waits);
}

// ─── Lienzo (canvas) ────────────────────────────────────────

export interface CanvasXf {
  toScreen(p: Vec2): Vec2;
  /** Píxeles por mm de papel. */
  readonly pxPerMm: number;
  /** Píxeles por metro del modelo. */
  readonly pxPerM: number;
}

export function paintCanvas(ctx: CanvasRenderingContext2D, model: ModelReader, prims: Iterable<PlanPrimitive>, xf: CanvasXf, mode: PaintMode = {}): void {
  for (const p of prims) {
    if (p.kind === "image") {
      const img = imageFor(p.src);
      if (!img) continue;
      const a = xf.toScreen(p.points[3]!);
      const b = xf.toScreen(p.points[1]!);
      ctx.drawImage(img, a.x, a.y, b.x - a.x, b.y - a.y);
      continue;
    }
    if (p.kind === "text") {
      const size = p.height * xf.pxPerM;
      if (size < 0.9) continue;
      const at = xf.toScreen(p.at);
      ctx.save();
      ctx.translate(at.x, at.y);
      if (p.rotation) ctx.rotate(-p.rotation);
      ctx.font = `${p.bold ? "bold " : ""}${(size * TEXT_EM).toFixed(2)}px ${FONT}`;
      ctx.textAlign = p.align;
      ctx.textBaseline = "middle";
      ctx.fillStyle = textColor(p, mode);
      ctx.fillText(p.text, 0, size * 0.06);
      ctx.restore();
      continue;
    }
    const r = resolvePaint(model, p, mode);
    const pts = primitivePoints(p);
    if (pts.length < 2) continue;
    ctx.beginPath();
    pts.forEach((q, i) => {
      const s = xf.toScreen(q);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    if (p.kind === "polygon") ctx.closePath();
    if (r.fill && p.kind === "polygon") {
      ctx.globalAlpha = r.fillOpacity;
      ctx.fillStyle = r.fill;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (r.stroke) {
      ctx.strokeStyle = r.stroke;
      ctx.lineWidth = Math.max(0.6, r.weight * xf.pxPerMm);
      ctx.setLineDash(r.dash ? r.dash.map((d) => Math.max(0.5, d * xf.pxPerMm)) : []);
      ctx.lineJoin = "round";
      ctx.lineCap = r.dash ? "butt" : "round";
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
}

// ─── SVG (vectorial, para imprimir o convertir a PDF) ────────

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

export interface SvgXf {
  /** Mundo → mm de papel (y hacia abajo). */
  toPaper(p: Vec2): Vec2;
  /** mm de papel por metro del modelo. */
  readonly mmPerM: number;
}

export function primitivesToSvg(model: ModelReader, prims: Iterable<PlanPrimitive>, xf: SvgXf, mode: PaintMode = {}): string {
  const out: string[] = [];
  for (const p of prims) {
    if (p.kind === "image") {
      const a = xf.toPaper(p.points[3]!);
      const b = xf.toPaper(p.points[1]!);
      out.push(`<image href="${p.src}" x="${n(a.x)}" y="${n(a.y)}" width="${n(b.x - a.x)}" height="${n(b.y - a.y)}" preserveAspectRatio="none"/>`);
      continue;
    }
    if (p.kind === "text") {
      const size = p.height * xf.mmPerM;
      const at = xf.toPaper(p.at);
      const anchor = p.align === "left" ? "start" : p.align === "center" ? "middle" : "end";
      const rot = p.rotation ? ` transform="rotate(${n((-p.rotation * 180) / Math.PI)} ${n(at.x)} ${n(at.y)})"` : "";
      out.push(
        `<text x="${n(at.x)}" y="${n(at.y + size * 0.06)}" font-size="${n(size * TEXT_EM)}" text-anchor="${anchor}" dominant-baseline="central"${p.bold ? ' font-weight="bold"' : ""} fill="${textColor(p, mode)}"${rot}>${esc(p.text)}</text>`,
      );
      continue;
    }
    const r = resolvePaint(model, p, mode);
    const pts = primitivePoints(p).map((q) => xf.toPaper(q));
    if (pts.length < 2) continue;
    const d = pts.map((q) => `${n(q.x)},${n(q.y)}`).join(" ");
    const tag = p.kind === "polygon" ? "polygon" : "polyline";
    const fill = r.fill && p.kind === "polygon" ? `fill="${r.fill}"${r.fillOpacity < 1 ? ` fill-opacity="${n(r.fillOpacity)}"` : ""}` : 'fill="none"';
    const stroke = r.stroke ? ` stroke="${r.stroke}" stroke-width="${n(r.weight)}" stroke-linejoin="round"${r.dash ? ` stroke-dasharray="${r.dash.map(n).join(" ")}"` : ' stroke-linecap="round"'}` : "";
    out.push(`<${tag} points="${d}" ${fill}${stroke}/>`);
  }
  return out.join("\n");
}

// ─── DXF R12 (para AutoCAD / BricsCAD / LibreCAD) ───────────

/** Color de AutoCAD (ACI) más cercano a un color hexadecimal, entre los 9 básicos. */
function nearestAci(hex: string): number {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return 256;
  const v = parseInt(m[1]!, 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const base: [number, number[]][] = [[1, [255, 0, 0]], [2, [255, 255, 0]], [3, [0, 255, 0]], [4, [0, 255, 255]], [5, [0, 0, 255]], [6, [255, 0, 255]], [7, [0, 0, 0]], [8, [128, 128, 128]], [9, [192, 192, 192]], [30, [255, 127, 0]], [34, [127, 63, 0]]];
  let best = 7;
  let bd = Infinity;
  for (const [i, b] of base) {
    const d = (b[0]! - c[0]!) ** 2 + (b[1]! - c[1]!) ** 2 + (b[2]! - c[2]!) ** 2;
    if (d < bd) (bd = d), (best = i);
  }
  return best;
}

const ACI: Readonly<Record<string, number>> = { ARQ: 7, EST: 8, ELE: 1, ILU: 30, DOM: 6, HID: 5, SAN: 34, GAS: 2, SOL: 32, ROTULO: 7, FONDO: 9 };

export interface DxfEntity {
  readonly layer: string;
  readonly prim: PlanPrimitive;
}

/** DXF ASCII R12 en mm de papel (escala 1:1 de impresión). */
/** DXF ASCII R12. `widths` = grosor de polilínea en mm de papel (solo tiene sentido en espacio papel). */
export function toDxf(model: ModelReader, items: Iterable<DxfEntity>, xf: { toPaper(p: Vec2): Vec2; mmPerM: number }, opts: { widths?: boolean } = {}): string {
  const widths = opts.widths ?? true;
  const lines: string[] = [];
  const g = (code: number, v: string | number) => lines.push(String(code), typeof v === "number" ? n(v) : v);
  const layers = new Set<string>();
  const ents: string[][] = [];
  for (const { layer, prim } of items) {
    if (prim.kind === "image") continue;
    layers.add(layer);
    const L: string[] = [];
    const add = (code: number, v: string | number) => L.push(String(code), typeof v === "number" ? n(v) : v);
    if (prim.kind === "text") {
      const at = xf.toPaper(prim.at);
      const h = prim.height * xf.mmPerM;
      add(0, "TEXT");
      add(8, layer);
      add(10, at.x);
      add(20, at.y - h / 2);
      add(30, 0);
      add(40, h);
      add(1, prim.text);
      if (prim.rotation) add(50, (prim.rotation * 180) / Math.PI);
      const hj = prim.align === "left" ? 0 : prim.align === "center" ? 1 : 2;
      if (hj) {
        add(72, hj);
        add(11, at.x);
        add(21, at.y - h / 2);
        add(31, 0);
      }
    } else {
      const pts = primitivePoints(prim).map((q) => xf.toPaper(q));
      if (pts.length < 2) continue;
      const r = resolvePaint(model, prim);
      add(0, "POLYLINE");
      add(8, layer);
      if (r.dash) add(6, r.dash[0]! <= 1.2 ? "DOT" : "HIDDEN");
      if (prim.color) add(62, nearestAci(prim.color));
      add(66, 1);
      add(70, prim.kind === "polygon" ? 1 : 0);
      if (widths) {
        add(40, r.weight);
        add(41, r.weight);
      }
      for (const q of pts) {
        add(0, "VERTEX");
        add(8, layer);
        add(10, q.x);
        add(20, q.y);
        add(30, 0);
      }
      add(0, "SEQEND");
      add(8, layer);
    }
    ents.push(L);
  }
  g(0, "SECTION");
  g(2, "HEADER");
  g(9, "$ACADVER");
  g(1, "AC1009");
  g(9, "$INSUNITS");
  g(70, widths ? 4 : 6);
  g(0, "ENDSEC");
  g(0, "SECTION");
  g(2, "TABLES");
  // Tipos de línea en mm de papel; en el DXF en metros se dejan a escala 1:50 (1 mm de papel = 0.05 m).
  const k = widths ? 1 : 0.05;
  const LT: [string, string, number[]][] = [
    ["CONTINUOUS", "Solid line", []],
    ["HIDDEN", "Hidden __ __ __", [3, -1.5]],
    ["DOT", "Dot . . . .", [0.2, -1]],
  ];
  g(0, "TABLE");
  g(2, "LTYPE");
  g(70, LT.length);
  for (const [name, desc, pat] of LT) {
    g(0, "LTYPE");
    g(2, name);
    g(70, 0);
    g(3, desc);
    g(72, 65);
    g(73, pat.length);
    g(40, pat.reduce((t, x) => t + Math.abs(x), 0) * k);
    for (const x of pat) g(49, x * k);
  }
  g(0, "ENDTAB");
  g(0, "TABLE");
  g(2, "LAYER");
  g(70, layers.size);
  for (const l of layers) {
    g(0, "LAYER");
    g(2, l);
    g(70, 0);
    g(62, ACI[l.split("-")[0] ?? ""] ?? 7);
    g(6, "CONTINUOUS");
  }
  g(0, "ENDTAB");
  g(0, "ENDSEC");
  g(0, "SECTION");
  g(2, "ENTITIES");
  for (const L of ents) lines.push(...L);
  g(0, "ENDSEC");
  g(0, "EOF");
  return lines.join("\r\n");
}
