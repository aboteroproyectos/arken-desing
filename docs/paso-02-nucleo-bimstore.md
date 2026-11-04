# ARKEN · Paso 2: El núcleo del grafo (`BimStore`)

> En el Paso 1 definimos **qué** guardamos: entidades y relaciones. En el Paso 2 definimos **cómo cambia** ese modelo sin romperse nunca. Como antes: lógica primero y, al final, un esqueleto TypeScript con solo tipos y firmas.

---

## 1. El problema que resuelve el núcleo

Si cualquier parte del programa pudiera escribir `modelo.entities["W1"].height = 3.2`, en pocas semanas tendríamos:

- puertas que se salen del muro porque alguien lo acortó,
- una vista 3D que no se entera del cambio,
- un "deshacer" imposible de implementar,
- y ningún registro de qué pasó.

La solución es una regla sencilla y estricta:

> **Nadie toca el modelo directamente. Todo cambio entra por una única puerta: el `BimStore`.**

El `BimStore` es el guardián de la Única Fuente de Verdad. Recibe **intenciones**, las convierte en **cambios atómicos**, los **valida**, los **aplica** y **avisa** a quien le interese.

---

## 2. El flujo completo de un cambio

```
 Usuario arrastra un muro
          │
          ▼
 ┌─────────────────┐   intención de alto nivel ("mover W1 a ...")
 │    Comando       │
 └────────┬────────┘
          │ produce operaciones de bajo nivel
          ▼
 ┌─────────────────┐   put / delete de entidades y relaciones
 │   Transacción    │   (borrador aislado)
 └────────┬────────┘
          │ validar invariantes
          ▼
     ¿Válido? ── no ──► rollback, nada cambió, error explicado al usuario
          │ sí
          ▼
 ┌─────────────────┐
 │   Commit         │   el modelo cambia + índices se actualizan
 └────────┬────────┘
          │ un único ChangeSet
          ├──────────────► Historial (deshacer / rehacer)
          ▼
 ┌─────────────────┐
 │    Eventos       │──► Motor de geometría ──► Vista 2D, Vista 3D, R-Tree
 └─────────────────┘
```

Cada caja tiene una sola responsabilidad. Las vamos a ver una por una.

---

## 3. Dos niveles de cambio: Comandos y Operaciones

Esta es la idea más importante del paso.

### 3.1 Operaciones (bajo nivel): solo existen 4
Todo cambio posible del modelo, por complejo que sea, se reduce a una lista de estas cuatro operaciones:

| Operación | Significado |
|---|---|
| `putEntity(entidad)` | crear o reemplazar una entidad |
| `deleteEntity(id)` | borrar una entidad |
| `putRelation(relación)` | crear o reemplazar una relación |
| `deleteRelation(id)` | borrar una relación |

Al aplicar cada operación, el núcleo **guarda el valor anterior** (`before`) junto al nuevo (`after`). Esto es lo que hace mágico al deshacer (sección 6).

### 3.2 Comandos (alto nivel): el vocabulario del arquitecto
Un comando expresa lo que el usuario quiere, en su idioma:

- `CreateWall(nivel, inicio, fin, receta de capas)`
- `InsertDoor(muro, distanciaDesdeInicio, ancho, alto)`
- `MoveWall(muro, desplazamiento)`
- `DeleteElement(id)`

Un comando **no modifica nada por sí mismo**: solo **genera operaciones**. Por ejemplo, `InsertDoor` genera seis:

1. `putEntity(Opening O7)`
2. `putEntity(Door D7)`
3. `putRelation(RelVoids  W1 ← O7)`
4. `putRelation(RelFills  O7 ← D7)`
5. `putRelation(RelContainedIn ...)` actualizado con D7
6. `putRelation(RelAssociatesMaterial ...)` si la puerta trae materiales

### 3.3 ¿Por qué separar los dos niveles?
- **Los comandos no implementan su propio deshacer.** Como todo se reduce a 4 operaciones con su `before`, deshacer es genérico y funciona igual para cualquier comando presente o futuro. Esto elimina una fuente enorme de bugs.
- **Las operaciones son datos serializables.** Se pueden enviar a un Web Worker, guardar en un registro de cambios, sincronizar por red (colaboración en tiempo real en el futuro) o reproducir en un test.
- **Los comandos se pueden componer.** "Duplicar planta" es simplemente muchos `CreateWall` + `InsertDoor` dentro de una sola transacción.

