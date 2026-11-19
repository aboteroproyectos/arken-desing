// Programa arquitectónico de una vivienda: lo que el usuario pide, en datos.
//
// El asistente de diseño trabaja SIN inteligencia artificial: lee la descripción escrita con reglas
// propias (palabras clave del español de Colombia), pregunta lo que falta y entrega un programa
// completo al motor de diseño.

import { STYLES, type StyleKey } from "./styles";

export type RoofType = "plana" | "una-agua" | "dos-aguas" | "cuatro-aguas";
export type SizeLevel = "compacta" | "estandar" | "amplia";
export type FinishLevel = "alto" | "lujo" | "premium";

export interface HouseProgram {
  readonly proyecto: string;
  readonly propietario: string;
  readonly localizacion: string;
  readonly empresa: string;
  readonly estilo: StyleKey;
  readonly pisos: number;
  readonly habitaciones: number;
  /** Baños completos y medios baños deseados (0 = los que pida el diseño). */
  readonly banos: number;
  readonly banoSocial: boolean;
  readonly estudio: boolean;
  readonly estar: boolean;
  readonly cocina: "abierta" | "cerrada";
  readonly isla: boolean;
  readonly parqueaderos: number;
  readonly cargadorEV: boolean;
  readonly terraza: boolean;
  readonly cubierta: RoofType;
  /** Pendiente de la cubierta inclinada (%). */
  readonly pendiente: number;
  readonly tamano: SizeLevel;
  readonly acabados: FinishLevel;
  /** Área construida total buscada (m²); 0 = la que resulte del programa. */
  readonly areaObjetivo: number;
  /** Lote: frente × fondo (m); 0 = sin lote definido. */
  readonly loteFrente: number;
  readonly loteFondo: number;
  readonly habitacionPrimerPiso: boolean;
  readonly servicio: boolean;
}

export type ProgramDraft = Partial<HouseProgram>;

export function defaultProgram(): HouseProgram {
  return {
    proyecto: "CASA NUEVA",
    propietario: "Por definir",
    localizacion: "",
    empresa: "ARKEN 360",
    estilo: "tropical",
    pisos: 1,
    habitaciones: 3,
    banos: 0,
    banoSocial: true,
    estudio: false,
    estar: false,
    cocina: "abierta",
    isla: true,
    parqueaderos: 2,
    cargadorEV: true,
    terraza: true,
    cubierta: "dos-aguas",
    pendiente: 30,
    tamano: "amplia",
    acabados: "lujo",
    areaObjetivo: 0,
    loteFrente: 0,
    loteFondo: 0,
    habitacionPrimerPiso: false,
    servicio: false,
  };
}

export function completeProgram(d: ProgramDraft): HouseProgram {
  const st = STYLES[d.estilo ?? defaultProgram().estilo];
  const p = { ...defaultProgram(), cubierta: st.roof, pendiente: st.pendiente, ...d };
  if (d.cubierta && d.pendiente === undefined) p.pendiente = d.cubierta === "plana" ? 1.5 : d.cubierta === st.roof ? st.pendiente : 30;
  return {
    ...p,
    pisos: clampInt(p.pisos, 1, 6),
    habitaciones: clampInt(p.habitaciones, 1, 10),
    banos: clampInt(p.banos, 0, 14),
    parqueaderos: clampInt(p.parqueaderos, 0, 6),
    pendiente: Math.min(100, Math.max(p.cubierta === "plana" ? 1 : 5, p.pendiente)),
    areaObjetivo: Math.max(0, p.areaObjetivo),
  };
}

const clampInt = (n: number, a: number, b: number) => Math.min(b, Math.max(a, Math.round(Number.isFinite(n) ? n : a)));

export const ROOF_NAMES: Readonly<Record<RoofType, string>> = {
  plana: "plana (losa con antepecho)",
  "una-agua": "a una agua",
  "dos-aguas": "a dos aguas",
  "cuatro-aguas": "a cuatro aguas",
};

// ─── Lectura de la descripción escrita ───────────────────────

const WORDS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doble: 2, triple: 3,
};
const NUM = "(\\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)";
const toNum = (s: string) => (/^\d+$/.test(s) ? Number(s) : WORDS[s] ?? NaN);
const decimal = (s: string) => Number(s.replace(",", "."));

/** Minúsculas y sin tildes, para comparar con las reglas. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/m²/g, "m2")
    .replace(/\s+/g, " ");
}

export interface ParseResult {
  readonly draft: ProgramDraft;
  /** Lo que se entendió, en frases cortas para mostrarle al usuario. */
  readonly understood: readonly string[];
}

