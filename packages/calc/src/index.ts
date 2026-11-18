// Cálculos de ingeniería sobre el modelo (Paso 7).
//
// Todo se DERIVA del modelo: cada vez que se mueve una toma, se cambia una luminaria o se edita
// un circuito, los cuadros se recalculan. Nada de esto se guarda.
// Referencias: NTC 2050 (Código Eléctrico Colombiano), RETIE, RETILAP, NTC 1500 (instalaciones
// hidráulicas y sanitarias), NTC 2505 / NTC 3631 (gas), CREG 174 de 2021 (autogeneración).

import {
  getOfKind,
  pointInPolygon,
  polygonArea,
  polylineLength,
  type Circuit,
  type Device,
  type Id,
  type ModelReader,
  type Project,
  type PropertyValue,
  type Run,
  type Space,
  type Vec2,
} from "@arken/core";

export type Status = "ok" | "revisar" | "info";

export interface Table {
  readonly title: string;
  readonly columns: readonly string[];
  /** Ancho relativo de cada columna. */
  readonly widths: readonly number[];
  readonly rows: readonly { readonly cells: readonly string[]; readonly status?: Status; readonly bold?: boolean }[];
  readonly notes?: readonly string[];
}

const num = (v: PropertyValue | undefined, d = 0) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : d);
const str = (v: PropertyValue | undefined, d = "") => (typeof v === "string" ? v : typeof v === "number" ? String(v) : d);
const f = (x: number, d = 2) => x.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });

function project(reader: ModelReader): Project | undefined {
  for (const e of reader.entities()) if (e.kind === "Project") return e;
  return undefined;
}

export function projectNumber(reader: ModelReader, key: string, d: number): number {
  return num(project(reader)?.properties?.[key], d);
}

function ofKind<K extends "Space" | "Device" | "Run" | "Circuit">(reader: ModelReader, kind: K, levelId?: Id) {
  const out: Extract<Space | Device | Run | Circuit, { kind: K }>[] = [];
  for (const e of reader.entities()) {
    if (e.kind !== kind) continue;
    if (levelId && kind !== "Circuit" && reader.indices.levelOfElement(e.id) !== levelId) continue;
    out.push(e as Extract<Space | Device | Run | Circuit, { kind: K }>);
  }
  return out;
}

const byNumber = (a: { number: string }, b: { number: string }) => a.number.localeCompare(b.number, "es", { numeric: true });

// ─── Áreas ───────────────────────────────────────────────────

export function areaTable(reader: ModelReader, levelId?: Id): Table {
  const spaces = ofKind(reader, "Space", levelId).sort(byNumber);
  const inner = spaces.filter((s) => s.properties?.["exterior"] !== true);
  const outer = spaces.filter((s) => s.properties?.["exterior"] === true);
  const rows: Table["rows"][number][] = [];
  for (const s of inner) rows.push({ cells: [s.number, s.name ?? "", str(s.properties?.["piso"]), f(polygonArea(s.boundary))] });
  const net = inner.reduce((t, s) => t + polygonArea(s.boundary), 0);
  rows.push({ cells: ["", "ÁREA ÚTIL INTERIOR", "", f(net)], bold: true });
  const built = projectNumber(reader, "area_construida_m2", 0);
  if (built > 0) {
    rows.push({ cells: ["", "Muros, columnas y ductos", "", f(built - net)] });
    rows.push({ cells: ["", "ÁREA CONSTRUIDA CUBIERTA", "", f(built)], bold: true });
  }
  for (const s of outer) rows.push({ cells: [s.number, s.name ?? "", str(s.properties?.["piso"]), f(polygonArea(s.boundary))] });
  return { title: "CUADRO DE ÁREAS (m²)", columns: ["N.º", "ESPACIO", "ACABADO DE PISO", "ÁREA"], widths: [0.9, 3.2, 3.2, 1.2], rows };
}

// ─── Eléctrica ───────────────────────────────────────────────

