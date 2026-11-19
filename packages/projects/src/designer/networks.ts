// Redes hidrosanitarias, de aguas lluvias y de comunicaciones y seguridad de las casas diseñadas.
// Se generan desde los aparatos que la arquitectura ya ubicó (sanitarios, lavamanos, duchas,
// lavaplatos, lavadero, lavadora) y se dimensionan con NTC 1500 (unidades de consumo y de descarga,
// método de Hunter) y el método racional para aguas lluvias.
//
// Trazado:
//  - Agua: acometida → medidor → tanque de reserva → equipo de presión → montante MH en el hall →
//    troncal por el hall de cada piso → registro por recinto → salidas. Agua caliente desde el
//    calentador de acumulación con montante MC y retorno de recirculación.
//  - Sanitaria: cada recinto húmedo del primer piso sale por su fachada a una caja de inspección;
//    los de pisos altos bajan por una bajante en el muro de fachada. Colectores perimetrales con
//    pendiente 2 % hasta la caja final y la conexión al alcantarillado (o sistema séptico).
//  - Lluvias: canales, bajantes según el área de cubierta, cajas y colector a cuneta o tanque de
//    aprovechamiento.

import type { Device, Id, Vec2 } from "@arken/core";
import { hunterFlow, renouardDrop } from "@arken/calc";
import { chain, orthoPath, v, type ProjectBuilder, type Props } from "../builder";
import type { HouseProgram } from "./program";
import { toGlobal, toLocal, type Layout, type Link, type Wing } from "./layout";
import type { Room } from "./build";

/** Pabellón para las redes: su constructor (coordenadas locales) y su rectángulo global. */
export interface WingNet {
  readonly w: Wing;
  readonly b: ProjectBuilder;
  readonly rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
}

export interface NetCtx {
  readonly b: ProjectBuilder;
  readonly p: HouseProgram;
  readonly lay: Layout;
  readonly levels: readonly Id[];
  readonly roofLevel: Id;
  readonly rooms: readonly Room[];
  readonly carport: number;
  /** Tablero general (también ubica el rack de comunicaciones). */
  readonly tg: Vec2;
  readonly eave: number;
  /** Pabellones (A primero) y galerías. */
  readonly wings: readonly WingNet[];
}

