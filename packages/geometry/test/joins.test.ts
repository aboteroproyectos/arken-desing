import { describe, expect, it } from "vitest";
import { BimStore, createStarterModel, createWall, moveWalls, type Vec2 } from "@arken/core";
import { PlanGeometryEngine, buildWallFrame, wallEndCuts, type PlanPrimitive } from "../src";

function setup() {
  const { model, ids } = createStarterModel();
  const store = new BimStore(model);
  const wall = (a: Vec2, b: Vec2) => {
    const c = createWall({ levelId: ids.levelId, layerSetId: ids.layerSets.tabique15, start: a, end: b });
    store.run(c);
    return c.wallId;
  };
  const cuts = (id: string) => {
    const w = store.getEntity(id) as never;
    return wallEndCuts(store, w, buildWallFrame(store, w));
  };
  return { store, wall, cuts };
}

const outline = (prims: readonly PlanPrimitive[]) => {
  const p = prims.find((q) => q.style === "muro:contorno");
  return p && p.kind === "polyline" ? p.points : [];
};

describe("Inglete en L (tabique de 15 cm centrado)", () => {
  it("A de (-5,0) a (0,0) y B de (0,0) a (0,5): corte a 45° por la diagonal x + y = 0", () => {
    const { wall, cuts } = setup();
    const a = wall({ x: -5, y: 0 }, { x: 0, y: 0 });
    const b = wall({ x: 0, y: 0 }, { x: 0, y: 5 });
    // A: cara exterior en y = +0.075 → x = -0.075 → u = 4.925; cara interior y = -0.075 → u = 5.075
    expect(cuts(a).end.uExt).toBeCloseTo(4.925);
    expect(cuts(a).end.uInt).toBeCloseTo(5.075);
    expect(cuts(a).start).toEqual({ uExt: 0, uInt: 0 });
    // B (n apunta a -x): cara exterior x = -0.075 → y = 0.075; cara interior x = +0.075 → y = -0.075
    expect(cuts(b).start.uExt).toBeCloseTo(0.075);
    expect(cuts(b).start.uInt).toBeCloseTo(-0.075);
  });

  it("las dos huellas comparten exactamente la línea de inglete", () => {
    const { store, wall } = setup();
    const a = wall({ x: -5, y: 0 }, { x: 0, y: 0 });
    const b = wall({ x: 0, y: 0 }, { x: 0, y: 5 });
    const eng = new PlanGeometryEngine();
    eng.rebuildAll(store);
    const key = (p: Vec2) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
    const pa = new Set(outline(eng.get(a)!.primitives).map(key));
    const pb = new Set(outline(eng.get(b)!.primitives).map(key));
    expect(pa.has(key({ x: 0.075, y: -0.075 }))).toBe(true);
    expect(pa.has(key({ x: -0.075, y: 0.075 }))).toBe(true);
    expect(pb.has(key({ x: 0.075, y: -0.075 }))).toBe(true);
    expect(pb.has(key({ x: -0.075, y: 0.075 }))).toBe(true);
  });

  it("funciona igual con muros dibujados en sentido contrario", () => {
    const { wall, cuts } = setup();
    const a = wall({ x: 0, y: 0 }, { x: -5, y: 0 }); // A empieza en la esquina
    wall({ x: 0, y: 5 }, { x: 0, y: 0 }); // B termina en la esquina
    const c = cuts(a).start;
    expect([c.uExt, c.uInt].sort((p, q) => p - q)).toEqual([expect.closeTo(-0.075), expect.closeTo(0.075)]);
  });

  it("muros casi en línea (menos de 5°) se cortan en recto", () => {
    const { wall, cuts } = setup();
    const a = wall({ x: 0, y: 0 }, { x: 5, y: 0 });
    wall({ x: 5, y: 0 }, { x: 10, y: 0.2 });
    expect(cuts(a).end.uExt).toBeCloseTo(5);
    expect(cuts(a).end.uInt).toBeCloseTo(5);
  });
});

describe("Tope en T", () => {
  it("el muro que llega se recorta en la cara de la barra; la barra no cambia", () => {
    const { wall, cuts } = setup();
    const bar = wall({ x: -3, y: 0 }, { x: 3, y: 0 });
    const stem = wall({ x: 0, y: 3 }, { x: 0, y: 0 });
    expect(cuts(stem).end.uExt).toBeCloseTo(2.925);
    expect(cuts(stem).end.uInt).toBeCloseTo(2.925);
    expect(cuts(bar).start).toEqual({ uExt: 0, uInt: 0 });
    expect(cuts(bar).end.uExt).toBeCloseTo(6);
  });

  it("desde abajo, se recorta contra la otra cara", () => {
    const { wall, cuts } = setup();
    wall({ x: -3, y: 0 }, { x: 3, y: 0 });
    const stem = wall({ x: 0, y: -3 }, { x: 0, y: 0 });
    expect(cuts(stem).end.uExt).toBeCloseTo(2.925);
  });
});

describe("Invalidación", () => {
  it("al separar un muro, el otro recupera su extremo recto", () => {
    const { store, wall } = setup();
    const a = wall({ x: -5, y: 0 }, { x: 0, y: 0 });
    const b = wall({ x: 0, y: 0 }, { x: 0, y: 5 });
    const eng = new PlanGeometryEngine();
    eng.rebuildAll(store);
    store.subscribe((e) => eng.applyChange(store, e));
    expect(eng.get(a)!.box.maxX).toBeCloseTo(0.075);
    store.run(moveWalls([b], { x: 2, y: 0 }));
    expect(eng.get(a)!.box.maxX).toBeCloseTo(0);
    store.undo();
    expect(eng.get(a)!.box.maxX).toBeCloseTo(0.075);
  });
});
