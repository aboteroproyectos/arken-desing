// Comandos: el vocabulario del arquitecto (Paso 2, §3).
// Un comando NO modifica nada por sí mismo: solo emite operaciones dentro de la transacción.
// Los ids se generan al crear el comando, una sola vez, para que rehacer los conserve.

import type {
  Annotation,
  Circuit,
  Device,
  Door,
  Run,
  Sheet,
  Space,
  Entity,
  Id,
  Meters,
  Opening,
  RelAssociatesMaterial,
  RelContainedIn,
  SwingDirection,
  SwingSide,
  Vec2,
  Wall,
  WallJustification,
  Window,
} from "./model";
import { reconnectWalls } from "./connections";
import { getOfKind } from "./queries";
import { newId, type Command, type Transaction } from "./store";

// ─── Ayudantes de relaciones ────────────────────────────────

function addToLevel(tx: Transaction, levelId: Id, elementId: Id): void {
  const relId = tx.indices.containmentOfLevel(levelId);
  const rel = relId ? (tx.getRelation(relId) as RelContainedIn | undefined) : undefined;
  if (rel) {
    if (rel.elementIds.includes(elementId)) return;
    tx.apply({ type: "putRelation", relation: { ...rel, elementIds: [...rel.elementIds, elementId] } });
  } else {
    tx.apply({ type: "putRelation", relation: { id: newId(), kind: "RelContainedIn", levelId, elementIds: [elementId] } });
  }
}

function associateMaterial(tx: Transaction, materialDefId: Id, elementId: Id): void {
  const relId = tx.indices.associationOfMaterialDef(materialDefId);
  const rel = relId ? (tx.getRelation(relId) as RelAssociatesMaterial | undefined) : undefined;
  if (rel) {
    if (rel.elementIds.includes(elementId)) return;
    tx.apply({ type: "putRelation", relation: { ...rel, elementIds: [...rel.elementIds, elementId] } });
  } else {
    tx.apply({
      type: "putRelation",
      relation: { id: newId(), kind: "RelAssociatesMaterial", materialDefId, elementIds: [elementId] },
    });
  }
}

/** Quita una entidad de todas sus relaciones: borra las binarias y recorta las de lista. */
function detach(tx: Transaction, entityId: Id): void {
  for (const relId of [...tx.indices.relationsOf(entityId)]) {
    const rel = tx.getRelation(relId);
    if (!rel) continue;
    switch (rel.kind) {
      case "RelContainedIn":
      case "RelAssociatesMaterial": {
        // Si la entidad es el "dueño" de la relación (el nivel o el material), la relación desaparece.
        const owner = rel.kind === "RelContainedIn" ? rel.levelId : rel.materialDefId;
        const rest = rel.elementIds.filter((e) => e !== entityId);
        if (owner === entityId || rest.length === 0) tx.apply({ type: "deleteRelation", id: rel.id });
        else tx.apply({ type: "putRelation", relation: { ...rel, elementIds: rest } });
        break;
      }
      case "RelAggregates": {
        const rest = rel.childIds.filter((e) => e !== entityId);
        if (rel.parentId === entityId || rest.length === 0) tx.apply({ type: "deleteRelation", id: rel.id });
        else tx.apply({ type: "putRelation", relation: { ...rel, childIds: rest } });
        break;
      }
      default:
        tx.apply({ type: "deleteRelation", id: rel.id });
    }
  }
}

function must<T extends Entity>(e: T | undefined, what: string): T {
  if (!e) throw new Error(`${what} no existe.`);
  return e;
}

// ─── Muros ──────────────────────────────────────────────────

export interface CreateWallParams {
  levelId: Id;
  layerSetId: Id;
  start: Vec2;
  end: Vec2;
  height?: Meters; // por defecto, la altura del nivel
  justification?: WallJustification;
  baseOffset?: Meters;
  name?: string;
}

export function createWall(p: CreateWallParams): Command & { readonly wallId: Id } {
  const wallId = newId();
  return {
    label: "Crear muro",
    wallId,
    execute(tx) {
      const level = must(getOfKind(tx, p.levelId, "Level"), "El nivel");
      must(getOfKind(tx, p.layerSetId, "MaterialLayerSet"), "La receta de capas");
      const wall: Wall = {
        id: wallId,
        kind: "Wall",
        ...(p.name ? { name: p.name } : {}),
        start: p.start,
        end: p.end,
        justification: p.justification ?? "center",
        height: p.height ?? level.height,
        baseOffset: p.baseOffset ?? 0,
      };
      tx.apply({ type: "putEntity", entity: wall });
      addToLevel(tx, p.levelId, wallId);
      associateMaterial(tx, p.layerSetId, wallId);
      reconnectWalls(tx, [wallId]);
    },
  };
}

