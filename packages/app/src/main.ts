// ARKEN DISEÑO · aplicación de planta y planos (Paso 7).
//
// Flujo:
//   herramienta / panel ──comando──► BimStore ──ChangeEvent──► motor de geometría ──► índices espaciales
//                                                                                └──► vista (modelo o plano)
// La vista, los planos y los cuadros de cálculo solo LEEN el modelo; todo cambio pasa por el BimStore,
// así que todo se puede deshacer y las reglas de integridad se comprueban siempre.

import {
  BimStore,
  DISCIPLINES,
  DISCIPLINE_NAMES,
  PAPER_MM,
  createLevelElement,
  createWall,
  deleteElements,
  getOfKind,
  insertDoor,
  insertWindow,
  moveElements,
  putEntities,
  wallLength,
  wallThickness,
  type Annotation,
  type BimModel,
  type ChangeEvent,
  type Command,
  type CommitResult,
  type Device,
  type Discipline,
  type Entity,
  type Id,
  type InteractiveSession,
  type Level,
  type Project,
  type PropertyValue,
  type Run,
  type Sheet,
  type SwingSide,
  type Vec2,
  type Wall,
} from "@arken/core";
import { PlanGeometryEngine, RUN_STYLES, SYMBOLS, buildWallFrame, toLocal } from "@arken/geometry";
import { FINISHES, SPEC_FIELDS, buildLote01, checkSpec, defaultSpec, finishProps, generateHouse, type FinishLevel, type HouseSpec, type RoomType } from "@arken/projects";
import { showDesignAssistant } from "./assistant";
import { getProject, listProjects, putProject, summarize, type LibRecord } from "./library";
import { makeRecord, showLibrary } from "./libraryui";
import { LOGO_ARKEN_DISENO, allSheets, buildSheet, titleFields, titleLogo, type SheetGeometry } from "@arken/sheets";
import { SpatialIndexManager, type SnapResult } from "@arken/spatial";
import { calcReportHtml, type ReportChapter } from "@arken/calc";
import { canvasMeasure, download, modelDxf, sheetDxf, sheetPdfPage, sheetPng, sheetSvg } from "./export";
import { PdfDocument } from "./pdf";
import { Terrain, decodeSurvey, defaultPlacement, encodeSurvey, readSurvey, sampleSurveyDxf, type Placement } from "@arken/terrain";
import { TerrainView, houseFootprint, implantationSheet, siteEarthwork, surveyCsv, topoChapter, topoDxf, type Site } from "./topo";
import { safeName, zip, type ZipEntry } from "./zip";
import { onImageLoaded } from "./paint";
import { PlanRenderer } from "./renderer";
import { editableFilter, levelOfView, sheetOf, visibleGeoms, type ViewMode } from "./scene";
import { Viewport } from "./viewport";

const AUTOSAVE_KEY = "arken-diseno:autosave";

// ─── Núcleo ─────────────────────────────────────────────────
function initialModel(): { model: BimModel; restored: boolean } {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) {
      const m = JSON.parse(raw) as BimModel;
      if (m && m.schemaVersion === 1) return { model: m, restored: true };
    }
  } catch {
    /* sin almacenamiento local: se abre el proyecto de referencia */
  }
  return { model: buildLote01(), restored: false };
}
const init = initialModel();
const store = new BimStore(init.model);
const engine = new PlanGeometryEngine({ cutHeight: 1.2, scale: 50, textScale: planTextScale() });
const spatial = new SpatialIndexManager();
spatial.rebuildAll(engine.rebuildAll(store).updated);

/** Tamaño de los textos de los planos (cotas, nombres de espacios, rótulos de aparatos…), 50 % a 500 %. */
function planTextScale(): number {
  const p = [...store.entities()].find((e): e is Project => e.kind === "Project");
  return Math.min(5, Math.max(0.5, Number(p?.titleBlock?.["texto_planos"]) || 1));
}

const levels = (): Level[] => [...store.entities()].filter((e): e is Level => e.kind === "Level").sort((a, b) => a.elevation - b.elevation);
let mode: ViewMode = defaultMode();
let layerSetId: Id = [...store.entities()].find((e) => e.kind === "MaterialLayerSet")?.id ?? "";

function defaultMode(): ViewMode {
  const first = allSheets(store)[0];
  if (first) return { kind: "sheet", sheetId: first.id };
  return { kind: "model", levelId: levels()[0]?.id ?? "", disciplines: new Set(DISCIPLINES) };
}

// ─── Estado de la interfaz (NO es parte del modelo) ─────────
const selection = new Set<Id>();
let hovered: Id | undefined;
let snap: SnapResult | undefined;
let selectionRect: { a: Vec2; b: Vec2 } | undefined;
let sketch: Vec2[] | undefined;
const sheetCache = new Map<Id, SheetGeometry>();

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
const viewSelect = $<HTMLSelectElement>("#view");
const discEl = $<HTMLDivElement>("#disciplines");
const symbolSelect = $<HTMLSelectElement>("#symbol");
const systemSelect = $<HTMLSelectElement>("#system");
const panel = $<HTMLDivElement>("#panel");

// Marca ARKEN 360: logo de ARKEN DISEÑO en la barra y como icono de la pestaña (va dentro del código, sirve sin servidor).
$<HTMLImageElement>("#brand-logo").src = LOGO_ARKEN_DISENO;
{
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.head.appendChild(Object.assign(document.createElement("link"), { rel: "icon" }));
  icon.href = LOGO_ARKEN_DISENO;
}

const view = new Viewport();
const renderer = new PlanRenderer(canvas, view);

// ─── Reacción a los cambios del modelo ──────────────────────
let autosaveTimer: number | undefined;
store.subscribe((e: ChangeEvent) => {
  const ts = planTextScale();
  if (ts !== engine.options.textScale) {
    engine.options = { ...engine.options, textScale: ts };
    spatial.rebuildAll(engine.rebuildAll(store).updated);
  } else spatial.applyGeometryUpdate(engine.applyChange(store, e));
  sheetCache.clear();
  for (const id of e.removed) selection.delete(id);
  if (hovered && !store.getEntity(hovered)) hovered = undefined;
  if (e.reset) {
    selection.clear();
    if (!validMode()) mode = defaultMode();
    refreshLayerSets();
  }
  refreshViews();
  refreshButtons();
  renderPanel();
  requestDraw();
  window.clearTimeout(autosaveTimer);
  savedEl.classList.add("busy");
  savedEl.textContent = "Guardando";
  autosaveTimer = window.setTimeout(autosave, 700);
});

const savedEl = $<HTMLSpanElement>("#saved");
function autosave(): void {
  let ok = true;
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(store.snapshot()));
  } catch {
    ok = false; /* almacenamiento lleno o bloqueado: el usuario puede guardar el JSON */
  }
  savedEl.classList.remove("busy");
  savedEl.textContent = ok ? "Guardado en el equipo" : "Use «Guardar»";
}

function validMode(): boolean {
  return mode.kind === "sheet" ? !!getOfKind(store, mode.sheetId, "Sheet") : !!getOfKind(store, mode.levelId, "Level");
}

const currentLevel = () => levelOfView(store, mode);
const currentSheet = () => sheetOf(store, mode);

function sheetGeometry(s: Sheet): SheetGeometry {
  let g = sheetCache.get(s.id);
  if (!g) sheetCache.set(s.id, (g = buildSheet(store, s)));
  return g;
}

let drawPending = false;
function requestDraw(): void {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => {
    drawPending = false;
    const s = currentSheet();
    const items = visibleGeoms(store, engine.all(), mode);
    renderer.draw(store, items, s?.scale ?? 50, { selected: selection, hovered, snap, selectionRect, sketch }, s ? sheetGeometry(s) : undefined);
  });
}

onImageLoaded(() => requestDraw());

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
  const isSheet = mode.kind === "sheet";
  document.querySelectorAll<HTMLButtonElement>("[data-export]").forEach((b) => (b.disabled = !isSheet));
  discEl.hidden = isSheet;
}

function refreshLayerSets(): void {
  layerSelect.innerHTML = "";
  for (const e of store.entities()) {
    if (e.kind !== "MaterialLayerSet") continue;
    const t = e.layers.reduce((s, l) => s + l.thickness, 0);
    layerSelect.add(new Option(`${e.name ?? "Receta"} (${Math.round(t * 1000)} mm)`, e.id));
  }
  if (!getOfKind(store, layerSetId, "MaterialLayerSet")) layerSetId = layerSelect.options[0]?.value ?? layerSetId;
  layerSelect.value = layerSetId;
}

function modeKey(m: ViewMode): string {
  return m.kind === "sheet" ? `s:${m.sheetId}` : `l:${m.levelId}`;
}

function refreshViews(): void {
  const key = modeKey(mode);
  viewSelect.innerHTML = "";
  const g1 = document.createElement("optgroup");
  g1.label = "Planos";
  for (const s of allSheets(store)) g1.append(new Option(`${s.number} · ${s.title}`, `s:${s.id}`));
  const g2 = document.createElement("optgroup");
  g2.label = "Modelo (todas las disciplinas)";
  for (const l of levels()) g2.append(new Option(`${l.name ?? "Nivel"} (N+${l.elevation.toFixed(2)})`, `l:${l.id}`));
  if (g1.children.length) viewSelect.append(g1);
  viewSelect.append(g2);
  viewSelect.value = key;
  refreshChrome();
}

