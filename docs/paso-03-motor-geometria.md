# ARKEN · Paso 3: Motor de geometría derivada

> Paso 1: **qué** guardamos. Paso 2: **cómo cambia**. Paso 3: **cómo se ve**. Aquí convertimos parámetros (un eje, unas capas, unos huecos) en las formas que dibujan la planta 2D y la vista 3D. Igual que antes: lógica primero, esqueleto de tipos al final.

---

## 1. Qué es el motor de geometría (y qué no es)

El motor es una **función pura**:

```
geometría = f(entidad, sus vecinos relevantes)
```

- **Entra**: el muro W1, su receta de capas, sus huecos, los muros con los que se une, la cota de su nivel.
- **Sale**: varias *representaciones* listas para dibujar.
- **No** modifica el modelo, **no** sabe nada de la pantalla, **no** guarda nada en el archivo.

Consecuencias directas de los Pasos 1 y 2:
- Si se borra toda la geometría, se puede regenerar idéntica desde el modelo. Por eso nunca se guarda.
- Como es pura y sin DOM, puede correr en un **Web Worker** (principio 3).
- Solo se recalcula lo que el **propagador de dependencias** del Paso 2 marca como sucio.

---

## 2. Varias representaciones por elemento

En IFC, un mismo elemento tiene varias "representaciones", cada una para un uso. Nosotros generamos cuatro:

| Representación | Para qué | Ejemplo en un muro |
|---|---|---|
| **Axis** | Ajustes (snap), cotas, uniones | La línea del eje |
| **Plan** | La planta 2D | Contorno cortado, líneas de capa, huecos abiertos |
| **Body** | La vista 3D | Malla de triángulos con los huecos perforados |
| **Box** | Selección rápida (R-Tree, Paso 4) | Caja envolvente 2D y 3D |

Punto clave: **la planta no es un corte del 3D.** Un plano arquitectónico tiene convenciones (el arco de apertura de una puerta, las capas del muro con su trama, las líneas ocultas de una ventana alta) que no existen en el sólido. Por eso Plan se genera **directamente desde los parámetros**, igual que Body, y ninguno depende del otro.

---

## 3. El marco local del muro: la herramienta que simplifica todo

Trabajar en coordenadas globales con muros inclinados es una pesadilla. El truco: cada muro define su **propio sistema de coordenadas**, alineado con él.

```
            v (altura)
            ▲
            │
            │        n (normal, hacia la cara "exterior")
            │      ↗
   start ●──┼────────────────────────► u (a lo largo del eje)
                                       ● end
```

A partir de `start` y `end`:
- **u** = dirección del eje = `(end − start) / longitud`
- **n** = normal en planta = `u` girado 90°
- **v** = vertical (Z), con origen en `cota del nivel + baseOffset`
- **longitud** = `|end − start|`

En este marco **todo muro es una caja recta**: de `u = 0` a `u = longitud`, de `v = 0` a `v = altura`, y de `n = −e/2` a `n = +e/2` (según la justificación). Y los huecos del Paso 1 ya están en este marco: `offsetAlongAxis` es una `u` y `sillHeight` es una `v`.

Se calcula todo en local, y al final una sola transformación pasa el resultado a coordenadas globales. Esta idea es la misma que IFC llama **colocación local encadenada** (`IfcLocalPlacement`):

```
Nivel ──► Muro ──► Hueco ──► Puerta
(cota)   (start,u,n) (u, v)   (sentido de apertura)
```

Cada eslabón se coloca relativo al anterior. Mover el muro mueve automáticamente el hueco y la puerta, sin que la puerta "lo sepa".

---

## 4. Capas y justificación: de un eje a varias líneas paralelas

El espesor `e` es la suma de las capas (Paso 1). La **justificación** dice dónde cae el eje dentro de ese espesor:

| Justificación | Cara exterior en `n =` | Cara interior en `n =` |
|---|---|---|
| `center` | `+e/2` | `−e/2` |
| `exterior` | `0` | `−e` |
| `interior` | `+e` | `0` |

Desde la cara exterior se van restando los espesores de cada capa y se obtienen las **líneas de frontera entre capas**: todas paralelas al eje, a distintas `n`. En planta, cada franja entre dos líneas es una capa con su propio relleno (trama del ladrillo, del aislante...).

---

## 5. Uniones en esquina: la parte difícil de verdad

Dos muros que se encuentran no deben solaparse ni dejar un hueco. Sin limpieza de uniones, una planta se ve amateur. Usamos `RelConnectsWalls` del Paso 1 (qué extremo de cada muro participa).

### 5.1 Los tres casos típicos

