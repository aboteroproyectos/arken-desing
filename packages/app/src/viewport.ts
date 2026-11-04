// Conversión pantalla (píxeles CSS, y hacia abajo) ↔ mundo (metros, y hacia arriba).

import type { Vec2 } from "@arken/core";

export class Viewport {
  /** Punto del mundo que aparece en el centro de la pantalla. */
  center: Vec2 = { x: 2.5, y: 1 };
  /** Píxeles por metro. */
  scale = 80;
  width = 1;
  height = 1;

  get metersPerPixel(): number {
    return 1 / this.scale;
  }

  screenToWorld(p: Vec2): Vec2 {
    return {
      x: this.center.x + (p.x - this.width / 2) / this.scale,
      y: this.center.y - (p.y - this.height / 2) / this.scale,
    };
  }

  worldToScreen(p: Vec2): Vec2 {
    return {
      x: (p.x - this.center.x) * this.scale + this.width / 2,
      y: -(p.y - this.center.y) * this.scale + this.height / 2,
    };
  }

  /** Zoom manteniendo fijo el punto del mundo bajo el cursor. */
  zoomAt(screen: Vec2, factor: number): void {
    const before = this.screenToWorld(screen);
    this.scale = Math.min(2000, Math.max(5, this.scale * factor));
    const after = this.screenToWorld(screen);
    this.center = { x: this.center.x + before.x - after.x, y: this.center.y + before.y - after.y };
  }

  panByPixels(dx: number, dy: number): void {
    this.center = { x: this.center.x - dx / this.scale, y: this.center.y + dy / this.scale };
  }
}