// ─── Apariencia ARKEN: menú lateral de planos, cinta de resumen y proyecto activo ───
function railItem(key: string, n: string, t: string, active: boolean): string {
  return `<button class="nav-item${active ? " active" : ""}" data-view="${escHtml(key)}" title="${escHtml(`${n} · ${t}`)}"><span class="nav-n">${escHtml(n)}</span><span class="nav-t">${escHtml(t)}</span></button>`;
}
function escHtml(t: string): string {
  return t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
function refreshChrome(): void {
  const railSheets = $<HTMLDivElement>("#rail-sheets");
  const railLevels = $<HTMLDivElement>("#rail-levels");
  const key = modeKey(mode);
  const sheets = allSheets(store);
  const lv = levels();
  railSheets.innerHTML = sheets.map((sh) => railItem(`s:${sh.id}`, sh.number, sh.title, key === `s:${sh.id}`)).join("") || `<span class="muted small" style="padding:4px 10px">Sin planos</span>`;
  railLevels.innerHTML = lv.map((l, i) => railItem(`l:${l.id}`, String(i).padStart(2, "0"), l.name ?? "Nivel", key === `l:${l.id}`)).join("");
  railSheets.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  const pr = projectEntity();
  const label = projectLabel();
  $<HTMLSpanElement>("#proj-name").textContent = label === "PROYECTO" ? "— sin proyecto —" : label;
  let area = Number(pr?.properties?.["area_construida_m2"]) || 0;
  if (!area) area = lv.reduce((t, l) => t + (Number(l.properties?.["area_construida_m2"]) || 0), 0);
  const floors = lv.filter((l) => !/cubierta/i.test(l.name ?? "")).length;
  let spaces = 0;
  let elems = 0;
  for (const e of store.entities()) {
    if (e.kind === "Space") spaces++;
    if (e.kind !== "Project" && e.kind !== "Level" && e.kind !== "Sheet") elems++;
  }
  const cur = mode.kind === "sheet" ? sheets.find((x) => x.id === (mode as { sheetId: string }).sheetId) : undefined;
  const curL = mode.kind === "model" ? lv.find((l) => l.id === (mode as { levelId: string }).levelId) : undefined;
  const cell = (lab: string, val: string, sub = "", cls = "") => `<div class="ledger-cell ${cls}"><span class="lab">${lab}</span><span class="val">${escHtml(val)}</span>${sub ? `<span class="sub">${escHtml(sub)}</span>` : ""}</div>`;
  $<HTMLDivElement>("#ledger").innerHTML =
    cell("Planos", String(sheets.length), "juego completo") +
    cell("Pisos", String(floors), floors === 1 ? "un nivel" : `${floors} niveles`) +
    cell("Área construida", area ? `${area.toLocaleString("es-CO", { maximumFractionDigits: 1 })} m²` : "—") +
    cell("Espacios", String(spaces)) +
    cell("Elementos BIM", elems.toLocaleString("es-CO")) +
    cell(cur ? "Plano activo" : "Vista del modelo", cur ? `${cur.number} · ${cur.title}` : curL ? `${curL.name ?? "Nivel"} · todas las disciplinas` : "—", "", "total");
}
document.querySelector(".rail")!.addEventListener("click", (ev) => {
  const k = (ev.target as HTMLElement).closest<HTMLElement>("[data-view]")?.dataset.view;
  if (!k || k === modeKey(mode)) return;
  viewSelect.value = k;
  viewSelect.dispatchEvent(new Event("change"));
});

function refreshDisciplines(): void {
  discEl.innerHTML = "";
  if (mode.kind !== "model") return;
  const on = mode.disciplines;
  for (const d of DISCIPLINES) {
    const b = document.createElement("button");
    b.textContent = d;
    b.title = DISCIPLINE_NAMES[d];
    b.className = `chip d-${d}`;
    b.setAttribute("aria-pressed", String(on.has(d)));
    b.addEventListener("click", () => {
      if (mode.kind !== "model") return;
      const next = new Set(mode.disciplines);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      mode = { ...mode, disciplines: next };
      refreshDisciplines();
      requestDraw();
    });
    discEl.append(b);
  }
}

function setMode(m: ViewMode, fit = true): void {
  tool.cancel();
  mode = m;
  selection.clear();
  hovered = undefined;
  refreshViews();
  refreshDisciplines();
  refreshButtons();
  renderPanel();
  if (fit) fitView();
  requestDraw();
}

function fitView(): void {
  const s = currentSheet();
  let box: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
  if (s) box = sheetGeometry(s).paper;
  else {
    const lv = currentLevel();
    for (const g of engine.all()) {
      if (g.levelId !== lv) continue;
      const b = g.box;
      box = box ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) } : { ...b };
    }
  }
  if (!box || view.width < 10) return;
  const pad = 24;
  view.scale = Math.min((view.width - 2 * pad) / Math.max(box.maxX - box.minX, 1), (view.height - 2 * pad) / Math.max(box.maxY - box.minY, 1));
  view.center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  requestDraw();
}

const tolerance = (px: number) => px * view.metersPerPixel;
const accept = () => editableFilter(store, mode);

function snapAt(world: Vec2, exclude?: ReadonlySet<Id>): SnapResult {
  return spatial.snap(currentLevel(), world, tolerance(SNAP_PX), { grid: GRID, accept: accept(), ...(exclude ? { exclude } : {}) })!;
}

/** Disciplina en la que se crean los elementos nuevos: la primera del plano activo. */
function workDiscipline(fallback: Discipline = "ARQ"): Discipline {
  const s = currentSheet();
  if (s) return s.disciplines[0] ?? fallback;
  return fallback;
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
  dbl?(p: PointerInfo): void;
  cancel(): void;
  key?(e: KeyboardEvent): boolean;
}

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
    const cmd = createWall({ levelId: currentLevel(), layerSetId, start: this.start, end });
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
  readonly hint = "Seleccionar: clic (Mayús suma). Arrastra para mover. Arrastre en vacío: izq.→der. = ventana, der.→izq. = captura. Supr = borrar. Edita en el panel derecho.";
  private downAt: Vec2 | undefined;
  private anchor: Vec2 | undefined;
  private moving: Id[] = [];
  private session: InteractiveSession | undefined;
  private rect = false;

  down(p: PointerInfo): void {
    this.downAt = p.world;
    const hit = spatial.pick(currentLevel(), p.world, tolerance(PICK_PX), undefined, accept())[0];
    if (hit) {
      if (p.shift) {
        if (selection.has(hit.elementId)) selection.delete(hit.elementId);
        else selection.add(hit.elementId);
      } else if (!selection.has(hit.elementId)) {
        selection.clear();
        selection.add(hit.elementId);
      }
      this.moving = [...selection].filter((id) => {
        const k = store.getEntity(id)?.kind;
        return k !== "Door" && k !== "Window";
      });
      this.anchor = snapAt(p.world, new Set(this.moving)).point;
    } else {
      if (!p.shift) selection.clear();
      this.rect = true;
      selectionRect = { a: p.world, b: p.world };
    }
    describeSelection();
    renderPanel();
    requestDraw();
  }

  move(p: PointerInfo): void {
    if (this.rect && selectionRect) {
      selectionRect = { a: selectionRect.a, b: p.world };
    } else if (this.anchor && this.downAt && this.moving.length > 0) {
      const dragged = Math.hypot(p.world.x - this.downAt.x, p.world.y - this.downAt.y) > tolerance(3);
      if (dragged) {
        this.session ??= store.beginInteractive(this.moving.length === 1 ? "Mover" : "Mover elementos");
        snap = snapAt(p.world, new Set(this.moving));
        let to = snap.point;
        if (p.shift) to = ortho(this.anchor, to);
        this.session.update(moveElements(this.moving, { x: to.x - this.anchor.x, y: to.y - this.anchor.y }));
      }
    } else {
      const top = spatial.pick(currentLevel(), p.world, tolerance(PICK_PX), undefined, accept())[0]?.elementId;
      if (top !== hovered) hovered = top;
      snap = undefined;
    }
    requestDraw();
  }

  up(): void {
    if (this.session) {
      const r = this.session.commit();
      if (!report(r, "Movido.")) this.session.cancel();
      this.session = undefined;
    }
    if (this.rect && selectionRect) {
      const { a, b } = selectionRect;
      const box = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
      if (box.maxX - box.minX > tolerance(3) || box.maxY - box.minY > tolerance(3)) {
        for (const id of spatial.boxSelect(currentLevel(), box, b.x >= a.x ? "window" : "crossing", accept())) selection.add(id);
      }
      describeSelection();
      renderPanel();
    }
    this.rect = false;
    selectionRect = undefined;
    this.anchor = this.downAt = undefined;
    this.moving = [];
    snap = undefined;
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
      renderPanel();
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
        ? "Puerta: pasa sobre un muro y haz clic. El lado del cursor decide hacia dónde abre. F = cambiar bisagra."
        : "Ventana: pasa sobre un muro y haz clic. Ancho, alto y antepecho se editan luego en el panel.";
  }

  private get width(): number {
    return this.kind === "door" ? 0.9 : 1.2;
  }

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
      const hit = spatial.pick(currentLevel(), p.world, tolerance(PICK_PX)).find((h) => store.getEntity(h.elementId)?.kind === "Wall");
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
      this.move(p);
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