const loc = (w: Wing, q: Vec2) => {
  const r = toLocal(w.place, q.x, q.y);
  return v(r.x, r.y);
};
const glob = (w: Wing, q: Vec2) => {
  const r = toGlobal(w.place, q.x, q.y);
  return v(r.x, r.y);
};
/** Recinto en coordenadas locales del pabellón. */
function locRoom(w: Wing, r: Room): Room {
  if (w.key === "A") return r;
  const a = loc(w, v(r.x0, r.y0));
  const c = loc(w, v(r.x1, r.y1));
  return { ...r, x0: Math.min(a.x, c.x), y0: Math.min(a.y, c.y), x1: Math.max(a.x, c.x), y1: Math.max(a.y, c.y) };
}
function locFixture(w: Wing, f: Fixture, rooms: Map<Id, Room>): Fixture {
  if (w.key === "A") return f;
  return { ...f, at: loc(w, f.at), drain: loc(w, f.drain), room: rooms.get(f.room.id)! };
}
/** Galería que llega a un pabellón. */
const linkOf = (c: NetCtx, key: string): Link | undefined => c.lay.links.find((k) => k.to === key);
/** ¿El punto (con un radio) queda libre de pabellones, galerías y parqueadero? */
function isFree(c: NetCtx, q: Vec2, r: number): boolean {
  const m = r + c.eave + 0.4;
  for (const wn of c.wings) if (q.x > wn.rect.x0 - m && q.x < wn.rect.x1 + m && q.y > wn.rect.y0 - m && q.y < wn.rect.y1 + m) return false;
  for (const k of c.lay.links) if (q.x > Math.min(k.xA, k.xW) - r && q.x < Math.max(k.xA, k.xW) + r && q.y > k.c0 - r - 0.3 && q.y < k.c1 + r + 0.3) return false;
  if (c.carport && q.x > -c.carport - r - 0.3 && q.x < r && q.y > -0.15 - r && q.y < 6.35 + r) return false;
  return true;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Traza un recorrido descartando puntos repetidos; omite los de longitud nula. */
function run(b: ProjectBuilder, disc: string, sys: string, pts: Vec2[], props: Props, tag: string): void {
  const q: Vec2[] = [];
  for (const p of pts) if (!q.length || Math.hypot(p.x - q[q.length - 1]!.x, p.y - q[q.length - 1]!.y) > 0.005) q.push(v(r4(p.x), r4(p.y)));
  if (q.length < 2) return;
  b.run_(disc as never, sys as never, q, props, tag);
}

/** Tubería multicapa PEX-AL-PEX: diámetro nominal y diámetro interior (mm). */
const PEX: readonly [string, number][] = [
  ["Multicapa 16", 12],
  ["Multicapa 20", 16],
  ["Multicapa 25", 20],
  ["Multicapa 32", 26],
  ["Multicapa 40", 33],
  ["Multicapa 50", 42],
  ["Multicapa 63", 51],
];
const PVC: readonly [string, number][] = [
  ["PVC 1\" RDE 21", 30.2],
  ["PVC 1-1/4\" RDE 21", 38.1],
  ["PVC 1-1/2\" RDE 21", 43.7],
  ["PVC 2\" RDE 21", 54.6],
];
const VMAX = 1.8;
function pipe(uc: number, list = PEX, min = 0): { name: string; di: number; q: number } {
  const q = hunterFlow(uc);
  for (let i = min; i < list.length; i++) {
    const [name, di] = list[i]!;
    if (q / 1000 / (Math.PI * (di / 2000) ** 2) <= VMAX) return { name, di, q };
  }
  const [name, di] = list[list.length - 1]!;
  return { name, di, q };
}
const short = (name: string) => name.replace("Multicapa ", "Ø").replace(/ RDE 21/, "");

interface Fixture {
  floor: number;
  room: Room;
  kind: "wc" | "lavamanos" | "ducha" | "lavaplatos" | "lavavajillas" | "lavadero" | "lavadora" | "nevera";
  at: Vec2; // salida en el muro
  drain: Vec2; // desagüe
  ucAF: number;
  ucAC: number;
  ud: number;
  name: string;
}

const NAMES: Record<Fixture["kind"], string> = {
  wc: "Sanitario",
  lavamanos: "Lavamanos",
  ducha: "Ducha",
  lavaplatos: "Lavaplatos",
  lavavajillas: "Lavavajillas",
  lavadero: "Lavadero",
  lavadora: "Lavadora",
  nevera: "Nevera (dispensador)",
};

/** Aparatos hidrosanitarios a partir de los aparatos de arquitectura. */
function fixtures(c: NetCtx): Fixture[] {
  const { b, rooms, levels } = c;
  const out: Fixture[] = [];
  const roomAt = (floor: number, q: Vec2) => rooms.find((r) => r.floor === floor && q.x >= r.x0 - 0.2 && q.x <= r.x1 + 0.2 && q.y >= r.y0 - 0.2 && q.y <= r.y1 + 0.2);
  for (const e of b.store.entities()) {
    if (e.kind !== "Device" || e.discipline !== "ARQ") continue;
    const d = e as Device;
    const floor = levels.indexOf(b.store.indices.levelOfElement(d.id) ?? "") + 1;
    if (floor < 1) continue;
    const inward = v(-Math.sin(d.rotation), Math.cos(d.rotation));
    const off = (k: number) => v(r4(d.position.x + inward.x * k), r4(d.position.y + inward.y * k));
    const along = (k: number) => v(r4(d.position.x + inward.y * k), r4(d.position.y - inward.x * k));
    const room = roomAt(floor, off(0.3));
    if (!room) continue;
    const pr = d.properties ?? {};
    const add = (kind: Fixture["kind"], at: Vec2, drain: Vec2, ucAF: number, ucAC: number, ud: number) => out.push({ floor, room, kind, at, drain, ucAF, ucAC, ud, name: `${NAMES[kind]} ${room.name.toLowerCase()}` });
    switch (d.symbol) {
      case "wc":
        add("wc", d.position, off(0.25), 3, 0, 4);
        break;
      case "lavamanos": {
        const n = typeof pr["pocetas"] === "number" ? (pr["pocetas"] as number) : 1;
        const w = typeof pr["ancho_m"] === "number" ? (pr["ancho_m"] as number) : 0.6;
        for (let i = 0; i < n; i++) {
          const k = n === 1 ? 0 : (i - (n - 1) / 2) * (w / n);
          add("lavamanos", along(k), off(0.15), 0.75, 0.75, 1);
        }
        break;
      }
      case "ducha": {
        const fondo = typeof pr["fondo_m"] === "number" ? (pr["fondo_m"] as number) : 0.9;
        add("ducha", d.position, off(fondo / 2), 1.5, 1.5, 2);
        break;
      }
      case "lavaplatos":
        if (room.type === "cocina") {
          add("lavaplatos", d.position, off(0.2), 1.5, 1.5, 2);
          add("lavavajillas", along(0.75), off(0.2), 1.5, 0, 2);
        } else add("lavadero", d.position, off(0.2), 2, 1, 2);
        break;
      case "electrodomestico":
        if (pr["rotulo"] === "LAV") add("lavadora", d.position, off(0.15), 2, 0, 3);
        if (pr["rotulo"] === "NEV") add("nevera", d.position, d.position, 0.5, 0, 0);
        break;
      default:
        break;
    }
  }
  return out;
}

/** Agrupa por recinto conservando el orden. */
function byRoom(list: Fixture[]): Fixture[][] {
  const m = new Map<Id, Fixture[]>();
  for (const f of list) m.set(f.room.id, [...(m.get(f.room.id) ?? []), f]);
  return [...m.values()];
}

/** Lado de la casa por el que desagua un recinto (fachada más cercana: occidental u oriental). */
function side(c: NetCtx, r: Room): "W" | "E" {
  const cx = (r.x0 + r.x1) / 2;
  return cx < c.lay.W / 2 ? "W" : "E";
}

// ─── Agua potable ────────────────────────────────────────────

export function buildWater(c: NetCtx): void {
  const { b, p, lay, levels } = c;
  const { xa, xb, W } = lay;
  const all = fixtures(c);
  const people = p.habitaciones * 2 + (p.servicio ? 1 : 0);
  const tankL = Math.max(2000, Math.ceil((people * 250 * 1.5) / 500) * 500);
  const ucAll = all.reduce((t, f) => t + f.ucAF + f.ucAC, 0) + 6; // + llaves de jardín
  const H = (sym: string, at: Vec2, h: number, props: Props, name: string, tag?: string, bb: ProjectBuilder = b) => bb.device("HID", sym, at, h, { ...props, ocultar_rotulo: true }, { name, ...(tag ? { tag } : {}) });

  const mx = r4(xa + 0.15); // montante de agua fría
  const hx = r4(xa + 0.3); // montante de agua caliente
  const rx = r4(xa + 0.42); // retorno de recirculación
  const my = 1.4;
  // Tanque y equipo de presión: al oriente de A; si un pabellón ocupa ese sitio, al occidente o al sur.
  const spots: [Vec2, Vec2, number][] = [
    [v(r4(W + 3.8), 1.6), v(r4(W + 3.8), 3.2), r4(W + 1.0)],
    [v(r4(-3.8 - c.carport), 1.6), v(r4(-3.8 - c.carport), 3.2), -1.0],
    [v(r4(W + 3.8), -5.4), v(r4(W + 2.0), -5.4), r4(W + 1.0)],
  ];
  const [tank, pump, ex] = spots.find(([t1, p1]) => isFree(c, t1, 0.9) && isFree(c, p1, 0.5)) ?? spots[0]!;
  const meter = v(r4((xa + xb) / 2 - 1.6), -3.0);

  // Suministro (primer piso y exterior)
  b.levelId = levels[0]!;
  H("medidor-agua", meter, 0.3, {}, "Medidor de agua 3/4\" con registro de corte y cheque", "MA");
  b.device("DOM", "valvula-motorizada", v(meter.x, -2.4), 0.3, { ocultar_rotulo: true }, { name: "Electroválvula de corte general de agua (sensores de fuga)" });
  H("tanque", tank, 0, { diametro_m: 1.6, rotulo: `${(tankL / 1000).toFixed(1)} m³` }, `Tanque de reserva enterrado ${tankL} L (1.5 días para ${people} personas a 250 L/hab·día)`);
  const pumpUc = pipe(ucAll, PVC);
  H("bomba", pump, 0.3, {}, `Equipo de presión ${ucAll > 40 ? "1.5" : "1"} HP, 40 m.c.a., tanque hidroacumulador 80 L, variador de velocidad`);
  H("filtro", v(pump.x + (pump.x > tank.x || pump.x < 0 ? 0.9 : -0.9), pump.y), 0.3, {}, "Filtro de sedimentos 20 µm + carbón activado");
  run(b, "HID", "PRI", [meter, v(meter.x, -2.0), v(tank.x, -2.0), v(tank.x, r4(tank.y + (tank.y > -2 ? -0.8 : 0.8)))], { tramo: "AP-0 Acometida → tanque de reserva", uc: r2(ucAll), q_l_s: 0.35, di_mm: 30.2, diametro: "PVC 1\" RDE 21" }, "AP-0 PVC 1\"");
  run(b, "HID", "PRI", [pump, v(ex, pump.y), v(ex, -0.7), v(mx, -0.7), v(mx, my)], { tramo: "AP-1 Equipo de presión → montante MH", uc: r2(ucAll), di_mm: pumpUc.di, diametro: pumpUc.name }, `AP-1 ${short(pumpUc.name)}`);
  H("valvula", v(r4(mx + 0.25), my), 0.3, {}, "Registro general de la casa");

  // Calentador de acumulación (en ropas) y montante de agua caliente.
  const ropas = c.rooms.find((r) => r.name === "Ropas") ?? c.rooms.find((r) => r.type === "ropas") ?? c.rooms[0]!;
  const heater = v(r4(ropas.x1 - 0.35), r4(ropas.y1 - 0.35));
  const ucAC = all.reduce((t, f) => t + f.ucAC, 0);
  const tankHot = p.habitaciones >= 5 ? 300 : p.habitaciones >= 3 ? 200 : 150;
  if (p.gas === "no") H("calentador-electrico", heater, 1.5, { uc_ac: 0 }, `Calentador eléctrico de acumulación ${tankHot} L, 4.5 kW, 240 V, con válvula de alivio y vaso de expansión`, "CAE");
  else H("calentador", heater, 1.5, { uc_ac: 0 }, "Calentador de paso a gas 20 L/min (36 kW), tiro forzado, ducto de evacuación al exterior, con válvula de alivio", "CAL");
  H("bomba-recirculacion", v(heater.x, r4(heater.y - 0.55)), 0.5, {}, "Bomba de recirculación de agua caliente 1/25 HP con temporizador y termostato");
  const hp = pipe(ucAC);
  run(b, "HID", "AF", orthoPath([v(mx, my), v(mx, r4(my - 0.25)), v(heater.x, r4(my - 0.25)), heater], "y"), { tramo: "AF-C Alimentación calentador", uc: r2(ucAC), di_mm: hp.di, diametro: hp.name }, `AF-C ${short(hp.name)}`);
  run(b, "HID", "AC", orthoPath([heater, v(heater.x, r4(my + 0.25)), v(hx, r4(my + 0.25)), v(hx, my)], "x"), { tramo: "AC-0 Calentador → montante MC", uc: r2(ucAC), di_mm: hp.di, diametro: `${hp.name} aislada` }, `AC-0 ${short(hp.name)}`);
  run(b, "HID", "RC", orthoPath([v(rx, my), v(rx, r4(my + 0.4)), v(r4(heater.x + 0.2), r4(my + 0.4)), v(r4(heater.x + 0.2), r4(heater.y - 0.55))], "y"), {}, "Retorno recirculación Ø16");

  // Pabellones B y C: montantes propios junto a la llegada de la galería.
  type Feed = { y: number; ucAF: number; ucAC: number; to: Vec2; key: string };
  const feeds: Feed[] = [];
  for (const wn of c.wings.slice(1)) {
    const w = wn.w;
    const k = linkOf(c, w.key);
    if (!k) continue;
    const rooms = new Map(c.rooms.filter((r) => r.wing === w.key).map((r) => [r.id, locRoom(w, r)] as const));
    const fx = all.filter((x) => x.room.wing === w.key).map((x) => locFixture(w, x, rooms));
    const wmx = r4(w.xa + 0.15);
    const wmy = 0.9;
    waterFloors(c, wn.b, w.floors.length, fx, { mx: wmx, hx: r4(w.xa + 0.3), rx: r4(w.xa + 0.42), my: wmy, xa: w.xa, xb: w.xb, tag: w.key }, []);
    feeds.push({ y: r4((k.c0 + k.c1) / 2), ucAF: fx.reduce((t, x) => t + x.ucAF, 0), ucAC: fx.reduce((t, x) => t + x.ucAC, 0), to: glob(w, v(wmx, wmy)), key: w.key });
  }
  waterFloors(c, b, lay.floors.length, all.filter((x) => x.room.wing === "A"), { mx, hx, rx, my, xa, xb, tag: "" }, feeds);

  // Llaves de jardín
  b.levelId = levels[0]!;
  const L0 = lay.L;
  const garden: [Vec2, string][] = [];
  const tapE = v(r4(W + 0.12), r4(lay.L / 2));
  const tapW = v(-0.12, r4(lay.L - 1.5));
  const clearOf = (q: Vec2) => !c.lay.links.some((k) => q.y > k.c0 - 0.8 && q.y < k.c1 + 0.8 && Math.abs(q.x - k.xA) < 0.5);
  if (clearOf(tapE)) garden.push([tapE, "Llave de jardín oriente"]);
  if (clearOf(tapW)) garden.push([tapW, "Llave de jardín occidente"]);
  if (c.carport) garden.push([v(r4(-c.carport + 0.3), 6.2), "Llave de lavado parqueadero"]);
  if (p.terraza) garden.push([v(1.0, r4(lay.L + 0.12)), "Llave de jardín terraza"]);
  if (lay.patio) garden.push([v(r4(lay.patio.x0 + 0.25), r4((lay.patio.y0 + lay.patio.y1) / 2)), "Llave de jardín del patio"]);
  // Red exterior de riego enterrada, derivada de la impulsión del equipo de presión (fuera de la casa).
  const yN = r4(L0 + (p.terraza ? 4.0 : 1.0));
  for (const [at, name] of garden) {
    H("llave-jardin", at, 0.5, { uc_af: 1.5 }, name);
    const pts: Vec2[] =
      at.x > W - 0.5
        ? [v(ex, pump.y), v(ex, at.y), at]
        : at.y > 6.5
          ? [v(ex, pump.y), v(ex, yN), v(at.x < 0 ? -1.0 : at.x, yN), v(at.x < 0 ? -1.0 : at.x, at.y), at]
          : [v(ex, -0.7), v(ex, -1.0), v(r4(at.x), -1.0), at];
    run(b, "HID", "AF", pts, {}, "Riego Ø20");
  }
}

/** Montantes, troncal por el hall y ramales de cada piso de un pabellón (coordenadas locales). */
function waterFloors(
  c: NetCtx,
  b: ProjectBuilder,
  nFloors: number,
  all: Fixture[],
  g: { mx: number; hx: number; rx: number; my: number; xa: number; xb: number; tag: string },
  feeds: { y: number; ucAF: number; ucAC: number; to: Vec2; key: string }[],
): void {
  const { levels, lay } = c;
  const { mx, hx, rx, my, xa, xb, tag } = g;
  const H = (sym: string, at: Vec2, h: number, props: Props, name: string, t?: string) => b.device("HID", sym, at, h, { ...props, ocultar_rotulo: true }, { name, ...(t ? { tag: t } : {}) });
  const sfx = tag ? `-${tag}` : "";
  for (let f = 1; f <= nFloors; f++) {
    b.levelId = levels[f - 1]!;
    const here = all.filter((x) => x.floor === f);
    const above = all.filter((x) => x.floor > f);
    const ucUpAF = above.reduce((t, x) => t + x.ucAF, 0);
    const ucUpAC = above.reduce((t, x) => t + x.ucAC, 0);
    const lbl = (up: boolean) => (f === 1 ? (up ? "sube" : "") : up ? "sube / llega" : "llega");
    if (nFloors > 1 || !tag) {
      H("montante", v(mx, my), 0, { rotulo: `MH${sfx} ${lbl(f < nFloors)}` }, `Montante de agua fría MH${sfx} (${f < nFloors ? `sube al piso ${f + 1}` : "llega del piso inferior"})`, `MH${sfx}`);
      H("montante", v(hx, r4(my - 0.45)), 0, { rotulo: `MC${sfx} ${lbl(f < nFloors)}` }, `Montante de agua caliente MC${sfx}`, `MC${sfx}`);
    }
    if (f < nFloors) {
      const a = pipe(ucUpAF);
      const h = pipe(ucUpAC);
      run(b, "HID", "AF", [v(mx, my), v(mx, r4(my + 0.05))], { tramo: `MH${sfx}-${f} Montante AF piso ${f} → ${f + 1}`, uc: r2(ucUpAF), di_mm: a.di, diametro: a.name, longitud_extra_m: lay.dims.floorH }, `MH${sfx}-${f} ${short(a.name)}`);
      run(b, "HID", "AC", [v(hx, my), v(hx, r4(my + 0.05))], { tramo: `MC${sfx}-${f} Montante AC piso ${f} → ${f + 1}`, uc: r2(ucUpAC), di_mm: h.di, diametro: `${h.name} aislada`, longitud_extra_m: lay.dims.floorH }, `MC${sfx}-${f} ${short(h.name)}`);
    }
    const fd = f === 1 ? feeds : [];
    if (!here.length && !fd.length) continue;
    // Ramales por recinto
    const groups = byRoom(here);
    type Br = { y: number; ucAF: number; ucAC: number };
    const branches: Br[] = [];
    let k = 0;
    for (const gr of groups) {
      const r = gr[0]!.room;
      const west = (r.x0 + r.x1) / 2 < mx;
      const ey = r4(Math.min(r.y1 - 0.35, Math.max(r.y0 + 0.35, gr.reduce((t, x) => t + x.at.y, 0) / gr.length)));
      const reg = v(r4(west ? Math.min(r.x1 - 0.3, xa - 0.3) : Math.max(r.x0 + 0.3, xb + 0.3)), ey);
      const ucAF = gr.reduce((t, x) => t + x.ucAF, 0);
      const ucACr = gr.reduce((t, x) => t + x.ucAC, 0);
      branches.push({ y: ey, ucAF, ucAC: ucACr });
      k++;
      const a = pipe(ucAF);
      H("valvula", reg, 0.3, {}, `Colector multicapa con llaves de corte por salida: ${r.name.toLowerCase()}`);
      run(b, "HID", "AF", [v(mx, ey), reg], { tramo: `AF${sfx}-${f}.${k} Ramal ${r.name.toLowerCase()}`, uc: r2(ucAF), di_mm: a.di, diametro: a.name }, `AF${sfx}-${f}.${k} ${short(a.name)}`);
      if (ucACr > 0) {
        const h = pipe(ucACr);
        run(b, "HID", "AC", [v(hx, r4(ey + 0.12)), v(reg.x, r4(ey + 0.12))], { tramo: `AC${sfx}-${f}.${k} Ramal ${r.name.toLowerCase()}`, uc: r2(ucACr), di_mm: h.di, diametro: `${h.name} aislada` }, `AC${sfx}-${f}.${k} ${short(h.name)}`);
      }
      for (const x of gr) {
        const sym = x.ucAC > 0 ? "punto-afac" : "punto-af";
        H(sym, x.at, x.kind === "ducha" ? 1.1 : x.kind === "wc" ? 0.2 : 0.55, { uc_af: x.ucAF, ...(x.ucAC ? { uc_ac: x.ucAC } : {}) }, x.name);
        run(b, "HID", "AF", orthoPath([reg, x.at], "y"), {}, "Ø16");
        if (x.ucAC > 0) run(b, "HID", "AC", orthoPath([v(reg.x, r4(ey + 0.12)), v(r4(x.at.x + 0.08), r4(x.at.y))], "y"), {}, "");
      }
    }
    // Alimentación de los otros pabellones por las galerías (agua fría, caliente y retorno).
    for (const fe of fd) {
      branches.push({ y: fe.y, ucAF: fe.ucAF, ucAC: fe.ucAC });
      const a = pipe(fe.ucAF);
      const h = pipe(fe.ucAC);
      const turnX = fe.to.x;
      run(b, "HID", "AF", [v(mx, fe.y), v(turnX, fe.y), fe.to], { tramo: `AF-G${fe.key} Galería → montante MH-${fe.key}`, uc: r2(fe.ucAF), di_mm: a.di, diametro: a.name }, `AF-G${fe.key} ${short(a.name)}`);
      if (fe.ucAC > 0) {
        run(b, "HID", "AC", [v(hx, r4(fe.y + 0.12)), v(r4(turnX + 0.15), r4(fe.y + 0.12)), v(r4(turnX + 0.15), r4(fe.to.y))], { tramo: `AC-G${fe.key} Galería → montante MC-${fe.key}`, uc: r2(fe.ucAC), di_mm: h.di, diametro: `${h.name} aislada` }, `AC-G${fe.key} ${short(h.name)}`);
        run(b, "HID", "RC", [v(r4(turnX + 0.27), r4(fe.to.y)), v(r4(turnX + 0.27), r4(fe.y - 0.12)), v(rx, r4(fe.y - 0.12))], {}, "Retorno Ø16");
      }
    }
    // Troncal por el hall: tramos entre derivaciones, con las UC de lo que queda aguas abajo.
    const ys = [...new Set(branches.map((x) => x.y))].sort((a, c2) => a - c2);
    const north = ys.filter((y) => y > my);
    const south = ys.filter((y) => y <= my).sort((a, c2) => c2 - a);
    let t = 0;
    for (const seq of [north, south]) {
      let prev = my;
      for (let i = 0; i < seq.length; i++) {
        const rest = branches.filter((x) => seq.slice(i).includes(x.y));
        const ucA = rest.reduce((s2, x) => s2 + x.ucAF, 0);
        const ucH = rest.reduce((s2, x) => s2 + x.ucAC, 0);
        const a = pipe(ucA);
        t++;
        run(b, "HID", "AF", [v(mx, prev), v(mx, seq[i]!)], { tramo: `AF${sfx}-${f}.T${t} Troncal hall`, uc: r2(ucA), di_mm: a.di, diametro: a.name }, `T${t} ${short(a.name)}`);
        if (ucH > 0) {
          const h = pipe(ucH);
          run(b, "HID", "AC", [v(hx, prev === my ? r4(my - 0.45) : r4(prev + 0.12)), v(hx, r4(seq[i]! + 0.12))], { tramo: `AC${sfx}-${f}.T${t} Troncal hall`, uc: r2(ucH), di_mm: h.di, diametro: `${h.name} aislada` }, "");
        }
        prev = seq[i]!;
      }
    }
    // Retorno de recirculación desde la derivación de agua caliente más lejana.
    const far = branches.filter((x) => x.ucAC > 0).sort((a, c2) => Math.abs(c2.y - my) - Math.abs(a.y - my))[0];
    if (far) run(b, "HID", "RC", [v(hx, r4(far.y + 0.12)), v(rx, r4(far.y + 0.12)), v(rx, my)], {}, "");
  }
}

// ─── Aguas residuales ────────────────────────────────────────

export function buildSanitary(c: NetCtx): void {
  const { b, lay, levels } = c;
  const allFx = fixtures(c).filter((f) => f.ud > 0);
  type Inlet = { side: "W" | "E"; y: number; ud: number; wc: number; name: string };
  let bn = 0;
  let rn = 0;
  let ci = 0;
  let rk = 100;
  let depth = 0.45;
  const S = (bw: ProjectBuilder, sym: string, at: Vec2, props: Props, name: string, tag?: string, lvl = levels[0]!) => {
    bw.levelId = lvl;
    return bw.device("SAN", sym, at, 0, { ...props, ocultar_rotulo: true }, { name, ...(tag ? { tag } : {}) });
  };
  const box = (bw: ProjectBuilder, at: Vec2, lado = 0.6) => {
    ci++;
    S(bw, "caja", at, { lado_m: lado }, `Caja de inspección ${lado === 0.8 ? "80×80" : "60×60"} cm, batea −${depth.toFixed(2)} m`, `CI-${ci}`);
    return `CI-${ci}`;
  };

  /** Desagües de los recintos de un pabellón hasta sus colectores laterales (coordenadas locales). */
  const drains = (bw: ProjectBuilder, W: number, all: Fixture[], kitchenTrap: boolean): Inlet[] => {
    const colX = { W: -1.4, E: r4(W + 1.4) } as const;
    const inlets: Inlet[] = [];
    for (const g of byRoom(all)) {
      const r = g[0]!.room;
      const sd: "W" | "E" = (r.x0 + r.x1) / 2 < W / 2 ? "W" : "E";
      const lvl = levels[r.floor - 1]!;
      const wc = g.filter((x) => x.kind === "wc").length;
      const ud = g.reduce((t, x) => t + x.ud, 0);
      const kitchen = r.type === "cocina";
      const d = wc ? "4" : kitchen || ud > 6 ? "3" : "2";
      const ey = r4(Math.min(r.y1 - 0.3, Math.max(r.y0 + 0.3, (g.find((x) => x.kind === "wc") ?? g[0]!).drain.y)));
      const exitX = sd === "W" ? 0.3 : r4(W - 0.3);
      bw.levelId = lvl;
      // Desagües de aparatos y colector del recinto
      for (const x of g) {
        S(bw, x.kind === "wc" ? "salida-sanitario" : x.kind === "ducha" ? "rejilla" : "sifon", x.drain, { ud: x.ud }, x.name, undefined, lvl);
        bw.levelId = lvl;
        run(bw, "SAN", "AN", orthoPath([x.drain, v(x.drain.x, ey)], "y"), {}, x.kind === "wc" ? "Ø4\"" : "Ø2\"");
      }
      if (r.type === "bano" || r.type === "bano-social" || r.type === "ropas") {
        const fd = v(r4((r.x0 + r.x1) / 2), r4((r.y0 + r.y1) / 2));
        if (!g.some((x) => x.kind === "ducha")) {
          S(bw, "rejilla", fd, { ud: 1 }, `Rejilla de piso ${r.name.toLowerCase()}`, undefined, lvl);
          bw.levelId = lvl;
          run(bw, "SAN", "AN", orthoPath([fd, v(fd.x, ey)], "y"), {}, "Ø2\"");
        }
      }
      const xs = g.map((x) => x.drain.x);
      const far = sd === "W" ? Math.max(...xs) : Math.min(...xs);
      rn++;
      const udR = ud + (g.some((x) => x.kind === "ducha") ? 0 : r.type === "bano" || r.type === "bano-social" || r.type === "ropas" ? 1 : 0);
      if (r.floor === 1) {
        const target = v(colX[sd], ey);
        if (kitchen && kitchenTrap) {
          const tg = v(sd === "W" ? -0.65 : r4(W + 0.65), ey);
          S(bw, "trampa-grasas", tg, {}, "Trampa de grasas prefabricada 60 L");
          bw.levelId = lvl;
          run(bw, "SAN", "AN", [v(far, ey), tg], { tramo: `R-${rn} ${r.name} → trampa de grasas`, ud: udR, diametro_pulg: d, pendiente_pct: 2, sanitarios: wc }, `R-${rn} Ø${d}" S=2%`);
          run(bw, "SAN", "AN", [tg, target], {}, `Ø${d}"`);
        } else run(bw, "SAN", "AN", [v(far, ey), target], { tramo: `R-${rn} ${r.name} → colector ${sd === "W" ? "occidental" : "oriental"}`, ud: udR, diametro_pulg: d, pendiente_pct: 2, sanitarios: wc }, `R-${rn} Ø${d}" S=2%`);
        inlets.push({ side: sd, y: ey, ud: udR, wc, name: r.name });
      } else {
        // Bajante por el muro de fachada hasta el primer piso
        bn++;
        const bx = exitX;
        run(bw, "SAN", "AN", [v(far, ey), v(bx, ey)], { tramo: `R-${rn} ${r.name} → bajante BAN-${bn}`, ud: udR, diametro_pulg: d === "2" ? "3" : d, pendiente_pct: 2, sanitarios: wc }, `R-${rn} Ø${d === "2" ? "3" : d}" S=2%`);
        for (let f = r.floor; f >= 1; f--) S(bw, "bajante-an", v(bx, ey), { rotulo: `BAN-${bn}` }, `Bajante BAN-${bn} Ø4" (${r.name.toLowerCase()}, piso ${r.floor}) con ventilación a cubierta`, `BAN-${bn}`, levels[f - 1]!);
        bw.levelId = levels[0]!;
        run(bw, "SAN", "AN", [v(bx, ey), v(colX[sd], ey)], { tramo: `BAN-${bn} Bajante → colector ${sd === "W" ? "occidental" : "oriental"}`, ud: udR, diametro_pulg: "4", pendiente_pct: 2, sanitarios: wc }, `BAN-${bn} Ø4" S=2%`);
        inlets.push({ side: sd, y: ey, ud: udR, wc, name: `BAN-${bn}` });
      }
      if (wc || r.type === "cocina") S(bw, "ventilacion", v(r4(exitX + (sd === "W" ? 0.25 : -0.25)), r4(ey + 0.3)), {}, `Ventilación ${r.name.toLowerCase()} Ø2" a cubierta`, undefined, lvl);
    }
    return inlets;
  };

  /** Colector lateral con cajas de inspección (distancia máxima entre cajas 12 m) hasta `yEnd`. */
  const sideRun = (bw: ProjectBuilder, sd: "W" | "E", x: number, inlets: Inlet[], yEnd: number, lastBox: boolean, avoid: (y: number) => number) => {
    const list = inlets.filter((i) => i.side === sd).sort((a, c2) => c2.y - a.y);
    if (!list.length) return undefined;
    bw.levelId = levels[0]!;
    const stops: number[] = [];
    for (const i of list) if (!stops.some((y) => Math.abs(y - i.y) < 0.9)) stops.push(i.y);
    // cajas intermedias
    const full: number[] = [];
    for (let i = 0; i < stops.length; i++) {
      full.push(stops[i]!);
      const next = i + 1 < stops.length ? stops[i + 1]! : yEnd;
      for (let y = stops[i]! - 12; y > next + 1; y -= 12) full.push(r4(avoid(y)));
    }
    full.push(yEnd);
    let ud = 0;
    let wc = 0;
    depth = 0.45;
    let prevTag = box(bw, v(x, full[0]!));
    for (let i = 0; i < full.length - 1; i++) {
      for (const inl of list.filter((q) => Math.abs(q.y - full[i]!) < 0.9)) (ud += inl.ud), (wc += inl.wc);
      const a = v(x, full[i]!);
      const z = v(x, full[i + 1]!);
      depth += 0.02 * Math.abs(a.y - z.y);
      const last = i + 1 === full.length - 1;
      const tag = last && !lastBox ? "colector" : box(bw, z, last ? 0.8 : 0.6);
      rk++;
      bw.levelId = levels[0]!;
      run(bw, "SAN", "AN", [a, z], { tramo: `R-${rk} ${prevTag} → ${tag} (colector ${sd === "W" ? "occidental" : "oriental"})`, ud, diametro_pulg: "4", pendiente_pct: 2, sanitarios: wc }, `R-${rk} Ø4" S=2%`);
      prevTag = tag;
    }
    return { tag: prevTag, at: v(x, yEnd), ud, wc };
  };

  // Pabellones B y C: sus colectores llegan al colector de A en el costado de la galería.
  const fromWings: Inlet[] = [];
  const colXA = { W: -1.4, E: r4(lay.W + 1.4) } as const;
  for (const wn of c.wings.slice(1)) {
    const w = wn.w;
    const k = linkOf(c, w.key);
    if (!k) continue;
    const rooms = new Map(c.rooms.filter((r) => r.wing === w.key).map((r) => [r.id, locRoom(w, r)] as const));
    const fx = allFx.filter((x) => x.room.wing === w.key).map((x) => locFixture(w, x, rooms));
    const ins = drains(wn.b, w.W, fx, false);
    const yJ = loc(w, v(colXA[k.side], k.c0)).y;
    for (const sd of ["W", "E"] as const) {
      const r = sideRun(wn.b, sd, sd === "W" ? -1.4 : r4(w.W + 1.4), ins, yJ, false, (y) => y);
      if (!r) continue;
      const g = glob(w, r.at);
      fromWings.push({ side: k.side, y: g.y, ud: r.ud, wc: r.wc, name: `Colector ${w.name.toLowerCase()}` });
    }
  }

  // Pabellón A (o la casa de una sola barra)
  const inlets = [...drains(b, lay.W, allFx.filter((x) => x.room.wing === "A"), true), ...fromWings];
  const yS = Math.min(-1.8, ...inlets.map((i) => i.y - 1.0));
  const avoid = (sd: "W" | "E") => (y: number) => {
    const k = c.lay.links.find((q) => q.side === sd && y > q.c0 - 0.8 && y < q.c1 + 0.8);
    return k ? k.c0 - 0.8 : y;
  };
  const sum = { ud: 0, wc: 0 };
  const west = sideRun(b, "W", colXA.W, inlets, yS, true, avoid("W"));
  const east = sideRun(b, "E", colXA.E, inlets, yS, true, avoid("E"));
  for (const r of [west, east]) if (r) (sum.ud += r.ud), (sum.wc += r.wc);
  const fin = v(colXA.E, yS);
  let finalTag = east?.tag;
  if (west) {
    depth += 0.02 * (colXA.E - colXA.W);
    rk++;
    if (!east) finalTag = box(b, fin, 0.8);
    b.levelId = levels[0]!;
    run(b, "SAN", "AN", [west.at, fin], { tramo: `R-${rk} ${west.tag} → ${finalTag} (colector sur)`, ud: west.ud, diametro_pulg: "4", pendiente_pct: 2, sanitarios: west.wc }, `R-${rk} Ø4" S=2%`);
  }
  const out = v(colXA.E, r4(yS - 2.4));
  rk++;
  b.levelId = levels[0]!;
  run(b, "SAN", "AN", [fin, out], { tramo: `R-${rk} ${finalTag ?? "CI"} → red de alcantarillado`, ud: sum.ud, diametro_pulg: sum.ud > 216 ? "6" : "4", pendiente_pct: 2, sanitarios: sum.wc }, `R-${rk} Ø${sum.ud > 216 ? 6 : 4}" S=2%`);
  b.note("SAN", "text", [v(r4(colXA.E + 0.3), r4(yS - 2.6))], "A RED DE ALCANTARILLADO (O SISTEMA SÉPTICO + FAFA SI NO HAY RED)", {}, 1.6);
}

// ─── Aguas lluvias ───────────────────────────────────────────

const RAIN_I = 120; // mm/h
const RAIN_C = 0.95;
const rainQ = (a: number) => (RAIN_C * RAIN_I * a) / 3600;
const RAIN_PIPE: readonly [string, number][] = [
  ["PVC 4\"", 5.8],
  ["PVC 6\"", 16],
  ["PVC 8\"", 34],
];
const rainPipe = (q: number) => RAIN_PIPE.find(([, cap]) => q <= cap) ?? RAIN_PIPE[RAIN_PIPE.length - 1]!;

export function buildRain(c: NetCtx): void {
  const { b, p, lay, levels, eave } = c;
  const flat = p.cubierta === "plana";
  let k = 0;
  /** Canales, bajantes y colectores laterales de un pabellón (coordenadas locales) hasta `yEnd`. */
  const wingRain = (bw: ProjectBuilder, W: number, L: number, yEnd: number | undefined, extra: { W: { y: number; a: number }[]; E: { y: number; a: number }[] }) => {
    const roofA = (W + 2 * eave) * (L + 2 * eave);
    // Bajantes Ø4": una por cada 70 m² de cubierta, mínimo 4, repartidas por las dos fachadas largas.
    const n = Math.max(4, Math.ceil(roofA / 70));
    const perSide = Math.ceil(n / 2);
    const each = roofA / (perSide * 2);
    const x = { W: flat ? 0.3 : r4(-eave + 0.15), E: flat ? r4(W - 0.3) : r4(W + eave - 0.15) } as const;
    const cx = { W: -2.4, E: r4(W + 2.4) } as const;
    const yS = yEnd ?? Math.min(-2.6, ...[...extra.W, ...extra.E].map((q) => q.y - 1.0));
    // Canales (cubiertas inclinadas) o sifones (cubierta plana) en el nivel de cubierta.
    bw.levelId = c.roofLevel;
    const y0 = r4(-eave + 0.15),
      y1 = r4(L + eave - 0.15);
    if (flat) bw.note("SAN", "text", [v(r4(W / 2), r4(L / 2 - 1.2))], "SIFONES DE CUBIERTA Ø4\" CON REJILLA DE CÚPULA", { align: "center" }, 1.8);
    else
      for (const sd of ["W", "E"] as const) {
        const ch = pipeRun(roofA / 2);
        run(bw, "SAN", "CANAL", [v(x[sd], y0), v(x[sd], y1)], {}, `Canal ${sd === "W" ? "occidental" : "oriental"} lámina galv. cal. 22, 15×12 cm, S = 0.5 % (${ch})`);
      }
    const totals: Record<"W" | "E", number> = { W: 0, E: 0 };
    for (const sd of ["W", "E"] as const) {
      for (let i = 0; i < perSide; i++) {
        const y = r4(y0 + ((y1 - y0) * (i + 0.5)) / perSide);
        k++;
        bw.levelId = c.roofLevel;
        bw.device("SAN", "bajante", v(x[sd], y), 0, { ocultar_rotulo: true }, { name: `Bajante de aguas lluvias BALL-${k} Ø4"`, tag: `BALL-${k}` });
        bw.levelId = levels[0]!;
        bw.device("SAN", "bajante", v(x[sd], y), 0, { ocultar_rotulo: true }, { name: `Bajante de aguas lluvias BALL-${k} Ø4"`, tag: `BALL-${k}` });
        bw.device("SAN", "caja", v(cx[sd], y), 0, { lado_m: 0.5, ocultar_rotulo: true }, { name: "Caja de aguas lluvias 50×50 cm", tag: `CALL-${k}` });
        run(bw, "SAN", "ALL", [v(x[sd], y), v(cx[sd], y)], { tramo: `BALL-${k} Bajante (${each.toFixed(0)} m² de cubierta)`, area_m2: r2(each), diametro: "PVC 4\"", capacidad_l_s: 9 }, `BALL-${k} Ø4"`);
      }
      totals[sd] = each * perSide + extra[sd].reduce((t, q) => t + q.a, 0);
      const yTop = Math.max(y1, ...extra[sd].map((q) => q.y));
      for (const q of extra[sd]) bw.device("SAN", "caja", v(cx[sd], q.y), 0, { lado_m: 0.6, ocultar_rotulo: true }, { name: "Caja de unión de aguas lluvias 60×60 cm" });
      const [dn, cap] = rainPipe(rainQ(totals[sd]));
      bw.levelId = levels[0]!;
      run(bw, "SAN", "ALL", [v(cx[sd], yTop), v(cx[sd], yS)], { tramo: `Colector ${sd === "W" ? "occidental" : "oriental"} de aguas lluvias`, area_m2: r2(totals[sd]), diametro: dn, capacidad_l_s: cap }, `ALL ${dn.replace("PVC ", "Ø")} S=1%`);
    }
    return { roofA, totals, cx, yS };
  };

  // Pabellones B y C: sus colectores descargan en el colector de A del lado de la galería.
  const extra = { W: [] as { y: number; a: number }[], E: [] as { y: number; a: number }[] };
  const cxA = { W: -2.4, E: r4(lay.W + 2.4) } as const;
  let roofWings = 0;
  for (const wn of c.wings.slice(1)) {
    const w = wn.w;
    const lk = linkOf(c, w.key);
    if (!lk) continue;
    const yJ = loc(w, v(cxA[lk.side], lk.c0)).y;
    const r = wingRain(wn.b, w.W, w.L, yJ, { W: [], E: [] });
    roofWings += r.roofA;
    for (const sd of ["W", "E"] as const) extra[lk.side].push({ y: glob(w, v(r.cx[sd], yJ)).y, a: r.totals[sd] });
  }
  for (const lk of lay.links) roofWings += Math.abs(lk.xW - lk.xA) * (lk.c1 - lk.c0 + 0.3);
  const A = wingRain(b, lay.W, lay.L, undefined, extra);
  const total = A.roofA + roofWings;
  const { cx, yS } = A;
  const L = lay.L;
  // Colector sur hasta la descarga, con tanque de aprovechamiento para riego.
  b.levelId = levels[0]!;
  const [dn, cap] = rainPipe(rainQ(total));
  run(b, "SAN", "ALL", [v(cx.W, yS), v(cx.E, yS), v(r4(cx.E + 2.0), yS)], { tramo: "Colector sur de aguas lluvias → descarga", area_m2: r2(total), diametro: dn, capacidad_l_s: cap }, `ALL ${dn.replace("PVC ", "Ø")} S=1%`);
  const tankSpots: [Vec2, Vec2][] = [
    [v(r4(cx.E + 2.4), r4(L / 2)), v(cx.E, r4(L / 2))],
    [v(r4(cx.W - 2.4 - c.carport), r4(L / 2 + 3)), v(cx.W, r4(L / 2 + 3))],
    [v(r4(cx.E + 2.4), r4(yS - 2.2)), v(cx.E, r4(yS - 2.2))],
  ];
  const [tk, from] = tankSpots.find(([t1]) => isFree(c, t1, 0.8)) ?? tankSpots[0]!;
  b.device("SAN", "tanque", tk, 0, { diametro_m: 1.5, rotulo: "ALL 3 m³", ocultar_rotulo: true }, { name: "Tanque de aprovechamiento de aguas lluvias 3 m³ para riego, con rebose al colector" });
  run(b, "SAN", "ALL", [from, v(r4(tk.x + (tk.x > from.x ? -0.75 : 0.75)), tk.y)], {}, "Ø4\" a tanque");
  b.note("SAN", "text", [v(r4(cx.E + 2.2), r4(yS - 0.35))], "A CUNETA / POZO DE INFILTRACIÓN", {}, 1.6);
}
const pipeRun = (a: number) => `${a.toFixed(0)} m², Q ${rainQ(a).toFixed(1)} L/s`;

// ─── Comunicaciones, seguridad y domótica ────────────────────

export function buildComms(c: NetCtx): void {
  const { b, p, lay, levels, rooms } = c;
  const { xa, xb, W, L } = lay;
  const rack = v(r4(c.tg.x + 0.6), c.tg.y);
  b.levelId = levels[0]!;
  b.device("DOM", "rack", rack, 0.4, { descripcion: "Rack 12U: router, switch PoE 24 puertos, controlador KNX IP, NVR, UPS 1.5 kVA" }, { rot: Math.PI, tag: "RK" });
  const D = (sym: string, at: Vec2, h: number, name: string, floor: number) => {
    b.levelId = levels[floor - 1]!;
    b.device("DOM", sym, at, h, { ocultar_rotulo: true }, { name });
    return at;
  };
  for (let f = 1; f <= p.pisos; f++) {
    const lan: Vec2[] = [];
    const bus: Vec2[] = [];
    const sec: Vec2[] = [];
    for (const r of rooms.filter((x) => x.floor === f)) {
      const cxr = r4((r.x0 + r.x1) / 2),
        cyr = r4((r.y0 + r.y1) / 2);
      const nm = r.name.toLowerCase();
      if (r.type === "social" || r.type === "estudio" || r.type === "alcoba" || r.type === "principal" || r.type === "servicio") {
        lan.push(D("datos", v(r4(r.x0 + 0.15), r4(r.y0 + 0.5)), 0.3, `Datos Cat 6A ${nm}`, f));
        if (r.type !== "estudio" && r.type !== "servicio") lan.push(D("tv", v(r4(r.x1 - 0.15), cyr), 1.5, `TV / HDMI + datos ${nm}`, f));
        bus.push(D("pulsador", v(r4(r.x0 + 0.15), r4(r.y1 - 0.4)), 1.2, `Teclado KNX de escenas ${nm}`, f));
        if (r.type !== "servicio") bus.push(D("termostato", v(r4(r.x1 - 0.15), r4(r.y1 - 0.5)), 1.5, `Sensor de temperatura y humedad ${nm}`, f));
      }
      if (r.type === "alcoba" || r.type === "principal" || r.type === "servicio" || r.type === "circulacion") sec.push(D("humo", v(cxr, cyr), 2.7, `Detector de humo ${nm}`, f));
      if (r.type === "circulacion") bus.push(D("sensor-presencia", v(cxr, r4(cyr + 0.6)), 2.7, `Sensor de presencia ${nm}`, f));
      if (r.type === "bano" || r.type === "bano-social" || r.type === "ropas" || r.type === "cocina") sec.push(D("fuga-agua", v(r4(r.x0 + 0.25), r4(r.y0 + 0.25)), 0, `Sensor de inundación ${nm}`, f));
      if (r.type === "cocina") sec.push(D("humo", v(cxr, r4(cyr + 0.5)), 2.7, "Detector de humo térmico cocina", f));
    }
    // WiFi: un punto de acceso por cada 120 m² de piso, en el hall de cada pabellón.
    for (const wn of c.wings) {
      const w = wn.w;
      if (f > w.floors.length) continue;
      const aps = Math.max(1, Math.ceil((w.W * w.L) / 120));
      for (let i = 0; i < aps; i++) lan.push(D("ap-wifi", glob(w, v(r4((w.xa + w.xb) / 2), r4((w.L * (i + 0.5)) / aps))), 2.7, `Punto de acceso WiFi 6 PoE piso ${f}`, f));
    }
    b.levelId = levels[f - 1]!;
    // Por pabellón: en A desde el rack (o su montante); en B y C por la galería o por su propio montante.
    const wingOf = (q: Vec2) => c.wings.slice(1).find((wn) => q.x >= wn.rect.x0 - 0.05 && q.x <= wn.rect.x1 + 0.05 && q.y >= wn.rect.y0 - 0.05 && q.y <= wn.rect.y1 + 0.05)?.w.key ?? "A";
    for (const wn of c.wings) {
      const w = wn.w;
      if (f > w.floors.length) continue;
      const mine = (list: Vec2[]) => list.filter((q) => wingOf(q) === w.key);
      let start: Vec2;
      let lead: Vec2[] = [];
      if (w.key === "A") {
        start = f === 1 ? rack : v(r4(xa + 0.6), 1.4);
        if (f > 1) b.device("DOM", "montante", start, 0, { rotulo: "MD", ocultar_rotulo: true }, { name: "Montante de comunicaciones (tubería 2\" desde el rack)" });
      } else {
        const lk = linkOf(c, w.key)!;
        start = glob(w, v(r4((w.xa + w.xb) / 2 + 0.3), 0.7));
        if (f === 1) lead = [...orthoPath([rack, v(r4((xa + xb) / 2 + 0.3), r4((lk.c0 + lk.c1) / 2 + 0.2))], "y"), v(start.x, r4((lk.c0 + lk.c1) / 2 + 0.2))];
        else b.device("DOM", "montante", start, 0, { rotulo: `MD-${w.key}`, ocultar_rotulo: true }, { name: `Montante de comunicaciones del ${w.name.toLowerCase()} (tubería 2" desde el rack)` });
      }
      const sfx = w.key === "A" ? "" : ` ${w.key}`;
      const go = (sys: string, list: Vec2[], first: "x" | "y", label: string) => {
        const pts = mine(list);
        if (pts.length) run(b, "DOM", sys, [...lead, ...orthoPath([start, ...chain(start, pts)], first)], {}, label);
      };
      go("DAT", lan, "y", `Cat 6A piso ${f}${sfx}`);
      go("BUS", bus, "x", `Bus KNX piso ${f}${sfx}`);
      go("BUS", sec, "y", `Seguridad piso ${f}${sfx}`);
    }
  }
  // Exterior: videoportero, cerradura, contactos y cámaras.
  b.levelId = levels[0]!;
  const door = v(r4((xa + xb) / 2), 0.0);
  const ext: Vec2[] = [];
  ext.push(D("videoportero", v(r4(door.x + 1.0), -0.15), 1.5, "Videoportero IP en la puerta principal", 1));
  ext.push(D("cerradura", v(r4(door.x - 0.5), 0.15), 1.0, "Cerradura inteligente puerta principal", 1));
  ext.push(D("magnetico", v(r4(door.x + 0.3), 0.15), 2.1, "Contacto magnético puerta principal", 1));
  const cams: [Vec2, string][] = [
    [v(-0.25, -0.25), "Cámara IP esquina suroccidental"],
    [v(r4(W + 0.25), -0.25), "Cámara IP esquina suroriental"],
    [v(-0.25, r4(L + 0.25)), "Cámara IP esquina noroccidental"],
    [v(r4(W + 0.25), r4(L + 0.25)), "Cámara IP esquina nororiental"],
  ];
  if (c.carport) cams.push([v(r4(-c.carport + 0.2), 6.2), "Cámara IP parqueadero"]);
  for (const wn of c.wings.slice(1)) {
    const w = wn.w;
    cams.push([glob(w, v(-0.25, r4(w.L + 0.25))), `Cámara IP ${w.name.toLowerCase()} (esquina 1)`], [glob(w, v(r4(w.W + 0.25), r4(w.L + 0.25))), `Cámara IP ${w.name.toLowerCase()} (esquina 2)`]);
  }
  for (const [at, name] of cams) ext.push(D("camara", at, 2.6, name, 1));
  b.levelId = levels[0]!;
  run(b, "DOM", "DAT", orthoPath([rack, ...chain(rack, ext)], "x"), {}, "Cat 6A exterior (PoE)");
}

// ─── Gas ─────────────────────────────────────────────────────

/** Calentador de agua: misma posición que en la red hidráulica (esquina interior de ropas). */
function heaterAt(c: NetCtx): Vec2 {
  const ropas = c.rooms.find((r) => r.name === "Ropas") ?? c.rooms.find((r) => r.type === "ropas") ?? c.rooms[0]!;
  return v(r4(ropas.x1 - 0.35), r4(ropas.y1 - 0.35));
}

const GAS_IN: readonly [string, number][] = [
  ["PE-AL-PE 1620", 16],
  ["PE-AL-PE 2025", 20],
  ["PE-AL-PE 2632", 26],
  ["PE-AL-PE 3240", 32],
];
const GAS_UG: readonly [string, number][] = [
  ["PE 100 SDR 11 Ø20 mm", 16.0],
  ["PE 100 SDR 11 Ø25 mm", 20.4],
  ["PE 100 SDR 11 Ø32 mm", 26.2],
  ["PE 100 SDR 11 Ø40 mm", 32.6],
];

/**
 * Red de gas (NTC 2505 / NTC 3631 / NTC 3853): suministro de gas natural (centro de medición), GLP en tanque
 * estacionario o GLP en caseta de cilindros, línea matriz enterrada, montante por la fachada del lado de la cocina
 * y ramales a cubierta de cocción, calentador de paso, secadora y asador. Diámetros por Renouard en baja presión.
 */
export function buildGas(c: NetCtx): void {
  const { b, p, lay, levels, rooms } = c;
  const { xa, xb, W, L } = lay;
  const glp = p.gas !== "natural";
  const pci = glp ? 26.0 : 10.35;
  const dens = glp ? 1.52 : 0.62;
  const dpMax = glp ? 2.8 : 2.0;
  b.levelId = levels[0]!;
  const kitchen = rooms.find((r) => r.type === "cocina" && r.floor === 1) ?? rooms.find((r) => r.type === "cocina");
  const west = kitchen ? (kitchen.x0 + kitchen.x1) / 2 < W / 2 : true;
  const mainX = west ? -0.45 : r4(W + 0.45);
  // Artefactos
  type App = { at: Vec2; kw: number; tag: string; name: string; h: number; out: Vec2 };
  const apps: App[] = [];
  const arq = [...b.store.entities()].filter((e): e is Device => e.kind === "Device" && e.discipline === "ARQ" && b.store.indices.levelOfElement(e.id) === levels[0]);
  const stove = arq.find((d) => d.symbol === "estufa");
  if (stove) apps.push({ at: stove.position, kw: 11, tag: "EST 11 kW", name: "Cubierta de cocción a gas 5 puestos (11 kW)", h: 0.6, out: v(r4(stove.position.x), r4(stove.position.y - 0.35)) });
  const heater = heaterAt(c);
  apps.push({ at: v(heater.x, r4(heater.y - 0.9)), kw: 36, tag: "CAL 36 kW", name: "Calentador de paso 20 L/min (36 kW), tiro forzado", h: 1.5, out: v(r4(heater.x - 0.25), heater.y) });
  const dryer = arq.find((d) => d.symbol === "electrodomestico" && d.properties?.["rotulo"] === "SEC");
  if (dryer) apps.push({ at: v(dryer.position.x, r4(dryer.position.y + 0.9)), kw: 6, tag: "SEC 6 kW", name: "Secadora de ropa a gas (6 kW)", h: 0.3, out: v(dryer.position.x, r4(dryer.position.y + 0.15)) });
  const bbq = arq.find((d) => d.symbol === "mueble" && d.properties?.["rotulo"] === "BBQ");
  if (bbq) apps.push({ at: v(bbq.position.x, r4(bbq.position.y - 0.9)), kw: 10, tag: "BBQ 10 kW", name: "Asador a gas de la terraza (10 kW)", h: 0.6, out: v(bbq.position.x, r4(bbq.position.y - 0.35)) });
  const kwTot = apps.reduce((t, a) => t + a.kw, 0);
  for (const a of apps) {
    b.device("GAS", "artefacto-gas", a.at, a.h, { kw: a.kw, ocultar_rotulo: true }, { name: a.name, tag: a.tag });
    b.device("GAS", "punto-gas", a.out, a.h, { ocultar_rotulo: true }, { name: `Salida ${a.name.split(" (")[0]!.toLowerCase()} con válvula de 1/4 de vuelta` });
  }
  // Suministro
  const hx = (xa + xb) / 2;
  const sx = r4(west ? hx - 2.9 : hx + 2.9);
  const yIn = -1.2;
  let src: Vec2;
  let srcName: string;
  if (p.gas === "natural") {
    src = v(sx, -3.0);
    b.device("GAS", "medidor-gas", src, 1.0, { ocultar_rotulo: true }, { name: `Centro de medición G${kwTot > 60 ? 10 : 6} en nicho de fachada: válvula de acometida, regulador de 2.ª etapa a 20 mbar y medidor` });
    srcName = "Centro de medición";
    b.note("GAS", "text", [v(sx, -3.75)], "ACOMETIDA DE GAS NATURAL DEL DISTRIBUIDOR", { align: "center" }, 1.6);
  } else if (p.gas === "tanque") {
    const big = kwTot > 45;
    const gal = big ? 250 : 120;
    src = v(sx, -5.4);
    b.device("GAS", "tanque-glp", src, 0, { largo_m: big ? 2.45 : 1.9, diametro_m: big ? 0.95 : 0.76, rotulo: `GLP ${gal} gal` }, { name: `Tanque estacionario de GLP ${gal} gal (${big ? 946 : 454} L) sobre base de concreto, con regulador de 1.ª etapa, válvula de llenado, indicador de nivel y válvula de alivio`, tag: "TK-GLP" });
    b.note("GAS", "dashed", [v(r4(sx - 3), r4(src.y + 3)), v(r4(sx + 3), r4(src.y + 3)), v(r4(sx + 3), r4(src.y - 3)), v(r4(sx - 3), r4(src.y - 3)), v(r4(sx - 3), r4(src.y + 3))], undefined, {});
    b.note("GAS", "text", [v(sx, -6.4)], "RADIO DE SEGURIDAD 3.00 m: SIN ABERTURAS, FUENTES DE IGNICIÓN NI DESAGÜES", { align: "center" }, 1.4);
    b.note("GAS", "text", [v(sx, -6.9)], "ACCESO VEHICULAR PARA EL LLENADO (MANGUERA ≤ 30 m)", { align: "center" }, 1.4);
    srcName = "Tanque GLP";
  } else {
    const n = kwTot > 45 ? 4 : 2;
    const w = 0.5 * n + 0.4;
    src = v(sx, -3.8);
    b.device("GAS", "pipetas", src, 0, { cilindros: n, ancho_m: w, fondo_m: 0.8, rotulo: `${n} × 100 lb` }, { name: `Caseta de pipetas de GLP: ${n} cilindros de 100 lb (${n / 2} en servicio + ${n / 2} de reserva), múltiple con regulador de cambio automático de 1.ª etapa, en mampostería con puerta en malla, ventilación superior e inferior y piso elevado`, tag: "CP-GLP" });
    b.note("GAS", "text", [v(sx, -4.55)], "CUARTO DE PIPETAS EXTERIOR: VENTILACIÓN NATURAL PERMANENTE, A ≥ 1.0 m DE ABERTURAS Y ≥ 1.5 m DE FUENTES DE IGNICIÓN", { align: "center" }, 1.4);
    srcName = "Caseta de pipetas";
  }
  const vg = v(sx, r4(yIn - 0.5));
  b.device("GAS", "valvula-gas", vg, 0.5, { ocultar_rotulo: true }, { name: `Válvula de corte general de gas${glp ? " y regulador de 2.ª etapa a 28 mbar" : ""}` });
  b.device("DOM", "valvula-motorizada", v(r4(sx + (west ? -0.5 : 0.5)), yIn), 0.5, { ocultar_rotulo: true }, { name: "Electroválvula de corte de gas (detectores de gas)" });
  // Derivaciones sobre la matriz (ordenadas desde el suministro) y caudales acumulados.
  type Tap = { y: number; app: App };
  const taps: Tap[] = apps.map((a) => ({ y: a.at.y > L ? r4(Math.min(a.at.y, L + 3.0)) : a.out.y, app: a })).sort((a2, b2) => a2.y - b2.y);
  const yEnd = taps.length ? taps[taps.length - 1]!.y : 0;
  // Longitud de la ruta crítica para fijar la caída admisible por metro.
  const far = taps[taps.length - 1];
  const lcrit = Math.abs(src.y - yIn) + Math.abs(sx - mainX) + Math.abs(yEnd - yIn) + (far ? Math.abs(far.app.out.x - mainX) + 1.5 : 0);
  const perM = (dpMax * 0.9) / (lcrit * 1.2);
  const size = (kw: number, list: readonly [string, number][]) => {
    const q = kw / pci;
    return list.find(([, di]) => renouardDrop(dens, 1, q, di) <= perM) ?? list[list.length - 1]!;
  };
  let g = 0;
  const G = (pts: Vec2[], kw: number, list: readonly [string, number][], tramo: string, crit: boolean, vert = 0) => {
    const [name, di] = size(kw, list);
    g++;
    run(b, "GAS", "GAS", pts, { tramo: `G-${g} ${tramo}`, kw: r2(kw), di_mm: di, diametro: name, ruta_critica: crit, ...(vert ? { vertical_m: vert } : {}) }, `G-${g} ${name.replace("PE-AL-PE ", "").replace("PE 100 SDR 11 ", "PE ")}`);
  };
  b.levelId = levels[0]!;
  G([src, v(sx, yIn), v(mainX, yIn)], kwTot, GAS_UG, `${srcName} → fachada (enterrada a 0.60 m)`, true, 0.6);
  let prev = yIn;
  let rest = kwTot;
  for (let i = 0; i < taps.length; i++) {
    const t = taps[i]!;
    if (t.y > prev + 0.01) G([v(mainX, prev), v(mainX, t.y)], rest, GAS_IN, `Matriz por fachada → ${t.app.tag.split(" ")[0]}`, true);
    const a = t.app;
    const pts = a.at.y > L ? [v(mainX, t.y), v(a.out.x, t.y), a.out] : [v(mainX, t.y), v(a.out.x, t.y), a.out];
    G(pts, a.kw, GAS_IN, `Ramal ${a.name.split(" (")[0]!.toLowerCase()}`, i === taps.length - 1, Math.max(0, a.h - 0.3));
    rest -= a.kw;
    prev = Math.max(prev, t.y);
  }
  // Seguridad y ventilación de los recintos con artefactos a gas
  const glpH = glp ? 0.3 : 2.5;
  const ropas = rooms.find((r) => r.name === "Ropas");
  for (const r of [kitchen, ropas]) {
    if (!r) continue;
    b.device("DOM", "detector-gas", v(r4(west ? r.x0 + 0.3 : r.x1 - 0.3), r4(r.y0 + 0.6)), glpH, { ocultar_rotulo: true }, { name: `Detector de gas ${r.name.toLowerCase()} (${glp ? "a 0.30 m del piso: el GLP es más pesado que el aire" : "a 0.30 m del techo: el gas natural es más liviano que el aire"})` });
    b.device("GAS", "rejilla-ventilacion", v(r4(west ? r.x0 + 0.06 : r.x1 - 0.06), r4((r.y0 + r.y1) / 2)), glp ? 0.15 : 2.4, { ocultar_rotulo: true }, { name: `Rejilla de ventilación permanente ${r.name.toLowerCase()} (NTC 3631)`, rot: Math.PI / 2 } as never);
  }
  void xb;
}
