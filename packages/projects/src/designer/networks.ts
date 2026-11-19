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
import { hunterFlow } from "@arken/calc";
import { chain, orthoPath, v, type ProjectBuilder, type Props } from "../builder";
import type { HouseProgram } from "./program";
import type { Layout } from "./layout";
import type { Room } from "./build";

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
  const H = (sym: string, at: Vec2, h: number, props: Props, name: string, tag?: string) => b.device("HID", sym, at, h, { ...props, ocultar_rotulo: true }, { name, ...(tag ? { tag } : {}) });

  const mx = r4(xa + 0.15); // montante de agua fría
  const hx = r4(xa + 0.3); // montante de agua caliente
  const rx = r4(xa + 0.42); // retorno de recirculación
  const my = 1.4;
  const tank = v(r4(W + 3.8), 1.6);
  const pump = v(r4(W + 3.8), 3.2);
  const meter = v(r4((xa + xb) / 2 - 1.6), -3.0);

  // Suministro (primer piso y exterior)
  b.levelId = levels[0]!;
  H("medidor-agua", meter, 0.3, {}, "Medidor de agua 3/4\" con registro de corte y cheque", "MA");
  b.device("DOM", "valvula-motorizada", v(meter.x, -2.4), 0.3, { ocultar_rotulo: true }, { name: "Electroválvula de corte general de agua (sensores de fuga)" });
  H("tanque", tank, 0, { diametro_m: 1.6, rotulo: `${(tankL / 1000).toFixed(1)} m³` }, `Tanque de reserva enterrado ${tankL} L (1.5 días para ${people} personas a 250 L/hab·día)`);
  const pumpUc = pipe(ucAll, PVC);
  H("bomba", pump, 0.3, {}, `Equipo de presión ${ucAll > 40 ? "1.5" : "1"} HP, 40 m.c.a., tanque hidroacumulador 80 L, variador de velocidad`);
  H("filtro", v(pump.x - 0.9, pump.y), 0.3, {}, "Filtro de sedimentos 20 µm + carbón activado");
  run(b, "HID", "PRI", [meter, v(meter.x, -2.0), v(tank.x, -2.0), v(tank.x, r4(tank.y - 0.8))], { tramo: "AP-0 Acometida → tanque de reserva", uc: r2(ucAll), q_l_s: 0.35, di_mm: 30.2, diametro: "PVC 1\" RDE 21" }, "AP-0 PVC 1\"");
  run(b, "HID", "PRI", [pump, v(r4(W + 1.0), pump.y), v(r4(W + 1.0), -0.7), v(mx, -0.7), v(mx, my)], { tramo: "AP-1 Equipo de presión → montante MH", uc: r2(ucAll), di_mm: pumpUc.di, diametro: pumpUc.name }, `AP-1 ${short(pumpUc.name)}`);
  H("valvula", v(r4(mx + 0.25), my), 0.3, {}, "Registro general de la casa");

  // Calentador de acumulación (en ropas) y montante de agua caliente.
  const ropas = c.rooms.find((r) => r.name === "Ropas") ?? c.rooms.find((r) => r.type === "ropas") ?? c.rooms[0]!;
  const heater = v(r4(ropas.x1 - 0.35), r4(ropas.y1 - 0.35));
  const ucAC = all.reduce((t, f) => t + f.ucAC, 0);
  const tankHot = p.habitaciones >= 5 ? 300 : p.habitaciones >= 3 ? 200 : 150;
  H("calentador-electrico", heater, 1.5, { uc_ac: 0 }, `Calentador eléctrico de acumulación ${tankHot} L, 4.5 kW, 240 V, con válvula de alivio y vaso de expansión`, "CAE");
  H("bomba-recirculacion", v(heater.x, r4(heater.y - 0.55)), 0.5, {}, "Bomba de recirculación de agua caliente 1/25 HP con temporizador y termostato");
  const hp = pipe(ucAC);
  run(b, "HID", "AF", orthoPath([v(mx, my), v(mx, r4(my - 0.25)), v(heater.x, r4(my - 0.25)), heater], "y"), { tramo: "AF-C Alimentación calentador", uc: r2(ucAC), di_mm: hp.di, diametro: hp.name }, `AF-C ${short(hp.name)}`);
  run(b, "HID", "AC", orthoPath([heater, v(heater.x, r4(my + 0.25)), v(hx, r4(my + 0.25)), v(hx, my)], "x"), { tramo: "AC-0 Calentador → montante MC", uc: r2(ucAC), di_mm: hp.di, diametro: `${hp.name} aislada` }, `AC-0 ${short(hp.name)}`);
  run(b, "HID", "RC", orthoPath([v(rx, my), v(rx, r4(my + 0.4)), v(r4(heater.x + 0.2), r4(my + 0.4)), v(r4(heater.x + 0.2), r4(heater.y - 0.55))], "y"), {}, "Retorno recirculación Ø16");

  // Pisos: montantes, troncal por el hall y ramales por recinto.
  for (let f = 1; f <= p.pisos; f++) {
    b.levelId = levels[f - 1]!;
    const here = all.filter((x) => x.floor === f);
    const above = all.filter((x) => x.floor > f);
    const ucUpAF = above.reduce((t, x) => t + x.ucAF, 0);
    const ucUpAC = above.reduce((t, x) => t + x.ucAC, 0);
    const lbl = (up: boolean) => (f === 1 ? (up ? "sube" : "") : up ? "sube / llega" : "llega");
    H("montante", v(mx, my), 0, { rotulo: `MH ${lbl(f < p.pisos)}` }, `Montante de agua fría MH (${f < p.pisos ? `sube al piso ${f + 1}` : "llega del piso inferior"})`, "MH");
    H("montante", v(hx, r4(my - 0.45)), 0, { rotulo: `MC ${lbl(f < p.pisos)}` }, "Montante de agua caliente MC", "MC");
    if (f < p.pisos) {
      const a = pipe(ucUpAF);
      const h = pipe(ucUpAC);
      run(b, "HID", "AF", [v(mx, my), v(mx, r4(my + 0.05))], { tramo: `MH-${f} Montante AF piso ${f} → ${f + 1}`, uc: r2(ucUpAF), di_mm: a.di, diametro: a.name, longitud_extra_m: lay.dims.floorH }, `MH-${f} ${short(a.name)}`);
      run(b, "HID", "AC", [v(hx, my), v(hx, r4(my + 0.05))], { tramo: `MC-${f} Montante AC piso ${f} → ${f + 1}`, uc: r2(ucUpAC), di_mm: h.di, diametro: `${h.name} aislada`, longitud_extra_m: lay.dims.floorH }, `MC-${f} ${short(h.name)}`);
    }
    if (!here.length) continue;
    // Ramales por recinto
    const groups = byRoom(here);
    type Br = { y: number; ucAF: number; ucAC: number };
    const branches: Br[] = [];
    let k = 0;
    for (const g of groups) {
      const r = g[0]!.room;
      const west = (r.x0 + r.x1) / 2 < mx;
      const ey = r4(Math.min(r.y1 - 0.35, Math.max(r.y0 + 0.35, g.reduce((t, x) => t + x.at.y, 0) / g.length)));
      const reg = v(r4(west ? Math.min(r.x1 - 0.3, xa - 0.3) : Math.max(r.x0 + 0.3, xb + 0.3)), ey);
      const ucAF = g.reduce((t, x) => t + x.ucAF, 0);
      const ucACr = g.reduce((t, x) => t + x.ucAC, 0);
      branches.push({ y: ey, ucAF, ucAC: ucACr });
      k++;
      const a = pipe(ucAF);
      H("valvula", reg, 0.3, {}, `Colector multicapa con llaves de corte por salida: ${r.name.toLowerCase()}`);
      run(b, "HID", "AF", [v(mx, ey), reg], { tramo: `AF-${f}.${k} Ramal ${r.name.toLowerCase()}`, uc: r2(ucAF), di_mm: a.di, diametro: a.name }, `AF-${f}.${k} ${short(a.name)}`);
      if (ucACr > 0) {
        const h = pipe(ucACr);
        run(b, "HID", "AC", [v(hx, r4(ey + 0.12)), v(reg.x, r4(ey + 0.12))], { tramo: `AC-${f}.${k} Ramal ${r.name.toLowerCase()}`, uc: r2(ucACr), di_mm: h.di, diametro: `${h.name} aislada` }, `AC-${f}.${k} ${short(h.name)}`);
      }
      for (const x of g) {
        const sym = x.ucAC > 0 ? "punto-afac" : "punto-af";
        H(sym, x.at, x.kind === "ducha" ? 1.1 : x.kind === "wc" ? 0.2 : 0.55, { uc_af: x.ucAF, ...(x.ucAC ? { uc_ac: x.ucAC } : {}) }, x.name);
        run(b, "HID", "AF", orthoPath([reg, x.at], "y"), {}, "Ø16");
        if (x.ucAC > 0) run(b, "HID", "AC", orthoPath([v(reg.x, r4(ey + 0.12)), v(r4(x.at.x + 0.08), r4(x.at.y))], "y"), {}, "");
      }
    }
    // Troncal por el hall: tramos entre derivaciones, con las UC de lo que queda aguas abajo.
    const ys = [...new Set(branches.map((x) => x.y))].sort((a, c) => a - c);
    const north = ys.filter((y) => y > my);
    const south = ys.filter((y) => y <= my).sort((a, c) => c - a);
    let t = 0;
    for (const seq of [north, south]) {
      let prev = my;
      for (let i = 0; i < seq.length; i++) {
        const rest = branches.filter((x) => seq.slice(i).includes(x.y));
        const ucA = rest.reduce((s, x) => s + x.ucAF, 0);
        const ucH = rest.reduce((s, x) => s + x.ucAC, 0);
        const a = pipe(ucA);
        t++;
        run(b, "HID", "AF", [v(mx, prev), v(mx, seq[i]!)], { tramo: `AF-${f}.T${t} Troncal hall`, uc: r2(ucA), di_mm: a.di, diametro: a.name }, `T${t} ${short(a.name)}`);
        if (ucH > 0) {
          const h = pipe(ucH);
          run(b, "HID", "AC", [v(hx, prev === my ? r4(my - 0.45) : r4(prev + 0.12)), v(hx, r4(seq[i]! + 0.12))], { tramo: `AC-${f}.T${t} Troncal hall`, uc: r2(ucH), di_mm: h.di, diametro: `${h.name} aislada` }, "");
        }
        prev = seq[i]!;
      }
    }
    // Retorno de recirculación desde la derivación de agua caliente más lejana.
    const far = branches.filter((x) => x.ucAC > 0).sort((a, c) => Math.abs(c.y - my) - Math.abs(a.y - my))[0];
    if (far) run(b, "HID", "RC", [v(hx, r4(far.y + 0.12)), v(rx, r4(far.y + 0.12)), v(rx, my)], {}, "");
  }

  // Llaves de jardín
  b.levelId = levels[0]!;
  const L0 = lay.L;
  const garden: [Vec2, string][] = [
    [v(r4(W + 0.12), r4(lay.L / 2)), "Llave de jardín oriente"],
    [v(-0.12, r4(lay.L - 1.5)), "Llave de jardín occidente"],
  ];
  if (c.carport) garden.push([v(r4(-c.carport + 0.3), 6.2), "Llave de lavado parqueadero"]);
  if (p.terraza) garden.push([v(1.0, r4(lay.L + 0.12)), "Llave de jardín terraza"]);
  // Red exterior de riego enterrada, derivada de la impulsión del equipo de presión (fuera de la casa).
  const yN = r4(L0 + (p.terraza ? 4.0 : 1.0));
  const ex = r4(W + 1.0);
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