const DEFAULT_HEIGHT: Partial<Record<Discipline, number>> = { ELE: 0.3, ILU: 2.8, DOM: 1.2, HID: 0.5, SAN: 0, GAS: 0.5, SOL: 1.5 };

class DeviceTool implements Tool {
  readonly hint = "Equipo: elige el símbolo en la lista y haz clic para colocarlo. R = girar 90°. El circuito y demás datos se editan en el panel.";
  private session: InteractiveSession | undefined;
  private rot = 0;
  private last: Vec2 | undefined;

  private cmd(at: Vec2) {
    const def = SYMBOLS.get(symbolSelect.value);
    const disc = def?.discipline ?? "ELE";
    return createLevelElement<Device>(currentLevel(), {
      kind: "Device",
      discipline: disc,
      symbol: symbolSelect.value,
      position: at,
      rotation: this.rot,
      mountingHeight: DEFAULT_HEIGHT[disc] ?? 0,
      properties: {},
      name: def?.name ?? symbolSelect.value,
    });
  }

  move(p: PointerInfo): void {
    snap = snapAt(p.world);
    this.last = snap.point;
    this.session ??= store.beginInteractive("Insertar equipo");
    this.session.update(this.cmd(snap.point));
    requestDraw();
  }

  down(p: PointerInfo): void {
    this.move(p);
    const c = this.cmd(this.last!);
    this.session!.update(c);
    if (report(this.session!.commit(), "Equipo insertado. Edita su circuito y datos en el panel.")) {
      this.session = undefined;
      selection.clear();
      selection.add(c.elementId);
      renderPanel();
    }
  }

  up(): void {}

  cancel(): void {
    this.session?.cancel();
    this.session = undefined;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key.toLowerCase() === "r") {
      this.rot = (this.rot + Math.PI / 2) % (2 * Math.PI);
      if (lastPointer) this.move(lastPointer);
      return true;
    }
    return false;
  }
}

const SYSTEM_DISCIPLINE: Record<string, Discipline> = { CIR: "ELE", ACO: "ELE", BUS: "DOM", DAT: "DOM", PRI: "HID", AF: "HID", AC: "HID", RC: "HID", AN: "SAN", AV: "SAN", ALL: "SAN", CANAL: "SAN", GAS: "GAS", DC: "SOL", ACS: "SOL" };

class RunTool implements Tool {
  readonly hint = "Recorrido: elige el sistema, clic en cada vértice (Mayús = ortogonal). Doble clic o Intro = terminar. Esc = cancelar.";
  private pts: Vec2[] = [];

  private target(p: PointerInfo): Vec2 {
    snap = snapAt(p.world);
    let pt = snap.point;
    const prev = this.pts[this.pts.length - 1];
    if (prev && p.shift) pt = ortho(prev, pt);
    return pt;
  }

  move(p: PointerInfo): void {
    const pt = this.target(p);
    sketch = this.pts.length ? [...this.pts, pt] : undefined;
    requestDraw();
  }

  down(p: PointerInfo): void {
    const pt = this.target(p);
    const prev = this.pts[this.pts.length - 1];
    if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) > 1e-6) this.pts.push(pt);
  }

  dbl(): void {
    this.finish();
  }

  private finish(): void {
    if (this.pts.length >= 2) {
      const sys = systemSelect.value;
      const sheetDisc = currentSheet()?.disciplines;
      let disc = SYSTEM_DISCIPLINE[sys] ?? "ELE";
      if (sys === "CIR" && sheetDisc?.includes("ILU")) disc = "ILU";
      const c = createLevelElement<Run>(currentLevel(), { kind: "Run", discipline: disc, system: sys, points: this.pts, properties: {}, tag: "" });
      if (report(store.run(c), "Recorrido trazado. Ponle circuito, tramo o diámetro en el panel.")) {
        selection.clear();
        selection.add(c.elementId);
        renderPanel();
      }
    }
    this.cancel();
    requestDraw();
  }

  up(): void {}

  cancel(): void {
    this.pts = [];
    sketch = undefined;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === "Enter") {
      this.finish();
      return true;
    }
    return false;
  }
}

class TextTool implements Tool {
  readonly hint = "Texto: clic donde va la nota. Escribe el texto en el panel derecho.";
  move(p: PointerInfo): void {
    snap = snapAt(p.world);
    requestDraw();
  }
  down(p: PointerInfo): void {
    const at = snapAt(p.world).point;
    const c = createLevelElement<Annotation>(currentLevel(), { kind: "Annotation", discipline: workDiscipline(), style: "text", points: [at], text: "NOTA", textSize: 2.5, properties: {} });
    if (report(store.run(c), "Texto creado.")) {
      selection.clear();
      selection.add(c.elementId);
      renderPanel();
      (panel.querySelector('[data-field="text"]') as HTMLInputElement | null)?.select();
    }
  }
  up(): void {}
  cancel(): void {}
}

class DimTool implements Tool {
  readonly hint = "Cota: clic en el primer punto y en el segundo (Mayús = ortogonal). El desfase se edita en el panel.";
  private a: Vec2 | undefined;
  private target(p: PointerInfo): Vec2 {
    snap = snapAt(p.world);
    return this.a && p.shift ? ortho(this.a, snap.point) : snap.point;
  }
  move(p: PointerInfo): void {
    const pt = this.target(p);
    sketch = this.a ? [this.a, pt] : undefined;
    requestDraw();
  }
  down(p: PointerInfo): void {
    const pt = this.target(p);
    if (!this.a) return void (this.a = pt);
    if (Math.hypot(pt.x - this.a.x, pt.y - this.a.y) > 1e-3) {
      report(store.run(createLevelElement<Annotation>(currentLevel(), { kind: "Annotation", discipline: workDiscipline(), style: "dimension", points: [this.a, pt], properties: { offset: 0 } })), "Cota creada.");
    }
    this.cancel();
  }
  up(): void {}
  cancel(): void {
    this.a = undefined;
    sketch = undefined;
  }
}

const tools: Record<string, Tool> = {
  select: new SelectTool(),
  wall: new WallTool(),
  door: new OpeningTool("door"),
  window: new OpeningTool("window"),
  device: new DeviceTool(),
  run: new RunTool(),
  text: new TextTool(),
  dim: new DimTool(),
};
let toolName = "select";
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
  symbolSelect.hidden = name !== "device";
  systemSelect.hidden = name !== "run";
  layerSelect.parentElement!.hidden = name !== "wall";
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
    say(`Muro · ${wallLength(e).toFixed(2)} m · espesor ${(wallThickness(store, id) * 1000).toFixed(0)} mm (${set?.name ?? "sin receta"}) · altura ${e.height.toFixed(2)} m`, true);
  } else say(`${KIND_NAMES[e.kind] ?? e.kind}${e.name ? " · " + e.name : ""}`, true);
}

// ─── Panel de propiedades y rótulo ──────────────────────────
const KIND_NAMES: Record<string, string> = {
  Wall: "Muro", Door: "Puerta", Window: "Ventana", Space: "Espacio", Device: "Equipo / salida", Run: "Recorrido", Annotation: "Anotación", Sheet: "Plano", Project: "Proyecto",
};
const TITLE_FIELDS: [string, string][] = [
  ["empresa", "Empresa"], ["lema", "Lema"], ["empresa_contacto", "Contacto"], ["empresa_web", "Web"], ["proyecto", "Proyecto"], ["localizacion", "Localización"],
  ["propietario", "Propietario"], ["diseno", "Diseño"], ["matricula", "Matrícula profesional"], ["dibujo", "Dibujó"], ["reviso", "Revisó"], ["aprobo", "Aprobó"],
  ["escala", "Escala"], ["fecha", "Fecha"], ["revision", "Revisión"], ["archivo", "Archivo"],
];

function esc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function put(e: Entity, label: string): void {
  report(store.run(putEntities([e], label)), "Cambio aplicado.");
}

function field(label: string, name: string, value: string | number, type = "text", attrs = ""): string {
  return `<label class="f"><span>${esc(label)}</span><input data-field="${name}" type="${type}" value="${esc(String(value))}" ${attrs}></label>`;
}

function renderPanel(): void {
  if (panel.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement) return;
  if (selection.size === 1) return renderEntityPanel(store.getEntity([...selection][0]!));
  if (selection.size > 1) {
    panel.innerHTML = `<h2>${selection.size} elementos</h2><p class="muted">Arrástralos para moverlos juntos o pulsa Supr para borrarlos.</p>`;
    return;
  }
  renderTitlePanel();
}

