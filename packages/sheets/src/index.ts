// Hojas de planos con rótulo editable (Paso 7).
//
// Una hoja (Sheet) es una VISTA: papel, escala, ventana de dibujo sobre el modelo y bloques de
// contenido (cuadros, convenciones, notas, diagrama unifilar, fachadas). Todo se genera desde el
// modelo cada vez que se dibuja, de modo que el rótulo y los cuadros nunca quedan desactualizados.
//
// Coordenadas: el papel se mide en mm con origen abajo a la izquierda. La hoja se coloca en el
// mundo (metros) de forma que `viewCenter` caiga en el centro de la ventana de dibujo.

import {
  DISCIPLINE_NAMES,
  PAPER_MM,
  getOfKind,
  type Id,
  type ModelReader,
  type Opening,
  type Project,
  type Sheet,
  type SheetBlock,
  type Vec2,
  type Wall,
} from "@arken/core";
import {
  areaTable,
  circuitResults,
  demandTable,
  gasTable,
  lightingTable,
  loadScheduleTable,
  rainTable,
  sanitaryTable,
  solarTable,
  usedSymbols,
  waterTable,
  type Table,
} from "@arken/calc";
import { LOGO_ARKEN_DISENO, LOGO_ASPECT } from "./logo";
import { RUN_STYLES, SYMBOLS, drawSymbol, type AABB2, type Paint, type PlanPrimitive } from "@arken/geometry";

export interface SheetGeometry {
  readonly primitives: readonly PlanPrimitive[];
  /** Rectángulo del papel en el mundo. */
  readonly paper: AABB2;
  /** Ventana de dibujo en el mundo: el modelo solo se ve aquí dentro. */
  readonly viewport: AABB2;
  /** Metros del modelo por mm de papel. */
  readonly k: number;
}

const STYLE = "hoja";
const FRAME_INK = "#1a1d21";
/** Colores de la familia ARKEN 360: azul noche, dorado y plata. */
const BRAND = "#142339";
const BRAND_GOLD = "#ba985b";
const BRAND_SOFT = "#d9dde4";

/** Pasa de mm de papel a metros del mundo. */
export function sheetTransform(sheet: Sheet): { k: number; toWorld: (x: number, y: number) => Vec2; origin: Vec2 } {
  const k = sheet.scale / 1000;
  const vp = sheet.viewport;
  const origin = { x: sheet.viewCenter.x - (vp.x + vp.w / 2) * k, y: sheet.viewCenter.y - (vp.y + vp.h / 2) * k };
  return { k, origin, toWorld: (x, y) => ({ x: origin.x + x * k, y: origin.y + y * k }) };
}

/** Pinta en mm de papel y traduce al mundo. */
class Pen {
  constructor(
    readonly w: (x: number, y: number) => Vec2,
    readonly k: number,
    readonly out: PlanPrimitive[] = [],
  ) {}
  /** Pluma local: coordenadas en mm sin escalar desde (x0, y0), con todo (textos incluidos) multiplicado por `s`. */
  scaled(x0: number, y0: number, s: number): Pen {
    return new Pen((x, y) => this.w(x0 + x * s, y0 + y * s), this.k * s, this.out);
  }
  image(src: string, x: number, y: number, w: number, h: number): this {
    this.out.push({ kind: "image", src, points: [this.w(x, y), this.w(x + w, y), this.w(x + w, y + h), this.w(x, y + h)], style: STYLE });
    return this;
  }
  line(pts: [number, number][], paint: Paint = { weight: 0.25 }): this {
    this.out.push({ kind: "polyline", points: pts.map(([x, y]) => this.w(x, y)), style: STYLE, ...paint });
    return this;
  }
  rect(x: number, y: number, w: number, h: number, paint: Paint = { weight: 0.25 }): this {
    this.out.push({ kind: "polygon", points: [this.w(x, y), this.w(x + w, y), this.w(x + w, y + h), this.w(x, y + h)], style: STYLE, ...paint });
    return this;
  }
  text(t: string, x: number, y: number, size = 2, align: "left" | "center" | "right" = "left", bold = false, color?: string, rotation = 0): this {
    this.out.push({ kind: "text", at: this.w(x, y), text: t, height: size * this.k, align, bold, rotation, style: STYLE, ...(color ? { color } : {}) });
    return this;
  }
  circle(cx: number, cy: number, r: number, paint: Paint = { weight: 0.25 }): this {
    const pts: [number, number][] = [];
    for (let i = 0; i < 24; i++) pts.push([cx + r * Math.cos((i / 24) * 2 * Math.PI), cy + r * Math.sin((i / 24) * 2 * Math.PI)]);
    this.out.push({ kind: "polygon", points: pts.map(([x, y]) => this.w(x, y)), style: STYLE, ...paint });
    return this;
  }
}

/** Corta un texto en líneas de como máximo `max` caracteres. */
export function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if ((line + " " + word).trim().length > max && line) {
        out.push(line);
        line = word;
      } else line = (line + " " + word).trim();
    }
    out.push(line);
  }
  return out;
}

