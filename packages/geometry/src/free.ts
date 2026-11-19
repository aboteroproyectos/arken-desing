// Geometría de planta de los elementos libres (Paso 7): espacios, dispositivos, recorridos y anotaciones.
// Igual que muros y puertas, la geometría es DERIVADA: se recalcula siempre desde el modelo.

import {
  polygonArea,
  polygonCentroid,
  type Annotation,
  type Device,
  type Id,
  type ModelReader,
  type Run,
  type Space,
  type Vec2,
} from "@arken/core";
import { boxOf, type ElementPlanGeometry, type Paint, type PlanOptions, type PlanPrimitive, type SnapPoint } from "./plan";
import { drawSymbol } from "./symbols";

/** Estilo de trazo de cada sistema de red (grosores y trazos en mm de papel). */
export const RUN_STYLES: Readonly<Record<string, { name: string; paint: Paint }>> = {
  CIR: { name: "Canalización eléctrica PVC/EMT con conductores Cu THHN/THWN-2", paint: { weight: 0.35 } },
  ACO: { name: "Acometida / alimentador principal", paint: { weight: 0.7 } },
  BUS: { name: "Bus KNX (cable 2×2×0.8 mm apantallado)", paint: { weight: 0.3, dash: [2, 1] } },
  DAT: { name: "Cableado estructurado Cat 6A / PoE", paint: { weight: 0.25, dash: [0.6, 0.8] } },
  PRI: { name: "Suministro de agua (acometida) PVC presión", paint: { weight: 0.7, color: "#1c6dd0" } },
  AF: { name: "Agua fría: tubería multicapa PEX-AL-PEX", paint: { weight: 0.5, color: "#1c6dd0" } },
  AC: { name: "Agua caliente: tubería multicapa PEX-AL-PEX aislada", paint: { weight: 0.5, color: "#d0342c", dash: [3, 1.2] } },
  RC: { name: "Retorno de recirculación de agua caliente", paint: { weight: 0.35, color: "#d0342c", dash: [3, 0.8, 0.6, 0.8] } },
  AN: { name: "Aguas residuales: PVC sanitaria, pendiente indicada", paint: { weight: 0.7 } },
  AV: { name: "Ventilación sanitaria PVC Ø 2\"", paint: { weight: 0.35, dash: [1.5, 1] } },
  ALL: { name: "Aguas lluvias: PVC sanitaria / canal", paint: { weight: 0.6, color: "#0b8a9e", dash: [4, 1.5] } },
  CANAL: { name: "Canal de cubierta en lámina galvanizada calibre 22", paint: { weight: 0.9, color: "#0b8a9e" } },
  GAS: { name: "Red de gas: tubería PE-AL-PE (interior) / PE (enterrada)", paint: { weight: 0.5, dash: [4, 1, 1, 1] } },
  DC: { name: "Circuito DC fotovoltaico: cable PV 6 mm² en tubería EMT", paint: { weight: 0.4, dash: [2.5, 1] } },
  ACS: { name: "Circuito AC del sistema solar", paint: { weight: 0.45 } },
};

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: Vec2) => Math.hypot(v.x, v.y);

function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : d;
}
function num(v: unknown, d: number): number {
  return typeof v === "number" ? v : d;
}

/** Ángulo legible para un texto que acompaña a un segmento (nunca cabeza abajo). */
function readableAngle(a: Vec2, b: Vec2): number {
  let ang = Math.atan2(b.y - a.y, b.x - a.x);
  if (ang > Math.PI / 2 + 1e-9) ang -= Math.PI;
  if (ang <= -Math.PI / 2 - 1e-9) ang += Math.PI;
  return ang;
}

