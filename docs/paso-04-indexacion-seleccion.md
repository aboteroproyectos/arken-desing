# ARKEN · Paso 4: Indexación espacial y selección a 60 FPS

> Paso 1: qué guardamos. Paso 2: cómo cambia. Paso 3: cómo se ve. Paso 4: **cómo se toca**. Aquí resolvemos que el clic, el resaltado al pasar el ratón y el *snapping* respondan al instante aunque el edificio tenga decenas de miles de elementos.

---

## 1. El problema: 16 milisegundos

A 60 FPS, cada fotograma dispone de **16.6 ms** para todo: leer el ratón, decidir qué hay debajo, resaltarlo, calcular el snap y dibujar. Si la interacción se come 10 ms, el dibujo no llega y el programa "se arrastra".

Un edificio mediano tiene **20.000–100.000 elementos**. La forma ingenua de saber qué hay bajo el cursor sería:

```
para cada elemento:
    ¿el cursor toca su geometría exacta?
```

Eso son 100.000 pruebas geométricas por cada movimiento del ratón: decenas de milisegundos. Inaceptable.

La solución tiene dos ideas:
1. **Descartar en bloque** lo que está lejos sin mirarlo, usando un **índice espacial**.
2. Hacer la prueba exacta **solo con los pocos candidatos** que quedan.

Objetivo de presupuesto: **menos de 1 ms** por evento de ratón, incluso con 100.000 elementos.

---

## 2. ¿Qué índice espacial? R-Tree, Quadtree o rejilla

Los tres organizan el espacio para responder rápido a "¿qué hay en esta zona?". Se diferencian en cómo lo dividen:

| Índice | Cómo divide | Punto fuerte | Punto débil en arquitectura |
|---|---|---|---|
| **Rejilla uniforme** | Celdas fijas del mismo tamaño | Trivial de implementar | Densidad muy desigual: un baño con 200 objetos y un patio vacío. El tamaño de celda nunca es bueno para todos. |
| **Quadtree** | Divide el espacio en 4 recursivamente donde hay muchos objetos | Se adapta a la densidad | Los **objetos largos** (un muro de 30 m) cruzan muchas celdas y hay que duplicarlos o subirlos a nodos altos. Y la arquitectura está llena de objetos largos. |
| **R-Tree** | Agrupa **los objetos** (no el espacio) en cajas que se anidan | Funciona bien con objetos de tamaños muy distintos; carga masiva muy rápida; inserción y borrado dinámicos | Un poco más complejo de implementar |

**Decisión: R-Tree.** Es el estándar en sistemas GIS y CAD justamente por manejar bien objetos de tamaños dispares y por actualizarse de forma incremental.

### 2.1 Cómo funciona un R-Tree, en una imagen

```
                      ┌───────────── raíz ─────────────┐
                      │  [caja A]            [caja B]   │
                      └─────┬───────────────────┬──────┘
               ┌────────────┴──────┐      ┌──────┴────────────┐
               │ [W1] [W2] [D1]    │      │ [W7] [W8] [V3]    │
               └───────────────────┘      └───────────────────┘
```

- Las **hojas** guardan las cajas envolventes de los elementos (las `box` del Paso 3) y su `id`.
- Cada **nodo interno** guarda la caja que envuelve a todos sus hijos.
- Para buscar en una zona: si la zona no toca la caja A, **toda la rama A se descarta sin mirarla**. Así, con 100.000 elementos solo se visitan unas decenas de nodos.

Detalles de diseño:
- **Nodos de 9 a 16 hijos**: buen equilibrio entre altura del árbol y coste por nodo.
- **Carga masiva (bulk load, algoritmo STR)** al abrir un proyecto: construye el árbol entero de una vez, mucho más rápido y mejor equilibrado que insertar uno a uno.
- **Inserción y borrado individuales** para las ediciones posteriores.
- Existen buenas implementaciones de referencia en JavaScript (por ejemplo, `rbush`). Podemos usar una al principio y reemplazarla después sin tocar el resto, gracias a la interfaz de la sección 9.

---

## 3. Qué índices construimos

No hay un único índice; hay uno por cada "pregunta espacial" distinta:

| Índice | Contenido | Uso |
|---|---|---|
| **Planta, uno por nivel** | Cajas 2D `box.plan` de los elementos de ese nivel | Clic, hover, selección por rectángulo en la vista de planta |
| **Puntos de snap, uno por nivel** | Extremos, puntos medios de muros, centros de huecos | Snapping (sección 7) |
| **3D global** | Cajas 3D `box.body` | Consultas 3D: selección por caja, colisiones, cortes |

¿Por qué uno por nivel? Porque la planta solo muestra un nivel a la vez. Buscar en el índice de la Planta 2 ignora de entrada todo lo de las otras plantas, sin coste.

