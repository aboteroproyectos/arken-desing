// Modelo de datos BIM base (Paso 1).
// Solo datos planos: sin métodos, sin referencias circulares, serializables a JSON.

// ─── Básicos ───────────────────────────────────────────────
export type Id = string; // UUID estable, nunca se reutiliza
export type Meters = number; // unidad interna única: metros
export interface Vec2 {
  readonly x: Meters;
  readonly y: Meters;
}

export type PropertyValue = string | number | boolean;

// ─── Base común de todas las entidades ─────────────────────
interface EntityBase {
  readonly id: Id;
  readonly name?: string;
  readonly properties?: Readonly<Record<string, PropertyValue>>;
}

// ─── Estructura espacial ───────────────────────────────────
export interface Project extends EntityBase {
  readonly kind: "Project";
  readonly lengthUnit: "m";
  /** Campos comunes del rótulo (empresa, cliente, dirección, diseñador...). Editables. */
  readonly titleBlock?: Readonly<Record<string, string>>;
}
export interface Building extends EntityBase {
  readonly kind: "Building";
}
export interface Level extends EntityBase {
  readonly kind: "Level";
  readonly elevation: Meters; // cota respecto al proyecto
  readonly height: Meters; // altura por defecto para muros nuevos
}

// ─── Materiales ────────────────────────────────────────────
export interface Material extends EntityBase {
  readonly kind: "Material";
  readonly density?: number; // kg/m³
  readonly thermalConductivity?: number; // W/(m·K)
  readonly displayColor?: string; // "#c8b9a6"
}
export interface MaterialLayer {
  readonly materialId: Id;
  readonly thickness: Meters;
}
export interface MaterialLayerSet extends EntityBase {
  readonly kind: "MaterialLayerSet";
  readonly layers: readonly MaterialLayer[]; // de cara exterior a interior
}

// ─── Elementos constructivos ───────────────────────────────
export type WallJustification = "center" | "exterior" | "interior";

export interface Wall extends EntityBase {
  readonly kind: "Wall";
  readonly typeId?: Id;
  readonly start: Vec2; // eje, en coordenadas del nivel
  readonly end: Vec2;
  readonly justification: WallJustification;
  readonly height: Meters;
  readonly baseOffset: Meters;
  // Sin "thickness": se deriva del MaterialLayerSet asociado.
}

export interface Opening extends EntityBase {
  readonly kind: "Opening";
  readonly offsetAlongAxis: Meters; // desde wall.start
  readonly sillHeight: Meters; // desde la base del muro
  readonly width: Meters;
  readonly height: Meters;
}

export type SwingSide = "left" | "right";
export type SwingDirection = "inward" | "outward";

export interface Door extends EntityBase {
  readonly kind: "Door";
  readonly typeId?: Id;
  readonly leafWidth: Meters;
  readonly leafHeight: Meters;
  readonly operation: "single_swing" | "double_swing" | "sliding";
  readonly swingSide: SwingSide;
  readonly swingDirection: SwingDirection;
}

export interface Window extends EntityBase {
  readonly kind: "Window";
  readonly typeId?: Id;
  readonly frameWidth: Meters;
  readonly frameHeight: Meters;
  readonly operation: "fixed" | "casement" | "sliding" | "tilt_turn";
}

// ─── Disciplinas y redes (Paso 7) ──────────────────────────

/** Disciplinas de los planos técnicos. ARQ = arquitectura. */
export type Discipline = "ARQ" | "EST" | "ELE" | "ILU" | "DOM" | "HID" | "SAN" | "GAS" | "SOL";
export const DISCIPLINES: readonly Discipline[] = ["ARQ", "EST", "ELE", "ILU", "DOM", "HID", "SAN", "GAS", "SOL"];
export const DISCIPLINE_NAMES: Readonly<Record<Discipline, string>> = {
  ARQ: "Arquitectura",
  EST: "Estructura",
  ELE: "Eléctrica (tomas y fuerza)",
  ILU: "Iluminación",
  DOM: "Domótica y comunicaciones",
  HID: "Hidráulica (agua fría y caliente)",
  SAN: "Sanitaria y aguas lluvias",
  GAS: "Gas",
  SOL: "Energía solar fotovoltaica",
};