/** Capacidad de corriente de conductores de Cu THHN/THWN-2 a 75 °C, NTC 2050 Tabla 310-16 (A). */
export const AMPACITY_75C: Readonly<Record<string, number>> = { "14": 20, "12": 25, "10": 35, "8": 50, "6": 65, "4": 85, "3": 100, "2": 115, "1": 130, "1/0": 150, "2/0": 175 };
/** Protección máxima para conductores pequeños, NTC 2050 Art. 240-3. */
export const MAX_OCPD: Readonly<Record<string, number>> = { "14": 15, "12": 20, "10": 30 };
/** Resistencia en CA de conductores de Cu en tubería no magnética a 75 °C (Ω/km), NTC 2050 Cap. 9 Tabla 9. */
export const RESISTANCE_OHM_KM: Readonly<Record<string, number>> = { "14": 10.2, "12": 6.6, "10": 3.9, "8": 2.56, "6": 1.61, "4": 1.02, "3": 0.82, "2": 0.62, "1": 0.49, "1/0": 0.39, "2/0": 0.33 };
/** Interruptores normalizados (A). */
export const STANDARD_BREAKERS = [15, 20, 30, 40, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200];

export interface CircuitResult {
  readonly circuit: Circuit;
  readonly devices: number;
  readonly loadVA: number;
  readonly currentA: number;
  readonly lengthM: number;
  readonly dropPct: number;
  readonly issues: readonly string[];
}

/** Carga en VA de un dispositivo eléctrico o de iluminación. */
export function deviceVA(d: Device): number {
  const p = d.properties ?? {};
  if (typeof p["va"] === "number") return p["va"];
  if (typeof p["w"] === "number") {
    const largo = num(p["largo_m"], 0);
    return (d.symbol === "lineal" || d.symbol === "tira") && largo > 0 && p["w_por_m"] === true ? p["w"] * largo : p["w"];
  }
  return 0;
}

export function circuitResults(reader: ModelReader): CircuitResult[] {
  const circuits = ofKind(reader, "Circuit").sort((a, b) => a.panel.localeCompare(b.panel) || byNumber(a, b));
  const devices = ofKind(reader, "Device");
  const runs = ofKind(reader, "Run");
  return circuits.map((c) => {
    const key = (p: Readonly<Record<string, PropertyValue>> | undefined) => str(p?.["circuito"]) === c.number && str(p?.["tablero"], c.panel) === c.panel;
    const own = devices.filter((d) => key(d.properties));
    const loadVA = own.reduce((t, d) => t + deviceVA(d), 0) + (c.extraLoadVA ?? 0);
    const currentA = loadVA / c.voltage;
    const own_runs = runs.filter((r) => key(r.properties));
    const R = RESISTANCE_OHM_KM[c.conductorAwg] ?? 6.6;
    // Caída de tensión por el método de momentos eléctricos: cada salida aporta I_i × L_i, donde L_i es
    // la distancia desde el tablero medida sobre el recorrido dibujado más 2.5 m de bajante/subida en muro.
    // Las cargas sin recorrido o de equipos sin VA propio se suponen al final del circuito (conservador).
    const runLen = own_runs.reduce((t, r) => t + polylineLength(r.points), 0);
    let moment = 0;
    let lengthM = 0;
    for (const d of own) {
      const along = own_runs.length ? Math.min(...own_runs.map((r) => distanceAlong(r.points, d.position))) : runLen;
      const L = along + 2.5;
      lengthM = Math.max(lengthM, L);
      moment += (deviceVA(d) / c.voltage) * L;
    }
    const tailL = Math.max(lengthM, runLen + 2.5);
    moment += ((c.extraLoadVA ?? 0) / c.voltage) * tailL;
    if (own.length === 0) lengthM = tailL;
    const dropPct = ((2 * moment * R) / 1000 / c.voltage) * 100;
    const issues: string[] = [];
    const need = currentA * (c.continuous ? 1.25 : 1);
    if (c.breakerA + 1e-9 < need) issues.push(`Protección ${c.breakerA} A < ${f(need, 1)} A requeridos`);
    const amp = AMPACITY_75C[c.conductorAwg];
    if (amp === undefined) issues.push(`Calibre ${c.conductorAwg} desconocido`);
    else {
      const maxOcpd = Math.min(amp, MAX_OCPD[c.conductorAwg] ?? Infinity);
      const allowed = STANDARD_BREAKERS.filter((b) => b <= maxOcpd).pop() ?? maxOcpd;
      if (c.breakerA > Math.max(allowed, maxOcpd)) issues.push(`Conductor #${c.conductorAwg} no protegido por ${c.breakerA} A`);
    }
    if (dropPct > 3) issues.push(`Caída de tensión ${f(dropPct, 1)} % > 3 %`);
    return { circuit: c, devices: own.length, loadVA, currentA, lengthM, dropPct, issues };
  });
}

