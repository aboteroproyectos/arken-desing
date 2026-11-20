// Motor de diseño de vivienda: convierte un programa (lo que pidió el usuario) en un modelo BIM
// completo con arquitectura, estructura, mobiliario, acabados, eléctrica, iluminación y su juego de
// planos. No usa la Casa Lote 01 ni ninguna plantilla: todo sale de reglas de diseño.

import { BimStore, type BimModel, type Entity, type Id, type Sheet, type Vec2 } from "@arken/core";
import { circuitResults, serviceDemand } from "@arken/calc";
import { ProjectBuilder, chain, newId, orthoPath, rect, v, type Props } from "../builder";
import { completeProgram, GAS_NAMES, ROOF_NAMES, type HouseProgram, type ProgramDraft } from "./program";
import { builtArea, faceToGlobal, layoutHouse, stairGeometry, toGlobal, TREAD, type Face, type Layout, type Mod, type Wing } from "./layout";
import { XfBuilder } from "./xf";
import { finishProps, LUX, type RoomType } from "./finishes";
import { STYLES, type StyleDef } from "./styles";
import { buildComms, buildGas, buildRain, buildSanitary, buildWater, type NetCtx } from "./networks";

const PI = Math.PI;
const R_W = -PI / 2; // contra el muro occidental (local: contra el muro del hall)
const R_E = PI / 2;
const R_N = PI;
const CEILING = 2.7;

/** Recinto registrado para las redes y la revisión de calidad. */
export interface Room {
  readonly level: Id;
  readonly floor: number;
  readonly type: RoomType;
  readonly name: string;
  readonly number: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly doors: Vec2[];
  /** Pabellón al que pertenece (A, B o C). */
  readonly wing: "A" | "B" | "C";
  /** Fachadas que toca (S, N, E, W). */
  readonly facades: string[];
  windowArea: number;
  readonly id: Id;
}

export interface DesignResult {
  readonly model: BimModel;
  readonly program: HouseProgram;
  readonly layout: Layout;
  readonly rooms: readonly Room[];
}

export function designHouse(draft: ProgramDraft): DesignResult {
  const p = completeProgram(draft);
  const st = STYLES[p.estilo];
  const lay = layoutHouse(p);
  const D = new Designer(p, st, lay);
  return { model: D.build(), program: p, layout: lay, rooms: D.rooms };
}

interface WallRec {
  id: Id;
  a: Vec2;
  b: Vec2;
}

class Designer {
  /** Constructor del modelo (pabellón A, coordenadas globales). */
  readonly base = new ProjectBuilder();
  /** Constructor del pabellón en curso (B y C se dibujan en sus coordenadas locales). */
  b: ProjectBuilder = this.base;
  /** Pabellón en curso. */
  private wing: Wing;
  private xfs = new Map<string, ProjectBuilder>();
  readonly rooms: Room[] = [];
  private walls: WallRec[] = [];
  private levels: Id[] = [];
  private roofLevel: Id = "";
  private spaceNo = new Map<number, number>();
  private doorNo = 0;
  private winNo = 0;
  private m: Record<string, Id> = {};
  private ls: Record<string, Id> = {};
  private projectId = newId();
  private stairInfo: Record<string, number> = {};
  private tg: Vec2 = v(0, 0);

  constructor(
    readonly p: HouseProgram,
    readonly st: StyleDef,
    readonly lay: Layout,
  ) {
    this.wing = lay.wings[0]!;
  }

  /** Ancho y largo del pabellón en curso (coordenadas locales). */
  get W() {
    return this.wing.W;
  }
  get L() {
    return this.wing.L;
  }
  private useWing(w: Wing): void {
    this.wing = w;
    if (w.key === "A") this.b = this.base;
    else {
      if (!this.xfs.has(w.key)) this.xfs.set(w.key, new XfBuilder(this.base, w.place));
      this.b = this.xfs.get(w.key)!;
    }
  }
  /** Punto local del pabellón en curso → global. */
  private G(p: Vec2): Vec2 {
    const q = toGlobal(this.wing.place, p.x, p.y);
    return v(q.x, q.y);
  }
  private get multi(): boolean {
    return this.lay.wings.length > 1;
  }
  /** Rectángulo global (caras exteriores) de un pabellón. */
  wingRect(w: Wing): { x0: number; y0: number; x1: number; y1: number } {
    const a = toGlobal(w.place, 0, 0);
    const c = toGlobal(w.place, w.W, w.L);
    return { x0: Math.min(a.x, c.x), y0: Math.min(a.y, c.y), x1: Math.max(a.x, c.x), y1: Math.max(a.y, c.y) };
  }
  /** Extensión global de la casa (pabellones y galerías). */
  bbox(): { x0: number; y0: number; x1: number; y1: number } {
    const rs = this.lay.wings.map((w) => this.wingRect(w));
    return { x0: Math.min(...rs.map((r) => r.x0)), y0: Math.min(...rs.map((r) => r.y0)), x1: Math.max(...rs.map((r) => r.x1)), y1: Math.max(...rs.map((r) => r.y1)) };
  }
  get F() {
    return this.p.pisos;
  }
  private carportW() {
    return this.p.parqueaderos > 0 ? Math.round((this.p.parqueaderos * 3.1 + 0.3) * 100) / 100 : 0;
  }

  build(): BimModel {
    this.setupProject();
    for (let f = 1; f <= this.F; f++)
      for (const w of this.lay.wings)
        if (f <= w.floors.length) {
          this.useWing(w);
          this.buildFloor(f);
        }
    this.useWing(this.lay.wings[0]!);
    this.buildLinks();
    this.buildSite();
    this.buildStructure();
    this.buildRoof();
    this.buildElectrical();
    this.buildNetworks();
    this.buildSheets();
    this.finishProject();
    this.fitPlanSheets();
    return this.base.snapshot();
  }