// ─── Aguas residuales ────────────────────────────────────────

export function buildSanitary(c: NetCtx): void {
  const { b, p, lay, levels } = c;
  const { W } = lay;
  const all = fixtures(c).filter((f) => f.ud > 0);
  const S = (sym: string, at: Vec2, props: Props, name: string, tag?: string, lvl = levels[0]!) => {
    b.levelId = lvl;
    return b.device("SAN", sym, at, 0, { ...props, ocultar_rotulo: true }, { name, ...(tag ? { tag } : {}) });
  };
  const colX = { W: -1.4, E: r4(W + 1.4) } as const;
  const yS = -1.8;
  // Entradas al colector perimetral: { lado, y, ud, sanitarios }
  type Inlet = { side: "W" | "E"; y: number; ud: number; wc: number; name: string };
  const inlets: Inlet[] = [];
  let bn = 0;
  let rn = 0;
  for (const g of byRoom(all)) {
    const r = g[0]!.room;
    const sd = side(c, r);
    const lvl = levels[r.floor - 1]!;
    const wc = g.filter((x) => x.kind === "wc").length;
    const ud = g.reduce((t, x) => t + x.ud, 0);
    const kitchen = r.type === "cocina";
    const d = wc ? "4" : kitchen || ud > 6 ? "3" : "2";
    const ey = r4(Math.min(r.y1 - 0.3, Math.max(r.y0 + 0.3, (g.find((x) => x.kind === "wc") ?? g[0]!).drain.y)));
    const exitX = sd === "W" ? 0.3 : r4(W - 0.3);
    b.levelId = lvl;
    // Desagües de aparatos y colector del recinto
    for (const x of g) {
      S(x.kind === "wc" ? "salida-sanitario" : x.kind === "ducha" ? "rejilla" : "sifon", x.drain, { ud: x.ud }, x.name, undefined, lvl);
      b.levelId = lvl;
      run(b, "SAN", "AN", orthoPath([x.drain, v(x.drain.x, ey)], "y"), {}, x.kind === "wc" ? "Ø4\"" : "Ø2\"");
    }
    if (r.type === "bano" || r.type === "bano-social" || r.type === "ropas") {
      const fd = v(r4((r.x0 + r.x1) / 2), r4((r.y0 + r.y1) / 2));
      if (!g.some((x) => x.kind === "ducha")) {
        S("rejilla", fd, { ud: 1 }, `Rejilla de piso ${r.name.toLowerCase()}`, undefined, lvl);
        b.levelId = lvl;
        run(b, "SAN", "AN", orthoPath([fd, v(fd.x, ey)], "y"), {}, "Ø2\"");
      }
    }
    const xs = g.map((x) => x.drain.x);
    const far = sd === "W" ? Math.max(...xs) : Math.min(...xs);
    rn++;
    const udR = ud + (g.some((x) => x.kind === "ducha") ? 0 : r.type === "bano" || r.type === "bano-social" || r.type === "ropas" ? 1 : 0);
    if (r.floor === 1) {
      const target = v(colX[sd], ey);
      if (kitchen) {
        const tg = v(sd === "W" ? -0.65 : r4(W + 0.65), ey);
        S("trampa-grasas", tg, {}, "Trampa de grasas prefabricada 60 L");
        b.levelId = lvl;
        run(b, "SAN", "AN", [v(far, ey), tg], { tramo: `R-${rn} ${r.name} → trampa de grasas`, ud: udR, diametro_pulg: d, pendiente_pct: 2, sanitarios: wc }, `R-${rn} Ø${d}" S=2%`);
        run(b, "SAN", "AN", [tg, target], {}, `Ø${d}"`);
      } else run(b, "SAN", "AN", [v(far, ey), target], { tramo: `R-${rn} ${r.name} → colector ${sd === "W" ? "occidental" : "oriental"}`, ud: udR, diametro_pulg: d, pendiente_pct: 2, sanitarios: wc }, `R-${rn} Ø${d}" S=2%`);
      inlets.push({ side: sd, y: ey, ud: udR, wc, name: r.name });
    } else {
      // Bajante por el muro de fachada hasta el primer piso
      bn++;
      const bx = exitX;
      run(b, "SAN", "AN", [v(far, ey), v(bx, ey)], { tramo: `R-${rn} ${r.name} → bajante BAN-${bn}`, ud: udR, diametro_pulg: d === "2" ? "3" : d, pendiente_pct: 2, sanitarios: wc }, `R-${rn} Ø${d === "2" ? "3" : d}" S=2%`);
      for (let f = r.floor; f >= 1; f--) S("bajante-an", v(bx, ey), { rotulo: `BAN-${bn}` }, `Bajante BAN-${bn} Ø4" (${r.name.toLowerCase()}, piso ${r.floor}) con ventilación a cubierta`, `BAN-${bn}`, levels[f - 1]!);
      b.levelId = levels[0]!;
      run(b, "SAN", "AN", [v(bx, ey), v(colX[sd], ey)], { tramo: `BAN-${bn} Bajante → colector ${sd === "W" ? "occidental" : "oriental"}`, ud: udR, diametro_pulg: "4", pendiente_pct: 2, sanitarios: wc }, `BAN-${bn} Ø4" S=2%`);
      inlets.push({ side: sd, y: ey, ud: udR, wc, name: `BAN-${bn}` });
    }
    if (wc || r.type === "cocina") S("ventilacion", v(r4(exitX + (sd === "W" ? 0.25 : -0.25)), r4(ey + 0.3)), {}, `Ventilación ${r.name.toLowerCase()} Ø2" a cubierta`, undefined, lvl);
  }

  // Colectores perimetrales con cajas de inspección (distancia máxima entre cajas 12 m).
  b.levelId = levels[0]!;
  let ci = 0;
  let depth = 0.45;
  const box = (at: Vec2, lado = 0.6) => {
    ci++;
    S("caja", at, { lado_m: lado }, `Caja de inspección ${lado === 0.8 ? "80×80" : "60×60"} cm, batea −${depth.toFixed(2)} m`, `CI-${ci}`);
    return `CI-${ci}`;
  };
  let rk = 100;
  const sum = { ud: 0, wc: 0 };
  const sideRun = (sd: "W" | "E") => {
    const list = inlets.filter((i) => i.side === sd).sort((a, c2) => c2.y - a.y);
    if (!list.length) return undefined;
    const x = colX[sd];
    const stops: number[] = [];
    for (const i of list) if (!stops.some((y) => Math.abs(y - i.y) < 0.9)) stops.push(i.y);
    // cajas intermedias
    const full: number[] = [];
    for (let i = 0; i < stops.length; i++) {
      full.push(stops[i]!);
      const next = i + 1 < stops.length ? stops[i + 1]! : yS;
      for (let y = stops[i]! - 12; y > next + 1; y -= 12) full.push(r4(y));
    }
    full.push(yS);
    let ud = 0;
    let wc = 0;
    depth = 0.45;
    let prevTag = box(v(x, full[0]!));
    for (let i = 0; i < full.length - 1; i++) {
      for (const inl of list.filter((q) => Math.abs(q.y - full[i]!) < 0.9)) (ud += inl.ud), (wc += inl.wc);
      const a = v(x, full[i]!);
      const z = v(x, full[i + 1]!);
      depth += 0.02 * Math.abs(a.y - z.y);
      const tag = box(z, i + 1 === full.length - 1 ? 0.8 : 0.6);
      rk++;
      b.levelId = levels[0]!;
      run(b, "SAN", "AN", [a, z], { tramo: `R-${rk} ${prevTag} → ${tag} (colector ${sd === "W" ? "occidental" : "oriental"})`, ud, diametro_pulg: "4", pendiente_pct: 2, sanitarios: wc }, `R-${rk} Ø4" S=2%`);
      prevTag = tag;
    }
    sum.ud += ud;
    sum.wc += wc;
    return { tag: prevTag, at: v(x, yS), ud, wc };
  };
  const west = sideRun("W");
  const east = sideRun("E");
  const fin = v(colX.E, yS);
  let finalTag = east?.tag;
  if (west) {
    depth += 0.02 * (colX.E - colX.W);
    rk++;
    if (!east) finalTag = box(fin, 0.8);
    b.levelId = levels[0]!;
    run(b, "SAN", "AN", [west.at, fin], { tramo: `R-${rk} ${west.tag} → ${finalTag} (colector sur)`, ud: west.ud, diametro_pulg: "4", pendiente_pct: 2, sanitarios: west.wc }, `R-${rk} Ø4" S=2%`);
  }
  const out = v(colX.E, -4.2);
  rk++;
  b.levelId = levels[0]!;
  run(b, "SAN", "AN", [fin, out], { tramo: `R-${rk} ${finalTag ?? "CI"} → red de alcantarillado`, ud: sum.ud, diametro_pulg: sum.ud > 216 ? "6" : "4", pendiente_pct: 2, sanitarios: sum.wc }, `R-${rk} Ø${sum.ud > 216 ? 6 : 4}" S=2%`);
  b.note("SAN", "text", [v(r4(colX.E + 0.3), -4.4)], "A RED DE ALCANTARILLADO (O SISTEMA SÉPTICO + FAFA SI NO HAY RED)", {}, 1.6);
  void p;
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
  const { W, L } = lay;
  const flat = p.cubierta === "plana";
  const roofA = (W + 2 * eave) * (L + 2 * eave);
  // Bajantes Ø4": una por cada 70 m² de cubierta, mínimo 4, repartidas por las fachadas oriental y occidental.
  const n = Math.max(4, Math.ceil(roofA / 70));
  const perSide = Math.ceil(n / 2);
  const each = roofA / (perSide * 2);
  const x = { W: flat ? 0.3 : r4(-eave + 0.15), E: flat ? r4(W - 0.3) : r4(W + eave - 0.15) } as const;
  const cx = { W: -2.4, E: r4(W + 2.4) } as const;
  const yS = -2.6;
  // Canales (cubiertas inclinadas) o sifones (cubierta plana) en el nivel de cubierta.
  b.levelId = c.roofLevel;
  const y0 = r4(-eave + 0.15),
    y1 = r4(L + eave - 0.15);
  if (flat) b.note("SAN", "text", [v(r4(W / 2), r4(L / 2 - 1.2))], "SIFONES DE CUBIERTA Ø4\" CON REJILLA DE CÚPULA", { align: "center" }, 1.8);
  else
    for (const sd of ["W", "E"] as const) {
      const ch = pipeRun(roofA / 2);
      run(b, "SAN", "CANAL", [v(x[sd], y0), v(x[sd], y1)], {}, `Canal ${sd === "W" ? "occidental" : "oriental"} lámina galv. cal. 22, 15×12 cm, S = 0.5 % (${ch})`);
    }
  let k = 0;
  const totals: Record<"W" | "E", number> = { W: 0, E: 0 };
  for (const sd of ["W", "E"] as const) {
    for (let i = 0; i < perSide; i++) {
      const y = r4(y0 + ((y1 - y0) * (i + 0.5)) / perSide);
      k++;
      b.levelId = c.roofLevel;
      b.device("SAN", "bajante", v(x[sd], y), 0, { ocultar_rotulo: true }, { name: `Bajante de aguas lluvias BALL-${k} Ø4"`, tag: `BALL-${k}` });
      b.levelId = levels[0]!;
      b.device("SAN", "bajante", v(x[sd], y), 0, { ocultar_rotulo: true }, { name: `Bajante de aguas lluvias BALL-${k} Ø4"`, tag: `BALL-${k}` });
      b.device("SAN", "caja", v(cx[sd], y), 0, { lado_m: 0.5, ocultar_rotulo: true }, { name: "Caja de aguas lluvias 50×50 cm", tag: `CALL-${k}` });
      const q = rainQ(each);
      run(b, "SAN", "ALL", [v(x[sd], y), v(cx[sd], y)], { tramo: `BALL-${k} Bajante (${each.toFixed(0)} m² de cubierta)`, area_m2: r2(each), diametro: "PVC 4\"", capacidad_l_s: 9 }, `BALL-${k} Ø4"`);
      void q;
    }
    totals[sd] = each * perSide;
    const [dn, cap] = rainPipe(rainQ(totals[sd]));
    run(b, "SAN", "ALL", [v(cx[sd], y1), v(cx[sd], yS)], { tramo: `Colector ${sd === "W" ? "occidental" : "oriental"} de aguas lluvias`, area_m2: r2(totals[sd]), diametro: dn, capacidad_l_s: cap }, `ALL ${dn.replace("PVC ", "Ø")} S=1%`);
  }
  // Colector sur hasta la descarga, con tanque de aprovechamiento para riego.
  const [dn, cap] = rainPipe(rainQ(roofA));
  run(b, "SAN", "ALL", [v(cx.W, yS), v(cx.E, yS), v(r4(cx.E + 2.0), yS)], { tramo: "Colector sur de aguas lluvias → descarga", area_m2: r2(roofA), diametro: dn, capacidad_l_s: cap }, `ALL ${dn.replace("PVC ", "Ø")} S=1%`);
  b.device("SAN", "tanque", v(r4(cx.E + 2.4), r4(L / 2)), 0, { diametro_m: 1.5, rotulo: "ALL 3 m³", ocultar_rotulo: true }, { name: "Tanque de aprovechamiento de aguas lluvias 3 m³ para riego, con rebose al colector" });
  run(b, "SAN", "ALL", [v(cx.E, r4(L / 2)), v(r4(cx.E + 1.65), r4(L / 2))], {}, "Ø4\" a tanque");
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
    // WiFi: un punto de acceso por cada 120 m² de piso, en el hall.
    const aps = Math.max(1, Math.ceil((W * L) / 120));
    for (let i = 0; i < aps; i++) lan.push(D("ap-wifi", v(r4((xa + xb) / 2), r4((L * (i + 0.5)) / aps)), 2.7, `Punto de acceso WiFi 6 PoE piso ${f}`, f));
    b.levelId = levels[f - 1]!;
    const start = f === 1 ? rack : v(r4(xa + 0.6), 1.4);
    if (f > 1) b.device("DOM", "montante", start, 0, { rotulo: "MD", ocultar_rotulo: true }, { name: "Montante de comunicaciones (tubería 2\" desde el rack)" });
    if (lan.length) run(b, "DOM", "DAT", orthoPath([start, ...chain(start, lan)], "y"), {}, `Cat 6A piso ${f}`);
    if (bus.length) run(b, "DOM", "BUS", orthoPath([start, ...chain(start, bus)], "x"), {}, `Bus KNX piso ${f}`);
    if (sec.length) run(b, "DOM", "BUS", orthoPath([start, ...chain(start, sec)], "y"), {}, `Seguridad piso ${f}`);
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
  for (const [at, name] of cams) ext.push(D("camara", at, 2.6, name, 1));
  b.levelId = levels[0]!;
  run(b, "DOM", "DAT", orthoPath([rack, ...chain(rack, ext)], "x"), {}, "Cat 6A exterior (PoE)");
}