> Recuerda del Paso 3: la caja de planta de una puerta **incluye su arco de apertura**. Por eso puedes hacer clic en el arco para seleccionar la puerta.

---

## 4. Actualización incremental: el índice nunca se reconstruye entero

El flujo continúa el de los pasos anteriores:

```
BimStore ──ChangeEvent──► Motor de geometría ──{updated, removed}──► Índices espaciales
                                  (Paso 3)                              (Paso 4)
```

- Para cada elemento en `updated`: **quitar su caja antigua e insertar la nueva**. Para poder quitarla, el índice guarda un mapa `id → caja actual`.
- Para cada `id` en `removed`: quitarlo.
- Coste: logarítmico por elemento. Mover un muro con su puerta son 3 actualizaciones: microsegundos.

Igual que con los índices inversos del Paso 2, hay una **prueba de oro** para los tests: tras cualquier secuencia de cambios, el índice incremental debe contener exactamente las mismas cajas que uno construido desde cero.

### 4.1 Durante un arrastre
Los eventos de vista previa del Paso 2 también actualizan el índice, para que el resaltado y el snap reflejen la posición en vivo. Además, **el elemento que se arrastra se excluye de las consultas**: no tiene sentido hacer snap contra uno mismo.

---

## 5. El clic en dos fases

### Fase 0: de píxeles a metros
El ratón da coordenadas de **pantalla** (píxeles). Con la transformación inversa de la vista (zoom y desplazamiento) se convierten a coordenadas del **mundo** (metros, en el plano del nivel).

La **tolerancia** se define en píxeles (por ejemplo, 5 px) y se convierte a metros según el zoom: `tolerancia_m = 5 × metros_por_píxel`. Así, apuntar es igual de cómodo con el plano entero en pantalla que con un detalle a 1:5.

### Fase 1: fase gruesa (broad phase)
Se busca en el R-Tree del nivel visible un cuadrado pequeño centrado en el cursor, de lado `2 × tolerancia`. Resultado: los **candidatos** cuya caja toca ese cuadrado. Normalmente de 1 a 10 elementos.

### Fase 2: fase fina (narrow phase)
Para cada candidato se hace la **prueba exacta** contra su geometría de planta (las primitivas del Paso 3):
- **Polígonos** (tramos del muro): ¿el punto está dentro, o a menos de `tolerancia` del borde?
- **Polilíneas y arcos** (símbolo de puerta): ¿la distancia del punto a la línea o al arco es menor que `tolerancia`?

### Fase 3: desempate
Si varios candidatos pasan la prueba fina, se ordenan con reglas fijas:
1. **Elementos alojados antes que su anfitrión**: si el clic toca la puerta y el muro, gana la puerta. Es casi siempre lo que el usuario quiere, y siempre puede llegar al muro haciendo clic en otra parte de él.
2. **Menor distancia** al cursor.
3. **Elemento más pequeño** (el más específico).

Y un atajo clásico de los CAD: con **Tab** se recorren los candidatos superpuestos uno por uno, en ese mismo orden.

---

## 6. Resaltado, selección y por qué no viven en el modelo

### 6.1 Hover a ritmo de fotograma
El ratón puede generar más eventos que fotogramas. Solución: guardar solo la **última posición** del ratón y procesar el hover **una vez por fotograma** (con `requestAnimationFrame`). Nunca se acumula trabajo atrasado.

### 6.2 La selección es estado de la interfaz, no del modelo
Decisión de arquitectura importante: **qué está seleccionado o resaltado no se guarda en el `BimStore`**.
- Seleccionar no es un cambio del edificio: no debe entrar en el historial de deshacer, ni guardarse en el archivo, ni disparar el motor de geometría.
- Vive en un pequeño **`SelectionState`** aparte (ids seleccionados, id resaltado, ciclo de Tab). Las vistas lo escuchan igual que escuchan al núcleo.
- Si un elemento seleccionado se borra, el `SelectionState` lo quita al recibir el `ChangeEvent`.

### 6.3 Selección por rectángulo: ventana y captura
La convención que conoce cualquier usuario de CAD:

| Arrastre | Nombre | Selecciona |
|---|---|---|
| De izquierda a derecha | **Ventana** | Solo lo que queda **completamente dentro** |
| De derecha a izquierda | **Captura** | Todo lo que **toca** el rectángulo |

Con el R-Tree:
- **Ventana**: buscar las cajas que tocan el rectángulo y quedarse con las que están **contenidas** en él. Si la caja está dentro, el elemento está dentro: no hace falta prueba fina.
- **Captura**: las cajas que tocan el rectángulo son candidatas; la prueba fina comprueba si la **geometría real** cruza el rectángulo (una caja puede tocarlo sin que el muro lo haga, por ejemplo en muros diagonales).

