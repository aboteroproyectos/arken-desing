import { describe, expect, it } from "vitest";
import { BimStore, validate } from "@arken/core";
import { reportChapters } from "@arken/calc";
import { allSheets, buildSheet } from "@arken/sheets";
import { designHouse, nextQuestion, answerText, parseDescription, reviewDesign, STYLE_KEYS, QUESTIONS, type ProgramDraft } from "../src";

function check(d: ProgramDraft) {
  const r = designHouse(d);
  const store = new BimStore(r.model);
  const ids = [...[...store.entities()].map((e) => e.id), ...[...store.relations()].map((x) => x.id)];
  expect(validate(store, ids)).toEqual([]);
  const sheets = allSheets(store);
  for (const s of sheets) expect(buildSheet(store, s).primitives.length).toBeGreaterThan(20);
  const bad = reportChapters(store).flatMap((c) => c.checks ?? []).filter((c) => !c.ok);
  expect(bad.map((b) => `${b.item}: ${b.detail}`)).toEqual([]);
  return { r, store, sheets, review: reviewDesign(r) };
}

describe("motor de diseño", () => {
  it.each(STYLE_KEYS)("estilo %s: modelo válido, planos completos y cálculos que cumplen", (estilo) => {
    const { sheets, review, r } = check({ estilo, pisos: 2, habitaciones: 4 });
    const nums = sheets.map((s) => s.number);
    for (const n of ["A-01", "A-02", "AC-01", "C-01", "C-02", "C-03"]) expect(nums).toContain(n);
    expect(sheets.some((s) => s.blocks.some((b) => b.type === "fachadas"))).toBe(true);
    expect(sheets.some((s) => s.blocks.some((b) => b.type === "cortes"))).toBe(true);
    expect(review.score).toBeGreaterThanOrEqual(70);
    expect(r.program.estilo).toBe(estilo);
  });

  it.each([1, 2, 3, 4])("casa de %i pisos", (pisos) => {
    const { r, store } = check({ pisos, habitaciones: pisos + 2, estudio: true });
    const levels = [...store.entities()].filter((e) => e.kind === "Level" && e.name?.startsWith("Piso"));
    expect(levels).toHaveLength(pisos);
    // Las ventanas de cada piso están en los muros de ese piso.
    for (const w of [...store.entities()].filter((e) => e.kind === "Wall" && e.properties?.["fachada"])) expect(store.indices.openingsOfHost(w.id)?.size ?? 0).toBeGreaterThan(0);
    expect(r.rooms.filter((x) => x.type === "principal")).toHaveLength(1);
  });

  it.each(["plana", "una-agua", "dos-aguas", "cuatro-aguas"] as const)("cubierta %s", (cubierta) => {
    const { store } = check({ cubierta, pisos: 1, habitaciones: 3 });
    const pr = [...store.entities()].find((e) => e.kind === "Project")!;
    expect(pr.properties?.["cubierta_tipo"]).toBe(cubierta);
  });

  it("redes hidrosanitarias, lluvias y comunicaciones con sus planos", () => {
    const { sheets, store } = check({ pisos: 2, habitaciones: 4 });
    const nums = sheets.map((s) => s.number);
    for (const n of ["H-01", "H-02", "H-03", "S-01", "S-02", "S-03", "D-01", "D-02"]) expect(nums).toContain(n);
    expect(nums).not.toContain("G-01");
    const runs = [...store.entities()].filter((e) => e.kind === "Run");
    for (const sys of ["PRI", "AF", "AC", "RC", "AN", "ALL", "DAT"]) expect(runs.some((r) => r.kind === "Run" && r.system === sys)).toBe(true);
  });

  it.each(["natural", "tanque", "pipetas"] as const)("red de gas con suministro %s", (gas) => {
    const { sheets, store } = check({ pisos: 2, habitaciones: 4, gas });
    expect(sheets.map((s) => s.number)).toContain("G-01");
    const sym = { natural: "medidor-gas", tanque: "tanque-glp", pipetas: "pipetas" }[gas];
    const ents = [...store.entities()];
    expect(ents.some((e) => e.kind === "Device" && e.symbol === sym)).toBe(true);
    expect(ents.filter((e) => e.kind === "Run" && e.system === "GAS").length).toBeGreaterThan(3);
  });

  it("clósets y muebles en madera en todas las habitaciones", () => {
    const { review } = check({ pisos: 2, habitaciones: 5, servicio: true });
    const closets = review.items.filter((i) => i.item.endsWith("clóset"));
    expect(closets.length).toBeGreaterThanOrEqual(5);
    expect(closets.every((i) => i.level === "ok")).toBe(true);
  });

  it("revisa la implantación en el lote", () => {
    const small = reviewDesign(designHouse({ pisos: 1, habitaciones: 5, loteFrente: 12, loteFondo: 20 }));
    expect(small.items.find((i) => i.item === "Implantación")?.level).toBe("falla");
    const big = reviewDesign(designHouse({ pisos: 2, habitaciones: 3, loteFrente: 40, loteFondo: 50 }));
    expect(big.items.find((i) => i.item === "Implantación")?.level).toBe("ok");
  });
});

