import { describe, expect, it } from "vitest";
import { Terrain, decodeSurvey, defaultPlacement, earthwork, encodeSurvey, parseCsvSurvey, readSurvey, sampleSurveyDxf, toModel, toSite } from "../src";

const plane = (x: number, y: number) => 100 + 0.1 * x + 0.05 * y;

function planeDxf(): string {
  const L = ["0", "SECTION", "2", "ENTITIES"];
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) L.push("0", "POINT", "8", "P", "10", String(500000 + i * 3), "20", String(1200000 + j * 3), "30", String(plane(i * 3, j * 3)));
  L.push("0", "LWPOLYLINE", "8", "CURVAS", "38", "0", "90", "2", "10", "500001", "20", "1200001", "10", "500002", "20", "1200002");
  L.push("0", "ENDSEC", "0", "EOF");
  return L.join("\n");
}

describe("topografía", () => {
  it("lee puntos de un DXF, ignora lo que no tiene cota y usa origen local", () => {
    const s = readSurvey(planeDxf(), "lev.dxf");
    expect(s.points.length).toBe(121);
    expect(s.origin).toEqual({ x: 500000, y: 1200000 });
    expect(s.stats.zMin).toBeCloseTo(100);
  });

  it("interpola cotas exactas en un plano y produce curvas rectas", () => {
    const t = new Terrain(readSurvey(planeDxf(), "lev.dxf"));
    expect(t.tin.tris.length).toBe(200);
    expect(t.z(10.3, 7.7)).toBeCloseTo(plane(10.3, 7.7), 6);
    expect(t.z(-1, 5)).toBeUndefined();
    const cs = t.contours(0.5);
    expect(cs.length).toBeGreaterThan(5);
    for (const c of cs) for (const l of c.lines) for (const p of l) expect(plane(p.x, p.y)).toBeCloseTo(c.z, 6);
  });

  it("movimiento de tierras: corte y lleno exactos en un plano y NPT de equilibrio", () => {
    const t = new Terrain(readSurvey(planeDxf(), "lev.dxf"));
    const poly = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 15 }, { x: 0, y: 15 }];
    const pl = { x: 5, y: 5, rotDeg: 0, npt: plane(11, 12.5) + 0.35 };
    const ew = earthwork(t, pl, poly);
    // Plataforma a la cota media: corte = lleno = ∫|z - zm| = ...
    expect(ew.area).toBeCloseTo(180, 6);
    expect(ew.outside).toBe(0);
    expect(ew.cut).toBeCloseTo(ew.fill, 1);
    expect(ew.zMean).toBeCloseTo(plane(11, 12.5), 3);
    expect(ew.slopePct).toBeCloseTo(Math.hypot(10, 5), 1);
    expect(ew.balancedNpt).toBeCloseTo(Math.round((plane(11, 12.5) + 0.35) * 20) / 20, 6);
  });

  it("transformación casa ↔ sitio es reversible", () => {
    const pl = { x: 3, y: 4, rotDeg: 33, npt: 0 };
    const q = toModel(pl, toSite(pl, { x: 7, y: -2 }));
    expect(q.x).toBeCloseTo(7, 9);
    expect(q.y).toBeCloseTo(-2, 9);
  });

  it("lee PNEZD y guarda/recupera el levantamiento", () => {
    const pts = parseCsvSurvey("1,1200000.5,500000.25,2450.1,BM\n2;1200010;500010;2451.3;PI\nP,N,E,Z,D");
    expect(pts).toEqual([{ x: 500000.25, y: 1200000.5, z: 2450.1 }, { x: 500010, y: 1200010, z: 2451.3 }]);
    const s = readSurvey(sampleSurveyDxf(), "ejemplo.dxf");
    const back = decodeSurvey(encodeSurvey(s))!;
    expect(back.points.length).toBe(s.points.length);
    const t = new Terrain(back);
    const pl = defaultPlacement(t, { minX: 0, minY: 0, maxX: 12, maxY: 15 });
    const ew = earthwork(t, pl, [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 15 }, { x: 0, y: 15 }]);
    expect(ew.outside).toBe(0);
    expect(Math.abs(ew.cut - ew.fill) / (ew.cut + ew.fill)).toBeLessThan(0.15);
  });
});