function renderTitlePanel(): void {
  const project = [...store.entities()].find((e): e is Project => e.kind === "Project");
  const s = currentSheet();
  const tb = project?.titleBlock ?? {};
  let html = `<h2>Rótulo del proyecto</h2><p class="muted">Vale para todos los planos. Cada plano puede cambiar un campo abajo.</p><div class="fields" data-scope="project">`;
  const esc0 = Number(tb["rotulo_escala"]) || 1;
  html += `<label class="f"><span>Tamaño del rótulo</span><span class="range"><input data-field="rotulo_escala" type="range" min="0.8" max="1.6" step="0.05" value="${esc0}"><b>${Math.round(esc0 * 100)} %</b></span></label>`;
  const tx0 = Number(tb["rotulo_texto"]) || 1;
  html += `<label class="f"><span>Texto del rótulo y notas</span><span class="range"><input data-field="rotulo_texto" type="range" min="0.7" max="5" step="0.1" value="${tx0}"><b>${Math.round(tx0 * 100)} %</b></span></label>`;
  const tp0 = Number(tb["texto_planos"]) || 1;
  html += `<label class="f"><span>Texto de los planos</span><span class="range"><input data-field="texto_planos" type="range" min="0.5" max="5" step="0.1" value="${tp0}"><b>${Math.round(tp0 * 100)} %</b></span></label>`;
  const logo = (tb["logo"] ?? "").trim();
  const logoName = logo.toLowerCase() === "ninguno" ? "Sin logo" : logo.startsWith("data:image/") ? "Logo propio" : "ARKEN DISEÑO";
  html += `<div class="f"><span>Logo (${logoName})</span><span class="logo-btns"><button type="button" data-logo="subir">Subir…</button><button type="button" data-logo="arken">ARKEN</button><button type="button" data-logo="ninguno">Quitar</button></span></div>`;
  for (const [k, l] of TITLE_FIELDS) if (k !== "escala") html += field(l, k, tb[k] ?? "");
  html += `</div>`;
  if (s) {
    const tf = titleFields(store, s);
    html += `<h2>Plano ${esc(s.number)}</h2><div class="fields" data-scope="sheet">`;
    html += field("Número", "@number", s.number) + field("Título (contenido)", "@title", s.title);
    html += `<label class="f"><span>Papel</span><select data-field="@paper">${(Object.keys(PAPER_MM) as (keyof typeof PAPER_MM)[]).map((p) => `<option ${p === s.paper ? "selected" : ""}>${p}</option>`).join("")}</select></label>`;
    for (const [k, l] of TITLE_FIELDS) html += field(l, k, s.fields[k] ?? "", "text", `placeholder="${esc(tf[k] ?? "")}"`);
    html += `</div><p class="muted">Un campo vacío usa el valor del proyecto.</p>`;
  }
  panel.innerHTML = html;
  const putTb = (patch: Record<string, string>, label: string) => {
    if (!project) return;
    const titleBlock: Record<string, string> = { ...(project.titleBlock ?? {}), ...patch };
    for (const [k, v] of Object.entries(patch)) if (!v) delete titleBlock[k];
    put({ ...project, titleBlock }, label);
  };
  panel.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((range) =>
    range.addEventListener("input", () => (range.nextElementSibling!.textContent = `${Math.round(Number(range.value) * 100)} %`)),
  );
  panel.querySelectorAll<HTMLButtonElement>("[data-logo]").forEach((b) =>
    b.addEventListener("click", () => {
      const v = b.dataset.logo!;
      if (v === "arken") return putTb({ logo: "", logo_aspecto: "" }, "Logo ARKEN DISEÑO en el rótulo");
      if (v === "ninguno") return putTb({ logo: "ninguno", logo_aspecto: "" }, "Quitar logo del rótulo");
      logoInput.click();
    }),
  );
  logoUpload = (dataUrl, aspect) => putTb({ logo: dataUrl, logo_aspecto: aspect.toFixed(4) }, "Logo propio en el rótulo");
  panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const scope = inp.closest<HTMLElement>("[data-scope]")?.dataset.scope;
      const key = inp.dataset.field!;
      if (scope === "project" && project) put({ ...project, titleBlock: { ...(project.titleBlock ?? {}), [key]: inp.value } }, "Editar rótulo");
      else if (scope === "sheet" && s) {
        if (key === "@number") put({ ...s, number: inp.value }, "Editar plano");
        else if (key === "@title") put({ ...s, title: inp.value }, "Editar plano");
        else if (key === "@paper") put({ ...s, paper: inp.value as Sheet["paper"] }, "Editar plano");
        else {
          const fields = { ...s.fields };
          if (inp.value.trim()) fields[key] = inp.value;
          else delete fields[key];
          put({ ...s, fields }, "Editar rótulo del plano");
        }
      }
    }),
  );
}

// Logo propio para el rótulo: se reduce a 400 px de alto y se guarda dentro del modelo (data URL).
let logoUpload: ((dataUrl: string, aspect: number) => void) | undefined;
const logoInput = document.createElement("input");
logoInput.type = "file";
logoInput.accept = "image/png,image/jpeg,image/svg+xml,image/webp";
logoInput.addEventListener("change", async () => {
  const f = logoInput.files?.[0];
  logoInput.value = "";
  if (!f) return;
  try {
    const url = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(new Error("No se pudo leer la imagen."));
      r.readAsDataURL(f);
    });
    const img = new Image();
    await new Promise<void>((res, rej) => ((img.onload = () => res()), (img.onerror = () => rej(new Error("La imagen no es válida."))), (img.src = url)));
    const h = Math.min(400, img.naturalHeight || 400);
    const w = Math.max(1, Math.round(((img.naturalWidth || 400) / (img.naturalHeight || 400)) * h));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    logoUpload?.(c.toDataURL("image/png"), w / h);
  } catch (err) {
    say(err instanceof Error ? err.message : String(err));
  }
});