function arrowHead(tip: Vec2, from: Vec2, size: number, style: string): PlanPrimitive {
  const d = sub(tip, from);
  const l = len(d) || 1;
  const u = { x: d.x / l, y: d.y / l };
  const n = { x: -u.y, y: u.x };
  const base = { x: tip.x - u.x * size, y: tip.y - u.y * size };
  return {
    kind: "polygon",
    points: [tip, { x: base.x + n.x * size * 0.35, y: base.y + n.y * size * 0.35 }, { x: base.x - n.x * size * 0.35, y: base.y - n.y * size * 0.35 }],
    style,
    fill: "solid",
  };
}

// ─── Espacio ─────────────────────────────────────────────────

function spacePlan(s: Space, mm: number): PlanPrimitive[] {
  // `mm` aquí es el mm de TEXTO (ya multiplicado por el tamaño de texto de los planos).
  const style = "d:ARQ:espacio";
  const area = polygonArea(s.boundary);
  const lx = s.properties?.["etiqueta_x"];
  const ly = s.properties?.["etiqueta_y"];
  const at = typeof lx === "number" && typeof ly === "number" ? { x: lx, y: ly } : polygonCentroid(s.boundary);
  const prims: PlanPrimitive[] = [{ kind: "polygon", points: s.boundary, style, fill: "tint", weight: 0 }];
  prims.push({ kind: "text", at: { x: at.x, y: at.y + 2.2 * mm }, text: (s.name ?? "Espacio").toUpperCase(), height: 2.5 * mm, align: "center", bold: true, style });
  prims.push({ kind: "text", at: { x: at.x, y: at.y - 1.4 * mm }, text: `${s.number} · ${area.toFixed(2)} m²`, height: 2 * mm, align: "center", style });
  const finish = str(s.properties?.["piso"]);
  if (finish) prims.push({ kind: "text", at: { x: at.x, y: at.y - 4.4 * mm }, text: finish, height: 1.6 * mm, align: "center", style });
  return prims;
}

// ─── Dispositivo ─────────────────────────────────────────────

function devicePlan(d: Device, mm: number, tm = mm): PlanPrimitive[] {
  const style = `d:${d.discipline}`;
  const props = d.properties ?? {};
  const prims = drawSymbol(d.symbol, { position: d.position, rotation: d.rotation, mm, style, props, ...(d.tag ? { tag: d.tag } : {}) });
  // Rótulo corto junto al símbolo: el circuito (eléctrica) o la etiqueta que se indique.
  const label = str(props["rotulo_plano"]) || (d.symbol === "tablero" || d.symbol === "caja" ? "" : str(props["circuito"]));
  if (label && props["ocultar_rotulo"] !== true) {
    const ox = num(props["rotulo_dx"], 2.2) * mm + Math.max(0, tm - mm) * 0.4;
    const oy = num(props["rotulo_dy"], -2.4) * mm - Math.max(0, tm - mm) * 0.8;
    prims.push({ kind: "text", at: { x: d.position.x + ox, y: d.position.y + oy }, text: label, height: 1.6 * tm, align: "left", style });
  }
  return prims;
}

// ─── Recorrido ───────────────────────────────────────────────

function runPlan(r: Run, mm: number, tm = mm): PlanPrimitive[] {
  const style = `d:${r.discipline}`;
  const base = RUN_STYLES[r.system]?.paint ?? { weight: 0.35 };
  const prims: PlanPrimitive[] = [{ kind: "polyline", points: r.points, style, ...base }];
  const props = r.properties ?? {};
  if (props["flecha"] === true && r.points.length >= 2) {
    prims.push(arrowHead(r.points[r.points.length - 1]!, r.points[r.points.length - 2]!, 2.2 * mm, style));
  }
  if (r.tag && props["ocultar_rotulo"] !== true) {
    // El rótulo va sobre el tramo más largo, centrado y paralelo a él.
    let best = 0;
    let bi = 1;
    for (let i = 1; i < r.points.length; i++) {
      const l = len(sub(r.points[i]!, r.points[i - 1]!));
      if (l > best) (best = l), (bi = i);
    }
    const a = r.points[bi - 1]!;
    const b = r.points[bi]!;
    const t = typeof props["rotulo_t"] === "number" ? (props["rotulo_t"] as number) : 0.5;
    const mid = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const ang = readableAngle(a, b);
    const side = num(props["rotulo_lado"], 1);
    const off = 1.6 * tm * side;
    const n = { x: -Math.sin(ang), y: Math.cos(ang) };
    prims.push({ kind: "text", at: { x: mid.x + n.x * off, y: mid.y + n.y * off }, text: r.tag, height: 1.6 * tm, align: "center", rotation: ang, style, ...(base.color ? { color: base.color } : {}) });
  }
  return prims;
}