```
   Unión en L               Unión en T             Unión en línea
  (inglete)                (tope)                 (continuidad)

  ║                         ║                      
  ║                         ║                     ═══════╤═══════
  ╚══════                ═══╩═══                  (se funden
                                                    en uno)
```

- **L**: dos extremos que se tocan. Cada cara de un muro se **extiende o recorta hasta cortar** la cara correspondiente del otro (exterior con exterior, interior con interior). Resultado: un inglete limpio.
- **T**: el extremo de un muro llega al **medio** de otro. El muro que llega se recorta contra la cara del muro que recibe; el muro que recibe no cambia.
- **En línea**: dos muros colineales seguidos; se cortan perpendicularmente y se dibujan sin línea de separación si comparten receta.

### 5.2 Cómo se calcula (idea, sin fórmulas)
1. Cada muro aporta sus líneas de cara (las de la sección 4) en coordenadas globales.
2. Para cada extremo unido, se **intersecan** las líneas de cara de un muro con las del otro.
3. Esos puntos de intersección reemplazan a las esquinas rectas originales del extremo.

El resultado de este paso no es un rectángulo, sino un **contorno de 4 o más vértices** por muro (su "huella" en planta), con los extremos ya limpios.

### 5.3 Casos peligrosos que hay que tratar desde el principio
- **Muros casi paralelos**: la intersección de las caras se va al infinito. Si el ángulo es menor que un umbral, se trata como unión en línea.
- **Muros muy cortos**: el inglete podría "cruzar" el otro extremo. Se limita el recorte a la longitud del muro.
- **Capas distintas en una L**: en esta versión cortamos todas las capas por el mismo inglete. La prioridad de capas (que la capa estructural pase y la de acabado se detenga) queda para más adelante.

> Importante: la limpieza de uniones hace que el muro dependa de sus vecinos. Por eso el propagador del Paso 2 incluye "muros conectados" en el conjunto sucio.

---

## 6. Huecos en la planta 2D: el plano de corte

Una planta arquitectónica es un **corte horizontal** a una altura convencional, normalmente **1.0–1.2 m** sobre el nivel. Lo llamamos `cutHeight` (configurable por vista).

Para cada hueco del muro, en coordenadas locales:
- Si el hueco **atraviesa el plano de corte** (`sillHeight < cutHeight < sillHeight + height`), el muro queda **abierto** en planta en el tramo `u ∈ [offset, offset + ancho]`. La huella se parte en trozos.
- Si el hueco está **entero por encima** (una ventana alta), el muro se dibuja cerrado y el hueco se marca con **líneas discontinuas** (convención de "por encima del corte").
- Si está **entero por debajo** (raro: una rejilla baja), igual pero con otra convención.

Así, un muro de 5 m con una puerta de 0.9 m a 1 m del inicio se convierte en planta en **dos tramos**: `u ∈ [0, 1.0]` y `u ∈ [1.9, 5.0]`.

### 6.1 Símbolos de puerta y ventana
En planta, puertas y ventanas no se cortan: se dibuja su **símbolo**, generado desde sus parámetros en el marco del hueco:

- **Puerta batiente**: una línea para la hoja (largo = `leafWidth`) girada 90°, y un **arco** de radio `leafWidth` que muestra el barrido. `swingSide` decide en qué jamba está la bisagra y `swingDirection` hacia qué lado de `n` abre.
- **Puerta corredera**: la hoja como rectángulo fino desplazado sobre el muro, con una flecha.
- **Ventana**: líneas del marco en las caras del muro y una o dos líneas finas para el vidrio en el centro del espesor.

Más adelante estos símbolos podrán venir de una biblioteca editable; por ahora son generadores en código.

---

## 7. Huecos en el sólido 3D: evitar el CSG general

La forma "de libro" de perforar un muro es la **geometría constructiva de sólidos (CSG)**: `sólido = caja del muro − caja del hueco`, con un algoritmo booleano general. Funciona, pero tiene tres problemas: es **lento**, es **frágil numéricamente** (caras casi coplanares, errores de redondeo) y es difícil de depurar.

Como en nuestro marco local el muro es un prisma y los huecos son rectángulos que lo atraviesan entero, podemos hacer algo mucho más simple y robusto:

1. **Alzado**: en el plano `(u, v)`, el muro es un rectángulo `[0, L] × [0, H]` y cada hueco es un rectángulo dentro de él. Se forma un **polígono con agujeros**.
2. **Caras grandes**: ese polígono con agujeros se **triangula** dos veces, una para la cara exterior (`n = +e/2`) y otra para la interior (`n = −e/2`).
3. **Caras laterales**: el contorno exterior del polígono genera los cantos superior, inferior y los extremos (que ya vienen recortados por las uniones de la sección 5).
4. **Jambas, dintel y alféizar**: cada agujero genera 4 caras finas que cierran el espesor del hueco.