/**
 * Mueve uno o varios muros. Sus huecos, puertas y ventanas los acompañan solos (posición relativa).
 * Las uniones se recalculan: las que dejan de tocarse se rompen y las nuevas se crean.
 */
export function moveWalls(wallIds: readonly Id[], delta: Vec2): Command {
  return {
    label: wallIds.length === 1 ? "Mover muro" : "Mover muros",
    execute(tx) {
      for (const id of wallIds) {
        const w = must(getOfKind(tx, id, "Wall"), "El muro");
        tx.apply({
          type: "putEntity",
          entity: {
            ...w,
            start: { x: w.start.x + delta.x, y: w.start.y + delta.y },
            end: { x: w.end.x + delta.x, y: w.end.y + delta.y },
          },
        });
      }
      reconnectWalls(tx, wallIds);
    },
  };
}

// ─── Puertas y ventanas ─────────────────────────────────────

function insertFilling(
  tx: Transaction,
  wallId: Id,
  opening: Opening,
  filling: Door | Window,
): void {
  must(getOfKind(tx, wallId, "Wall"), "El muro");
  const levelId = tx.indices.levelOfElement(wallId);
  if (!levelId) throw new Error("El muro no pertenece a ningún nivel.");
  tx.apply({ type: "putEntity", entity: opening });
  tx.apply({ type: "putEntity", entity: filling });
  tx.apply({ type: "putRelation", relation: { id: newId(), kind: "RelVoids", hostId: wallId, openingId: opening.id } });
  tx.apply({
    type: "putRelation",
    relation: { id: newId(), kind: "RelFills", openingId: opening.id, fillingId: filling.id },
  });
  // El hueco no va al nivel: hereda la ubicación de su muro. La puerta sí.
  addToLevel(tx, levelId, filling.id);
}

export interface InsertDoorParams {
  wallId: Id;
  offsetAlongAxis: Meters; // desde el inicio del muro hasta la jamba izquierda del hueco
  width?: Meters; // ancho del hueco
  height?: Meters; // alto del hueco
  swingSide?: SwingSide;
  swingDirection?: SwingDirection;
}

export function insertDoor(p: InsertDoorParams): Command & { readonly doorId: Id; readonly openingId: Id } {
  const doorId = newId();
  const openingId = newId();
  const width = p.width ?? 0.9;
  const height = p.height ?? 2.1;
  return {
    label: "Insertar puerta",
    doorId,
    openingId,
    execute(tx) {
      insertFilling(
        tx,
        p.wallId,
        { id: openingId, kind: "Opening", offsetAlongAxis: p.offsetAlongAxis, sillHeight: 0, width, height },
        {
          id: doorId,
          kind: "Door",
          leafWidth: Math.max(width - 0.08, 0.1),
          leafHeight: Math.max(height - 0.07, 0.1),
          operation: "single_swing",
          swingSide: p.swingSide ?? "left",
          swingDirection: p.swingDirection ?? "inward",
        },
      );
    },
  };
}

export interface InsertWindowParams {
  wallId: Id;
  offsetAlongAxis: Meters;
  width?: Meters;
  height?: Meters;
  sillHeight?: Meters;
}

export function insertWindow(p: InsertWindowParams): Command & { readonly windowId: Id; readonly openingId: Id } {
  const windowId = newId();
  const openingId = newId();
  const width = p.width ?? 1.2;
  const height = p.height ?? 1.2;
  return {
    label: "Insertar ventana",
    windowId,
    openingId,
    execute(tx) {
      insertFilling(
        tx,
        p.wallId,
        { id: openingId, kind: "Opening", offsetAlongAxis: p.offsetAlongAxis, sillHeight: p.sillHeight ?? 0.9, width, height },
        { id: windowId, kind: "Window", frameWidth: width, frameHeight: height, operation: "casement" },
      );
    },
  };
}

// ─── Edición genérica ───────────────────────────────────────

/** Reemplaza campos de una entidad (inmutable: crea un objeto nuevo). */
export function updateEntity<E extends Entity>(id: Id, patch: Partial<Omit<E, "id" | "kind">>, label = "Modificar"): Command {
  return {
    label,
    execute(tx) {
      const e = must(tx.getEntity(id), "El elemento");
      tx.apply({ type: "putEntity", entity: { ...e, ...patch } as Entity });
    },
  };
}

