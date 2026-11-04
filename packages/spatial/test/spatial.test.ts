import { describe, expect, it } from "vitest";
import { BimStore, createStarterModel, createWall, deleteElements, insertDoor, moveWalls } from "@arken/core";
import { PlanGeometryEngine } from "@arken/geometry";
import { SpatialIndexManager } from "../src";

function setup() {
  const { model, ids } = createStarterModel();
  const store = new BimStore(model);
  const engine = new PlanGeometryEngine();
  const spatial = new SpatialIndexManager();
  store.subscribe((e) => spatial.applyGeometryUpdate(engine.applyChange(store, e)));
  const w = createWall({ levelId: ids.levelId, layerSetId: ids.layerSets.tabique15, start: { x: 0, y: 0 }, end: { x: 5, y: 0 } });
  store.run(w);
  const d = insertDoor({ wallId: w.wallId, offsetAlongAxis: 1, width: 0.9 });
  store.run(d);
  return { store, engine, spatial, levelId: ids.levelId, ids, wallId: w.wallId, doorId: d.doorId };
}

describe("Clic en dos fases (ejemplo del Paso 4, §10)", () => {
  it("clic en (1.40, -0.45) con tolerancia 0.05: no acierta nada", () => {
    const { spatial, levelId } = setup();
    expect(spatial.pick(levelId, { x: 1.4, y: -0.45 }, 0.05)).toEqual([]);
  });

  it("clic en (1.62, -0.55): acierta el arco de la puerta", () => {
    const { spatial, levelId, doorId } = setup();
    const hits = spatial.pick(levelId, { x: 1.62, y: -0.55 }, 0.05);
    expect(hits.map((h) => h.elementId)).toEqual([doorId]);
  });

  it("clic sobre el muro: acierta el muro", () => {
    const { spatial, levelId, wallId } = setup();
    expect(spatial.pick(levelId, { x: 3, y: 0.01 }, 0.05)[0]?.elementId).toBe(wallId);
  });

  it("si tocan muro y puerta a la vez, gana la puerta", () => {
    const { spatial, levelId, wallId, doorId } = setup();
    const hits = spatial.pick(levelId, { x: 1.0, y: -0.07 }, 0.05).map((h) => h.elementId);
    expect(hits).toEqual([doorId, wallId]);
  });

  it("excluye lo que se está arrastrando", () => {
    const { spatial, levelId, wallId } = setup();
    expect(spatial.pick(levelId, { x: 3, y: 0 }, 0.05, new Set([wallId]))).toEqual([]);
  });
});

describe("Selección por rectángulo", () => {
  it("ventana: solo lo que queda completamente dentro", () => {
    const { spatial, levelId, doorId } = setup();
    expect(spatial.boxSelect(levelId, { minX: 0.9, minY: -1, maxX: 2, maxY: 0.2 }, "window")).toEqual([doorId]);
  });
  it("captura: todo lo que toca", () => {
    const { spatial, levelId, wallId, doorId } = setup();
    expect(new Set(spatial.boxSelect(levelId, { minX: 0.9, minY: -1, maxX: 2, maxY: 0.2 }, "crossing"))).toEqual(new Set([wallId, doorId]));
  });
});

describe("Snapping", () => {
  it("extremo antes que eje; rejilla si no hay nada cerca", () => {
    const { store, spatial, levelId, ids } = setup();
    store.run(createWall({ levelId, layerSetId: ids.layerSets.tabique15, start: { x: 5, y: 0 }, end: { x: 5, y: 4 } }));
    expect(spatial.snap(levelId, { x: 5.03, y: 0.02 }, 0.1)?.kind).toBe("endpoint");
    expect(spatial.snap(levelId, { x: 2.5, y: 0.04 }, 0.1)?.kind).toBe("midpoint");
    expect(spatial.snap(levelId, { x: 3.3, y: 0.04 }, 0.1)).toMatchObject({ kind: "onAxis", point: { x: expect.closeTo(3.3), y: expect.closeTo(0) } });
    expect(spatial.snap(levelId, { x: 8.04, y: 8.02 }, 0.1, { grid: 0.1 })).toMatchObject({ kind: "grid", point: { x: expect.closeTo(8), y: expect.closeTo(8) } });
  });
});

describe("Prueba de oro: índice incremental = índice reconstruido", () => {
  it("tras mover, borrar y deshacer", () => {
    const { store, engine, spatial, levelId, wallId } = setup();
    store.run(moveWalls([wallId], { x: 3, y: 1 }));
    store.run(deleteElements([wallId]));
    store.undo();
    store.undo();
    store.redo();
    const fresh = new SpatialIndexManager();
    fresh.rebuildAll(new PlanGeometryEngine().rebuildAll(store).updated);
    expect(spatial.debugDump(levelId)).toBe(fresh.debugDump(levelId));
    void engine;
  });
});
