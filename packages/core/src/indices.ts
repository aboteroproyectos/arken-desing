// Índices inversos (Paso 2, §7).
// Son derivados: se construyen solo a partir de las relaciones y nunca se guardan.
// Solo el BimStore los escribe; el resto del programa los lee.

import type { Id, Relation } from "./model";
import { relationParticipants } from "./model";

const EMPTY: ReadonlySet<Id> = new Set();

class MultiMap {
  private readonly map = new Map<Id, Set<Id>>();
  add(key: Id, value: Id): void {
    let set = this.map.get(key);
    if (!set) this.map.set(key, (set = new Set()));
    set.add(value);
  }
  delete(key: Id, value: Id): void {
    const set = this.map.get(key);
    if (!set) return;
    set.delete(value);
    if (set.size === 0) this.map.delete(key);
  }
  get(key: Id): ReadonlySet<Id> {
    return this.map.get(key) ?? EMPTY;
  }
  first(key: Id): Id | undefined {
    const set = this.map.get(key);
    if (!set) return undefined;
    for (const v of set) return v;
    return undefined;
  }
  /** Forma canónica para comparar índices en los tests. */
  toSorted(): [Id, Id[]][] {
    return [...this.map.entries()]
      .map(([k, v]) => [k, [...v].sort()] as [Id, Id[]])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
}

export interface Indices {
  openingsOfHost(hostId: Id): ReadonlySet<Id>;
  hostsOfOpening(openingId: Id): ReadonlySet<Id>;
  hostOfOpening(openingId: Id): Id | undefined;
  fillingsOfOpening(openingId: Id): ReadonlySet<Id>;
  fillingOfOpening(openingId: Id): Id | undefined;
  openingsOfFilling(fillingId: Id): ReadonlySet<Id>;
  openingOfFilling(fillingId: Id): Id | undefined;
  elementsOfLevel(levelId: Id): ReadonlySet<Id>;
  levelsOfElement(elementId: Id): ReadonlySet<Id>;
  levelOfElement(elementId: Id): Id | undefined;
  /** Relación RelContainedIn de un nivel (una por nivel). */
  containmentOfLevel(levelId: Id): Id | undefined;
  elementsUsingMaterialDef(materialDefId: Id): ReadonlySet<Id>;
  materialDefOf(elementId: Id): Id | undefined;
  /** Relación RelAssociatesMaterial de una definición de material. */
  associationOfMaterialDef(materialDefId: Id): Id | undefined;
  wallConnections(wallId: Id): ReadonlySet<Id>;
  childrenOf(parentId: Id): ReadonlySet<Id>;
  /** Todas las relaciones en las que participa una entidad. */
  relationsOf(entityId: Id): ReadonlySet<Id>;
}

export class MutableIndices implements Indices {
  private readonly openingsByHost = new MultiMap();
  private readonly hostsByOpening = new MultiMap();
  private readonly fillingsByOpening = new MultiMap();
  private readonly openingsByFilling = new MultiMap();
  private readonly elementsByLevel = new MultiMap();
  private readonly levelsByElement = new MultiMap();
  private readonly containmentByLevel = new MultiMap();
  private readonly elementsByMaterialDef = new MultiMap();
  private readonly materialDefsByElement = new MultiMap();
  private readonly associationByMaterialDef = new MultiMap();
  private readonly connectionsByWall = new MultiMap();
  private readonly childrenByParent = new MultiMap();
  private readonly relationsByEntity = new MultiMap();

  add(rel: Relation): void {
    this.index(rel, true);
  }
  remove(rel: Relation): void {
    this.index(rel, false);
  }

  private index(rel: Relation, adding: boolean): void {
    const op = (m: MultiMap, k: Id, v: Id) => (adding ? m.add(k, v) : m.delete(k, v));
    for (const p of relationParticipants(rel)) op(this.relationsByEntity, p, rel.id);
    switch (rel.kind) {
      case "RelVoids":
        op(this.openingsByHost, rel.hostId, rel.openingId);
        op(this.hostsByOpening, rel.openingId, rel.hostId);
        break;
      case "RelFills":
        op(this.fillingsByOpening, rel.openingId, rel.fillingId);
        op(this.openingsByFilling, rel.fillingId, rel.openingId);
        break;
      case "RelContainedIn":
        op(this.containmentByLevel, rel.levelId, rel.id);
        for (const e of rel.elementIds) {
          op(this.elementsByLevel, rel.levelId, e);
          op(this.levelsByElement, e, rel.levelId);
        }
        break;
      case "RelAssociatesMaterial":
        op(this.associationByMaterialDef, rel.materialDefId, rel.id);
        for (const e of rel.elementIds) {
          op(this.elementsByMaterialDef, rel.materialDefId, e);
          op(this.materialDefsByElement, e, rel.materialDefId);
        }
        break;
      case "RelConnectsWalls":
        op(this.connectionsByWall, rel.wallA, rel.wallB);
        op(this.connectionsByWall, rel.wallB, rel.wallA);
        break;
      case "RelAggregates":
        for (const c of rel.childIds) op(this.childrenByParent, rel.parentId, c);
        break;
    }
  }

  openingsOfHost = (id: Id) => this.openingsByHost.get(id);
  hostsOfOpening = (id: Id) => this.hostsByOpening.get(id);
  hostOfOpening = (id: Id) => this.hostsByOpening.first(id);
  fillingsOfOpening = (id: Id) => this.fillingsByOpening.get(id);
  fillingOfOpening = (id: Id) => this.fillingsByOpening.first(id);
  openingsOfFilling = (id: Id) => this.openingsByFilling.get(id);
  openingOfFilling = (id: Id) => this.openingsByFilling.first(id);
  elementsOfLevel = (id: Id) => this.elementsByLevel.get(id);
  levelsOfElement = (id: Id) => this.levelsByElement.get(id);
  levelOfElement = (id: Id) => this.levelsByElement.first(id);
  containmentOfLevel = (id: Id) => this.containmentByLevel.first(id);
  elementsUsingMaterialDef = (id: Id) => this.elementsByMaterialDef.get(id);
  materialDefOf = (id: Id) => this.materialDefsByElement.first(id);
  associationOfMaterialDef = (id: Id) => this.associationByMaterialDef.first(id);
  wallConnections = (id: Id) => this.connectionsByWall.get(id);
  childrenOf = (id: Id) => this.childrenByParent.get(id);
  relationsOf = (id: Id) => this.relationsByEntity.get(id);

  /** Volcado canónico de todos los índices ("prueba de oro" de los tests). */
  dump(): Record<string, [Id, Id[]][]> {
    return {
      openingsByHost: this.openingsByHost.toSorted(),
      hostsByOpening: this.hostsByOpening.toSorted(),
      fillingsByOpening: this.fillingsByOpening.toSorted(),
      openingsByFilling: this.openingsByFilling.toSorted(),
      elementsByLevel: this.elementsByLevel.toSorted(),
      levelsByElement: this.levelsByElement.toSorted(),
      containmentByLevel: this.containmentByLevel.toSorted(),
      elementsByMaterialDef: this.elementsByMaterialDef.toSorted(),
      materialDefsByElement: this.materialDefsByElement.toSorted(),
      associationByMaterialDef: this.associationByMaterialDef.toSorted(),
      connectionsByWall: this.connectionsByWall.toSorted(),
      childrenByParent: this.childrenByParent.toSorted(),
      relationsByEntity: this.relationsByEntity.toSorted(),
    };
  }

  static fromRelations(relations: Iterable<Relation>): MutableIndices {
    const idx = new MutableIndices();
    for (const r of relations) idx.add(r);
    return idx;
  }
}
