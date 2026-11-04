// ARKEN · Paso 5: primera aplicación.
//
// Flujo (el de los Pasos 2-4):
//   herramienta ──comando──► BimStore ──ChangeEvent──► motor de geometría ──► índices espaciales
//                                                                         └──► vista de planta
// La vista y las herramientas solo LEEN el modelo; todo cambio pasa por el BimStore.

import {
  BimStore,
  createStarterModel,
  createWall,
  deleteElements,
  getOfKind,
  insertDoor,
  insertWindow,
  moveWalls,
  wallLength,
  wallThickness,
  type BimModel,
  type ChangeEvent,
  type Command,
  type CommitResult,
  type Id,
  type InteractiveSession,
  type SwingSide,
  type Vec2,
  type Wall,
} from "@arken/core";
import { PlanGeometryEngine, buildWallFrame, toLocal } from "@arken/geometry";
import { SpatialIndexManager, type SnapResult } from "@arken/spatial";
import { PlanRenderer } from "./renderer";
import { Viewport } from "./viewport";

// ─── Núcleo ─────────────────────────────────────────────────
const starter = createStarterModel();
const store = new BimStore(starter.model);
const engine = new PlanGeometryEngine({ cutHeight: 1.2 });
const spatial = new SpatialIndexManager();
spatial.rebuildAll(engine.rebuildAll(store).updated);

let levelId: Id = starter.ids.levelId;
let layerSetId: Id = starter.ids.layerSets.exterior25;

// ─── Estado de la interfaz (NO es parte del modelo) ─────────
const selection = new Set<Id>();
let hovered: Id | undefined;
let snap: SnapResult | undefined;
let cursor: Vec2 | undefined;
let selectionRect: { a: Vec2; b: Vec2 } | undefined;

const PICK_PX = 8;
const SNAP_PX = 10;
const GRID = 0.05;

// ─── DOM ────────────────────────────────────────────────────
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const canvas = $<HTMLCanvasElement>("#plan");
const hintEl = $<HTMLSpanElement>("#hint");
const messageEl = $<HTMLSpanElement>("#message");
const coordsEl = $<HTMLSpanElement>("#coords");
const undoBtn = $<HTMLButtonElement>("#undo");
const redoBtn = $<HTMLButtonElement>("#redo");
const layerSelect = $<HTMLSelectElement>("#layerset");

const view = new Viewport();
const renderer = new PlanRenderer(canvas, view);

// ─── Reacción a los cambios del modelo ──────────────────────
store.subscribe((e: ChangeEvent) => {
  spatial.applyGeometryUpdate(engine.applyChange(store, e));
  for (const id of e.removed) selection.delete(id);
  if (hovered && !store.getEntity(hovered)) hovered = undefined;
  if (e.reset) {
    selection.clear();
    refreshLayerSets();
  }
  refreshButtons();
  requestDraw();
});

let drawPending = false;
function requestDraw(): void {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => {
    drawPending = false;
    renderer.draw(store, engine.all(), levelId, { selected: selection, hovered, snap, cursor, selectionRect });
  });
}

function say(text: string, ok = false): void {
  messageEl.textContent = text;
  messageEl.classList.toggle("ok", ok);
}

function report(r: CommitResult, okText?: string): boolean {
  if (r.ok) {
    if (okText) say(okText, true);
    return true;
  }
  say(r.violations.map((v) => v.message).join(" "));
  return false;
}

function refreshButtons(): void {
  undoBtn.disabled = !store.canUndo;
  redoBtn.disabled = !store.canRedo;
  undoBtn.title = store.undoLabel ? `Deshacer: ${store.undoLabel} (Ctrl+Z)` : "Nada que deshacer";
  redoBtn.title = store.redoLabel ? `Rehacer: ${store.redoLabel} (Ctrl+Y)` : "Nada que rehacer";
}