/** Lee una descripción libre ("casa de dos pisos con 4 habitaciones, estudio y techo a dos aguas"). */
export function parseDescription(text: string): ParseResult {
  const t = " " + normalize(text) + " ";
  const d: { -readonly [K in keyof HouseProgram]?: HouseProgram[K] } = {};
  const said: string[] = [];
  const count = (nouns: string) => {
    const m = t.match(new RegExp(`${NUM}\\s+(?:\\w+\\s+)?(?:${nouns})\\b`));
    return m ? toNum(m[1]!) : undefined;
  };
  const neg = (nouns: string) => new RegExp(`\\b(sin|no (?:quiero|necesito|lleva|tiene)|ningun[oa]?)\\s+(?:\\w+\\s+)?(?:${nouns})`).test(t);
  const has = (nouns: string) => new RegExp(`\\b(?:${nouns})`).test(t);

  // Pisos
  let pisos = count("pisos?|niveles?|plantas?");
  if (pisos === undefined && /\b(duplex|dos plantas)\b/.test(t)) pisos = 2;
  if (pisos === undefined && /\b(una sola planta|un solo piso|un solo nivel|de un piso|de una planta)\b/.test(t)) pisos = 1;
  if (pisos !== undefined && pisos >= 1) (d.pisos = pisos), said.push(`${pisos} ${pisos === 1 ? "piso" : "pisos"}`);

  // Habitaciones
  const hab = count("habitaciones?|alcobas?|cuartos?|dormitorios?|recamaras?|habitacion");
  if (hab !== undefined && hab >= 1) (d.habitaciones = hab), said.push(`${hab} ${hab === 1 ? "habitación" : "habitaciones"}`);

  // Baños
  const banos = count("banos?(?! social)|banos completos");
  if (banos !== undefined && banos >= 1) (d.banos = banos), said.push(`${banos} ${banos === 1 ? "baño" : "baños"}`);
  if (neg("bano social|medio bano|bano de visitas")) (d.banoSocial = false), said.push("sin baño social");
  else if (has("bano social|medio bano|bano de visitas")) (d.banoSocial = true), said.push("baño social");

  // Zonas
  if (neg("estudio|oficina|biblioteca")) (d.estudio = false), said.push("sin estudio");
  else if (has("estudio|oficina|biblioteca|home office")) (d.estudio = true), said.push("estudio");
  if (neg("estar|sala de tv|sala de television|family")) d.estar = false;
  else if (has("estar|sala de tv|sala de television|family|salon familiar|cuarto de tv")) (d.estar = true), said.push("estar de TV / familiar");
  if (has("cocina cerrada|cocina independiente")) (d.cocina = "cerrada"), said.push("cocina cerrada");
  else if (has("cocina abierta|cocina integrada|concepto abierto")) (d.cocina = "abierta"), said.push("cocina abierta");
  if (neg("isla")) d.isla = false;
  else if (has("isla")) (d.isla = true), said.push("isla en la cocina");
  if (neg("terraza|bbq|patio")) (d.terraza = false), said.push("sin terraza");
  else if (/\b(terraza|bbq|asador|patio)\b/.test(t) && !/terraza (plana|transitable)|cubierta (plana|en terraza)/.test(t)) (d.terraza = true), said.push("terraza");
  if (has("cuarto de servicio|alcoba de servicio|habitacion de servicio|servicio domestico")) (d.servicio = true), said.push("alcoba de servicio con baño");
  if (has("huespedes|habitacion en el primer piso|alcoba en el primer piso|habitacion abajo")) (d.habitacionPrimerPiso = true), said.push("habitación de huéspedes en el primer piso");

  // Parqueaderos
  if (neg("garajes?|parqueaderos?|carros?|vehiculos?|carport")) (d.parqueaderos = 0), said.push("sin parqueadero");
  else {
    let cars = count("parqueaderos?|garajes?|carros?|vehiculos?|puestos?|autos?|coches?|cupos?");
    if (cars === undefined && /garaje doble|parqueadero doble/.test(t)) cars = 2;
    if (cars === undefined && /\b(garaje|parqueadero|carport|cochera)\b/.test(t)) cars = 1;
    if (cars !== undefined) (d.parqueaderos = cars), said.push(`${cars} ${cars === 1 ? "parqueadero" : "parqueaderos"}`);
  }
  if (has("cargador|carro electrico|vehiculo electrico|ev\\b")) (d.cargadorEV = true), said.push("cargador para vehículo eléctrico");

  // Estilo arquitectónico
  const styleRules: [RegExp, StyleKey][] = [
    [/tropical|contemporane/, "tropical"],
    [/minimalista|moderna?\b|concreto a la vista/, "minimalista"],
    [/colonial|hacienda|patio central|teja de barro/, "neocolonial"],
    [/brutalis|ladrillo|salmona/, "brutalista"],
    [/montana|de campo|campestre|clima frio|chimenea|cabana/, "montana"],
    [/playa|caribe|costa|mar\b|cartagena|baru|santa marta/, "playa"],
  ];
  const st = styleRules.find(([re]) => re.test(t));
  if (st) {
    d.estilo = st[1];
    said.push(`estilo ${STYLES[st[1]].name.toLowerCase()}`);
  }

  // Cubierta
  if (/(cuatro|4) aguas/.test(t)) d.cubierta = "cuatro-aguas";
  else if (/(dos|2) aguas/.test(t)) d.cubierta = "dos-aguas";
  else if (/(una|un|1) (sola )?agua/.test(t)) d.cubierta = "una-agua";
  else if (/(techo|cubierta) (plan[oa]|en losa)|losa de cubierta|terraza transitable|cubierta en terraza|placa de cubierta/.test(t)) d.cubierta = "plana";
  if (d.cubierta) said.push(`cubierta ${ROOF_NAMES[d.cubierta]}`);
  const slope = t.match(/pendiente (?:de |del )?(\d+(?:[.,]\d+)?)\s*%/);
  if (slope) (d.pendiente = decimal(slope[1]!)), said.push(`pendiente ${slope[1]} %`);

  // Tamaño y acabados
  if (/\b(compacta|pequena|economica|sencilla)\b/.test(t)) (d.tamano = "compacta"), said.push("espacios compactos");
  else if (/\b(amplia|grande|espaciosa|amplios|generosa)\b/.test(t)) (d.tamano = "amplia"), said.push("espacios amplios");
  if (/\b(premium|ultra ?lujo|alta gama)\b/.test(t)) (d.acabados = "premium"), said.push("acabados premium");
  else if (/\b(lujo|lujosa|exclusiva)\b/.test(t)) (d.acabados = "lujo"), said.push("acabados de lujo");

  // Área y lote
  const area = t.match(/(\d+(?:[.,]\d+)?)\s*(?:m2|mts2|mt2|metros cuadrados|metros2)/);
  const lote = t.match(/lote (?:de |del )?(\d+(?:[.,]\d+)?)\s*(?:m|mts|metros)?\s*(?:x|por)\s*(\d+(?:[.,]\d+)?)/);
  if (lote) {
    d.loteFrente = decimal(lote[1]!);
    d.loteFondo = decimal(lote[2]!);
    said.push(`lote de ${lote[1]} × ${lote[2]} m`);
  }
  if (area && !(lote && t.indexOf(area[0]) > t.indexOf("lote") && /lote de \d+ ?m2/.test(t))) {
    d.areaObjetivo = decimal(area[1]!);
    said.push(`unos ${area[1]} m² construidos`);
  }

  // Nombre del proyecto y propietario
  const name = text.match(/(?:llamad[ao]|proyecto)\s+["“]?([^,."”\n]{3,60})/i);
  if (name) d.proyecto = name[1]!.trim().toUpperCase();
  const owner = text.match(/(?:para|propietario:?|cliente:?)\s+(?:el señor |la señora |el sr\. |la sra\. )?([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+){0,3})/);
  if (owner) d.propietario = owner[1]!.trim();
  return { draft: d, understood: said };
}