function projectOf(reader: ModelReader): Project | undefined {
  for (const e of reader.entities()) if (e.kind === "Project") return e;
  return undefined;
}

/** Campos del rótulo: los del proyecto, sobrescritos por los de la hoja. */
export function titleFields(reader: ModelReader, sheet: Sheet): Record<string, string> {
  return { ...(projectOf(reader)?.titleBlock ?? {}), ...sheet.fields };
}

export function allSheets(reader: ModelReader): Sheet[] {
  const out: Sheet[] = [];
  for (const e of reader.entities()) if (e.kind === "Sheet") out.push(e);
  return out.sort((a, b) => a.order - b.order || a.number.localeCompare(b.number, "es", { numeric: true }));
}

// ─── Rótulo ARKEN 360 ────────────────────────────────────────

function drawTitleBlock(p: Pen, reader: ModelReader, sheet: Sheet, x: number, y: number, w: number, h: number): void {
  const F = titleFields(reader, sheet);
  const sheets = allSheets(reader);
  const idx = sheets.findIndex((s) => s.id === sheet.id) + 1;
  p.rect(x, y, w, h, { weight: 0.5 });
  const rows: [string, string, number][] = [
    ["PROYECTO", F["proyecto"] ?? "", 11],
    ["LOCALIZACIÓN", F["localizacion"] ?? "", 9],
    ["PROPIETARIO", F["propietario"] ?? "", 7],
    ["CONTENIDO", sheet.title, 11],
    ["DISEÑO", `${F["diseno"] ?? ""}${F["matricula"] ? " · " + F["matricula"] : ""}`, 9],
  ];
  let cy = y + h;
  for (const [label, value, rh] of rows) {
    cy -= rh;
    p.line([[x, cy], [x + w, cy]], { weight: 0.18 });
    p.text(label, x + 1.5, cy + rh - 2.4, 1.6, "left", false, "#5b6068");
    const lines = wrap(value, Math.floor((w - 3) / 1.45));
    lines.slice(0, 2).forEach((l, i) => p.text(l, x + 1.5, cy + rh - 5.6 - i * 3.1, label === "CONTENIDO" || label === "PROYECTO" ? 2.4 : 2, "left", label === "CONTENIDO" || label === "PROYECTO"));
  }
  // Fila de responsables
  const resp: [string, string][] = [
    ["DIBUJÓ", F["dibujo"] ?? ""],
    ["REVISÓ", F["reviso"] ?? ""],
    ["APROBÓ", F["aprobo"] ?? ""],
  ];
  cy -= 8;
  p.line([[x, cy], [x + w, cy]], { weight: 0.18 });
  resp.forEach(([l, v], i) => {
    const cx = x + (w / 3) * i;
    if (i > 0) p.line([[cx, cy], [cx, cy + 8]], { weight: 0.18 });
    p.text(l, cx + 1.5, cy + 5.6, 1.5, "left", false, "#5b6068");
    p.text(v, cx + 1.5, cy + 2.2, 1.9);
  });
  // Escala, fecha, revisión
  const meta: [string, string][] = [
    ["ESCALA", F["escala"] ?? `1:${sheet.scale}`],
    ["FECHA", F["fecha"] ?? ""],
    ["REVISIÓN", F["revision"] ?? "0"],
  ];
  cy -= 8;
  p.line([[x, cy], [x + w, cy]], { weight: 0.18 });
  meta.forEach(([l, v], i) => {
    const cx = x + (w / 3) * i;
    if (i > 0) p.line([[cx, cy], [cx, cy + 8]], { weight: 0.18 });
    p.text(l, cx + 1.5, cy + 5.6, 1.5, "left", false, "#5b6068");
    p.text(v, cx + 1.5, cy + 2.2, 2, "left", true);
  });
  // Número de plano
  const bottom = y;
  p.line([[x + w * 0.62, bottom], [x + w * 0.62, cy]], { weight: 0.18 });
  p.text("PLANO N.º", x + 1.5, cy - 3, 1.6, "left", false, "#5b6068");
  p.text(sheet.number, x + w * 0.31, bottom + (cy - bottom) / 2 - 4, 9, "center", true, BRAND);
  p.text("HOJA", x + w * 0.62 + 1.5, cy - 3, 1.6, "left", false, "#5b6068");
  p.text(F["hoja"] || `${idx} DE ${sheets.length}`, x + w * 0.81, bottom + (cy - bottom) / 2 - 2, 3.2, "center", true);
  p.text(F["archivo"] ?? "", x + w * 0.81, bottom + 2.5, 1.4, "center", false, "#5b6068");
}

/** Logo del rótulo: el del proyecto, el de ARKEN DISEÑO por defecto, o ninguno ("ninguno"). */
export function titleLogo(F: Record<string, string>): string | undefined {
  const v = (F["logo"] ?? "").trim();
  if (v.toLowerCase() === "ninguno") return undefined;
  return v.startsWith("data:image/") ? v : LOGO_ARKEN_DISENO;
}