function refreshLayerSets(): void {
  layerSelect.innerHTML = "";
  for (const e of store.entities()) {
    if (e.kind !== "MaterialLayerSet") continue;
    const t = e.layers.reduce((s, l) => s + l.thickness, 0);
    const opt = new Option(`${e.name ?? "Receta"} (${Math.round(t * 1000)} mm)`, e.id);
    layerSelect.add(opt);
  }
  if (!getOfKind(store, layerSetId, "MaterialLayerSet")) layerSetId = layerSelect.options[0]?.value ?? layerSetId;
  layerSelect.value = layerSetId;
  const level = [...store.entities()].find((e) => e.kind === "Level");
  if (level && !getOfKind(store, levelId, "Level")) levelId = level.id;
}

const tolerance = (px: number) => px * view.metersPerPixel;

function snapAt(world: Vec2, exclude?: ReadonlySet<Id>): SnapResult {
  return spatial.snap(levelId, world, tolerance(SNAP_PX), { grid: GRID, ...(exclude ? { exclude } : {}) })!;
}

// ─── Herramientas ───────────────────────────────────────────
interface PointerInfo {
  world: Vec2;
  shift: boolean;
}

interface Tool {
  readonly hint: string;
  down(p: PointerInfo): void;
  move(p: PointerInfo): void;
  up(p: PointerInfo): void;
  /** Esc, cambio de herramienta o deshacer: abandona lo que esté a medias. */
  cancel(): void;
  key?(e: KeyboardEvent): boolean;
}

/** Restringe a horizontal/vertical respecto a un punto (tecla Mayús). */
function ortho(from: Vec2, to: Vec2): Vec2 {
  return Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
}

class WallTool implements Tool {
  readonly hint = "Muro: clic para empezar, clic para terminar y seguir encadenando. Mayús = ortogonal. Esc = terminar.";
  private start: Vec2 | undefined;
  private session: InteractiveSession | undefined;
  private previewId: Id | undefined;

  private target(p: PointerInfo): Vec2 {
    snap = snapAt(p.world, this.previewId ? new Set([this.previewId]) : undefined);
    let pt = snap.point;
    if (this.start && p.shift) {
      pt = ortho(this.start, pt);
      snap = { ...snap, point: pt };
    }
    return pt;
  }

  private preview(end: Vec2): void {
    if (!this.start || !this.session) return;
    const cmd = createWall({ levelId, layerSetId, start: this.start, end });
    this.previewId = cmd.wallId;
    this.session.update(cmd);
  }

  down(p: PointerInfo): void {
    const pt = this.target(p);
    if (!this.start) {
      this.start = pt;
      this.session = store.beginInteractive("Crear muro");
      return;
    }
    if (Math.hypot(pt.x - this.start.x, pt.y - this.start.y) < tolerance(SNAP_PX)) return;
    this.preview(pt);
    const r = this.session!.commit();
    if (!report(r, `Muro de ${Math.hypot(pt.x - this.start.x, pt.y - this.start.y).toFixed(2)} m creado.`)) return;
    // Encadenar: el siguiente muro empieza donde terminó este.
    this.start = pt;
    this.previewId = undefined;
    this.session = store.beginInteractive("Crear muro");
  }

  move(p: PointerInfo): void {
    const pt = this.target(p);
    if (this.start && Math.hypot(pt.x - this.start.x, pt.y - this.start.y) > 1e-6) this.preview(pt);
    requestDraw();
  }

  up(): void {}

  cancel(): void {
    this.session?.cancel();
    this.session = undefined;
    this.start = undefined;
    this.previewId = undefined;
  }
}

class SelectTool implements Tool {
  readonly hint =
    "Seleccionar: clic en un elemento (Mayús suma). Arrastra un muro para moverlo. Arrastra en vacío: izquierda→derecha = ventana, derecha→izquierda = captura. Supr = borrar.";
  private downAt: Vec2 | undefined;
  private anchor: Vec2 | undefined;
  private moving: Id[] = [];
  private session: InteractiveSession | undefined;
  private rect = false;