// ─── Preguntas guiadas ───────────────────────────────────────

export interface QuestionOption {
  readonly label: string;
  readonly patch: ProgramDraft;
}
export interface Question {
  readonly key: keyof HouseProgram;
  readonly text: string;
  readonly help?: string;
  readonly options: readonly QuestionOption[];
  /** Respuesta escrita: número, texto o lote ("20 x 30"). */
  readonly input?: "number" | "text" | "lote";
  readonly when?: (d: ProgramDraft) => boolean;
}

const nums = (key: keyof HouseProgram, values: number[], unit: (n: number) => string): QuestionOption[] => values.map((n) => ({ label: unit(n), patch: { [key]: n } as ProgramDraft }));

export const QUESTIONS: readonly Question[] = [
  {
    key: "estilo",
    text: "¿Qué estilo de arquitectura quiere para la casa y sus fachadas?",
    help: "El estilo define el techo, los aleros, los materiales y colores de las fachadas, las ventanas y los acabados.",
    options: (Object.values(STYLES)).map((s) => ({ label: s.name, patch: { estilo: s.key } })),
  },
  { key: "pisos", text: "¿Cuántos pisos tendrá la casa?", options: nums("pisos", [1, 2, 3, 4], (n) => `${n} ${n === 1 ? "piso" : "pisos"}`), input: "number" },
  { key: "habitaciones", text: "¿Cuántas habitaciones, contando la principal?", options: nums("habitaciones", [2, 3, 4, 5, 6], (n) => `${n}`), input: "number" },
  {
    key: "banos",
    text: "¿Cuántos baños quiere? (o deje que el diseño los defina)",
    help: "Por norma de diseño ARKEN, la habitación principal lleva baño propio y cada dos habitaciones comparten uno.",
    options: [{ label: "Los que pida el diseño", patch: { banos: 0 } }, ...nums("banos", [2, 3, 4, 5], (n) => `${n} baños`)],
    input: "number",
  },
  {
    key: "cubierta",
    text: "¿Qué tipo de techo prefiere?",
    help: "Cada estilo sugiere uno; puede cambiarlo.",
    options: [
      { label: "A dos aguas", patch: { cubierta: "dos-aguas", pendiente: 30 } },
      { label: "A cuatro aguas", patch: { cubierta: "cuatro-aguas", pendiente: 30 } },
      { label: "A una agua", patch: { cubierta: "una-agua", pendiente: 15 } },
      { label: "Plana (losa)", patch: { cubierta: "plana", pendiente: 1.5 } },
    ],
  },
  { key: "parqueaderos", text: "¿Para cuántos vehículos es el parqueadero cubierto?", options: nums("parqueaderos", [0, 1, 2, 3], (n) => (n === 0 ? "Sin parqueadero" : `${n} ${n === 1 ? "vehículo" : "vehículos"}`)), input: "number" },
  { key: "cargadorEV", text: "¿Deja cargador para vehículo eléctrico en cada puesto?", options: [{ label: "Sí", patch: { cargadorEV: true } }, { label: "No", patch: { cargadorEV: false } }], when: (d) => (d.parqueaderos ?? 2) > 0 },
  {
    key: "cocina",
    text: "¿Cómo quiere la cocina?",
    options: [
      { label: "Abierta con isla", patch: { cocina: "abierta", isla: true } },
      { label: "Abierta sin isla", patch: { cocina: "abierta", isla: false } },
      { label: "Cerrada", patch: { cocina: "cerrada", isla: false } },
    ],
  },
  { key: "estudio", text: "¿Incluye estudio u oficina en casa?", options: [{ label: "Sí", patch: { estudio: true } }, { label: "No", patch: { estudio: false } }] },
  { key: "estar", text: "¿Incluye un estar de TV o salón familiar?", options: [{ label: "Sí", patch: { estar: true } }, { label: "No", patch: { estar: false } }] },
  { key: "terraza", text: "¿Lleva terraza cubierta con BBQ junto a la sala?", options: [{ label: "Sí", patch: { terraza: true } }, { label: "No", patch: { terraza: false } }] },
  { key: "banoSocial", text: "¿Lleva baño social para visitas en el primer piso?", options: [{ label: "Sí", patch: { banoSocial: true } }, { label: "No", patch: { banoSocial: false } }], when: (d) => (d.pisos ?? 1) === 1 },
  { key: "habitacionPrimerPiso", text: "¿Quiere una habitación de huéspedes en el primer piso?", options: [{ label: "Sí", patch: { habitacionPrimerPiso: true } }, { label: "No", patch: { habitacionPrimerPiso: false } }], when: (d) => (d.pisos ?? 1) > 1 },
  { key: "servicio", text: "¿Incluye alcoba de servicio con baño?", options: [{ label: "Sí", patch: { servicio: true } }, { label: "No", patch: { servicio: false } }] },
  {
    key: "tamano",
    text: "¿Qué tan amplios quiere los espacios?",
    options: [
      { label: "Amplios (lujo)", patch: { tamano: "amplia" } },
      { label: "Estándar", patch: { tamano: "estandar" } },
      { label: "Compactos", patch: { tamano: "compacta" } },
    ],
  },
  {
    key: "acabados",
    text: "¿Qué nivel de acabados?",
    help: "Define pisos, enchapes, pinturas, cielos y carpintería de cada espacio. Después puede cambiar cualquiera.",
    options: [
      { label: "Lujo", patch: { acabados: "lujo" } },
      { label: "Premium", patch: { acabados: "premium" } },
      { label: "Alto", patch: { acabados: "alto" } },
    ],
  },
  { key: "areaObjetivo", text: "¿Tiene un área construida en mente? (m², total de todos los pisos)", options: [{ label: "La que resulte del programa", patch: { areaObjetivo: 0 } }, ...nums("areaObjetivo", [150, 250, 350, 500], (n) => `${n} m²`)], input: "number" },
  { key: "loteFrente", text: "¿Cuánto mide el lote? (frente × fondo, en metros)", options: [{ label: "Aún no lo sé", patch: { loteFrente: 0, loteFondo: 0 } }], input: "lote" },
  { key: "proyecto", text: "¿Cómo se llama el proyecto?", options: [], input: "text" },
  { key: "propietario", text: "¿Quién es el propietario?", options: [{ label: "Por definir", patch: { propietario: "Por definir" } }], input: "text" },
  { key: "localizacion", text: "¿Dónde queda? (dirección, municipio y departamento)", options: [{ label: "Por definir", patch: { localizacion: "Por definir" } }], input: "text" },
];

