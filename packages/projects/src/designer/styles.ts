// Estilos arquitectónicos de vivienda de alto valor en Colombia.
// Cada estilo fija el lenguaje de las fachadas (materiales, colores, celosías, aleros, proporción de
// vanos), la cubierta sugerida y algunos acabados interiores. El usuario puede cambiar cualquier cosa
// después en el modelo.

import type { RoofType } from "./program";
import type { Finish, RoomType } from "./finishes";

export type StyleKey = "tropical" | "minimalista" | "neocolonial" | "brutalista" | "montana" | "playa";
/** Material de acento de fachada: se dibuja con su textura en las fachadas. */
export type Accent = "madera" | "celosia" | "concreto" | "ladrillo" | "piedra" | "estuco";

export interface StyleDef {
  readonly key: StyleKey;
  readonly name: string;
  readonly summary: string;
  readonly places: string;
  readonly roof: RoofType;
  readonly pendiente: number;
  /** Alero de la cubierta (m). */
  readonly alero: number;
  readonly wall: Accent;
  readonly wallColor: string;
  readonly accent: Accent;
  readonly accentColor: string;
  readonly base: Accent;
  readonly roofColor: string;
  /** Teja de barro, lámina o losa (cambia el dibujo de la cubierta en fachada). */
  readonly roofMaterial: "teja" | "lamina" | "losa" | "paja-sintetica";
  readonly frameColor: string;
  /** Ventanas de piso a techo en zonas sociales y habitaciones principales. */
  readonly floorToCeiling: boolean;
  /** Corredor perimetral cubierto (galería) frente a la zona social. */
  readonly corredor: boolean;
  readonly celosias: boolean;
  readonly facadeSpec: string;
  readonly roofSpec: string;
  readonly windowSpec: string;
  readonly doorSpec: string;
  readonly finishes?: Partial<Record<RoomType, Partial<Finish>>>;
}

