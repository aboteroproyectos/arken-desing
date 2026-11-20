// Texturas procedurales de materiales (sin archivos externos): se dibujan en un canvas con ruido
// determinista, así cada render sale igual y la app sigue funcionando sin conexión.

import { CanvasTexture, Color, RepeatWrapping, SRGBColorSpace, type Texture } from "three";

/** Generador pseudoaleatorio con semilla (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ruido de valor 2D periódico (para texturas que se repiten sin costura). */
function valueNoise(size: number, cells: number, seed: number): Float32Array {
  const r = rng(seed);
  const g = new Float32Array(cells * cells).map(() => r());
  const out = new Float32Array(size * size);
  const sm = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = sm(fx - x0);
      const ty = sm(fy - y0);
      const at = (i: number, j: number) => g[((j % cells) * cells + (i % cells)) | 0]!;
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
      out[y * size + x] = a + (b - a) * ty;
    }
  return out;
}
function fbm(size: number, seed: number, octaves = 5, base = 4): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(size, base << o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i]! += n[i]! * amp;
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i]! /= norm;
  return out;
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!];
}
function tex(c: HTMLCanvasElement, srgb = true): Texture {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = SRGBColorSpace;
  return t;
}
/** Aplica ruido de luminancia sobre un canvas (variación natural del material). */
function grain(ctx: CanvasRenderingContext2D, size: number, amount: number, seed: number, scale = 4): void {
  const img = ctx.getImageData(0, 0, size, size);
  const n = fbm(size, seed, 5, scale);
  for (let i = 0; i < size * size; i++) {
    const k = 1 + (n[i]! - 0.5) * amount;
    img.data[i * 4] = Math.min(255, img.data[i * 4]! * k);
    img.data[i * 4 + 1] = Math.min(255, img.data[i * 4 + 1]! * k);
    img.data[i * 4 + 2] = Math.min(255, img.data[i * 4 + 2]! * k);
  }
  ctx.putImageData(img, 0, 0);
}
const hex = (c: Color) => `#${c.getHexString()}`;
const shade = (base: string, k: number) => hex(new Color(base).multiplyScalar(k));

/** Cada textura cubre `tile` metros (la geometría trae UV en metros). */
export interface TexSpec {
  readonly map: Texture;
  readonly rough?: Texture;
  readonly tile: number;
}
const cache = new Map<string, TexSpec>();
function memo(key: string, make: () => TexSpec): TexSpec {
  let t = cache.get(key);
  if (!t) cache.set(key, (t = make()));
  return t;
}

export function plasterTex(color: string): TexSpec {
  return memo(`estuco${color}`, () => {
    const [c, x] = canvas(512);
    x.fillStyle = color;
    x.fillRect(0, 0, 512, 512);
    grain(x, 512, 0.09, 11, 8);
    return { map: tex(c), tile: 2 };
  });
}

export function brickTex(color: string): TexSpec {
  return memo(`ladrillo${color}`, () => {
    const [c, x] = canvas(512);
    // Ladrillo tolete 24 × 6 cm con junta de 1 cm: 2 × 8 hiladas en 1.0 m de alto × 1.0 m.
    x.fillStyle = "#b8b0a2";
    x.fillRect(0, 0, 512, 512);
    const r = rng(7);
    const rows = 14;
    const h = 512 / rows;
    for (let j = 0; j < rows; j++) {
      const off = j % 2 ? 0.5 : 0;
      for (let i = -1; i < 5; i++) {
        const k = 0.82 + r() * 0.32;
        x.fillStyle = shade(color, k);
        x.fillRect((i + off) * 128 + 2.5, j * h + 2.5, 123, h - 5);
      }
    }
    grain(x, 512, 0.22, 3, 16);
    return { map: tex(c), tile: 1.0 };
  });
}

