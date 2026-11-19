// Revisión de calidad del diseño generado.
// Son reglas de oficio de arquitectura residencial de alto nivel (áreas y proporciones mínimas,
// luz y ventilación naturales, circulaciones, escaleras, baños, clósets, implantación en el lote)
// más las verificaciones de cálculo del modelo. El resultado es un puntaje de 0 a 100 con cada
// criterio explicado. No reemplaza la revisión y firma de un arquitecto con matrícula.

import { BimStore, type Device } from "@arken/core";
import { reportChapters } from "@arken/calc";
import type { DesignResult, Room } from "./build";
import { stairGeometry, TREAD } from "./layout";
import type { RoomType } from "./finishes";

export type ReviewLevel = "ok" | "aviso" | "falla";

export interface ReviewItem {
  readonly area: string;
  readonly item: string;
  readonly level: ReviewLevel;
  readonly detail: string;
}

export interface Review {
  readonly score: number;
  readonly grade: string;
  readonly items: readonly ReviewItem[];
  readonly summary: string;
}

/** Área mínima (m²), lado mínimo (m) y relación ventana/piso exigida a cada tipo de espacio en vivienda de lujo. */
const RULES: Partial<Record<RoomType, { area: number; side: number; light?: number; label: string }>> = {
  principal: { area: 16, side: 3.6, light: 1 / 6, label: "Habitación principal" },
  alcoba: { area: 10.5, side: 3.0, light: 1 / 6, label: "Habitación" },
  social: { area: 14, side: 3.4, light: 1 / 6, label: "Zona social" },
  cocina: { area: 10, side: 2.8, light: 1 / 8, label: "Cocina" },
  estudio: { area: 8, side: 2.6, light: 1 / 6, label: "Estudio" },
  bano: { area: 3.6, side: 1.5, label: "Baño" },
  "bano-social": { area: 2.0, side: 1.1, label: "Baño social" },
  vestier: { area: 4, side: 1.6, label: "Vestier" },
  servicio: { area: 6, side: 2.2, light: 1 / 8, label: "Habitación de servicio" },
};

