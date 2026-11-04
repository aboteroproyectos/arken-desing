# ARKEN · Paso 1: Modelo de datos base (Muros, Puertas, Ventanas)

> Objetivo de este paso: entender **cómo se relacionan** los objetos antes de escribir lógica. Al final hay un esqueleto TypeScript mínimo (solo tipos, sin comportamiento) y un ejemplo JSON.

---

## 1. La idea central: entidades + relaciones, nada más

Un modelo BIM no es un dibujo; es una **base de datos de objetos con significado**. Siguiendo a IFC, el núcleo tiene solo dos tipos de cosas:

| Concepto | Qué es | Ejemplos |
|---|---|---|
| **Entidad** | Un objeto con identidad propia (un `id` único, estable para siempre) | Muro, Puerta, Nivel, Material |
| **Relación** | Un objeto que **conecta** dos o más entidades y explica *por qué* están conectadas | "este hueco perfora este muro", "esta puerta rellena este hueco" |

La decisión más importante del Paso 1 es esta: **las relaciones son objetos de primera clase, no punteros escondidos dentro de las entidades.**

¿Por qué? Imagina que la puerta guarda `muroPadre: "W1"` y el muro guarda `puertas: ["D1","D2"]`. Tienes dos copias de la misma verdad que pueden desincronizarse (bug clásico de los CAD). Si en cambio existe un único objeto `RelFills { hueco: O1, elemento: D1 }`, hay **una sola fuente de verdad** y los índices inversos ("¿qué puertas tiene este muro?") se calculan a partir de ella.

Esto es exactamente el principio que pediste (Single Source of Truth), aplicado a escala de cada vínculo.

---

## 2. Los cuatro "pisos" del modelo

Piensa en el modelo como capas, de lo más general a lo más concreto:

```
Proyecto (unidades, sistema de coordenadas)
 └─ Edificio
     └─ Nivel (Planta 1, cota +3.00 m)          ← estructura espacial
         ├─ Muro W1                              ← elementos constructivos
         │    └─ Hueco O1  (perfora a W1)        ← elemento "negativo"
         │         └─ Puerta D1 (rellena O1)     ← elemento de relleno
         └─ Muro W2
              └─ Hueco O2
                   └─ Ventana V1
```

### 2.1 Estructura espacial: Proyecto → Edificio → Nivel
- El **Nivel** (`IfcBuildingStorey`) es la referencia vertical: tiene una **cota** (elevación) en metros.
- Cada muro **pertenece a un nivel** mediante la relación `RelContainedIn` (IFC: `IfcRelContainedInSpatialStructure`).
- Consecuencia práctica: si subes la cota de la Planta 2 de +3.00 a +3.20, todos sus muros suben solos, porque su posición vertical es **relativa al nivel**, no absoluta.
- (Más adelante el Paso de "Site" y georreferenciación se añade encima sin romper nada.)

### 2.2 El Muro: un eje + reglas, no un rectángulo
Un muro **no guarda su geometría 3D**. Guarda los **parámetros** a partir de los cuales la geometría se calcula:

- **Eje (línea base)**: dos puntos 2D `inicio` y `fin` en el plano del nivel. Es la "columna vertebral" del muro.
- **Justificación**: dónde cae el eje respecto al espesor (centro, cara interior, cara exterior). En IFC esto es el *offset* del `MaterialLayerSetUsage`.
- **Altura** y **desfase de base** (el muro puede empezar 0.10 m por debajo del nivel, por ejemplo).
- **Espesor**: no se escribe a mano; **es la suma de las capas de material** (ver 2.5). Cambias el ladrillo de 12 a 15 cm y el muro engorda solo.

La geometría (el sólido extruido, el contorno en planta) es **derivada**: se recalcula cuando cambia algún parámetro y se guarda en una caché aparte, nunca en el modelo. Esto es lo que hace al sistema *paramétrico*.

### 2.3 El Hueco: el intermediario que casi todos olvidan
Aquí está la parte más elegante de IFC. Una puerta **no se relaciona directamente con el muro**. Hay un tercer objeto en medio: el **Hueco** (`IfcOpeningElement`).

```
Muro W1  ◄──RelVoids──  Hueco O1  ◄──RelFills──  Puerta D1
         "O1 perfora W1"          "D1 rellena O1"
```

- **`RelVoids`** (`IfcRelVoidsElement`): el hueco **resta** volumen al muro (una operación booleana).
- **`RelFills`** (`IfcRelFillsElement`): la puerta o ventana **ocupa** ese hueco.

