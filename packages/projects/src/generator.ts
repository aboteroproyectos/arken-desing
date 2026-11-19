// Generador de proyectos por especificaciones (Paso 8).
//
// Toma el diseño aprobado de la Casa Lote 01 como plantilla (arquitectura, estructura y todas las
// redes, con sus 11 planos) y lo ajusta a lo que el usuario especifica: dimensiones de la casa,
// cubierta, datos del rótulo y parámetros de diseño de las redes. La casa se estira por tramos:
// lo que está dentro de la huella se escala, lo que está afuera (parqueadero, terraza, acometidas)
// se desplaza sin deformarse, así los muebles, aparatos y símbolos conservan su tamaño real.
// Después, todos los cuadros, cálculos y memorias se recalculan solos a partir del modelo.

import { BimStore, pointInPolygon, polygonArea, type BimModel, type Entity, type Id, type PropertyValue, type Relation, type Sheet, type Vec2 } from "@arken/core";
import { circuitResults } from "@arken/calc";
import { buildLote01 } from "./lote01";

export interface HouseSpec {
  // Rótulo
  readonly proyecto: string;
  readonly localizacion: string;
  readonly propietario: string;
  readonly fecha: string;
  readonly archivo: string;
  readonly empresa: string;
  readonly diseno: string;
  readonly matricula: string;
  // Arquitectura
  /** Ancho oriente-occidente a caras exteriores (m). */
  readonly ancho: number;
  /** Largo norte-sur a caras exteriores (m). */
  readonly largo: number;
  /** Altura del lado alto de la cubierta sobre el NPT (m). */
  readonly cubiertaAlta: number;
  readonly cubiertaPendiente: number;
  readonly alero: number;
  // Redes
  readonly evLimiteA: number;
  readonly consumoKwhMes: number;
  readonly lluviaMmH: number;
  readonly solarHsp: number;
  readonly tempMinC: number;
}

export interface SpecField {
  readonly key: keyof HouseSpec;
  readonly label: string;
  readonly group: "Rótulo" | "Arquitectura" | "Redes";
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  readonly help?: string;
}

export const SPEC_FIELDS: readonly SpecField[] = [
  { key: "proyecto", label: "Nombre del proyecto", group: "Rótulo" },
  { key: "localizacion", label: "Localización", group: "Rótulo" },
  { key: "propietario", label: "Propietario", group: "Rótulo" },
  { key: "fecha", label: "Fecha", group: "Rótulo" },
  { key: "archivo", label: "Código de archivo", group: "Rótulo" },
  { key: "empresa", label: "Empresa", group: "Rótulo" },
  { key: "diseno", label: "Diseño", group: "Rótulo" },
  { key: "matricula", label: "Matrícula profesional", group: "Rótulo" },
  { key: "ancho", label: "Ancho de la casa (oriente-occidente)", group: "Arquitectura", min: 11, max: 16, step: 0.1, unit: "m", help: "A caras exteriores." },
  { key: "largo", label: "Largo de la casa (norte-sur)", group: "Arquitectura", min: 13.5, max: 20, step: 0.1, unit: "m", help: "A caras exteriores." },
  { key: "cubiertaAlta", label: "Altura del lado alto de la cubierta", group: "Arquitectura", min: 3.6, max: 5.5, step: 0.05, unit: "m" },
  { key: "cubiertaPendiente", label: "Pendiente de la cubierta", group: "Arquitectura", min: 5, max: 20, step: 0.5, unit: "%" },
  { key: "alero", label: "Alero", group: "Arquitectura", min: 0.4, max: 1.5, step: 0.05, unit: "m" },
  { key: "evLimiteA", label: "Límite de gestión de carga EV", group: "Redes", min: 16, max: 64, step: 1, unit: "A" },
  { key: "consumoKwhMes", label: "Consumo de energía estimado", group: "Redes", min: 200, max: 3000, step: 10, unit: "kWh/mes" },
  { key: "lluviaMmH", label: "Intensidad de lluvia de diseño", group: "Redes", min: 60, max: 250, step: 5, unit: "mm/h" },
  { key: "solarHsp", label: "Horas solares pico", group: "Redes", min: 2.5, max: 6.5, step: 0.1, unit: "h" },
  { key: "tempMinC", label: "Temperatura mínima del sitio", group: "Redes", min: -5, max: 20, step: 1, unit: "°C" },
];

const W0 = 12;
const L0 = 15;

export function defaultSpec(): HouseSpec {
  return {
    proyecto: "CASA NUEVA",
    localizacion: "",
    propietario: "Por definir",
    fecha: new Date().toLocaleDateString("es-CO", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase()),
    archivo: "ARK-001",
    empresa: "ARKEN 360",
    diseno: "ARKEN 360",
    matricula: "Mat. prof. por diligenciar",
    ancho: W0,
    largo: L0,
    cubiertaAlta: 4.2,
    cubiertaPendiente: 10,
    alero: 0.9,
    evLimiteA: 40,
    consumoKwhMes: 750,
    lluviaMmH: 120,
    solarHsp: 4.2,
    tempMinC: 5,
  };
}

