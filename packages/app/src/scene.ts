// Qué se ve en la vista activa: el modelo completo de un nivel o un plano (hoja) con sus disciplinas.

import { getOfKind, type Discipline, type Id, type ModelReader, type Sheet } from "@arken/core";
import type { ElementPlanGeometry } from "@arken/geometry";

export type ViewMode = { readonly kind: "model"; readonly levelId: Id; readonly disciplines: ReadonlySet<Discipline> } | { readonly kind: "sheet"; readonly sheetId: Id };

export interface Visible {
  readonly geom: ElementPlanGeometry;
  readonly background: boolean;
}

const ORDER: Record<ElementPlanGeometry["kind"], number> = { Space: 0, Wall: 1, Door: 2, Window: 2, Run: 4, Annotation: 5, Device: 6 };

/** En el fondo de un plano de redes solo se ven la arquitectura básica, el mobiliario y la estructura. */
function backgroundOk(reader: ModelReader, g: ElementPlanGeometry): boolean {
  if (g.kind === "Wall" || g.kind === "Door" || g.kind === "Window" || g.kind === "Space") return true;
  if (g.discipline === "EST") return true;
  if (g.kind === "Device" && g.discipline === "ARQ") return true;
  if (g.kind === "Annotation" && g.discipline === "ARQ") {
    const a = getOfKind(reader, g.elementId, "Annotation");
    return a?.style === "outline" || a?.style === "dashed";
  }
  return false;
}

export function levelOfView(reader: ModelReader, mode: ViewMode): Id {
  if (mode.kind === "model") return mode.levelId;
  return getOfKind(reader, mode.sheetId, "Sheet")?.levelId ?? "";
}

export function sheetOf(reader: ModelReader, mode: ViewMode): Sheet | undefined {
  return mode.kind === "sheet" ? getOfKind(reader, mode.sheetId, "Sheet") : undefined;
}

export function visibleGeoms(reader: ModelReader, all: Iterable<ElementPlanGeometry>, mode: ViewMode): Visible[] {
  const levelId = levelOfView(reader, mode);
  const sheet = sheetOf(reader, mode);
  const active = new Set<string>(sheet ? sheet.disciplines : mode.kind === "model" ? mode.disciplines : []);
  const back = new Set<string>(sheet ? sheet.background : []);
  const out: Visible[] = [];
  for (const g of all) {
    if (g.levelId !== levelId) continue;
    if (active.has(g.discipline)) out.push({ geom: g, background: false });
    else if ((back.has(g.discipline) || (back.size > 0 && g.discipline === "ARQ")) && backgroundOk(reader, g)) out.push({ geom: g, background: true });
    else if (sheet && (g.kind === "Wall" || g.kind === "Door" || g.kind === "Window") && back.size > 0) out.push({ geom: g, background: true });
  }
  out.sort((a, b) => Number(b.background) - Number(a.background) || ORDER[a.geom.kind] - ORDER[b.geom.kind]);
  return out;
}

/** Filtro para seleccionar: solo lo que se ve y no está de fondo. */
export function editableFilter(reader: ModelReader, mode: ViewMode): (g: ElementPlanGeometry) => boolean {
  const sheet = sheetOf(reader, mode);
  const active = new Set<string>(sheet ? sheet.disciplines : mode.kind === "model" ? mode.disciplines : []);
  return (g) => active.has(g.discipline);
}