export function reviewDesign(r: DesignResult): Review {
  const items: ReviewItem[] = [];
  const add = (area: string, item: string, level: ReviewLevel, detail: string) => items.push({ area, item, level, detail });
  const { program: p, layout: lay, rooms } = r;
  const store = new BimStore(r.model);
  const devices = [...store.entities()].filter((e): e is Device => e.kind === "Device");

  // 1. Áreas, proporciones y luz natural por espacio.
  for (const rm of rooms) {
    const rule = /comedor/i.test(rm.name) ? { area: 11, side: 3.0, light: 1 / 8, label: "Comedor" } : RULES[rm.type];
    if (!rule) continue;
    const w = rm.x1 - rm.x0,
      d = rm.y1 - rm.y0;
    const a = w * d;
    const side = Math.min(w, d);
    const name = `${rm.number} ${rm.name}`;
    if (a + 0.05 < rule.area || side + 0.02 < rule.side) add("Espacios", name, a + 0.05 < rule.area * 0.85 ? "falla" : "aviso", `${a.toFixed(1)} m², lado menor ${side.toFixed(2)} m (criterio: ${rule.area} m² y ${rule.side.toFixed(2)} m).`);
    else add("Espacios", name, "ok", `${a.toFixed(1)} m², ${w.toFixed(2)} × ${d.toFixed(2)} m.`);
    const ratio = Math.max(w, d) / Math.max(side, 0.01);
    if (ratio > 2.6 && rm.type !== "vestier" && rm.type !== "bano") add("Espacios", `${name}: proporción`, "aviso", `Relación largo/ancho ${ratio.toFixed(1)}: espacio alargado, revisar amoblamiento.`);
    if (rule.light) {
      const lr = rm.windowArea / a;
      if (lr + 1e-6 < rule.light) add("Luz y ventilación", name, lr < rule.light * 0.6 ? "falla" : "aviso", `Ventanas ${rm.windowArea.toFixed(2)} m² = 1/${(1 / Math.max(lr, 1e-3)).toFixed(1)} del piso (criterio 1/${Math.round(1 / rule.light)}).`);
      else add("Luz y ventilación", name, "ok", `Ventanas ${rm.windowArea.toFixed(2)} m² = 1/${(1 / lr).toFixed(1)} del piso${rm.facades.length > 1 ? `, ventilación cruzada (${rm.facades.join(" y ")})` : ""}.`);
    }
    if ((rm.type === "bano" || rm.type === "bano-social") && rm.windowArea <= 0) add("Luz y ventilación", name, "aviso", "Sin ventana: requiere extracción mecánica a cubierta (incluida en las notas).");
  }

  // 2. Circulaciones y escalera.
  const hall = Math.round((lay.xb - lay.xa - 0.12) * 100) / 100;
  add("Circulación", "Ancho del hall", hall >= 1.2 ? "ok" : hall >= 1.0 ? "aviso" : "falla", `${hall.toFixed(2)} m libres (criterio de lujo ≥ 1.20 m, mínimo 1.00 m).`);
  if (p.pisos > 1) {
    const g = stairGeometry(lay.dims.floorH, lay.dims.flight);
    const blondel = 2 * g.riser + TREAD;
    add("Circulación", "Escalera: regla de Blondel", blondel >= 0.6 && blondel <= 0.65 ? "ok" : "falla", `2CH + H = ${(blondel * 100).toFixed(1)} cm (rango cómodo 60 a 65 cm).`);
    add("Circulación", "Escalera: contrahuella", g.riser <= 0.18 ? "ok" : "falla", `${(g.riser * 100).toFixed(1)} cm (máximo 18 cm).`);
    add("Circulación", "Escalera: ancho", lay.dims.flight >= 1.1 ? "ok" : lay.dims.flight >= 0.9 ? "aviso" : "falla", `${lay.dims.flight.toFixed(2)} m (criterio de lujo ≥ 1.10 m).`);
    if (p.pisos >= 3) add("Circulación", "Ascensor", "aviso", `Casa de ${p.pisos} pisos: se recomienda dejar el foso y el vacío para un ascensor residencial.`);
  }

  // 3. Programa: baños por piso, clósets, área.
  for (let f = 1; f <= p.pisos; f++) {
    const beds = rooms.filter((x) => x.floor === f && (x.type === "alcoba" || x.type === "principal"));
    const baths = rooms.filter((x) => x.floor === f && (x.type === "bano" || x.type === "bano-social"));
    if (beds.length && !baths.length) add("Programa", `Piso ${f}: baños`, "falla", `${beds.length} habitaciones sin baño en el mismo piso.`);
    else if (beds.length) add("Programa", `Piso ${f}: baños`, "ok", `${baths.length} baños para ${beds.length} habitaciones.`);
    const social = rooms.filter((x) => x.floor === f && x.type === "social");
    if (social.length && !baths.length && f === 1) add("Programa", "Baño social", "aviso", "La zona social no tiene baño en el mismo piso.");
  }
  for (const rm of rooms.filter((x) => x.type === "alcoba" || x.type === "principal")) {
    const hasCloset = devices.some((d) => d.properties?.["tipo"] === "closet" && store.indices.levelOfElement(d.id) === rm.level && inside(rm, d));
    const hasVestier = rm.type === "principal" && rooms.some((x) => x.type === "vestier" && x.floor === rm.floor);
    add("Programa", `${rm.number} ${rm.name}: clóset`, hasCloset || hasVestier ? "ok" : "aviso", hasVestier ? "Vestier propio." : hasCloset ? "Clóset en madera (ver C-03)." : "Sin clóset: el espacio no alcanza; revisar.");
  }
  const built = lay.W * lay.L * p.pisos;
  if (p.areaObjetivo > 0) {
    const dev = (built - p.areaObjetivo) / p.areaObjetivo;
    add("Programa", "Área construida", Math.abs(dev) <= 0.1 ? "ok" : "aviso", `${built.toFixed(0)} m² frente a ${p.areaObjetivo.toFixed(0)} m² pedidos (${dev >= 0 ? "+" : ""}${(dev * 100).toFixed(0)} %).`);
  } else add("Programa", "Área construida", "ok", `${built.toFixed(0)} m² en ${p.pisos} ${p.pisos === 1 ? "piso" : "pisos"}.`);

  // 4. Implantación en el lote (retiros de referencia: 3 m al frente, 1.5 m laterales, 3 m al fondo).
  if (p.loteFrente > 0 && p.loteFondo > 0) {
    const carport = p.parqueaderos > 0 ? Math.min(p.parqueaderos, 2) * 3.1 : 0;
    const needW = lay.W + carport + 3;
    const needL = lay.L + (p.terraza ? 3.6 : 0) + 6;
    const fits = needW <= p.loteFrente + 1e-6 && needL <= p.loteFondo + 1e-6;
    add("Lote", "Implantación", fits ? "ok" : "falla", `La casa con parqueadero y retiros necesita ${needW.toFixed(1)} × ${needL.toFixed(1)} m; el lote es de ${p.loteFrente} × ${p.loteFondo} m.${fits ? "" : " Aumente pisos o reduzca el programa."}`);
  } else add("Lote", "Implantación", "aviso", "Sin medidas del lote: verifique retiros y norma urbana antes de implantar.");

  // 5. Estructura.
  add("Estructura", "Predimensionamiento", p.pisos > 3 ? "aviso" : "ok", p.pisos > 3 ? "Más de 3 pisos: requiere diseño estructural detallado (NSR-10) antes de fijar ejes y columnas." : "Ejes y columnas de predimensionamiento; diseño estructural NSR-10 por ingeniero.");

  // 6. Cálculos del modelo (eléctricas, iluminación, etc.).
  const checks = reportChapters(store).flatMap((c) => (c.checks ?? []).map((k) => ({ ...k, chapter: c.title })));
  const bad = checks.filter((k) => !k.ok);
  add("Cálculos", "Verificaciones de cálculo", bad.length ? "falla" : "ok", bad.length ? `${bad.length} de ${checks.length} no cumplen: ${bad.slice(0, 3).map((k) => k.item).join(", ")}.` : `${checks.length} verificaciones cumplen (circuitos, caída de tensión, iluminancias).`);

  const fails = items.filter((i) => i.level === "falla").length;
  const warns = items.filter((i) => i.level === "aviso").length;
  const score = Math.max(0, Math.round(100 - fails * 8 - warns * 2));
  const grade = score >= 95 ? "Excelente" : score >= 85 ? "Muy bueno" : score >= 70 ? "Bueno" : "Requiere ajustes";
  const summary = `${grade} (${score}/100): ${items.length - fails - warns} criterios cumplen, ${warns} avisos y ${fails} fallas.`;
  return { score, grade, items, summary };
}

function inside(rm: Room, d: Device): boolean {
  const { x, y } = d.position;
  return x >= rm.x0 - 0.15 && x <= rm.x1 + 0.15 && y >= rm.y0 - 0.15 && y <= rm.y1 + 0.15;
}