  down(p: PointerInfo): void {
    this.downAt = p.world;
    const hit = spatial.pick(levelId, p.world, tolerance(PICK_PX))[0];
    if (hit) {
      if (p.shift) {
        if (selection.has(hit.elementId)) selection.delete(hit.elementId);
        else selection.add(hit.elementId);
      } else if (!selection.has(hit.elementId)) {
        selection.clear();
        selection.add(hit.elementId);
      }
      this.moving = [...selection].filter((id) => store.getEntity(id)?.kind === "Wall");
      this.anchor = snapAt(p.world, new Set(this.moving)).point;
    } else {
      if (!p.shift) selection.clear();
      this.rect = true;
      selectionRect = { a: p.world, b: p.world };
    }
    describeSelection();
    requestDraw();
  }

  move(p: PointerInfo): void {
    if (this.rect && selectionRect) {
      selectionRect = { a: selectionRect.a, b: p.world };
    } else if (this.anchor && this.downAt && this.moving.length > 0) {
      const dragged = Math.hypot(p.world.x - this.downAt.x, p.world.y - this.downAt.y) > tolerance(3);
      if (dragged) {
        this.session ??= store.beginInteractive(this.moving.length === 1 ? "Mover muro" : "Mover muros");
        snap = snapAt(p.world, new Set(this.moving));
        let to = snap.point;
        if (p.shift) to = ortho(this.anchor, to);
        this.session.update(moveWalls(this.moving, { x: to.x - this.anchor.x, y: to.y - this.anchor.y }));
      }
    } else {
      const top = spatial.pick(levelId, p.world, tolerance(PICK_PX))[0]?.elementId;
      if (top !== hovered) hovered = top;
      snap = undefined;
    }
    requestDraw();
  }

  up(p: PointerInfo): void {
    if (this.session) {
      const r = this.session.commit();
      if (!report(r, "Movido.")) this.session.cancel();
      this.session = undefined;
    }
    if (this.rect && selectionRect) {
      const { a, b } = selectionRect;
      const box = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
      if (box.maxX - box.minX > tolerance(3) || box.maxY - box.minY > tolerance(3)) {
        for (const id of spatial.boxSelect(levelId, box, b.x >= a.x ? "window" : "crossing")) selection.add(id);
      }
      describeSelection();
    }
    this.rect = false;
    selectionRect = undefined;
    this.anchor = this.downAt = undefined;
    this.moving = [];
    snap = undefined;
    void p;
    requestDraw();
  }

  cancel(): void {
    this.session?.cancel();
    this.session = undefined;
    this.rect = false;
    selectionRect = undefined;
    this.anchor = this.downAt = undefined;
    this.moving = [];
  }

  key(e: KeyboardEvent): boolean {
    if ((e.key === "Delete" || e.key === "Backspace") && selection.size > 0) {
      report(store.run(deleteElements([...selection], { removeOpeningOfFilling: true })), "Borrado.");
      selection.clear();
      describeSelection();
      return true;
    }
    return false;
  }
}

class OpeningTool implements Tool {
  readonly hint: string;
  private session: InteractiveSession | undefined;
  private wallId: Id | undefined;
  private side: SwingSide = "left";
  private lastPreview: CommitResult | undefined;

  constructor(private readonly kind: "door" | "window") {
    this.hint =
      kind === "door"
        ? "Puerta: pasa sobre un muro y haz clic. El lado del muro donde está el cursor decide hacia dónde abre. F = cambiar bisagra."
        : "Ventana: pasa sobre un muro y haz clic.";
  }

  private get width(): number {
    return this.kind === "door" ? 0.9 : 1.2;
  }

  /** ¿Sigue el cursor sobre el muro actual? Se calcula en el marco local del muro (Paso 3). */
  private nearWall(wall: Wall, p: Vec2): { u: number; n: number } | undefined {
    const f = buildWallFrame(store, wall);
    const l = toLocal(f, p);
    const tol = tolerance(PICK_PX);
    if (l.u < -tol || l.u > f.length + tol) return undefined;
    if (l.n > f.faceExt + tol || l.n < f.faceInt - tol) return undefined;
    return l;
  }