function drawHeader(p: Pen, reader: ModelReader, sheet: Sheet, x: number, y: number, w: number, h: number): void {
  const F = titleFields(reader, sheet);
  p.rect(x, y, w, h, { weight: 0.5 });
  p.rect(x, y, w, h, { fill: "solid", color: BRAND, weight: 0 });
  const logo = titleLogo(F);
  let cx = x + w / 2;
  if (logo) {
    const lh = h - 6;
    const lw = lh * (F["logo_aspecto"] ? Number(F["logo_aspecto"]) || LOGO_ASPECT : logo === LOGO_ARKEN_DISENO ? LOGO_ASPECT : 1);
    p.image(logo, x + 4, y + 3, lw, lh);
    cx = x + 4 + lw + (w - 4 - lw) / 2;
  }
  p.text(F["empresa"] ?? "ARKEN 360", cx, y + h - 11, 8, "center", true, "#ffffff");
  p.text(F["lema"] ?? "", cx, y + h - 19, 2.2, "center", false, BRAND_SOFT);
  const contact = [F["empresa_contacto"] ?? "", F["empresa_web"] ?? ""].filter(Boolean).join(" · ");
  if (contact) p.text(contact, cx, y + 4, 1.7, "center", false, BRAND_SOFT);
  p.line([[cx - 22, y + h - 16], [cx + 22, y + h - 16]], { weight: 0.35, color: BRAND_GOLD });
}

// ─── Tablas ──────────────────────────────────────────────────

const STATUS_COLOR = { ok: "#1b7f3b", revisar: "#c4372b", info: "#5b6068" } as const;

/** Dibuja una tabla de cálculo ajustada al bloque; devuelve la altura usada. */
export function drawTable(p: Pen, t: Table, x: number, top: number, w: number, maxH: number): number {
  const noteLines = (t.notes ?? []).flatMap((n) => wrap(n, Math.floor(w / 1.25)));
  const nRows = t.rows.length + 2 + noteLines.length * 0.75;
  const rh = Math.max(2.6, Math.min(4.4, maxH / Math.max(nRows, 1)));
  const fs = Math.min(1.9, rh * 0.48);
  const total = t.widths.reduce((a, b) => a + b, 0);
  const xs: number[] = [x];
  for (const cw of t.widths) xs.push(xs[xs.length - 1]! + (cw / total) * w);
  let y = top;
  p.text(t.title, x, y - rh * 0.7, fs * 1.15, "left", true, BRAND);
  y -= rh;
  p.rect(x, y - rh, w, rh, { fill: "tint", color: BRAND, weight: 0.25 });
  t.columns.forEach((c, i) => p.text(c, (xs[i]! + xs[i + 1]!) / 2, y - rh / 2, fs * 0.85, "center", true));
  y -= rh;
  for (const r of t.rows) {
    if (top - y + rh > maxH - noteLines.length * rh * 0.75) {
      p.text("… (continúa: amplíe el bloque)", x + 1, y - rh / 2, fs * 0.85, "left", false, "#c4372b");
      y -= rh;
      break;
    }
    p.line([[x, y - rh], [x + w, y - rh]], { weight: 0.1 });
    r.cells.forEach((c, i) => {
      const cw = xs[i + 1]! - xs[i]!;
      const maxChars = Math.max(2, Math.floor(cw / (fs * 0.56)));
      const txt = c.length > maxChars ? c.slice(0, maxChars - 1) + "…" : c;
      const isStatus = i === r.cells.length - 1 && r.status && r.status !== "info";
      const left = i === 1 || (t.columns.length <= 2 && i === 0);
      p.text(txt, left ? xs[i]! + 0.8 : (xs[i]! + xs[i + 1]!) / 2, y - rh / 2, fs, left ? "left" : "center", r.bold || isStatus, isStatus ? STATUS_COLOR[r.status!] : undefined);
    });
    y -= rh;
  }
  p.rect(x, y, w, top - rh - y, { weight: 0.3 });
  for (let i = 1; i < xs.length - 1; i++) p.line([[xs[i]!, top - rh], [xs[i]!, y]], { weight: 0.1 });
  for (const n of noteLines) {
    y -= rh * 0.75;
    p.text(n, x, y, fs * 0.85, "left", false, "#41454b");
  }
  return top - y;
}

// ─── Convenciones (leyenda automática) ───────────────────────