/** Espacio (recinto) con su contorno a caras interiores. El área se deriva del contorno. */
export interface Space extends EntityBase {
  readonly kind: "Space";
  readonly number: string;
  readonly boundary: readonly Vec2[];
}

/**
 * Dispositivo puntual de una red: toma, luminaria, punto hidráulico, sensor...
 * `symbol` es la clave del catálogo de símbolos; los datos técnicos van en `properties`
 * (circuito, potencia, flujo luminoso, unidades de consumo, caudal...).
 */
export interface Device extends EntityBase {
  readonly kind: "Device";
  readonly discipline: Discipline;
  readonly symbol: string;
  readonly position: Vec2;
  /** Giro del símbolo en radianes. */
  readonly rotation: number;
  /** Altura de montaje sobre el piso terminado. */
  readonly mountingHeight: Meters;
  readonly tag?: string;
}

/** Recorrido lineal de una red: tubería, canalización, bus. */
export interface Run extends EntityBase {
  readonly kind: "Run";
  readonly discipline: Discipline;
  /** Sistema dentro de la disciplina: "AF", "AC", "RC", "AN", "AV", "ALL", "GAS", "CIR", "BUS", "DAT", "DC"... */
  readonly system: string;
  readonly points: readonly Vec2[];
  readonly tag?: string;
}

export type AnnotationStyle = "text" | "line" | "dashed" | "dimension" | "axis" | "polygon" | "solid" | "arrow" | "outline";

/** Anotación de dibujo: textos, cotas, ejes, contornos de elementos no modelados. */
export interface Annotation extends EntityBase {
  readonly kind: "Annotation";
  readonly discipline: Discipline;
  readonly style: AnnotationStyle;
  readonly points: readonly Vec2[];
  readonly text?: string;
  /** Altura del texto en mm de papel (por defecto 2.5). */
  readonly textSize?: number;
}

/** Circuito eléctrico de un tablero. Las cargas salen de los dispositivos que lo citan. */
export interface Circuit extends EntityBase {
  readonly kind: "Circuit";
  readonly panel: string;
  readonly number: string;
  readonly description: string;
  readonly voltage: 120 | 240;
  /** Fase a la que se conecta: A, B o AB (240 V). */
  readonly phase: "A" | "B" | "AB";
  readonly breakerA: number;
  /** Calibre AWG de las fases: "14", "12", "10", "8", "6", "4", "2", "1/0". */
  readonly conductorAwg: string;
  readonly conduit: string;
  /** Carga fija en VA que no viene de dispositivos (p. ej. reserva). */
  readonly extraLoadVA?: number;
  /** true para cargas continuas (3 h o más): la protección debe ser ≥ 125 % de la corriente. */
  readonly continuous?: boolean;
}

export type PaperSize = "A1" | "A2" | "A3";
export const PAPER_MM: Readonly<Record<PaperSize, { w: number; h: number }>> = {
  A1: { w: 841, h: 594 },
  A2: { w: 594, h: 420 },
  A3: { w: 420, h: 297 },
};

/** Bloque de contenido que la hoja dibuja en una posición del papel (mm, origen abajo a la izquierda). */
export interface SheetBlock {
  readonly type: string; // "cuadro-areas", "cuadro-cargas", "unifilar", "convenciones", "notas", "fachadas"...
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly title?: string;
  readonly lines?: readonly string[];
}

/** Plano (hoja): una vista del nivel filtrada por disciplinas, con rótulo editable. */
export interface Sheet extends EntityBase {
  readonly kind: "Sheet";
  readonly number: string;
  readonly title: string;
  readonly levelId: Id;
  /** Disciplinas que se dibujan en primer plano. */
  readonly disciplines: readonly Discipline[];
  /** Disciplinas que se dibujan de fondo, en gris. */
  readonly background: readonly Discipline[];
  readonly paper: PaperSize;
  /** Denominador de la escala: 50 = 1:50. */
  readonly scale: number;
  /** Punto del modelo que cae en el centro de la ventana de dibujo. */
  readonly viewCenter: Vec2;
  /** Ventana de dibujo en mm de papel. */
  readonly viewport: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly blocks: readonly SheetBlock[];
  /** Campos propios de la hoja en el rótulo (revisión, fecha, dibujó...). */
  readonly fields: Readonly<Record<string, string>>;
  readonly order: number;
}

