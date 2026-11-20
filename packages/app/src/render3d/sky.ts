// Sol y cielo físicos: posición solar por latitud, fecha y hora (declinación y ángulo horario), color del
// sol según la masa de aire y un cielo HDR con dispersión (degradado cenit–horizonte, halo solar, bruma)
// y nubes procedurales. El mismo cielo ilumina la vista previa y el trazado de rayos.

import { Color, MathUtils, Vector3 } from "three";
import { ProceduralEquirectTexture } from "three-gpu-pathtracer";
import { rng } from "./textures";

export interface SunInput {
  /** Hora solar local, 0–24. */
  hour: number;
  /** Mes 1–12 (día 21). */
  month: number;
  /** Latitud en grados (+ norte). */
  latitude: number;
  /** Dirección del norte del proyecto, en grados medidos desde el norte real en sentido horario. */
  northDeg: number;
}

/** Dirección hacia el sol en coordenadas de la escena (x, arriba, −y del plano) y su elevación en grados. */
export function sunDirection(s: SunInput): { dir: Vector3; elevation: number; azimuth: number } {
  const day = [21, 52, 80, 111, 141, 172, 202, 233, 264, 294, 325, 355][Math.min(11, Math.max(0, Math.round(s.month) - 1))]!;
  const dec = MathUtils.degToRad(23.44) * Math.sin(((2 * Math.PI) / 365) * (284 + day));
  const lat = MathUtils.degToRad(s.latitude);
  const H = MathUtils.degToRad(15 * (s.hour - 12));
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(MathUtils.clamp(sinAlt, -1, 1));
  // Acimut desde el norte, sentido horario.
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) + Math.PI;
  const E = Math.sin(az) * Math.cos(alt);
  const N = Math.cos(az) * Math.cos(alt);
  const th = MathUtils.degToRad(s.northDeg);
  // Ejes del proyecto expresados en el marco real: +y apunta a `northDeg`, +x 90° a la derecha.
  const x = E * Math.cos(th) - N * Math.sin(th);
  const y = E * Math.sin(th) + N * Math.cos(th);
  return { dir: new Vector3(x, Math.sin(alt), -y).normalize(), elevation: MathUtils.radToDeg(alt), azimuth: MathUtils.radToDeg(az) };
}

/** Color e intensidad del sol directo según su altura (más cálido y débil cerca del horizonte). */
export function sunLight(elevation: number, haze: number): { color: Color; intensity: number } {
  if (elevation <= -1) return { color: new Color(1, 0.6, 0.35), intensity: 0 };
  const e = Math.max(0.5, elevation);
  const airMass = 1 / (Math.sin(MathUtils.degToRad(e)) + 0.50572 * Math.pow(e + 6.07995, -1.6364));
  const tau = (k: number) => Math.exp(-k * airMass * (0.6 + haze));
  const color = new Color(tau(0.05), tau(0.11), tau(0.24));
  const m = Math.max(color.r, color.g, color.b);
  color.multiplyScalar(1 / m);
  const fade = MathUtils.smoothstep(elevation, -1, 4);
  return { color, intensity: 5.2 * m * fade };
}

export interface SkyInput {
  sun: Vector3;
  elevation: number;
  /** 0 = despejado … 1 = muy nublado. */
  clouds: number;
  /** 0 = aire limpio … 1 = bruma. */
  haze: number;
  /** false: sin el disco ni el halo intenso del sol (la luz directa ya la da el sol); la iluminación converge mucho más rápido. */
  sunDisc?: boolean;
}