function renderEntityPanel(e: Entity | undefined): void {
  if (!e) return void (panel.innerHTML = "");
  let html = `<h2>${esc(KIND_NAMES[e.kind] ?? e.kind)}</h2>`;
  if ("discipline" in e) html += `<p class="muted">${esc(DISCIPLINE_NAMES[e.discipline])}</p>`;
  html += `<div class="fields">`;
  html += field("Nombre", "name", e.name ?? "");
  switch (e.kind) {
    case "Wall":
      html += field("Altura (m)", "height", e.height, "number", 'step="0.05"');
      break;
    case "Door":
      html += field("Ancho hoja (m)", "leafWidth", e.leafWidth, "number", 'step="0.05"') + field("Alto hoja (m)", "leafHeight", e.leafHeight, "number", 'step="0.05"');
      break;
    case "Window":
      html += field("Ancho (m)", "frameWidth", e.frameWidth, "number", 'step="0.05"') + field("Alto (m)", "frameHeight", e.frameHeight, "number", 'step="0.05"');
      break;
    case "Space": {
      html += field("Número", "number", e.number);
      // Acabados: se eligen de la biblioteca (alto, lujo, premium) o se escriben.
      const pp = e.properties ?? {};
      const tipo = typeof pp["tipo_espacio"] === "string" ? (pp["tipo_espacio"] as RoomType) : undefined;
      html += `</div><h3>Acabados</h3><div class="fields">`;
      if (tipo && FINISHES.lujo[tipo]) html += `<label class="f"><span>Paquete de acabados</span><select id="finpack"><option value="">Elegir…</option><option value="alto">Alto</option><option value="lujo">Lujo</option><option value="premium">Premium</option></select></label>`;
      for (const [k, label] of FIN_FIELDS) {
        const opts = [...new Set(Object.values(FINISHES).flatMap((t) => Object.values(t).map((f) => String(f[FIN_KEY[k]!]))))].filter((x) => x && x !== "—");
        html += `<label class="f"><span>${label}</span><input data-prop="${k}" data-type="text" list="dl-${k}" value="${esc(String(pp[k] ?? ""))}"><datalist id="dl-${k}">${opts.map((o) => `<option value="${esc(o)}">`).join("")}</datalist></label>`;
      }
      break;
    }
    case "Device": {
      const opts = [...SYMBOLS.values()].filter((d) => d.discipline === e.discipline).map((d) => `<option value="${d.key}" ${d.key === e.symbol ? "selected" : ""}>${esc(d.name)}</option>`).join("");
      html += `<label class="f"><span>Símbolo</span><select data-field="symbol">${opts}</select></label>`;
      html += field("Rótulo / tag", "tag", e.tag ?? "") + field("Altura de montaje (m)", "mountingHeight", e.mountingHeight, "number", 'step="0.05"') + field("Giro (°)", "rotationDeg", Math.round((e.rotation * 180) / Math.PI), "number", 'step="15"');
      break;
    }
    case "Run": {
      const opts = Object.entries(RUN_STYLES).map(([k, s]) => `<option value="${k}" ${k === e.system ? "selected" : ""}>${k} · ${esc(s.name)}</option>`).join("");
      html += `<label class="f"><span>Sistema</span><select data-field="system">${opts}</select></label>` + field("Rótulo", "tag", e.tag ?? "");
      break;
    }
    case "Annotation":
      if (e.text !== undefined || e.style === "text" || e.style === "arrow" || e.style === "axis") html += field("Texto", "text", e.text ?? "");
      if (e.style === "text") html += field("Altura de texto (mm papel)", "textSize", e.textSize ?? 2.5, "number", 'step="0.1"');
      break;
  }
  html += `</div><h3>Propiedades</h3><div class="props">`;
  const props = e.properties ?? {};
  for (const [k, val] of Object.entries(props)) {
    const t = typeof val === "number" ? "number" : typeof val === "boolean" ? "checkbox" : "text";
    html += `<label class="f prop"><span>${esc(k)}</span><input data-prop="${esc(k)}" data-type="${t}" type="${t}" ${t === "checkbox" ? (val ? "checked" : "") : `value="${esc(String(val))}"`} ${t === "number" ? 'step="any"' : ""}><button class="del" data-del="${esc(k)}" title="Quitar">×</button></label>`;
  }
  html += `</div><div class="addprop"><input id="newkey" placeholder="propiedad (p. ej. circuito)"><input id="newval" placeholder="valor"><button id="addprop">Añadir</button></div>`;
  if (e.kind === "Device" || e.kind === "Run") html += `<p class="muted">Las salidas y recorridos se asocian a un circuito con <b>circuito</b> y <b>tablero</b>; la carga se toma de <b>va</b> o <b>w</b>. Los cuadros de cálculo se actualizan solos.</p>`;
  panel.innerHTML = html;

  const apply = (patch: Record<string, unknown>, label = "Editar propiedades") => put({ ...e, ...patch } as Entity, label);
  panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const k = inp.dataset.field!;
      const num = Number(inp.value);
      if (k === "rotationDeg") return apply({ rotation: (num * Math.PI) / 180 });
      if (inp instanceof HTMLInputElement && inp.type === "number") {
        if (!Number.isFinite(num)) return say("Valor numérico no válido.");
        return apply({ [k]: num });
      }
      apply({ [k]: inp.value });
    }),
  );
  panel.querySelectorAll<HTMLInputElement>("[data-prop]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const k = inp.dataset.prop!;
      const t = inp.dataset.type;
      const v: PropertyValue = t === "checkbox" ? inp.checked : t === "number" ? Number(inp.value) : inp.value;
      apply({ properties: { ...props, [k]: v } });
    }),
  );
  panel.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      const next = { ...props };
      delete next[b.dataset.del!];
      apply({ properties: next });
    }),
  );
  panel.querySelector<HTMLSelectElement>("#finpack")?.addEventListener("change", (ev) => {
    const lvl = (ev.target as HTMLSelectElement).value as FinishLevel;
    const tipo = props["tipo_espacio"] as RoomType;
    if (!lvl || !tipo) return;
    const fin = finishProps(lvl, tipo, typeof props["altura_cielo_m"] === "number" ? (props["altura_cielo_m"] as number) : 2.7);
    apply({ properties: { ...props, ...fin } }, `Acabados ${lvl} en ${e.kind === "Space" ? e.name : ""}`);
  });
  panel.querySelector<HTMLButtonElement>("#addprop")?.addEventListener("click", () => {
    const k = (panel.querySelector("#newkey") as HTMLInputElement).value.trim();
    const raw = (panel.querySelector("#newval") as HTMLInputElement).value.trim();
    if (!k) return say("Escribe el nombre de la propiedad.");
    const v: PropertyValue = raw === "true" ? true : raw === "false" ? false : raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
    apply({ properties: { ...props, [k]: v } });
  });
}

// ─── Eventos de puntero ─────────────────────────────────────
let lastPointer: PointerInfo | undefined;
let panning: { x: number; y: number } | undefined;
let spaceDown = false;

function pointerInfo(e: PointerEvent | MouseEvent): PointerInfo {
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
canvas.addEventListener("dblclick", (e) => tool.dbl?.(pointerInfo(e)));
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
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
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
    renderPanel();
    requestDraw();
    return;
  }
  if (e.key === "Home") return fitView();
  if (tool.key?.(e)) return e.preventDefault();
  if (mod) return;
  const map: Record<string, string> = { v: "select", m: "wall", p: "door", n: "window", e: "device", r: "run", t: "text", c: "dim" };
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
viewSelect.addEventListener("change", () => {
  const v = viewSelect.value;
  if (v.startsWith("s:")) setMode({ kind: "sheet", sheetId: v.slice(2) });
  else setMode({ kind: "model", levelId: v.slice(2), disciplines: mode.kind === "model" ? mode.disciplines : new Set(DISCIPLINES) });
  viewSelect.blur();
});
$<HTMLButtonElement>("#fit").addEventListener("click", fitView);

function fillPalettes(): void {
  symbolSelect.innerHTML = "";
  for (const d of DISCIPLINES) {
    const g = document.createElement("optgroup");
    g.label = DISCIPLINE_NAMES[d];
    for (const s of SYMBOLS.values()) if (s.discipline === d) g.append(new Option(s.name, s.key));
    if (g.children.length) symbolSelect.append(g);
  }
  symbolSelect.value = "toma";
  systemSelect.innerHTML = "";
  for (const [k, s] of Object.entries(RUN_STYLES)) systemSelect.append(new Option(`${k} · ${s.name}`, k));
}

// Proyecto: guardar / abrir JSON, cargar el proyecto de referencia, empezar de cero.
$<HTMLButtonElement>("#save").addEventListener("click", () => {
  download(`${arkenName("MODELO BIM")}.arken.json`, JSON.stringify(store.snapshot(), null, 2), "application/json").then(
    () => say("Modelo guardado.", true),
    (err: unknown) => say(err instanceof Error ? err.message : String(err)),
  );
});
const fileInput = $<HTMLInputElement>("#file");
$<HTMLButtonElement>("#open").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  try {
    const model = JSON.parse(await f.text()) as BimModel;
    if (model.schemaVersion !== 1 || typeof model.entities !== "object" || typeof model.relations !== "object") throw new Error("No es un modelo ARKEN válido.");
    loadModel(model, `Abierto: ${f.name}. Quedó guardado en la biblioteca.`, { origen: "Importado de archivo" });
  } catch (err) {
    say(err instanceof Error ? err.message : String(err));
  }
  fileInput.value = "";
});
// ─── Biblioteca de proyectos ────────────────────────────────
const LIB_CURRENT_KEY = "arken-diseno:biblioteca-actual";
const LIB_SEED_KEY = "arken-diseno:biblioteca-semilla";
let libCurrent: string | undefined;
try {
  libCurrent = localStorage.getItem(LIB_CURRENT_KEY) ?? undefined;
} catch {
  /* sin almacenamiento */
}
if (!init.restored) libCurrent = undefined;
function setLibCurrent(id: string | undefined): void {
  libCurrent = id;
  try {
    if (id) localStorage.setItem(LIB_CURRENT_KEY, id);
    else localStorage.removeItem(LIB_CURRENT_KEY);
  } catch {
    /* sin almacenamiento */
  }
}
/** Miniatura de la planta arquitectónica del primer piso, dibujada con el mismo motor de los planos. */
function thumbnail(model: BimModel): string {
  try {
    const st = new BimStore(model);
    const eng = new PlanGeometryEngine({ cutHeight: 1.2, scale: 100, textScale: 1 });
    eng.rebuildAll(st);
    const lv = [...st.entities()].filter((e): e is Level => e.kind === "Level" && !/cubierta/i.test(e.name ?? "")).sort((a, b) => a.elevation - b.elevation)[0];
    if (!lv) return "";
    const m: ViewMode = { kind: "model", levelId: lv.id, disciplines: new Set<Discipline>(["ARQ"]) };
    const items = visibleGeoms(st, eng.all(), m).filter((v) => v.geom.kind !== "Annotation");
    let box: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
    for (const v of items) {
      const b = v.geom.box;
      box = box ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) } : { ...b };
    }
    if (!box) return "";
    const W = 640;
    const H = 440;
    const dpr = window.devicePixelRatio || 1;
    const c = document.createElement("canvas");
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const vp = new Viewport();
    vp.width = W;
    vp.height = H;
    const pad = 28;
    vp.scale = Math.min((W - 2 * pad) / Math.max(box.maxX - box.minX, 1), (H - 2 * pad) / Math.max(box.maxY - box.minY, 1));
    vp.center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    new PlanRenderer(c, vp).draw(st, items, 100, { selected: new Set(), hovered: undefined, snap: undefined, selectionRect: undefined, sketch: undefined }, undefined, false);
    return c.toDataURL("image/jpeg", 0.86);
  } catch {
    return "";
  }
}
/** Guarda el proyecto abierto en la biblioteca: actualiza su ficha o crea una nueva. */
async function saveToLibrary(origen = "Guardado desde el editor", quiet = false): Promise<void> {
  const model = store.snapshot();
  const old = libCurrent ? await getProject(libCurrent) : undefined;
  if (old) {
    old.modelo = model;
    old.resumen = summarize(model);
    old.miniatura = thumbnail(model) || old.miniatura;
    old.actualizado = Date.now();
    await putProject(old);
  } else {
    const r = makeRecord(model, origen, thumbnail(model));
    await putProject(r);
    setLibCurrent(r.id);
  }
  if (!quiet) say(`Guardado en la biblioteca: ${projectLabel()}.`, true);
}
let libTimer: number | undefined;
store.subscribe(() => {
  if (!libCurrent) return;
  window.clearTimeout(libTimer);
  libTimer = window.setTimeout(() => void saveToLibrary("", true), 2500);
});
/** La Casa Lote 01 entra una vez a la biblioteca como proyecto de referencia (ya no tiene botón propio). */
async function seedLibrary(): Promise<void> {
  try {
    if (localStorage.getItem(LIB_SEED_KEY)) return;
    localStorage.setItem(LIB_SEED_KEY, "1");
  } catch {
    return;
  }
  if ((await listProjects()).some((r) => r.origen === "Proyecto de referencia")) return;
  const m = buildLote01();
  await putProject(makeRecord(m, "Proyecto de referencia", thumbnail(m), "Casa Lote 01 · Bosque de Agua"));
}
void seedLibrary();
$<HTMLButtonElement>("#library").addEventListener("click", async () => {
  await seedLibrary();
  showLibrary({
    currentId: () => libCurrent,
    saveCurrent: () => saveToLibrary(),
    open: async (r: LibRecord) => {
      if (store.canUndo && !(await confirmReplace())) return false;
      loadModel(r.modelo, `Abierto de la biblioteca: ${r.nombre}.`, { id: r.id });
      return true;
    },
    thumbnail,
    download: (r) =>
      void download(`${safeName(`ARKEN DISENO-MODELO BIM-${today()}-${r.nombre.toUpperCase()}`)}.arken.json`, JSON.stringify(r.modelo, null, 2), "application/json").then(
        () => say(`Descargado: ${r.nombre}.`, true),
        (err: unknown) => say(err instanceof Error ? err.message : String(err)),
      ),
    importFile: () => fileInput.click(),
    say,
  });
});
$<HTMLButtonElement>("#new").addEventListener("click", () =>
  showDesignAssistant({
    load: async (model, msg) => {
      if (store.canUndo && !(await confirmReplace())) return false;
      loadModel(model, msg, { origen: "Diseñado con el asistente" });
      return true;
    },
    openLote01Variant: showSpecForm,
  }),
);