  move(p: PointerInfo): void {
    snap = undefined;
    let wall = getOfKind(store, this.wallId, "Wall");
    let local = wall ? this.nearWall(wall, p.world) : undefined;
    if (!local) {
      this.cancel();
      const hit = spatial.pick(levelId, p.world, tolerance(PICK_PX)).find((h) => store.getEntity(h.elementId)?.kind === "Wall");
      wall = getOfKind(store, hit?.elementId, "Wall");
      local = wall ? this.nearWall(wall, p.world) : undefined;
    }
    if (!wall || !local) {
      hovered = undefined;
      requestDraw();
      return;
    }
    this.wallId = wall.id;
    hovered = wall.id;
    const len = wallLength(wall);
    const offset = Math.min(Math.max(local.u - this.width / 2, 0), Math.max(len - this.width, 0));
    const cmd: Command =
      this.kind === "door"
        ? insertDoor({ wallId: wall.id, offsetAlongAxis: offset, width: this.width, swingSide: this.side, swingDirection: local.n < 0 ? "inward" : "outward" })
        : insertWindow({ wallId: wall.id, offsetAlongAxis: offset, width: this.width });
    this.session ??= store.beginInteractive(this.kind === "door" ? "Insertar puerta" : "Insertar ventana");
    this.lastPreview = this.session.update(cmd);
    requestDraw();
  }

  down(p: PointerInfo): void {
    if (!this.session) return;
    if (this.lastPreview && !this.lastPreview.ok) return void report(this.lastPreview);
    const r = this.session.commit();
    if (report(r, this.kind === "door" ? "Puerta insertada." : "Ventana insertada.")) {
      this.session = undefined;
      this.wallId = undefined;
      this.move(p); // nueva vista previa en el mismo sitio, lista para insertar otra
    }
  }

  up(): void {}

  cancel(): void {
    this.session?.cancel();
    this.session = undefined;
    this.wallId = undefined;
  }

  key(e: KeyboardEvent): boolean {
    if (this.kind === "door" && e.key.toLowerCase() === "f") {
      this.side = this.side === "left" ? "right" : "left";
      if (lastPointer) this.move(lastPointer);
      return true;
    }
    return false;
  }
}

const tools: Record<string, Tool> = {
  select: new SelectTool(),
  wall: new WallTool(),
  door: new OpeningTool("door"),
  window: new OpeningTool("window"),
};
let toolName = "wall";
let tool: Tool = tools[toolName]!;

function setTool(name: string): void {
  if (!tools[name]) return;
  tool.cancel();
  toolName = name;
  tool = tools[name]!;
  hovered = undefined;
  snap = undefined;
  hintEl.textContent = tool.hint;
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === name)));
  requestDraw();
}

function describeSelection(): void {
  if (selection.size === 0) return say("", true);
  if (selection.size > 1) return say(`${selection.size} elementos seleccionados.`, true);
  const id = [...selection][0]!;
  const e = store.getEntity(id);
  if (!e) return;
  if (e.kind === "Wall") {
    const set = getOfKind(store, store.indices.materialDefOf(id), "MaterialLayerSet");
    say(
      `Muro · ${wallLength(e).toFixed(2)} m · espesor ${(wallThickness(store, id) * 1000).toFixed(0)} mm (${set?.name ?? "sin receta"}) · altura ${e.height.toFixed(2)} m · ${store.indices.openingsOfHost(id).size} hueco(s)`,
      true,
    );
  } else if (e.kind === "Door") say(`Puerta · hoja ${e.leafWidth.toFixed(2)} × ${e.leafHeight.toFixed(2)} m · bisagra ${e.swingSide === "left" ? "izquierda" : "derecha"}`, true);
  else if (e.kind === "Window") say(`Ventana · ${e.frameWidth.toFixed(2)} × ${e.frameHeight.toFixed(2)} m`, true);
}

// ─── Eventos de puntero ─────────────────────────────────────
let lastPointer: PointerInfo | undefined;
let panning: { x: number; y: number } | undefined;
let spaceDown = false;

