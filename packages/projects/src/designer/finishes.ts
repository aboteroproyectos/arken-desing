// Catálogo de acabados por tipo de espacio y nivel (alto, lujo, premium).
// Cada espacio del modelo guarda sus acabados en propiedades editables:
//   piso (texto corto que se ve en la planta), acabado_piso, acabado_guardaescoba, acabado_muros,
//   acabado_enchape, acabado_cielo, altura_cielo_m.
// El cuadro de acabados y el plano de acabados se generan desde esas propiedades.

import type { FinishLevel } from "./program";

export type RoomType =
  | "social"
  | "cocina"
  | "bano"
  | "bano-social"
  | "alcoba"
  | "principal"
  | "vestier"
  | "estudio"
  | "ropas"
  | "tecnico"
  | "circulacion"
  | "escalera"
  | "servicio"
  | "terraza"
  | "parqueadero";

export interface Finish {
  readonly corto: string;
  readonly piso: string;
  readonly guardaescoba: string;
  readonly muros: string;
  readonly enchape: string;
  readonly cielo: string;
}

type Table = Record<RoomType, Finish>;

const PINTURA = "Estuco plástico y pintura tipo 1 lavable mate, 3 manos, color blanco hueso";
const CIELO_DW = "Cielo falso en drywall con dilatación perimetral (buña), estuco y pintura blanca mate";

const LUJO: Table = {
  social: { corto: "Porcelanato 120×60", piso: "Porcelanato rectificado 120×60 cm mate, tono arena, junta 2 mm", guardaescoba: "Guardaescoba en el mismo porcelanato h = 8 cm, al ras con buña", muros: PINTURA, enchape: "Muro de TV en listón de madera de roble natural sobre bastidor", cielo: CIELO_DW + " con cortinero y luz indirecta" },
  cocina: { corto: "Porcelanato 120×60", piso: "Porcelanato rectificado 120×60 cm mate antideslizante R10", guardaescoba: "Zócalo de mueble en aluminio h = 10 cm", muros: "Pintura epóxica lavable blanca", enchape: "Salpicadero en cuarzo de la misma encimera h = 60 cm", cielo: CIELO_DW },
  bano: { corto: "Porcelanato 60×120", piso: "Porcelanato 60×120 cm; ducha antideslizante R11 con pendiente 2 % a rejilla lineal", guardaescoba: "Enchape a piso", muros: "Pintura antihongos tipo 1 sobre placa RH (fuera de zonas húmedas)", enchape: "Porcelanato 60×120 cm en ducha piso-techo y muro de lavamanos h = 1.20 m", cielo: "Cielo en drywall RH con pintura antihongos" },
  "bano-social": { corto: "Porcelanato 60×120", piso: "Porcelanato 60×120 cm mate", guardaescoba: "Enchape a piso", muros: "Papel de colgadura vinílico lavable o pintura antihongos", enchape: "Muro de lavamanos en piedra natural h = 1.20 m", cielo: "Cielo en drywall RH con pintura antihongos" },
  alcoba: { corto: "Madera de roble", piso: "Piso de ingeniería en roble 190 × 1 900 mm, capa noble 3 mm, barniz mate", guardaescoba: "Guardaescoba en MDF lacado blanco h = 10 cm", muros: PINTURA, enchape: "—", cielo: CIELO_DW },
  principal: { corto: "Madera de roble", piso: "Piso de ingeniería en roble 220 × 2 200 mm, capa noble 4 mm, aceite natural", guardaescoba: "Guardaescoba en MDF lacado blanco h = 12 cm", muros: PINTURA, enchape: "Cabecero tapizado y panel de roble detrás de la cama", cielo: CIELO_DW + " con luz indirecta perimetral" },
  vestier: { corto: "Madera de roble", piso: "Piso de ingeniería en roble (continuo con la habitación)", guardaescoba: "Guardaescoba en MDF lacado blanco h = 10 cm", muros: PINTURA, enchape: "—", cielo: CIELO_DW },
  estudio: { corto: "Madera de roble", piso: "Piso de ingeniería en roble 190 × 1 900 mm", guardaescoba: "Guardaescoba en MDF lacado blanco h = 10 cm", muros: PINTURA, enchape: "Biblioteca en roble a muro completo", cielo: CIELO_DW },
  ropas: { corto: "Porcelanato 60×60", piso: "Porcelanato 60×60 cm antideslizante R10", guardaescoba: "Porcelanato h = 10 cm", muros: "Pintura epóxica lavable", enchape: "Porcelanato h = 1.20 m en muro de lavadero", cielo: "Cielo en drywall RH con pintura antihongos" },
  tecnico: { corto: "Porcelanato 60×60", piso: "Porcelanato 60×60 cm antideslizante", guardaescoba: "Porcelanato h = 10 cm", muros: "Pintura tipo 1 lavable", enchape: "—", cielo: "Placa a la vista pintada (registro de redes)" },
  circulacion: { corto: "Porcelanato 120×60", piso: "Porcelanato rectificado 120×60 cm mate (continuo con zona social)", guardaescoba: "Guardaescoba en el mismo porcelanato h = 8 cm", muros: PINTURA, enchape: "—", cielo: CIELO_DW + " con luz lineal empotrada" },
  escalera: { corto: "Huella en roble", piso: "Huellas en madera maciza de roble e = 40 mm sobre estructura metálica; contrahuellas lacadas", guardaescoba: "Zócalo inclinado en MDF lacado", muros: PINTURA, enchape: "Baranda en vidrio templado laminado 8+8 mm con pasamanos en acero inoxidable", cielo: CIELO_DW },
  servicio: { corto: "Porcelanato 60×60", piso: "Porcelanato 60×60 cm", guardaescoba: "Porcelanato h = 10 cm", muros: "Pintura tipo 1 lavable", enchape: "—", cielo: CIELO_DW },
  terraza: { corto: "Deck en teca", piso: "Deck en madera teca inmunizada sobre durmientes, o porcelanato exterior 60×120 R11", guardaescoba: "—", muros: "Fachada (ver plano de fachadas)", enchape: "Mesón de BBQ en cuarzo exterior", cielo: "Cielo en madera teca con tratamiento exterior" },
  parqueadero: { corto: "Adoquín", piso: "Adoquín de concreto sobre base granular compactada", guardaescoba: "—", muros: "—", enchape: "—", cielo: "Estructura metálica a la vista pintada" },
};

