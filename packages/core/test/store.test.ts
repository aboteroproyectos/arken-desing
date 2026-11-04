import { describe, expect, it } from "vitest";
import {
  BimStore,
  createStarterModel,
  createWall,
  deleteElements,
  expandDirtyForGeometry,
  insertDoor,
  insertWindow,
  moveWalls,
  updateEntity,
  wallThickness,
  type ChangeEvent,
  type MaterialLayerSet,
  type Wall,
} from "../src";

function setup() {
  const { model, ids } = createStarterModel();
  const store = new BimStore(model);
  const events: ChangeEvent[] = [];
  store.subscribe((e) => events.push(e));
  const wall = (x1: number, y1: number, x2: number, y2: number) => {
    const cmd = createWall({ levelId: ids.levelId, layerSetId: ids.layerSets.tabique15, start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });
    const r = store.run(cmd);
    expect(r.ok).toBe(true);
    return cmd.wallId;
  };
  return { store, ids, events, wall };
}

describe("BimStore: crear muro e insertar puerta", () => {
  it("crea el muro en el nivel con su receta, y el espesor se deriva de las capas", () => {
    const { store, ids, wall } = setup();
    const w = wall(0, 0, 5, 0);
    expect(store.indices.levelOfElement(w)).toBe(ids.levelId);
    expect(store.indices.materialDefOf(w)).toBe(ids.layerSets.tabique15);
    expect(wallThickness(store, w)).toBeCloseTo(0.15);
    expect(store.debugIndicesMatchRebuild()).toBe(true);
  });

  it("inserta puerta: hueco perfora muro, puerta rellena hueco, puerta en el nivel, hueco no", () => {
    const { store, ids, events, wall } = setup();
    const w = wall(0, 0, 5, 0);
    events.length = 0;
    const cmd = insertDoor({ wallId: w, offsetAlongAxis: 1 });
    expect(store.run(cmd).ok).toBe(true);

    expect([...store.indices.openingsOfHost(w)]).toEqual([cmd.openingId]);
    expect(store.indices.fillingOfOpening(cmd.openingId)).toBe(cmd.doorId);
    expect(store.indices.levelOfElement(cmd.doorId)).toBe(ids.levelId);
    expect(store.indices.levelOfElement(cmd.openingId)).toBeUndefined();

    // Un solo evento por commit, con lo creado y lo afectado por las relaciones.
    expect(events).toHaveLength(1);
    expect(new Set(events[0]!.added)).toEqual(new Set([cmd.openingId, cmd.doorId]));
    expect(events[0]!.modified).toEqual(expect.arrayContaining([w, ids.levelId]));
    expect(store.debugIndicesMatchRebuild()).toBe(true);
  });

  it("rechaza una puerta que no cabe y deja el modelo intacto", () => {
    const { store, events, wall } = setup();
    const w = wall(0, 0, 0.6, 0);
    const before = JSON.stringify(store.snapshot());
    events.length = 0;
    const r = store.run(insertDoor({ wallId: w, offsetAlongAxis: 0, width: 0.9 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.map((v) => v.rule)).toContain("opening-fits-host");
    expect(JSON.stringify(store.snapshot())).toBe(before);
    expect(events).toHaveLength(0);
    expect(store.canUndo).toBe(true); // solo el muro
    expect(store.undoLabel).toBe("Crear muro");
  });

  it("rechaza acortar un muro si su ventana deja de caber", () => {
    const { store, wall } = setup();
    const w = wall(0, 0, 5, 0);
    store.run(insertWindow({ wallId: w, offsetAlongAxis: 3, width: 1.2 }));
    const r = store.run(updateEntity<Wall>(w, { end: { x: 3.5, y: 0 } }));
    expect(r.ok).toBe(false);
    expect((store.getEntity(w) as Wall).end.x).toBe(5);
  });

  it("un comando que lanza un error se revierte entero", () => {
    const { store, ids } = setup();
    const before = JSON.stringify(store.snapshot());
    const r = store.run({
      label: "Roto",
      execute(tx) {
        tx.apply({ type: "putEntity", entity: { id: "x", kind: "Building" } });
        throw new Error("fallo a mitad");
      },
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(store.snapshot())).toBe(before);
    expect(store.getEntity("x")).toBeUndefined();
    void ids;
  });
});

describe("BimStore: deshacer y rehacer", () => {
  it("deshace y rehace conservando los mismos ids", () => {
    const { store, wall } = setup();
    const w = wall(0, 0, 5, 0);
    const cmd = insertDoor({ wallId: w, offsetAlongAxis: 1 });
    store.run(cmd);
    const withDoor = JSON.stringify(store.snapshot());

    store.undo();
    expect(store.getEntity(cmd.doorId)).toBeUndefined();
    expect(store.indices.openingsOfHost(w).size).toBe(0);
    expect(store.debugIndicesMatchRebuild()).toBe(true);

    store.redo();
    expect(store.getEntity(cmd.doorId)).toBeDefined();
    expect(JSON.stringify(store.snapshot())).toBe(withDoor);
    expect(store.debugIndicesMatchRebuild()).toBe(true);
  });

  it("un commit nuevo vacía la pila de rehacer", () => {
    const { store, wall } = setup();
    wall(0, 0, 5, 0);
    store.undo();
    expect(store.canRedo).toBe(true);
    wall(0, 0, 3, 0);
    expect(store.canRedo).toBe(false);
  });
});

describe("BimStore: borrado en cascada", () => {
  it("borrar un muro borra sus huecos y sus rellenos", () => {
    const { store, ids, wall } = setup();
    const w = wall(0, 0, 5, 0);
    const d = insertDoor({ wallId: w, offsetAlongAxis: 1 });
    const v = insertWindow({ wallId: w, offsetAlongAxis: 3 });
    store.run(d);
    store.run(v);
    expect(store.run(deleteElements([w])).ok).toBe(true);
    for (const id of [w, d.doorId, d.openingId, v.windowId, v.openingId]) expect(store.getEntity(id)).toBeUndefined();
    expect(store.indices.elementsOfLevel(ids.levelId).size).toBe(0);
    expect(store.debugIndicesMatchRebuild()).toBe(true);

    store.undo();
    expect(store.getEntity(d.doorId)).toBeDefined();
    expect(store.indices.fillingOfOpening(d.openingId)).toBe(d.doorId);
  });

  it("borrar una puerta conserva su hueco, salvo que se pida lo contrario", () => {
    const { store, wall } = setup();
    const w = wall(0, 0, 5, 0);
    const d = insertDoor({ wallId: w, offsetAlongAxis: 1 });
    store.run(d);
    store.run(deleteElements([d.doorId]));
    expect(store.getEntity(d.openingId)).toBeDefined();
    expect(store.indices.fillingOfOpening(d.openingId)).toBeUndefined();

    store.undo();
    store.run(deleteElements([d.doorId], { removeOpeningOfFilling: true }));
    expect(store.getEntity(d.openingId)).toBeUndefined();
  });
});

describe("BimStore: sesión interactiva (arrastres)", () => {
  it("muchas vistas previas, un solo paso de deshacer", () => {
    const { store, events, wall } = setup();
    const w = wall(0, 0, 5, 0);
    events.length = 0;
    const s = store.beginInteractive("Mover muro");
    for (let i = 1; i <= 30; i++) s.update(moveWalls([w], { x: i * 0.1, y: 0 }));
    expect((store.getEntity(w) as Wall).start.x).toBeCloseTo(3);
    expect(events.every((e) => e.preview)).toBe(true);
    expect(s.commit().ok).toBe(true);
    expect(events.at(-1)!.preview).toBe(false);

    store.undo();
    expect((store.getEntity(w) as Wall).start.x).toBe(0);
    expect(store.undoLabel).toBe("Crear muro");
  });

  it("cancelar deja el modelo como estaba y sin historial", () => {
    const { store, wall } = setup();
    const w = wall(0, 0, 5, 0);
    const before = JSON.stringify(store.snapshot());
    const s = store.beginInteractive("Mover muro");
    s.update(moveWalls([w], { x: 2, y: 2 }));
    s.cancel();
    expect(JSON.stringify(store.snapshot())).toBe(before);
    expect(store.undoLabel).toBe("Crear muro");
  });

  it("no permite otros cambios mientras hay una sesión abierta", () => {
    const { store, wall } = setup();
    const w = wall(0, 0, 5, 0);
    const s = store.beginInteractive("Mover");
    expect(() => store.run(moveWalls([w], { x: 1, y: 0 }))).toThrow();
    s.cancel();
  });
});

describe("Propagador de dependencias", () => {
  it("cambiar una receta de capas ensucia muros, huecos y rellenos", () => {
    const { store, ids, wall } = setup();
    const w = wall(0, 0, 5, 0);
    const d = insertDoor({ wallId: w, offsetAlongAxis: 1 });
    store.run(d);
    const dirty = expandDirtyForGeometry(store, [ids.layerSets.tabique15]);
    for (const id of [w, d.openingId, d.doorId]) expect(dirty.has(id)).toBe(true);
  });

  it("y el espesor cambia sin tocar el muro", () => {
    const { store, ids, wall } = setup();
    const w = wall(0, 0, 5, 0);
    const set = store.getEntity(ids.layerSets.tabique15) as MaterialLayerSet;
    store.run(updateEntity<MaterialLayerSet>(set.id, { layers: [...set.layers, { materialId: set.layers[0]!.materialId, thickness: 0.05 }] }));
    expect(wallThickness(store, w)).toBeCloseTo(0.2);
  });
});

describe("Prueba de oro: índices incrementales = índices reconstruidos", () => {
  it("tras una secuencia larga de comandos, deshacer y rehacer", () => {
    const { store, ids } = setup();
    let seed = 42;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const walls: string[] = [];
    for (let i = 0; i < 200; i++) {
      const r = rnd();
      if (r < 0.35 || walls.length === 0) {
        const c = createWall({ levelId: ids.levelId, layerSetId: ids.layerSets.exterior25, start: { x: rnd() * 20, y: rnd() * 20 }, end: { x: rnd() * 20 + 25, y: rnd() * 20 } });
        if (store.run(c).ok) walls.push(c.wallId);
      } else if (r < 0.6) {
        store.run(insertDoor({ wallId: walls[Math.floor(rnd() * walls.length)]!, offsetAlongAxis: rnd() * 10 }));
      } else if (r < 0.7) {
        store.run(insertWindow({ wallId: walls[Math.floor(rnd() * walls.length)]!, offsetAlongAxis: rnd() * 10 }));
      } else if (r < 0.8) {
        const w = walls.splice(Math.floor(rnd() * walls.length), 1)[0]!;
        store.run(deleteElements([w]));
      } else if (r < 0.9) {
        store.undo();
      } else {
        store.redo();
      }
      expect(store.debugIndicesMatchRebuild()).toBe(true);
    }
  });
});