/** Proyecto nuevo por especificaciones: el diseño aprobado se ajusta a lo que pide el usuario. */
function showSpecForm(): void {
  const tb = projectEntity()?.titleBlock ?? {};
  const spec: Record<string, string | number> = { ...defaultSpec() };
  for (const k of ["empresa", "diseno", "matricula"] as const) if (tb[k]) spec[k] = tb[k];
  const box = document.createElement("div");
  box.className = "modal";
  const groups = ["Rótulo", "Arquitectura", "Redes"] as const;
  const body = groups
    .map(
      (g) =>
        `<fieldset><legend>${g}</legend>${SPEC_FIELDS.filter((f) => f.group === g)
          .map((f) => {
            const v = spec[f.key];
            const num = typeof v === "number";
            const attrs = num ? `type="number" step="${f.step ?? 1}" min="${f.min ?? ""}" max="${f.max ?? ""}"` : 'type="text"';
            return `<label class="f"><span>${esc(f.label)}${f.unit ? ` (${esc(f.unit)})` : ""}</span><input data-spec="${f.key}" ${attrs} value="${esc(String(v))}" title="${esc(f.help ?? (num ? `Entre ${f.min} y ${f.max}` : ""))}"></label>`;
          })
          .join("")}</fieldset>`,
    )
    .join("");
  box.innerHTML = `<div class="modal-card spec"><div class="modal-bar"><b>Nuevo proyecto por especificaciones</b><span></span><button class="primary" data-a="go">Generar planos</button><button data-a="x">Cerrar</button></div>
<div class="spec-body"><p class="muted">ARKEN DISEÑO toma el diseño aprobado de la Casa Lote 01 (arquitectura, estructura, eléctrica, iluminación, domótica, hidráulica, sanitaria, gas y solar, con sus 11 planos) y lo ajusta a estas especificaciones. Los recintos y las redes se estiran con la casa, las luminarias y los calibres se redimensionan solos, y todos los cuadros y memorias se recalculan.</p>
<div class="spec-grid">${body}</div><p class="spec-msg"></p></div></div>`;
  const msg = box.querySelector<HTMLElement>(".spec-msg")!;
  const read = (): HouseSpec => {
    const out: Record<string, string | number> = { ...spec };
    box.querySelectorAll<HTMLInputElement>("[data-spec]").forEach((i) => (out[i.dataset.spec!] = i.type === "number" ? Number(i.value) : i.value));
    return out as unknown as HouseSpec;
  };
  box.addEventListener("input", () => {
    const s = read();
    const errs = checkSpec(s);
    msg.textContent = errs.length ? errs.join(" ") : `Casa de ${(s.ancho * s.largo).toFixed(1)} m² construidos (${s.ancho.toFixed(2)} × ${s.largo.toFixed(2)} m).`;
    msg.classList.toggle("bad", errs.length > 0);
  });
  box.addEventListener("click", async (ev) => {
    const a = (ev.target as HTMLElement).closest<HTMLElement>("[data-a]")?.dataset.a;
    if (ev.target === box || a === "x") return box.remove();
    if (a !== "go") return;
    const s = read();
    const errs = checkSpec(s);
    if (errs.length) {
      msg.textContent = errs.join(" ");
      msg.classList.add("bad");
      return;
    }
    if (store.canUndo && !(await confirmReplace())) return;
    try {
      loadModel(generateHouse(s), `Proyecto generado: ${s.proyecto} · ${(s.ancho * s.largo).toFixed(1)} m², 11 planos con todas las redes.`, { origen: "Generado por especificaciones" });
      box.remove();
    } catch (err) {
      msg.textContent = err instanceof Error ? err.message : String(err);
      msg.classList.add("bad");
    }
  });
  document.body.appendChild(box);
  box.dispatchEvent(new Event("input"));
}
const FIN_FIELDS: [string, string][] = [
  ["acabado_piso", "Piso"],
  ["acabado_guardaescoba", "Guardaescoba"],
  ["acabado_muros", "Muros y pintura"],
  ["acabado_enchape", "Enchapes y especiales"],
  ["acabado_cielo", "Cielo"],
];
const FIN_KEY: Record<string, "piso" | "guardaescoba" | "muros" | "enchape" | "cielo"> = { acabado_piso: "piso", acabado_guardaescoba: "guardaescoba", acabado_muros: "muros", acabado_enchape: "enchape", acabado_cielo: "cielo" };

/** Confirmación dentro de la página: la vista publicada no permite los cuadros del navegador (window.confirm). */
function confirmReplace(): Promise<boolean> {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.className = "modal confirm";
    box.innerHTML = `<div class="modal-card ask"><div class="modal-bar"><b>Reemplazar el proyecto abierto</b></div><div class="ask-body"><p>Se reemplazará el modelo abierto por el nuevo. Si quiere conservarlo, guárdelo antes con <b>Guardar</b>.</p><div class="assist-row"><button class="primary" data-ok="1">Continuar</button><button data-ok="0">Cancelar</button></div></div></div>`;
    box.addEventListener("click", (ev) => {
      const ok = (ev.target as HTMLElement).closest<HTMLElement>("[data-ok]")?.dataset.ok;
      if (ok === undefined && ev.target !== box) return;
      box.remove();
      resolve(ok === "1");
    });
    document.body.appendChild(box);
    box.querySelector<HTMLButtonElement>("[data-ok='1']")!.focus();
  });
}
/** `lib`: ficha de la biblioteca a la que pertenece (id) o, si es un proyecto nuevo, de dónde viene (se guarda solo). */
function loadModel(model: BimModel, msg: string, lib?: { id: string } | { origen: string }): void {
  tool.cancel();
  window.clearTimeout(libTimer);
  setLibCurrent(undefined);
  store.load(model);
  if (lib && "id" in lib) setLibCurrent(lib.id);
  else if (lib) void saveToLibrary(lib.origen, true);
  mode = defaultMode();
  setMode(mode);
  say(msg, true);
}