/** Distancia, medida sobre la polilínea desde su primer punto, al punto de la polilínea más cercano a `p`. */
export function distanceAlong(points: readonly Vec2[], p: Vec2): number {
  let best = Infinity;
  let bestS = 0;
  let acc = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
    const d = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
    if (d < best - 1e-9) (best = d), (bestS = acc + Math.sqrt(L2) * t);
    acc += Math.sqrt(L2);
  }
  return bestS;
}

export function loadScheduleTable(reader: ModelReader, panel: string): Table {
  const results = circuitResults(reader).filter((r) => r.circuit.panel === panel);
  let a = 0;
  let b = 0;
  const rows: Table["rows"][number][] = results.map((r) => {
    const c = r.circuit;
    if (c.phase === "A") a += r.loadVA;
    else if (c.phase === "B") b += r.loadVA;
    else (a += r.loadVA / 2), (b += r.loadVA / 2);
    const cond = c.voltage === 240 ? `2#${c.conductorAwg}+1#${groundFor(c.breakerA)}T` : `2#${c.conductorAwg}+1#${groundFor(c.breakerA)}T`;
    return {
      cells: [
        c.number,
        c.description,
        String(r.devices || ""),
        c.phase === "AB" ? "A-B" : c.phase,
        String(c.voltage),
        f(r.loadVA, 0),
        f(r.currentA, 1),
        `${c.voltage === 240 ? "2P" : "1P"}-${c.breakerA}`,
        cond,
        c.conduit,
        f(r.lengthM, 0),
        f(r.dropPct, 2),
        r.issues.length ? "REVISAR" : "OK",
      ],
      status: r.issues.length ? "revisar" : "ok",
    };
  });
  const total = a + b;
  rows.push({ cells: ["", "TOTAL CARGA INSTALADA", "", "", "", f(total, 0), "", "", "", "", "", "", ""], bold: true });
  rows.push({ cells: ["", `Fase A: ${f(a, 0)} VA · Fase B: ${f(b, 0)} VA · Desbalance ${f(total ? (Math.abs(a - b) / Math.max(a, b)) * 100 : 0, 1)} %`, "", "", "", "", "", "", "", "", "", "", ""] });
  const issues = results.flatMap((r) => r.issues.map((i) => `${r.circuit.number}: ${i}`));
  return {
    title: `CUADRO DE CARGAS · TABLERO ${panel}`,
    columns: ["CTO", "DESCRIPCIÓN", "SAL.", "FASE", "V", "VA", "I (A)", "PROT.", "CONDUCTOR Cu THHN", "TUBO", "L (m)", "ΔV %", "ESTADO"],
    widths: [0.6, 3.6, 0.6, 0.6, 0.6, 0.9, 0.7, 0.9, 1.9, 1.1, 0.6, 0.7, 1],
    rows,
    notes: issues.length ? issues : ["Todos los circuitos cumplen protección (NTC 2050 Art. 240), capacidad del conductor (Tabla 310-16) y ΔV ≤ 3 %."],
  };
}

/** Conductor de tierra de equipos según la protección (NTC 2050 Tabla 250-122, simplificada al calibre de fase). */
/** Conductor de puesta a tierra de equipos según la protección (NTC 2050 Tabla 250-122, Cu). */
function groundFor(breakerA: number): string {
  return breakerA <= 15 ? "14" : breakerA <= 20 ? "12" : breakerA <= 60 ? "10" : breakerA <= 100 ? "8" : breakerA <= 200 ? "6" : "4";
}

export interface DemandResult {
  readonly lines: readonly { label: string; va: number }[];
  readonly demandVA: number;
  readonly currentA: number;
  readonly mainBreakerA: number;
  readonly feeder: string;
}