function drawLegend(p: Pen, reader: ModelReader, sheet: Sheet, b: SheetBlock): void {
  const { symbols, systems } = usedSymbols(reader, sheet.levelId, sheet.disciplines);
  // El mobiliario de arquitectura no va en la leyenda; los equipos de tamaño real sí.
  const syms = symbols.filter((s) => SYMBOLS.has(s) && SYMBOLS.get(s)!.discipline !== "ARQ");
  syms.sort((a, c) => (SYMBOLS.get(a)?.discipline ?? "").localeCompare(SYMBOLS.get(c)?.discipline ?? "") || a.localeCompare(c));
  const items = syms.length + systems.length;
  const rh = Math.max(4, Math.min(6.2, (b.h - 8) / Math.max(items, 1)));
  let y = b.y + b.h - 4;
  p.text(b.title ?? "CONVENCIONES", b.x, y, 2.4, "left", true, BRAND);
  y -= rh;
  const iconX = b.x + 6;
  for (const key of syms) {
    const def = SYMBOLS.get(key)!;
    const at = p.w(iconX, y);
    // Los símbolos de tamaño real se muestran reducidos en la leyenda.
    const prims = def.realSize
      ? drawSymbol(key, { position: at, rotation: 0, mm: p.k, style: `d:${def.discipline}`, props: legendProps(key, p.k) })
      : drawSymbol(key, { position: at, rotation: 0, mm: p.k, style: `d:${def.discipline}`, props: {} });
    p.out.push(...prims);
    const lines = wrap(def.name, Math.floor((b.w - 14) / 1.12));
    lines.slice(0, 2).forEach((l, i) => p.text(l, b.x + 13, y + (lines.length > 1 ? 1.1 - i * 2.4 : 0), 1.75));
    y -= rh;
  }
  for (const sys of systems) {
    const st = RUN_STYLES[sys];
    if (!st) continue;
    const disc = sheet.disciplines[0] ?? "ARQ";
    p.out.push({ kind: "polyline", points: [p.w(b.x + 1, y), p.w(b.x + 11, y)], style: `d:${disc}`, ...st.paint });
    const lines = wrap(`${sys}: ${st.name}`, Math.floor((b.w - 14) / 1.12));
    lines.slice(0, 2).forEach((l, i) => p.text(l, b.x + 13, y + (lines.length > 1 ? 1.1 - i * 2.4 : 0), 1.75));
    y -= rh;
  }
}

function legendProps(key: string, k: number): Record<string, number | string> {
  // Tamaños de muestra en metros equivalentes a ~8 mm de papel.
  const s = 8 * k;
  switch (key) {
    case "panel":
      return { largo_m: s, ancho_m: s * 0.5 };
    case "caja":
      return { lado_m: s * 0.5 };
    case "lineal":
    case "tira":
      return { largo_m: s };
    case "trampa-grasas":
    case "septico":
      return { largo_m: s, ancho_m: s * 0.5, rotulo: "" };
    case "tanque":
      return { diametro_m: s * 0.6, rotulo: "" };
  }
  return {};
}

// ─── Notas ───────────────────────────────────────────────────

function drawNotes(p: Pen, b: SheetBlock): void {
  let y = b.y + b.h - 4;
  p.text(b.title ?? "NOTAS", b.x, y, 2.4, "left", true, BRAND);
  y -= 4.5;
  const maxChars = Math.floor(b.w / 1.08);
  (b.lines ?? []).forEach((n, i) => {
    const lines = wrap(n, maxChars - 4);
    lines.forEach((l, j) => {
      if (y < b.y + 1) return;
      p.text(j === 0 ? `${i + 1}.` : "", b.x, y, 1.75);
      p.text(l, b.x + 4, y, 1.75);
      y -= 2.75;
    });
    y -= 0.6;
  });
}

// ─── Diagrama unifilar (generado desde los circuitos) ────────

function drawSingleLine(p: Pen, reader: ModelReader, b: SheetBlock): void {
  const results = circuitResults(reader);
  const panels = [...new Set(results.map((r) => r.circuit.panel))];
  const proj = projectOf(reader)?.properties ?? {};
  const s = (k: string, d: string) => (typeof proj[k] === "string" ? (proj[k] as string) : d);
  let y = b.y + b.h - 4;
  p.text(b.title ?? "DIAGRAMA UNIFILAR", b.x, y, 2.6, "left", true, BRAND);
  // Columna de la acometida
  const x0 = b.x + 10;
  y -= 10;
  p.text(s("red_operador", "Red de distribución BT 120/240 V"), x0, y, 1.9, "left", true);
  y -= 3;
  p.line([[x0, y], [x0, y - 6]], { weight: 0.5 });
  y -= 6;
  p.circle(x0, y - 3.5, 3.5, { weight: 0.35, fill: "white" }).text("kWh", x0, y - 3.5, 1.6, "center", true);
  p.text(s("medidor", "Medidor bidireccional clase 1, 120/240 V"), x0 + 6, y - 3.5, 1.7);
  y -= 7;
  p.line([[x0, y], [x0, y - 6]], { weight: 0.5 });
  p.text(s("acometida", ""), x0 + 3, y - 3, 1.6);
  y -= 6;
  const breaker = (bx: number, by: number) => p.line([[bx, by], [bx + 1.6, by - 2.8]], { weight: 0.4 }).circle(bx, by, 0.5, { weight: 0.3, fill: "solid" });
  breaker(x0, y);
  p.text(s("totalizador", "Totalizador 2P"), x0 + 3, y - 1.5, 1.7, "left", true);
  y -= 4;
  p.line([[x0, y], [x0, y - 3]], { weight: 0.5 });
  y -= 3;

  const rowH = Math.max(3.4, Math.min(7.5, (y - b.y - 30 - 14 * panels.length) / Math.max(results.length + 2, 1)));
  for (const panel of panels) {
    const rows = results.filter((r) => r.circuit.panel === panel);
    // Barraje del tablero
    const busTop = y;
    const busBottom = y - rowH * rows.length - 2;
    p.line([[x0, busTop], [x0, busBottom]], { weight: 1.2 });
    p.text(`TABLERO ${panel}`, x0 + 3, busTop + 2.4, 2.4, "left", true, BRAND);
    p.text(s(`tablero_${panel}`, ""), x0 + 26, busTop + 2.4, 1.8, "left");
    let ry = busTop - rowH / 2 - 1;
    for (const r of rows) {
      const c = r.circuit;
      p.line([[x0, ry], [x0 + 8, ry]], { weight: 0.35 });
      p.line([[x0 + 8, ry], [x0 + 10.5, ry + 1.6]], { weight: 0.4 });
      p.line([[x0 + 11, ry], [x0 + 24, ry]], { weight: 0.35 });
      p.text(`${c.voltage === 240 ? "2P" : "1P"}-${c.breakerA}A`, x0 + 12, ry + 1.3, 1.7);
      p.text(`${c.number}`, x0 + 25, ry, 2.1, "left", true);
      p.text(`${c.description} · ${c.voltage} V · ${r.loadVA.toFixed(0)} VA · 2#${c.conductorAwg}+T Cu · ${c.conduit}`, x0 + 34, ry, 1.9);
      ry -= rowH;
    }
    y = busBottom - 10;
  }
  // Notas del sistema
  const extra = typeof proj["unifilar_notas"] === "string" ? (proj["unifilar_notas"] as string).split("|") : [];
  extra.forEach((n) => {
    if (y < b.y + 2) return;
    for (const l of wrap(n, Math.floor(b.w / (1.9 * 0.6)))) {
      if (y < b.y + 2) return;
      p.text(l, b.x, y, 1.9, "left", false, "#41454b");
      y -= 2.9;
    }
    y -= 0.8;
  });
}

