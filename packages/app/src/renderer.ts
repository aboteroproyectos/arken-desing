// Vista de planta y de planos: un visualizador puro. Solo lee la geometría derivada y el estado de la
// interfaz (selección, resaltado, snap); nunca modifica el modelo.

import type { Id, ModelReader, Vec2 } from "@arken/core";
import type { AABB2, PlanPrimitive } from "@arken/geometry";
import type { SnapResult } from "@arken/spatial";
import { paintCanvas, type CanvasXf } from "./paint";
import type { Visible } from "./scene";
import type { Viewport } from "./viewport";

export interface Overlay {
  readonly selected: ReadonlySet<Id>;
  readonly hovered: Id | undefined;
  readonly snap: SnapResult | undefined;
  readonly selectionRect: { a: Vec2; b: Vec2 } | undefined;
  /** Trazo provisional de la herramienta activa (recorrido o cota en curso). */
  readonly sketch: readonly Vec2[] | undefined;
}

export interface SheetScene {
  readonly primitives: readonly PlanPrimitive[];
  readonly paper: AABB2;
  readonly viewport: AABB2;
}

const ACCENT = "#1f6feb";

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

  /** `drawScale`: denominador de la escala de dibujo (los grosores en mm de papel dependen de ella). */
  draw(model: ModelReader, items: readonly Visible[], drawScale: number, o: Overlay, sheet?: SheetScene, grid = true): void {
    const { ctx, view } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = sheet ? "#8d9096" : "#fbfaf7";
    ctx.fillRect(0, 0, view.width, view.height);
    const xf: CanvasXf = { toScreen: (p) => view.worldToScreen(p), pxPerM: view.scale, pxPerMm: (view.scale * drawScale) / 1000 };

    if (sheet) {
      const a = view.worldToScreen({ x: sheet.paper.minX, y: sheet.paper.maxY });
      const b = view.worldToScreen({ x: sheet.paper.maxX, y: sheet.paper.minY });
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(a.x + 4, a.y + 4, b.x - a.x, b.y - a.y);
      paintCanvas(ctx, model, sheet.primitives, xf);
      const va = view.worldToScreen({ x: sheet.viewport.minX, y: sheet.viewport.maxY });
      const vb = view.worldToScreen({ x: sheet.viewport.maxX, y: sheet.viewport.minY });
      ctx.save();
      ctx.beginPath();
      ctx.rect(va.x, va.y, vb.x - va.x, vb.y - va.y);
      ctx.clip();
    } else if (grid) this.drawGrid();

    for (const it of items) {
      const g = it.geom;
      const highlight = o.selected.has(g.elementId) ? ACCENT : o.hovered === g.elementId ? "#5b9cf5" : undefined;
      paintCanvas(ctx, model, g.primitives, xf, { background: it.background, ...(highlight ? { highlight } : {}) });
    }
    if (sheet) ctx.restore();

    if (o.sketch && o.sketch.length > 0) this.drawSketch(o.sketch);
    if (o.selectionRect) this.drawSelectionRect(o.selectionRect.a, o.selectionRect.b);
    if (o.snap) this.drawSnap(o.snap);
  }

  private drawGrid(): void {
    const { ctx, view } = this;
    const tl = view.screenToWorld({ x: 0, y: 0 });
    const br = view.screenToWorld({ x: view.width, y: view.height });
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
  }

  private drawSketch(pts: readonly Vec2[]): void {
    const { ctx, view } = this;
    ctx.strokeStyle = "#e8590c";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    pts.forEach((p, i) => {
      const s = view.worldToScreen(p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawSelectionRect(a: Vec2, b: Vec2): void {
    const { ctx, view } = this;
    const sa = view.worldToScreen(a);
    const sb = view.worldToScreen(b);
    const crossing = b.x < a.x;
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
