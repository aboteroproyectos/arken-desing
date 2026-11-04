// Caché de geometría de planta con invalidación incremental (Paso 3, §9).
// Solo recalcula lo que el propagador de dependencias marca como sucio.

import { expandDirtyForGeometry, type ChangeEvent, type Id, type ModelReader } from "@arken/core";
import { DEFAULT_PLAN_OPTIONS, buildElementPlan, type ElementPlanGeometry, type PlanOptions } from "./plan";

export interface GeometryUpdate {
  readonly updated: readonly ElementPlanGeometry[];
  readonly removed: readonly Id[];
}

export class PlanGeometryEngine {
  private readonly cache = new Map<Id, ElementPlanGeometry>();

  constructor(public options: PlanOptions = DEFAULT_PLAN_OPTIONS) {}

  get(id: Id): ElementPlanGeometry | undefined {
    return this.cache.get(id);
  }

  all(): IterableIterator<ElementPlanGeometry> {
    return this.cache.values();
  }

  /** Recalcula todo desde cero (al abrir un proyecto o cambiar el plano de corte). */
  rebuildAll(reader: ModelReader): GeometryUpdate {
    const removed = [...this.cache.keys()];
    this.cache.clear();
    const updated: ElementPlanGeometry[] = [];
    for (const e of reader.entities()) {
      const g = buildElementPlan(reader, e.id, this.options);
      if (g) {
        this.cache.set(e.id, g);
        updated.push(g);
      }
    }
    return { updated, removed: removed.filter((id) => !this.cache.has(id)) };
  }

  /** Recalcula solo los ids sucios (ya ampliados con sus dependencias). */
  update(reader: ModelReader, dirty: Iterable<Id>): GeometryUpdate {
    const updated: ElementPlanGeometry[] = [];
    const removed: Id[] = [];
    for (const id of dirty) {
      const g = buildElementPlan(reader, id, this.options);
      if (g) {
        this.cache.set(id, g);
        updated.push(g);
      } else if (this.cache.delete(id)) {
        removed.push(id);
      }
    }
    return { updated, removed };
  }

  /** Atajo: aplica un ChangeEvent del BimStore. */
  applyChange(reader: ModelReader, e: ChangeEvent): GeometryUpdate {
    if (e.reset) return this.rebuildAll(reader);
    const touched = [...e.added, ...e.modified, ...e.removed];
    return this.update(reader, expandDirtyForGeometry(reader, touched));
  }
}