let cloudField: Float32Array | undefined;
const CF = 512;
function clouds(): Float32Array {
  if (cloudField) return cloudField;
  const out = new Float32Array(CF * CF);
  const r = rng(99);
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < 6; o++) {
    const cells = 4 << o;
    const g = new Float32Array(cells * cells).map(() => r());
    for (let y = 0; y < CF; y++)
      for (let x = 0; x < CF; x++) {
        const fx = (x / CF) * cells, fy = (y / CF) * cells;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const at = (i: number, j: number) => g[(j % cells) * cells + (i % cells)]!;
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        out[y * CF + x]! += (a + (b - a) * sy) * amp;
      }
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i]! /= norm;
  return (cloudField = out);
}
function sampleClouds(u: number, v: number): number {
  const f = clouds();
  const x = ((u % 1) + 1) % 1 * CF, y = ((v % 1) + 1) % 1 * CF;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = x - x0, ty = y - y0;
  const at = (i: number, j: number) => f[((j + CF) % CF) * CF + ((i + CF) % CF)]!;
  const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
  const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
  return a + (b - a) * ty;
}

/** Radiancia del cielo (lineal, HDR) en la dirección `d`. */
export function skyRadiance(d: Vector3, k: SkyInput, out: Color): Color {
  const e = k.elevation;
  const day = MathUtils.smoothstep(e, -6, 12);
  const golden = 1 - MathUtils.smoothstep(e, 2, 25);
  const up = Math.max(0, d.y);
  // Cenit azul profundo de día, azul noche de noche; horizonte claro y más cálido al atardecer.
  const zen = new Color(0.07, 0.2, 0.72).lerp(new Color(0.012, 0.02, 0.05), 1 - day);
  const hor = new Color(0.6, 0.74, 0.92).lerp(new Color(1.0, 0.62, 0.38), golden * 0.85).lerp(new Color(0.05, 0.06, 0.1), 1 - day);
  hor.lerp(new Color(0.9, 0.9, 0.92), k.haze * 0.6);
  const t = Math.pow(up, 0.38 - 0.15 * k.haze);
  out.copy(hor).lerp(zen, t);
  const cosS = Math.max(0, d.dot(k.sun));
  // Halo solar (dispersión de Mie) y aclarado general hacia el lado del sol.
  const disc = k.sunDisc === false ? 0 : 1;
  const halo = Math.pow(cosS, 12) * (0.25 + 0.65 * disc) + Math.pow(cosS, 200) * 6 * disc + Math.pow(cosS, 3) * 0.15;
  const sunCol = new Color(1, 0.85, 0.65).lerp(new Color(1, 0.55, 0.25), golden);
  out.add(sunCol.multiplyScalar(halo * day * (1 + k.haze)));
  let L = 0.5 * (0.25 + 0.75 * day);
  // Nubes en una capa plana: densidad por ruido, iluminadas por el sol.
  if (d.y > 0.01 && k.clouds > 0.01) {
    const s = 0.12 / d.y;
    const n = sampleClouds(d.x * s + 0.31, d.z * s + 0.77);
    const cover = MathUtils.smoothstep(n, 0.62 - k.clouds * 0.35, 0.8 - k.clouds * 0.25) * MathUtils.smoothstep(d.y, 0.01, 0.12);
    const lit = new Color(1, 1, 1).lerp(new Color(1, 0.75, 0.55), golden * 0.7).multiplyScalar(0.55 + 0.6 * day + 0.6 * Math.pow(cosS, 6));
    const shadowed = new Color(0.55, 0.58, 0.64).multiplyScalar(0.4 + 0.6 * day);
    out.lerp(lit.lerp(shadowed, n * 0.6), cover * 0.92);
    L *= 1 - 0.25 * k.clouds * cover;
  }
  // Bajo el horizonte: suelo lejano neutro (el terreno modelado tapa casi todo).
  if (d.y < 0) out.copy(hor).multiplyScalar(0.35).lerp(new Color(0.18, 0.2, 0.16).multiplyScalar(day + 0.05), Math.min(1, -d.y * 6));
  return out.multiplyScalar(L);
}

export function makeSky(k: SkyInput, w = 1024, h = 512): ProceduralEquirectTexture {
  const t = new ProceduralEquirectTexture(w, h);
  const dir = new Vector3();
  t.generationCallback = (polar, _uv, _coord, color) => {
    dir.setFromSpherical(polar);
    skyRadiance(dir, k, color);
  };
  t.update();
  return t;
}