export function concreteTex(color: string): TexSpec {
  return memo(`concreto${color}`, () => {
    const [c, x] = canvas(512);
    x.fillStyle = color;
    x.fillRect(0, 0, 512, 512);
    grain(x, 512, 0.16, 21, 6);
    // Concreto a la vista con formaleta de tablas: líneas cada 15 cm y orificios de tensores.
    x.strokeStyle = "rgba(0,0,0,0.10)";
    x.lineWidth = 1.5;
    for (let y = 0; y < 512; y += 512 / 8) (x.beginPath(), x.moveTo(0, y), x.lineTo(512, y), x.stroke());
    x.fillStyle = "rgba(0,0,0,0.25)";
    for (const [px, py] of [[64, 96], [320, 96], [64, 352], [320, 352]]) (x.beginPath(), x.arc(px!, py!, 3, 0, 7), x.fill());
    return { map: tex(c), tile: 1.2 };
  });
}

export function stoneTex(color: string): TexSpec {
  return memo(`piedra${color}`, () => {
    const [c, x] = canvas(512);
    x.fillStyle = shade(color, 0.55);
    x.fillRect(0, 0, 512, 512);
    // Piedra laja en hiladas irregulares.
    const r = rng(5);
    let y = 0;
    while (y < 512) {
      const h = 24 + r() * 26;
      let px = -r() * 60;
      while (px < 512) {
        const w = 50 + r() * 90;
        x.fillStyle = shade(color, 0.75 + r() * 0.45);
        x.fillRect(px + 2, y + 2, w - 4, h - 4);
        px += w;
      }
      y += h;
    }
    grain(x, 512, 0.3, 9, 16);
    return { map: tex(c), tile: 1.4 };
  });
}

export function woodTex(color: string, planks = true): TexSpec {
  return memo(`madera${color}${planks}`, () => {
    const [c, x] = canvas(512);
    x.fillStyle = color;
    x.fillRect(0, 0, 512, 512);
    // Vetas: ruido estirado a lo largo.
    const img = x.getImageData(0, 0, 512, 512);
    const n = fbm(512, 41, 5, 4);
    for (let yy = 0; yy < 512; yy++)
      for (let xx = 0; xx < 512; xx++) {
        const v = n[((yy * 7) % 512) * 512 + ((xx >> 3) % 512)]!;
        const k = 0.85 + 0.3 * (0.5 + 0.5 * Math.sin(v * 40 + xx * 0.02));
        const i = (yy * 512 + xx) * 4;
        img.data[i] = Math.min(255, img.data[i]! * k);
        img.data[i + 1] = Math.min(255, img.data[i + 1]! * k);
        img.data[i + 2] = Math.min(255, img.data[i + 2]! * k);
      }
    x.putImageData(img, 0, 0);
    if (planks) {
      const r = rng(13);
      x.fillStyle = "rgba(0,0,0,0.35)";
      for (let yy = 0; yy < 512; yy += 512 / 6) {
        x.fillRect(0, yy, 512, 2);
        x.fillRect(r() * 512, yy, 2, 512 / 6);
      }
    }
    return { map: tex(c), tile: planks ? 1.2 : 0.8 };
  });
}

/** Lámina de cubierta (junta alzada cada 50 cm) o teja de barro. */
export function roofTex(kind: string, color: string): TexSpec {
  return memo(`cub${kind}${color}`, () => {
    const [c, x] = canvas(512);
    x.fillStyle = color;
    x.fillRect(0, 0, 512, 512);
    if (kind === "teja") {
      const rows = 12;
      const h = 512 / rows;
      const r = rng(3);
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < 10; i++) {
          const g = x.createLinearGradient(i * 51.2, 0, i * 51.2 + 51.2, 0);
          const k = 0.8 + r() * 0.35;
          g.addColorStop(0, shade(color, 0.6 * k));
          g.addColorStop(0.5, shade(color, 1.15 * k));
          g.addColorStop(1, shade(color, 0.6 * k));
          x.fillStyle = g;
          x.fillRect(i * 51.2, j * h, 51.2, h - 3);
        }
      grain(x, 512, 0.2, 31, 16);
      return { map: tex(c), tile: 2.4 };
    }
    if (kind === "losa") {
      grain(x, 512, 0.12, 37, 8);
      return { map: tex(c), tile: 3 };
    }
    // Lámina con junta alzada: 4 juntas por metro de textura (0.5 m entre juntas en 2 m).
    for (let i = 0; i < 4; i++) {
      const g = x.createLinearGradient(i * 128, 0, i * 128 + 10, 0);
      g.addColorStop(0, shade(color, 1.35));
      g.addColorStop(1, shade(color, 0.7));
      x.fillStyle = g;
      x.fillRect(i * 128, 0, 10, 512);
    }
    grain(x, 512, 0.05, 33, 4);
    return { map: tex(c), tile: 2 };
  });
}