// ─── Nombres de archivo: ARKEN DISENO-TIPO DE PLANO O DISEÑO-FECHA DE GUARDADO-NOMBRE DEL PROYECTO ──
function today(): string {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
function projectEntity(): Project | undefined {
  return [...store.entities()].find((e): e is Project => e.kind === "Project");
}
function projectLabel(): string {
  const p = projectEntity();
  return p?.titleBlock?.["proyecto"] || p?.name || "PROYECTO";
}
function arkenName(tipo: string): string {
  return safeName(`ARKEN DISENO-${tipo.toUpperCase()}-${today()}-${projectLabel().toUpperCase()}`);
}
const sheetTipo = (s: Sheet) => `${s.number} ${s.title}`;
const sheetItems = (s: Sheet) => visibleGeoms(store, engine.all(), { kind: "sheet", sheetId: s.id });

/** Capítulos adicionales de las memorias (topografía, cuando hay levantamiento). */
let extraChapters: () => ReportChapter[] = () => [];

function reportHtml(): string {
  const tb = projectEntity()?.titleBlock ?? {};
  return calcReportHtml(store, { logo: titleLogo(tb), date: today(), extra: extraChapters() });
}

/** Descarga un DXF; si el visor no admite .dxf, lo entrega dentro de un .zip. */
async function downloadDxf(name: string, text: string): Promise<void> {
  try {
    await download(`${name}.dxf`, text, "application/dxf");
  } catch (err) {
    if (!(err instanceof Error) || !/no permite/.test(err.message)) throw err;
    await download(`${name}.zip`, new Blob([zip([{ name: `${name}.dxf`, data: text }])], { type: "application/zip" }));
  }
}

async function sheetsPdf(sheets: readonly Sheet[], title: string, before?: (doc: PdfDocument) => Promise<void>): Promise<Uint8Array<ArrayBuffer>> {
  const doc = new PdfDocument(canvasMeasure, title);
  if (before) await before(doc);
  for (const s of sheets) await sheetPdfPage(doc, store, s, sheetGeometry(s), sheetItems(s));
  return doc.build();
}

// Exportación del plano activo.
async function exportSheet(kind: string): Promise<void> {
  const s = currentSheet();
  if (!s) return say("Elige un plano para exportarlo.");
  const geo = sheetGeometry(s);
  const items = visibleGeoms(store, engine.all(), mode);
  const name = arkenName(sheetTipo(s));
  try {
    if (kind === "svg") await download(`${name}.svg`, sheetSvg(store, s, geo, items), "image/svg+xml");
    else if (kind === "pdf") {
      say("Generando PDF…", true);
      await download(`${name}.pdf`, new Blob([await sheetsPdf([s], `${s.number} ${s.title}`)], { type: "application/pdf" }));
    } else if (kind === "dxf") await downloadDxf(name, sheetDxf(store, s, geo, items));
    else if (kind === "png") {
      say("Generando PNG…", true);
      await download(`${name}.png`, await sheetPng(store, s, geo, items, 8));
    }
    say(`Plano ${s.number} exportado (${kind.toUpperCase()}).`, true);
  } catch (err) {
    say(err instanceof Error ? err.message : String(err));
  }
}

/** Paquete completo: todos los planos (PDF y DXF), el juego de planos, el modelo en metros, las memorias y el modelo BIM. */
async function savePackage(): Promise<void> {
  const sheets = allSheets(store);
  if (!sheets.length) return say("El proyecto no tiene planos para guardar.");
  try {
    const files: ZipEntry[] = [];
    let i = 0;
    for (const s of sheets) {
      say(`Preparando plano ${++i} de ${sheets.length}: ${s.number}…`, true);
      await new Promise((r) => setTimeout(r, 0));
      const name = arkenName(sheetTipo(s));
      files.push({ name: `PDF/${name}.pdf`, data: await sheetsPdf([s], `${s.number} ${s.title}`) });
      files.push({ name: `DXF/${name}.dxf`, data: sheetDxf(store, s, sheetGeometry(s), sheetItems(s)) });
    }
    say("Uniendo el juego completo de planos…", true);
    const full = new PdfDocument(canvasMeasure, `Juego de planos · ${projectLabel()}`);
    await extraPdf(full);
    if (full.pages.length) files.push({ name: `PDF/${arkenName("T-01 TOPOGRAFIA E IMPLANTACION")}.pdf`, data: await full.build() });
    files.push({ name: `PDF/${arkenName("JUEGO COMPLETO DE PLANOS")}.pdf`, data: await sheetsPdf(sheets, `Juego de planos · ${projectLabel()}`, extraPdf) });
    files.push({ name: `DXF/${arkenName("MODELO EN METROS")}.dxf`, data: modelDxf(store, engine.all()) });
    files.push({ name: `MEMORIAS/${arkenName("MEMORIAS DE CALCULO")}.html`, data: reportHtml() });
    files.push({ name: `MODELO/${arkenName("MODELO BIM")}.arken.json`, data: JSON.stringify(store.snapshot(), null, 2) });
    for (const f of extraFiles()) files.push(f);
    files.push({ name: "LEEME.txt", data: readme(sheets) });
    const pkg = arkenName("PLANOS Y DISENOS");
    await download(`${pkg}.zip`, new Blob([zip(files)], { type: "application/zip" }));
    say(`Guardado: ${sheets.length} planos en PDF y DXF, juego completo, modelo en metros y memorias de cálculo.`, true);
  } catch (err) {
    say(err instanceof Error ? err.message : String(err));
  }
}

/** Archivos y páginas adicionales del paquete (topografía). */
let extraFiles: () => ZipEntry[] = () => [];
let extraPdf: (doc: PdfDocument) => Promise<void> = async () => {};

function readme(sheets: readonly Sheet[]): string {
  return [
    `ARKEN DISEÑO · ${projectLabel()}`,
    `Guardado el ${today()}`,
    "",
    "PDF/      Cada plano a tamaño real de papel (vectorial) y el juego completo en un solo PDF.",
    "DXF/      Cada plano para AutoCAD en mm de papel (escala 1:1 de impresión), capas por disciplina.",
    "          MODELO EN METROS: todo el modelo en espacio modelo, en metros, capas DISCIPLINA-ELEMENTO.",
    "MEMORIAS/ Memorias de cálculo de cada diseño (abrir en el navegador; se puede imprimir a PDF).",
    "MODELO/   Modelo BIM editable de ARKEN DISEÑO (.arken.json).",
    "",
    "Planos:",
    ...sheets.map((s) => `  ${s.number.padEnd(6)} ${s.title}`),
    "",
  ].join("\r\n");
}

// Memorias de cálculo: vista previa en la app y descarga.
function showReport(): void {
  const html = reportHtml();
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `<div class="modal-card"><div class="modal-bar"><b>Memorias de cálculo</b><span></span><button class="primary" data-a="dl">Descargar</button><button data-a="x">Cerrar</button></div><iframe title="Memorias de cálculo"></iframe></div>`;
  box.querySelector("iframe")!.srcdoc = html;
  box.addEventListener("click", (ev) => {
    const a = (ev.target as HTMLElement).closest<HTMLElement>("[data-a]")?.dataset.a;
    if (ev.target === box || a === "x") box.remove();
    if (a === "dl")
      download(`${arkenName("MEMORIAS DE CALCULO")}.html`, html, "text/html").then(
        () => say("Memorias de cálculo descargadas.", true),
        (err: unknown) => say(err instanceof Error ? err.message : String(err)),
      );
  });
  document.body.appendChild(box);
}
// ─── Topografía: levantamiento, terreno 3D e implantación ────
let terrainCache: { json: string; terrain: Terrain } | undefined;
function currentSite(): Site | undefined {
  const pr = projectEntity();
  const props = pr?.properties ?? {};
  const json = typeof props["topografia"] === "string" ? props["topografia"] : "";
  if (!json) return undefined;
  if (terrainCache?.json !== json) {
    const sv = decodeSurvey(json);
    if (!sv) return undefined;
    terrainCache = { json, terrain: new Terrain(sv) };
  }
  const n = (k: string) => (typeof props[k] === "number" ? (props[k] as number) : NaN);
  const footprint = houseFootprint(store, pr);
  let placement: Placement = { x: n("topo_x"), y: n("topo_y"), rotDeg: n("topo_rot"), npt: n("topo_npt") };
  if (![placement.x, placement.y, placement.rotDeg, placement.npt].every(Number.isFinite)) {
    const xs = footprint.map((q) => q.x), ys = footprint.map((q) => q.y);
    placement = defaultPlacement(terrainCache.terrain, { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) });
  }
  const h = typeof props["cubierta_alta_m"] === "number" ? (props["cubierta_alta_m"] as number) : 3.2;
  return { terrain: terrainCache.terrain, placement, footprint, height: h };
}
function putSite(patch: Record<string, string | number>, label: string): void {
  const pr = projectEntity();
  if (!pr) return say("El modelo no tiene proyecto.");
  const properties = { ...(pr.properties ?? {}) } as Record<string, PropertyValue>;
  for (const [k, v] of Object.entries(patch)) properties[k] = v;
  put({ ...pr, properties }, label);
}
function implantation(site: Site) {
  return implantationSheet(store, site, allSheets(store)[0], engine.all(), siteEarthwork(site));
}
extraChapters = () => {
  const site = currentSite();
  return site ? [topoChapter(site)] : [];
};
extraFiles = () => {
  const site = currentSite();
  if (!site) return [];
  const imp = implantation(site);
  return [
    { name: `DXF/${arkenName("TOPOGRAFIA E IMPLANTACION")}.dxf`, data: topoDxf(store, site, engine.all()) },
    { name: `DXF/${arkenName("T-01 TOPOGRAFIA E IMPLANTACION PLANO")}.dxf`, data: sheetDxf(store, imp.sheet, buildSheet(store, imp.sheet), imp.items) },
    { name: `TOPOGRAFIA/${arkenName("PUNTOS DEL LEVANTAMIENTO")}.csv`, data: surveyCsv(site) },
  ];
};
extraPdf = async (doc) => {
  const site = currentSite();
  if (!site) return;
  const imp = implantation(site);
  await sheetPdfPage(doc, store, imp.sheet, buildSheet(store, imp.sheet), imp.items);
};