/**
 * Cálculo de la carga de la acometida, vivienda unifamiliar, método estándar de NTC 2050 Sec. 220:
 * alumbrado general 32 VA/m² + pequeños artefactos y lavandería 1500 VA c/u, primeros 3000 VA al 100 %
 * y el resto al 35 %; artefactos fijos al 75 % si son 4 o más; cargadores EV al 100 % del límite de
 * gestión de carga.
 */
export function serviceDemand(reader: ModelReader): DemandResult {
  const area = projectNumber(reader, "area_construida_m2", 0);
  const results = circuitResults(reader);
  const tipo = (r: CircuitResult) => str(r.circuit.properties?.["tipo"]);
  const general = area * 32;
  const small = results.filter((r) => tipo(r) === "pequenos-artefactos" || tipo(r) === "lavanderia").length * 1500;
  const sub = general + small;
  const generalDemand = Math.min(sub, 3000) + Math.max(sub - 3000, 0) * 0.35;
  const fixed = results.filter((r) => tipo(r) === "fijo");
  const fixedVA = fixed.reduce((t, r) => t + r.loadVA, 0);
  const fixedDemand = fixed.length >= 4 ? fixedVA * 0.75 : fixedVA;
  const ev = results.filter((r) => tipo(r) === "ev");
  const evLimitA = projectNumber(reader, "ev_limite_A", 0);
  const evVA = evLimitA > 0 && ev.length > 0 ? evLimitA * 240 : ev.reduce((t, r) => t + r.loadVA, 0);
  const demandVA = generalDemand + fixedDemand + evVA;
  const currentA = demandVA / 240;
  const mainBreakerA = STANDARD_BREAKERS.find((b) => b >= currentA * 1.1) ?? 200;
  const awg = Object.entries(AMPACITY_75C).find(([, amp]) => amp >= mainBreakerA)?.[0] ?? "2/0";
  return {
    lines: [
      { label: `Alumbrado general ${f(area, 1)} m² × 32 VA/m²`, va: general },
      { label: `Pequeños artefactos y lavandería (${small / 1500} × 1500 VA)`, va: small },
      { label: "Demanda: 3000 VA al 100 % + resto al 35 %", va: generalDemand },
      { label: `Artefactos fijos (${fixed.length}) ${fixed.length >= 4 ? "al 75 %" : "al 100 %"}`, va: fixedDemand },
      { label: evLimitA > 0 ? `Cargadores EV con gestión de carga: límite ${evLimitA} A × 240 V` : "Cargadores EV al 100 %", va: evVA },
    ],
    demandVA,
    currentA,
    mainBreakerA,
    feeder: `2#${awg} + 1#${awg}(N) + 1#${groundFor(mainBreakerA)}(T) Cu THHN/THWN-2`,
  };
}

export function demandTable(reader: ModelReader): Table {
  const d = serviceDemand(reader);
  const rows: Table["rows"][number][] = d.lines.map((l) => ({ cells: [l.label, f(l.va, 0)] }));
  rows.push({ cells: ["DEMANDA MÁXIMA DE DISEÑO", f(d.demandVA, 0)], bold: true });
  rows.push({ cells: [`Corriente a 240 V: ${f(d.currentA, 1)} A → totalizador 2P-${d.mainBreakerA} A`, ""], bold: true });
  rows.push({ cells: [`Acometida: ${d.feeder}`, ""] });
  return { title: "CÁLCULO DE ACOMETIDA (NTC 2050 Sec. 220)", columns: ["CONCEPTO", "VA"], widths: [5, 1.2], rows };
}

// ─── Iluminación ─────────────────────────────────────────────

export function deviceLumens(d: Device): number {
  const p = d.properties ?? {};
  const lm = num(p["lm"], 0);
  const largo = num(p["largo_m"], 0);
  return (d.symbol === "lineal" || d.symbol === "tira") && largo > 0 && p["lm_por_m"] === true ? lm * largo : lm;
}