export function grassTex(): TexSpec {
  return memo("cesped", () => {
    const N = 1024;
    const [c, x] = canvas(N);
    const img = x.createImageData(N, N);
    const big = fbm(N, 51, 4, 2); // manchas grandes: zonas más secas o más verdes
    const mid = fbm(N, 77, 4, 16); // matas
    const r = rng(5);
    for (let i = 0; i < N * N; i++) {
      const a = big[i]!, b = mid[i]!;
      const blade = 0.78 + r() * 0.44; // hojas individuales
      const dry = Math.max(0, a - 0.55) * 1.6; // pasto amarillento
      const k = (0.72 + 0.45 * b) * blade;
      img.data[i * 4] = Math.min(255, (70 + dry * 70 + a * 18) * k);
      img.data[i * 4 + 1] = Math.min(255, (98 + dry * 30 + a * 22) * k);
      img.data[i * 4 + 2] = Math.min(255, (44 + dry * 10) * k);
      img.data[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return { map: tex(c), tile: 9 };
  });
}

export function paverTex(color = "#9c958a"): TexSpec {
  return memo(`adoquin${color}`, () => {
    const [c, x] = canvas(512);
    x.fillStyle = "#5f5b55";
    x.fillRect(0, 0, 512, 512);
    const r = rng(17);
    for (let j = 0; j < 8; j++)
      for (let i = 0; i < 4; i++) {
        x.fillStyle = shade(color, 0.85 + r() * 0.3);
        x.fillRect(i * 128 + (j % 2 ? 64 : 0) + 2, j * 64 + 2, 124, 60);
        if (j % 2 && i === 3) x.fillRect(2, j * 64 + 2, 60, 60);
      }
    grain(x, 512, 0.18, 19, 16);
    return { map: tex(c), tile: 1.6 };
  });
}

export function tileTex(color: string, size: number): TexSpec {
  return memo(`piso${color}${size}`, () => {
    const [c, x] = canvas(512);
    x.fillStyle = shade(color, 0.86);
    x.fillRect(0, 0, 512, 512);
    x.fillStyle = color;
    x.fillRect(1, 1, 510, 254);
    x.fillRect(1, 257, 510, 254);
    grain(x, 512, 0.06, 23, 6);
    return { map: tex(c), tile: size };
  });
}

/** Mármol blanco con vetas grises. */
export function marbleTex(): TexSpec {
  return memo("marmol", () => {
    const [c, x] = canvas(512);
    const img = x.createImageData(512, 512);
    const n = fbm(512, 61, 6, 3);
    for (let yy = 0; yy < 512; yy++)
      for (let xx = 0; xx < 512; xx++) {
        const i = yy * 512 + xx;
        const v = Math.abs(Math.sin((xx + yy) * 0.012 + n[i]! * 9));
        const k = 236 - Math.pow(1 - v, 18) * 90;
        img.data[i * 4] = k;
        img.data[i * 4 + 1] = k;
        img.data[i * 4 + 2] = k + 2;
        img.data[i * 4 + 3] = 255;
      }
    x.putImageData(img, 0, 0);
    return { map: tex(c), tile: 1.2 };
  });
}