¿Por qué no saltarse el hueco?
1. **Huecos vacíos existen**: un paso libre entre cocina y salón, un hueco para instalaciones. Hueco sin puerta = válido.
2. **Separación de responsabilidades**: el muro solo sabe "tengo agujeros"; no necesita saber si son puertas, ventanas o pasos. Mañana añades "rejilla de ventilación" sin tocar el muro.
3. **Borrar la puerta no destruye el muro**: puedes quitar D1 y decidir si el hueco O1 se queda o se cierra.
4. **El hueco puede ser más grande que la puerta** (holguras, premarcos), algo que los fabricantes y los cómputos de obra necesitan.

### 2.4 Puerta y Ventana: posición paramétrica sobre el muro
La puerta no guarda coordenadas absolutas X/Y. El **hueco** guarda su posición **relativa al eje del muro que perfora**:

- **`distanciaDesdeInicio`**: metros a lo largo del eje desde el punto `inicio` del muro.
- **`alturaAntepecho`** (o *sill*): cota inferior del hueco desde la base del muro (0 para puertas, ~0.90 m para ventanas).
- **`ancho`** y **`alto`** del hueco.

Resultado: si arrastras el muro, giras el muro o lo alargas, la puerta **viaja con él** automáticamente. Es la misma idea que los niveles: todo es relativo a su "anfitrión".

La puerta/ventana en sí guarda lo que le es propio: ancho y alto de la hoja, **sentido de apertura** (izquierda/derecha, hacia dentro/fuera), tipo de operación (batiente, corredera, abatible), y sus materiales (marco, vidrio).

### 2.5 Materiales: definidos una vez, usados muchas veces
- **`Material`**: "Ladrillo macizo", "Yeso", "Aluminio". Lleva propiedades físicas (densidad, conductividad térmica, color de representación).
- **`MaterialLayerSet`** (`IfcMaterialLayerSet`): una **receta de capas** ordenada, p. ej. `Yeso 1.5 cm + Ladrillo 12 cm + Aislante 5 cm + Mortero 2 cm`.
- El muro **referencia** un `MaterialLayerSet` (relación `RelAssociatesMaterial`). Diez muros pueden compartir la misma receta: cambias la receta y cambian los diez.

### 2.6 Tipos vs. instancias (anticipo)
IFC distingue entre **Tipo** (`IfcWallType`: "Muro exterior 20 cm") e **Instancia** (este muro concreto de 4.3 m). La receta de capas y propiedades comunes viven en el Tipo; la instancia solo guarda lo que la hace única (eje, altura). En el esqueleto lo dejo como un campo `typeId` opcional para no complicar este paso, pero conviene saber que va a llegar.

### 2.7 Uniones entre muros (anticipo)
Dos muros que se tocan en una esquina se relacionan con `RelConnectsWalls` (IFC: `IfcRelConnectsPathElements`), indicando qué extremo de cada uno (`inicio`/`fin`) participa. Eso permite limpiar las esquinas en planta (inglete, solape en T). Lo incluyo en el esqueleto como relación, pero su lógica es para un paso posterior.

---

## 3. Unidades y coordenadas (reglas fijas desde el día 1)

- **Unidad interna: metros (SI), números `double`.** Lo que el usuario vea (mm, cm, pies) es solo formato en la interfaz. Nunca se guardan unidades mezcladas.
- **Tolerancia geométrica** global (p. ej. `1e-6` m) para comparar puntos; nunca `===` con flotantes.
- Coordenadas de los muros: **2D en el plano local del nivel**. La Z sale de la cota del nivel + desfase de base. Esto simplifica muchísimo la planta 2D y el índice espacial.
- **IDs**: cadenas tipo UUID/GUID generadas una vez y nunca reutilizadas. IFC usa un GUID comprimido de 22 caracteres; nosotros podemos convertir al exportar.

---

## 4. Por qué esta forma prepara el rendimiento (principio 3)

La estructura no es solo "bonita"; está pensada para lo que viene:

1. **Datos planos y normalizados** (`Map<id, entidad>` y `Map<id, relación>`), sin objetos anidados ni referencias circulares. Eso significa que el modelo se puede **serializar y enviar a un Web Worker** (o mover a otro hilo) de forma barata, y que un cambio se describe como un pequeño parche (`{ id: "W1", altura: 3.2 }`).
2. **La geometría es derivada y vive aparte**. El hilo de render solo recibe mallas/contornos ya calculados; nunca toca la lógica de negocio.
3. **Cada elemento derivado produce una caja envolvente (AABB)**. Esas cajas alimentan el **R-Tree** del Paso de selección. Como la caja se recalcula solo cuando cambia el elemento, el índice se actualiza de forma incremental.
4. **Índices inversos** ("huecos de este muro", "elementos de este nivel") se construyen a partir de las relaciones y se mantienen en memoria: preguntas O(1) sin recorrer todo el modelo.