export const STYLES: Readonly<Record<StyleKey, StyleDef>> = {
  tropical: {
    key: "tropical",
    name: "Contemporáneo tropical",
    summary: "Volúmenes limpios, aleros profundos, celosías en madera y mucha relación interior-exterior.",
    places: "Llanogrande, Rionegro, Anapoima",
    roof: "cuatro-aguas",
    pendiente: 25,
    alero: 1.5,
    wall: "estuco",
    wallColor: "#ece6da",
    accent: "celosia",
    accentColor: "#9a6a43",
    base: "piedra",
    roofColor: "#3f4447",
    roofMaterial: "lamina",
    frameColor: "#2b2f33",
    floorToCeiling: true,
    corredor: true,
    celosias: true,
    facadeSpec: "Muros en mampostería con estuco y pintura elastomérica color arena; celosías verticales en madera teca inmunizada; zócalo en piedra muñeca.",
    roofSpec: "Cubierta a cuatro aguas en panel termoacústico tipo sándwich sobre estructura metálica, aleros de 1.50 m con cielo en madera.",
    windowSpec: "Ventanería en aluminio arquitectónico negro mate, piso a techo en zonas sociales, vidrio laminado 6+6 mm con control solar.",
    doorSpec: "Puerta principal pivotante en madera maciza de teca, 1.20 × 2.60 m.",
  },
  minimalista: {
    key: "minimalista",
    name: "Minimalista / moderno",
    summary: "Concreto a la vista, vidrio de piso a techo, plantas abiertas y una paleta reducida.",
    places: "Bogotá, Medellín, Cali",
    roof: "plana",
    pendiente: 1.5,
    alero: 0,
    wall: "estuco",
    wallColor: "#f2f1ee",
    accent: "concreto",
    accentColor: "#a9a8a3",
    base: "concreto",
    roofColor: "#8d8f91",
    roofMaterial: "losa",
    frameColor: "#1f2225",
    floorToCeiling: true,
    corredor: false,
    celosias: false,
    facadeSpec: "Muros blancos con estuco liso; volúmenes en concreto a la vista con formaleta de tablero fenólico y tratamiento hidrófugo.",
    roofSpec: "Cubierta plana en losa de concreto con impermeabilización en manto asfáltico APP 4 mm, pendiente 1.5 % a sifones y antepecho perimetral.",
    windowSpec: "Ventanería con perfilería de mínima sección negra, piso a techo, vidrio laminado templado 8+8 mm low-e.",
    doorSpec: "Puerta principal pivotante en lámina de acero y roble, 1.40 × 2.80 m, con tirador vertical integrado.",
    finishes: { social: { enchape: "Muro de TV en concreto a la vista con sellante mate" } },
  },
  neocolonial: {
    key: "neocolonial",
    name: "Neocolonial / hacienda reinterpretada",
    summary: "Patios, corredores con columnas en madera, teja de barro y madera con un lenguaje actual.",
    places: "Valle de Rionegro, Villa de Leyva, Sabana de Bogotá",
    roof: "dos-aguas",
    pendiente: 45,
    alero: 1.0,
    wall: "estuco",
    wallColor: "#f6f3ec",
    accent: "madera",
    accentColor: "#6b4428",
    base: "piedra",
    roofColor: "#b5562f",
    roofMaterial: "teja",
    frameColor: "#4a2f1d",
    floorToCeiling: false,
    corredor: true,
    celosias: false,
    facadeSpec: "Muros encalados (pintura a la cal) blancos; zócalo en piedra; columnas, canecillos y carpintería en madera de cedro.",
    roofSpec: "Cubierta a dos aguas en teja de barro española sobre manto impermeable y entablado en madera, aleros de 1.00 m con canecillos.",
    windowSpec: "Ventanas en madera de cedro con postigos y vidrio laminado 5+5 mm; rejas en hierro forjado en primer piso.",
    doorSpec: "Portón principal en madera maciza de cedro, doble hoja, 1.60 × 2.60 m, con herrajes en hierro forjado.",
    finishes: { social: { corto: "Baldosa de barro", piso: "Baldosa de barro cocido 40×40 cm sellada con cera, con cenefa en piedra" }, circulacion: { corto: "Baldosa de barro", piso: "Baldosa de barro cocido 40×40 cm" } },
  },
  brutalista: {
    key: "brutalista",
    name: "Brutalismo cálido",
    summary: "Concreto y ladrillo a la vista, en la línea de Rogelio Salmona.",
    places: "Bogotá, Chía, Cajicá",
    roof: "una-agua",
    pendiente: 12,
    alero: 0.6,
    wall: "ladrillo",
    wallColor: "#a9573a",
    accent: "concreto",
    accentColor: "#9c9a94",
    base: "ladrillo",
    roofColor: "#6c6f71",
    roofMaterial: "losa",
    frameColor: "#2a2420",
    floorToCeiling: false,
    corredor: false,
    celosias: true,
    facadeSpec: "Ladrillo prensado a la vista color terracota en aparejo de soga con juntas rehundidas; vigas y dinteles en concreto a la vista; celosías en ladrillo calado.",
    roofSpec: "Cubierta a una agua en losa aligerada de concreto con impermeabilización y acabado en grava; antepechos en ladrillo.",
    windowSpec: "Ventanas en aluminio color bronce, vanos verticales profundos con alféizar en concreto.",
    doorSpec: "Puerta principal en madera de roble y bronce, 1.20 × 2.60 m.",
    finishes: { social: { enchape: "Muro en ladrillo a la vista con sellante mate" }, escalera: { enchape: "Baranda en ladrillo calado y pasamanos en roble" } },
  },
  montana: {
    key: "montana",
    name: "Casa de montaña o de campo",
    summary: "Piedra, madera y techos inclinados, pensada para clima frío.",
    places: "Sopó, La Calera, Oriente antioqueño",
    roof: "dos-aguas",
    pendiente: 50,
    alero: 0.9,
    wall: "piedra",
    wallColor: "#8a8478",
    accent: "madera",
    accentColor: "#7b5532",
    base: "piedra",
    roofColor: "#3a3d40",
    roofMaterial: "lamina",
    frameColor: "#2a2420",
    floorToCeiling: true,
    corredor: false,
    celosias: false,
    facadeSpec: "Primer piso en piedra laja a la vista; segundo piso y frontones en revestimiento de madera de pino tratado (tablilla horizontal); chimenea en piedra.",
    roofSpec: "Cubierta a dos aguas de pendiente alta en lámina termoacústica color grafito sobre estructura en madera laminada, con aislamiento térmico 75 mm.",
    windowSpec: "Ventanas en PVC color madera con doble vidrio (DVH 6/12/6) para clima frío.",
    doorSpec: "Puerta principal en madera maciza de roble con vidrio lateral, 1.10 × 2.40 m.",
    finishes: { social: { enchape: "Chimenea a leña/gas con revestimiento en piedra laja hasta el cielo" }, principal: { cielo: "Cielo en madera machihembrada siguiendo la pendiente de la cubierta" } },
  },
  playa: {
    key: "playa",
    name: "Casa de playa caribeña",
    summary: "Ventilación cruzada, cubiertas livianas y terrazas sombreadas.",
    places: "Cartagena, Barú, Santa Marta",
    roof: "cuatro-aguas",
    pendiente: 35,
    alero: 1.8,
    wall: "estuco",
    wallColor: "#fbfaf6",
    accent: "celosia",
    accentColor: "#b88a5c",
    base: "estuco",
    roofColor: "#9b8a6c",
    roofMaterial: "paja-sintetica",
    frameColor: "#e9e5dc",
    floorToCeiling: true,
    corredor: true,
    celosias: true,
    facadeSpec: "Muros blancos con estuco y pintura elastomérica; celosías y persianas en madera de teca para ventilación cruzada; piedra coralina en zócalos.",
    roofSpec: "Cubierta a cuatro aguas liviana en paja sintética (o teja termoacústica) sobre estructura en madera inmunizada, aleros de 1.80 m.",
    windowSpec: "Puertas-ventana corredizas en aluminio blanco anticorrosión (marino) con persianas exteriores de madera.",
    doorSpec: "Puerta principal en madera de teca con persiana de ventilación, 1.20 × 2.60 m.",
    finishes: { social: { corto: "Piedra coralina", piso: "Piedra coralina o porcelanato exterior-interior 60×120 antideslizante, continuo hasta la terraza" } },
  },
};

export const STYLE_KEYS = Object.keys(STYLES) as StyleKey[];