// ─── Anotación ───────────────────────────────────────────────

function annotationPlan(a: Annotation, mm: number, tm = mm): PlanPrimitive[] {
  const style = `d:${a.discipline}`;
  const props = a.properties ?? {};
  const size = (a.textSize ?? 2.5) * tm;
  const pts = a.points;
  const color = typeof props["color"] === "string" ? { color: props["color"] as string } : {};
  switch (a.style) {
    case "text": {
      const al = str(props["align"], "left");
      return [
        {
          kind: "text",
          at: pts[0]!,
          text: a.text ?? "",
          height: size,
          align: al === "center" || al === "right" ? al : "left",
          rotation: num(props["rot"], 0),
          bold: props["bold"] === true,
          style,
          ...color,
        },
      ];
    }
    case "line":
      return [{ kind: "polyline", points: pts, style, weight: num(props["weight"], 0.25), ...color }];
    case "dashed":
      return [{ kind: "polyline", points: pts, style, weight: num(props["weight"], 0.25), dash: [2.5, 1.2], ...color }];
    case "outline":
      return [{ kind: "polygon", points: pts, style, weight: num(props["weight"], 0.18), ...color }];
    case "polygon":
      return [{ kind: "polygon", points: pts, style, weight: num(props["weight"], 0.35), fill: "tint", ...color }];
    case "solid":
      return [{ kind: "polygon", points: pts, style, weight: 0.18, fill: "solid", ...color }];
    case "arrow": {
      const out: PlanPrimitive[] = [{ kind: "polyline", points: pts, style, weight: 0.3, ...color }];
      if (pts.length >= 2) out.push(arrowHead(pts[pts.length - 1]!, pts[pts.length - 2]!, 3 * mm, style));
      if (a.text && pts.length >= 2) {
        const p0 = pts[0]!;
        const p1 = pts[1]!;
        const ang = readableAngle(p0, p1);
        const mid = { x: (p0.x + p1.x) / 2 - Math.sin(ang) * 2.2 * tm, y: (p0.y + p1.y) / 2 + Math.cos(ang) * 2.2 * tm };
        out.push({ kind: "text", at: mid, text: a.text, height: size, align: "center", rotation: ang, bold: true, style, ...color });
      }
      return out;
    }
    case "axis": {
      // Eje estructural: línea de trazo y punto con burbuja en el extremo final.
      const p0 = pts[0]!;
      const p1 = pts[1] ?? p0;
      const d = sub(p1, p0);
      const l = len(d) || 1;
      const u = { x: d.x / l, y: d.y / l };
      const r = 4 * tm;
      const c = { x: p1.x + u.x * r, y: p1.y + u.y * r };
      const circle: Vec2[] = [];
      for (let i = 0; i < 32; i++) circle.push({ x: c.x + r * Math.cos((i / 32) * 2 * Math.PI), y: c.y + r * Math.sin((i / 32) * 2 * Math.PI) });
      return [
        { kind: "polyline", points: [p0, p1], style, weight: 0.18, dash: [6, 1.2, 1, 1.2] },
        { kind: "polygon", points: circle, style, weight: 0.35, fill: "white" },
        { kind: "text", at: c, text: a.text ?? "", height: 3.5 * tm, align: "center", bold: true, style },
      ];
    }
    case "dimension": {
      // Cota alineada: p0 y p1 son los puntos medidos; `offset` (m) separa la línea de cota.
      const p0 = pts[0]!;
      const p1 = pts[1] ?? p0;
      const d = sub(p1, p0);
      const l = len(d) || 1;
      const u = { x: d.x / l, y: d.y / l };
      const n = { x: -u.y, y: u.x };
      const off = num(props["offset"], 0.6);
      const q0 = { x: p0.x + n.x * off, y: p0.y + n.y * off };
      const q1 = { x: p1.x + n.x * off, y: p1.y + n.y * off };
      const ext = Math.sign(off || 1) * 1.5 * mm;
      const gap = Math.sign(off || 1) * 1 * mm;
      const tick = 1.4 * mm;
      const t = (p: Vec2): [Vec2, Vec2] => [
        { x: p.x + (u.x + n.x) * tick * 0.7, y: p.y + (u.y + n.y) * tick * 0.7 },
        { x: p.x - (u.x + n.x) * tick * 0.7, y: p.y - (u.y + n.y) * tick * 0.7 },
      ];
      const ang = readableAngle(p0, p1);
      const tn = { x: -Math.sin(ang), y: Math.cos(ang) };
      const mid = { x: (q0.x + q1.x) / 2 + tn.x * 1.6 * tm, y: (q0.y + q1.y) / 2 + tn.y * 1.6 * tm };
      return [
        { kind: "polyline", points: [{ x: p0.x + n.x * gap, y: p0.y + n.y * gap }, { x: q0.x + n.x * ext, y: q0.y + n.y * ext }], style, weight: 0.13 },
        { kind: "polyline", points: [{ x: p1.x + n.x * gap, y: p1.y + n.y * gap }, { x: q1.x + n.x * ext, y: q1.y + n.y * ext }], style, weight: 0.13 },
        { kind: "polyline", points: [{ x: q0.x - u.x * 1.2 * mm, y: q0.y - u.y * 1.2 * mm }, { x: q1.x + u.x * 1.2 * mm, y: q1.y + u.y * 1.2 * mm }], style, weight: 0.18 },
        { kind: "polyline", points: t(q0), style, weight: 0.35 },
        { kind: "polyline", points: t(q1), style, weight: 0.35 },
        { kind: "text", at: mid, text: a.text ?? l.toFixed(2), height: (a.textSize ?? 2) * tm, align: "center", rotation: ang, style },
      ];
    }
  }
}