---

## 5. Reglas de integridad (invariantes)

Estas reglas son el "contrato" que el núcleo debe garantizar siempre. Escribirlas ahora evita bugs después:

1. Todo elemento constructivo (muro, puerta, ventana) está contenido en **exactamente un** nivel.
2. Un hueco perfora **exactamente un** muro (en este paso; más adelante podrá perforar losas).
3. Un hueco tiene **cero o un** elemento de relleno.
4. Una puerta o ventana rellena **exactamente un** hueco (no existen puertas "flotando").
5. El hueco debe caber dentro del muro: `0 ≤ distanciaDesdeInicio` y `distanciaDesdeInicio + ancho ≤ longitud del muro`; `alturaAntepecho + alto ≤ altura del muro`.
6. Borrar un muro **borra en cascada** sus huecos y sus rellenos (o pregunta al usuario). Borrar una puerta **no** borra su hueco.
7. El espesor de un muro es siempre la suma de su `MaterialLayerSet`; nunca se guarda por separado.

---

## 6. Esqueleto TypeScript mínimo

Solo **tipos**, sin funciones. Nombres en inglés para alinearse con IFC y con el ecosistema de librerías; comentarios en español.

```ts
// ─── Básicos ───────────────────────────────────────────────
type Id = string;                  // UUID estable, nunca se reutiliza
type Meters = number;              // unidad interna única: metros
interface Vec2 { x: Meters; y: Meters }

// ─── Base común de todas las entidades ─────────────────────
interface EntityBase {
  id: Id;
  kind: string;                    // discriminador: "Wall", "Door", ...
  name?: string;
  properties?: Record<string, string | number | boolean>; // Psets libres
}

// ─── Estructura espacial ───────────────────────────────────
interface Project  extends EntityBase { kind: "Project"; lengthUnit: "m" }
interface Building extends EntityBase { kind: "Building" }
interface Level    extends EntityBase {
  kind: "Level";
  elevation: Meters;               // cota respecto al proyecto
  height: Meters;                  // altura libre por defecto para muros nuevos
}

// ─── Materiales ────────────────────────────────────────────
interface Material extends EntityBase {
  kind: "Material";
  density?: number;                // kg/m³
  thermalConductivity?: number;    // W/(m·K)
  displayColor?: string;           // "#c8b9a6"
}
interface MaterialLayer { materialId: Id; thickness: Meters }
interface MaterialLayerSet extends EntityBase {
  kind: "MaterialLayerSet";
  layers: MaterialLayer[];         // ordenadas de cara exterior a interior
}

// ─── Elementos constructivos ───────────────────────────────
type WallJustification = "center" | "exterior" | "interior";

interface Wall extends EntityBase {
  kind: "Wall";
  typeId?: Id;                     // futuro: WallType
  start: Vec2;                     // eje, en coordenadas del nivel
  end: Vec2;
  justification: WallJustification;
  height: Meters;
  baseOffset: Meters;              // desfase respecto a la cota del nivel
  // ¡Sin "thickness"! Se deriva del MaterialLayerSet asociado.
}

interface Opening extends EntityBase {
  kind: "Opening";
  // Posición RELATIVA al muro que perfora:
  offsetAlongAxis: Meters;         // desde wall.start
  sillHeight: Meters;              // desde la base del muro
  width: Meters;
  height: Meters;
}

type SwingSide = "left" | "right";
type SwingDirection = "inward" | "outward";

interface Door extends EntityBase {
  kind: "Door";
  typeId?: Id;
  leafWidth: Meters;
  leafHeight: Meters;
  operation: "single_swing" | "double_swing" | "sliding";
  swingSide: SwingSide;
  swingDirection: SwingDirection;
}

interface Window extends EntityBase {
  kind: "Window";
  typeId?: Id;
  frameWidth: Meters;
  frameHeight: Meters;
  operation: "fixed" | "casement" | "sliding" | "tilt_turn";
}

type Entity =
  | Project | Building | Level
  | Material | MaterialLayerSet
  | Wall | Opening | Door | Window;

// ─── Relaciones (objetos de primera clase) ─────────────────
interface RelationBase { id: Id; kind: string }

interface RelAggregates extends RelationBase {      // Proyecto→Edificio→Nivel
  kind: "RelAggregates"; parentId: Id; childIds: Id[];
}
interface RelContainedIn extends RelationBase {     // Nivel contiene elementos
  kind: "RelContainedIn"; levelId: Id; elementIds: Id[];
}
interface RelVoids extends RelationBase {           // Hueco perfora Muro
  kind: "RelVoids"; hostId: Id; openingId: Id;
}
interface RelFills extends RelationBase {           // Puerta/Ventana rellena Hueco
  kind: "RelFills"; openingId: Id; fillingId: Id;
}
interface RelAssociatesMaterial extends RelationBase {
  kind: "RelAssociatesMaterial"; materialDefId: Id; elementIds: Id[];
}
interface RelConnectsWalls extends RelationBase {   // esquinas (paso futuro)
  kind: "RelConnectsWalls";
  wallA: Id; endA: "start" | "end";
  wallB: Id; endB: "start" | "end" | "middle";
}

type Relation =
  | RelAggregates | RelContainedIn | RelVoids
  | RelFills | RelAssociatesMaterial | RelConnectsWalls;

// ─── El modelo: la Única Fuente de Verdad ─────────────────
interface BimModel {
  schemaVersion: 1;
  entities: Record<Id, Entity>;
  relations: Record<Id, Relation>;
}
```