### 3.4 Los IDs los genera el comando, una sola vez
Cuando `InsertDoor` crea `O7` y `D7`, los IDs quedan escritos en las operaciones. Si deshaces y rehaces, vuelven a aparecer `O7` y `D7`, **no** IDs nuevos. Así cualquier referencia externa (una anotación, un comentario, una selección) sigue siendo válida.

---

## 4. Transacciones: todo o nada

Una **transacción** es un borrador aislado donde se acumulan operaciones antes de confirmarlas.

- **Atomicidad**: si `InsertDoor` falla en la operación 4, las tres primeras tampoco se aplican. El modelo nunca queda "a medias" (un hueco sin relación con su muro, por ejemplo).
- **Lectura dentro del borrador**: mientras la transacción está abierta, el comando puede leer el modelo **tal como quedaría** con sus propios cambios. Así un comando compuesto puede crear un muro y, en la línea siguiente, insertarle una puerta.
- **Un commit = un paso del historial = un evento.** Aunque la transacción tenga 300 operaciones, las vistas reciben **un solo** aviso y el usuario deshace **una sola vez**.

---

## 5. Validación de invariantes (el contrato del Paso 1)

Antes del commit, el núcleo comprueba las reglas que escribimos en el Paso 1 (§5): toda puerta rellena exactamente un hueco, el hueco cabe en su muro, cada elemento está en un nivel, etc.

Dos decisiones de diseño importantes:

### 5.1 Validar solo lo afectado ("conjunto sucio")
Revisar las 20.000 entidades de un edificio en cada clic sería lento. La transacción sabe qué IDs tocó; el validador revisa **esos IDs y sus vecinos directos** a través de las relaciones. Si acortas W1, se revisan W1, sus huecos y sus rellenos. Nada más.

### 5.2 Rechazar o reparar
Ante una violación hay dos estrategias, y conviene decidirlas regla por regla:

| Estrategia | Cuándo | Ejemplo |
|---|---|---|
| **Rechazar** | El usuario pidió algo imposible | Insertar una puerta de 1 m en un muro de 0.6 m → error claro: "La puerta no cabe en el muro". |
| **Reparar en cascada** | La consecuencia es obvia y esperada | Borrar un muro → el comando añade automáticamente el borrado de sus huecos, puertas y relaciones. |

Regla de oro: **la reparación la hace el comando, no el validador.** El validador solo dice sí o no; así su comportamiento es predecible.

---

## 6. Historial: deshacer y rehacer casi gratis

Al hacer commit, la transacción produce un **`ChangeSet`**: la lista de operaciones con su `before` y `after`.

- **Deshacer** = aplicar el `ChangeSet` al revés: donde había `after`, poner `before` (y si `before` no existía, borrar).
- **Rehacer** = volver a aplicar los `after`.

Dos pilas: `undoStack` y `redoStack`. Un commit nuevo vacía la pila de rehacer, como en cualquier editor.

### 6.1 Arrastres interactivos (importante para la sensación de fluidez)
Mientras el usuario arrastra un muro, el ratón genera ~60 movimientos por segundo. No queremos 60 pasos en el historial. La solución:

- Al **pulsar** el ratón se abre una transacción **interactiva**.
- Cada movimiento **reemplaza** el desplazamiento dentro de esa misma transacción y emite un evento de **vista previa** (las vistas se actualizan, el historial no).
- Al **soltar**, se valida y se hace commit: **un solo paso** de deshacer.
- Si el usuario pulsa `Esc`, rollback: el muro vuelve a su sitio sin dejar rastro.

---

## 7. Índices inversos: preguntas instantáneas

El modelo guarda relaciones en una sola dirección (p. ej. `RelVoids { hostId, openingId }`). Pero constantemente necesitamos preguntar al revés:

- ¿Qué huecos tiene el muro W1?
- ¿Qué relleno tiene el hueco O1?
- ¿Qué elementos hay en la Planta 1?
- ¿Qué muros usan la receta "Tabique 15"?
- ¿En qué relaciones participa la entidad X? (imprescindible para borrar en cascada)

El núcleo mantiene en memoria un mapa por cada una de estas preguntas, del tipo `Map<Id, Set<Id>>`, y los **actualiza en cada operación** de forma incremental. Coste de la pregunta: O(1).

Tres reglas:
1. **Los índices son derivados**: nunca se guardan en el archivo. Al abrir un proyecto se reconstruyen desde las relaciones.
2. **Solo el núcleo los escribe.** El resto del programa solo los lee.
3. **Prueba de oro para los tests**: después de cualquier secuencia de comandos, "índices incrementales" debe ser idéntico a "índices reconstruidos desde cero". Si difieren, hay un bug.

---

