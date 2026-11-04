// Propagador de dependencias (Paso 2, §8.1).
// Amplía un conjunto de ids cambiados con todo aquello cuya GEOMETRÍA depende de ellos.
//
//   Material / LayerSet ──► muros que lo usan
//   Muro                ──► sus huecos ──► sus puertas/ventanas ; muros conectados
//   Hueco               ──► su muro y su relleno
//   Puerta / Ventana    ──► su hueco ──► su muro
//   Nivel (cota)        ──► todos sus elementos

import type { Id } from "./model";
import type { ModelReader } from "./queries";

export function expandDirtyForGeometry(reader: ModelReader, ids: Iterable<Id>): Set<Id> {
  const idx = reader.indices;
  const out = new Set<Id>();
  const queue = [...ids];
  const push = (id: Id | undefined) => {
    if (id !== undefined && !out.has(id)) queue.push(id);
  };

  while (queue.length > 0) {
    const id = queue.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    const e = reader.getEntity(id);
    if (!e) continue; // borrado: ya está en el conjunto, sin vecinos que recorrer

    switch (e.kind) {
      case "Material":
        for (const def of reader.entities()) {
          if (def.kind === "MaterialLayerSet" && def.layers.some((l) => l.materialId === id)) push(def.id);
        }
        break;
      case "MaterialLayerSet":
        idx.elementsUsingMaterialDef(id).forEach(push);
        break;
      case "Level":
        idx.elementsOfLevel(id).forEach(push);
        break;
      case "Wall":
        idx.openingsOfHost(id).forEach(push);
        idx.wallConnections(id).forEach(push);
        break;
      case "Opening":
        push(idx.hostOfOpening(id));
        idx.fillingsOfOpening(id).forEach(push);
        break;
      case "Door":
      case "Window":
        push(idx.openingOfFilling(id));
        break;
    }
  }
  return out;
}