---

## 7. Ejemplo JSON: un muro con una puerta

Un muro de 5 m en la Planta Baja, con una puerta a 1 m de su inicio.

```json
{
  "schemaVersion": 1,
  "entities": {
    "P1":  { "id": "P1",  "kind": "Project",  "name": "Casa demo", "lengthUnit": "m" },
    "B1":  { "id": "B1",  "kind": "Building", "name": "Vivienda" },
    "L0":  { "id": "L0",  "kind": "Level",    "name": "Planta Baja", "elevation": 0, "height": 2.8 },

    "M-yeso":     { "id": "M-yeso",     "kind": "Material", "name": "Yeso",     "displayColor": "#f2efe9" },
    "M-ladrillo": { "id": "M-ladrillo", "kind": "Material", "name": "Ladrillo", "density": 1800 },
    "LS-int":     { "id": "LS-int", "kind": "MaterialLayerSet", "name": "Tabique 15",
                    "layers": [
                      { "materialId": "M-yeso",     "thickness": 0.015 },
                      { "materialId": "M-ladrillo", "thickness": 0.12  },
                      { "materialId": "M-yeso",     "thickness": 0.015 }
                    ] },

    "W1":  { "id": "W1", "kind": "Wall",
             "start": { "x": 0, "y": 0 }, "end": { "x": 5, "y": 0 },
             "justification": "center", "height": 2.8, "baseOffset": 0 },

    "O1":  { "id": "O1", "kind": "Opening",
             "offsetAlongAxis": 1.0, "sillHeight": 0, "width": 0.9, "height": 2.1 },

    "D1":  { "id": "D1", "kind": "Door",
             "leafWidth": 0.82, "leafHeight": 2.03, "operation": "single_swing",
             "swingSide": "left", "swingDirection": "inward" }
  },
  "relations": {
    "r1": { "id": "r1", "kind": "RelAggregates",  "parentId": "P1", "childIds": ["B1"] },
    "r2": { "id": "r2", "kind": "RelAggregates",  "parentId": "B1", "childIds": ["L0"] },
    "r3": { "id": "r3", "kind": "RelContainedIn", "levelId": "L0", "elementIds": ["W1", "D1"] },
    "r4": { "id": "r4", "kind": "RelAssociatesMaterial", "materialDefId": "LS-int", "elementIds": ["W1"] },
    "r5": { "id": "r5", "kind": "RelVoids", "hostId": "W1", "openingId": "O1" },
    "r6": { "id": "r6", "kind": "RelFills", "openingId": "O1", "fillingId": "D1" }
  }
}
```

Fíjate en lo que **no** aparece: ni el espesor del muro (se deriva: 0.015 + 0.12 + 0.015 = 0.15 m), ni las coordenadas absolutas de la puerta (se derivan: x = 1.0 a 1.9 m sobre el eje de W1), ni ninguna malla 3D. Todo eso lo calculará el motor de geometría.

> Nota: el hueco `O1` no está en `RelContainedIn` a propósito. En IFC el hueco no pertenece al nivel, sino al muro que perfora; su ubicación espacial se hereda del anfitrión.

---

## 8. Resumen en una frase

**El muro es un eje con reglas; el hueco lo perfora; la puerta o ventana rellena el hueco; todo cuelga de un nivel y todo vínculo es un objeto de relación explícito. La geometría nunca se guarda: se deriva.**

---

## 9. Qué propongo para el Paso 2

Construir el **núcleo del grafo** (`BimStore`): un pequeño módulo que aplica cambios mediante **comandos/transacciones** (crear muro, insertar puerta, mover), valida los invariantes de la sección 5, mantiene los índices inversos y emite eventos de cambio para que las vistas 2D/3D reaccionen. Eso nos da gratis el *deshacer/rehacer* y es la base para mandar los cambios al hilo de render.