export function lightingTable(reader: ModelReader, levelId?: Id): Table {
  const spaces = ofKind(reader, "Space", levelId).filter((s) => num(s.properties?.["lux_objetivo"], 0) > 0).sort(byNumber);
  const lights = ofKind(reader, "Device", levelId).filter((d) => d.discipline === "ILU" && deviceLumens(d) > 0);
  const mf = projectNumber(reader, "factor_mantenimiento", 0.8);
  const rows: Table["rows"][number][] = spaces.map((s) => {
    const inside = lights.filter((d) => pointInPolygon(d.position, s.boundary));
    const lm = inside.reduce((t, d) => t + deviceLumens(d), 0);
    const w = inside.reduce((t, d) => t + deviceVA(d), 0);
    const area = polygonArea(s.boundary);
    const cu = num(s.properties?.["cu"], 0.55);
    const e = (lm * cu * mf) / area;
    const target = num(s.properties?.["lux_objetivo"], 0);
    const ok = e >= target * 0.9;
    return {
      cells: [s.number, s.name ?? "", f(area, 1), String(inside.length), f(lm, 0), f(w, 0), f(cu, 2), f(e, 0), f(target, 0), f(w / area, 1), ok ? "OK" : "REVISAR"],
      status: ok ? "ok" : "revisar",
    };
  });
  return {
    title: "CUADRO DE ILUMINACIÓN (método de los lúmenes, RETILAP)",
    columns: ["N.º", "ESPACIO", "ÁREA m²", "LUM.", "FLUJO lm", "W", "CU", "E lx", "OBJ. lx", "W/m²", "ESTADO"],
    widths: [0.6, 2.6, 0.9, 0.6, 1, 0.7, 0.6, 0.7, 0.8, 0.8, 1.1],
    rows,
    notes: [`E = Φ × CU × FM / A, con FM = ${f(mf, 2)}. Se acepta E ≥ 90 % del objetivo. Temperatura de color 3000 K, IRC ≥ 90.`],
  };
}

// ─── Hidráulica ──────────────────────────────────────────────

/** Curva de Hunter para sistemas con tanque de descarga: unidades de consumo → caudal probable (L/s). */
const HUNTER: readonly [number, number][] = [
  [1, 0.1], [3, 0.2], [5, 0.38], [8, 0.49], [10, 0.57], [12, 0.63], [15, 0.71], [20, 0.89], [25, 1.04], [30, 1.18], [35, 1.32], [40, 1.46], [50, 1.7], [60, 1.9], [80, 2.3], [100, 2.65],
];

export function hunterFlow(uc: number): number {
  if (uc <= 0) return 0;
  if (uc <= HUNTER[0]![0]) return HUNTER[0]![1];
  for (let i = 1; i < HUNTER.length; i++) {
    const [u1, q1] = HUNTER[i]!;
    const [u0, q0] = HUNTER[i - 1]!;
    if (uc <= u1) return q0 + ((q1 - q0) * (uc - u0)) / (u1 - u0);
  }
  const [u, q] = HUNTER[HUNTER.length - 1]!;
  return q * Math.sqrt(uc / u);
}

export function waterTable(reader: ModelReader, levelId?: Id): Table {
  const runs = ofKind(reader, "Run", levelId).filter((r) => r.discipline === "HID" && num(r.properties?.["uc"], 0) > 0);
  runs.sort((a, b) => (a.tag ?? "").localeCompare(b.tag ?? "", "es", { numeric: true }));
  const vmax = projectNumber(reader, "velocidad_max_m_s", 2.0);
  const rows: Table["rows"][number][] = runs.map((r) => {
    const uc = num(r.properties?.["uc"], 0);
    const q = num(r.properties?.["q_l_s"], 0) || hunterFlow(uc);
    const di = num(r.properties?.["di_mm"], 16);
    const v = q / 1000 / (Math.PI * (di / 2000) ** 2);
    const ok = v <= vmax;
    return {
      cells: [str(r.properties?.["tramo"], r.tag ?? ""), r.system, f(uc, 1), f(q, 2), str(r.properties?.["diametro"]), f(di, 1), f(v, 2), f(polylineLength(r.points), 1), ok ? "OK" : "REVISAR"],
      status: ok ? "ok" : "revisar",
    };
  });
  const pts = ofKind(reader, "Device", levelId).filter((d) => d.discipline === "HID");
  const ucAF = pts.reduce((t, d) => t + num(d.properties?.["uc_af"], 0), 0);
  const ucAC = pts.reduce((t, d) => t + num(d.properties?.["uc_ac"], 0), 0);
  return {
    title: "CUADRO DE TRAMOS HIDRÁULICOS (NTC 1500, Hunter)",
    columns: ["TRAMO", "SIST.", "UC", "Q L/s", "Ø NOM.", "Ø INT mm", "v m/s", "L m", "ESTADO"],
    widths: [1.6, 0.7, 0.7, 0.8, 1.2, 0.9, 0.8, 0.7, 1.1],
    rows,
    notes: [
      `Unidades de consumo de aparatos: AF ${f(ucAF, 1)} UC, AC ${f(ucAC, 1)} UC. Total ${f(ucAF + ucAC, 1)} UC → Q probable ${f(hunterFlow(ucAF + ucAC), 2)} L/s.`,
      `Velocidad máxima de diseño ${f(vmax, 1)} m/s.`,
    ],
  };
}

