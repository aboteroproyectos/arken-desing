import { describe, expect, it } from "vitest";
import { BimStore, createStarterModel, createWall, insertDoor, insertWindow, moveWalls, type Door } from "@arken/core";
import { PlanGeometryEngine, buildWallFrame, type PlanPrimitive } from "../src";

function setup(start = { x: 0, y: 0 }, end = { x: 5, y: 0 }) {
  const { model, ids } = createStarterModel();
  const store = new BimStore(model);
  const w = createWall({ levelId: ids.levelId, layerSetId: ids.layerSets.tabique15, start, end });
  store.run(w);
  return { store, ids, wallId: w.wallId };
}

const polygons = (prims: readonly PlanPrimitive[]) => prims.filter((p) => p.kind === "polygon");

describe("Marco local del muro (ejemplo del Paso 3, §12)", () => {
  it("W1 de (0,0) a (5,0), tabique 15 centrado", () => {
    const { store, wallId } = setup();
    const f = buildWallFrame(store, store.getEntity(wallId) as never);
    expect(f.u).toEqual({ x: 1, y: 0 });
    expect(f.n.x).toBeCloseTo(0);
    expect(f.n.y).toBeCloseTo(1);
    expect(f.length).toBe(5);
    expect(f.faceExt).toBeCloseTo(0.075);
    expect(f.faceInt).toBeCloseTo(-0.075);
    expect(f.layers.map((l) => l.nBottom)).toEqual([expect.closeTo(0.06), expect.closeTo(-0.06), expect.closeTo(-0.075)]);
  });
});

describe("Planta del muro", () => {
  it("sin huecos: 3 capas y un contorno, caja = huella", () => {
    const { store, wallId } = setup();
    const eng = new PlanGeometryEngine();
    eng.rebuildAll(store);
    const g = eng.get(wallId)!;
    expect(polygons(g.primitives)).toHaveLength(3);
    expect(g.box.minX).toBeCloseTo(0);
    expect(g.box.maxX).toBeCloseTo(5);
    expect(g.box.minY).toBeCloseTo(-0.075);
    expect(g.box.maxY).toBeCloseTo(0.075);
  });

  it("una puerta a 1 m parte el muro en dos tramos: [0,1] y [1.9,5]", () => {
    const { store, wallId } = setup();
    store.run(insertDoor({ wallId, offsetAlongAxis: 1, width: 0.9 }));
    const eng = new PlanGeometryEngine();
    eng.rebuildAll(store);
    const outlines = eng.get(wallId)!.primitives.filter((p) => p.style === "muro:contorno");
    expect(outlines).toHaveLength(2);
    const xs = outlines.map((p) => (p.kind === "polyline" ? [p.points[0]!.x, p.points[1]!.x] : []));
    expect(xs[0]).toEqual([expect.closeTo(0), expect.closeTo(1)]);
    expect(xs[1]).toEqual([expect.closeTo(1.9), expect.closeTo(5)]);
  });

  it("una ventana alta (por encima del corte) no abre el muro y se marca oculta", () => {
    const { store, wallId } = setup();
    store.run(insertWindow({ wallId, offsetAlongAxis: 2, sillHeight: 1.8, height: 0.6 }));
    const eng = new PlanGeometryEngine();
    eng.rebuildAll(store);
    const prims = eng.get(wallId)!.primitives;
    expect(prims.filter((p) => p.style === "muro:contorno")).toHaveLength(1);
    expect(prims.filter((p) => p.style === "oculto")).toHaveLength(2);
  });
});

describe("Símbolo de puerta", () => {
  it("bisagra izquierda, abre hacia dentro: hoja y arco hacia n negativo, caja incluye el arco", () => {
    const { store, wallId } = setup();
    const d = insertDoor({ wallId, offsetAlongAxis: 1, width: 0.9 });
    store.run(d);
    const eng = new PlanGeometryEngine();
    eng.rebuildAll(store);
    const g = eng.get(d.doorId)!;
    const leafW = (store.getEntity(d.doorId) as Door).leafWidth;
    const leaf = g.primitives.find((p) => p.kind === "polyline")!;
    if (leaf.kind !== "polyline") throw new Error();
    expect(leaf.points[0]).toEqual({ x: expect.closeTo(1), y: expect.closeTo(-0.075) });
    expect(leaf.points[1]).toEqual({ x: expect.closeTo(1), y: expect.closeTo(-0.075 - leafW) });
    expect(g.box.minY).toBeCloseTo(-0.075 - leafW);
    expect(g.box.maxX).toBeCloseTo(1 + leafW);
  });
});

describe("Invalidación incremental", () => {
  it("mover el muro recalcula muro y puerta, y la puerta lo acompaña", () => {
    const { store, wallId } = setup();
    const d = insertDoor({ wallId, offsetAlongAxis: 1 });
    store.run(d);
    const eng = new PlanGeometryEngine();
    eng.rebuildAll(store);
    const before = eng.get(d.doorId)!.box;
    let updatedIds: string[] = [];
    store.subscribe((e) => (updatedIds = eng.applyChange(store, e).updated.map((g) => g.elementId)));
    store.run(moveWalls([wallId], { x: 10, y: 3 }));
    expect(new Set(updatedIds)).toEqual(new Set([wallId, d.doorId]));
    const after = eng.get(d.doorId)!.box;
    expect(after.minX - before.minX).toBeCloseTo(10);
    expect(after.minY - before.minY).toBeCloseTo(3);
  });

  it("deshacer la creación del muro elimina su geometría", () => {
    const { store, wallId } = setup();
    const eng = new PlanGeometryEngine();
    eng.rebuildAll(store);
    let removed: readonly string[] = [];
    store.subscribe((e) => (removed = eng.applyChange(store, e).removed));
    store.undo();
    expect(removed).toEqual([wallId]);
    expect(eng.get(wallId)).toBeUndefined();
  });

  it("un muro girado 90° da la misma forma, girada", () => {
    const { store, wallId } = setup({ x: 0, y: 0 }, { x: 0, y: 5 });
    const eng = new PlanGeometryEngine();
    eng.rebuildAll(store);
    const b = eng.get(wallId)!.box;
    expect(b.minX).toBeCloseTo(-0.075);
    expect(b.maxX).toBeCloseTo(0.075);
    expect(b.maxY).toBeCloseTo(5);
  });
});