/** Siguiente pregunta sin responder, o undefined si el programa está completo. */
export function nextQuestion(d: ProgramDraft): Question | undefined {
  return QUESTIONS.find((q) => d[q.key] === undefined && (!q.when || q.when(d)));
}

/** Aplica una respuesta escrita a una pregunta. Devuelve undefined si no se entiende. */
export function answerText(q: Question, text: string): ProgramDraft | undefined {
  const t = normalize(text).trim();
  if (!t) return undefined;
  const opt = q.options.find((o) => normalize(o.label) === t);
  if (opt) return opt.patch;
  if (q.input === "text") return { [q.key]: text.trim() } as ProgramDraft;
  if (q.input === "lote") {
    const m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:m|mts|metros)?\s*(?:x|por|×)\s*(\d+(?:[.,]\d+)?)/);
    return m ? { loteFrente: decimal(m[1]!), loteFondo: decimal(m[2]!) } : undefined;
  }
  if (q.input === "number") {
    const m = t.match(/(\d+(?:[.,]\d+)?)/) ?? t.match(new RegExp(NUM));
    if (!m) return undefined;
    const n = /\d/.test(m[1]!) ? decimal(m[1]!) : toNum(m[1]!);
    return Number.isFinite(n) ? ({ [q.key]: n } as ProgramDraft) : undefined;
  }
  // Pregunta de opciones: se intenta leer como descripción libre.
  const p = parseDescription(text).draft;
  return p[q.key] !== undefined ? p : /^(si|claro|por supuesto|ok)\b/.test(t) && q.options[0] ? q.options[0].patch : /^no\b/.test(t) && q.options[1] ? q.options[1].patch : undefined;
}

