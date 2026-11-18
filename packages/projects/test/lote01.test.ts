import { describe, expect, it } from "vitest";
import { BimStore, getOfKind, validate, type Level } from "@arken/core";
import * as calc from "@arken/calc";
import { allSheets, buildSheet } from "@arken/sheets";
import { buildLote01 } from "../src";

const model = buildLote01();
const store = new BimStore(model);
const level = [...store.entities()].find((e) => e.kind === "Level" && e.name === "Primer piso") as Level;
const roof = [...store.entities()].find((e) => e.kind === "Level" && e.name === "Cubierta") as Level;

function dump(t: calc.Table): string {
  return t.rows.filter((r) => r.status === "revisar").map((r) => r.cells.join(" | ")).join("\n");
}

describe("Casa Lote 01 · Bosque de Agua", () => {
  it("cumple todas las reglas de integridad del modelo", () => {
    const all = [...[...store.entities()].map((e) => e.id), ...[...store.relations()].map((r) => r.id)];
    expect(validate(store, all)).toEqual([]);
  });

  it("tiene 180 m² construidos y todos los recintos pedidos", () => {
    const names = [...store.entities()].filter((e) => e.kind === "Space").map((e) => e.name);
    for (const n of ["Habitación principal", "Vestier principal", "Baño principal", "Baño 2", "Baño social", "Habitación 2", "Habitación 3", "Parqueadero cubierto"]) expect(names).toContain(n);
    const t = calc.areaTable(store, level.id);
    expect(JSON.stringify(t)).toContain("180");
  });

  const tables: [string, () => calc.Table][] = [
    ["cargas TG", () => calc.loadScheduleTable(store, "TG")],
    ["cargas TR", () => calc.loadScheduleTable(store, "TR")],
    ["acometida", () => calc.demandTable(store)],
    ["iluminación", () => calc.lightingTable(store, level.id)],
    ["hidráulica", () => calc.waterTable(store, level.id)],
    ["sanitaria", () => calc.sanitaryTable(store, level.id)],
    ["lluvias", () => calc.rainTable(store)],
    ["gas", () => calc.gasTable(store, level.id)],
    ["solar", () => calc.solarTable(store)],
  ];
  for (const [name, fn] of tables) {
    it(`cuadro de ${name} sin filas por revisar`, () => {
      const t = fn();
      expect(t.rows.length).toBeGreaterThan(0);
      expect(dump(t)).toBe("");
    });
  }

  it("todos los circuitos verifican protección, conductor y caída de tensión", () => {
    const bad = calc.circuitResults(store).filter((r) => r.issues.length > 0);
    expect(bad.map((r) => `${r.circuit.number}: ${r.issues.join(", ")}`)).toEqual([]);
  });

  it("genera los 11 planos con rótulo editable", () => {
    const sheets = allSheets(store);
    expect(sheets.map((s) => s.number)).toEqual(["A-01", "A-02", "A-03", "E-01", "E-02", "E-03", "D-01", "H-01", "S-01", "G-01", "FV-01"]);
    for (const s of sheets) {
      const g = buildSheet(store, s);
      expect(g.primitives.length).toBeGreaterThan(50);
      const texts = g.primitives.filter((p) => p.kind === "text").map((p) => (p as { text: string }).text);
      expect(texts).toContain("ARKEN 360");
    }
    expect(getOfKind(store, roof.id, "Level")?.elevation).toBe(4.2);
  });
});
