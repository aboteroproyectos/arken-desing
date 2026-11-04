// Vista de planta: un visualizador puro. Solo lee la geometría derivada y el estado de la
// interfaz (selección, resaltado, snap); nunca modifica el modelo.

import type { Id, ModelReader, Vec2 } from "@arken/core";
import { arcPoints, type ElementPlanGeometry, type PlanPrimitive } from "@arken/geometry";
import type { SnapResult } from "@arken/spatial";
import type { Viewport } from "./viewport";

export interface Overlay {
  readonly selected: ReadonlySet<Id>;
  readonly hovered: Id | undefined;
  readonly snap: SnapResult | undefined;
  readonly cursor: Vec2 | undefined;
  readonly selectionRect: { a: Vec2; b: Vec2 } | undefined;
}

const INK = "#23262b";
const ACCENT = "#1f6feb";
const GLASS = "#3b8fd6";

export class PlanRenderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly view: Viewport,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D no disponible");
    this.ctx = ctx;
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.view.width = r.width;
    this.view.height = r.height;
  }

  draw(model: ModelReader, geoms: Iterable<ElementPlanGeometry>, levelId: Id, o: Overlay): void {
    const { ctx, view } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fbfaf7";
    ctx.fillRect(0, 0, view.width, view.height);
    this.drawGrid();

    // Muros primero, después puertas y ventanas encima.
    const list = [...geoms].filter((g) => g.levelId === levelId);
    list.sort((a, b) => Number(a.kind !== "Wall") - Number(b.kind !== "Wall"));
    for (const g of list) {
      const state = o.selected.has(g.elementId) ? "selected" : o.hovered === g.elementId ? "hover" : "normal";
      for (const p of g.primitives) this.drawPrimitive(model, p, state);
    }

    if (o.selectionRect) this.drawSelectionRect(o.selectionRect.a, o.selectionRect.b);
    if (o.snap) this.drawSnap(o.snap);
  }

  private drawGrid(): void {
    const { ctx, view } = this;
    const tl = view.screenToWorld({ x: 0, y: 0 });
    const br = view.screenToWorld({ x: view.width, y: view.height });
    // Elige un paso de rejilla que deje al menos ~12 px entre líneas.
    const steps = [0.1, 0.5, 1, 5, 10, 50, 100];
    const minor = steps.find((s) => s * view.scale >= 12) ?? 100;
    const major = minor * (minor === 0.5 || minor === 5 || minor === 50 ? 2 : 5);
    for (const [step, color] of [[minor, "#eeebe4"], [major, "#e0dcd2"]] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
        const sx = Math.round(view.worldToScreen({ x, y: 0 }).x) + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, view.height);
      }
      for (let y = Math.floor(br.y / step) * step; y <= tl.y; y += step) {
        const sy = Math.round(view.worldToScreen({ x: 0, y }).y) + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(view.width, sy);
      }
      ctx.stroke();
    }
    // Ejes del origen.
    const o = view.worldToScreen({ x: 0, y: 0 });
    ctx.strokeStyle = "#cfc8b8";
    ctx.beginPath();
    ctx.moveTo(o.x + 0.5, 0);
    ctx.lineTo(o.x + 0.5, view.height);
    ctx.moveTo(0, o.y + 0.5);
    ctx.lineTo(view.width, o.y + 0.5);
    ctx.stroke();
  }

  private path(points: readonly Vec2[], close: boolean): void {
    const { ctx, view } = this;
    ctx.beginPath();
    points.forEach((p, i) => {
      const s = view.worldToScreen(p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    if (close) ctx.closePath();
  }

  private drawPrimitive(model: ModelReader, p: PlanPrimitive, state: "normal" | "hover" | "selected"): void {
    const { ctx } = this;
    const highlight = state === "normal" ? undefined : ACCENT;
    ctx.setLineDash([]);
    ctx.lineJoin = "round";

    if (p.style.startsWith("capa:")) {
      const mat = model.getEntity(p.style.slice(5));
      const color = mat && mat.kind === "Material" ? (mat.displayColor ?? "#cccccc") : "#cccccc";
      if (p.kind !== "polygon") return;
      this.path(p.points, true);
      ctx.fillStyle = color;
      ctx.fill();
      if (state === "selected") {
        ctx.fillStyle = "rgba(31,111,235,0.28)";
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(35,38,43,0.35)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
      return;
    }

    const pts = p.kind === "arc" ? arcPoints(p, 24) : p.points;
    const closed = p.kind === "polygon";
    let width = 1;
    let color = INK;
    let fill: string | undefined;
    if (p.style === "muro:contorno") width = 1.6;
    else if (p.style === "muro:sin-capas") width = 2;
    else if (p.style === "oculto") ctx.setLineDash([6, 4]);
    else if (p.style === "simbolo:puerta:hoja") width = 1.8;
    else if (p.style === "simbolo:puerta:barrido") {
      width = 0.8;
      ctx.setLineDash([2, 3]);
    } else if (p.style.startsWith("simbolo:ventana")) {
      if (p.style.endsWith(":marco")) fill = "#ffffff";
      if (p.style.endsWith(":vidrio")) color = GLASS;
      if (p.style.includes(":oculto")) ctx.setLineDash([6, 4]);
    }

    this.path(pts, closed);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.strokeStyle = highlight ?? color;
    ctx.lineWidth = highlight ? width + 1.2 : width;
    ctx.stroke();
  }

  private drawSelectionRect(a: Vec2, b: Vec2): void {
    const { ctx, view } = this;
    const sa = view.worldToScreen(a);
    const sb = view.worldToScreen(b);
    const crossing = b.x < a.x; // de derecha a izquierda = captura
    ctx.setLineDash(crossing ? [5, 4] : []);
    ctx.fillStyle = crossing ? "rgba(46,160,67,0.10)" : "rgba(31,111,235,0.10)";
    ctx.strokeStyle = crossing ? "#2ea043" : ACCENT;
    ctx.lineWidth = 1;
    ctx.fillRect(sa.x, sa.y, sb.x - sa.x, sb.y - sa.y);
    ctx.strokeRect(sa.x + 0.5, sa.y + 0.5, sb.x - sa.x, sb.y - sa.y);
    ctx.setLineDash([]);
  }

  /** Símbolo de snap: cuadrado = extremo, triángulo = punto medio, círculo = sobre eje, cruz = rejilla. */
  private drawSnap(s: SnapResult): void {
    const { ctx, view } = this;
    const p = view.worldToScreen(s.point);
    const r = 6;
    ctx.setLineDash([]);
    ctx.strokeStyle = s.kind === "grid" ? "#9aa0a6" : "#e8590c";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    if (s.kind === "endpoint") ctx.rect(p.x - r, p.y - r, 2 * r, 2 * r);
    else if (s.kind === "midpoint") {
      ctx.moveTo(p.x, p.y - r);
      ctx.lineTo(p.x + r, p.y + r);
      ctx.lineTo(p.x - r, p.y + r);
      ctx.closePath();
    } else if (s.kind === "onAxis") ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    else {
      ctx.moveTo(p.x - r, p.y);
      ctx.lineTo(p.x + r, p.y);
      ctx.moveTo(p.x, p.y - r);
      ctx.lineTo(p.x, p.y + r);
    }
    ctx.stroke();
  }
}