export function buildFreeElementPlan(_reader: ModelReader, e: Space | Device | Run | Annotation, levelId: Id, opts: PlanOptions): ElementPlanGeometry | undefined {
  const mm = (opts.scale ?? 50) / 1000;
  // Tamaño de los textos de los planos (1 = normal): agranda letras y sus separaciones, no los símbolos.
  const tm = mm * (opts.textScale ?? 1);
  let primitives: PlanPrimitive[];
  let snapPoints: SnapPoint[] = [];
  let discipline = "ARQ" as ElementPlanGeometry["discipline"];
  switch (e.kind) {
    case "Space":
      primitives = spacePlan(e, tm);
      snapPoints = e.boundary.map((p) => ({ point: p, kind: "endpoint" as const }));
      break;
    case "Device":
      primitives = devicePlan(e, mm, tm);
      snapPoints = [{ point: e.position, kind: "endpoint" }];
      discipline = e.discipline;
      break;
    case "Run":
      primitives = runPlan(e, mm, tm);
      snapPoints = e.points.map((p) => ({ point: p, kind: "endpoint" as const }));
      discipline = e.discipline;
      break;
    case "Annotation":
      primitives = annotationPlan(e, mm, tm);
      snapPoints = e.style === "text" ? [] : e.points.map((p) => ({ point: p, kind: "endpoint" as const }));
      discipline = e.discipline;
      break;
  }
  if (primitives.length === 0) return undefined;
  return { elementId: e.id, kind: e.kind, discipline, levelId, primitives, box: boxOf(primitives), snapPoints };
}