describe("descripción y preguntas", () => {
  it("entiende el suministro de gas", () => {
    expect(parseDescription("casa con gas natural").draft.gas).toBe("natural");
    expect(parseDescription("cocina a gas con tanque estacionario").draft.gas).toBe("tanque");
    expect(parseDescription("gas con cuarto de pipetas").draft.gas).toBe("pipetas");
    expect(parseDescription("casa todo eléctrica, sin gas").draft.gas).toBe("no");
  });

  it("entiende una descripción libre", () => {
    const { draft } = parseDescription("Quiero una casa campestre de dos pisos con 4 habitaciones, 3 baños, estudio, garaje para 2 carros y techo a dos aguas en un lote de 20 x 30, unos 320 m2");
    expect(draft).toMatchObject({ pisos: 2, habitaciones: 4, banos: 3, estudio: true, parqueaderos: 2, cubierta: "dos-aguas", loteFrente: 20, loteFondo: 30, areaObjetivo: 320 });
  });

  it("hace todas las preguntas y termina", () => {
    let d: ProgramDraft = {};
    let n = 0;
    for (let q = nextQuestion(d); q && n < QUESTIONS.length + 2; q = nextQuestion(d), n++) {
      const patch = q.options.length ? q.options[0]!.patch : answerText(q, q.input === "lote" ? "30 x 45" : q.input === "number" ? "280" : "Casa prueba");
      expect(patch).toBeDefined();
      d = { ...d, ...patch };
    }
    expect(nextQuestion(d)).toBeUndefined();
    check(d);
  });

  it.each(["L", "T", "U", "X", "cuadrada"] as const)("huella en %s: pabellones unidos por galerías, planos completos", (huella) => {
    for (const pisos of [1, 2]) {
      const { r, review } = check({ huella, pisos, habitaciones: 4 });
      expect(r.program.huella).toBe(huella);
      expect(r.layout.wings.length).toBe(huella === "L" || huella === "T" ? 2 : 3);
      expect(r.layout.links.length).toBe(r.layout.wings.length - 1);
      expect(review.score).toBeGreaterThanOrEqual(70);
    }
  });

  it("entiende la huella en la descripción", () => {
    expect(parseDescription("casa en L de un piso").draft.huella).toBe("L");
    expect(parseDescription("casa en forma de T").draft.huella).toBe("T");
    expect(parseDescription("casa en U con patio").draft.huella).toBe("U");
    expect(parseDescription("casa en cruz").draft.huella).toBe("X");
    expect(parseDescription("casa patio con claustro").draft.huella).toBe("cuadrada");
    expect(QUESTIONS.some((q) => q.key === "huella")).toBe(true);
  });
});