/** Revisa la especificación; devuelve los errores en texto (vacío si está bien). */
export function checkSpec(s: HouseSpec): string[] {
  const out: string[] = [];
  for (const f of SPEC_FIELDS) {
    const v = s[f.key];
    if (typeof v === "number") {
      if (!Number.isFinite(v)) out.push(`${f.label}: valor no válido.`);
      else if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) out.push(`${f.label}: debe estar entre ${f.min} y ${f.max} ${f.unit ?? ""}.`.trim());
    }
  }
  if (!s.proyecto.trim()) out.push("El proyecto necesita un nombre.");
  return out;
}

/** Mapa por tramos: [−∞,0] fijo, [0,a0] escalado a [0,a1], [a0,∞] desplazado. */
const piece = (a0: number, a1: number) => (t: number) => (t <= 0 ? t : t >= a0 ? t + (a1 - a0) : (t * a1) / a0);

const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function generateHouse(spec: HouseSpec): BimModel {
  const errors = checkSpec(spec);
  if (errors.length) throw new Error(errors.join(" "));
  const base = buildLote01();
  const W = spec.ancho;
  const L = spec.largo;
  const fx = piece(W0, W);
  const fy = piece(L0, L);
  const map = (p: Vec2): Vec2 => ({ x: r4(fx(p.x)), y: r4(fy(p.y)) });
  const areaK = (W * L) / (W0 * L0);

  const ents: Record<Id, Entity> = {};
  const oldWalls = new Map<Id, Extract<Entity, { kind: "Wall" }>>();
  for (const e of Object.values(base.entities)) if (e.kind === "Wall") oldWalls.set(e.id, e);
  const hostOf = new Map<Id, Id>();
  for (const r of Object.values(base.relations) as Relation[]) if (r.kind === "RelVoids") hostOf.set(r.openingId, r.hostId);

  for (const e of Object.values(base.entities)) {
    switch (e.kind) {
      case "Wall":
        ents[e.id] = { ...e, start: map(e.start), end: map(e.end) };
        break;
      case "Opening": {
        const w = oldWalls.get(hostOf.get(e.id) ?? "");
        if (!w) {
          ents[e.id] = e;
          break;
        }
        const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) || 1;
        const u = { x: (w.end.x - w.start.x) / len, y: (w.end.y - w.start.y) / len };
        // El centro del vano sigue al muro; el ancho del vano no cambia.
        const mid = e.offsetAlongAxis + e.width / 2;
        const c = map({ x: w.start.x + u.x * mid, y: w.start.y + u.y * mid });
        const s = map(w.start);
        const en = map(w.end);
        const nl = Math.hypot(en.x - s.x, en.y - s.y) || 1;
        const cm = ((c.x - s.x) * (en.x - s.x) + (c.y - s.y) * (en.y - s.y)) / nl;
        ents[e.id] = { ...e, offsetAlongAxis: r4(Math.min(nl - e.width, Math.max(0, cm - e.width / 2))) };
        break;
      }
      case "Space":
        ents[e.id] = { ...e, boundary: e.boundary.map(map) };
        break;
      case "Device":
        ents[e.id] = { ...e, position: map(e.position) };
        break;
      case "Run": {
        const props = { ...(e.properties ?? {}) } as Record<string, PropertyValue>;
        if (typeof props["area_m2"] === "number") props["area_m2"] = Math.round((props["area_m2"] as number) * areaK * 10) / 10;
        ents[e.id] = { ...e, points: e.points.map(map), properties: props };
        break;
      }
      case "Annotation": {
        const numeric = e.style === "dimension" && e.text !== undefined && /^[\d.,\s]+$/.test(e.text);
        const { text: _t, ...rest } = e;
        ents[e.id] = numeric ? { ...rest, points: e.points.map(map) } : { ...e, points: e.points.map(map) };
        break;
      }
      case "Level":
        ents[e.id] = e.name === "Cubierta" ? { ...e, elevation: spec.cubiertaAlta } : e;
        break;
      case "Sheet":
        ents[e.id] = adaptSheet(e, map, spec);
        break;
      case "Project": {
        const p = { ...(e.properties ?? {}) } as Record<string, PropertyValue>;
        p["area_construida_m2"] = r4(W * L);
        p["casa_xmax"] = W;
        p["casa_ymax"] = L;
        for (const k of ["parqueadero_xmin", "parqueadero_xmax"]) if (typeof p[k] === "number") p[k] = r4(fx(p[k] as number));
        for (const k of ["parqueadero_ymin", "parqueadero_ymax"]) if (typeof p[k] === "number") p[k] = r4(fy(p[k] as number));
        for (const k of Object.keys(p))
          if (/^fachada_[NS]_madera$/.test(k) && typeof p[k] === "string") p[k] = (p[k] as string).split("-").map((x) => r4(fx(Number(x))).toFixed(2)).join("-");
          else if (/^fachada_[EO]_madera$/.test(k) && typeof p[k] === "string") p[k] = (p[k] as string).split("-").map((x) => r4(fy(Number(x))).toFixed(2)).join("-");
        p["cubierta_alta_m"] = spec.cubiertaAlta;
        p["cubierta_pendiente_pct"] = spec.cubiertaPendiente;
        p["cubierta_alero_m"] = spec.alero;
        p["ev_limite_A"] = spec.evLimiteA;
        p["consumo_kwh_mes"] = spec.consumoKwhMes;
        p["lluvia_mm_h"] = spec.lluviaMmH;
        p["solar_hsp"] = spec.solarHsp;
        p["temp_min_c"] = spec.tempMinC;
        if (typeof p["fachadas_escala"] === "number" && Math.max(W, L) > 15.5) p["fachadas_escala"] = 100;
        const tb = { ...(e.titleBlock ?? {}) };
        for (const k of ["proyecto", "localizacion", "propietario", "fecha", "archivo", "empresa", "diseno", "matricula"] as const) tb[k] = spec[k];
        ents[e.id] = { ...e, name: spec.proyecto, titleBlock: tb, properties: p };
        break;
      }
      default:
        ents[e.id] = e;
    }
  }
  resizeLighting(base, ents);
  const model: BimModel = { schemaVersion: 1, entities: ents, relations: base.relations };
  resizeConductors(model);
  return model;
}

