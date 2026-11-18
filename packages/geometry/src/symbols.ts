// Catálogo de símbolos de planta (Paso 7).
//
// Cada símbolo se dibuja en un sistema local: origen en la posición del dispositivo, eje x girado
// según su `rotation`. Los símbolos de red se miden en mm de PAPEL (se ven igual a cualquier escala);
// el mobiliario y los equipos grandes se miden en METROS del modelo (tamaño real).

import type { Discipline, PropertyValue, Vec2 } from "@arken/core";
import type { Paint, PlanPrimitive } from "./plan";

export interface SymbolContext {
  readonly position: Vec2;
  readonly rotation: number;
  /** Metros del modelo por mm de papel (escala/1000). */
  readonly mm: number;
  readonly style: string;
  readonly props: Readonly<Record<string, PropertyValue>>;
  readonly tag?: string;
}

/** Constructor de primitivas en coordenadas locales del símbolo. */
export class SymbolBuilder {
  readonly out: PlanPrimitive[] = [];
  private readonly c: number;
  private readonly s: number;

  constructor(
    private readonly ctx: SymbolContext,
    /** Metros del modelo por unidad local: ctx.mm para símbolos en papel, 1 para tamaño real. */
    readonly unit: number,
  ) {
    this.c = Math.cos(ctx.rotation);
    this.s = Math.sin(ctx.rotation);
  }

  p(x: number, y: number): Vec2 {
    const u = this.unit;
    return { x: this.ctx.position.x + (x * this.c - y * this.s) * u, y: this.ctx.position.y + (x * this.s + y * this.c) * u };
  }

  line(pts: readonly [number, number][], paint: Paint = {}): this {
    this.out.push({ kind: "polyline", points: pts.map(([x, y]) => this.p(x, y)), style: this.ctx.style, ...paint });
    return this;
  }

  poly(pts: readonly [number, number][], paint: Paint = {}): this {
    this.out.push({ kind: "polygon", points: pts.map(([x, y]) => this.p(x, y)), style: this.ctx.style, ...paint });
    return this;
  }

  rect(x: number, y: number, w: number, h: number, paint: Paint = {}): this {
    return this.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], paint);
  }

  /** Rectángulo centrado en (cx, cy). */
  box(cx: number, cy: number, w: number, h: number, paint: Paint = {}): this {
    return this.rect(cx - w / 2, cy - h / 2, w, h, paint);
  }

  circle(cx: number, cy: number, r: number, paint: Paint = {}): this {
    const n = 28;
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) pts.push([cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);
    return this.poly(pts, paint);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, paint: Paint = {}): this {
    const n = 28;
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) pts.push([cx + rx * Math.cos((2 * Math.PI * i) / n), cy + ry * Math.sin((2 * Math.PI * i) / n)]);
    return this.poly(pts, paint);
  }

  /** Arco de a0 a a1 (radianes, antihorario) como polilínea. */
  arc(cx: number, cy: number, r: number, a0: number, a1: number, paint: Paint = {}): this {
    const n = 16;
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return this.line(pts, paint);
  }

  /** Texto; `size` en mm de papel siempre (aunque el símbolo sea de tamaño real). */
  text(t: string, x: number, y: number, size = 1.8, align: "left" | "center" | "right" = "center", bold = false, upright = true): this {
    // Los textos se mantienen legibles: si el símbolo está girado más de 90°, no se ponen cabeza abajo.
    let rot = upright ? 0 : this.ctx.rotation;
    if (!upright && Math.cos(rot) < -1e-9) rot += Math.PI;
    this.out.push({ kind: "text", at: this.p(x, y), text: t, height: size * this.ctx.mm, align, rotation: rot, bold, style: this.ctx.style });
    return this;
  }
}

export interface SymbolDef {
  readonly key: string;
  readonly discipline: Discipline;
  /** Descripción para la tabla de convenciones. */
  readonly name: string;
  /** true: el símbolo se dibuja a tamaño real (metros); false: en mm de papel. */
  readonly realSize?: boolean;
  draw(b: SymbolBuilder, ctx: SymbolContext): void;
}