const upgrade = (t: Table, f: (k: RoomType, x: Finish) => Partial<Finish>): Table =>
  Object.fromEntries(Object.entries(t).map(([k, x]) => [k, { ...x, ...f(k as RoomType, x) }])) as Table;

const PREMIUM = upgrade(LUJO, (k) => {
  if (k === "social" || k === "circulacion") return { corto: "Mármol 120×120", piso: "Mármol travertino o porcelanato gran formato 120×120 cm pulido mate, instalado con nivelador", guardaescoba: "Guardaescoba oculto al ras con perfil de aluminio" };
  if (k === "cocina") return { corto: "Mármol 120×120", piso: "Porcelanato gran formato 120×120 cm efecto mármol, antideslizante R10", enchape: "Salpicadero y muro en lámina sinterizada (piedra ultracompacta) 12 mm a la altura de la alacena" };
  if (k === "bano" || k === "bano-social") return { corto: "Mármol", piso: "Mármol o lámina ultracompacta 120×260 cm; ducha con rejilla lineal oculta", enchape: "Lámina ultracompacta piso-techo en ducha y muro de lavamanos con nicho iluminado" };
  if (k === "principal" || k === "alcoba" || k === "vestier" || k === "estudio") return { corto: "Roble espiga", piso: "Piso de ingeniería en roble europeo en espiga (chevron), capa noble 4 mm, aceite natural" };
  return {};
});

const ALTO = upgrade(LUJO, (k) => {
  if (k === "social" || k === "circulacion" || k === "cocina") return { corto: "Porcelanato 60×60", piso: "Porcelanato rectificado 60×60 cm mate" };
  if (k === "alcoba" || k === "principal" || k === "vestier" || k === "estudio") return { corto: "Laminado roble", piso: "Piso laminado AC5 12 mm efecto roble sobre manto acústico" };
  if (k === "bano" || k === "bano-social") return { corto: "Porcelanato 60×60", piso: "Porcelanato 60×60 cm; ducha antideslizante R11", enchape: "Cerámica rectificada 30×60 cm en ducha h = 2.40 m" };
  return {};
});

export const FINISHES: Readonly<Record<FinishLevel, Table>> = { alto: ALTO, lujo: LUJO, premium: PREMIUM };

/** Iluminancia de diseño (RETILAP) por tipo de espacio. */
export const LUX: Readonly<Record<RoomType, number>> = {
  social: 200, cocina: 300, bano: 200, "bano-social": 200, alcoba: 150, principal: 150, vestier: 300, estudio: 300, ropas: 200, tecnico: 300, circulacion: 100, escalera: 150, servicio: 150, terraza: 0, parqueadero: 0,
};

export function finishProps(level: FinishLevel, type: RoomType, ceiling: number): Record<string, string | number> {
  const f = FINISHES[level][type];
  return {
    piso: f.corto,
    acabado_piso: f.piso,
    acabado_guardaescoba: f.guardaescoba,
    acabado_muros: f.muros,
    acabado_enchape: f.enchape,
    acabado_cielo: f.cielo,
    altura_cielo_m: ceiling,
  };
}