// ─── Sanitaria ───────────────────────────────────────────────

/** Unidades de descarga máximas en colectores horizontales con pendiente 2 % (NTC 1500). */
export const MAX_UD_2PCT: Readonly<Record<string, number>> = { "2": 21, "3": 27, "4": 216, "6": 720 };

export function sanitaryTable(reader: ModelReader, levelId?: Id): Table {
  const runs = ofKind(reader, "Run", levelId).filter((r) => r.discipline === "SAN" && r.system === "AN" && num(r.properties?.["ud"], 0) > 0);
  runs.sort((a, b) => (a.tag ?? "").localeCompare(b.tag ?? "", "es", { numeric: true }));
  const rows: Table["rows"][number][] = runs.map((r) => {
    const ud = num(r.properties?.["ud"], 0);
    const d = str(r.properties?.["diametro_pulg"], "4");
    const s = num(r.properties?.["pendiente_pct"], 2);
    const cap = (MAX_UD_2PCT[d] ?? 0) * Math.sqrt(s / 2);
    const wc = num(r.properties?.["sanitarios"], 0);
    const ok = ud <= cap && !(d === "3" && wc > 2) && !(d === "2" && wc > 0) && s >= 1;
    return {
      cells: [str(r.properties?.["tramo"], r.tag ?? ""), `${d}"`, f(s, 1), f(ud, 0), f(cap, 0), f(polylineLength(r.points), 1), ok ? "OK" : "REVISAR"],
      status: ok ? "ok" : "revisar",
    };
  });
  const devs = ofKind(reader, "Device", levelId).filter((d) => d.discipline === "SAN");
  const ud = devs.reduce((t, d) => t + num(d.properties?.["ud"], 0), 0);
  return {
    title: "CUADRO DE COLECTORES SANITARIOS (NTC 1500)",
    columns: ["TRAMO", "Ø", "S %", "UD", "UD MÁX.", "L m", "ESTADO"],
    widths: [2, 0.6, 0.6, 0.6, 0.9, 0.7, 1.1],
    rows,
    notes: [`Total unidades de descarga de aparatos: ${f(ud, 0)} UD. Capacidad a pendientes distintas de 2 % ajustada por √(S/2).`],
  };
}

export function rainTable(reader: ModelReader): Table {
  const i = projectNumber(reader, "lluvia_mm_h", 120);
  const c = projectNumber(reader, "coef_escorrentia", 0.95);
  const runs = ofKind(reader, "Run").filter((r) => r.discipline === "SAN" && r.system === "ALL" && num(r.properties?.["area_m2"], 0) > 0);
  runs.sort((a, b) => (a.tag ?? "").localeCompare(b.tag ?? "", "es", { numeric: true }));
  const rows: Table["rows"][number][] = runs.map((r) => {
    const a = num(r.properties?.["area_m2"], 0);
    const q = (c * i * a) / 3600;
    const cap = num(r.properties?.["capacidad_l_s"], 0);
    const ok = cap === 0 || q <= cap;
    return { cells: [str(r.properties?.["tramo"], r.tag ?? ""), f(a, 1), f(q, 2), str(r.properties?.["diametro"]), cap ? f(cap, 1) : "—", ok ? "OK" : "REVISAR"], status: ok ? "ok" : "revisar" };
  });
  return {
    title: "AGUAS LLUVIAS (método racional Q = C·i·A)",
    columns: ["ELEMENTO", "ÁREA m²", "Q L/s", "SECCIÓN", "CAP. L/s", "ESTADO"],
    widths: [2.2, 0.9, 0.8, 1.2, 0.9, 1],
    rows,
    notes: [`i = ${f(i, 0)} mm/h (aguacero de diseño, Tr = 5 años, zona Las Palmas), C = ${f(c, 2)}.`],
  };
}