/** Luminarias: si el recinto crece, cada luminaria sube su flujo (y su potencia) en la misma proporción. */
function resizeLighting(base: BimModel, ents: Record<Id, Entity>): void {
  const spaces = Object.values(ents).filter((e): e is Extract<Entity, { kind: "Space" }> => e.kind === "Space");
  for (const sp of spaces) {
    const old = base.entities[sp.id];
    if (!old || old.kind !== "Space") continue;
    const k = polygonArea(sp.boundary) / Math.max(polygonArea(old.boundary), 1e-6);
    if (k <= 1.0001) continue;
    for (const d of Object.values(ents)) {
      if (d.kind !== "Device" || d.discipline !== "ILU" || !pointInPolygon(d.position, sp.boundary)) continue;
      const p = { ...(d.properties ?? {}) } as Record<string, PropertyValue>;
      if (typeof p["lm"] !== "number" || p["lm"] <= 0) continue;
      p["lm"] = Math.ceil(((p["lm"] as number) * k) / 50) * 50;
      if (typeof p["w"] === "number") p["w"] = Math.round((p["w"] as number) * k * 10) / 10;
      ents[d.id] = { ...d, properties: p };
    }
  }
}

const AWG_UP: Readonly<Record<string, string>> = { "14": "12", "12": "10", "10": "8", "8": "6", "6": "4", "4": "2" };

/** Conductores: si un circuito más largo supera 3 % de caída de tensión, se sube el calibre. */
function resizeConductors(model: BimModel): void {
  const ents = model.entities as Record<Id, Entity>;
  for (let pass = 0; pass < 4; pass++) {
    const store = new BimStore(model);
    const bad = circuitResults(store).filter((r) => r.dropPct > 3 && AWG_UP[r.circuit.conductorAwg]);
    if (!bad.length) return;
    for (const r of bad) ents[r.circuit.id] = { ...r.circuit, conductorAwg: AWG_UP[r.circuit.conductorAwg]! };
  }
}

function adaptSheet(s: Sheet, map: (p: Vec2) => Vec2, spec: HouseSpec): Sheet {
  const W = spec.ancho,
    L = spec.largo;
  const fmt = (n: number) => n.toFixed(2);
  const blocks = s.blocks.map((b) => ({
    ...b,
    lines: b.lines?.map((l) => l.replace("180 m² construidos (12.00 × 15.00 m", `${(W * L).toFixed(1).replace(/\.0$/, "")} m² construidos (${fmt(W)} × ${fmt(L)} m`)),
  }));
  // A 1:50 caben ~30 m × 28 m de modelo en la ventana; si la casa crece, el plano pasa a 1:75.
  const fits = W + 13 <= (s.viewport.w * 50) / 1000 && L + 12 <= (s.viewport.h * 50) / 1000;
  const scale = s.scale === 50 && !fits ? 75 : s.scale;
  return { ...s, viewCenter: map(s.viewCenter), scale, blocks };
}
