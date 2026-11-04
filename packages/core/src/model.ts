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

export type Entity =
  | Project
  | Building
  | Level
  | Material
  | MaterialLayerSet
  | Wall
  | Opening
  | Door
  | Window;

export type EntityKind = Entity["kind"];
export type EntityOfKind<K extends EntityKind> = Extract<Entity, { kind: K }>;

/** Elementos que deben estar contenidos en exactamente un nivel. */
export type BuildingElement = Wall | Door | Window;
export const BUILDING_ELEMENT_KINDS: readonly EntityKind[] = ["Wall", "Door", "Window"];
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