// ─── Borrado ────────────────────────────────────────────────

export interface DeleteOptions {
  /** Al borrar una puerta o ventana, borrar también su hueco (por defecto se conserva, regla 6). */
  removeOpeningOfFilling?: boolean;
}

/**
 * Borra elementos con su cascada (regla 6):
 *  muro → sus huecos → sus puertas/ventanas;  hueco → su relleno.
 *  puerta/ventana → solo ella (su hueco se queda, salvo removeOpeningOfFilling).
 */
export function deleteElements(ids: readonly Id[], opts: DeleteOptions = {}): Command {
  return {
    label: ids.length === 1 ? "Borrar elemento" : `Borrar ${ids.length} elementos`,
    execute(tx) {
      const doomed = new Set<Id>();
      const visit = (id: Id) => {
        if (doomed.has(id) || !tx.getEntity(id)) return;
        doomed.add(id);
        const e = tx.getEntity(id)!;
        if (e.kind === "Wall") for (const o of tx.indices.openingsOfHost(id)) visit(o);
        if (e.kind === "Opening") for (const f of tx.indices.fillingsOfOpening(id)) visit(f);
        if ((e.kind === "Door" || e.kind === "Window") && opts.removeOpeningOfFilling) {
          const o = tx.indices.openingOfFilling(id);
          if (o) visit(o);
        }
      };
      ids.forEach(visit);
      for (const id of doomed) detach(tx, id);
      for (const id of doomed) tx.apply({ type: "deleteEntity", id });
    },
  };
}

// ─── Espacios, redes y anotaciones (Paso 7) ─────────────────

/** Crea cualquier elemento libre (espacio, dispositivo, recorrido, anotación) en un nivel. */
export function createLevelElement<E extends Space | Device | Run | Annotation>(
  levelId: Id,
  element: Omit<E, "id"> & { id?: Id },
  label?: string,
): Command & { readonly elementId: Id } {
  const elementId = element.id ?? newId();
  return {
    label: label ?? labelFor(element.kind),
    elementId,
    execute(tx) {
      must(getOfKind(tx, levelId, "Level"), "El nivel");
      tx.apply({ type: "putEntity", entity: { ...element, id: elementId } as unknown as Entity });
      addToLevel(tx, levelId, elementId);
    },
  };
}

function labelFor(kind: string): string {
  return { Space: "Crear espacio", Device: "Insertar dispositivo", Run: "Trazar recorrido", Annotation: "Anotar" }[kind] ?? "Crear";
}

/** Crea una entidad sin nivel (circuito, hoja). */
export function createEntity<E extends Circuit | Sheet>(element: Omit<E, "id"> & { id?: Id }, label = "Crear"): Command & { readonly elementId: Id } {
  const elementId = element.id ?? newId();
  return {
    label,
    elementId,
    execute(tx) {
      tx.apply({ type: "putEntity", entity: { ...element, id: elementId } as unknown as Entity });
    },
  };
}

const shift = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

/**
 * Mueve cualquier selección: muros (con sus uniones), dispositivos, recorridos, espacios y anotaciones.
 * Las puertas y ventanas no se mueven solas: acompañan a su muro.
 */
export function moveElements(ids: readonly Id[], delta: Vec2): Command {
  return {
    label: ids.length === 1 ? "Mover" : `Mover ${ids.length} elementos`,
    execute(tx) {
      const walls: Id[] = [];
      for (const id of ids) {
        const e = tx.getEntity(id);
        if (!e) continue;
        switch (e.kind) {
          case "Wall":
            walls.push(id);
            tx.apply({ type: "putEntity", entity: { ...e, start: shift(e.start, delta), end: shift(e.end, delta) } });
            break;
          case "Device":
            tx.apply({ type: "putEntity", entity: { ...e, position: shift(e.position, delta) } });
            break;
          case "Run":
          case "Annotation":
            tx.apply({ type: "putEntity", entity: { ...e, points: e.points.map((p) => shift(p, delta)) } as Entity });
            break;
          case "Space":
            tx.apply({ type: "putEntity", entity: { ...e, boundary: e.boundary.map((p) => shift(p, delta)) } });
            break;
        }
      }
      if (walls.length > 0) reconnectWalls(tx, walls);
    },
  };
}

/** Carga varias entidades de una vez (importar un proyecto, pegar). */
export function putEntities(entities: readonly Entity[], label = "Importar"): Command {
  return {
    label,
    execute(tx) {
      for (const e of entities) tx.apply({ type: "putEntity", entity: e });
    },
  };
}