// ─── Fachadas y corte (generados desde muros y huecos) ───────

interface Facade {
  readonly key: "S" | "N" | "E" | "W";
  readonly name: string;
}

function drawElevations(p: Pen, reader: ModelReader, sheet: Sheet, b: SheetBlock): void {
  const proj = projectOf(reader)?.properties ?? {};
  const n = (k: string, d: number) => (typeof proj[k] === "number" ? (proj[k] as number) : d);
  const scale = n("fachadas_escala", 100);
  const mmPerM = 1000 / scale;
  const xMin = n("casa_xmin", 0);
  const xMax = n("casa_xmax", 12);
  const yMin = n("casa_ymin", 0);
  const yMax = n("casa_ymax", 15);
  const hHigh = n("cubierta_alta_m", 4.2);
  const slope = n("cubierta_pendiente_pct", 10) / 100;
  const eave = n("cubierta_alero_m", 0.9);
  const roofT = n("cubierta_espesor_m", 0.25);
  const roofAt = (x: number) => hHigh - slope * (x - xMin);

  const walls: Wall[] = [];
  for (const id of reader.indices.elementsOfLevel(sheet.levelId)) {
    const e = getOfKind(reader, id, "Wall");
    if (e && typeof e.properties?.["fachada"] === "string") walls.push(e);
  }
  const facades: Facade[] = [
    { key: "S", name: "FACHADA SUR (ACCESO)" },
    { key: "W", name: "FACHADA OCCIDENTAL" },
    { key: "N", name: "FACHADA NORTE (TERRAZA)" },
    { key: "E", name: "FACHADA ORIENTAL" },
  ];
  const WALL = "#ebe6dc";
  const GLASS = "#cfe2f1";
  const FRAME = "#2b2f33";
  const WOOD = "#a8744c";
  const ROOF = "#4a4f55";
  const fillRect = (x: number, y: number, w: number, h: number, color: string) => p.rect(x, y, w, h, { fill: "solid", color, weight: 0 });
  const fillPoly = (pts: [number, number][], color: string) => p.out.push({ kind: "polygon", points: pts.map(([x, y]) => p.w(x, y)), style: STYLE, fill: "solid", color, weight: 0 });
  const cellW = b.w / 2;
  const cellH = (b.h - 8) / 2;
  p.text(b.title ?? `FACHADAS · ESCALA 1:${scale}`, b.x, b.y + b.h - 3, 2.6, "left", true, BRAND);
  // Revestimiento en madera (zona de acceso): "fachada_<K>_madera" = "u0-u1" en metros del eje del modelo.
  const woodSpan = (k: string): [number, number] | undefined => {
    const v = proj[`fachada_${k}_madera`];
    if (typeof v !== "string") return undefined;
    const [a, c] = v.split("-").map(Number);
    return a !== undefined && c !== undefined && Number.isFinite(a) && Number.isFinite(c) ? [a, c] : undefined;
  };
  const carport = { x0: n("parqueadero_xmin", NaN), x1: n("parqueadero_xmax", NaN), y0: n("parqueadero_ymin", NaN), y1: n("parqueadero_ymax", NaN), h: n("parqueadero_altura_m", 2.8) };
  const hasCarport = Number.isFinite(carport.x0);

  facades.forEach((fc, i) => {
    const isSN = fc.key === "S" || fc.key === "N";
    const span = isSN ? [xMin, xMax] : [yMin, yMax];
    const width = span[1]! - span[0]!;
    // u: coordenada horizontal vista desde fuera (izquierda → derecha), en metros
    const toU = (pt: Vec2) => (fc.key === "S" ? pt.x - xMin : fc.key === "N" ? xMax - pt.x : fc.key === "E" ? pt.y - yMin : yMax - pt.y);
    const uOfX = (x: number) => (fc.key === "S" ? x - xMin : xMax - x);
    const hAt = (u: number) => (fc.key === "S" ? roofAt(xMin + u) : fc.key === "N" ? roofAt(xMax - u) : roofAt(fc.key === "E" ? xMax : xMin));
    // Extensión dibujada (incluye parqueadero en S, N y W) para centrar la fachada en su celda
    let uLeft = -eave;
    let uRight = width + eave;
    if (hasCarport && isSN) {
      const a = uOfX(carport.x0);
      const c = uOfX(carport.x1);
      uLeft = Math.min(uLeft, a, c);
      uRight = Math.max(uRight, a, c);
    }
    const hTop = Math.max(hAt(-eave), hAt(width + eave), hAt(0), hAt(width)) + roofT;
    const drawW = (uRight - uLeft) * mmPerM;
    const drawH = hTop * mmPerM;
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cellX = b.x + col * cellW;
    const cellY = b.y + (1 - row) * cellH;
    const cx0 = cellX + 22 + (cellW - 30 - drawW) / 2 - uLeft * mmPerM;
    const cy0 = cellY + (cellH - drawH) / 2 + 4;
    const X = (u: number) => cx0 + u * mmPerM;
    const Y = (h: number) => cy0 + h * mmPerM;

    // Muro de fachada (relleno + contorno)
    fillPoly([[X(0), Y(0)], [X(0), Y(hAt(0))], [X(width), Y(hAt(width))], [X(width), Y(0)]], WALL);
    const wood = woodSpan(fc.key);
    if (wood) {
      const u0 = Math.min(uOfX(wood[0]), uOfX(wood[1]));
      const u1 = Math.max(uOfX(wood[0]), uOfX(wood[1]));
      fillPoly([[X(u0), Y(0)], [X(u0), Y(hAt(u0))], [X(u1), Y(hAt(u1))], [X(u1), Y(0)]], WOOD);
      for (let u = u0 + 0.1; u < u1 - 0.02; u += 0.1) p.line([[X(u), Y(0)], [X(u), Y(hAt(u))]], { weight: 0.08, color: "#7d5235" });
    }
    p.line([[X(0), Y(0)], [X(0), Y(hAt(0))], [X(width), Y(hAt(width))], [X(width), Y(0)]], { weight: 0.5 });

    // Vanos de la fachada
    for (const w of walls.filter((w) => w.properties?.["fachada"] === fc.key)) {
      for (const oid of reader.indices.openingsOfHost(w.id)) {
        const o = getOfKind(reader, oid, "Opening") as Opening | undefined;
        if (!o) continue;
        const L = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
        const ux = (w.end.x - w.start.x) / L;
        const uy = (w.end.y - w.start.y) / L;
        const a = { x: w.start.x + ux * o.offsetAlongAxis, y: w.start.y + uy * o.offsetAlongAxis };
        const c = { x: a.x + ux * o.width, y: a.y + uy * o.width };
        const u0 = Math.min(toU(a), toU(c));
        const u1 = Math.max(toU(a), toU(c));
        const filling = reader.getEntity(reader.indices.fillingOfOpening(oid) ?? "");
        const isDoor = filling?.kind === "Door";
        const x = X(u0);
        const y = Y(o.sillHeight);
        const ww = (u1 - u0) * mmPerM;
        const hh = o.height * mmPerM;
        if (isDoor) {
          const main = /principal/i.test(filling?.name ?? "");
          fillRect(x, y, ww, hh, main ? WOOD : "#8d949b");
          if (main) {
            fillRect(x + ww * 0.62, y + hh * 0.08, ww * 0.25, hh * 0.84, GLASS);
            p.rect(x + ww * 0.62, y + hh * 0.08, ww * 0.25, hh * 0.84, { weight: 0.18, color: FRAME });
          } else for (let k = 1; k < 8; k++) p.line([[x + 0.4, y + (hh * k) / 8], [x + ww - 0.4, y + (hh * k) / 8]], { weight: 0.1, color: "#5f666d" });
          p.rect(x, y, ww, hh, { weight: 0.35, color: FRAME });
          p.line([[x + ww * 0.12, y + 1.0 * mmPerM], [x + ww * 0.12, y + 1.25 * mmPerM]], { weight: 0.35, color: FRAME });
        } else {
          fillRect(x, y, ww, hh, GLASS);
          const parts = Math.max(1, Math.round((u1 - u0) / 1.2));
          for (let k = 1; k < parts; k++) p.line([[x + (ww * k) / parts, y], [x + (ww * k) / parts, y + hh]], { weight: 0.3, color: FRAME });
          // Reflejos del vidrio
          for (let k = 0; k < parts; k++) {
            const px = x + (ww * k) / parts;
            const pw = ww / parts;
            p.line([[px + pw * 0.15, y + hh * 0.2], [px + pw * 0.45, y + hh * 0.55]], { weight: 0.1, color: "#ffffff" });
          }
          p.rect(x, y, ww, hh, { weight: 0.4, color: FRAME });
        }
      }
    }

    // Parqueadero cubierto (estructura liviana adosada)
    if (hasCarport) {
      const ph = carport.h;
      if (isSN) {
        const a = Math.min(uOfX(carport.x0), uOfX(carport.x1));
        const c = Math.max(uOfX(carport.x0), uOfX(carport.x1));
        const far = fc.key === "S" ? a : c; // lado libre (columnas)
        const near = fc.key === "S" ? c : a; // lado adosado a la casa
        fillRect(X(Math.min(a, c)), Y(ph), (c - a) * mmPerM, 0.15 * mmPerM, ROOF);
        const colU = far + (fc.key === "S" ? 0.15 : -0.15);
        p.rect(X(colU) - 0.06 * mmPerM, Y(0), 0.12 * mmPerM, ph * mmPerM, { weight: 0.25, fill: "solid", color: "#5c6670" });
        p.line([[X(near), Y(ph)], [X(near), Y(ph + 0.15)]], { weight: 0.25 });
      } else if (fc.key === "W") {
        const a = yMax - carport.y1;
        const c = yMax - carport.y0;
        fillRect(X(a), Y(ph), (c - a) * mmPerM, 0.15 * mmPerM, ROOF);
        for (const u of [a + 0.15, c - 0.15]) p.rect(X(u) - 0.06 * mmPerM, Y(0), 0.12 * mmPerM, ph * mmPerM, { weight: 0.25, fill: "solid", color: "#5c6670" });
        p.text("PARQUEADERO CUBIERTO", X((a + c) / 2), Y(ph + 0.45), 1.6, "center");
      }
    }

    // Cubierta con aleros (canto del panel)
    const hE0 = hAt(-eave);
    const hE1 = hAt(width + eave);
    const roofPts: [number, number][] = [[X(-eave), Y(hE0)], [X(width + eave), Y(hE1)], [X(width + eave), Y(hE1 + roofT)], [X(-eave), Y(hE0 + roofT)]];
    fillPoly(roofPts, ROOF);
    p.line([...roofPts, roofPts[0]!], { weight: 0.4, color: FRAME });

    // Terreno
    p.line([[X(uLeft - 1), Y(0)], [X(uRight + 1), Y(0)]], { weight: 0.7 });
    for (let u = uLeft - 1; u < uRight + 1; u += 0.5) p.line([[X(u), Y(0)], [X(u - 0.3), Y(-0.3)]], { weight: 0.1 });

    // Cotas de nivel a la izquierda
    const lx = X(uLeft) - 6;
    const levels = [...new Set([0, hAt(0), hAt(width), Math.max(hE0, hE1) + roofT].map((h) => Math.round(h * 100) / 100))].sort((a, c) => a - c);
    for (const h of levels) {
      const ly = Y(h);
      p.out.push({ kind: "polygon", points: [p.w(lx, ly), p.w(lx - 1.4, ly + 2), p.w(lx + 1.4, ly + 2)], style: STYLE, fill: "solid", color: FRAME_INK, weight: 0 });
      p.line([[lx - 3, ly], [lx + 4, ly]], { weight: 0.18 });
      p.text(h === 0 ? "NPT ±0.00" : `N+${h.toFixed(2)}`, lx - 3.5, ly + 1.2, 1.8, "right");
    }
    // Cota horizontal de la fachada
    const dy = Y(0) - 7;
    p.line([[X(0), dy], [X(width), dy]], { weight: 0.18 });
    for (const u of [0, width]) {
      p.line([[X(u), dy - 1.2], [X(u), dy + 1.2]], { weight: 0.18 });
      p.line([[X(u) - 0.8, dy - 0.8], [X(u) + 0.8, dy + 0.8]], { weight: 0.35 });
    }
    p.text(`${width.toFixed(2)}`, X(width / 2), dy + 1.4, 1.8, "center");
    p.text(fc.name, X(width / 2), dy - 5, 2.6, "center", true);
    p.text(`ESCALA 1:${scale}`, X(width / 2), dy - 8.2, 1.8, "center");
  });
}