const num = (v: PropertyValue | undefined, d: number) => (typeof v === "number" ? v : d);
const str = (v: PropertyValue | undefined, d = "") => (typeof v === "string" ? v : d);
const F: Paint = { fill: "solid" };
const W: Paint = { fill: "white" };
const thin: Paint = { weight: 0.18 };

/** Toma: círculo con dos trazos paralelos (convención colombiana de tomacorriente doble). */
function toma(b: SymbolBuilder, label?: string) {
  b.circle(0, 0, 1.6, W).line([[-0.55, -0.9], [-0.55, 0.9]]).line([[0.55, -0.9], [0.55, 0.9]]);
  if (label) b.text(label, 2.1, 1.4, 1.4, "left");
}

/** Caja rectangular con rótulo dentro: equipos y dispositivos especiales. */
function labeled(b: SymbolBuilder, label: string, w = 3.6, h = 2.4, fill: Paint = W) {
  b.box(0, 0, w, h, fill).text(label, 0, 0, Math.min(1.5, h * 0.62), "center", true);
}

function circled(b: SymbolBuilder, label: string, r = 1.7) {
  b.circle(0, 0, r, W).text(label, 0, 0, Math.min(1.4, r * 0.9), "center", true);
}

function bowtie(b: SymbolBuilder, w = 1.6, h = 1.2, fill: Paint = W) {
  b.poly([[-w, -h], [w, h], [w, -h], [-w, h]], fill);
}

