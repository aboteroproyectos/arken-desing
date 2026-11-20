// Modelo 3D para render a partir del modelo BIM: muros con sus vanos, vidrios con marcos, puertas,
// pisos con su acabado, cielos, cubiertas según tipo y pendiente, parqueadero, terrazas, mobiliario
// y paisajismo. Todo sale de las entidades del modelo; nada se inventa salvo el entorno (árboles).
//
// Coordenadas: el plano (x, y) y la altura z del modelo pasan a three.js como (x, z, −y): el norte
// del proyecto (+y) queda hacia −Z.

import { getOfKind, type Device, type Door, type Entity, type Level, type ModelReader, type Opening, type Project, type Space, type Vec2, type Wall, type Window } from "@arken/core";
import { buildWallFrame } from "@arken/geometry";
import { Box3, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, ShapeUtils, Vector2, Vector3, type Material } from "three";
import { brickTex, concreteTex, grassTex, marbleTex, paverTex, plasterTex, rng, roofTex, stoneTex, tileTex, woodTex, type TexSpec } from "./textures";

export interface SceneOptions {
  wallColor: string;
  roofColor: string;
  accentColor: string;
  frameColor: string;
  glass: "claro" | "gris" | "bronce" | "verde";
  trees: 0 | 1 | 2;
  shrubs: boolean;
  furniture: boolean;
  interiorLights: boolean;
  ground: "cesped" | "grava";
}

export interface HouseInfo {
  /** Caja de la casa (sin entorno), en coordenadas de three.js. */
  readonly box: Box3;
  readonly front: Vector3;
  /** Dirección horizontal hacia la que mira la fachada principal (sale por la puerta principal). */
  readonly frontDir: Vector3;
  readonly door?: Vector3;
  /** Punto dentro de la zona social y hacia dónde mirar (ventanal principal). */
  readonly interior?: { eye: Vector3; look: Vector3 };
  readonly styleName: string;
  readonly defaults: Pick<SceneOptions, "wallColor" | "roofColor" | "accentColor" | "frameColor">;
}

type P3 = [number, number, number]; // en coordenadas del plano: x, y, z
const W = (p: P3): Vector3 => new Vector3(p[0], p[2], -p[1]);

/** Acumulador de triángulos de un material, con normales planas y UV en metros (proyección plana). */
class Acc {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  constructor(readonly tile = 1) {}
  tri(a: Vector3, b: Vector3, c: Vector3, hint?: Vector3): void {
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-12) return;
    n.normalize();
    if (hint && n.dot(hint) < 0) {
      [b, c] = [c, b];
      n.negate();
    }
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (const p of [a, b, c]) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      const [u, v] = ay >= ax && ay >= az ? [p.x, p.z] : ax >= az ? [p.z, p.y] : [p.x, p.y];
      this.uv.push(u / this.tile, v / this.tile);
    }
  }
  /** Polígono convexo (abanico). */
  poly(pts: Vector3[], hint?: Vector3): void {
    for (let i = 1; i + 1 < pts.length; i++) this.tri(pts[0]!, pts[i]!, pts[i + 1]!, hint);
  }
  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

/** Caja orientada: 4 esquinas en planta (en orden) entre z0 y z1; `face(i)` elige el acumulador de cada lado. */
function boxPlan(corners: Vec2[], z0: number, z1: number, side: (i: number) => Acc, cap: Acc): void {
  const c = corners.reduce((s, p) => ({ x: s.x + p.x / corners.length, y: s.y + p.y / corners.length }), { x: 0, y: 0 });
  const mid = W([c.x, c.y, (z0 + z1) / 2]);
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!, b = corners[(i + 1) % corners.length]!;
    const q = [W([a.x, a.y, z0]), W([b.x, b.y, z0]), W([b.x, b.y, z1]), W([a.x, a.y, z1])];
    const fc = W([(a.x + b.x) / 2, (a.y + b.y) / 2, (z0 + z1) / 2]);
    side(i).poly(q, fc.sub(mid));
  }
  cap.poly(corners.map((p) => W([p.x, p.y, z1])), new Vector3(0, 1, 0));
  cap.poly(corners.map((p) => W([p.x, p.y, z0])), new Vector3(0, -1, 0));
}
/** Prisma vertical de un polígono simple cualquiera (pisos, cielos). */
function prism(poly: Vec2[], z0: number, z1: number, top: Acc, sides: Acc): void {
  const pts = poly.map((p) => new Vector2(p.x, p.y));
  if (ShapeUtils.isClockWise(pts)) pts.reverse();
  const tris = ShapeUtils.triangulateShape(pts, []);
  for (const [a, b, c] of tris) {
    top.tri(W([pts[a!]!.x, pts[a!]!.y, z1]), W([pts[b!]!.x, pts[b!]!.y, z1]), W([pts[c!]!.x, pts[c!]!.y, z1]), new Vector3(0, 1, 0));
    sides.tri(W([pts[a!]!.x, pts[a!]!.y, z0]), W([pts[b!]!.x, pts[b!]!.y, z0]), W([pts[c!]!.x, pts[c!]!.y, z0]), new Vector3(0, -1, 0));
  }
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const hint = new Vector3((a.x + b.x) / 2 - cx, 0, -((a.y + b.y) / 2 - cy));
    sides.poly([W([a.x, a.y, z0]), W([b.x, b.y, z0]), W([b.x, b.y, z1]), W([a.x, a.y, z1])], hint);
  }
}
/** Caja alineada a los ejes, en coordenadas del plano. */
function aabb(acc: Acc, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, top = acc): void {
  boxPlan([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], z0, z1, () => acc, top);
}

// ─── Lectura de propiedades ─────────────────────────────────
type Props = Record<string, unknown>;
const num = (p: Props, k: string, d: number) => (typeof p[k] === "number" && Number.isFinite(p[k]) ? (p[k] as number) : d);
const str = (p: Props, k: string, d: string) => (typeof p[k] === "string" && p[k] ? (p[k] as string) : d);

interface Vol { x0: number; y0: number; x1: number; y1: number; floors: number; type: string; high: "S" | "N" | "E" | "W"; galeria: boolean }