/** Resumen del programa en frases. */
export function describeProgram(p: HouseProgram): string[] {
  const out = [
    `Estilo ${STYLES[p.estilo].name.toLowerCase()}`,
    `${p.pisos} ${p.pisos === 1 ? "piso" : "pisos"}, ${p.habitaciones} habitaciones${p.banos ? `, ${p.banos} baños` : ""}`,
    `Cubierta ${ROOF_NAMES[p.cubierta]}${p.cubierta === "plana" ? "" : `, pendiente ${p.pendiente} %`}`,
    `Cocina ${p.cocina}${p.isla ? " con isla" : ""}${p.estudio ? " · estudio" : ""}${p.estar ? " · estar de TV" : ""}${p.terraza ? " · terraza con BBQ" : ""}`,
    p.parqueaderos ? `Parqueadero cubierto para ${p.parqueaderos} ${p.parqueaderos === 1 ? "vehículo" : "vehículos"}${p.cargadorEV ? " con cargador EV" : ""}` : "Sin parqueadero",
    `Espacios ${p.tamano === "amplia" ? "amplios" : p.tamano === "compacta" ? "compactos" : "estándar"} · acabados ${p.acabados}`,
  ];
  if (p.areaObjetivo) out.push(`Área construida buscada: ${p.areaObjetivo} m²`);
  if (p.loteFrente && p.loteFondo) out.push(`Lote de ${p.loteFrente} × ${p.loteFondo} m`);
  return out;
}
