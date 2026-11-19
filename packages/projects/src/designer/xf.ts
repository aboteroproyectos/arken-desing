// Constructor con transformación: dibuja un pabellón en sus coordenadas locales (barra de tres bandas)
// y lo escribe girado y trasladado en el modelo. Comparte el modelo con el constructor principal.

import type { AnnotationStyle, BimStore, Discipline, Id, Vec2 } from "@arken/core";
import { ProjectBuilder, v, type Props } from "../builder";
import { toGlobal, type Place } from "./layout";

export class XfBuilder extends ProjectBuilder {
  declare readonly store: BimStore;
  constructor(
    base: ProjectBuilder,
    readonly pl: Place,
  ) {
    super();
    (this as { store: BimStore }).store = base.store;
  }
  /** Punto local → global. */
  g(p: Vec2): Vec2 {
    const q = toGlobal(this.pl, p.x, p.y);
    return v(q.x, q.y);
  }
  get angle(): number {
    return (this.pl.turn * Math.PI) / 2;
  }
  override wall(layerSetId: Id, a: Vec2, b: Vec2, height: number, props?: Props, name?: string): Id {
    return super.wall(layerSetId, this.g(a), this.g(b), height, props, name);
  }
  override door(wallId: Id, center: Vec2, width: number, into: Vec2, hingeNear: Vec2, name?: string, props?: Props): Id {
    return super.door(wallId, this.g(center), width, this.g(into), this.g(hingeNear), name, props);
  }
  override window(wallId: Id, center: Vec2, width: number, sill: number, height: number, name?: string, props?: Props): Id {
    return super.window(wallId, this.g(center), width, sill, height, name, props);
  }
  override space(number: string, name: string, boundary: Vec2[], props: Props = {}): Id {
    return super.space(number, name, boundary.map((p) => this.g(p)), props);
  }
  override device(discipline: Discipline, symbol: string, at: Vec2, h: number, props: Props = {}, opts: { rot?: number; tag?: string; name?: string } = {}): Id {
    return super.device(discipline, symbol, this.g(at), h, props, { ...opts, rot: norm((opts.rot ?? 0) + this.angle) });
  }
  override run_(discipline: Discipline, system: string, points: Vec2[], props: Props = {}, tag?: string): Id {
    return super.run_(discipline, system, points.map((p) => this.g(p)), props, tag);
  }
  override note(discipline: Discipline, style: AnnotationStyle, points: Vec2[], text?: string, props: Props = {}, textSize?: number): Id {
    const pr: Props = { ...props };
    if (text !== undefined && style !== "dimension") {
      // Texto legible: entre −90° y +90°.
      let r = norm(Number(props["rot"] ?? 0) + this.angle);
      if (r > Math.PI / 2 + 1e-6) r -= Math.PI;
      if (r <= -Math.PI / 2 - 1e-6) r += Math.PI;
      if (Math.abs(r) > 1e-9 || props["rot"] !== undefined) pr["rot"] = Math.round(r * 1e6) / 1e6;
    }
    return super.note(discipline, style, points.map((p) => this.g(p)), text, pr, textSize);
  }
}

/** Ángulo en (−π, π]. */
function norm(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return Math.round(r * 1e9) / 1e9;
}