// ─── Gas ─────────────────────────────────────────────────────

/** Fórmula de Renouard lineal para baja presión: ΔP (mbar) = 23 200 · s · Le · Q^1.82 · D^-4.82 (Q en m³/h, D en mm; equivale a 232 000 en mm c.a.) */
export function renouardDrop(densRel: number, lengthEqM: number, qM3h: number, dMm: number): number {
  return 23200 * densRel * lengthEqM * Math.pow(qM3h, 1.82) * Math.pow(dMm, -4.82);
}

export function gasTable(reader: ModelReader, levelId?: Id): Table {
  const pci = projectNumber(reader, "gas_pc_kwh_m3", 10.35);
  const s = projectNumber(reader, "gas_densidad_rel", 0.62);
  const dpMax = projectNumber(reader, "gas_dp_max_mbar", 2.0);
  const runs = ofKind(reader, "Run", levelId).filter((r) => r.discipline === "GAS" && num(r.properties?.["kw"], 0) > 0);
  runs.sort((a, b) => (a.tag ?? "").localeCompare(b.tag ?? "", "es", { numeric: true }));
  let critical = 0;
  const rows: Table["rows"][number][] = runs.map((r) => {
    const kw = num(r.properties?.["kw"], 0);
    const q = kw / pci;
    const di = num(r.properties?.["di_mm"], 16);
    const L = polylineLength(r.points) + num(r.properties?.["vertical_m"], 0);
    const le = L * 1.2;
    const dp = renouardDrop(s, le, q, di);
    if (r.properties?.["ruta_critica"] === true) critical += dp;
    return { cells: [str(r.properties?.["tramo"], r.tag ?? ""), f(kw, 1), f(q, 3), str(r.properties?.["diametro"]), f(di, 1), f(L, 1), f(le, 1), f(dp, 3)] };
  });
  const ok = critical <= dpMax;
  rows.push({ cells: ["RUTA CRÍTICA", "", "", "", "", "", "Σ ΔP", f(critical, 3)], bold: true, status: ok ? "ok" : "revisar" });
  const apps = ofKind(reader, "Device", levelId).filter((d) => d.discipline === "GAS" && num(d.properties?.["kw"], 0) > 0);
  const kwTotal = apps.reduce((t, d) => t + num(d.properties?.["kw"], 0), 0);
  return {
    title: "CÁLCULO DE LA RED DE GAS (Renouard, baja presión)",
    columns: ["TRAMO", "kW", "Q m³/h", "Ø NOM.", "Ø INT mm", "L m", "Le m", "ΔP mbar"],
    widths: [1.6, 0.7, 0.8, 1.2, 0.9, 0.6, 0.7, 0.9],
    rows,
    notes: [
      `Potencia instalada ${f(kwTotal, 1)} kW → ${f(kwTotal / pci, 2)} m³/h (PC ${f(pci, 2)} kWh/m³, densidad relativa ${f(s, 2)}). Le = 1.2 L por accesorios.`,
      `Caída máxima admisible ${f(dpMax, 1)} mbar (10 % de 20 mbar). Ruta crítica: ${ok ? "CUMPLE" : "NO CUMPLE"}.`,
    ],
  };
}

// ─── Solar fotovoltaica ──────────────────────────────────────

export interface SolarResult {
  readonly modules: number;
  readonly kWp: number;
  readonly monthlyKWh: number;
  readonly strings: readonly { name: string; modules: number; vocCold: number; vmp: number; isc: number; ok: boolean }[];
}