## 8. Eventos de cambio: el núcleo no conoce a sus espectadores

Tras cada commit (o vista previa), el núcleo publica un evento con un resumen del `ChangeSet`:

```
{ added: [O7, D7], modified: [W1], removed: [] , preview: false }
```

Quien quiera, se suscribe: el motor de geometría, la vista 2D, la vista 3D, la tabla de cómputos, el panel de propiedades. **El núcleo no importa ninguno de esos módulos.** Esto es lo que hace que las vistas sean "visualizadores puros" (principio 1).

### 8.1 Propagación de dependencias
Si cambia W1, no basta con redibujar W1: su hueco O1 se movió con él y la puerta D1 también. Igual, si cambias la receta "Tabique 15", cambian todos los muros que la usan. Un módulo pequeño, el **propagador de dependencias**, usa los índices inversos para ampliar el conjunto de "elementos cuya geometría hay que recalcular":

```
cambia Material/LayerSet ──► muros que lo usan
cambia Muro              ──► sus huecos ──► sus puertas/ventanas
                         ──► muros conectados (esquinas)
cambia Nivel (cota)      ──► todos sus elementos
```

Ese conjunto ampliado es lo que recibe el motor de geometría del Paso 3.

---

## 9. Inmutabilidad: por qué no editamos objetos "en sitio"

Las entidades se tratan como **inmutables**: para cambiar la altura de W1 no se modifica el objeto, se crea uno nuevo `{ ...W1, height: 3.2 }` y se reemplaza con `putEntity`.

Ventajas:
- **Detección de cambios trivial**: si la referencia es distinta, cambió. Las vistas pueden comparar en O(1).
- **El `before` del historial es seguro**: nadie puede modificarlo por accidente después.
- **Instantáneas baratas**: para enviar el modelo a otro hilo o guardar en segundo plano, se puede tomar una "foto" sin copiar todo.

---

## 10. ¿En qué hilo vive el `BimStore`?

Por ahora, en el hilo principal, pero **diseñado para poder moverse** a un Web Worker sin reescribirlo. Para ello, desde el día 1:

- El núcleo **no usa nada del DOM** ni de la librería de render.
- Sus entradas (comandos/operaciones) y salidas (ChangeSets) son **datos planos serializables**.

Cuando el modelo crezca, el render y la interacción se quedarán en el hilo principal, y el núcleo más el motor de geometría se irán a un Worker, comunicándose solo con ChangeSets. Esa es la separación del principio 3, y el diseño de este paso la deja preparada.

---

## 11. Esqueleto TypeScript mínimo

Solo tipos y firmas. Importa los tipos del Paso 1 (`Id`, `Entity`, `Relation`, `BimModel`).

```ts
// ─── Operaciones de bajo nivel (las únicas 4 que existen) ───
type Op =
  | { type: "putEntity";      entity: Entity }
  | { type: "deleteEntity";   id: Id }
  | { type: "putRelation";    relation: Relation }
  | { type: "deleteRelation"; id: Id };

// Operación ya aplicada: recuerda el antes y el después
interface AppliedOp {
  target: "entity" | "relation";
  id: Id;
  before: Entity | Relation | null;   // null = no existía
  after:  Entity | Relation | null;   // null = fue borrado
}

// Resultado de un commit: unidad de historial y de evento
interface ChangeSet {
  id: Id;
  label: string;                      // "Insertar puerta", para el menú Deshacer
  ops: AppliedOp[];
  timestamp: number;
}

// Resumen que reciben los suscriptores
interface ChangeEvent {
  changeSetId: Id;
  added: Id[];
  modified: Id[];
  removed: Id[];
  preview: boolean;                   // true durante arrastres interactivos
}

// ─── Lectura (lo que ven comandos y vistas) ─────────────────
interface ModelReader {
  getEntity<T extends Entity = Entity>(id: Id): T | undefined;
  getRelation(id: Id): Relation | undefined;
  indices: Indices;
}

interface Indices {
  openingsOfHost(hostId: Id): ReadonlySet<Id>;
  fillingOfOpening(openingId: Id): Id | undefined;
  openingOfFilling(fillingId: Id): Id | undefined;
  elementsOfLevel(levelId: Id): ReadonlySet<Id>;
  levelOfElement(elementId: Id): Id | undefined;
  elementsUsingMaterialDef(materialDefId: Id): ReadonlySet<Id>;
  relationsOf(entityId: Id): ReadonlySet<Id>;   // para borrado en cascada
}

// ─── Transacción ────────────────────────────────────────────
interface Transaction extends ModelReader {    // lee el estado "como quedaría"
  apply(op: Op): void;
  readonly touched: ReadonlySet<Id>;           // conjunto sucio para validar
}

// ─── Validación ─────────────────────────────────────────────
interface InvariantViolation {
  rule: string;                       // "opening-fits-host"
  entityIds: Id[];
  message: string;                    // texto para el usuario
}
type Invariant = (tx: ModelReader, touched: ReadonlySet<Id>) => InvariantViolation[];

// ─── Comandos (vocabulario del arquitecto) ──────────────────
interface Command {
  label: string;
  execute(tx: Transaction): void;     // solo emite ops; nunca escribe directo
}

// ─── El núcleo ──────────────────────────────────────────────
type CommitResult =
  | { ok: true;  changeSet: ChangeSet }
  | { ok: false; violations: InvariantViolation[] };

interface InteractiveSession {
  update(cmd: Command): void;         // reemplaza la vista previa
  commit(): CommitResult;             // al soltar el ratón
  cancel(): void;                     // Esc
}

interface BimStore extends ModelReader {
  run(cmd: Command): CommitResult;               // camino normal
  beginInteractive(): InteractiveSession;        // arrastres
  undo(): ChangeSet | undefined;
  redo(): ChangeSet | undefined;
  subscribe(listener: (e: ChangeEvent) => void): () => void; // devuelve "desuscribir"
  load(model: BimModel): void;                   // reconstruye índices
  snapshot(): BimModel;                          // para guardar o enviar a un Worker
}
```

