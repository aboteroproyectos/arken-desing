import { describe, expect, it } from "vitest";
import { sunDirection, sunLight } from "../src/render3d/sky";

describe("posición del sol", () => {
  it("al mediodía del equinoccio en el ecuador está casi en el cenit", () => {
    const s = sunDirection({ hour: 12, month: 3, latitude: 0, northDeg: 0 });
    expect(s.elevation).toBeGreaterThan(88);
  });
  it("en la tarde está al occidente (−x) y de noche bajo el horizonte", () => {
    const t = sunDirection({ hour: 16, month: 7, latitude: 6.2, northDeg: 0 });
    expect(t.dir.x).toBeLessThan(0);
    expect(t.elevation).toBeGreaterThan(20);
    expect(sunDirection({ hour: 23, month: 7, latitude: 6.2, northDeg: 0 }).elevation).toBeLessThan(0);
  });
  it("en junio, a 40° norte, el sol del mediodía queda al sur (+z de la escena)", () => {
    const s = sunDirection({ hour: 12, month: 6, latitude: 40, northDeg: 0 });
    expect(s.dir.z).toBeGreaterThan(0);
    expect(s.elevation).toBeCloseTo(73.4, 0);
  });
  it("girar el norte del proyecto gira el sol alrededor de la casa", () => {
    const a = sunDirection({ hour: 9, month: 3, latitude: 6.2, northDeg: 0 }).dir;
    const b = sunDirection({ hour: 9, month: 3, latitude: 6.2, northDeg: 90 }).dir;
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(Math.abs(a.dot(b))).toBeLessThan(0.9);
  });
  it("el sol bajo es más cálido y débil que el del mediodía", () => {
    const low = sunLight(3, 0.15), high = sunLight(70, 0.15);
    expect(low.intensity).toBeLessThan(high.intensity);
    expect(low.color.b / low.color.r).toBeLessThan(high.color.b / high.color.r);
  });
});
