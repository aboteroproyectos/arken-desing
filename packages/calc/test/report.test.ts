import { describe, expect, it } from "vitest";
import { BimStore } from "@arken/core";
import { buildLote01 } from "@arken/projects";
import { calcReportHtml, reportChapters } from "../src";

describe("memorias de cálculo", () => {
  const store = new BimStore(buildLote01());
  it("expone un capítulo por diseño con fórmulas y cuadros", () => {
    const ch = reportChapters(store).map((c) => c.title);
    expect(ch).toEqual(["Datos generales del proyecto", "Instalaciones eléctricas", "Iluminación", "Red hidráulica (agua fría y caliente)", "Red sanitaria y aguas lluvias", "Red de gas natural", "Energía solar fotovoltaica"]);
    const html = calcReportHtml(store, { date: "2026-11-19" });
    expect(html).toContain("CUADRO DE CARGAS");
    expect(html).toContain("Cálculo tipo");
    expect(html).toContain("Resumen de verificaciones");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
  });
  it("todas las verificaciones del Lote 01 cumplen", () => {
    const bad = reportChapters(store).flatMap((c) => c.checks ?? []).filter((c) => !c.ok);
    expect(bad).toEqual([]);
  });
});