// ─── Hoja completa ───────────────────────────────────────────

const TABLES: Record<string, (r: ModelReader, levelId: Id) => Table> = {
  "cuadro-areas": (r, l) => areaTable(r, l),
  "cuadro-cargas-TG": (r) => loadScheduleTable(r, "TG"),
  "cuadro-cargas-TR": (r) => loadScheduleTable(r, "TR"),
  "cuadro-acometida": (r) => demandTable(r),
  "cuadro-iluminacion": (r, l) => lightingTable(r, l),
  "cuadro-hidraulico": (r, l) => waterTable(r, l),
  "cuadro-sanitario": (r, l) => sanitaryTable(r, l),
  "cuadro-lluvias": (r) => rainTable(r),
  "cuadro-gas": (r, l) => gasTable(r, l),
  "cuadro-solar": (r) => solarTable(r),
};

export const BLOCK_TYPES = ["convenciones", "notas", "unifilar", "fachadas", ...Object.keys(TABLES)];

export function buildSheet(reader: ModelReader, sheet: Sheet): SheetGeometry {
  const { k, toWorld } = sheetTransform(sheet);
  const paper = PAPER_MM[sheet.paper];
  const p = new Pen(toWorld, k);
  // Papel y marco: margen de 25 mm a la izquierda (encuadernación) y 10 mm en los demás lados.
  const fx = 25;
  const fy = 10;
  const fw = paper.w - 35;
  const fh = paper.h - 20;
  p.rect(0, 0, paper.w, paper.h, { fill: "white", weight: 0.1, color: "#9aa0a6" });
  p.rect(fx, fy, fw, fh, { weight: 0.7, color: FRAME_INK });
  // Columna derecha del rótulo. `rotulo_escala` agranda o reduce todo el rótulo (casillas, textos y logo).
  const F = titleFields(reader, sheet);
  const s = Math.min(1.6, Math.max(0.8, Number(F["rotulo_escala"]) || 1));
  const colW0 = 180;
  const colW = colW0 * s;
  const colX = fx + fw - colW;
  const colX0 = fx + fw - colW0;
  p.line([[colX, fy], [colX, fy + fh]], { weight: 0.5 });
  const headerH = 30;
  const tbH = 96;
  drawHeader(p.scaled(colX, fy + fh - headerH * s, s), reader, sheet, 0, 0, colW0, headerH);
  drawTitleBlock(p.scaled(colX, fy, s), reader, sheet, 0, 0, colW0, tbH);
  // Ventana de dibujo: se recorta si el rótulo crece.
  const vp0 = sheet.viewport;
  const vpRight = Math.min(vp0.x + vp0.w, colX - 5);
  const vp = { ...vp0, w: vpRight - vp0.x };
  const isPlan = sheet.disciplines.length > 0;
  const scaleText = sheet.fields["escala"] ?? (isPlan ? `1:${sheet.scale}` : "INDICADA");
  p.text(`${sheet.title.toUpperCase()}`, vp.x + 2, vp.y + 4, 3.2, "left", true);
  p.text(`ESCALA ${scaleText}${isPlan ? " · " + sheet.disciplines.map((d) => DISCIPLINE_NAMES[d]).join(" · ") : ""}`, vp.x + 2, vp.y + 0.6, 2);
  // Norte (solo en plantas)
  if (isPlan) {
    const nx = vp.x + vp.w - 14;
    const ny = vp.y + vp.h - 18;
    p.circle(nx, ny, 7, { weight: 0.3 });
    p.out.push({ kind: "polygon", points: [toWorld(nx, ny + 7), toWorld(nx + 2.6, ny - 4), toWorld(nx, ny - 2), toWorld(nx - 2.6, ny - 4)], style: STYLE, fill: "solid", color: FRAME_INK });
    p.text("N", nx, ny + 10.5, 3.2, "center", true);
  }
  // Bloques: los de la columna se reacomodan entre el rótulo y el encabezado; los del área de
  // dibujo se comprimen a lo ancho si el rótulo creció.
  const y0 = fy + tbH, y1 = fy + fh - headerH;
  const ny0 = fy + tbH * s, ny1 = fy + fh - headerH * s;
  const fv = (ny1 - ny0) / (y1 - y0);
  const fhx = (vp.x + vp.w - vp0.x) / vp0.w;
  for (const b0 of sheet.blocks) {
    const b =
      s === 1
        ? b0
        : b0.x >= colX0 - 1
          ? { ...b0, x: colX + (b0.x - colX0) * s, w: b0.w * s, y: ny0 + (b0.y - y0) * fv, h: b0.h * fv }
          : { ...b0, x: vp0.x + (b0.x - vp0.x) * fhx, w: b0.w * fhx };
    if (b.type === "convenciones") drawLegend(p, reader, sheet, b);
    else if (b.type === "notas") drawNotes(p, b);
    else if (b.type === "unifilar") drawSingleLine(p, reader, b);
    else if (b.type === "fachadas") drawElevations(p, reader, sheet, b);
    else if (TABLES[b.type]) drawTable(p, TABLES[b.type]!(reader, sheet.levelId), b.x, b.y + b.h, b.w, b.h);
  }
  const box = (x: number, y: number, w: number, h: number): AABB2 => {
    const a = toWorld(x, y);
    const c = toWorld(x + w, y + h);
    return { minX: a.x, minY: a.y, maxX: c.x, maxY: c.y };
  };
  return { primitives: p.out, paper: box(0, 0, paper.w, paper.h), viewport: box(vp.x, vp.y, vp.w, vp.h), k };
}
export { LOGO_ARKEN_DISENO, LOGO_ASPECT } from "./logo";