export function solarResult(reader: ModelReader): SolarResult {
  const panels = ofKind(reader, "Device").filter((d) => d.symbol === "panel");
  const wp = panels.reduce((t, d) => t + num(d.properties?.["wp"], 580), 0);
  const hsp = projectNumber(reader, "solar_hsp", 4.2);
  const pr = projectNumber(reader, "solar_pr", 0.8);
  const voc = projectNumber(reader, "modulo_voc", 51.67);
  const vmp = projectNumber(reader, "modulo_vmp", 42.89);
  const isc = projectNumber(reader, "modulo_isc", 14.27);
  const beta = projectNumber(reader, "modulo_beta_voc_pct", -0.25);
  const tmin = projectNumber(reader, "temp_min_c", 5);
  const vmax = projectNumber(reader, "inversor_vdc_max", 500);
  const mpptMin = projectNumber(reader, "inversor_mppt_min", 125);
  const mpptMax = projectNumber(reader, "inversor_mppt_max", 425);
  const groups = new Map<string, number>();
  for (const p of panels) {
    const s = str(p.properties?.["string"], "S1");
    groups.set(s, (groups.get(s) ?? 0) + 1);
  }
  const k = 1 + (beta / 100) * (tmin - 25);
  const strings = [...groups.entries()].sort().map(([name, n]) => {
    const vocCold = n * voc * k;
    const v = n * vmp;
    return { name, modules: n, vocCold, vmp: v, isc, ok: vocCold <= vmax && v >= mpptMin && v <= mpptMax };
  });
  return { modules: panels.length, kWp: wp / 1000, monthlyKWh: (wp / 1000) * hsp * pr * 30, strings };
}

export function solarTable(reader: ModelReader): Table {
  const r = solarResult(reader);
  const consumo = projectNumber(reader, "consumo_kwh_mes", 0);
  const rows: Table["rows"][number][] = r.strings.map((s) => ({
    cells: [s.name, String(s.modules), f(s.vocCold, 1), f(s.vmp, 1), f(s.isc, 2), s.ok ? "OK" : "REVISAR"],
    status: s.ok ? "ok" : "revisar",
  }));
  rows.push({ cells: ["TOTAL", String(r.modules), `${f(r.kWp, 2)} kWp`, "", "", ""], bold: true });
  const notes = [
    `Producción estimada ${f(r.monthlyKWh, 0)} kWh/mes (HSP ${f(projectNumber(reader, "solar_hsp", 4.2), 1)} h, PR ${f(projectNumber(reader, "solar_pr", 0.8), 2)}).`,
  ];
  if (consumo > 0) notes.push(`Consumo estimado ${f(consumo, 0)} kWh/mes → cobertura ${f((r.monthlyKWh / consumo) * 100, 0)} %.`);
  notes.push(`Voc corregida a ${f(projectNumber(reader, "temp_min_c", 5), 0)} °C; límites del inversor: Vdc máx ${f(projectNumber(reader, "inversor_vdc_max", 500), 0)} V, MPPT ${f(projectNumber(reader, "inversor_mppt_min", 125), 0)}–${f(projectNumber(reader, "inversor_mppt_max", 425), 0)} V.`);
  return { title: "SISTEMA FOTOVOLTAICO: CADENAS (STRINGS)", columns: ["CADENA", "MÓD.", "Voc frío V", "Vmp V", "Isc A", "ESTADO"], widths: [1, 0.7, 1.1, 0.9, 0.8, 1], rows, notes };
}

// ─── Leyenda automática ──────────────────────────────────────

/** Símbolos y sistemas presentes en el nivel para una disciplina (para la tabla de convenciones). */
export function usedSymbols(reader: ModelReader, levelId: Id, disciplines: readonly string[]): { symbols: string[]; systems: string[] } {
  const symbols = new Set<string>();
  const systems = new Set<string>();
  for (const id of reader.indices.elementsOfLevel(levelId)) {
    const e = reader.getEntity(id);
    if (e?.kind === "Device" && disciplines.includes(e.discipline)) symbols.add(e.symbol);
    if (e?.kind === "Run" && disciplines.includes(e.discipline)) systems.add(e.system);
  }
  return { symbols: [...symbols], systems: [...systems] };
}

export { getOfKind };