export type Entity =
  | Project
  | Building
  | Level
  | Material
  | MaterialLayerSet
  | Wall
  | Opening
  | Door
  | Window
  | Space
  | Device
  | Run
  | Annotation
  | Circuit
  | Sheet;

export type EntityKind = Entity["kind"];
export type EntityOfKind<K extends EntityKind> = Extract<Entity, { kind: K }>;

/** Elementos que deben estar contenidos en exactamente un nivel. */
export type BuildingElement = Wall | Door | Window;
export const BUILDING_ELEMENT_KINDS: readonly EntityKind[] = ["Wall", "Door", "Window"];
/** Todo lo que se dibuja en un nivel y por tanto debe estar contenido en exactamente uno. */
export type LevelElement = BuildingElement | Space | Device | Run | Annotation;
export const LEVEL_ELEMENT_KINDS: readonly EntityKind[] = ["Wall", "Door", "Window", "Space", "Device", "Run", "Annotation"];
/** Elementos dibujables con posición libre (se mueven sin anfitrión). */
export const FREE_ELEMENT_KINDS: readonly EntityKind[] = ["Space", "Device", "Run", "Annotation"];
/** Elementos que rellenan un hueco. */
export type FillingElement = Door | Window;
export const FILLING_KINDS: readonly EntityKind[] = ["Door", "Window"];

// ─── Relaciones (objetos de primera clase) ─────────────────
interface RelationBase {
  readonly id: Id;
}

export interface RelAggregates extends RelationBase {
  readonly kind: "RelAggregates";
  readonly parentId: Id;
  readonly childIds: readonly Id[];
}
export interface RelContainedIn extends RelationBase {
  readonly kind: "RelContainedIn";
  readonly levelId: Id;
  readonly elementIds: readonly Id[];
}
export interface RelVoids extends RelationBase {
  readonly kind: "RelVoids";
  readonly hostId: Id;
  readonly openingId: Id;
}
export interface RelFills extends RelationBase {
  readonly kind: "RelFills";
  readonly openingId: Id;
  readonly fillingId: Id;
}
export interface RelAssociatesMaterial extends RelationBase {
  readonly kind: "RelAssociatesMaterial";
  readonly materialDefId: Id;
  readonly elementIds: readonly Id[];
}
export interface RelConnectsWalls extends RelationBase {
  readonly kind: "RelConnectsWalls";
  readonly wallA: Id;
  readonly endA: "start" | "end";
  readonly wallB: Id;
  readonly endB: "start" | "end" | "middle";
}

export type Relation =
  | RelAggregates
  | RelContainedIn
  | RelVoids
  | RelFills
  | RelAssociatesMaterial
  | RelConnectsWalls;

/** Todas las entidades que una relación referencia. */
export function relationParticipants(rel: Relation): Id[] {
  switch (rel.kind) {
    case "RelAggregates":
      return [rel.parentId, ...rel.childIds];
    case "RelContainedIn":
      return [rel.levelId, ...rel.elementIds];
    case "RelVoids":
      return [rel.hostId, rel.openingId];
    case "RelFills":
      return [rel.openingId, rel.fillingId];
    case "RelAssociatesMaterial":
      return [rel.materialDefId, ...rel.elementIds];
    case "RelConnectsWalls":
      return [rel.wallA, rel.wallB];
  }
}

// ─── El modelo: la Única Fuente de Verdad ─────────────────
export interface BimModel {
  readonly schemaVersion: 1;
  readonly entities: Readonly<Record<Id, Entity>>;
  readonly relations: Readonly<Record<Id, Relation>>;
}

/** Tolerancia geométrica global del proyecto, en metros. */
export const TOLERANCE: Meters = 1e-6;
