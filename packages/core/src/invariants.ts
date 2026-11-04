// Reglas de integridad (Paso 1, §5), validadas sobre el "conjunto sucio" (Paso 2, §5.1).
// El validador solo dice sí o no: las reparaciones (borrado en cascada) las hacen los comandos.

import { BUILDING_ELEMENT_KINDS, FILLING_KINDS, TOLERANCE, relationParticipants } from "./model";
import type { Id } from "./model";
import { getOfKind, wallLength, type ModelReader } from "./queries";

export interface InvariantViolation {
  readonly rule: string;
  readonly entityIds: readonly Id[];
  readonly message: string;
}

/**
 * Amplía los ids tocados con sus vecinos directos a través de las relaciones,
 * porque un cambio en un muro puede romper una regla de su hueco, y viceversa.
 */
export function expandTouched(reader: ModelReader, touched: Iterable<Id>): Set<Id> {
  const out = new Set<Id>();
  for (const id of touched) {
    out.add(id);
    const rel = reader.getRelation(id);
    if (rel) for (const p of relationParticipants(rel)) out.add(p);
    for (const relId of reader.indices.relationsOf(id)) {
      const r = reader.getRelation(relId);
      if (r) for (const p of relationParticipants(r)) out.add(p);
    }
  }
  return out;
}

export function validate(reader: ModelReader, touched: Iterable<Id>): InvariantViolation[] {
  const v: InvariantViolation[] = [];
  const idx = reader.indices;
  const ids = expandTouched(reader, touched);

  for (const id of ids) {
    // Integridad referencial: ninguna relación puede apuntar a una entidad inexistente.
    const rel = reader.getRelation(id);
    if (rel) {
      const missing = relationParticipants(rel).filter((p) => !reader.getEntity(p));
      if (missing.length > 0) {
        v.push({
          rule: "relation-references-exist",
          entityIds: [rel.id, ...missing],
          message: `La relación ${rel.kind} apunta a elementos que no existen.`,
        });
      }
      continue;
    }

    const e = reader.getEntity(id);
    if (!e) continue;

    // 1. Todo elemento constructivo está en exactamente un nivel.
    if (BUILDING_ELEMENT_KINDS.includes(e.kind)) {
      const levels = idx.levelsOfElement(id);
      if (levels.size !== 1) {
        v.push({
          rule: "element-in-one-level",
          entityIds: [id],
          message: `El elemento debe pertenecer a exactamente un nivel (tiene ${levels.size}).`,
        });
      }
    }

    if (e.kind === "Wall") {
      if (wallLength(e) <= TOLERANCE) {
        v.push({ rule: "wall-min-length", entityIds: [id], message: "El muro no puede tener longitud cero." });
      }
      if (e.height <= TOLERANCE) {
        v.push({ rule: "wall-min-height", entityIds: [id], message: "El muro debe tener altura positiva." });
      }
      if (!getOfKind(reader, idx.materialDefOf(id), "MaterialLayerSet")) {
        v.push({
          rule: "wall-has-layer-set",
          entityIds: [id],
          message: "El muro necesita una receta de capas de material.",
        });
      }
    }

    if (e.kind === "Opening") {
      // 2. Un hueco perfora exactamente un muro.
      const hosts = idx.hostsOfOpening(id);
      if (hosts.size !== 1) {
        v.push({
          rule: "opening-one-host",
          entityIds: [id],
          message: `El hueco debe perforar exactamente un muro (perfora ${hosts.size}).`,
        });
      }
      // 3. Un hueco tiene cero o un relleno.
      if (idx.fillingsOfOpening(id).size > 1) {
        v.push({ rule: "opening-max-one-filling", entityIds: [id], message: "Un hueco solo admite un relleno." });
      }
      // 5. El hueco cabe dentro del muro.
      const wall = getOfKind(reader, idx.hostOfOpening(id), "Wall");
      if (wall) {
        const len = wallLength(wall);
        const fitsU = e.offsetAlongAxis >= -TOLERANCE && e.offsetAlongAxis + e.width <= len + TOLERANCE;
        const fitsV = e.sillHeight >= -TOLERANCE && e.sillHeight + e.height <= wall.height + TOLERANCE;
        if (!fitsU || !fitsV || e.width <= TOLERANCE || e.height <= TOLERANCE) {
          v.push({
            rule: "opening-fits-host",
            entityIds: [id, wall.id],
            message: "El hueco no cabe dentro del muro.",
          });
        }
      }
    }

    // 4. Una puerta o ventana rellena exactamente un hueco.
    if (FILLING_KINDS.includes(e.kind)) {
      const openings = idx.openingsOfFilling(id);
      if (openings.size !== 1) {
        v.push({
          rule: "filling-one-opening",
          entityIds: [id],
          message: `La puerta o ventana debe rellenar exactamente un hueco (rellena ${openings.size}).`,
        });
      }
    }
  }
  return v;
}
