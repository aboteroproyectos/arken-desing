import { describe, expect, it } from "vitest";
import { BimStore, createStarterModel, createWall, deleteElements, moveWalls, type RelConnectsWalls, type Vec2 } from "../src";

function setup() {
  const { model, ids } = createStarterModel();
  const store = new BimStore(model);
  const wall = (a: Vec2, b: Vec2) => {
    const c = createWall({ levelId: ids.levelId, layerSetId: ids.layerSets.tabique15, start: a, end: b });
    expect(store.run(c).ok).toBe(true);
    return c.wallId;
  };
  const joins = () => [...store.relations()].filter((r): r is RelConnectsWalls => r.kind === "RelConnectsWalls");
  return { store, wall, joins };
}

describe("Detección automática de uniones", () => {
  it("dos muros encadenados forman una L", () => {
    const { wall, joins } = setup();
    const a = wall({ x: 0, y: 0 }, { x: 5, y: 0 });
    const b = wall({ x: 5, y: 0 }, { x: 5, y: 4 });
    expect(joins()).toHaveLength(1);
    const j = joins()[0]!;
    expect(new Set([`${j.wallA}:${j.endA}`, `${j.wallB}:${j.endB}`])).toEqual(new Set([`${a}:end`, `${b}:start`]));
  });

  it("un muro que llega a mitad de otro forma una T (el que llega es wallA)", () => {
    const { wall, joins } = setup();
    const bar = wall({ x: 0, y: 0 }, { x: 6, y: 0 });
    const stem = wall({ x: 3, y: 4 }, { x: 3, y: 0 });
    expect(joins()).toEqual([expect.objectContaining({ wallA: stem, endA: "end", wallB: bar, endB: "middle" })]);
  });

  it("la T también se detecta si la barra se dibuja después", () => {
    const { wall, joins } = setup();
    const stem = wall({ x: 3, y: 4 }, { x: 3, y: 0 });
    const bar = wall({ x: 0, y: 0 }, { x: 6, y: 0 });
    expect(joins()).toEqual([expect.objectContaining({ wallA: stem, endA: "end", wallB: bar, endB: "middle" })]);
  });

  it("una habitación cerrada de 4 muros tiene 4 uniones en L", () => {
    const { wall, joins } = setup();
    wall({ x: 0, y: 0 }, { x: 5, y: 0 });
    wall({ x: 5, y: 0 }, { x: 5, y: 4 });
    wall({ x: 5, y: 4 }, { x: 0, y: 4 });
    wall({ x: 0, y: 4 }, { x: 0, y: 0 });
    expect(joins()).toHaveLength(4);
    expect(joins().every((j) => j.endB !== "middle")).toBe(true);
  });

  it("mover un muro lejos rompe la unión; deshacer la recupera", () => {
    const { store, wall, joins } = setup();
    wall({ x: 0, y: 0 }, { x: 5, y: 0 });
    const b = wall({ x: 5, y: 0 }, { x: 5, y: 4 });
    const before = joins()[0]!.id;
    store.run(moveWalls([b], { x: 1, y: 0 }));
    expect(joins()).toHaveLength(0);
    store.undo();
    expect(joins().map((j) => j.id)).toEqual([before]);
    expect(store.debugIndicesMatchRebuild()).toBe(true);
  });

  it("mover un muro hasta tocar otro crea la unión", () => {
    const { store, wall, joins } = setup();
    wall({ x: 0, y: 0 }, { x: 5, y: 0 });
    const b = wall({ x: 6, y: 0 }, { x: 6, y: 4 });
    expect(joins()).toHaveLength(0);
    store.run(moveWalls([b], { x: -1, y: 0 }));
    expect(joins()).toHaveLength(1);
  });

  it("mover juntos dos muros unidos conserva su unión sin duplicarla", () => {
    const { store, wall, joins } = setup();
    const a = wall({ x: 0, y: 0 }, { x: 5, y: 0 });
    const b = wall({ x: 5, y: 0 }, { x: 5, y: 4 });
    const id = joins()[0]!.id;
    store.run(moveWalls([a, b], { x: 2, y: 2 }));
    expect(joins().map((j) => j.id)).toEqual([id]);
  });

  it("borrar un muro borra sus uniones", () => {
    const { store, wall, joins } = setup();
    wall({ x: 0, y: 0 }, { x: 5, y: 0 });
    const b = wall({ x: 5, y: 0 }, { x: 5, y: 4 });
    store.run(deleteElements([b]));
    expect(joins()).toHaveLength(0);
  });
});