function showTopo(): void {
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `<div class="modal-card topo"><div class="modal-bar"><b>Topografía e implantación</b><span></span><button data-a="x">Cerrar</button></div>
<div class="topo-body"><div class="topo-view"><canvas></canvas><div class="topo-tools"><button data-a="3d">3D</button><button data-a="top">Planta</button><label>Exageración <input data-a="exag" type="range" min="1" max="5" step="0.5" value="1.5"></label></div></div>
<aside class="topo-side panel"></aside></div></div>`;
  const canvas = box.querySelector("canvas")!;
  const side = box.querySelector<HTMLElement>(".topo-side")!;
  const view = new TerrainView(canvas);
  const file = document.createElement("input");
  file.type = "file";
  file.accept = ".dxf,.csv,.txt,.xyz";
  const load = (text: string, name: string) => {
    try {
      const sv = readSurvey(text, name);
      putSite({ topografia: encodeSurvey(sv), topo_x: NaN, topo_y: NaN, topo_rot: NaN, topo_npt: NaN }, "Cargar levantamiento topográfico");
      const site = currentSite();
      if (site) putSite({ topo_x: round2(site.placement.x), topo_y: round2(site.placement.y), topo_rot: 0, topo_npt: site.placement.npt }, "Implantar la casa");
      say(`Levantamiento leído: ${sv.stats["leidos"]} puntos con cota (${sv.points.length} usados).`, true);
    } catch (err) {
      say(err instanceof Error ? err.message : String(err));
    }
    render();
  };
  file.addEventListener("change", async () => {
    const f0 = file.files?.[0];
    file.value = "";
    if (f0) load(await f0.text(), f0.name);
  });
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const fx = (v: number, d = 2) => (Number.isFinite(v) ? v.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
  function render(): void {
    const site = currentSite();
    view.site = site;
    view.draw();
    let html = `<h2>Levantamiento</h2><p class="muted">Plano del topógrafo en DXF (puntos, polilíneas 3D, curvas con elevación, bloques con atributo de cota) o archivo de puntos PNEZD (.csv / .txt).</p>
<div class="logo-btns"><button class="primary" data-a="load">Cargar levantamiento…</button><button data-a="sample">Ejemplo</button></div>`;
    if (site) {
      const t = site.terrain;
      const ew = siteEarthwork(site);
      const pl = site.placement;
      html += `<p class="muted">${esc(t.survey.source)} · ${t.survey.points.length} puntos · ${t.tin.tris.length} triángulos<br>Cotas ${fx(t.zMin)} a ${fx(t.zMax)} m · curvas cada ${fx(t.contourInterval())} m</p>
<h2>Ubicar la casa</h2><div class="fields">
${field("X origen casa (m)", "topo_x", round2(pl.x), "number", 'step="0.5"')}
${field("Y origen casa (m)", "topo_y", round2(pl.y), "number", 'step="0.5"')}
${field("Giro (°)", "topo_rot", round2(pl.rotDeg), "number", 'step="1"')}
${field("NPT ±0.00 (m)", "topo_npt", round2(pl.npt), "number", 'step="0.05"')}
</div><div class="logo-btns" style="margin-top:8px"><button data-a="balance">NPT de equilibrio (${fx(ew.balancedNpt)})</button><button data-a="center">Centrar</button></div>
<h2>Movimiento de tierras</h2><table class="kv-mini">
<tr><td>Terreno bajo la casa</td><td>${fx(ew.zMin)} a ${fx(ew.zMax)} m</td></tr>
<tr><td>Pendiente media</td><td>${fx(ew.slopePct, 1)} %</td></tr>
<tr><td>Subrasante</td><td>${fx(ew.platform)} m</td></tr>
<tr><td><b>Corte</b></td><td><b>${fx(ew.cut, 1)} m³</b></td></tr>
<tr><td><b>Lleno</b></td><td><b>${fx(ew.fill, 1)} m³</b></td></tr>
${ew.outside > 0 ? `<tr><td colspan="2" class="warn">${fx(ew.outside, 1)} m² de la casa quedan fuera del levantamiento.</td></tr>` : ""}
</table>
<h2>Exportar</h2><div class="logo-btns"><button data-a="pdf">Plano T-01 (PDF)</button><button data-a="dxf">DXF topográfico</button></div>
<p class="muted">El plano de implantación, el DXF y el capítulo de topografía de las memorias también entran en "Guardar planos".</p>`;
    }
    side.innerHTML = html;
    side.querySelectorAll<HTMLInputElement>("[data-field]").forEach((inp) =>
      inp.addEventListener("change", () => {
        const v = Number(inp.value);
        if (!Number.isFinite(v)) return;
        const cur = currentSite();
        if (!cur) return;
        const pl = cur.placement;
        putSite({ topo_x: pl.x, topo_y: pl.y, topo_rot: pl.rotDeg, topo_npt: pl.npt, [inp.dataset.field!]: v }, "Mover la implantación");
        render();
      }),
    );
  }
  box.addEventListener("click", async (ev) => {
    const a = (ev.target as HTMLElement).closest<HTMLElement>("[data-a]")?.dataset.a;
    if (ev.target === box || a === "x") return box.remove();
    const site = currentSite();
    if (a === "load") file.click();
    else if (a === "sample") load(sampleSurveyDxf(), "Levantamiento de ejemplo (Alto de Las Palmas).dxf");
    else if (a === "3d") (view.yaw = -0.6), (view.pitch = 0.8), view.draw();
    else if (a === "top") view.topView();
    else if (a === "balance" && site) {
      const pl = site.placement;
      putSite({ topo_x: pl.x, topo_y: pl.y, topo_rot: pl.rotDeg, topo_npt: siteEarthwork(site).balancedNpt }, "NPT de equilibrio");
      render();
    } else if (a === "center" && site) {
      const xs = site.footprint.map((q) => q.x), ys = site.footprint.map((q) => q.y);
      const d = defaultPlacement(site.terrain, { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) });
      putSite({ topo_x: round2(d.x), topo_y: round2(d.y), topo_rot: 0, topo_npt: d.npt }, "Centrar la casa en el lote");
      render();
    } else if (a === "pdf" && site) {
      try {
        const imp = implantation(site);
        const doc = new PdfDocument(canvasMeasure, "T-01 Topografía e implantación");
        await sheetPdfPage(doc, store, imp.sheet, buildSheet(store, imp.sheet), imp.items);
        await download(`${arkenName("T-01 TOPOGRAFIA E IMPLANTACION")}.pdf`, new Blob([await doc.build()], { type: "application/pdf" }));
        say("Plano de implantación descargado.", true);
      } catch (err) {
        say(err instanceof Error ? err.message : String(err));
      }
    } else if (a === "dxf" && site) {
      downloadDxf(arkenName("TOPOGRAFIA E IMPLANTACION"), topoDxf(store, site, engine.all())).then(
        () => say("DXF topográfico descargado.", true),
        (err: unknown) => say(err instanceof Error ? err.message : String(err)),
      );
    }
  });
  box.querySelector<HTMLInputElement>('[data-a="exag"]')!.addEventListener("input", (e) => {
    view.exag = Number((e.target as HTMLInputElement).value);
    view.draw();
  });
  document.body.appendChild(box);
  render();
  new ResizeObserver(() => view.draw()).observe(canvas);
}
$<HTMLButtonElement>("#topo").addEventListener("click", showTopo);
$<HTMLButtonElement>("#package").addEventListener("click", () => void savePackage());
$<HTMLButtonElement>("#report").addEventListener("click", showReport);
document.querySelectorAll<HTMLButtonElement>("[data-export]").forEach((b) => b.addEventListener("click", () => void exportSheet(b.dataset.export!)));

// ─── Arranque ───────────────────────────────────────────────
let fitted = false;
function resize(): void {
  renderer.resize();
  if (!fitted && view.width > 10) {
    fitted = true;
    fitView();
  }
  requestDraw();
}
new ResizeObserver(resize).observe(canvas);
fillPalettes();
refreshLayerSets();
refreshViews();
refreshDisciplines();
refreshButtons();
setTool(toolName);
renderPanel();
resize();
if (init.restored) say("Se recuperó tu último trabajo guardado en este navegador.", true);

// Acceso desde la consola del navegador para explorar el modelo.
async function pngDataUrl(sheetId: Id, pxPerMm = 6): Promise<string> {
  const s = getOfKind(store, sheetId, "Sheet");
  if (!s) throw new Error("Plano inexistente");
  const blob = await sheetPng(store, s, sheetGeometry(s), visibleGeoms(store, engine.all(), { kind: "sheet", sheetId }), pxPerMm);
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.readAsDataURL(blob);
  });
}
Object.assign(window, { arken: { store, engine, spatial, view, setMode, sheetGeometry, pngDataUrl, sheets: () => allSheets(store).map((s) => ({ id: s.id, number: s.number })) } });