---

## 7. Snapping: ayudar a dibujar con precisión

El snapping "imanta" el cursor a puntos significativos mientras se dibuja o se mueve algo. Usa la misma maquinaria de dos fases.

### 7.1 Tipos de snap y prioridad
| Prioridad | Tipo | Origen |
|---|---|---|
| 1 | **Extremo** de muro | Índice de puntos de snap |
| 2 | **Intersección** de ejes o caras | Calculada al vuelo entre los segmentos cercanos |
| 3 | **Punto medio** de muro | Índice de puntos de snap |
| 4 | **Sobre el eje o la cara** (punto más cercano) | Geometría Axis del Paso 3 |
| 5 | **Rejilla** y ángulos fijos (0°, 45°, 90°) | Calculado, sin índice |

### 7.2 Cómo se resuelve
1. Fase gruesa: buscar en el índice de puntos y en el de planta dentro de la tolerancia (en píxeles, como en el clic).
2. Fase fina: calcular la distancia real a cada punto o segmento candidato.
3. Elegir por **prioridad** y, a igual prioridad, por distancia.
4. Mostrar un pequeño **símbolo** junto al cursor (cuadrado para extremo, triángulo para punto medio, aspa para intersección), para que el usuario sepa a qué se está imantando.

Los puntos de snap se actualizan con los mismos `ChangeEvent`, igual que las cajas.

---

## 8. ¿En qué hilo vive cada cosa?

Completamos el mapa de hilos de los pasos anteriores:

| Componente | Hilo | Por qué |
|---|---|---|
| `BimStore` (Paso 2) | Principal al inicio, Worker después | Lógica pura, mensajes serializables |
| Motor de geometría (Paso 3) | Worker | Es lo más pesado de calcular |
| **Índices espaciales y selección (Paso 4)** | **Principal**, junto al render | La respuesta al ratón debe ser **síncrona**: no podemos esperar un mensaje de ida y vuelta a otro hilo en cada movimiento |
| Render 2D y 3D | Principal (o `OffscreenCanvas`) | Acceso a la GPU |

El índice es ligero (solo cajas y puntos, no mallas), así que mantenerlo en el hilo principal es barato. El Worker de geometría envía las cajas nuevas junto con los buffers de cada actualización.

### 8.1 ¿Y la selección en la vista 3D?
En 3D el cursor es un **rayo** que sale de la cámara, y hay que encontrar el primer triángulo que toca. Dos técnicas, que conviene combinar:
- **Selección por GPU (recomendada para el clic)**: se dibuja la escena en un buffer oculto donde cada elemento tiene un "color" igual a su id, y se lee el píxel bajo el cursor. Es exacta y su coste no depende del número de elementos.
- **Rayo contra el índice 3D (para lo demás)**: fase gruesa con las cajas 3D del índice global y fase fina contra los triángulos. Útil para medir distancias, colocar objetos sobre superficies y snapping 3D.

---

## 9. Esqueleto TypeScript mínimo

Solo tipos y firmas. Usa los tipos de los pasos anteriores (`Id`, `Meters`, `Vec2`, `AABB2`, `PlanGeometry`, `ChangeEvent`...).

```ts
// ─── Índice espacial genérico (implementación intercambiable) ───
interface SpatialIndex2D {
  load(items: { id: Id; box: AABB2 }[]): void;   // carga masiva (STR)
  upsert(id: Id, box: AABB2): void;              // quitar caja vieja + insertar nueva
  remove(id: Id): void;
  search(area: AABB2): Id[];                     // cajas que tocan el área
  clear(): void;
}

// Un índice de planta y uno de puntos de snap por nivel
interface LevelIndices {
  levelId: Id;
  plan: SpatialIndex2D;
  snapPoints: SpatialIndex2D;                    // puntos como cajas de tamaño 0
}

// ─── Vista: conversión pantalla ↔ mundo ─────────────────────
interface Viewport2D {
  screenToWorld(px: Vec2): Vec2;
  worldToScreen(p: Vec2): Vec2;
  metersPerPixel: number;                        // depende del zoom
}

// ─── Selección por clic ─────────────────────────────────────
interface PickQuery {
  levelId: Id;
  screenPoint: Vec2;
  tolerancePx: number;                           // típico 5
  exclude?: ReadonlySet<Id>;                     // p. ej. lo que se está arrastrando
}

interface PickHit {
  elementId: Id;
  distance: Meters;                              // de la prueba fina
  isHosted: boolean;                             // puerta/ventana → gana al muro
}

interface Picker {
  pick(q: PickQuery): PickHit[];                 // ordenados por la regla de desempate
  boxSelect(levelId: Id, area: AABB2, mode: "window" | "crossing"): Id[];
}

// ─── Snapping ───────────────────────────────────────────────
type SnapKind = "endpoint" | "intersection" | "midpoint" | "onAxis" | "grid" | "angle";

interface SnapResult {
  point: Vec2;                                   // punto imantado en el mundo
  kind: SnapKind;                                // decide el símbolo junto al cursor
  sourceIds: Id[];                               // elementos que lo originan
}

interface SnapEngine {
  snap(levelId: Id, worldPoint: Vec2, tolerancePx: number, exclude?: ReadonlySet<Id>): SnapResult | undefined;
}

// ─── Estado de selección (interfaz, NO modelo) ──────────────
interface SelectionState {
  selected: ReadonlySet<Id>;
  hovered: Id | undefined;
  set(ids: Id[]): void;
  toggle(id: Id): void;
  setHovered(id: Id | undefined): void;
  cycleNext(): void;                             // tecla Tab entre candidatos superpuestos
  subscribe(listener: () => void): () => void;
  onModelChange(e: ChangeEvent): void;           // quita ids borrados
}

// ─── Mantenimiento de los índices ───────────────────────────
interface SpatialIndexManager {
  rebuildAll(geometries: ElementGeometry[]): void;          // al abrir proyecto
  applyGeometryUpdate(u: { updated: ElementGeometry[]; removed: Id[] }): void;
  forLevel(levelId: Id): LevelIndices;
}
```