function pointerInfo(e: PointerEvent | WheelEvent): PointerInfo {
  const r = canvas.getBoundingClientRect();
  return { world: view.screenToWorld({ x: e.clientX - r.left, y: e.clientY - r.top }), shift: e.shiftKey };
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    panning = { x: e.clientX, y: e.clientY };
    return;
  }
  if (e.button === 2) {
    tool.cancel();
    requestDraw();
    return;
  }
  if (e.button === 0) tool.down((lastPointer = pointerInfo(e)));
});

canvas.addEventListener("pointermove", (e) => {
  if (panning) {
    view.panByPixels(e.clientX - panning.x, e.clientY - panning.y);
    panning = { x: e.clientX, y: e.clientY };
    requestDraw();
    return;
  }
  const p = (lastPointer = pointerInfo(e));
  cursor = p.world;
  coordsEl.textContent = `x ${p.world.x.toFixed(2)} m · y ${p.world.y.toFixed(2)} m${snap && snap.kind !== "grid" ? " · " + snapLabel(snap) : ""}`;
  tool.move(p);
});

canvas.addEventListener("pointerup", (e) => {
  if (panning) {
    panning = undefined;
    return;
  }
  if (e.button === 0) tool.up(pointerInfo(e));
});

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    view.zoomAt({ x: e.clientX - r.left, y: e.clientY - r.top }, Math.exp(-e.deltaY * 0.0015));
    requestDraw();
  },
  { passive: false },
);

function snapLabel(s: SnapResult): string {
  return { endpoint: "extremo", midpoint: "punto medio", onAxis: "sobre eje", grid: "rejilla" }[s.kind];
}

// ─── Teclado y botones ──────────────────────────────────────
function undo(): void {
  tool.cancel();
  const cs = store.undo();
  say(cs ? `Deshecho: ${cs.label}` : "Nada que deshacer.", true);
}
function redo(): void {
  tool.cancel();
  const cs = store.redo();
  say(cs ? `Rehecho: ${cs.label}` : "Nada que rehacer.", true);
}

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (e.key === " ") {
    spaceDown = true;
    e.preventDefault();
    return;
  }
  if (mod && k === "z" && !e.shiftKey) return e.preventDefault(), undo();
  if (mod && (k === "y" || (k === "z" && e.shiftKey))) return e.preventDefault(), redo();
  if (e.key === "Escape") {
    tool.cancel();
    selection.clear();
    say("", true);
    requestDraw();
    return;
  }
  if (tool.key?.(e)) return e.preventDefault();
  if (mod) return;
  const map: Record<string, string> = { v: "select", m: "wall", p: "door", n: "window" };
  if (map[k]) setTool(map[k]);
});
window.addEventListener("keyup", (e) => {
  if (e.key === " ") spaceDown = false;
});

document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool!)));
undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);
layerSelect.addEventListener("change", () => {
  layerSetId = layerSelect.value;
  layerSelect.blur();
});

// Guardar / abrir: el archivo es el modelo (entidades + relaciones). Nada de geometría.
$<HTMLButtonElement>("#save").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(store.snapshot(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "arken-modelo.json";
  a.click();
  URL.revokeObjectURL(a.href);
});
const fileInput = $<HTMLInputElement>("#file");
$<HTMLButtonElement>("#open").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  try {
    const model = JSON.parse(await f.text()) as BimModel;
    if (model.schemaVersion !== 1 || typeof model.entities !== "object" || typeof model.relations !== "object") {
      throw new Error("No es un modelo ARKEN válido.");
    }
    tool.cancel();
    store.load(model);
    say(`Abierto: ${f.name}`, true);
  } catch (err) {
    say(err instanceof Error ? err.message : String(err));
  }
  fileInput.value = "";
});

// ─── Arranque ───────────────────────────────────────────────
function resize(): void {
  renderer.resize();
  requestDraw();
}
new ResizeObserver(resize).observe(canvas);
refreshLayerSets();
refreshButtons();
setTool(toolName);
resize();

// Acceso desde la consola del navegador para explorar el modelo.
Object.assign(window, { arken: { store, engine, spatial, view } });