function volumesOf(pr: Props, walls: { a: Vec2; b: Vec2 }[], floors: number): Vol[] {
  const pend = num(pr, "cubierta_pendiente_pct", 0);
  const type = str(pr, "cubierta_tipo", pend > 2 ? "una-agua" : "plana");
  try {
    const raw = JSON.parse(str(pr, "volumenes", "")) as Partial<Vol>[];
    if (Array.isArray(raw) && raw.length)
      return raw.map((r) => ({ x0: r.x0 ?? 0, y0: r.y0 ?? 0, x1: r.x1 ?? 1, y1: r.y1 ?? 1, floors: r.floors ?? 1, type: r.galeria ? "plana" : r.type ?? type, high: r.high ?? "W", galeria: !!r.galeria }));
  } catch {
    /* una sola barra */
  }
  if (typeof pr["casa_xmax"] === "number")
    return [{ x0: num(pr, "casa_xmin", 0), y0: num(pr, "casa_ymin", 0), x1: num(pr, "casa_xmax", 12), y1: num(pr, "casa_ymax", 15), floors: num(pr, "pisos", floors), type, high: "W", galeria: false }];
  // Sin datos de volumen: caja de los muros de fachada.
  const xs = walls.flatMap((w) => [w.a.x, w.b.x]);
  const ys = walls.flatMap((w) => [w.a.y, w.b.y]);
  return [{ x0: Math.min(...xs) - 0.1, y0: Math.min(...ys) - 0.1, x1: Math.max(...xs) + 0.1, y1: Math.max(...ys) + 0.1, floors, type, high: "W", galeria: false }];
}

const GLASS_TINT: Record<SceneOptions["glass"], string> = { claro: "#e9f3f2", gris: "#b9c0c2", bronce: "#d6c2a6", verde: "#cfe6da" };

export function styleDefaults(reader: ModelReader): HouseInfo["defaults"] & { name: string } {
  const pr = ([...reader.entities()].find((e): e is Project => e.kind === "Project")?.properties ?? {}) as Props;
  return {
    name: str(pr, "estilo_nombre", "Diseño a medida"),
    wallColor: str(pr, "estilo_muro_color", "#efebe3"),
    roofColor: str(pr, "estilo_cubierta_color", "#45494d"),
    accentColor: str(pr, "estilo_acento_color", "#8a5a36"),
    frameColor: str(pr, "estilo_marco_color", "#26292c"),
  };
}