Resultado: una malla limpia, exacta y rápida, sin booleanos. El CSG general se reserva para casos exóticos futuros (muros curvos, huecos inclinados), detrás de la misma interfaz.

La puerta y la ventana generan su propia malla 3D (marco, hoja, vidrio) en el marco del hueco, y se coloca con la cadena de colocaciones de la sección 3.

---

## 8. Formato de salida: pensado para el hilo de render

La geometría viaja del motor (posible Worker) al render. Para que eso sea barato:

- **Mallas 3D** como arrays tipados planos: `Float32Array` para posiciones y normales, `Uint32Array` para índices de triángulos. Estos buffers se pueden **transferir** entre hilos sin copiarse.
- **Planta 2D** como listas de **polígonos y polilíneas con un "estilo"** (no colores): `"capa:ladrillo"`, `"simbolo:puerta"`, `"oculto"`. La vista 2D traduce estilos a grosores, colores y tramas según la escala del plano. El motor no sabe de pinceles.
- Cada salida lleva el **id del elemento** que la produjo, para que al hacer clic en un triángulo o una línea se sepa qué se seleccionó.

---

## 9. Caché e invalidación

El motor guarda una caché en memoria:

```
GeometryCache: Map<Id, { version, axis, plan, body, box }>
```

- Cuando llega un `ChangeEvent` del Paso 2, el propagador entrega el conjunto sucio (W1, sus huecos, su puerta, los muros unidos). **Solo esos** se recalculan.
- La `version` es la referencia del objeto inmutable (Paso 2, §9) o un contador. Si no cambió, no se recalcula.
- **Pereza por vista**: la planta 2D solo pide `plan` de los elementos del nivel visible; la vista 3D solo pide `body`. Si nadie mira la Planta 5, su geometría de planta no se calcula hasta que alguien la abra.
- La caja `box` se calcula siempre, porque la necesita el R-Tree del Paso 4.

---

## 10. Robustez numérica: reglas fijas

1. **Tolerancia única** del proyecto (`1e-6` m) para comparar puntos y decidir si dos líneas son paralelas.
2. **Elementos degenerados** (muro de longitud casi 0, hueco de ancho 0) no lanzan error: producen geometría vacía y un aviso. El validador del Paso 2 ya debería evitarlos, pero el motor nunca debe romperse.
3. **Determinismo**: la misma entrada da exactamente la misma salida. Esto permite tests de "foto" (comparar mallas con una referencia guardada).
4. **Nada de geometría global hasta el final**: calcular en el marco local reduce los errores de redondeo en edificios grandes alejados del origen.

---

## 11. Esqueleto TypeScript mínimo

Solo tipos y firmas. Usa los tipos del Paso 1 (`Id`, `Meters`, `Vec2`, `Wall`...) y del Paso 2 (`ModelReader`, `ChangeEvent`).

```ts
// ─── Marco local de un muro ─────────────────────────────────
interface Vec3 { x: Meters; y: Meters; z: Meters }

interface WallFrame {
  origin: Vec3;          // start del eje, a la cota de base
  u: Vec2;               // dirección del eje (unitaria)
  n: Vec2;               // normal en planta (unitaria)
  length: Meters;
  height: Meters;
  faceExt: Meters;       // posición n de la cara exterior
  faceInt: Meters;       // posición n de la cara interior
  layerBoundaries: { n: Meters; materialId: Id }[];
}

// ─── Uniones resueltas ──────────────────────────────────────
interface WallFootprint {
  wallId: Id;
  outline: Vec2[];       // huella en planta con extremos limpios (global)
}

// ─── Representaciones ───────────────────────────────────────
type StyleKey = string;  // "capa:<materialId>", "simbolo:puerta", "oculto"...

interface PlanPrimitive {
  kind: "polygon" | "polyline" | "arc";
  points: Vec2[];        // para "arc": centro, inicio, fin
  style: StyleKey;
}
interface PlanGeometry {
  elementId: Id;
  levelId: Id;
  primitives: PlanPrimitive[];
}

interface MeshData {
  elementId: Id;
  positions: Float32Array;   // xyz xyz ...
  normals: Float32Array;
  indices: Uint32Array;      // triángulos
  materialRanges: { materialId: Id; start: number; count: number }[];
}

interface AABB2 { min: Vec2; max: Vec2 }
interface AABB3 { min: Vec3; max: Vec3 }

interface ElementGeometry {
  elementId: Id;
  version: unknown;          // referencia/contador de la entidad usada
  axis?: Vec2[];
  plan?: PlanGeometry;
  body?: MeshData;
  box: { plan: AABB2; body: AABB3 };
}

// ─── Opciones de vista que afectan a la planta ──────────────
interface PlanViewOptions {
  levelId: Id;
  cutHeight: Meters;         // típico 1.2
}

// ─── El motor ───────────────────────────────────────────────
interface GeometryEngine {
  // Recalcula lo sucio y devuelve qué cambió (para render y R-Tree)
  update(model: ModelReader, dirty: ReadonlySet<Id>): {
    updated: ElementGeometry[];
    removed: Id[];
  };
  getPlan(model: ModelReader, elementId: Id, view: PlanViewOptions): PlanGeometry | undefined;
  getBody(model: ModelReader, elementId: Id): MeshData | undefined;
  getBox(elementId: Id): ElementGeometry["box"] | undefined;
}

// ─── Piezas internas (funciones puras, una responsabilidad cada una) ─
type BuildWallFrame   = (wall: Wall, layers: MaterialLayerSet, levelElevation: Meters) => WallFrame;
type ResolveJoins     = (frames: Map<Id, WallFrame>, joins: RelConnectsWalls[]) => Map<Id, WallFootprint>;
type BuildWallPlan    = (frame: WallFrame, footprint: WallFootprint, openings: Opening[], view: PlanViewOptions) => PlanGeometry;
type BuildWallBody    = (frame: WallFrame, footprint: WallFootprint, openings: Opening[]) => MeshData;
type BuildDoorSymbol  = (door: Door, opening: Opening, frame: WallFrame) => PlanPrimitive[];
type BuildWindowSymbol = (win: Window, opening: Opening, frame: WallFrame, view: PlanViewOptions) => PlanPrimitive[];
```