const LIST: SymbolDef[] = [
  // ─── Eléctrica ───
  { key: "toma", discipline: "ELE", name: "Tomacorriente doble 15 A 120 V con polo a tierra, h = 0.30 m salvo indicación", draw: (b) => toma(b) },
  { key: "toma-gfci", discipline: "ELE", name: "Tomacorriente doble con protección diferencial GFCI 20 A", draw: (b) => toma(b, "GFCI") },
  { key: "toma-ip", discipline: "ELE", name: "Tomacorriente exterior GFCI con tapa IP66", draw: (b) => toma(b, "IP66") },
  { key: "toma-especial", discipline: "ELE", name: "Salida especial 120 V para equipo (circuito dedicado)", draw: (b) => { toma(b); b.poly([[-1.6, 0], [0, 1.6], [0, 0]], F); } },
  { key: "toma-240", discipline: "ELE", name: "Salida especial 240 V (dos fases + tierra)", draw: (b) => { b.circle(0, 0, 1.6, W).poly([[0, -1.6], [0, 1.6], [1.6, 0]], F); b.text("240V", 2.1, 1.4, 1.4, "left"); } },
  { key: "ev", discipline: "ELE", name: "Cargador vehículo eléctrico nivel 2 (7.7 kW, 240 V, 32 A), mural h = 1.20 m", draw: (b) => labeled(b, "EV", 4, 2.8) },
  { key: "tablero", discipline: "ELE", name: "Tablero de distribución (TG general / TR respaldo)", draw: (b, c) => { b.rect(-3, -1.2, 6, 2.4, W).poly([[-3, -1.2], [3, -1.2], [-3, 1.2]], F); if (c.tag) b.text(c.tag, 0, 2.6, 2, "center", true); } },
  { key: "medidor", discipline: "ELE", name: "Medidor de energía bidireccional (AGPE, CREG 174 de 2021)", draw: (b) => circled(b, "kWh", 2.2) },
  { key: "spt", discipline: "ELE", name: "Puesta a tierra: varilla Cu 5/8\" × 2.40 m con caja de inspección", draw: (b) => b.line([[0, 2], [0, 0]]).line([[-1.8, 0], [1.8, 0]]).line([[-1.2, -0.6], [1.2, -0.6]]).line([[-0.6, -1.2], [0.6, -1.2]]) },
  { key: "salida-motor", discipline: "ELE", name: "Salida para motor / equipo de bombeo", draw: (b) => circled(b, "M") },

  // ─── Iluminación ───
  { key: "downlight", discipline: "ILU", name: "Downlight LED empotrado antideslumbrante", draw: (b) => b.circle(0, 0, 1.5, W).line([[-1.06, -1.06], [1.06, 1.06]]).line([[-1.06, 1.06], [1.06, -1.06]]) },
  { key: "downlight-ip", discipline: "ILU", name: "Downlight LED empotrado IP44/IP65 (baños y exterior)", draw: (b) => b.circle(0, 0, 1.5, W).line([[-1.06, -1.06], [1.06, 1.06]]).line([[-1.06, 1.06], [1.06, -1.06]]).circle(0, 0, 0.5, F) },
  { key: "colgante", discipline: "ILU", name: "Lámpara colgante decorativa", draw: (b) => b.circle(0, 0, 2.3, W).circle(0, 0, 0.9, F) },
  { key: "aplique", discipline: "ILU", name: "Aplique de muro (exterior IP65)", draw: (b) => { b.poly([[-1.6, 0], [1.6, 0], [1.13, 1.13], [0, 1.6], [-1.13, 1.13]], F); } },
  { key: "aplique-espejo", discipline: "ILU", name: "Luminaria lineal de espejo (baño)", draw: (b) => b.box(0, 0.6, 5, 1.2, F) },
  { key: "baliza", discipline: "ILU", name: "Baliza de jardín LED IP65", draw: (b) => b.circle(0, 0, 1.2, W).circle(0, 0, 0.5, F) },
  {
    key: "lineal",
    discipline: "ILU",
    name: "Perfil lineal LED empotrado (longitud indicada)",
    realSize: true,
    draw: (b, c) => {
      const L = num(c.props["largo_m"], 1.2);
      const t = 1.1 * c.mm;
      b.rect(-L / 2, -t, L, 2 * t, W).line([[-L / 2, 0], [L / 2, 0]]);
    },
  },
  {
    key: "tira",
    discipline: "ILU",
    name: "Tira LED en cielo / repisa (longitud indicada)",
    realSize: true,
    draw: (b, c) => {
      const L = num(c.props["largo_m"], 1);
      b.line([[-L / 2, 0], [L / 2, 0]], { weight: 0.5, dash: [1.5, 0.8] });
    },
  },
  { key: "extractor", discipline: "ILU", name: "Extractor de baño con ducto a cubierta", draw: (b) => { b.circle(0, 0, 1.7, W); b.arc(0, 0, 1, 0, Math.PI, thin).arc(0, 0, 1, Math.PI, 2 * Math.PI, thin); b.text("EX", 0, -2.6, 1.3); } },

  // ─── Domótica y comunicaciones ───
  { key: "pulsador", discipline: "DOM", name: "Pulsador / teclado KNX multifunción (escenas), h = 1.20 m", draw: (b) => labeled(b, "K", 2.4, 2.4) },
  { key: "sensor-presencia", discipline: "DOM", name: "Sensor de presencia / movimiento KNX en techo", draw: (b) => { b.circle(0, 0, 1.6, W).arc(0, 0, 0.9, 0.3, Math.PI - 0.3, thin).arc(0, 0, 0.9, Math.PI + 0.3, 2 * Math.PI - 0.3, thin).circle(0, 0, 0.3, F); } },
  { key: "cortina", discipline: "DOM", name: "Motor de cortina / persiana enrollable (KNX)", draw: (b) => labeled(b, "M", 3, 1.8) },
  { key: "camara", discipline: "DOM", name: "Cámara IP PoE (CCTV)", draw: (b) => { b.poly([[-1.8, -0.9], [1, -0.9], [1, 0.9], [-1.8, 0.9]], W).poly([[1, -0.5], [2.2, -1], [2.2, 1], [1, 0.5]], F); } },
  { key: "ap-wifi", discipline: "DOM", name: "Punto de acceso WiFi PoE en techo", draw: (b) => circled(b, "AP", 1.8) },
  { key: "datos", discipline: "DOM", name: "Salida de datos RJ45 Cat 6A", draw: (b) => b.poly([[-1.4, -1], [1.4, -1], [0, 1.4]], F) },
  { key: "tv", discipline: "DOM", name: "Salida de TV / HDMI + datos, h = 1.50 m", draw: (b) => labeled(b, "TV", 3, 1.8) },
  { key: "videoportero", discipline: "DOM", name: "Videoportero IP (frente exterior / monitor interior)", draw: (b) => labeled(b, "VP", 3, 2) },
  { key: "cerradura", discipline: "DOM", name: "Cerradura inteligente / electroimán", draw: (b) => labeled(b, "CI", 3, 2) },
  { key: "humo", discipline: "DOM", name: "Detector de humo fotoeléctrico", draw: (b) => circled(b, "DH") },
  { key: "fuga-agua", discipline: "DOM", name: "Sensor de inundación (fuga de agua) a nivel de piso", draw: (b) => circled(b, "FA") },
  { key: "detector-gas", discipline: "DOM", name: "Detector de gas con salida a electroválvula", draw: (b) => circled(b, "DG") },
  { key: "valvula-motorizada", discipline: "DOM", name: "Electroválvula de corte (agua o gas) comandada por domótica", draw: (b) => { bowtie(b, 1.4, 1, W); b.text("EV", 0, 2, 1.3); } },
  { key: "termostato", discipline: "DOM", name: "Sensor de temperatura y humedad / termostato KNX", draw: (b) => labeled(b, "T°", 2.4, 2.4) },
  { key: "magnetico", discipline: "DOM", name: "Contacto magnético de apertura (puerta exterior)", draw: (b) => labeled(b, "SM", 2.6, 1.6) },
  { key: "rack", discipline: "DOM", name: "Rack de comunicaciones: router, switch PoE, controlador KNX IP, NVR, UPS", draw: (b) => { b.box(0, 0, 5, 3, W).line([[-2.5, -1.5], [2.5, 1.5]], thin).line([[-2.5, 1.5], [2.5, -1.5]], thin); b.text("RACK", 0, 2.4, 1.6, "center", true); } },

  // ─── Hidráulica ───
  { key: "punto-af", discipline: "HID", name: "Salida de agua fría (AF)", draw: (b) => b.circle(0, 0, 1, { fill: "solid", color: "#1c6dd0" }) },
  { key: "punto-ac", discipline: "HID", name: "Salida de agua caliente (AC)", draw: (b) => b.circle(0, 0, 1, { fill: "solid", color: "#d0342c" }) },
  { key: "punto-afac", discipline: "HID", name: "Salida de agua fría y caliente (mezclador)", draw: (b) => b.circle(-0.8, 0, 0.9, { fill: "solid", color: "#1c6dd0" }).circle(0.8, 0, 0.9, { fill: "solid", color: "#d0342c" }) },
  { key: "medidor-agua", discipline: "HID", name: "Medidor de agua con registro de corte y cheque", draw: (b) => labeled(b, "MA", 3.4, 2.2) },
  { key: "valvula", discipline: "HID", name: "Válvula de bola (registro de corte)", draw: (b) => bowtie(b, 1.2, 0.9, F) },
  { key: "bomba", discipline: "HID", name: "Equipo de presión: bomba 1 HP + tanque hidroacumulador 80 L", draw: (b) => { b.circle(0, 0, 2, W).poly([[-1.2, -1.3], [1.6, 0], [-1.2, 1.3]], F); } },
  { key: "bomba-recirculacion", discipline: "HID", name: "Bomba de recirculación de agua caliente con temporizador", draw: (b) => { b.circle(0, 0, 1.5, W).poly([[-0.8, -0.9], [1.1, 0], [-0.8, 0.9]], F); b.text("BR", 0, -2.4, 1.3); } },
  {
    key: "tanque",
    discipline: "HID",
    name: "Tanque de almacenamiento (capacidad indicada)",
    realSize: true,
    draw: (b, c) => {
      const d = num(c.props["diametro_m"], 1.4);
      b.circle(0, 0, d / 2, W).circle(0, 0, d / 2 - 0.05);
      b.text(str(c.props["rotulo"], "TANQUE"), 0, 0, 1.6, "center", true);
    },
  },
  { key: "calentador", discipline: "HID", name: "Calentador de paso a gas, tiro forzado, 20 L/min", draw: (b) => labeled(b, "CAL", 4, 2.6) },
  { key: "llave-jardin", discipline: "HID", name: "Llave de jardín / manguera 1/2\" con antisifón", draw: (b) => { b.circle(0, 0, 1, { fill: "solid", color: "#1c6dd0" }); b.text("LL", 1.6, 1.2, 1.3, "left"); } },
  { key: "filtro", discipline: "HID", name: "Filtro de sedimentos y carbón activado", draw: (b) => labeled(b, "F", 2.2, 2.2) },

  // ─── Sanitaria y aguas lluvias ───
  { key: "sifon", discipline: "SAN", name: "Sifón / desagüe de aparato", draw: (b) => b.circle(0, 0, 1.3, W).line([[-1.3, 0], [1.3, 0]]).line([[0, -1.3], [0, 1.3]]) },
  { key: "rejilla", discipline: "SAN", name: "Rejilla de piso con sifón 3\" (ducha, ropas)", draw: (b) => b.box(0, 0, 2.2, 2.2, W).line([[-1.1, -1.1], [1.1, 1.1]]).line([[-1.1, 1.1], [1.1, -1.1]]) },
  { key: "salida-sanitario", discipline: "SAN", name: "Salida de sanitario Ø 4\"", draw: (b) => b.circle(0, 0, 1.8, W).circle(0, 0, 0.9, F) },
  { key: "ventilacion", discipline: "SAN", name: "Tubo de ventilación Ø 2\" a cubierta", draw: (b) => circled(b, "V", 1.4) },
  { key: "bajante", discipline: "SAN", name: "Bajante de aguas lluvias Ø 4\"", draw: (b) => b.circle(0, 0, 1.7, W).circle(0, 0, 1.1).text("ALL", 2.1, 1.3, 1.3, "left") },
  {
    key: "caja",
    discipline: "SAN",
    name: "Caja de inspección en concreto con tapa (dimensión indicada)",
    realSize: true,
    draw: (b, c) => {
      const l = num(c.props["lado_m"], 0.6);
      b.box(0, 0, l, l, W).box(0, 0, l - 0.08, l - 0.08);
      b.line([[-l / 2, -l / 2], [l / 2, l / 2]], thin);
      if (c.tag) b.text(c.tag, l / 2 + 0.08, l / 2 + 0.12, 1.8, "left", true);
    },
  },
  { key: "trampa-grasas", discipline: "SAN", name: "Trampa de grasas prefabricada 60 L con tapa hermética", realSize: true, draw: (b) => { b.box(0, 0, 0.7, 0.5, W).box(0, 0, 0.62, 0.42); b.text("T.GR.", 0, 0, 1.4, "center", true); } },
  {
    key: "septico",
    discipline: "SAN",
    name: "Sistema séptico integrado (tanque séptico + FAFA) prefabricado",
    realSize: true,
    draw: (b, c) => {
      const w = num(c.props["largo_m"], 2.6);
      const h = num(c.props["ancho_m"], 1.4);
      b.box(0, 0, w, h, W).line([[-w / 6, -h / 2], [-w / 6, h / 2]]).line([[w / 4, -h / 2], [w / 4, h / 2]]);
      b.text(str(c.props["rotulo"], "STAR"), 0, 0, 1.8, "center", true);
    },
  },

  // ─── Gas ───
  { key: "punto-gas", discipline: "GAS", name: "Salida de gas con válvula de corte rápido de 1/4 de vuelta", draw: (b) => { b.poly([[-1.3, -1], [1.3, -1], [0, 1.3]], { fill: "solid", color: "#c77700" }); } },
  { key: "medidor-gas", discipline: "GAS", name: "Centro de medición: válvula, regulador 2.ª etapa y medidor G6", draw: (b) => labeled(b, "MG", 3.6, 2.4) },
  { key: "valvula-gas", discipline: "GAS", name: "Válvula de corte general de gas", draw: (b) => bowtie(b, 1.2, 0.9, { fill: "solid", color: "#c77700" }) },
  { key: "artefacto-gas", discipline: "GAS", name: "Artefacto a gas (potencia indicada)", draw: (b, c) => labeled(b, c.tag ?? "GAS", 4, 2.2) },
  { key: "rejilla-ventilacion", discipline: "GAS", name: "Rejilla de ventilación permanente (NTC 3631)", draw: (b) => { b.box(0, 0, 3, 1.4, W); for (let i = -1; i <= 1; i++) b.line([[i * 0.8 - 0.4, -0.7], [i * 0.8 + 0.4, 0.7]], thin); } },

  // ─── Solar fotovoltaica ───
  {
    key: "panel",
    discipline: "SOL",
    name: "Módulo fotovoltaico bifacial 580 Wp (2.278 × 1.134 m)",
    realSize: true,
    draw: (b, c) => {
      const w = num(c.props["largo_m"], 2.278);
      const h = num(c.props["ancho_m"], 1.134);
      b.box(0, 0, w, h, { fill: "tint" }).line([[-w / 2, 0], [w / 2, 0]], thin).line([[0, -h / 2], [0, h / 2]], thin);
      if (c.tag) b.text(c.tag, 0, h / 4, 1.5);
    },
  },
  { key: "inversor", discipline: "SOL", name: "Inversor híbrido 8 kW 120/240 V con 2 MPPT", draw: (b) => labeled(b, "INV", 4.4, 2.6) },
  { key: "bateria", discipline: "SOL", name: "Banco de baterías LiFePO4 48 V (2 × 5.12 kWh)", draw: (b) => { labeled(b, "BAT", 4.4, 2.4); b.text("+  −", 0, -2.1, 1.3); } },
  { key: "combinadora", discipline: "SOL", name: "Caja combinadora DC: fusibles 20 A, DPS DC 600 V, seccionador", draw: (b) => labeled(b, "CC-DC", 4.6, 2.2) },

  // ─── Mobiliario y aparatos (tamaño real) ───
  {
    key: "wc",
    discipline: "ARQ",
    name: "Sanitario",
    realSize: true,
    draw: (b) => {
      b.rect(-0.22, 0, 0.44, 0.18, W).ellipse(0, 0.47, 0.19, 0.27, W);
    },
  },
  {
    key: "lavamanos",
    discipline: "ARQ",
    name: "Lavamanos sobre mueble",
    realSize: true,
    draw: (b, c) => {
      const w = num(c.props["ancho_m"], 0.6);
      b.rect(-w / 2, 0, w, 0.5, W);
      const n = Math.max(1, Math.round(num(c.props["pocetas"], 1)));
      for (let i = 0; i < n; i++) {
        const cx = -w / 2 + (w * (i + 0.5)) / n;
        b.circle(cx, 0.27, 0.17).circle(cx, 0.27, 0.025, F);
      }
    },
  },
  {
    key: "ducha",
    discipline: "ARQ",
    name: "Ducha con piso en pendiente y división en vidrio templado",
    realSize: true,
    draw: (b, c) => {
      const w = num(c.props["ancho_m"], 1.2);
      const d = num(c.props["fondo_m"], 0.9);
      b.rect(-w / 2, 0, w, d).line([[-w / 2, 0], [w / 2, d]], thin).line([[-w / 2, d], [w / 2, 0]], thin).circle(0, d / 2, 0.06, W);
    },
  },
  {
    key: "cama",
    discipline: "ARQ",
    name: "Cama",
    realSize: true,
    draw: (b, c) => {
      const w = num(c.props["ancho_m"], 1.6);
      const l = num(c.props["largo_m"], 2.0);
      b.rect(-w / 2, 0, w, l, W);
      b.rect(-w / 2 + 0.08, 0.06, w / 2 - 0.12, 0.32).rect(0.04, 0.06, w / 2 - 0.12, 0.32);
      b.line([[-w / 2, 0.75], [w / 2, 0.75]], thin);
      if (num(c.props["mesas"], 1) > 0) b.rect(-w / 2 - 0.5, 0, 0.45, 0.4).rect(w / 2 + 0.05, 0, 0.45, 0.4);
    },
  },
  {
    key: "sofa",
    discipline: "ARQ",
    name: "Sofá",
    realSize: true,
    draw: (b, c) => {
      const w = num(c.props["ancho_m"], 2.4);
      const d = num(c.props["fondo_m"], 0.9);
      b.rect(-w / 2, 0, w, d, W).rect(-w / 2, 0, w, 0.22).rect(-w / 2, 0, 0.22, d).rect(w / 2 - 0.22, 0, 0.22, d);
    },
  },
  {
    key: "mesa",
    discipline: "ARQ",
    name: "Mesa con sillas",
    realSize: true,
    draw: (b, c) => {
      const w = num(c.props["ancho_m"], 2.2);
      const d = num(c.props["fondo_m"], 1.0);
      const n = Math.max(1, Math.round(num(c.props["sillas_lado"], 3)));
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + (w * (i + 0.5)) / n;
        b.box(x, d / 2 + 0.3, 0.45, 0.42, W).box(x, -d / 2 - 0.3, 0.45, 0.42, W);
      }
      b.box(0, 0, w, d, W);
    },
  },
  {
    key: "mueble",
    discipline: "ARQ",
    name: "Mueble / mesón / clóset (dimensión indicada)",
    realSize: true,
    draw: (b, c) => {
      const w = num(c.props["ancho_m"], 1.2);
      const d = num(c.props["fondo_m"], 0.6);
      b.rect(-w / 2, 0, w, d, W);
      const t = str(c.props["tipo"]);
      if (t === "closet") b.line([[-w / 2, d / 2], [w / 2, d / 2]], { weight: 0.18, dash: [1, 0.6] });
      if (t === "alto") b.line([[-w / 2, 0], [w / 2, d]], thin).line([[-w / 2, d], [w / 2, 0]], thin);
      const label = str(c.props["rotulo"]);
      if (label) b.text(label, 0, d / 2, 1.5, "center", false, false);
    },
  },
  {
    key: "estufa",
    discipline: "ARQ",
    name: "Cubierta de cocción a gas 5 puestos",
    realSize: true,
    draw: (b) => {
      b.rect(-0.45, 0, 0.9, 0.52, W);
      for (const [x, y, r] of [[-0.28, 0.14, 0.07], [0.28, 0.14, 0.07], [-0.28, 0.38, 0.07], [0.28, 0.38, 0.07], [0, 0.26, 0.1]] as const) b.circle(x, y, r);
    },
  },
  {
    key: "lavaplatos",
    discipline: "ARQ",
    name: "Lavaplatos en acero inoxidable",
    realSize: true,
    draw: (b, c) => {
      const w = num(c.props["ancho_m"], 0.9);
      b.rect(-w / 2, 0.05, w, 0.48).rect(-w / 2 + 0.04, 0.09, w / 2 - 0.06, 0.4).rect(0.02, 0.09, w / 2 - 0.06, 0.4).circle(w / 4, 0.29, 0.025, F);
    },
  },
  {
    key: "electrodomestico",
    discipline: "ARQ",
    name: "Electrodoméstico (rótulo indicado)",
    realSize: true,
    draw: (b, c) => {
      const w = num(c.props["ancho_m"], 0.6);
      const d = num(c.props["fondo_m"], 0.6);
      b.rect(-w / 2, 0, w, d, W);
      if (str(c.props["tipo"]) === "redondo") b.circle(0, d / 2, Math.min(w, d) * 0.35);
      b.text(str(c.props["rotulo"], ""), 0, d / 2, 1.5, "center", true);
    },
  },
  {
    key: "carro",
    discipline: "ARQ",
    name: "Vehículo (referencia 4.70 × 1.90 m)",
    realSize: true,
    draw: (b) => {
      b.rect(-2.35, -0.95, 4.7, 1.9).rect(-0.9, -0.82, 1.9, 1.64, thin).line([[1.0, -0.82], [1.55, -0.7], [1.55, 0.7], [1.0, 0.82]], thin);
    },
  },
];

export const SYMBOLS: ReadonlyMap<string, SymbolDef> = new Map(LIST.map((s) => [s.key, s]));

/** Primitivas de un símbolo colocadas en el modelo. Símbolo desconocido = círculo con "?". */
export function drawSymbol(key: string, ctx: SymbolContext): PlanPrimitive[] {
  const def = SYMBOLS.get(key);
  const b = new SymbolBuilder(ctx, def?.realSize ? 1 : ctx.mm);
  if (def) def.draw(b, ctx);
  else circled(b, "?");
  return b.out;
}
