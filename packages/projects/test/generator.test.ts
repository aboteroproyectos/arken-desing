import { describe, expect, it } from "vitest";
import { BimStore, polygonArea, validate } from "@arken/core";
import { reportChapters } from "@arken/calc";
import { allSheets, buildSheet } from "@arken/sheets";
import { checkSpec, defaultSpec, generateHouse } from "../src";

describe("generador por especificaciones", () => {
  it("con las medidas de la plantilla reproduce la Casa Lote 01", () => {
    const store = new BimStore(generateHouse({ ...defaultSpec(), proyecto: "PRUEBA" }));
    expect(allSheets(store)).toHaveLength(11);
    const bad = reportChapters(store).flatMap((c) => c.checks ?? []).filter((c) => !c.ok);
    expect(bad).toEqual([]);
  });

  for (const [ancho, largo] of [[11, 13.5], [14, 17], [16, 20]] as const) {
    it(`genera una casa válida de ${ancho} × ${largo} m con todos sus planos`, () => {
      const model = generateHouse({ ...defaultSpec(), ancho, largo, proyecto: "CASA " + ancho });
      const store = new BimStore(model);
      const all = [...[...store.entities()].map((e) => e.id), ...[...store.relations()].map((r) => r.id)];
      expect(validate(store, all)).toEqual([]);
      const spaces = [...store.entities()].filter((e) => e.kind === "Space" && e.properties?.["exterior"] !== true);
      const area = spaces.reduce((t, s) => t + (s.kind === "Space" ? polygonArea(s.boundary) : 0), 0);
      expect(area).toBeGreaterThan(ancho * largo * 0.8);
      expect(area).toBeLessThan(ancho * largo);
      for (const s of allSheets(store)) expect(buildSheet(store, s).primitives.length).toBeGreaterThan(50);
      const bad = reportChapters(store).flatMap((c) => c.checks ?? []).filter((c) => !c.ok);
      expect(bad.map((b) => `${b.item}: ${b.detail}`)).toEqual([]);
    });
  }

  it("rechaza medidas fuera de rango", () => {
    expect(checkSpec({ ...defaultSpec(), ancho: 30 }).length).toBe(1);
    expect(() => generateHouse({ ...defaultSpec(), largo: 5 })).toThrow();
  });
});