---

## 12. Ejemplo numérico: el muro W1 del Paso 1

Datos: W1 de `(0,0)` a `(5,0)`, justificación `center`, altura 2.8 m, receta "Tabique 15" (yeso 0.015 + ladrillo 0.12 + yeso 0.015). Hueco O1 a `u = 1.0`, ancho 0.9, alto 2.1, antepecho 0. Puerta D1 de hoja 0.82, bisagra a la izquierda, abre hacia dentro.

1. **Marco**: `u = (1,0)`, `n = (0,1)`, `longitud = 5`, `e = 0.15`.
2. **Caras y capas**: exterior en `n = +0.075`, interior en `n = −0.075`; fronteras de capa en `n = +0.060` y `n = −0.060`.
3. **Uniones**: W1 no tiene vecinos, así que su huella es el rectángulo `[0,5] × [−0.075, +0.075]`.
4. **Planta con corte a 1.2 m**: el hueco va de `v = 0` a `v = 2.1`, atraviesa el corte, así que el muro se abre. Quedan dos tramos: `u ∈ [0, 1.0]` y `u ∈ [1.9, 5.0]`, cada uno con 3 franjas de capa (yeso, ladrillo, yeso).
5. **Símbolo de la puerta**: bisagra en `u = 1.0`. Hoja de 0.82 m perpendicular al muro hacia el lado interior (`n < 0`), y arco de radio 0.82 m que barre de la hoja abierta a la posición cerrada.
6. **3D**: alzado `[0,5] × [0,2.8]` con un agujero `[1.0,1.9] × [0,2.1]` (toca el suelo, así que en realidad es una muesca en U). Se triangula por cada cara, se añaden cantos y las jambas y el dintel del hueco.
7. **Cajas**: en planta `min (0, −0.075)`, `max (5, 0.075)` ampliada por el arco de la puerta hasta `n = −0.82 − 0.075`; en 3D, de `z = 0` a `z = 2.8`.

Si ahora el usuario gira W1 45°, solo cambia el **marco** del paso 1. Los pasos 2 a 7 son idénticos en coordenadas locales; la transformación final los coloca girados. Puerta incluida.

---

## 13. Resumen en una frase

**Cada muro se calcula en su propio marco local, donde es una caja recta: las capas son líneas paralelas, las esquinas se limpian intersecando caras con los vecinos, los huecos abren la planta según el plano de corte y perforan el 3D sin booleanos, y todo sale como datos planos con su caja envolvente, listo para el render y para el R-Tree.**

---

## 14. Qué propongo para el Paso 4

**Indexación espacial y selección a 60 FPS**: con las cajas `box` de este paso, construir un **R-Tree por nivel** para la planta y uno global para el 3D, actualizado de forma incremental con cada `ChangeEvent`. Veremos cómo resolver un clic en dos fases (búsqueda gruesa en el R-Tree, prueba exacta sobre la geometría), el resaltado al pasar el ratón, la selección por rectángulo y el *snapping* a ejes y extremos de muro.