export function buildHouse(reader: ModelReader, o: SceneOptions): { group: Group; info: HouseInfo; lights: Mesh[] } {
  const ents = [...reader.entities()] as Entity[];
  const project = ents.find((e): e is Project => e.kind === "Project");
  const pr = (project?.properties ?? {}) as Props;
  const levels = ents.filter((e): e is Level => e.kind === "Level").sort((a, b) => a.elevation - b.elevation);
  const floorsLv = levels.filter((l) => !/cubierta/i.test(l.name ?? ""));
  const elevOf = (id: string) => {
    const lid = reader.indices.levelOfElement(id);
    return levels.find((l) => l.id === lid)?.elevation ?? 0;
  };
  const isGround = (id: string) => elevOf(id) <= (floorsLv[0]?.elevation ?? 0) + 0.01;
  const fh = num(pr, "altura_piso_m", floorsLv[1] ? floorsLv[1].elevation - floorsLv[0]!.elevation : 3);
  const wallKind = str(pr, "estilo_muro", "estuco");
  const accentKind = str(pr, "estilo_acento", "madera");
  const baseKind = str(pr, "estilo_base", "piedra");
  const roofMat = str(pr, "estilo_cubierta_material", "lamina");
  const slope = num(pr, "cubierta_pendiente_pct", 30) / 100;
  const eave = num(pr, "cubierta_alero_m", 0.9);
  const roofT = num(pr, "cubierta_espesor_m", 0.25);

  // ─── Materiales ───────────────────────────────────────────
  const accs = new Map<string, { acc: Acc; mat: Material }>();
  const use = (key: string, make: () => { mat: Material; tile?: number }): Acc => {
    let e = accs.get(key);
    if (!e) {
      const m = make();
      e = { acc: new Acc(m.tile ?? 1), mat: m.mat };
      accs.set(key, e);
    }
    return e.acc;
  };
  const std = (color: string, rough: number, t?: TexSpec, extra: Partial<MeshPhysicalMaterial> = {}) => {
    const mat = new MeshPhysicalMaterial({ color: t ? "#ffffff" : color, roughness: rough, metalness: 0, side: DoubleSide, ...(t ? { map: t.map } : {}) });
    Object.assign(mat, extra);
    return { mat, tile: t?.tile ?? 1 };
  };
  const finishTex = (kind: string, color: string): TexSpec =>
    kind === "ladrillo" ? brickTex(color) : kind === "concreto" ? concreteTex(color) : kind === "piedra" ? stoneTex(color) : kind === "madera" || kind === "celosia" ? woodTex(color) : plasterTex(color);
  const facadeColor = o.wallColor;
  const M = {
    ext: () => use("ext", () => std(facadeColor, wallKind === "ladrillo" ? 0.9 : 0.85, finishTex(wallKind, facadeColor))),
    int: () => use("int", () => std("#f4f1ec", 0.9, plasterTex("#f4f1ec"))),
    accent: () => use("accent", () => std(o.accentColor, accentKind === "madera" || accentKind === "celosia" ? 0.6 : 0.85, finishTex(accentKind, o.accentColor), accentKind === "madera" || accentKind === "celosia" ? { clearcoat: 0.15, clearcoatRoughness: 0.5 } : {})),
    base: () => use("base", () => std("#8b857b", 0.9, finishTex(baseKind === "estuco" ? "concreto" : baseKind, baseKind === "ladrillo" ? facadeColor : baseKind === "concreto" ? "#a19f99" : "#9a948a"))),
    roof: () => use("roof", () => (roofMat === "lamina" ? std(o.roofColor, 0.42, roofTex("lamina", o.roofColor), { metalness: 0.55 }) : std(o.roofColor, roofMat === "teja" ? 0.75 : 0.9, roofTex(roofMat, o.roofColor)))),
    soffit: () => use("soffit", () => (accentKind === "madera" || accentKind === "celosia" ? std(o.accentColor, 0.65, woodTex(o.accentColor)) : std("#f2f0ec", 0.9))),
    slab: () => use("slab", () => std("#e9e6e0", 0.9, concreteTex("#d9d6cf"))),
    ceiling: () => use("ceiling", () => std("#f7f6f3", 0.95)),
    frame: () => use("frame", () => std(o.frameColor, 0.35, undefined, { metalness: 0.6 })),
    glass: () =>
      use("glass", () => ({
        mat: new MeshPhysicalMaterial({ color: GLASS_TINT[o.glass], metalness: 0, roughness: 0.02, transmission: 1, thickness: 0.012, ior: 1.52, side: DoubleSide, transparent: true, opacity: 1, specularIntensity: 1 }),
      })),
    doorWood: () => use("doorWood", () => std("#7a4a2a", 0.5, woodTex("#7a4a2a", false), { clearcoat: 0.3, clearcoatRoughness: 0.4 })),
    lacquer: () => use("lacquer", () => std("#f3f1ed", 0.35, undefined, { clearcoat: 0.4 })),
    steel: () => use("steel", () => std("#9ea3a8", 0.3, undefined, { metalness: 0.9 })),
    deck: () => use("deck", () => std("#8a5e3c", 0.7, woodTex("#8a5e3c"))),
    paver: () => use("paver", () => std("#9c958a", 0.9, paverTex())),
    stone: () => use("stone", () => std("#a39d92", 0.85, stoneTex("#b2aca1"))),
    grass: () => use("grass", () => std("#5f7d3d", 0.95, grassTex())),
    gravel: () => use("gravel", () => std("#b7afa2", 0.95, stoneTex("#c9c2b6"))),
    fabric: () => use("fabric", () => std("#c9c1b4", 0.95)),
    linen: () => use("linen", () => std("#f1efea", 0.95)),
    darkWood: () => use("darkWood", () => std("#5a3c27", 0.55, woodTex("#5a3c27", false))),
    oak: () => use("oak", () => std("#b48a5e", 0.55, woodTex("#b48a5e", false))),
    marble: () => use("marble", () => std("#ffffff", 0.18, marbleTex(), { clearcoat: 0.5, clearcoatRoughness: 0.1 })),
    ceramic: () => use("ceramic", () => std("#fbfbfa", 0.12, undefined, { clearcoat: 0.6 })),
    trunk: () => use("trunk", () => std("#5d4a3a", 0.95)),
    leaf: (k: number) => use(`leaf${k}`, () => std(["#3a5a2b", "#46642f", "#2f4a26", "#56703a", "#3d5530", "#4f6a2c"][k % 6]!, 0.8)),
    lamp: () =>
      use("lamp", () => ({ mat: new MeshStandardMaterial({ color: "#fff4e0", emissive: new Color("#ffd7a0"), emissiveIntensity: o.interiorLights ? 6 : 0, side: DoubleSide }) })),
  };
  const floorMat = (sp: Space): Acc => {
    const p = (sp.properties ?? {}) as Props;
    const f = `${str(p, "piso", "")} ${str(p, "acabado_piso", "")}`.toLowerCase();
    const name = (sp.name ?? "").toLowerCase();
    if (p["exterior"] === true || /parqueadero|terraza|corredor|deck|bbq|patio/.test(name)) return /parqueadero|acceso vehicular/.test(name) ? M.paver() : /terraza|deck|corredor|bbq/.test(name) || /deck|teca|madera/.test(f) ? M.deck() : M.stone();
    if (/roble|madera|ingenier|parquet/.test(f)) return use("floorOak", () => std("#b38b5d", 0.5, woodTex("#b38b5d"), { clearcoat: 0.2 }));
    if (/m[áa]rmol/.test(f)) return M.marble();
    if (/piedra|travertino/.test(f)) return M.stone();
    if (/huella|escalera/.test(f)) return M.oak();
    const size = /120|60×120|120×60/.test(f) ? 1.2 : 0.6;
    return use(`tile${size}`, () => std("#d9d2c6", 0.3, tileTex("#ddd6ca", size), { clearcoat: 0.25, clearcoatRoughness: 0.2 }));
  };

  // ─── Muros, vanos, puertas y ventanas ──────────────────────
  const walls = ents.filter((e): e is Wall => e.kind === "Wall");
  const doors = ents.filter((e): e is Door => e.kind === "Door");
  const mainDoor = doors.find((d) => /principal/i.test(d.name ?? "") && !/habitaci|baño|alcoba/i.test(d.name ?? "")) ?? doors[0];
  const mainOpening = mainDoor ? [...(reader.indices.openingsOfFilling(mainDoor.id) ?? [])][0] : undefined;
  const mainHost = mainOpening ? reader.indices.hostOfOpening(mainOpening) : undefined;
  let doorPos: Vector3 | undefined;
  let frontNormal: Vector3 | undefined;
  const facadeWalls: { a: Vec2; b: Vec2 }[] = [];
  // Bajo una cubierta inclinada los muros terminan en el alero: lo de arriba lo cierran las culatas y
  // los tímpanos de la cubierta (si no, un muro recto atravesaría el faldón en el lado bajo).
  const vols = volumesOf(pr, walls.filter((w) => typeof w.properties?.["fachada"] === "string").map((w) => ({ a: w.start, b: w.end })), floorsLv.length || 1);
  const z00 = floorsLv[0]?.elevation ?? 0;
  const capOf = (w: Wall, z0w: number): number => {
    let cap = -Infinity;
    for (const v of vols) {
      if (v.galeria) continue;
      const inside = [w.start, w.end].every((p) => p.x >= v.x0 - 0.35 && p.x <= v.x1 + 0.35 && p.y >= v.y0 - 0.35 && p.y <= v.y1 + 0.35);
      if (!inside) continue;
      const H = z00 + v.floors * fh;
      if (z0w > H - 0.5) continue;
      cap = Math.max(cap, v.type === "plana" ? Infinity : H);
    }
    return cap === -Infinity ? Infinity : cap;
  };
  for (const wall of walls) {
    const f = buildWallFrame(reader, wall);
    if (f.thickness <= 0 || f.length < 0.01) continue;
    const z0w = elevOf(wall.id) + wall.baseOffset;
    const ground = isGround(wall.id);
    const zb = ground ? z0w - 0.15 : z0w;
    const zt = Math.min(z0w + wall.height, capOf(wall, z0w));
    const facade = typeof wall.properties?.["fachada"] === "string";
    if (facade) facadeWalls.push({ a: wall.start, b: wall.end });
    const extAcc = facade ? (wall.id === mainHost && accentKind !== "estuco" ? M.accent() : M.ext()) : M.int();
    const intAcc = M.int();
    const ops = [...(reader.indices.openingsOfHost(wall.id) ?? [])].map((id) => getOfKind(reader, id, "Opening")).filter((x): x is Opening => !!x).sort((a, b) => a.offsetAlongAxis - b.offsetAlongAxis);
    const half = f.thickness / 2;
    const at = (u: number, n: number): Vec2 => ({ x: f.origin.x + f.u.x * u + f.n.x * n, y: f.origin.y + f.u.y * u + f.n.y * n });
    const piece = (u0: number, u1: number, z0: number, z1: number, plinth: boolean) => {
      if (u1 - u0 < 0.005 || z1 - z0 < 0.005) return;
      const c = [at(u0, f.faceInt), at(u1, f.faceInt), at(u1, f.faceExt), at(u0, f.faceExt)];
      // Lados: 0 interior, 1 extremo final, 2 exterior, 3 extremo inicial.
      boxPlan(c, z0, z1, (i) => (i === 2 ? extAcc : i === 0 ? intAcc : facade ? M.ext() : intAcc), facade ? M.ext() : intAcc);
      if (plinth && facade && ground && baseKind !== wallKind) {
        const zt2 = Math.min(z1, z0w + 0.6);
        if (zt2 > z0 + 0.05) boxPlan([at(u0, f.faceExt), at(u1, f.faceExt), at(u1, f.faceExt + 0.025), at(u0, f.faceExt + 0.025)], z0, zt2, () => M.base(), M.base());
      }
    };
    let u = -half;
    const uEnd = f.length + half;
    for (const op of ops) {
      const a = Math.max(-half, op.offsetAlongAxis);
      const b = Math.min(uEnd, op.offsetAlongAxis + op.width);
      piece(u, a, zb, zt, true);
      const s0 = z0w + op.sillHeight;
      const s1 = Math.min(zt, s0 + op.height);
      piece(a, b, zb, s0, op.sillHeight > 0.05);
      piece(a, b, s1, zt, false);
      u = b;
      // Relleno del vano
      const fid = reader.indices.fillingOfOpening(op.id);
      const fill = fid ? reader.getEntity(fid) : undefined;
      const nMid = facade ? f.faceExt - Math.min(0.08, f.thickness * 0.3) : (f.faceExt + f.faceInt) / 2;
      if (fill?.kind === "Window") glazing(a, b, s0, s1, nMid, (fill as Window).operation, false);
      else if (fill?.kind === "Door") {
        const d = fill as Door;
        const nm = (d.name ?? "").toLowerCase();
        const glazed = /aluminio|vidrio|ventanal|plegable|acristalad/.test(nm) || (d.operation === "sliding" && facade && op.width > 1.6);
        if (glazed) glazing(a, b, s0, s1, nMid, "sliding", true);
        else {
          const leaf = d.id === mainDoor?.id ? M.doorWood() : /roble|madera/.test(nm) && !/lacad/.test(nm) ? M.oak() : /lámina|rejilla|met[áa]lica/.test(nm) ? M.steel() : M.lacquer();
          const n0 = (f.faceExt + f.faceInt) / 2 - 0.025;
          boxPlan([at(a + 0.01, n0), at(b - 0.01, n0), at(b - 0.01, n0 + 0.05), at(a + 0.01, n0 + 0.05)], s0, s1 - 0.005, () => leaf, leaf);
          // Manija
          const hu = d.swingSide === "left" ? b - 0.12 : a + 0.12;
          boxPlan([at(hu - 0.01, n0 - 0.06), at(hu + 0.01, n0 - 0.06), at(hu + 0.01, n0 + 0.11), at(hu - 0.01, n0 + 0.11)], s0 + 1.0, s0 + (d.id === mainDoor?.id ? 1.8 : 1.05), () => M.steel(), M.steel());
          if (d.id === mainDoor?.id) {
            const c = at((a + b) / 2, f.faceExt + 1.5);
            doorPos = W([c.x, c.y, s0 + 1.4]);
            const nn = W([f.n.x, f.n.y, 0]);
            frontNormal = nn.normalize();
          }
        }
      }
    }
    piece(u, uEnd, zb, zt, true);

    function glazing(a: number, b: number, s0: number, s1: number, n: number, op: string, isDoor: boolean): void {
      const fw = 0.05; // ancho de perfil
      const fd = 0.07; // fondo del perfil
      const box = (u0: number, u1: number, z0: number, z1: number, n0: number, n1: number, acc: Acc) => boxPlan([at(u0, n0), at(u1, n0), at(u1, n1), at(u0, n1)], z0, z1, () => acc, acc);
      const n0 = n - fd / 2, n1 = n + fd / 2;
      box(a, b, s1 - fw, s1, n0, n1, M.frame());
      box(a, b, s0, s0 + (isDoor ? 0.03 : fw), n0, n1, M.frame());
      box(a, a + fw, s0, s1, n0, n1, M.frame());
      box(b - fw, b, s0, s1, n0, n1, M.frame());
      const w = b - a;
      const parts = Math.max(1, Math.round(w / (op === "fixed" ? 1.8 : 1.2)));
      for (let k = 1; k < parts; k++) {
        const um = a + (w * k) / parts;
        box(um - fw / 2, um + fw / 2, s0, s1, n0, n1, M.frame());
      }
      box(a + fw, b - fw, s0 + fw, s1 - fw, n - 0.006, n + 0.006, M.glass());
    }
  }

  // ─── Pisos, losas, cielos y luces ──────────────────────────
  const lights: Mesh[] = [];
  const spaces = ents.filter((e): e is Space => e.kind === "Space" && e.boundary.length >= 3);
  let living: Space | undefined;
  let livingArea = 0;
  for (const sp of spaces) {
    const z = elevOf(sp.id);
    const ext = sp.properties?.["exterior"] === true || /parqueadero|terraza y corredor/i.test(sp.name ?? "");
    const fm = floorMat(sp);
    if (ext) prism(sp.boundary as Vec2[], z - 0.16, z - (/parqueadero/i.test(sp.name ?? "") ? 0.13 : 0.02), fm, M.slab());
    else {
      prism(sp.boundary as Vec2[], z - 0.03, z, fm, M.slab());
      if (z > (floorsLv[0]?.elevation ?? 0) + 0.01) prism(sp.boundary as Vec2[], z - 0.3, z - 0.03, M.slab(), M.slab());
      else prism(sp.boundary as Vec2[], z - 0.16, z - 0.03, M.slab(), M.slab());
      const ch = Math.min(2.7, fh - 0.3);
      if (!/escalera|vac[íi]o|doble altura/i.test(sp.name ?? "")) prism(sp.boundary as Vec2[], z + ch, z + ch + 0.02, M.ceiling(), M.ceiling());
      // Luminaria: panel cálido en el cielo (solo se ve encendido si se pide).
      const xs = sp.boundary.map((p) => p.x), ys = sp.boundary.map((p) => p.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const r = Math.min(0.35, (Math.max(...xs) - Math.min(...xs)) / 6, (Math.max(...ys) - Math.min(...ys)) / 6);
      if (o.interiorLights && r > 0.05) aabb(M.lamp(), cx - r, cy - r, cx + r, cy + r, z + ch - 0.03, z + ch - 0.005);
      const area = Math.abs(ShapeUtils.area(sp.boundary.map((p) => new Vector2(p.x, p.y))));
      if (/^(sala|estar|sala-comedor)/i.test(sp.name ?? "") && z <= (floorsLv[0]?.elevation ?? 0) + 0.01 && area > livingArea) (living = sp), (livingArea = area);
    }
  }

  // ─── Cubiertas ─────────────────────────────────────────────
  for (const v of vols) roof(v);
  function roof(v: Vol): void {
    const H = z00 + v.floors * fh;
    const R = M.roof();
    const S = M.soffit();
    const solid = (top: P3[], t: number) => {
      // Superficie superior, inferior (cielo del alero) y canto.
      R.poly(top.map((p) => W(p)), new Vector3(0, 1, 0));
      S.poly(top.map((p) => W([p[0], p[1], p[2] - t])), new Vector3(0, -1, 0));
    };
    const edge = (a: P3, b: P3, t: number) => R.poly([W([a[0], a[1], a[2] - t]), W([b[0], b[1], b[2] - t]), W(b), W(a)]);
    if (v.galeria) {
      aabb(R, v.x0 - 0.1, v.y0 - 0.1, v.x1 + 0.1, v.y1 + 0.1, H - 0.05, H + 0.3, R);
      return;
    }
    const e = v.type === "plana" ? 0 : eave;
    const X0 = v.x0 - e, X1 = v.x1 + e, Y0 = v.y0 - e, Y1 = v.y1 + e;
    if (v.type === "plana") {
      aabb(M.slab(), v.x0, v.y0, v.x1, v.y1, H - 0.05, H + 0.35, R);
      const p = 0.15;
      const E = M.ext();
      aabb(E, v.x0, v.y0, v.x1, v.y0 + p, H, H + 0.9);
      aabb(E, v.x0, v.y1 - p, v.x1, v.y1, H, H + 0.9);
      aabb(E, v.x0, v.y0, v.x0 + p, v.y1, H, H + 0.9);
      aabb(E, v.x1 - p, v.y0, v.x1, v.y1, H, H + 0.9);
      return;
    }
    const t = roofT;
    const rim = (pts: P3[]) => pts.forEach((a, i) => edge(a, pts[(i + 1) % pts.length]!, t));
    const wallE = M.ext();
    if (v.type === "una-agua") {
      const xAxis = v.high === "W" || v.high === "E";
      const span = xAxis ? v.x1 - v.x0 : v.y1 - v.y0;
      const z = (x: number, y: number) => {
        const d = v.high === "W" ? x - v.x0 : v.high === "E" ? v.x1 - x : v.high === "S" ? y - v.y0 : v.y1 - y;
        return H + slope * (span - d) + t;
      };
      const top: P3[] = [[X0, Y0, z(X0, Y0)], [X1, Y0, z(X1, Y0)], [X1, Y1, z(X1, Y1)], [X0, Y1, z(X0, Y1)]];
      solid(top, t);
      rim(top);
      // Culatas: muros bajo la cubierta en los lados de la pendiente y en el lado alto.
      const zw = (x: number, y: number) => z(x, y) - t;
      const tri = (a: P3, b: P3, c: P3) => wallE.poly([W(a), W(b), W(c)]);
      if (xAxis) {
        for (const y of [v.y0, v.y1]) tri([v.x0, y, H], [v.x1, y, H], [v.high === "W" ? v.x0 : v.x1, y, zw(v.high === "W" ? v.x0 : v.x1, y)]);
        const xh = v.high === "W" ? v.x0 : v.x1;
        wallE.poly([W([xh, v.y0, H]), W([xh, v.y1, H]), W([xh, v.y1, zw(xh, v.y1)]), W([xh, v.y0, zw(xh, v.y0)])]);
      } else {
        for (const x of [v.x0, v.x1]) tri([x, v.y0, H], [x, v.y1, H], [x, v.high === "S" ? v.y0 : v.y1, zw(x, v.high === "S" ? v.y0 : v.y1)]);
        const yh = v.high === "S" ? v.y0 : v.y1;
        wallE.poly([W([v.x0, yh, H]), W([v.x1, yh, H]), W([v.x1, yh, zw(v.x1, yh)]), W([v.x0, yh, zw(v.x0, yh)])]);
      }
      return;
    }
    const alongY = v.y1 - v.y0 >= v.x1 - v.x0;
    const zE = H - slope * e + t;
    if (v.type === "dos-aguas") {
      if (alongY) {
        const cx = (X0 + X1) / 2;
        const zR = zE + slope * ((X1 - X0) / 2);
        const w: P3[] = [[X0, Y0, zE], [X0, Y1, zE], [cx, Y1, zR], [cx, Y0, zR]];
        const ea: P3[] = [[cx, Y0, zR], [cx, Y1, zR], [X1, Y1, zE], [X1, Y0, zE]];
        solid(w, t), solid(ea, t), rim(w), rim(ea);
        const zr = H + slope * ((v.x1 - v.x0) / 2);
        for (const y of [v.y0, v.y1]) wallE.poly([W([v.x0, y, H]), W([v.x1, y, H]), W([(v.x0 + v.x1) / 2, y, zr])]);
      } else {
        const cy = (Y0 + Y1) / 2;
        const zR = zE + slope * ((Y1 - Y0) / 2);
        const s: P3[] = [[X0, Y0, zE], [X1, Y0, zE], [X1, cy, zR], [X0, cy, zR]];
        const n: P3[] = [[X0, cy, zR], [X1, cy, zR], [X1, Y1, zE], [X0, Y1, zE]];
        solid(s, t), solid(n, t), rim(s), rim(n);
        const zr = H + slope * ((v.y1 - v.y0) / 2);
        for (const x of [v.x0, v.x1]) wallE.poly([W([x, v.y0, H]), W([x, v.y1, H]), W([x, (v.y0 + v.y1) / 2, zr])]);
      }
      return;
    }
    // Cuatro aguas
    const hw = Math.min(X1 - X0, Y1 - Y0) / 2;
    const zR = zE + slope * hw;
    const faces: P3[][] = alongY
      ? [
          [[X0, Y0, zE], [X0, Y1, zE], [X0 + hw, Y1 - hw, zR], [X0 + hw, Y0 + hw, zR]],
          [[X1, Y1, zE], [X1, Y0, zE], [X1 - hw, Y0 + hw, zR], [X1 - hw, Y1 - hw, zR]],
          [[X0, Y0, zE], [X0 + hw, Y0 + hw, zR], [X1, Y0, zE]],
          [[X1, Y1, zE], [X1 - hw, Y1 - hw, zR], [X0, Y1, zE]],
        ]
      : [
          [[X0, Y0, zE], [X1, Y0, zE], [X1 - hw, Y0 + hw, zR], [X0 + hw, Y0 + hw, zR]],
          [[X1, Y1, zE], [X0, Y1, zE], [X0 + hw, Y1 - hw, zR], [X1 - hw, Y1 - hw, zR]],
          [[X0, Y0, zE], [X0 + hw, Y0 + hw, zR], [X0, Y1, zE]],
          [[X1, Y1, zE], [X1 - hw, Y1 - hw, zR], [X1, Y0, zE]],
        ];
    for (const fc of faces) solid(fc, t);
    rim([[X0, Y0, zE], [X1, Y0, zE], [X1, Y1, zE], [X0, Y1, zE]]);
  }

  // ─── Parqueadero cubierto y terrazas cubiertas ─────────────
  if (typeof pr["parqueadero_xmin"] === "number") {
    const x0 = num(pr, "parqueadero_xmin", 0), x1 = num(pr, "parqueadero_xmax", 0), y0 = num(pr, "parqueadero_ymin", 0), y1 = num(pr, "parqueadero_ymax", 0);
    const h = z00 + num(pr, "parqueadero_altura_m", 2.8);
    aabb(M.roof(), x0 - 0.3, y0 - 0.3, x1 + 0.05, y1 + 0.3, h, h + 0.18, M.roof());
    aabb(M.soffit(), x0 - 0.3, y0 - 0.3, x1 + 0.05, y1 + 0.3, h - 0.01, h, M.soffit());
    for (const [cx, cy] of [[x0 + 0.1, y0 + 0.1], [x0 + 0.1, y1 - 0.1]] as const) aabb(M.frame(), cx - 0.075, cy - 0.075, cx + 0.075, cy + 0.075, z00 - 0.13, h, M.frame());
  }

  // ─── Mobiliario ────────────────────────────────────────────
  if (o.furniture) for (const d of ents.filter((e): e is Device => e.kind === "Device" && e.discipline === "ARQ")) furnish(d);
  function furnish(d: Device): void {
    const p = (d.properties ?? {}) as Props;
    const z = elevOf(d.id);
    const c = Math.cos(d.rotation), s = Math.sin(d.rotation);
    const L = (x: number, y: number): Vec2 => ({ x: d.position.x + c * x - s * y, y: d.position.y + s * x + c * y });
    const box = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, acc: Acc) => boxPlan([L(x0, y0), L(x1, y0), L(x1, y1), L(x0, y1)], z + z0, z + z1, () => acc, acc);
    const w = num(p, "ancho_m", 1), dp = num(p, "fondo_m", 0.6);
    switch (d.symbol) {
      case "cama": {
        const l = num(p, "largo_m", 2);
        box(-w / 2, 0, w / 2, l, 0.08, 0.32, M.darkWood());
        box(-w / 2 + 0.02, 0.05, w / 2 - 0.02, l - 0.02, 0.32, 0.55, M.linen());
        box(-w / 2 - 0.04, 0, w / 2 + 0.04, 0.07, 0.08, 1.15, M.fabric());
        box(-w / 2 + 0.1, 0.1, -0.05, 0.42, 0.55, 0.68, M.linen());
        box(0.05, 0.1, w / 2 - 0.1, 0.42, 0.55, 0.68, M.linen());
        box(-w / 2 + 0.02, l * 0.62, w / 2 - 0.02, l - 0.05, 0.55, 0.6, M.fabric());
        if (num(p, "mesas", 1) > 0) for (const x of [-w / 2 - 0.5, w / 2 + 0.05]) box(x, 0, x + 0.45, 0.4, 0, 0.5, M.oak());
        break;
      }
      case "sofa": {
        const ww = num(p, "ancho_m", 2.4), dd = num(p, "fondo_m", 0.9);
        box(-ww / 2, 0, ww / 2, dd, 0.05, 0.42, M.fabric());
        box(-ww / 2, 0, ww / 2, 0.22, 0.42, 0.82, M.fabric());
        box(-ww / 2, 0, -ww / 2 + 0.2, dd, 0.42, 0.62, M.fabric());
        box(ww / 2 - 0.2, 0, ww / 2, dd, 0.42, 0.62, M.fabric());
        box(-0.6, dd + 0.45, 0.6, dd + 1.15, 0, 0.38, M.oak());
        break;
      }
      case "mesa": {
        const ww = num(p, "ancho_m", 2.2), dd = num(p, "fondo_m", 1.0);
        box(-ww / 2, 0, ww / 2, dd, 0.72, 0.76, /comedor/i.test(d.name ?? "") || ww > 1.6 ? M.oak() : M.marble());
        for (const [x, y] of [[-ww / 2 + 0.08, 0.08], [ww / 2 - 0.12, 0.08], [-ww / 2 + 0.08, dd - 0.12], [ww / 2 - 0.12, dd - 0.12]] as const) box(x, y, x + 0.05, y + 0.05, 0, 0.72, M.darkWood());
        const n = Math.max(1, Math.round(ww / 0.65));
        for (let i = 0; i < n; i++) {
          const cx = -ww / 2 + (ww * (i + 0.5)) / n;
          box(cx - 0.22, -0.55, cx + 0.22, -0.1, 0.44, 0.48, M.fabric());
          box(cx - 0.22, -0.58, cx + 0.22, -0.54, 0.48, 0.9, M.fabric());
          box(cx - 0.22, dd + 0.1, cx + 0.22, dd + 0.55, 0.44, 0.48, M.fabric());
          box(cx - 0.22, dd + 0.54, cx + 0.22, dd + 0.58, 0.48, 0.9, M.fabric());
        }
        break;
      }
      case "mueble": {
        const tipo = str(p, "tipo", "");
        const name = str(p, "carpinteria", str(p, "rotulo", "")).toLowerCase();
        if (tipo === "closet" || tipo === "alto") box(-w / 2, 0, w / 2, dp, 0, 2.4, M.oak());
        else if (/tv/.test(name)) box(-w / 2, 0, w / 2, dp, 0.2, 0.55, M.darkWood());
        else if (/escritorio/.test(name)) box(-w / 2, 0, w / 2, dp, 0.72, 0.76, M.oak());
        else {
          box(-w / 2, 0, w / 2, dp, 0.1, 0.88, /isla|cocina|lavadero|bbq/.test(name) ? M.lacquer() : M.oak());
          box(-w / 2 - 0.02, -0.02, w / 2 + 0.02, dp + 0.03, 0.88, 0.91, M.marble());
          if (/cocina/.test(name)) box(-w / 2, 0, w / 2, 0.35, 1.5, 2.3, M.lacquer());
        }
        break;
      }
      case "lavamanos":
        box(-w / 2, 0, w / 2, 0.5, 0.3, 0.82, M.oak());
        box(-w / 2 - 0.02, 0, w / 2 + 0.02, 0.52, 0.82, 0.85, M.marble());
        break;
      case "wc":
        box(-0.19, 0, 0.19, 0.18, 0, 0.8, M.ceramic());
        box(-0.18, 0.18, 0.18, 0.68, 0, 0.42, M.ceramic());
        break;
      case "estufa":
        box(-0.45, 0, 0.45, 0.52, 0.1, 0.88, M.lacquer());
        box(-0.45, 0, 0.45, 0.52, 0.88, 0.9, M.frame());
        break;
      case "lavaplatos":
        box(-w / 2, 0.05, w / 2, 0.53, 0.1, 0.88, M.lacquer());
        box(-w / 2, 0.05, w / 2, 0.53, 0.88, 0.91, M.marble());
        break;
      case "electrodomestico":
        box(-0.45, 0, 0.45, 0.7, 0, 1.85, M.steel());
        break;
    }
  }

  // ─── Terreno y paisajismo ──────────────────────────────────
  const hb = new Box3();
  for (const { acc } of accs.values()) for (let i = 0; i < acc.pos.length; i += 3) hb.expandByPoint(new Vector3(acc.pos[i], acc.pos[i + 1], acc.pos[i + 2]));
  if (hb.isEmpty()) hb.set(new Vector3(0, 0, -15), new Vector3(12, 6, 0));
  const g = o.ground === "grava" ? M.gravel() : M.grass();
  const R0 = 700;
  g.poly([W([-R0, -R0, z00 - 0.155]), W([R0, -R0, z00 - 0.155]), W([R0, R0, z00 - 0.155]), W([-R0, R0, z00 - 0.155])], new Vector3(0, 1, 0));
  // Acceso vehicular hasta el frente del lote y sendero peatonal a la puerta principal.
  if (typeof pr["parqueadero_xmin"] === "number") {
    const x0 = num(pr, "parqueadero_xmin", 0), x1 = num(pr, "parqueadero_xmax", 0), y0 = num(pr, "parqueadero_ymin", 0);
    aabb(M.paver(), x0, y0 - 14, x1, y0, z00 - 0.155, z00 - 0.14, M.paver());
  }
  for (const a of ents)
    if (a.kind === "Annotation" && a.style === "outline" && /sendero/i.test(String(a.properties?.["descripcion"] ?? "")) && a.points.length >= 3) prism(a.points as Vec2[], z00 - 0.155, z00 - 0.135, M.stone(), M.stone());

  const rnd = rng(1234);
  const cxp = (hb.min.x + hb.max.x) / 2, cyp = -(hb.min.z + hb.max.z) / 2;
  const hx = (hb.max.x - hb.min.x) / 2, hy = (hb.max.z - hb.min.z) / 2;
  const palms = /playa/i.test(str(pr, "estilo", ""));
  const nTrees = o.trees === 0 ? 0 : o.trees === 1 ? 9 : 20;
  let placed = 0;
  for (let tries = 0; placed < nTrees && tries < 400; tries++) {
    const ang = rnd() * Math.PI * 2;
    const dist = 1 + 0.35 + rnd() * 0.9;
    const x = cxp + Math.cos(ang) * (hx + 4) * dist;
    const y = cyp + Math.sin(ang) * (hy + 4) * dist;
    // Fuera de la casa, del frente de acceso (para no tapar la fachada principal) y del acceso vehicular.
    if (Math.abs(x - cxp) < hx + 2.5 && Math.abs(y - cyp) < hy + 2.5) continue;
    if (y < cyp - hy && Math.abs(x - cxp) < hx * 0.9) continue;
    if (palms && rnd() < 0.6) palm(x, y, 6 + rnd() * 4);
    else tree(x, y, 4 + rnd() * 4);
    placed++;
  }
  if (o.trees > 0) treeLine(cxp, cyp);
  if (o.shrubs)
    for (const wl of facadeWalls) {
      const len = Math.hypot(wl.b.x - wl.a.x, wl.b.y - wl.a.y);
      const ux = (wl.b.x - wl.a.x) / len, uy = (wl.b.y - wl.a.y) / len;
      for (let s = 0.6; s < len - 0.4; s += 1.1 + rnd() * 0.6) {
        if (rnd() < 0.35) continue;
        const px = wl.a.x + ux * s - uy * 0.75, py = wl.a.y + uy * s + ux * 0.75;
        // Solo hacia afuera (lejos del centro de la casa).
        const out = (px - cxp) * (wl.a.x - cxp) + (py - cyp) * (wl.a.y - cyp);
        const qx = out >= 0 ? px : wl.a.x + ux * s + uy * 0.75, qy = out >= 0 ? py : wl.a.y + uy * s - ux * 0.75;
        if (Math.abs(qx - cxp) < hx - 0.2 && Math.abs(qy - cyp) < hy - 0.2) continue;
        blob(M.leaf((s * 7) | 0), qx, qy, z00 - 0.15 + 0.25, 0.35 + rnd() * 0.25, 1);
      }
    }

  function blob(acc: Acc, x: number, y: number, z: number, r: number, det: number): void {
    // Icosaedro subdividido y deformado: copa orgánica.
    const t = (1 + Math.sqrt(5)) / 2;
    let v: Vector3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((q) => new Vector3(...(q as [number, number, number])).normalize());
    let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let k = 0; k < det; k++) {
      const nf: number[][] = [];
      const mid = new Map<string, number>();
      const m = (a: number, b: number) => {
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        let i = mid.get(key);
        if (i === undefined) (i = v.length), v.push(v[a]!.clone().add(v[b]!).normalize()), mid.set(key, i);
        return i;
      };
      for (const [a, b, c] of f) {
        const ab = m(a!, b!), bc = m(b!, c!), ca = m(c!, a!);
        nf.push([a!, ab, ca], [b!, bc, ab], [c!, ca, bc], [ab, bc, ca]);
      }
      f = nf;
    }
    v = v.map((q) => q.clone().multiplyScalar(r * (0.8 + rnd() * 0.4)));
    const C = W([x, y, z]);
    for (const [a, b, c] of f) acc.tri(v[a!]!.clone().setY(v[a!]!.y * 0.85).add(C), v[b!]!.clone().setY(v[b!]!.y * 0.85).add(C), v[c!]!.clone().setY(v[c!]!.y * 0.85).add(C), v[a!]!.clone().add(v[b!]!).add(v[c!]!));
  }
  function trunk(x: number, y: number, z0: number, z1: number, r0: number, r1: number, lean = new Vector2()): void {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p = (a: number, z: number, r: number, k: number) => W([x + Math.cos(a) * r + lean.x * k, y + Math.sin(a) * r + lean.y * k, z]);
      M.trunk().poly([p(a0, z0, r0, 0), p(a1, z0, r0, 0), p(a1, z1, r1, 1), p(a0, z1, r1, 1)], new Vector3(Math.cos((a0 + a1) / 2), 0, -Math.sin((a0 + a1) / 2)));
    }
  }
  function tree(x: number, y: number, h: number): void {
    const z0 = z00 - 0.155;
    // Tronco con dos ramas principales y copa hecha de muchas matas pequeñas (follaje creíble de cerca).
    trunk(x, y, z0, z0 + h * 0.55, 0.16, 0.1);
    const k = (rnd() * 6) | 0;
    const crownR = h * (0.3 + rnd() * 0.08);
    const cz = z0 + h * 0.68;
    for (let j = 0; j < 3; j++) {
      const a = rnd() * Math.PI * 2;
      trunk(x, y, z0 + h * 0.45, z0 + h * 0.75, 0.07, 0.035, new Vector2(Math.cos(a), Math.sin(a)).multiplyScalar(crownR * 0.5));
    }
    const n = 34 + ((rnd() * 18) | 0);
    for (let i = 0; i < n; i++) {
      // Punto al azar dentro de un elipsoide achatado, más denso hacia la superficie.
      const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, rr = Math.pow(0.35 + 0.65 * rnd(), 0.5);
      const sx = Math.sqrt(1 - u * u) * Math.cos(t) * rr, sy = Math.sqrt(1 - u * u) * Math.sin(t) * rr;
      const top = u * rr;
      blob(M.leaf(k + (i % 3 === 0 ? 1 : 0)), x + sx * crownR, y + sy * crownR, cz + top * crownR * 0.7, crownR * (0.2 + rnd() * 0.12), 1);
    }
  }
  /** Bosque lejano alrededor del lote: horizonte natural en vez de un plano vacío. */
  function treeLine(cx: number, cy: number): void {
    const z0 = z00 - 0.155;
    const r = rng(4321);
    for (let i = 0; i < 300; i++) {
      const a = (i / 300) * Math.PI * 2 + r() * 0.02;
      const d = 150 + r() * 130;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      const h = 9 + r() * 10;
      const k = 6 + ((r() * 3) | 0);
      blob(M.leaf(k), x, y, z0 + h * 0.55, h * 0.45, 2);
      if (r() < 0.6) blob(M.leaf(k + 1), x + (r() - 0.5) * 5, y + (r() - 0.5) * 5, z0 + h * 0.85, h * 0.32, 2);
    }
  }
  function palm(x: number, y: number, h: number): void {
    const z0 = z00 - 0.155;
    const lean = new Vector2(rnd() - 0.5, rnd() - 0.5).multiplyScalar(1.2);
    const seg = 6;
    for (let i = 0; i < seg; i++) {
      const t0 = i / seg, t1 = (i + 1) / seg;
      const c0 = new Vector2(x, y).addScaledVector(lean, t0 * t0), c1 = new Vector2(x, y).addScaledVector(lean, t1 * t1);
      trunk(c0.x, c0.y, z0 + h * t0, z0 + h * t1, 0.16 - 0.04 * t0, 0.16 - 0.04 * t1, c1.clone().sub(c0));
    }
    const top = new Vector2(x, y).add(lean);
    const zt = z0 + h;
    const L = M.leaf(1);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rnd() * 0.3;
      const len = 2.2 + rnd() * 0.8;
      const pts: Vector3[] = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        const d = t * len;
        pts.push(W([top.x + Math.cos(a) * d, top.y + Math.sin(a) * d, zt + 0.5 * Math.sin(t * Math.PI * 0.6) - 1.2 * t * t]));
      }
      for (let k = 0; k < 6; k++) {
        const wdt = 0.32 * Math.sin(((k + 0.5) / 6) * Math.PI);
        const side = new Vector3(-Math.sin(a), 0, -Math.cos(a)).multiplyScalar(wdt);
        L.poly([pts[k]!.clone().sub(side), pts[k]!.clone().add(side), pts[k + 1]!.clone().add(side), pts[k + 1]!.clone().sub(side)], new Vector3(0, 1, 0));
      }
    }
  }

  // ─── Mallas ────────────────────────────────────────────────
  const group = new Group();
  for (const [key, { acc, mat }] of accs) {
    if (!acc.pos.length) continue;
    const mesh = new Mesh(acc.geometry(), mat);
    mesh.name = key;
    mesh.castShadow = key !== "grass" && key !== "gravel" && key !== "glass" && key !== "lamp";
    mesh.receiveShadow = true;
    if (key === "lamp") lights.push(mesh);
    group.add(mesh);
  }
  const front = W([cxp, cyp - hy - 1, 1.6]);
  let interior: HouseInfo["interior"];
  if (living) {
    const xs = living.boundary.map((p) => p.x), ys = living.boundary.map((p) => p.y);
    const z = elevOf(living.id) + 1.35;
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    // Desde una esquina interior hacia la diagonal opuesta: se ve el espacio y su ventanal.
    interior = { eye: W([x0 + 0.5, y0 + 0.5, z]), look: W([x1, y1, z - 0.15]) };
  }
  const d = styleDefaults(reader);
  return { group, lights, info: { box: hb, front, frontDir: frontNormal ?? new Vector3(0, 0, 1), ...(doorPos ? { door: doorPos } : {}), ...(interior ? { interior } : {}), styleName: d.name, defaults: d } };
}