  // ─── Proyecto, niveles, materiales ──────────────────────────
  private setupProject(): void {
    const { p, st, lay } = this;
    const b = this.b;
    const buildingId = newId();
    const area = builtArea(lay);
    const today = new Date();
    const mes = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][today.getMonth()];
    const code = p.proyecto.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 4).toUpperCase() || "CASA";
    const cp = this.carportW();
    b.put({
      id: this.projectId,
      kind: "Project",
      name: p.proyecto,
      lengthUnit: "m",
      titleBlock: {
        empresa: p.empresa,
        lema: "Arquitectura · Ingeniería · Construcción",
        empresa_contacto: "Diseño integral BIM",
        empresa_web: "",
        proyecto: p.proyecto.toUpperCase(),
        localizacion: p.localizacion || "Por definir",
        propietario: p.propietario || "Por definir",
        diseno: p.empresa,
        matricula: "Mat. prof. por diligenciar",
        dibujo: "ARKEN DISEÑO",
        reviso: "",
        aprobo: "",
        fecha: `${mes} ${today.getFullYear()}`,
        revision: "0",
        archivo: `${code}-01`,
      },
      properties: {
        area_construida_m2: round(area),
        pisos: p.pisos,
        altura_piso_m: lay.dims.floorH,
        estilo: st.key,
        estilo_nombre: st.name,
        estilo_muro: st.wall,
        estilo_muro_color: st.wallColor,
        estilo_acento: st.accent,
        estilo_acento_color: st.accentColor,
        estilo_base: st.base,
        estilo_cubierta_color: st.roofColor,
        estilo_cubierta_material: st.roofMaterial,
        estilo_marco_color: st.frameColor,
        estilo_celosias: st.celosias,
        cubierta_tipo: p.cubierta,
        cubierta_pendiente_pct: p.cubierta === "plana" ? 1.5 : p.pendiente,
        cubierta_alero_m: p.cubierta === "plana" ? 0 : st.alero,
        cubierta_espesor_m: p.cubierta === "plana" ? 0.35 : 0.25,
        cubierta_alta_m: p.pisos * lay.dims.floorH,
        casa_xmin: 0,
        casa_xmax: lay.W,
        casa_ymin: 0,
        casa_ymax: lay.L,
        fachadas_escala: this.elevationScale(),
        huella: p.huella,
        ...(this.multi ? { volumenes: JSON.stringify(this.volumes()), ...this.sectionFrame() } : {}),
        factor_mantenimiento: 0.8,
        ev_limite_A: p.cargadorEV && p.parqueaderos > 0 ? (p.parqueaderos >= 2 ? 40 : 32) : 0,
        ...(cp ? { parqueadero_xmin: -cp, parqueadero_xmax: -0.05, parqueadero_ymin: -0.15, parqueadero_ymax: 6.35, parqueadero_altura_m: 2.8 } : {}),
        red_operador: "Red BT del operador de red · 120/240 V monofásica trifilar",
        medidor: "Medidor de energía clase 1, 120/240 V, con DPS tipo 1",
        tablero_TG: "Tablero general en el cuarto técnico, barraje de cobre, DPS tipo 2",
        unifilar_notas:
          (p.gas === "no" ? "Vivienda 100 % eléctrica (inducción, horno, calentador de acumulación y secadora eléctricos): no requiere red de gas." : `Cocción, agua caliente, secadora y asador a gas (${GAS_NAMES[p.gas]}); el tablero solo alimenta su encendido y control.`) + "|Sistema de puesta a tierra único: varilla Cu 5/8\" × 2.40 m, R ≤ 25 Ω (RETIE), equipotencial con la estructura.|Protección diferencial GFCI en cocina, baños, ropas y exteriores; DPS tipo 2 en el tablero general.",
        ...(p.gas === "no" ? {} : p.gas === "natural" ? { gas_pc_kwh_m3: 10.35, gas_densidad_rel: 0.62, gas_dp_max_mbar: 2.0, gas_suministro: GAS_NAMES[p.gas] } : { gas_pc_kwh_m3: 26.0, gas_densidad_rel: 1.52, gas_dp_max_mbar: 2.8, gas_presion_mbar: 28, gas_suministro: GAS_NAMES[p.gas] }),
        programa: JSON.stringify(p),
      },
    });
    b.put({ id: buildingId, kind: "Building", name: "Casa" });
    for (let i = 0; i < p.pisos; i++) {
      const id = newId();
      this.levels.push(id);
      const la = lay.wings.reduce((t, w) => t + (i < w.floors.length ? w.W * w.L : 0), 0) + (i === 0 ? lay.links.reduce((t, k) => t + Math.abs(k.xW - k.xA) * (k.c1 - k.c0), 0) : 0);
      b.put({ id, kind: "Level", name: `Piso ${i + 1}`, elevation: i * lay.dims.floorH, height: lay.dims.floorH, properties: { area_construida_m2: round(la) } });
    }
    this.roofLevel = newId();
    b.put({ id: this.roofLevel, kind: "Level", name: "Cubierta", elevation: p.pisos * lay.dims.floorH, height: 0.3 });
    const mats: [string, string, string][] = [
      ["estuco", "Estuco y pintura elastomérica exterior", st.wallColor],
      ["bloque", "Mampostería en bloque de concreto / ladrillo estructural", "#c9c4b8"],
      ["panete", "Pañete interior con estuco", "#f2efe8"],
      ["yeso", "Placa de yeso 12.7 mm", "#f4f1ea"],
      ["yesoRH", "Placa de yeso RH (resistente a la humedad)", "#dfe9e2"],
      ["perfil", "Perfil de acero galvanizado + lana mineral", "#c9c4b8"],
    ];
    for (const [k, name, color] of mats) {
      this.m[k] = newId();
      b.put({ id: this.m[k]!, kind: "Material", name, displayColor: color });
    }
    this.ls["fachada"] = newId();
    this.ls["interior"] = newId();
    this.ls["humedo"] = newId();
    b.put(
      { id: this.ls["fachada"]!, kind: "MaterialLayerSet", name: "Muro de fachada 200 (mampostería + estuco)", layers: [{ materialId: this.m["estuco"]!, thickness: 0.02 }, { materialId: this.m["bloque"]!, thickness: 0.16 }, { materialId: this.m["panete"]!, thickness: 0.02 }] },
      { id: this.ls["interior"]!, kind: "MaterialLayerSet", name: "Divisorio 120 (drywall con aislamiento acústico)", layers: [{ materialId: this.m["yeso"]!, thickness: 0.015 }, { materialId: this.m["perfil"]!, thickness: 0.09 }, { materialId: this.m["yeso"]!, thickness: 0.015 }] },
      { id: this.ls["humedo"]!, kind: "MaterialLayerSet", name: "Divisorio húmedo 120 (yeso RH)", layers: [{ materialId: this.m["yesoRH"]!, thickness: 0.015 }, { materialId: this.m["perfil"]!, thickness: 0.09 }, { materialId: this.m["yesoRH"]!, thickness: 0.015 }] },
    );
    b.run({
      label: "Estructura espacial",
      execute: (tx) => {
        tx.apply({ type: "putRelation", relation: { id: newId(), kind: "RelAggregates", parentId: this.projectId, childIds: [buildingId] } });
        tx.apply({ type: "putRelation", relation: { id: newId(), kind: "RelAggregates", parentId: buildingId, childIds: [...this.levels, this.roofLevel] } });
      },
    });
  }

  /** Volúmenes para las fachadas: pabellones y galerías (caras exteriores, coordenadas globales). */
  private volumes() {
    const vols: Record<string, unknown>[] = this.lay.wings.map((w) => ({ ...this.wingRect(w), floors: w.floors.length, high: faceToGlobal(w.place, "W") }));
    for (const k of this.lay.links) vols.push({ x0: Math.min(k.xA, k.xW), x1: Math.max(k.xA, k.xW), y0: round(k.c0 - 0.1), y1: round(k.c1 + 0.1), floors: 1, galeria: true });
    return vols;
  }
  /** Marco de los cortes: el pabellón con la escalera (o el social si la casa es de un piso). */
  private sectionFrame(): Record<string, number> {
    const w = this.lay.wings.find((x) => x.floors.length > 1) ?? this.lay.wings[0]!;
    return { corte_ox: w.place.ox, corte_oy: w.place.oy, corte_giro: w.place.turn, corte_W: w.W, corte_L: w.L, corte_pisos: w.floors.length };
  }

  private elevationScale(): number {
    const H = this.F * this.lay.dims.floorH + 4;
    const bb = this.bbox();
    const w = Math.max(bb.x1 - bb.x0 + this.carportW(), bb.y1 - bb.y0) + 4;
    // Cuatro fachadas en una cuadrícula de 2 × 2 sobre ~610 × 555 mm.
    for (const s of [50, 75, 100, 125, 150, 200]) if ((w * 1000) / s <= 270 && (H * 1000) / s <= 230) return s;
    return 250;
  }

  // ─── Muros, puertas y ventanas ──────────────────────────────
  private wall(a: Vec2, c: Vec2, set: "fachada" | "interior" | "humedo", props?: Props, name?: string): Id {
    const id = this.b.wall(this.ls[set]!, a, c, this.lay.dims.floorH, props, name);
    this.walls.push({ id, a, b: c });
    return id;
  }

  /** Muro de fachada (local) con los vanos de las galerías; la etiqueta de fachada es la orientación global. */
  private facade(a: Vec2, c: Vec2, face: Face, f: number, gaps: readonly { face: Face; a: number; b: number }[]): void {
    const g = faceToGlobal(this.wing.place, face);
    const NAMES: Record<Face, string> = { S: "sur", N: "norte", E: "oriental", W: "occidental" };
    const name = `Fachada ${NAMES[g]} · piso ${f}${this.wing.key === "A" ? "" : ` · ${this.wing.name.toLowerCase()}`}`;
    const horiz = face === "S" || face === "N";
    const t0 = horiz ? a.x : a.y;
    const t1 = horiz ? c.x : c.y;
    const at = (t: number) => (horiz ? v(t, a.y) : v(a.x, t));
    const cuts = gaps.filter((x) => x.face === face).map((x) => [x.a, x.b] as [number, number]);
    if (!cuts.length) {
      this.wall(a, c, "fachada", { fachada: g }, name);
      return;
    }
    // Tramos libres entre vanos, en el sentido del muro.
    const dir = Math.sign(t1 - t0);
    const lo = Math.min(t0, t1);
    const hi = Math.max(t0, t1);
    const pieces: [number, number][] = [];
    let cur = lo;
    for (const [ga, gb] of [...cuts].sort((p1, p2) => p1[0] - p2[0])) {
      if (ga > cur + 0.01) pieces.push([cur, Math.min(ga, hi)]);
      cur = Math.max(cur, gb);
    }
    if (hi > cur + 0.01) pieces.push([cur, hi]);
    const ordered = dir > 0 ? pieces : pieces.map(([p1, p2]) => [p2, p1] as [number, number]).reverse();
    for (const [p1, p2] of ordered) this.wall(at(p1), at(p2), "fachada", { fachada: g }, name);
  }

  private wallAt(pt: Vec2): Id {
    for (const w of this.walls) {
      const dx = w.b.x - w.a.x;
      const dy = w.b.y - w.a.y;
      const L = Math.hypot(dx, dy);
      const t = ((pt.x - w.a.x) * dx + (pt.y - w.a.y) * dy) / (L * L);
      const cross = Math.abs((pt.x - w.a.x) * dy - (pt.y - w.a.y) * dx) / L;
      if (cross < 1e-4 && t > 0 && t < 1) return w.id;
    }
    throw new Error(`No hay muro en (${pt.x}, ${pt.y})`);
  }

  private door(center: Vec2, width: number, into: Vec2, hinge: Vec2, desc: string, room?: Room, props?: Props): void {
    this.doorNo++;
    this.b.door(this.wallAt(center), center, width, into, hinge, `P-${this.doorNo} ${desc}`, props);
    room?.doors.push(this.G(center));
  }

  private window(center: Vec2, width: number, sill: number, h: number, desc: string, room?: Room, props: Props = {}): void {
    this.winNo++;
    this.b.window(this.wallAt(center), center, round(width), sill, h, `V-${this.winNo} ${desc}`, { descripcion: this.st.windowSpec, ...props });
    if (room) room.windowArea += width * h;
  }

  // ─── Espacios ───────────────────────────────────────────────
  private room(f: number, type: RoomType, name: string, x0: number, y0: number, x1: number, y1: number, extra: Props = {}): Room {
    const n = (this.spaceNo.get(f) ?? 0) + 1;
    this.spaceNo.set(f, n);
    const number = `${f}.${String(n).padStart(2, "0")}`;
    const fin = finishProps(this.p.acabados, type, type === "tecnico" ? 2.4 : CEILING);
    const over = this.st.finishes?.[type];
    if (over) {
      if (over.corto) fin.piso = over.corto;
      if (over.piso) fin.acabado_piso = over.piso;
      if (over.enchape) fin.acabado_enchape = over.enchape;
      if (over.cielo) fin.acabado_cielo = over.cielo;
      if (over.muros) fin.acabado_muros = over.muros;
    }
    const lux = LUX[type];
    const id = this.b.space(number, name, rect(x0, y0, x1, y1), { ...fin, tipo_espacio: type, ...(lux ? { lux_objetivo: lux } : {}), ...extra });
    const loc: Face[] = [];
    if (y0 <= 0.21) loc.push("S");
    if (y1 >= this.L - 0.21) loc.push("N");
    if (x0 <= 0.21) loc.push("W");
    if (x1 >= this.W - 0.21) loc.push("E");
    const facades = loc.map((k) => faceToGlobal(this.wing.place, k));
    const ga = this.G(v(x0, y0));
    const gc = this.G(v(x1, y1));
    const r: Room = { level: this.levels[f - 1]!, floor: f, type, name, number, x0: Math.min(ga.x, gc.x), y0: Math.min(ga.y, gc.y), x1: Math.max(ga.x, gc.x), y1: Math.max(ga.y, gc.y), doors: [], wing: this.wing.key, facades, windowArea: 0, id };
    this.rooms.push(r);
    return r;
  }

  private dev(sym: string, at: Vec2, rot: number, props: Props = {}): void {
    this.b.device("ARQ", sym, at, 0, props, { rot });
  }

  // ─── Un piso ────────────────────────────────────────────────
  private buildFloor(f: number): void {
    const { lay, b } = this;
    const wg = this.wing;
    const fp = wg.floors[f - 1]!;
    const isA = wg.key === "A";
    b.levelId = this.levels[f - 1]!;
    this.walls = []; // puertas y ventanas solo en los muros de este piso
    const { xa, xb, xe, L } = wg;
    const top = L - 0.1;
    // Vanos hacia las galerías (solo en el primer piso).
    const gaps = f === 1 ? wg.gaps : [];
    const noWest = xa - 0.1 < 0.01; // crujía sencilla: sin banda occidental
    const noEast = xe - xb < 0.01;
    // Fachadas en sentido horario (la cara exterior mira hacia afuera).
    this.facade(v(xe, 0.1), v(0.1, 0.1), "S", f, gaps);
    this.facade(v(0.1, 0.1), v(0.1, top), "W", f, gaps);
    this.facade(v(0.1, top), v(xe, top), "N", f, gaps);
    this.facade(v(xe, top), v(xe, 0.1), "E", f, gaps);

    const suiteDepth = fp.suite ? lay.dims.suiteBed + lay.dims.suiteBack : 0;
    const ys = round(top - suiteDepth); // fin del hall
    // Posiciones de los módulos.
    const place = (mods: Mod[]) => {
      let y = 0.1;
      return mods.map((m) => {
        const r = { m, y0: round(y), y1: round(y + m.depth) };
        y += m.depth;
        return r;
      });
    };
    const west = place(fp.west);
    const east = place(fp.east);
    const open = (m: Mod) => (m.kind === "cocina" && this.p.cocina === "abierta") || m.kind === "comedor" || m.kind === "sala" || (m.kind === "estar" && f > 1);
    const passage = (m: Mod) => m.kind === "conexion";
    const wet = (m: Mod) => m.kind === "bano" || m.kind === "bano-social" || m.kind === "servicio" || m.kind === "cocina";

    // Muro del hall (lado occidental): solo junto a los módulos cerrados y a la suite.
    const runs = (items: { y0: number; y1: number; closed: boolean }[]) => {
      const out: [number, number][] = [];
      for (const it of items) {
        if (!it.closed) continue;
        const last = out[out.length - 1];
        if (last && Math.abs(last[1] - it.y0) < 1e-6) last[1] = it.y1;
        else out.push([it.y0, it.y1]);
      }
      return out;
    };
    const westItems = west.map((w) => ({ y0: w.y0, y1: w.y1, closed: !open(w.m) && !passage(w.m) }));
    if (fp.suite) westItems.push({ y0: ys, y1: top, closed: true });
    // El muro del hall junto a la suite solo existe donde la banda occidental no es abierta… y siempre frente a la suite.
    const xaRuns = runs(westItems.map((it) => ({ ...it, y1: Math.min(it.y1, top), y0: it.y0 }))).map(([a, c]) => [a, c] as [number, number]);
    // Donde la suite toca módulos abiertos de la banda occidental, también va muro.
    if (!noWest) for (const [a, c] of xaRuns) this.wall(v(xa, a), v(xa, c), "interior");
    const eastItems = east.filter((e) => e.y0 < ys - 1e-6).map((e) => ({ y0: e.y0, y1: Math.min(e.y1, ys), closed: e.m.kind !== "escalera" && !passage(e.m) }));
    for (const [a, c] of runs(eastItems)) this.wall(v(xb, a), v(xb, c), "interior");

    // Divisiones entre módulos.
    for (let i = 1; i < west.length; i++) {
      const a = west[i - 1]!;
      const c = west[i]!;
      if (open(a.m) && open(c.m)) continue;
      this.wall(v(0.1, a.y1), v(xa, a.y1), wet(a.m) || wet(c.m) ? "humedo" : "interior");
    }
    for (let i = 1; i < east.length; i++) {
      const a = east[i - 1]!;
      const c = east[i]!;
      this.wall(v(xb, a.y1), v(xe, a.y1), wet(a.m) || wet(c.m) ? "humedo" : "interior");
    }
    if (fp.suite) this.wall(v(xa, ys), v(xe, ys), "interior");

    // Hall / circulación
    const hallTop = fp.suite ? ys - 0.06 : top - 0.1;
    const hallName = !isA ? (f === 1 ? `Hall ${wg.name.toLowerCase()}` : "Hall de alcobas") : f === 1 ? (this.multi ? "Hall de acceso y galería" : "Hall de acceso y circulación") : "Hall de alcobas";
    const hall = this.room(f, "circulacion", hallName, round(xa + (noWest ? 0.1 : 0.06)), 0.2, round(xb - (noEast ? 0.1 : 0.06)), round(hallTop));
    const hallMid = round((xa + xb) / 2);
    if (f === 1 && isA) {
      this.door(v(hallMid, 0.1), Math.min(1.4, xb - xa - 0.25), v(hallMid, 1), v(xb - 0.1, 0.1), `Puerta principal · ${this.st.doorSpec}`, hall, { principal: true });
      b.note("ARQ", "text", [v(hallMid, 1.4)], "NPT ±0.00", { align: "center" }, 1.8);
    } else if (f > 1) this.window(v(hallMid, 0.1), Math.max(0.8, xb - xa - 0.6), 0.9, 1.5, "Ventana del hall", hall);
    if (!fp.suite) this.window(v(hallMid, top), Math.max(0.8, xb - xa - 0.6), 0.9, 1.5, "Ventana de remate del hall", hall);
    // Crujía sencilla: el hall es una galería con ventanales sobre la fachada sin banda.
    if (noWest || noEast) {
      const fx = noEast ? xe : 0.1;
      const face: Face = noEast ? "E" : "W";
      const y1h = fp.suite ? ys : top;
      const blocked = gaps.filter((g) => g.face === face).map((g) => [g.a - 0.3, g.b + 0.3] as [number, number]);
      for (let y = 0.6; y + 2.0 <= y1h - 0.4; y += 3.4) {
        const yc = round(y + 1.0);
        if (blocked.some(([a, c]) => yc + 1.1 > a && yc - 1.1 < c)) continue;
        this.window(v(fx, yc), 2.0, 0.45, 2.15, "Ventanal de la galería", hall);
      }
    }

    for (const w of west) this.module(f, w.m, "W", w.y0, w.y1);
    for (const e of east) this.module(f, e.m, "E", e.y0, Math.min(e.y1, fp.suite ? ys : top));
    if (fp.suite) this.suite(f, ys, top);

    // Cotas del piso.
    this.dims(f, west, east, ys);
  }

  /**
   * Un módulo de banda. Coordenada local u: 0 en la cara del muro del hall, crece hacia la fachada.
   * En la banda occidental se refleja (u crece hacia el occidente).
   */
  private module(f: number, m: Mod, side: "W" | "E", y0a: number, y1a: number): void {
    const { xa, xb, xe } = this.wing;
    const east = side === "E";
    const X0 = east ? xb : xa; // eje del muro del hall
    const X1 = east ? xe : 0.1; // eje de la fachada
    const Wd = round(Math.abs(X1 - X0) - 0.06 - 0.1);
    const gx = (u: number) => round(east ? X0 + 0.06 + u : X0 - 0.06 - u);
    const ax = (u: number) => round(east ? X0 + u : X0 - u); // eje desde el hall
    const rot = (r: number) => (east ? r : -r);
    const y0 = round(y0a + (y0a <= 0.11 ? 0.1 : 0.06));
    const y1 = round(y1a - (y1a >= this.L - 0.11 ? 0.1 : 0.06));
    const yc = round((y0 + y1) / 2);
    const D = y1 - y0;
    const fac = east ? "E" : "W";
    const facX = X1;
    const rx = (u0: number, u1: number): [number, number] => {
      const a = gx(u0);
      const c = gx(u1);
      return [Math.min(a, c), Math.max(a, c)];
    };
    const mk = (type: RoomType, name: string, u0 = 0, u1 = Wd, extra: Props = {}) => {
      const [a, c] = rx(u0, u1);
      return this.room(f, type, name, a, y0, c, y1, extra);
    };
    const hallDoor = (r: Room, y: number, w: number, desc: string, hingeUp = false) => this.door(v(X0, round(y)), w, v(gx(0.5), round(y)), v(X0, round(hingeUp ? y + w / 2 : y - w / 2)), desc, r);
    const facWin = (r: Room, y: number, w: number, sill: number, h: number, desc: string) => {
      const ww = Math.min(w, D - 0.5);
      if (ww >= 0.5) this.window(v(facX, round(y)), ww, sill, h, desc, r);
    };
    const southWin = (r: Room, w: number, sill: number, h: number, desc: string) => {
      if (y0a <= 0.11) this.window(v(gx(Wd / 2), 0.1), Math.min(w, Wd - 0.6), sill, h, desc, r);
    };
    const northWin = (r: Room, w: number, sill: number, h: number, desc: string) => {
      if (y1a >= this.L - 0.11) this.window(v(gx(Wd / 2), round(this.L - 0.1)), Math.min(w, Wd - 0.6), sill, h, desc, r);
    };
    const big = this.st.floorToCeiling;
    const wh = (area: number, h: number, ratio = 1 / 6) => Math.max(1.2, (area * ratio) / h);

    switch (m.kind) {
      case "servicio": {
        // Cuarto técnico junto al hall y zona de ropas hacia la fachada.
        const split = Math.min(Math.max(1.7, Wd - 2.1), Wd - 1.8);
        this.wall(v(ax(split + 0.06), y0a), v(ax(split + 0.06), y1a), "humedo");
        const tech = mk("tecnico", "Cuarto técnico", 0, split);
        const ropas = mk("ropas", "Ropas", split + 0.12, Wd);
        hallDoor(tech, y0 + 0.55, 0.8, "Puerta cuarto técnico, lámina con rejilla de ventilación", true);
        this.door(v(gx((split + 0.12 + Wd) / 2), y1a), 0.8, v(gx((split + Wd) / 2), y0 + 0.5), v(gx(split + 0.5), y1a), "Puerta ropas–cocina, entamborada lacada", ropas);
        this.door(v(facX, yc), 0.9, v(gx(Wd - 0.6), yc), v(facX, yc + 0.45), "Puerta ropas–exterior, aluminio y vidrio", ropas);
        this.window(v(gx((split + 0.12 + Wd) / 2), 0.1), 1.0, 1.5, 0.6, "Ventana alta de ropas", ropas);
        this.window(v(gx(split / 2), 0.1), 0.8, 1.6, 0.5, "Ventana de ventilación cuarto técnico", tech);
        const ur = (u: number) => gx(u);
        this.dev("electrodomestico", v(ur(Wd - 0.35), y0), 0, { ancho_m: 0.6, fondo_m: 0.65, rotulo: "LAV", tipo: "redondo" });
        this.dev("electrodomestico", v(ur(Wd - 1.0), y0), 0, { ancho_m: 0.6, fondo_m: 0.65, rotulo: "SEC", tipo: "redondo" });
        this.dev("lavaplatos", v(gx(split + 0.12), round(y1 - 0.45)), rot(R_W), { ancho_m: 0.6 });
        this.dev("mueble", v(gx(split + 0.12), round(y1 - 0.45)), rot(R_W), { ancho_m: 0.8, fondo_m: 0.6, rotulo: "", carpinteria: "Mueble de lavadero" });
        this.tg = this.G(v(gx(split / 2), round(y1 - 0.1)));
        this.b.device("ELE", "tablero", v(gx(split / 2), round(y1 - 0.1)), 1.5, { tablero: "TG", descripcion: "Tablero general TG" }, { rot: PI, tag: "TG" });
        this.b.device("DOM", "rack", v(gx(split / 2), round(y0 + 0.3)), 0.4, { descripcion: "Rack de comunicaciones: router, switch PoE, NVR, UPS" });
        break;
      }
      case "alcoba-servicio": {
        const split = 1.75;
        this.wall(v(ax(split + 0.06), y0a), v(ax(split + 0.06), y1a), "humedo");
        const bath = mk("bano", "Baño de servicio", 0, split);
        const room = mk("servicio", "Alcoba de servicio", split + 0.12, Wd);
        this.door(v(gx((split + 0.12 + Wd) / 2), y0a), 0.8, v(gx((split + Wd) / 2 + 0.2), y0 + 0.6), v(gx(Wd - 0.2), y0a), "Puerta alcoba de servicio", room);
        this.door(v(ax(split + 0.06), round(y1 - 0.55)), 0.7, v(gx(0.8), round(y1 - 0.55)), v(ax(split + 0.06), round(y1 - 0.15)), "Puerta baño de servicio", bath);
        facWin(room, yc, 1.2, 1.0, 1.2, "Ventana alcoba de servicio");
        this.dev("cama", v(gx(Wd), yc), rot(R_E), { ancho_m: 1.0, largo_m: 1.9, mesas: 0 });
        this.dev("mueble", v(gx(split + 0.12), round(y0 + 0.9)), rot(R_W), { ancho_m: 1.2, fondo_m: 0.55, tipo: "closet", carpinteria: "Clóset alcoba de servicio" });
        this.dev("ducha", v(gx(split / 2), y1), R_N, { ancho_m: Math.min(1.0, split), fondo_m: 0.9 });
        this.dev("wc", v(gx(split - 0.4), y0), 0);
        this.dev("lavamanos", v(gx(0), round(y0 + 0.9)), rot(R_W), { ancho_m: 0.5 });
        break;
      }
      case "bano-social": {
        const bw = 1.7;
        this.wall(v(ax(bw + 0.06), y0a), v(ax(bw + 0.06), y1a), "humedo");
        const bath = mk("bano-social", "Baño social", 0, bw);
        const desp = mk("ropas", "Despensa", bw + 0.12, Wd, { lux_objetivo: 150 });
        hallDoor(bath, y0 + 0.5, 0.8, "Puerta baño social, entamborada lacada", true);
        this.door(v(gx((bw + 0.12 + Wd) / 2), y1a), 0.8, v(gx((bw + Wd) / 2), y1 - 0.6), v(gx(Wd - 0.2), y1a), "Puerta despensa", desp);
        this.dev("wc", v(gx(0.85), y1), R_N);
        this.dev("lavamanos", v(gx(bw), round(y0 + 0.65)), rot(R_E), { ancho_m: 0.7 });
        this.dev("mueble", v(gx(Wd), yc), rot(R_E), { ancho_m: round(D - 0.2), fondo_m: 0.45, tipo: "alto", rotulo: "", carpinteria: "Alacena de despensa" });
        break;
      }
      case "cocina": {
        const r = mk("cocina", "Cocina");
        if (this.p.cocina === "cerrada") hallDoor(r, yc, 0.9, "Puerta de cocina, vaivén en madera lacada");
        // Mesón contra la fachada, nevera y torre de hornos al sur.
        this.dev("electrodomestico", v(gx(Wd), round(y0 + 0.5)), rot(R_E), { ancho_m: 0.9, fondo_m: 0.7, rotulo: "NEV" });
        this.dev("mueble", v(gx(Wd), round(y0 + 1.3)), rot(R_E), { ancho_m: 0.7, fondo_m: 0.6, tipo: "alto", rotulo: "HORNO", carpinteria: "Torre de hornos" });
        const mlen = round(D - 1.75);
        this.dev("mueble", v(gx(Wd), round(y0 + 1.65 + mlen / 2)), rot(R_E), { ancho_m: mlen, fondo_m: 0.6, rotulo: "", carpinteria: "Mueble inferior de cocina con encimera en cuarzo" });
        this.dev("lavaplatos", v(gx(Wd), round(y0 + 1.65 + mlen / 2)), rot(R_E), { ancho_m: 0.9 });
        facWin(r, round(y0 + 1.65 + mlen / 2), round(Math.min(3.2, mlen - 0.3)), 1.0, 1.4, "Ventana de cocina sobre mesón");
        const islandOk = this.p.isla && Wd >= 3.9;
        if (islandOk) {
          const iu = Wd - 0.6 - 1.15;
          const il = Math.min(2.6, D - 1.2);
          this.dev("mueble", v(gx(iu), yc), rot(R_E), { ancho_m: round(il), fondo_m: 1.0, rotulo: "", carpinteria: "Isla de cocina con barra" });
          this.dev("estufa", v(gx(iu), yc), rot(R_E), { tipo: this.p.gas === "no" ? "induccion" : "gas" });
        } else this.dev("estufa", v(gx(Wd), round(y1 - 0.6)), rot(R_E), { tipo: this.p.gas === "no" ? "induccion" : "gas" });
        break;
      }
      case "comedor": {
        const r = mk("social", "Comedor");
        const seats = Math.max(2, Math.min(5, Math.floor((Math.min(Wd, 6) - 1.0) / 0.65)));
        this.dev("mesa", v(gx(Wd / 2), yc), 0, { ancho_m: round(seats * 0.65), fondo_m: 1.0, sillas_lado: seats });
        this.dev("mueble", v(gx(0.2), yc), rot(R_W), { ancho_m: Math.min(2.0, D - 0.8), fondo_m: 0.45, rotulo: "BUFFET", carpinteria: "Buffet de comedor" });
        facWin(r, yc, big ? D - 0.8 : wh(Wd * D, 2.0), big ? 0 : 0.6, big ? 2.6 : 2.0, "Ventanal comedor");
        break;
      }
      case "sala": {
        const r = mk("social", "Sala");
        this.dev("mueble", v(gx(0.1), yc), rot(R_W), { ancho_m: Math.min(2.6, D - 1), fondo_m: 0.45, rotulo: "TV · CHIMENEA", carpinteria: "Mueble de TV y chimenea" });
        const back = Math.min(Wd - 0.25, 3.6);
        this.dev("sofa", v(gx(back), yc), rot(R_E), { ancho_m: Math.min(2.8, D - 1.2), fondo_m: 0.95 });
        this.dev("mueble", v(gx(back - 1.95), yc), rot(R_E), { ancho_m: 1.2, fondo_m: 0.6, rotulo: "", carpinteria: "Mesa de centro" });
        facWin(r, yc, big ? D - 0.8 : wh(Wd * D, 2.2), big ? 0 : 0.5, big ? 2.6 : 2.2, "Ventanal sala");
        if (y1a >= this.L - 0.11) this.window(v(gx(Wd / 2), round(this.L - 0.1)), Math.min(Wd - 0.8, 4.8), 0, 2.6, "Puerta-ventana corrediza a la terraza", r);
        break;
      }
      case "estudio": {
        const r = mk("estudio", "Estudio");
        hallDoor(r, y0 + 0.55, 0.9, "Puerta estudio, madera de roble", true);
        this.dev("mueble", v(gx(Wd), yc), rot(R_E), { ancho_m: Math.min(1.8, D - 0.6), fondo_m: 0.7, rotulo: "ESCRITORIO", carpinteria: "Escritorio" });
        this.dev("mueble", v(gx(1.2 + (Wd - 1.2) / 2), y1), R_N, { ancho_m: round(Math.min(Wd - 1.4, 3)), fondo_m: 0.4, tipo: "alto", rotulo: "BIBLIOTECA", carpinteria: "Biblioteca a muro" });
        facWin(r, yc, wh(Wd * D, 1.6), 0.9, 1.6, "Ventana estudio");
        southWin(r, 1.6, 0.9, 1.6, "Ventana estudio (sur)");
        break;
      }
      case "estar": {
        const r = mk("social", f > 1 ? "Estar familiar" : "Estar de TV");
        if (f === 1) hallDoor(r, y0 + 0.55, 0.9, "Puerta estar, madera de roble", true);
        this.dev("mueble", v(gx(Wd), yc), rot(R_E), { ancho_m: Math.min(2.4, D - 1), fondo_m: 0.45, rotulo: "TV", carpinteria: "Mueble de TV" });
        if (Wd > 2.6) this.dev("sofa", v(gx(Math.max(0.1, Wd - 3.4)), yc), rot(R_W), { ancho_m: Math.min(2.6, D - 1.0), fondo_m: 0.9 });
        facWin(r, round(y0 + D * 0.3), wh(Wd * D, 1.8), 0.6, 1.8, "Ventana estar");
        northWin(r, 2.4, 0.6, 1.8, "Ventana estar (norte)");
        southWin(r, 2.0, 0.6, 1.8, "Ventana estar (sur)");
        break;
      }
      case "deposito": {
        const r = mk("tecnico", "Depósito", 0, Wd, { lux_objetivo: 150 });
        hallDoor(r, round(y0 + Math.min(D / 2, 0.55)), 0.8, "Puerta depósito, entamborada lacada", true);
        this.dev("mueble", v(gx(Wd), yc), rot(R_E), { ancho_m: round(Math.max(0.6, D - 0.2)), fondo_m: 0.5, tipo: "alto", rotulo: "", carpinteria: "Estantería de depósito" });
        break;
      }
      case "conexion":
        // Paso a la galería: el espacio lo crea la galería (buildLinks).
        break;
      case "escalera": {
        const r = mk("escalera", "Escalera", 0, Wd);
        this.stair(f, gx, rot, y0, Wd);
        facWin(r, yc, 1.0, 0.9, 1.8, "Ventana de escalera");
        break;
      }
      case "alcoba": {
        const guest = m.label === "H";
        const r = mk("alcoba", guest ? "Habitación de huéspedes" : `Habitación ${m.label}`);
        hallDoor(r, y0 + 0.55, 0.9, `Puerta ${guest ? "habitación de huéspedes" : "habitación " + m.label}, madera lacada`, true);
        const clo = round(D - 1.15);
        if (clo >= 1.0) this.dev("mueble", v(gx(0), round(y0 + 1.1 + clo / 2)), rot(R_W), { ancho_m: clo, fondo_m: 0.6, tipo: "closet", carpinteria: `Clóset ${r.name.toLowerCase()}` });
        const bu = 0.6 + (Wd - 0.6) / 2;
        this.dev("cama", v(gx(bu), y1), R_N, { ancho_m: Wd > 3.8 ? 1.6 : 1.4, largo_m: 2.0 });
        if (Wd - 0.6 > 3.3 && D > 3.4) this.dev("mueble", v(gx(bu), y0), 0, { ancho_m: 1.2, fondo_m: 0.5, rotulo: "ESCRITORIO", carpinteria: "Escritorio de habitación" });
        facWin(r, yc, big ? Math.min(2.4, D - 0.8) : wh(Wd * D, 1.5), big ? 0.45 : 0.9, big ? 2.15 : 1.5, `Ventana ${r.name.toLowerCase()}`);
        southWin(r, 1.6, 0.9, 1.5, `Ventana ${r.name.toLowerCase()} (sur)`);
        northWin(r, 1.6, 0.9, 1.5, `Ventana ${r.name.toLowerCase()} (norte)`);
        break;
      }
      case "bano": {
        const forH = m.privateFor === "H";
        const name = m.privateFor ? (forH ? "Baño habitación de huéspedes" : `Baño habitación ${m.privateFor}`) : `Baño habitaciones ${m.label ?? ""}`.trim();
        const r = mk("bano", name);
        if (m.privateFor) this.door(v(gx(1.25), y1a), 0.8, v(gx(1.25), round(y1 - 0.6)), v(gx(0.85), y1a), `Puerta ${name.toLowerCase()}, entamborada lacada`, r);
        else hallDoor(r, y0 + 0.5, 0.8, `Puerta ${name.toLowerCase()}, entamborada lacada`, true);
        const sw = Math.min(1.6, D - 0.1);
        this.dev("ducha", v(gx(Wd), yc), rot(R_E), { ancho_m: round(sw), fondo_m: 1.0 });
        const wcU = Wd - 1.0 - 0.55;
        this.dev("wc", v(gx(wcU), m.privateFor ? y0 : y1), m.privateFor ? 0 : R_N);
        this.dev("lavamanos", v(gx(Math.max(1.0, wcU - 1.0)), m.privateFor ? y0 : y1), m.privateFor ? 0 : R_N, { ancho_m: Wd > 3.6 ? 1.2 : 0.8, pocetas: Wd > 3.6 ? 2 : 1, carpinteria: "Mueble de lavamanos" });
        facWin(r, yc, 0.8, 1.6, 0.6, "Ventana alta de baño (vidrio esmerilado)");
        break;
      }
    }
  }

  /** Escalera en U: tramo 1 junto a la fachada, descanso al norte, tramo 2 junto al hall (llega al sur). */
  private stair(f: number, gx: (u: number) => number, rot: (r: number) => number, y0: number, Wd: number): void {
    const g = stairGeometry(this.lay.dims.floorH, this.lay.dims.flight);
    const fw = this.lay.dims.flight;
    const b = this.b;
    const sy = round(y0 + 0.1);
    const uA0 = 0; // tramo 2 (hall)
    const uB0 = fw + 0.1; // tramo 1 (fachada)
    const X = (u: number) => gx(u);
    const box = (u0: number, u1: number, ya: number, yb: number) => {
      const a = X(u0);
      const c = X(u1);
      return rect(Math.min(a, c), ya, Math.max(a, c), yb);
    };
    const land = round(sy + g.run1);
    if (f === 1 && (this.wing.key === "A" || !this.stairInfo["escalera_x0"])) this.stairInfo = { escalera_x0: round(Math.min(X(uB0), X(uB0 + fw))), escalera_x1: round(Math.max(X(uB0), X(uB0 + fw))), escalera_y0: sy, escalera_n1: g.n1, escalera_ch: round(g.riser), escalera_h: TREAD, corte_x: round((X(uB0) + X(uB0 + fw)) / 2) };
    const up = f < this.wing.floors.length;
    const down = f > 1;
    // Tramo 1 (sube hacia el norte)
    if (up || down) {
      b.note("ARQ", "outline", box(uB0, uB0 + fw, sy, land), undefined, { weight: 0.3 });
      for (let i = 1; i < g.n1 - 1; i++) b.note("ARQ", "line", [v(X(uB0), round(sy + i * TREAD)), v(X(uB0 + fw), round(sy + i * TREAD))], undefined, { weight: 0.18 });
      b.note("ARQ", "outline", box(0, uB0 + fw, land, round(land + fw)), undefined, { weight: 0.3 });
      b.note("ARQ", "outline", box(uA0, uA0 + fw, round(land - g.run2), land), undefined, { weight: 0.3 });
      for (let i = 1; i < g.n2 - 1; i++) b.note("ARQ", "line", [v(X(uA0), round(land - i * TREAD)), v(X(uA0 + fw), round(land - i * TREAD))], undefined, { weight: 0.18 });
      b.note("ARQ", "line", [v(X(fw + 0.05), sy), v(X(fw + 0.05), round(land))], undefined, { weight: 0.35 });
    }
    if (up) b.note("ARQ", "arrow", [v(X(uB0 + fw / 2), round(sy + 0.15)), v(X(uB0 + fw / 2), round(land + fw / 2)), v(X(uA0 + fw / 2), round(land + fw / 2)), v(X(uA0 + fw / 2), round(land - g.run2 + 0.4))], `SUBE ${g.n} CH`, {}, 1.8);
    if (down) {
      b.note("ARQ", "arrow", [v(X(uA0 + fw / 2), round(land - g.run2 + 0.3)), v(X(uA0 + fw / 2), round(land + fw / 2)), v(X(uB0 + fw / 2), round(land + fw / 2)), v(X(uB0 + fw / 2), round(sy + 0.6))], "BAJA", {}, 1.8);
      // Baranda en vidrio alrededor del vacío
      b.note("ARQ", "dashed", [v(X(uA0 + fw), round(land - g.run2)), v(X(uA0 + fw), round(land + fw)), v(X(Wd), round(land + fw))], undefined, { weight: 0.35, descripcion: "Baranda en vidrio templado" });
    }
    b.note("ARQ", "text", [v(X(uB0 + fw / 2), round(sy + g.run1 / 2))], `CH ${(g.riser * 100).toFixed(1)} · H ${(TREAD * 100).toFixed(0)}`, { align: "center", rot: PI / 2 }, 1.5);
    void rot;
  }

  /** Suite principal: habitación al sur, vestier y baño al norte. */
  private suite(f: number, ys: number, top: number): void {
    const { xa, xe } = this.wing;
    const { suiteBed } = this.lay.dims;
    const ym2 = round(ys + suiteBed);
    const xs = round(xa + Math.max(2.3, (xe - xa) * 0.42));
    this.wall(v(xa, ym2), v(xe, ym2), "humedo");
    this.wall(v(xs, ym2), v(xs, top), "humedo");
    const bx0 = round(xa + (xa - 0.1 < 0.01 ? 0.1 : 0.06));
    const bx1 = round(xe - 0.1);
    const by0 = round(ys + 0.06);
    const by1 = round(ym2 - 0.06);
    const bed = this.room(f, "principal", "Habitación principal", bx0, by0, bx1, by1);
    const closet = this.room(f, "vestier", "Vestier principal", bx0, round(ym2 + 0.06), round(xs - 0.06), round(top - 0.1));
    const bath = this.room(f, "bano", "Baño principal", round(xs + 0.06), round(ym2 + 0.06), bx1, round(top - 0.1));
    const hallMid = round((xa + this.wing.xb) / 2);
    this.door(v(hallMid, ys), 1.0, v(hallMid, by0 + 0.8), v(round(hallMid - 0.5), ys), "Puerta habitación principal, madera de roble h = 2.40", bed);
    this.door(v(round(bx0 + 0.6), ym2), 0.9, v(round(bx0 + 0.6), round(ym2 + 0.8)), v(round(bx0 + 0.15), ym2), "Puerta vestier, corrediza en roble", closet);
    this.door(v(xs, round(ym2 + 0.6)), 0.8, v(round(xs + 0.6), round(ym2 + 0.6)), v(xs, round(ym2 + 0.15)), "Puerta baño principal, corrediza oculta", bath);
    const big = this.st.floorToCeiling;
    const D = by1 - by0;
    this.window(v(xe, round((by0 + by1) / 2)), Math.min(D - 0.8, big ? 3.2 : 2.4), big ? 0 : 0.6, big ? 2.6 : 1.8, "Ventanal habitación principal", bed);
    this.window(v(round((bx0 + xs) / 2), top), Math.min(xs - xa - 0.8, 1.6), 1.6, 0.7, "Ventana alta vestier", closet);
    this.window(v(round((xs + xe) / 2), top), Math.min(xe - xs - 0.8, 2.2), 1.6, 0.7, "Ventana alta baño principal (vidrio esmerilado)", bath);
    // Mobiliario
    const bedX = round((bx0 + 1.3 + bx1) / 2);
    this.dev("cama", v(bedX, by1), R_N, { ancho_m: 2.0, largo_m: 2.1 });
    this.dev("mueble", v(bedX, by0), 0, { ancho_m: 1.8, fondo_m: 0.45, rotulo: "TV", carpinteria: "Mueble de TV habitación principal" });
    if (bx1 - bx0 > 5.6) this.dev("sofa", v(round(bx1 - 0.05), round(by0 + D / 2)), R_E, { ancho_m: 1.6, fondo_m: 0.85 });
    const cl = round(top - 0.1 - (ym2 + 0.06));
    this.dev("mueble", v(bx0, round(ym2 + 0.06 + cl / 2)), R_W, { ancho_m: round(cl - 0.1), fondo_m: 0.6, tipo: "closet", carpinteria: "Vestier principal: módulos de colgar y cajoneras" });
    const cw = round(xs - 0.06 - bx0);
    if (cw > 2.4) this.dev("mueble", v(round(bx0 + 0.6 + (cw - 0.6) / 2), round(top - 0.1)), R_N, { ancho_m: round(cw - 0.7), fondo_m: 0.6, tipo: "closet", carpinteria: "Vestier principal: zapatero y entrepaños" });
    if (cw > 3.0 && cl > 2.4) this.dev("mueble", v(round(bx0 + cw * 0.6), round(ym2 + 0.06 + cl / 2 - 0.3)), 0, { ancho_m: 1.0, fondo_m: 0.6, rotulo: "ISLA", carpinteria: "Isla de vestier con cajones" });
    const bw = bx1 - (xs + 0.06);
    this.dev("ducha", v(round(bx1 - 0.85), round(top - 0.1)), R_N, { ancho_m: 1.6, fondo_m: 1.2 });
    this.dev("wc", v(round(bx1 - 1.7 - 0.45), round(top - 0.1)), R_N);
    this.dev("lavamanos", v(bx1, round(ym2 + 0.06 + 1.0)), R_E, { ancho_m: Math.min(1.6, cl - 0.4), pocetas: 2, carpinteria: "Mueble de lavamanos doble" });
    void bw;
  }

  private dims(f: number, west: { y0: number; y1: number }[], east: { y0: number; y1: number }[], ys: number): void {
    const { W, L, xa, xb, xe } = this.wing;
    const b = this.b;
    const isA = this.wing.key === "A";
    const cp = isA ? this.carportW() : 0;
    const westOff = cp ? cp + 1.3 : 1.3;
    // En A no se acotan los costados por donde salen galerías; en B y C el extremo de la galería es el sur local.
    const linkE = isA && this.lay.links.some((k) => k.side === "E");
    const linkW = isA && this.lay.links.some((k) => k.side === "W");
    const seg = (a: Vec2, c: Vec2, off: number) => {
      if (Math.hypot(c.x - a.x, c.y - a.y) > 0.01) b.dim(a, c, off);
    };
    if (isA) {
      seg(v(0, 0), v(W, 0), -2.1);
      seg(v(0.1, 0.1), v(xa, 0.1), -1.3);
      seg(v(xa, 0.1), v(xb, 0.1), -1.3);
      seg(v(xb, 0.1), v(xe, 0.1), -1.3);
    } else {
      seg(v(0.1, round(L - 0.1)), v(xa, round(L - 0.1)), 1.3);
      seg(v(xa, round(L - 0.1)), v(xb, round(L - 0.1)), 1.3);
      seg(v(xb, round(L - 0.1)), v(xe, round(L - 0.1)), 1.3);
    }
    const chainY = (ys_: number[], x: number, off: number) => {
      const pts = [...new Set(ys_.map((y) => round(y)))].sort((a, c) => a - c);
      for (let i = 0; i + 1 < pts.length; i++) b.dim(v(x, pts[i]!), v(x, pts[i + 1]!), off);
    };
    if (!linkW) {
      seg(v(0, 0), v(0, L), westOff + 0.8);
      chainY([0.1, ...west.map((w) => w.y1)], 0.1, westOff);
    }
    if (!linkE) {
      chainY([0.1, ...east.map((e) => Math.min(e.y1, ys)), ys, L - 0.1], xe, -1.3);
      seg(v(W, 0), v(W, L), -2.1);
    }
    seg(v(0, L), v(W, L), f === 1 && isA && this.p.terraza ? 4.9 : isA ? 1.3 : 2.1);
  }

  // ─── Galerías entre pabellones y patio ──────────────────────
  private buildLinks(): void {
    if (!this.multi) return;
    const b = this.base;
    b.levelId = this.levels[0]!;
    this.walls = [];
    const A = this.lay.wings[0]!;
    for (const k of this.lay.links) {
      const w = this.lay.wings.find((x) => x.key === k.to)!;
      const xmin = Math.min(k.xA, k.xW);
      const xmax = Math.max(k.xA, k.xW);
      const nm = w.name.toLowerCase();
      this.wall(v(xmax, k.c0), v(xmin, k.c0), "fachada", { fachada: "S" }, `Galería al ${nm} · muro sur`);
      this.wall(v(xmin, k.c1), v(xmax, k.c1), "fachada", { fachada: "N" }, `Galería al ${nm} · muro norte`);
      const east = k.side === "E";
      const band = east ? A.xe - A.xb > 0.01 : A.xa - 0.1 > 0.01;
      const x0 = east ? (band ? A.xb + 0.06 : A.xe + 0.1) : round(k.xW - 0.1);
      const x1 = east ? round(k.xW + 0.1) : band ? A.xa - 0.06 : 0.0;
      const r = this.room(1, "circulacion", `Galería al ${nm}`, round(x0), round(k.c0 + 0.1), round(x1), round(k.c1 - 0.1), { galeria: true });
      const xc = round((k.xA + k.xW) / 2);
      const ww = round(Math.abs(k.xW - k.xA) - 0.8);
      this.window(v(xc, k.c0), ww, 0.3, 2.2, "Ventanal de la galería", r, { operacion: "fixed" });
      this.window(v(xc, k.c1), ww, 0.3, 2.2, "Ventanal de la galería", r);
    }
    const pt = this.lay.patio;
    if (pt) {
      this.room(1, "terraza", "Patio central", round(pt.x0 + 0.1), round(pt.y0 + 0.1), round(pt.x1 - 0.1), round(pt.y1 - 0.1), { exterior: true });
      b.note("ARQ", "text", [v(round((pt.x0 + pt.x1) / 2), round((pt.y0 + pt.y1) / 2 - 0.8))], "NPT −0.10 · JARDÍN Y ESPEJO DE AGUA", { align: "center" }, 1.8);
      b.note("ARQ", "outline", rect(round(pt.x0 + 1.6), round(pt.y0 + 1.6), round(Math.max(pt.x0 + 3.2, pt.x1 - 1.6)), round(Math.max(pt.y0 + 3.2, (pt.y0 + pt.y1) / 2 - 1.4))), undefined, { descripcion: "Espejo de agua" });
    }
    const cl = this.lay.closure;
    if (cl) {
      const id = b.wall(this.ls["fachada"]!, v(cl.a.x, cl.a.y), v(cl.b.x, cl.b.y), 2.4, { cerramiento: true }, "Muro de cierre del patio");
      this.walls.push({ id, a: v(cl.a.x, cl.a.y), b: v(cl.b.x, cl.b.y) });
      const ym = round((cl.a.y + cl.b.y) / 2);
      this.door(v(cl.a.x, ym), 1.4, v(round(cl.a.x - 1), ym), v(cl.a.x, round(ym - 0.7)), "Portada del patio, madera maciza");
    }
  }

  // ─── Exteriores: parqueadero, terraza, acceso ───────────────
  private buildSite(): void {
    const b = this.b;
    b.levelId = this.levels[0]!;
    const { xa, xb, L } = this.lay;
    const cp = this.carportW();
    if (cp) {
      const sp = this.room(1, "parqueadero", "Parqueadero cubierto", round(-cp + 0.15), 0, -0.05, 6.2, { exterior: true });
      void sp;
      b.note("ARQ", "dashed", rect(-cp, -0.15, -0.05, 6.35), undefined, { descripcion: "Cubierta del parqueadero" });
      for (let i = 0; i < this.p.parqueaderos; i++) this.dev("carro", v(round(-cp + 0.3 + 1.55 + i * 3.1), 3.1), PI / 2);
      for (const x of [round(-cp + 0.15), -0.2]) for (const y of [0.0, 6.2]) if (x < -0.3) b.note("EST", "solid", rect(x - 0.1, y - 0.1, x + 0.1, y + 0.1), undefined, { perfil: "Columna HSS 200×200×8 mm" });
      b.note("ARQ", "text", [v(round(-cp / 2), -0.7)], "ACCESO VEHICULAR", { align: "center" }, 2);
      b.note("ARQ", "text", [v(round(-cp / 2), 5.7)], "NPT −0.15", { align: "center" }, 1.8);
    }
    if (this.p.terraza) {
      const tw = round(Math.min(xa + 0.06, 7.5));
      this.room(1, "terraza", this.st.corredor ? "Terraza y corredor cubierto" : "Terraza cubierta con BBQ", 0, round(L + 0.05), tw, round(L + 3.6), { exterior: true });
      this.dev("mesa", v(round(tw / 2 - 0.4), round(L + 1.9)), 0, { ancho_m: 1.8, fondo_m: 0.9, sillas_lado: 3 });
      this.dev("mueble", v(round(tw - 0.9), round(L + 3.6)), R_N, { ancho_m: 1.6, fondo_m: 0.65, rotulo: "BBQ", carpinteria: "Mesón de BBQ en cuarzo exterior" });
      b.note("ARQ", "text", [v(round(tw / 2), round(L + 0.45))], "NPT −0.10", { align: "center" }, 1.8);
    }
    b.note("ARQ", "outline", rect(round((xa + xb) / 2 - 0.8), -4.0, round((xa + xb) / 2 + 0.8), 0), undefined, { descripcion: "Sendero de acceso" });
    b.note("ARQ", "text", [v(round((xa + xb) / 2), -2.0)], "ACCESO PEATONAL", { align: "center", rot: PI / 2 }, 1.8);
  }

  // ─── Estructura: ejes y columnas ────────────────────────────
  private buildStructure(): void {
    for (const w of this.lay.wings) {
      this.useWing(w);
      this.structureOf(w);
    }
    this.useWing(this.lay.wings[0]!);
    this.b.levelId = this.levels[0]!;
  }

  private structureOf(w: Wing): void {
    const { xa, xb, xe, L, W } = w;
    const isA = w.key === "A";
    const pre = isA ? "" : w.key;
    const xsAx: [string, number][] = [["1", 0.1], ["2", xa], ["3", xb], ["4", xe]].filter(([, x], i, all) => i === 0 || Math.abs((x as number) - (all[i - 1]![1] as number)) > 0.01).map(([n, x], i) => [`${pre}${isA ? n : i + 1}`, x as number]);
    // Ejes en y: bordes de módulos del primer piso, sin pasar de 6.5 m de luz.
    const f1 = w.floors[0]!;
    const mods = f1.west.length ? f1.west : f1.east;
    let y = 0.1;
    const cands: number[] = [];
    for (const m of mods) (y += m.depth), cands.push(round(y));
    const ysAx: number[] = [0.1];
    let last = 0.1;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i]!;
      const next = cands[i + 1] ?? L - 0.1;
      if (c >= L - 0.2) break;
      if (next - last > 6.5) (ysAx.push(c), (last = c));
    }
    ysAx.push(round(L - 0.1));
    const letters = "ABCDEFGHIJ";
    const cp = isA ? this.carportW() : 0;
    const linkE = isA && this.lay.links.some((k) => k.side === "E");
    const linkW = isA && this.lay.links.some((k) => k.side === "W");
    for (let li = 0; li < w.floors.length; li++) {
      this.b.levelId = this.levels[li]!;
      for (const [n, x] of xsAx) {
        this.b.note("EST", "axis", [v(x, round(L + 0.5 + (li === 0 && isA && this.p.terraza ? 3.6 : 0))), v(x, round(L + (isA ? 2.6 : 3.4) + (li === 0 && isA && this.p.terraza ? 3.6 : 0)))], n);
        if (isA) this.b.note("EST", "axis", [v(x, -0.5), v(x, -3.4)], n);
      }
      ysAx.forEach((yy, i) => {
        if (!linkW) this.b.note("EST", "axis", [v(round(-0.5 - cp), yy), v(round(-3.4 - cp), yy)], `${pre}${letters[i]}`);
        if (!linkE) this.b.note("EST", "axis", [v(round(W + 0.5), yy), v(round(W + 3.4), yy)], `${pre}${letters[i]}`);
      });
      for (const [, x] of xsAx) for (const yy of ysAx) this.b.note("EST", "solid", rect(x - 0.1, yy - 0.1, x + 0.1, yy + 0.1), undefined, { perfil: "Columna en concreto / HSS 200×200×8 mm embebida en muro" });
    }
  }

  // ─── Cubierta (planta) ──────────────────────────────────────
  private buildRoof(): void {
    for (const w of this.lay.wings) {
      this.useWing(w);
      this.roofOf(w);
    }
    this.useWing(this.lay.wings[0]!);
    const b = this.b;
    b.levelId = this.roofLevel;
    for (const k of this.lay.links) {
      const x0 = Math.min(k.xA, k.xW),
        x1 = Math.max(k.xA, k.xW);
      b.note("ARQ", "outline", rect(round(x0 + 0.1), round(k.c0 - 0.15), round(x1 - 0.1), round(k.c1 + 0.15)), undefined, { weight: 0.4, descripcion: "Cubierta plana de la galería" });
      b.note("ARQ", "arrow", [v(round((x0 + x1) / 2), round(k.c1 - 0.2)), v(round((x0 + x1) / 2), round(k.c0 + 0.1))], "1.5 %");
    }
  }

  private roofOf(w: Wing): void {
    const b = this.b;
    b.levelId = this.roofLevel;
    const isA = w.key === "A";
    const { W, L } = w;
    const e = this.p.cubierta === "plana" ? 0 : this.st.alero;
    const x0 = -e,
      y0 = -e,
      x1 = W + e,
      y1 = L + e;
    b.note("ARQ", "outline", rect(x0, y0, x1, y1), undefined, { weight: 0.5 });
    b.note("ARQ", "dashed", rect(0, 0, W, L), undefined, {});
    const s = this.p.cubierta === "plana" ? 1.5 : this.p.pendiente;
    const t = this.p.cubierta;
    const cx = W / 2,
      cy = L / 2;
    const arrow = (a: Vec2, c: Vec2) => b.note("ARQ", "arrow", [a, c], `${s} %`);
    if (t === "dos-aguas") {
      // Cumbrera paralela al lado largo.
      if (L >= W) {
        b.note("ARQ", "line", [v(cx, y0), v(cx, y1)], undefined, { weight: 0.5 });
        for (const y of [L * 0.25, L * 0.75]) arrow(v(cx - 0.5, round(y)), v(x0 + 1, round(y))), arrow(v(cx + 0.5, round(y)), v(x1 - 1, round(y)));
      } else {
        b.note("ARQ", "line", [v(x0, cy), v(x1, cy)], undefined, { weight: 0.5 });
        for (const x of [W * 0.25, W * 0.75]) arrow(v(round(x), cy - 0.5), v(round(x), y0 + 1)), arrow(v(round(x), cy + 0.5), v(round(x), y1 - 1));
      }
    } else if (t === "cuatro-aguas") {
      const h = Math.min(x1 - x0, y1 - y0) / 2;
      const r0 = L >= W ? v(round(cx), round(y0 + h)) : v(round(x0 + h), round(cy));
      const r1 = L >= W ? v(round(cx), round(y1 - h)) : v(round(x1 - h), round(cy));
      b.note("ARQ", "line", [r0, r1], undefined, { weight: 0.5 });
      for (const [c, r] of [[v(x0, y0), r0], [v(x1, y0), L >= W ? r0 : r1], [v(x0, y1), L >= W ? r1 : r0], [v(x1, y1), r1]] as const) b.note("ARQ", "line", [c, r], undefined, { weight: 0.35 });
      arrow(v(round(cx), round(y0 + h * 0.6)), v(round(cx), round(y0 + 0.6)));
      arrow(v(round(cx), round(y1 - h * 0.6)), v(round(cx), round(y1 - 0.6)));
      arrow(v(round(x0 + h * 0.6), round(cy)), v(round(x0 + 0.6), round(cy)));
      arrow(v(round(x1 - h * 0.6), round(cy)), v(round(x1 - 0.6), round(cy)));
    } else if (t === "una-agua") {
      for (const y of [L * 0.25, L * 0.75]) arrow(v(x0 + 1, round(y)), v(x1 - 1, round(y)));
      b.note("ARQ", "text", [v(round(x0 - 0.6), round(cy))], "BORDE ALTO", { rot: PI / 2, align: "center", bold: true }, 2);
      b.note("ARQ", "text", [v(round(x1 + 0.6), round(cy))], "BORDE BAJO", { rot: PI / 2, align: "center", bold: true }, 2);
    } else {
      b.note("ARQ", "outline", rect(0.2, 0.2, W - 0.2, L - 0.2), undefined, { weight: 0.25, descripcion: "Antepecho" });
      for (const [a, c] of [[v(cx, cy), v(1.2, 1.2)], [v(cx, cy), v(W - 1.2, L - 1.2)]] as const) arrow(a, c);
      for (const at of [v(0.6, 0.6), v(round(W - 0.6), round(L - 0.6))]) b.device("SAN", "bajante", at, 0, { ocultar_rotulo: true }, { name: "Sifón de cubierta con bajante Ø4\"" });
    }
    if (isA) {
      b.note("ARQ", "text", [v(round(cx), round(y0 - 1.0))], `CUBIERTA ${ROOF_NAMES[t].toUpperCase()}`, { align: "center", bold: true }, 2.2);
      b.note("ARQ", "text", [v(round(cx), round(y0 - 1.7))], this.st.roofSpec.toUpperCase().slice(0, 110), { align: "center" }, 1.5);
    } else b.note("ARQ", "text", [v(round(cx), round(y1 + 1.0))], `CUBIERTA ${w.name.toUpperCase()}`, { align: "center", bold: true }, 2.0);
    if (!isA) return;
    const cp = this.carportW();
    if (cp) {
      b.note("ARQ", "outline", rect(-cp, -0.15, x0 < -0.05 ? x0 : -0.05, 6.35), undefined, { weight: 0.4 });
      b.note("ARQ", "text", [v(round(-cp / 2), 3.2)], "CUBIERTA PARQUEADERO", { align: "center", bold: true }, 1.8);
    }
    if (this.p.terraza) {
      const tw = Math.min(this.lay.xa + 0.06, 7.5);
      b.note("ARQ", "outline", rect(0, round(L + (e > 0 ? e : 0)), round(tw), round(L + 3.6)), undefined, { weight: 0.4 });
      b.note("ARQ", "text", [v(round(tw / 2), round(L + 2.6))], "CUBIERTA TERRAZA", { align: "center", bold: true }, 1.8);
    }
  }

  // ─── Eléctrica e iluminación ────────────────────────────────
  private buildElectrical(): void {
    const b = this.b;
    type Out = { at: Vec2; floor: number; h: number; va: number; sym: string; name?: string };
    const general: Out[] = [];
    const counter: Out[] = [];
    const bathOuts: Out[] = [];
    const lights = new Map<number, Out[]>();
    const exterior: Out[] = [];
    const special: { c: string; desc: string; v: 120 | 240; br: number; awg: string; tipo: string; cont?: boolean; outs: Out[] }[] = [];
    const nearDoor = (r: Room, pt: Vec2) => r.doors.some((d) => Math.hypot(d.x - pt.x, d.y - pt.y) < 0.75);
    const perimeterPts = (r: Room, n: number): Vec2[] => {
      const w = r.x1 - r.x0;
      const h = r.y1 - r.y0;
      const per = 2 * (w + h);
      const out: Vec2[] = [];
      for (let i = 0; i < n * 3 && out.length < n; i++) {
        const s = ((i + 0.5) * per) / (n * 3);
        let pt: Vec2;
        if (s < w) pt = v(r.x0 + s, r.y0 + 0.12);
        else if (s < w + h) pt = v(r.x1 - 0.12, r.y0 + (s - w));
        else if (s < 2 * w + h) pt = v(r.x1 - (s - w - h), r.y1 - 0.12);
        else pt = v(r.x0 + 0.12, r.y1 - (s - 2 * w - h));
        if (i % 3 !== 1) continue;
        if (!nearDoor(r, pt)) out.push(pt);
      }
      return out;
    };
    for (const r of this.rooms) {
      b.levelId = r.level;
      const area = (r.x1 - r.x0) * (r.y1 - r.y0);
      const add = (list: Out[], sym: string, pts: Vec2[], h: number, va: number, name?: string) => list.push(...pts.map((at) => ({ at, floor: r.floor, h, va, sym, ...(name ? { name } : {}) })));
      // Tomas
      switch (r.type) {
        case "social":
        case "estudio":
        case "alcoba":
        case "principal":
        case "servicio":
          add(general, "toma", perimeterPts(r, Math.max(3, Math.ceil((2 * (r.x1 - r.x0 + r.y1 - r.y0)) / 3.6))), 0.3, 180);
          break;
        case "circulacion":
        case "vestier":
        case "tecnico":
          add(general, "toma", perimeterPts(r, Math.max(1, Math.round(area / 10))), 0.3, 180);
          break;
        case "cocina":
          add(counter, "toma-gfci", perimeterPts(r, 4), 1.1, 500);
          special.push({ c: "", desc: "Nevera", v: 120, br: 20, awg: "12", tipo: "fijo", outs: [{ at: v(r.x0 + 0.15, r.y0 + 0.5), floor: r.floor, h: 0.6, va: 600, sym: "toma-especial", name: "Nevera" }] });
          special.push({ c: "", desc: "Lavavajillas", v: 120, br: 20, awg: "12", tipo: "fijo", outs: [{ at: v((r.x0 + r.x1) / 2, r.y0 + 0.15), floor: r.floor, h: 0.3, va: 1200, sym: "toma-especial", name: "Lavavajillas" }] });
          if (this.p.gas === "no") special.push({ c: "", desc: "Cubierta de inducción 7.2 kW", v: 240, br: 40, awg: "8", tipo: "fijo", outs: [{ at: v((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2), floor: r.floor, h: 0.3, va: 7200, sym: "toma-240", name: "Cubierta de inducción" }] });
          else add(counter, "toma-gfci", [v((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)], 0.3, 180, "Encendido electrónico de la cubierta a gas");
          special.push({ c: "", desc: "Horno eléctrico 3.6 kW", v: 240, br: 20, awg: "12", tipo: "fijo", outs: [{ at: v(r.x0 + 0.15, r.y0 + 1.3), floor: r.floor, h: 0.6, va: 3600, sym: "toma-240", name: "Horno eléctrico" }] });
          break;
        case "bano":
        case "bano-social":
          add(bathOuts, "toma-gfci", perimeterPts(r, 1), 1.1, 180);
          break;
        case "ropas":
          if (r.name === "Ropas") {
            special.push({ c: "", desc: "Lavadora y plancha", v: 120, br: 20, awg: "12", tipo: "lavanderia", outs: [{ at: v((r.x0 + r.x1) / 2, r.y0 + 0.15), floor: r.floor, h: 1.1, va: 1500, sym: "toma-gfci", name: "Lavadora" }] });
            if (this.p.gas === "no") {
              special.push({ c: "", desc: "Secadora eléctrica 5 kW", v: 240, br: 30, awg: "10", tipo: "fijo", outs: [{ at: v(r.x1 - 0.2, r.y0 + 0.15), floor: r.floor, h: 1.1, va: 5000, sym: "toma-240", name: "Secadora" }] });
              special.push({ c: "", desc: "Calentador de acumulación 4.5 kW", v: 240, br: 30, awg: "10", tipo: "fijo", cont: true, outs: [{ at: v(r.x1 - 0.2, r.y1 - 0.2), floor: r.floor, h: 1.8, va: 4500, sym: "toma-240", name: "Calentador de agua" }] });
            } else
              special.push({ c: "", desc: "Secadora a gas y calentador de paso (motor, encendido y tiro forzado)", v: 120, br: 20, awg: "12", tipo: "fijo", outs: [
                { at: v(r.x1 - 0.2, r.y0 + 0.15), floor: r.floor, h: 1.1, va: 600, sym: "toma-especial", name: "Secadora a gas" },
                { at: v(r.x1 - 0.2, r.y1 - 0.2), floor: r.floor, h: 1.8, va: 200, sym: "toma-especial", name: "Calentador de paso a gas" },
              ] });
          } else add(general, "toma", perimeterPts(r, 1), 0.3, 180);
          break;
        case "terraza":
          add(exterior, "toma-ip", perimeterPts(r, 2), 0.4, 180);
          break;
        case "parqueadero":
          add(exterior, "toma-ip", [v(r.x1 - 0.15, 3.1)], 0.4, 180);
          if (this.p.cargadorEV) for (let i = 0; i < this.p.parqueaderos; i++) special.push({ c: "", desc: `Cargador vehículo eléctrico ${i + 1}`, v: 240, br: 40, awg: "8", tipo: "ev", cont: true, outs: [{ at: v(round(r.x0 + 1.55 + i * 3.1), 6.05), floor: 1, h: 1.2, va: 7680, sym: "ev", name: `Cargador EV ${i + 1}` }] });
          break;
        default:
          break;
      }
      // Iluminación por el método de los lúmenes (CU 0.55, FM 0.8).
      const lux = LUX[r.type];
      if (lux > 0) {
        const lm = r.type === "social" || r.type === "cocina" || r.type === "estudio" ? 1600 : 1000;
        const n = Math.max(1, Math.ceil((lux * area) / (lm * 0.55 * 0.8)));
        const ratio = (r.x1 - r.x0) / (r.y1 - r.y0);
        let nx = Math.max(1, Math.round(Math.sqrt(n * ratio)));
        let ny = Math.max(1, Math.ceil(n / nx));
        if (nx * ny < n) nx++;
        const wet = r.type === "bano" || r.type === "bano-social";
        const sym = wet ? "downlight-ip" : "downlight";
        const props = lm === 1600 ? { w: 18, va: 18, lm: 1600, descripcion: "Downlight LED 18 W, 1600 lm, 3000 K, IRC 90, UGR < 19" } : { w: 12, va: 12, lm: 1000, descripcion: wet ? "Downlight LED 12 W IP44, 1000 lm, 3000 K" : "Downlight LED 12 W, 1000 lm, 3000 K, IRC 90" };
        const list = lights.get(r.floor) ?? [];
        for (let j = 0; j < ny; j++)
          for (let i = 0; i < nx; i++) {
            const at = v(r.x0 + ((r.x1 - r.x0) * (i + 0.5)) / nx, r.y0 + ((r.y1 - r.y0) * (j + 0.5)) / ny);
            b.device("ILU", sym, at, CEILING, { ...props, ocultar_rotulo: true, circuito: "", tablero: "TG" });
            list.push({ at, floor: r.floor, h: CEILING, va: props.va, sym });
          }
        if (wet && !r.facades.length) b.device("ILU", "extractor", v(r.x1 - 0.4, r.y1 - 0.4), CEILING, { w: 15, va: 15, lm: 0, circuito: "", tablero: "TG", ocultar_rotulo: true });
        lights.set(r.floor, list);
      }
    }
    // Apliques exteriores en las puertas de fachada y la terraza.
    b.levelId = this.levels[0]!;
    const { xa, xb, L } = this.lay;
    exterior.push({ at: v(round((xa + xb) / 2 - 1.0), -0.1), floor: 1, h: 2.2, va: 10, sym: "aplique" }, { at: v(round((xa + xb) / 2 + 1.0), -0.1), floor: 1, h: 2.2, va: 10, sym: "aplique" });
    if (this.p.terraza) exterior.push({ at: v(1.0, round(L + 0.1)), floor: 1, h: 2.2, va: 10, sym: "aplique" }, { at: v(round(xa - 1.0), round(L + 0.1)), floor: 1, h: 2.2, va: 10, sym: "aplique" });

    // ─── Circuitos ───
    let cn = 0;
    const circuits: { number: string; outs: Out[]; disc: "ELE" | "ILU"; cond: string }[] = [];
    const circuit = (desc: string, voltage: 120 | 240, breakerA: number, awg: string, tipo: string, outs: Out[], disc: "ELE" | "ILU" = "ELE", continuous = false) => {
      const number = `C${++cn}`;
      b.circuit({ number, panel: "TG", description: desc, voltage, phase: voltage === 240 ? "AB" : cn % 2 ? "A" : "B", breakerA, conductorAwg: awg, conduit: awg === "8" ? "PVC 1\"" : "PVC 3/4\"", properties: { tipo }, ...(continuous ? { continuous: true } : {}) });
      circuits.push({ number, outs, disc, cond: `2#${awg}+1#${awg === "8" ? "10" : awg}T` });
      return number;
    };
    // Alumbrado: un circuito por piso (se divide si pasa de 1200 W).
    for (const [floor, list] of [...lights.entries()].sort((a, c) => a[0] - c[0])) {
      const chunks = splitBy(list, 1200, (o) => o.va);
      chunks.forEach((ch, i) => circuit(`Alumbrado piso ${floor}${chunks.length > 1 ? ` (${i + 1})` : ""}`, 120, 15, "14", "alumbrado", ch, "ILU"));
    }
    if (exterior.filter((o) => o.sym === "aplique").length) circuit("Alumbrado exterior", 120, 15, "14", "alumbrado", exterior.filter((o) => o.sym === "aplique"), "ILU");
    const byFloor = (list: Out[]) => [...new Set(list.map((o) => o.floor))].sort().map((f) => list.filter((o) => o.floor === f));
    for (const fl of byFloor(general)) for (const [i, ch] of splitN(fl, 8).entries()) circuit(`Tomas generales piso ${fl[0]!.floor}${i ? ` (${i + 1})` : ""}`, 120, 20, "12", "tomas", ch);
    for (const ch of splitN(counter, 2)) circuit("Tomas mesón de cocina (GFCI)", 120, 20, "12", "pequenos-artefactos", ch);
    for (const fl of byFloor(bathOuts)) circuit(`Tomas baños piso ${fl[0]!.floor} (GFCI)`, 120, 20, "12", "tomas", fl);
    const ext = exterior.filter((o) => o.sym !== "aplique");
    if (ext.length) circuit("Tomas exteriores IP66 (GFCI)", 120, 20, "12", "tomas", ext);
    for (const s of special) circuit(s.desc, s.v, s.br, s.awg, s.tipo, s.outs, "ELE", !!s.cont);
    circuit("Reserva equipada", 120, 20, "12", "reserva", []);
    circuit("Reserva equipada", 120, 20, "12", "reserva", []);

    // Salidas eléctricas (las luminarias ya existen: se les asigna circuito) y recorridos.
    const lightIds = new Map<string, Id>();
    for (const e of this.b.store.entities()) if (e.kind === "Device" && e.discipline === "ILU") lightIds.set(`${this.b.store.indices.levelOfElement(e.id)}|${e.position.x}|${e.position.y}`, e.id);
    for (const c of circuits) {
      for (const fl of byFloor(c.outs)) {
        const floor = fl[0]!.floor;
        b.levelId = this.levels[floor - 1]!;
        for (const o of fl) {
          if (c.disc === "ILU" && o.sym !== "aplique") {
            const id = lightIds.get(`${b.levelId}|${o.at.x}|${o.at.y}`);
            const d = id ? this.b.store.getEntity(id) : undefined;
            if (d && d.kind === "Device") this.b.put({ ...d, properties: { ...(d.properties ?? {}), circuito: c.number, tablero: "TG" } });
          } else b.device(c.disc === "ILU" ? "ILU" : "ELE", o.sym, o.at, o.h, { circuito: c.number, tablero: "TG", va: o.va, ...(o.sym === "aplique" ? { w: 10, lm: 700 } : {}) }, o.name ? { name: o.name } : {});
        }
        for (const [wk, group] of this.byWing(fl.map((o) => o.at))) {
          const r = this.feed(wk, floor);
          const pts = chain(r.start, group);
          const extra = round(r.extra + (floor > 1 ? (floor - 1) * this.lay.dims.floorH : 0));
          b.run_(c.disc, "CIR", [...r.lead, ...orthoPath([r.start, ...pts], "y")], { circuito: c.number, tablero: "TG", conductor: c.cond, rotulo_t: 0.5, ...(extra > 0 ? { longitud_extra_m: extra } : {}) }, `${c.number} · ${c.cond}`);
        }
      }
    }
    // Extractores: al circuito de alumbrado de su piso.
    for (const e of [...this.b.store.entities()]) {
      if (e.kind !== "Device" || e.symbol !== "extractor") continue;
      const lvl = this.b.store.indices.levelOfElement(e.id);
      const floor = this.levels.indexOf(lvl ?? "") + 1;
      const c = circuits.find((x) => x.disc === "ILU" && x.outs.some((o) => o.floor === floor));
      if (c) this.b.put({ ...e, properties: { ...(e.properties ?? {}), circuito: c.number } });
    }
    b.levelId = this.levels[0]!;
    b.device("ELE", "medidor", v(round((xa + xb) / 2 + 1.6), -3.0), 1.5, { descripcion: "Medidor de energía" });
    b.device("ELE", "spt", v(round(this.tg.x), -0.7), 0, { descripcion: "Puesta a tierra" });
    b.run_("ELE", "ACO", [v(round((xa + xb) / 2 + 1.6), -3.0), v(round(this.tg.x), -3.0), this.tg], { conductor: "acometida" }, "Acometida subterránea");
    // Conductores: si un circuito supera 3 % de caída de tensión se sube el calibre.
    const UP: Record<string, string> = { "14": "12", "12": "10", "10": "8", "8": "6", "6": "4" };
    for (let pass = 0; pass < 4; pass++) {
      const bad = circuitResults(this.b.store).filter((r) => r.dropPct > 3 && UP[r.circuit.conductorAwg]);
      if (!bad.length) break;
      for (const r of bad) this.b.put({ ...r.circuit, conductorAwg: UP[r.circuit.conductorAwg]! });
    }
  }

  /** Pabellón que contiene un punto (global). */
  wingAt(pt: Vec2): Wing {
    for (const w of this.lay.wings.slice(1)) {
      const r = this.wingRect(w);
      if (pt.x >= r.x0 - 0.05 && pt.x <= r.x1 + 0.05 && pt.y >= r.y0 - 0.05 && pt.y <= r.y1 + 0.05) return w;
    }
    return this.lay.wings[0]!;
  }
  private byWing(pts: Vec2[]): [string, Vec2[]][] {
    const m = new Map<string, Vec2[]>();
    for (const p of pts) {
      const k = this.wingAt(p).key;
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return [...m.entries()].sort((a, c) => a[0].localeCompare(c[0]));
  }
  /**
   * Alimentación desde el tablero general hasta un pabellón: en A sale del tablero; en B y C llega por
   * la galería (primer piso) o sube por un montante junto al hall (pisos superiores).
   * `lead` es el tramo dibujado hasta `start`; `extra` es la longitud no dibujada.
   */
  feed(wk: string, floor: number): { start: Vec2; lead: Vec2[]; extra: number } {
    const tg = this.tg;
    if (wk === "A") return { start: tg, lead: [], extra: 0 };
    const w = this.lay.wings.find((x) => x.key === wk)!;
    const k = this.lay.links.find((x) => x.to === wk)!;
    const A = this.lay.wings[0]!;
    const yc = round((k.c0 + k.c1) / 2);
    const hx = round((A.xa + A.xb) / 2);
    const inW = toGlobal(w.place, round((w.xa + w.xb) / 2), 0.7);
    const p2 = v(inW.x, inW.y);
    const path = [...orthoPath([tg, v(hx, yc)], "y"), p2];
    if (floor === 1) return { start: p2, lead: path.slice(0, -1), extra: 0 };
    const len = path.reduce((t, q, i) => (i ? t + Math.abs(q.x - path[i - 1]!.x) + Math.abs(q.y - path[i - 1]!.y) : 0), 0);
    return { start: p2, lead: [], extra: round(len) };
  }

  // ─── Redes hidrosanitarias, lluvias y comunicaciones ───────
  private buildNetworks(): void {
    const wings = this.lay.wings.map((w) => {
      this.useWing(w);
      return { w, b: this.b, rect: this.wingRect(w) };
    });
    this.useWing(this.lay.wings[0]!);
    const c: NetCtx = { b: this.b, p: this.p, lay: this.lay, levels: this.levels, roofLevel: this.roofLevel, rooms: this.rooms, carport: this.carportW(), tg: this.tg, eave: this.p.cubierta === "plana" ? 0 : this.st.alero, wings };
    buildWater(c);
    buildSanitary(c);
    buildRain(c);
    buildComms(c);
    if (this.p.gas !== "no") buildGas(c);
  }

  /**
   * Las plantas ocupan la mayor parte de la hoja: se mide todo lo dibujado en los niveles de las plantas
   * (muros, espacios, aparatos, recorridos, cotas y ejes) y se usa la mayor escala normalizada con la que
   * cabe en la ventana de dibujo, con el mismo encuadre en todos los pisos para que se superpongan.
   */
  private fitPlanSheets(): void {
    const st = this.base.store;
    const ents = [...st.entities()] as Entity[];
    const sheets = ents.filter((e): e is Sheet => e.kind === "Sheet" && e.disciplines.length > 0);
    if (!sheets.length) return;
    const lv = new Set(sheets.map((s) => s.levelId));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (q: Vec2, r = 0) => {
      x0 = Math.min(x0, q.x - r); y0 = Math.min(y0, q.y - r); x1 = Math.max(x1, q.x + r); y1 = Math.max(y1, q.y + r);
    };
    const onPlan = new Set<Id>();
    for (const r of st.relations()) if (r.kind === "RelContainedIn" && lv.has(r.levelId)) r.elementIds.forEach((id) => onPlan.add(id));
    for (const e of ents) {
      if (!onPlan.has(e.id)) continue;
      if (e.kind === "Wall") (add(e.start, 0.3), add(e.end, 0.3));
      else if (e.kind === "Space") e.boundary.forEach((q) => add(q));
      else if (e.kind === "Device") add(e.position, 0.4);
      else if (e.kind === "Run" || e.kind === "Annotation") e.points.forEach((q) => add(q));
    }
    if (!Number.isFinite(x0)) return;
    // Márgenes en mm de papel: burbujas de ejes y textos de cotas (12), norte (arriba a la derecha) y nombre del plano (abajo).
    const VP = sheets[0]!.viewport;
    const fit = (sc: number) => ((x1 - x0) * 1000) / sc + 2 * 12 <= VP.w && ((y1 - y0) * 1000) / sc + 12 + 22 <= VP.h;
    const scale = [50, 75, 100, 125, 150, 200, 250].find(fit) ?? 250;
    const k = scale / 1000;
    const center = v(round((x0 + x1) / 2), round((y0 + y1) / 2 + (22 - 12) / 2 * k));
    for (const s of sheets) this.base.put({ ...s, scale, viewCenter: center, fields: { ...s.fields, escala: `1:${scale}` } });
  }

  // ─── Planos ─────────────────────────────────────────────────
  private buildSheets(): void {
    const VP = { x: 30, y: 15, w: 616, h: 564 };
    const col = { x: 657, w: 168 };
    const bb = this.bbox();
    const cp = this.carportW();
    const ext = { x0: Math.min(bb.x0, -cp) - 7.5, x1: bb.x1 + 9, y0: bb.y0 - 9, y1: Math.max(bb.y1, this.lay.L + (this.p.terraza ? 3.6 : 0)) + 6 };
    let scale = 50;
    for (const s of [50, 75, 100, 125, 150, 200]) {
      scale = s;
      if (((ext.x1 - ext.x0) * 1000) / s <= VP.w && ((ext.y1 - ext.y0) * 1000) / s <= VP.h) break;
    }
    const center = v(round((ext.x0 + ext.x1) / 2), round((ext.y0 + ext.y1) / 2));
    let order = 0;
    type Blk = { type: string; x: number; y: number; w: number; h: number; title?: string; lines?: readonly string[] };
    const sheet = (number: string, title: string, levelId: Id, disciplines: string[], background: string[], blocks: Blk[], fields: Record<string, string> = {}, c: Vec2 = center, sc = scale) =>
      this.b.sheet({ order: ++order, number, title, levelId, disciplines: disciplines as never, background: background as never, paper: "A1", scale: sc, viewCenter: c, viewport: VP, blocks, fields: { escala: `1:${sc}`, ...fields } });
    const N = notes(this.p, this.st, this.lay);
    const fl = (i: number) => (this.F === 1 ? "" : ` · piso ${i + 1}`);
    const far = v(1000, 1000);
    let a = 0;
    this.levels.forEach((lvl, i) =>
      sheet(`A-${pad(++a)}`, `Planta arquitectónica amoblada${fl(i)}`, lvl, ["ARQ", "EST"], [], [
        { type: "cuadro-areas", x: col.x, y: 300, w: col.w, h: 245 },
        { type: "notas", x: col.x, y: 112, w: col.w, h: 184, lines: N.ARQ },
      ]),
    );
    sheet(`A-${pad(++a)}`, "Planta de cubierta", this.roofLevel, ["ARQ", "SAN"], [], [{ type: "notas", x: col.x, y: 112, w: col.w, h: 430, lines: N.CUB }]);
    sheet(`A-${pad(++a)}`, `Fachadas · estilo ${this.st.name.toLowerCase()}`, this.levels[0]!, [], [], [
      { type: "fachadas", x: 34, y: 20, w: 610, h: 555 },
      { type: "notas", x: col.x, y: 112, w: col.w, h: 430, lines: N.FACH },
    ], { escala: "Indicada" }, far);
    sheet(`A-${pad(++a)}`, "Corte longitudinal y corte transversal", this.levels[0]!, [], [], [
      { type: "cortes", x: 34, y: 20, w: 610, h: 555 },
      { type: "notas", x: col.x, y: 112, w: col.w, h: 430, lines: N.CORTE },
    ], { escala: "Indicada" }, far);
    // Acabados
    let ac = 0;
    sheet(`AC-${pad(++ac)}`, "Cuadro general de acabados", this.levels[0]!, [], [], [
      { type: "cuadro-acabados", x: 34, y: 20, w: 610, h: 555 },
      { type: "notas", x: col.x, y: 112, w: col.w, h: 430, lines: N.ACAB },
    ], { escala: "Sin escala" }, far);
    this.levels.forEach((lvl, i) =>
      sheet(`AC-${pad(++ac)}`, `Plano de acabados de piso${fl(i)}`, lvl, ["ARQ"], ["EST"], [
        { type: "cuadro-pisos", x: col.x, y: 200, w: col.w, h: 345 },
        { type: "notas", x: col.x, y: 112, w: col.w, h: 84, lines: (N.ACAB ?? []).slice(0, 3) },
      ]),
    );
    // Carpintería
    sheet("C-01", "Puertas: cuadro y alzados", this.levels[0]!, [], [], [
      { type: "puertas", x: 34, y: 20, w: 610, h: 555 },
      { type: "notas", x: col.x, y: 112, w: col.w, h: 430, lines: N.PUERTAS },
    ], { escala: "Indicada" }, far);
    sheet("C-02", "Ventanas: cuadro y alzados", this.levels[0]!, [], [], [
      { type: "ventanas", x: 34, y: 20, w: 610, h: 555 },
      { type: "notas", x: col.x, y: 112, w: col.w, h: 430, lines: N.VENTANAS },
    ], { escala: "Indicada" }, far);
    sheet("C-03", "Clósets y muebles en madera", this.levels[0]!, [], [], [
      { type: "muebles", x: 34, y: 20, w: 610, h: 555 },
      { type: "notas", x: col.x, y: 112, w: col.w, h: 430, lines: N.MUEBLES },
    ], { escala: "Indicada" }, far);
    // Eléctricas
    let e = 0;
    this.levels.forEach((lvl, i) =>
      sheet(`E-${pad(++e)}`, `Instalaciones eléctricas: tomas y fuerza${fl(i)}`, lvl, ["ELE"], ["ARQ", "EST"], [
        { type: "convenciones", x: col.x, y: 345, w: col.w, h: 200 },
        { type: "notas", x: col.x, y: 112, w: col.w, h: 228, lines: N.ELE },
      ]),
    );
    this.levels.forEach((lvl, i) =>
      sheet(`E-${pad(++e)}`, `Instalaciones eléctricas: iluminación${fl(i)}`, lvl, ["ILU"], ["ARQ", "EST"], [
        { type: "convenciones", x: col.x, y: 440, w: col.w, h: 105 },
        { type: "cuadro-iluminacion", x: col.x, y: 250, w: col.w, h: 185 },
        { type: "notas", x: col.x, y: 112, w: col.w, h: 133, lines: N.ILU },
      ]),
    );
    sheet(`E-${pad(++e)}`, "Diagrama unifilar, cuadro de cargas y acometida", this.levels[0]!, [], [], [
      { type: "unifilar", x: 34, y: 20, w: 260, h: 555 },
      { type: "cuadro-cargas-TG", x: 300, y: 160, w: 345, h: 415 },
      { type: "cuadro-acometida", x: 300, y: 20, w: 345, h: 135 },
      { type: "notas", x: col.x, y: 112, w: col.w, h: 430, lines: N.UNI },
    ], { escala: "Sin escala" }, far);
    this.networkSheets(sheet, N, col, fl);
  }

  private networkSheets(sheet: (number: string, title: string, levelId: Id, disciplines: string[], background: string[], blocks: { type: string; x: number; y: number; w: number; h: number; lines?: readonly string[] }[], fields?: Record<string, string>, c?: Vec2) => void, N: Record<string, string[]>, col: { x: number; w: number }, fl: (i: number) => string): void {
    let h = 0;
    this.levels.forEach((lvl, i) =>
      sheet(`H-${pad(++h)}`, `Instalaciones hidráulicas: agua fría, caliente y recirculación${fl(i)}`, lvl, ["HID"], ["ARQ", "EST"], [
        { type: "convenciones", x: col.x, y: 440, w: col.w, h: 105 },
        { type: "cuadro-hidraulico", x: col.x, y: 228, w: col.w, h: 208 },
        { type: "notas", x: col.x, y: 112, w: col.w, h: 112, lines: N.HID },
      ]),
    );
    sheet(`H-${pad(++h)}`, "Esquema vertical de montantes y bajantes", this.levels[0]!, [], [], [
      { type: "esquema-vertical", x: 34, y: 20, w: 610, h: 555 },
      { type: "notas", x: col.x, y: 112, w: col.w, h: 430, lines: [...N.HID!.slice(0, 4), ...N.SAN!.slice(2, 3)] },
    ], { escala: "Sin escala" }, v(1000, 1000));
    let s = 0;
    this.levels.forEach((lvl, i) =>
      sheet(`S-${pad(++s)}`, `Instalaciones sanitarias${i === 0 ? " y aguas lluvias" : ""}${fl(i)}`, lvl, ["SAN"], ["ARQ", "EST"], i === 0
        ? [
            { type: "convenciones", x: col.x, y: 455, w: col.w, h: 90 },
            { type: "cuadro-sanitario", x: col.x, y: 262, w: col.w, h: 189 },
            { type: "cuadro-lluvias", x: col.x, y: 182, w: col.w, h: 76 },
            { type: "notas", x: col.x, y: 112, w: col.w, h: 66, lines: N.SAN!.slice(0, 3) },
          ]
        : [
            { type: "convenciones", x: col.x, y: 455, w: col.w, h: 90 },
            { type: "cuadro-sanitario", x: col.x, y: 262, w: col.w, h: 189 },
            { type: "notas", x: col.x, y: 112, w: col.w, h: 146, lines: N.SAN },
          ]),
    );
    sheet(`S-${pad(++s)}`, "Cubierta: canales y bajantes de aguas lluvias", this.roofLevel, ["SAN"], ["ARQ"], [
      { type: "convenciones", x: col.x, y: 455, w: col.w, h: 90 },
      { type: "cuadro-lluvias", x: col.x, y: 330, w: col.w, h: 120 },
      { type: "notas", x: col.x, y: 112, w: col.w, h: 214, lines: N.SAN!.slice(5) },
    ]);
    if (this.p.gas !== "no")
      sheet("G-01", `Instalaciones de gas · ${GAS_NAMES[this.p.gas]}`, this.levels[0]!, ["GAS"], ["ARQ", "EST"], [
        { type: "convenciones", x: col.x, y: 430, w: col.w, h: 115 },
        { type: "cuadro-gas", x: col.x, y: 300, w: col.w, h: 126 },
        { type: "notas", x: col.x, y: 112, w: col.w, h: 184, lines: N.GAS },
      ]);
    let d = 0;
    this.levels.forEach((lvl, i) =>
      sheet(`D-${pad(++d)}`, `Comunicaciones, seguridad y domótica${fl(i)}`, lvl, ["DOM"], ["ARQ", "EST"], [
        { type: "convenciones", x: col.x, y: 330, w: col.w, h: 215 },
        { type: "notas", x: col.x, y: 112, w: col.w, h: 214, lines: N.DOM },
      ]),
    );
  }

  private finishProject(): void {
    // Acometida y totalizador según la demanda calculada.
    const d = serviceDemand(new BimStore(this.b.snapshot()));
    const pr = [...this.b.store.entities()].find((e) => e.kind === "Project");
    if (pr && pr.kind === "Project")
      this.b.put({
        ...pr,
        properties: {
          ...(pr.properties ?? {}),
          ...this.stairInfo,
          acometida: `Acometida subterránea ${d.feeder} en PVC`,
          totalizador: `Totalizador 2P-${d.mainBreakerA} A · DPS tipo 2 en TG`,
          tablero_TG: `Tablero general ${Math.ceil((circuitResults(new BimStore(this.b.snapshot())).length + 4) / 6) * 6} ctos. en el cuarto técnico`,
        },
      });
  }
}

const round = (n: number) => Math.round(n * 10000) / 10000;
const pad = (n: number) => String(n).padStart(2, "0");

function splitN<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}
function splitBy<T>(list: T[], max: number, w: (t: T) => number): T[][] {
  const out: T[][] = [[]];
  let acc = 0;
  for (const it of list) {
    if (acc + w(it) > max && out[out.length - 1]!.length) out.push([]), (acc = 0);
    out[out.length - 1]!.push(it);
    acc += w(it);
  }
  return out.filter((x) => x.length);
}

// ─── Notas de los planos ─────────────────────────────────────

function notes(p: HouseProgram, st: StyleDef, lay: Layout): Record<string, string[]> {
  const area = builtArea(lay).toFixed(1);
  const g = stairGeometry(lay.dims.floorH, lay.dims.flight);
  const multi = lay.wings.length > 1;
  return {
    ARQ: [
      multi
        ? `Vivienda unifamiliar ${lay.notes[0]?.replace(/^Planta /, "en planta ").replace(/:.*/, "") ?? ""}, estilo ${st.name.toLowerCase()}: ${area} m² construidos en ${lay.wings.length} pabellones (${lay.wings.map((w) => `${w.name.toLowerCase()} ${w.W.toFixed(1)} × ${w.L.toFixed(1)} m, ${w.floors.length} ${w.floors.length === 1 ? "piso" : "pisos"}`).join("; ")}).`
        : `Vivienda unifamiliar de ${p.pisos} ${p.pisos === 1 ? "piso" : "pisos"}, estilo ${st.name.toLowerCase()}: ${area} m² construidos (${lay.W.toFixed(2)} × ${lay.L.toFixed(2)} m por piso).`,
      ...(multi ? ["Galerías acristaladas entre pabellones con cubierta plana impermeabilizada; los pabellones tienen cubiertas independientes."] : []),
      "Cotas en metros. Cotas exteriores a ejes estructurales y a caras de fachada; interiores a ejes de muros.",
      `Altura libre: ${CEILING.toFixed(2)} m bajo cielo falso; altura entre pisos ${lay.dims.floorH.toFixed(2)} m.`,
      st.facadeSpec,
      "Divisiones interiores en drywall de 120 mm con aislamiento acústico; zonas húmedas en placa RH.",
      "Baños sin ventana: extracción mecánica con ducto a cubierta y rejilla de admisión en la puerta.",
      p.pisos > 1 ? `Escalera en U: ${g.n} contrahuellas de ${(g.riser * 100).toFixed(1)} cm y huellas de ${(TREAD * 100).toFixed(0)} cm (2CH + H = ${((2 * g.riser + TREAD) * 100).toFixed(1)} cm), ancho ${lay.dims.flight.toFixed(2)} m.` : "Vivienda de un piso: todas las zonas a nivel, sin escaleras.",
      "Acabados por espacio: ver cuadro general de acabados (AC-01) y planos de acabados.",
      "Puertas, ventanas, clósets y muebles: ver planos de carpintería C-01, C-02 y C-03.",
      "Diseño estructural NSR-10 por ingeniero estructural; los ejes y columnas indicados son de predimensionamiento.",
      "Verificar levantamiento topográfico, retiros y norma urbana del lote antes de implantar.",
    ],
    CUB: [st.roofSpec, `Pendiente: ${p.cubierta === "plana" ? "1.5 % hacia sifones" : p.pendiente + " %"}. Alero: ${p.cubierta === "plana" ? "sin alero, antepecho de 0.60 m" : st.alero.toFixed(2) + " m"}.`, "Canales y bajantes de aguas lluvias en PVC Ø 4\" a cajas de inspección (ver diseño hidrosanitario).", "Remates de ventilación sanitaria con sombrerete y babero.", "Aislamiento térmico y acústico bajo cubierta en lana mineral 50 mm."],
    FACH: ["Fachadas generadas desde el modelo: al mover una ventana en planta, la fachada se actualiza.", st.facadeSpec, st.windowSpec, st.doorSpec, `Cubierta ${ROOF_NAMES[p.cubierta]}: ${st.roofSpec}`],
    CORTE: ["Cortes generados desde el modelo por el eje del hall (longitudinal) y por la mitad de la casa (transversal).", `Altura entre pisos ${lay.dims.floorH.toFixed(2)} m; losa de entrepiso e = 0.25 m; cielo falso a ${CEILING.toFixed(2)} m.`, "Cimentación según estudio de suelos (NSR-10 Título H)."],
    ACAB: [
      "Los acabados se definen por espacio y se editan en el panel de cada espacio; el cuadro se actualiza solo.",
      "Pinturas: estuco plástico y pintura tipo 1 (NTC 1335) en interiores; exteriores con pintura elastomérica.",
      "Pisos de madera y porcelanato instalados sobre mortero nivelado; juntas de dilatación perimetrales.",
      "Zonas húmedas: impermeabilización en manto líquido con malla en piso de duchas y 0.30 m en muros.",
      "Muestras de todos los acabados aprobadas por el propietario antes de su compra.",
    ],
    PUERTAS: ["Medidas de vano en metros (ancho × alto). Verificar en obra antes de fabricar.", st.doorSpec, "Puertas interiores entamboradas en MDF 30 mm lacadas, marco en madera, bisagras de acero inoxidable y cerradura de manija.", "Puertas de baño con condena; puertas corredizas con riel oculto y cierre lento.", "Sentido de apertura según plantas arquitectónicas."],
    VENTANAS: ["Medidas de vano en metros (ancho × alto) y altura de antepecho sobre el NPT.", st.windowSpec, "Vidrio de seguridad (laminado o templado) en vanos a menos de 0.90 m del piso (NSR-10 Título K).", "Sellos perimetrales en silicona neutra; alfajías con gotero.", "Verificar medidas en obra antes de fabricar."],
    MUEBLES: ["Muebles en tablero aglomerado / MDF RH 18 mm con enchape en melamina de alta presión o chapa de roble natural.", "Herrajes con cierre lento (bisagras y correderas de extensión total).", "Clósets: maletero superior, módulos de colgar a 1.00 y 1.80 m, cajoneras y zapatero.", "Cocina: mueble inferior h = 0.90 m con encimera en cuarzo 20 mm; alacena superior h = 0.70 m a 1.50 m del piso.", "Medidas en metros, a verificar en obra."],
    ELE: ["Diseño según RETIE (Res. 40117 de 2024) y NTC 2050. Sistema monofásico trifilar 120/240 V.", "Tomas generales a 0.30 m; tomas de mesón a 1.10 m.", "Conductores de cobre THHN/THWN-2; calibre mínimo #12 en tomas y #14 en alumbrado.", "Protección GFCI en cocina, baños, ropas y exteriores.", "Los recorridos son esquemáticos; su longitud alimenta el cálculo de caída de tensión. Los circuitos de pisos superiores suman la subida (longitud adicional)."],
    ILU: ["Diseño según RETILAP; iluminancias por el método de los lúmenes (CU 0.55, FM 0.80).", "Luminarias LED 3000 K, IRC ≥ 90, regulables; IP44 en baños.", "Extracción mecánica en baños sin ventana."],
    HID: [
      "Diseño según NTC 1500 (Código colombiano de fontanería) y RAS. Caudales probables por el método de Hunter; velocidad máxima 1.8 m/s.",
      "Red interior en tubería multicapa PEX-AL-PEX con accesorios de compresión; agua caliente aislada con coquilla de espuma elastomérica 13 mm.",
      "Suministro: acometida PVC 1\" → medidor → tanque de reserva enterrado → equipo de presión con variador → montante MH en el hall.",
      `Agua caliente: ${p.gas === "no" ? "calentador eléctrico de acumulación" : "calentador de paso a gas de 20 L/min, tiro forzado con ducto al exterior,"} en ropas; montante MC y retorno de recirculación RC con bomba temporizada (agua caliente inmediata en todos los baños).`,
      "Registro de corte por recinto húmedo; electroválvula general comandada por los sensores de inundación (ver D).",
      "Prueba hidrostática a 150 psi durante 2 horas antes de cerrar muros y placas. Desinfección con hipoclorito antes de la entrega.",
      "Alturas de salidas: lavamanos 0.55 m, sanitario 0.20 m, ducha 1.10 m (mezclador 1.20 m), lavaplatos 0.55 m, lavadora 1.10 m.",
    ],
    SAN: [
      "Diseño según NTC 1500. Unidades de descarga por aparato; pendiente mínima 2 % en colectores interiores y exteriores.",
      "Tubería PVC sanitaria; Ø4\" en todo tramo con sanitario, Ø3\" en cocina y ropas, Ø2\" en lavamanos y rejillas.",
      "Bajantes BAN en PVC Ø4\" por el muro de fachada, con ventilación Ø2\" prolongada 0.60 m sobre la cubierta y sombrerete.",
      "Cajas de inspección en mampostería pañetada e impermeabilizada, 60×60 cm (80×80 en la caja final), tapa en concreto con marco metálico; distancia máxima entre cajas 12 m.",
      "Cocina con trampa de grasas antes de la red; sifón en cada aparato y rejilla de piso con sello hidráulico en baños y ropas.",
      "Aguas lluvias por red separada (método racional, i = 120 mm/h, C = 0.95): canales, bajantes BALL Ø4\", cajas de 50×50 cm y tanque de aprovechamiento para riego.",
      "Prueba de estanqueidad con columna de agua de 3 m durante 15 minutos antes de rellenar zanjas.",
    ],
    GAS: [
      `Diseño según NTC 2505 (instalaciones para gas), NTC 3631 (ventilación de recintos) ${p.gas === "natural" ? "y la normativa del distribuidor" : "y NTC 3853 (GLP)"}. ${p.gas === "natural" ? "Gas natural en baja presión: 20 mbar a la salida del regulador." : "GLP en baja presión: regulador de 1.ª etapa en el suministro y de 2.ª etapa a 28 mbar a la entrada de la casa."}`,
      p.gas === "natural" ? "Centro de medición en nicho de fachada con puerta ventilada, accesible desde el exterior." : p.gas === "tanque" ? "Tanque estacionario sobre base de concreto, a 3.00 m como mínimo de aberturas, linderos, sifones y fuentes de ignición, con acceso para el carrotanque." : "Caseta de pipetas exterior en mampostería, con puerta en malla, ventilación superior e inferior permanente, piso elevado y cilindros asegurados con cadena.",
      "Línea matriz enterrada en PE 100 a 0.60 m con cinta de señalización amarilla; montante y ramales en PE-AL-PE por fachada y cielo raso. El ramal a la cocina va bajo piso dentro de camisa de PVC.",
      "Diámetros por Renouard en baja presión con la caída máxima admisible en la ruta crítica (ver cuadro). Longitud equivalente 1.2 L por accesorios.",
      "Válvula de corte de 1/4 de vuelta en cada artefacto. Electroválvula general comandada por los detectores de gas (domótica).",
      "Calentador de paso tipo tiro forzado con ducto de evacuación al exterior; recintos con artefactos a gas con rejillas de ventilación permanente.",
      "Prueba de hermeticidad a 1.5 veces la presión de operación y certificación de la instalación por organismo acreditado antes de dar servicio.",
    ],
    DOM: [
      "Cableado estructurado Cat 6A (ANSI/TIA-568) desde el rack del cuarto técnico; tubería conduit independiente de la red eléctrica (separación ≥ 0.30 m).",
      "Red WiFi 6 con puntos de acceso PoE en techo; cámaras IP PoE con grabación en el NVR del rack (30 días).",
      "Domótica en bus KNX: teclados de escenas, sensores de presencia, temperatura y humedad, control de iluminación y persianas.",
      "Seguridad: detectores de humo fotoeléctricos (NFPA 72), sensores de inundación que cierran la electroválvula general, contactos magnéticos y cerradura inteligente.",
      "Videoportero IP en el acceso, integrado a la app del propietario. UPS de 1.5 kVA para el rack.",
    ],
    UNI: ["Diagrama y cuadros generados desde los circuitos y las salidas del modelo.", "Carga de cada circuito = suma de sus salidas; tomas generales a 180 VA.", "Caída de tensión ≤ 3 % por circuito; conductores aumentados donde hace falta.", "Acometida por el método estándar de NTC 2050 Sec. 220."],
  };
}