### Cómo se vería un comando (pseudocódigo, solo para ilustrar)

```ts
// InsertDoor: no valida geometría ni toca índices; solo describe qué crear.
const insertDoor = (wallId: Id, offset: Meters, w: Meters, h: Meters): Command => ({
  label: "Insertar puerta",
  execute(tx) {
    const openingId = newId(), doorId = newId();
    tx.apply({ type: "putEntity",   entity: { id: openingId, kind: "Opening", offsetAlongAxis: offset, sillHeight: 0, width: w, height: h } });
    tx.apply({ type: "putEntity",   entity: { id: doorId, kind: "Door", /* ... */ } });
    tx.apply({ type: "putRelation", relation: { id: newId(), kind: "RelVoids", hostId: wallId, openingId } });
    tx.apply({ type: "putRelation", relation: { id: newId(), kind: "RelFills", openingId, fillingId: doorId } });
    // + añadir doorId al RelContainedIn del nivel del muro (leído vía tx.indices.levelOfElement)
  },
});
// Si la puerta no cabe, el invariante "opening-fits-host" lo rechaza en el commit.
```

---

## 12. Ejemplo narrado: insertar una puerta y deshacer

1. El usuario hace clic en W1 a 1.0 m de su inicio con la herramienta Puerta.
2. La interfaz llama `store.run(insertDoor("W1", 1.0, 0.9, 2.1))`.
3. El núcleo abre una transacción; el comando emite 5 operaciones.
4. El validador revisa el conjunto sucio `{O7, D7, W1, L0}`: el hueco cabe (1.0 + 0.9 ≤ 5.0), la puerta rellena un hueco, está en un nivel. Todo correcto.
5. Commit: el modelo cambia, los índices se actualizan, el `ChangeSet` "Insertar puerta" entra en la pila de deshacer.
6. Evento: `{ added: [O7, D7], modified: [W1, L0] }`. El propagador añade lo dependiente; el motor de geometría recalcula W1 con su hueco; la planta 2D y la vista 3D se redibujan; el R-Tree actualiza 2 cajas.
7. `Ctrl+Z`: el núcleo aplica el `ChangeSet` al revés (borra O7, D7 y sus relaciones), emite `{ removed: [O7, D7], modified: [W1, L0] }` y todo vuelve a como estaba.

Ningún módulo de vista participó en la lógica. Solo escucharon.

---

## 13. Resumen en una frase

**El `BimStore` recibe comandos, que se reducen a cuatro operaciones; las aplica en una transacción atómica que valida el contrato del modelo; cada commit produce un `ChangeSet` que sirve a la vez para deshacer, para avisar a las vistas y para viajar a otro hilo.**

---

## 14. Qué propongo para el Paso 3

El **motor de geometría derivada**: tomar un muro (eje + justificación + capas + huecos) y producir su contorno 2D para la planta (con las capas y los huecos cortados) y su sólido 3D (extrusión menos huecos), más la caja envolvente que alimentará el R-Tree del Paso 4. Ahí veremos también cómo limpiar las esquinas entre muros conectados.