---

## 10. Ejemplo: un clic sobre la puerta D1

Escenario del Paso 3: muro W1 de `(0,0)` a `(5,0)`, puerta D1 con bisagra en `u = 1.0` que abre hacia `n < 0` con un arco de radio 0.82 m. Zoom: 1 píxel = 0.01 m. Tolerancia: 5 px.

1. **Píxeles a metros**: el clic cae en el mundo en `(1.40, −0.45)`. La tolerancia es `5 × 0.01 = 0.05 m`.
2. **Fase gruesa**: se busca en el R-Tree de la Planta Baja el cuadrado `[1.35, 1.45] × [−0.50, −0.40]`.
   - Caja de W1: `[0, 5] × [−0.075, 0.075]`. No toca el cuadrado. **Descartado**.
   - Caja de D1: `[1.0, 1.9] × [−0.895, 0.075]` (incluye el arco). Toca. **Candidato**.
   - Los otros miles de elementos del nivel ni se miran: sus ramas del árbol se descartaron arriba.
3. **Fase fina sobre D1**: el arco tiene centro en la bisagra `(1.0, −0.075)` y radio 0.82. La distancia del clic al centro es aproximadamente `√(0.40² + 0.375²) ≈ 0.548`, lejos del arco (0.82) y lejos de la hoja (que está sobre `x = 1.0`, a 0.40 m). **No acierta.** Resultado: clic en vacío.
4. El usuario hace clic ahora en `(1.62, −0.55)`. Distancia a la bisagra ≈ `√(0.62² + 0.475²) ≈ 0.781`. Diferencia con el radio: `|0.781 − 0.82| = 0.039 < 0.05`. **Acierta sobre el arco**: se selecciona D1.

Coste total: un recorrido de unas pocas decenas de nodos del árbol y dos cálculos de distancia. Microsegundos.

---

## 11. Resumen en una frase

**Cada nivel tiene un R-Tree con las cajas del Paso 3 que se actualiza de forma incremental con cada cambio; el clic, el rectángulo y el snap descartan en bloque lo lejano en la fase gruesa y solo prueban la geometría exacta de unos pocos candidatos; la selección es estado de la interfaz, vive en el hilo principal y nunca toca el modelo.**

---

## 12. Dónde estamos y qué propongo para el Paso 5

Con este paso, el **diseño del núcleo está completo**:

```
 Paso 1  Modelo de datos      qué guardamos         (entidades + relaciones IFC)
 Paso 2  BimStore             cómo cambia           (comandos, transacciones, eventos, deshacer)
 Paso 3  Motor de geometría   cómo se ve            (planta y 3D derivados)
 Paso 4  Índices espaciales   cómo se toca          (selección y snap a 60 FPS)
```

Propongo que el **Paso 5 sea el primero con código real**:

1. Crear el repositorio en TypeScript, organizado en paquetes que respetan estas fronteras: `core` (Pasos 1 y 2), `geometry` (Paso 3), `spatial` (Paso 4) y `app` (interfaz).
2. Implementar los tipos del Paso 1 y el `BimStore` del Paso 2 **con tests desde el primer día**, incluidas las "pruebas de oro" de índices.
3. Primer hito visible: **dibujar muros en una planta 2D** sobre un canvas, con clic, deshacer y rehacer.

Para eso necesitaré un repositorio de GitHub donde trabajar. Si todavía no existe, hay que crearlo en GitHub (por ejemplo `arken`) y avisarme.
