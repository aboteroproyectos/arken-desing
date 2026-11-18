// Constructor de proyectos por código: crea un modelo ARKEN a través de los MISMOS comandos que usa
// la aplicación, de modo que cada paso pasa por las reglas de integridad del BimStore.

import {
  BimStore,
  createEntity,
  createLevelElement,
  createWall,
  emptyModel,
  getOfKind,
  insertDoor,
  insertWindow,
  newId,
  putEntities,
  type Annotation,
  type AnnotationStyle,
  type BimModel,
  type Circuit,
  type Command,
  type Device,
  type Discipline,
  type Entity,
  type Id,
  type PropertyValue,
  type Run,
  type Sheet,
  type Space,
  type Vec2,
  type Wall,
} from "@arken/core";

export type Props = Record<string, PropertyValue>;
export const v = (x: number, y: number): Vec2 => ({ x: round(x), y: round(y) });
const round = (n: number) => Math.round(n * 10000) / 10000;

export class ProjectBuilder {
  readonly store = new BimStore(emptyModel());
  levelId: Id = "";

  run<T extends Command>(cmd: T): T {
    const r = this.store.run(cmd);
    if (!r.ok) throw new Error(`${cmd.label}: ${r.violations.map((x) => x.message).join(" ")}`);
    return cmd;
  }

  put(...entities: Entity[]): void {
    this.run(putEntities(entities));
  }

  // ─── Arquitectura ──────────────────────────────────────────

  wall(layerSetId: Id, a: Vec2, b: Vec2, height: number, props?: Props, name?: string): Id {
    const cmd = this.run(createWall({ levelId: this.levelId, layerSetId, start: a, end: b, height, ...(name ? { name } : {}) }));
    if (props) {
      const w = getOfKind(this.store, cmd.wallId, "Wall")!;
      this.put({ ...w, properties: { ...(w.properties ?? {}), ...props } });
    }
    return cmd.wallId;
  }

  private along(wallId: Id, center: Vec2, width: number): { offset: number; wall: Wall; u: Vec2; n: Vec2 } {
    const wall = getOfKind(this.store, wallId, "Wall");
    if (!wall) throw new Error("Muro inexistente");
    const L = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    const u = { x: (wall.end.x - wall.start.x) / L, y: (wall.end.y - wall.start.y) / L };
    const n = { x: -u.y, y: u.x };
    const t = (center.x - wall.start.x) * u.x + (center.y - wall.start.y) * u.y;
    return { offset: round(t - width / 2), wall, u, n };
  }

  /**
   * Puerta centrada en `center` (punto sobre el eje del muro). `into` es un punto del recinto hacia el
   * que abre la hoja y `hingeNear` un punto cerca de la jamba de la bisagra.
   */
  door(wallId: Id, center: Vec2, width: number, into: Vec2, hingeNear: Vec2, name?: string, props?: Props): Id {
    const { offset, wall, u, n } = this.along(wallId, center, width);
    const side = (into.x - center.x) * n.x + (into.y - center.y) * n.y;
    const jambStart = { x: wall.start.x + u.x * offset, y: wall.start.y + u.y * offset };
    const jambEnd = { x: jambStart.x + u.x * width, y: jambStart.y + u.y * width };
    const dS = Math.hypot(hingeNear.x - jambStart.x, hingeNear.y - jambStart.y);
    const dE = Math.hypot(hingeNear.x - jambEnd.x, hingeNear.y - jambEnd.y);
    const cmd = this.run(
      insertDoor({ wallId, offsetAlongAxis: offset, width, height: 2.4, swingSide: dS <= dE ? "left" : "right", swingDirection: side < 0 ? "inward" : "outward" }),
    );
    if (name || props) {
      const d = getOfKind(this.store, cmd.doorId, "Door")!;
      this.put({ ...d, ...(name ? { name } : {}), properties: { ...(props ?? {}) } });
    }
    return cmd.doorId;
  }

  window(wallId: Id, center: Vec2, width: number, sill: number, height: number, name?: string, props?: Props): Id {
    const { offset } = this.along(wallId, center, width);
    const cmd = this.run(insertWindow({ wallId, offsetAlongAxis: offset, width, height, sillHeight: sill }));
    const w = getOfKind(this.store, cmd.windowId, "Window")!;
    this.put({ ...w, operation: (props?.["operacion"] as "fixed" | "sliding" | "casement") ?? "sliding", ...(name ? { name } : {}), properties: { ...(props ?? {}) } });
    return cmd.windowId;
  }

  space(number: string, name: string, boundary: Vec2[], props: Props = {}): Id {
    return this.run(createLevelElement<Space>(this.levelId, { kind: "Space", number, name, boundary, properties: props })).elementId;
  }

  // ─── Redes ─────────────────────────────────────────────────

  device(discipline: Discipline, symbol: string, at: Vec2, h: number, props: Props = {}, opts: { rot?: number; tag?: string; name?: string } = {}): Id {
    const d: Omit<Device, "id"> = {
      kind: "Device",
      discipline,
      symbol,
      position: at,
      rotation: opts.rot ?? 0,
      mountingHeight: h,
      properties: props,
      ...(opts.tag ? { tag: opts.tag } : {}),
      ...(opts.name ? { name: opts.name } : {}),
    };
    return this.run(createLevelElement<Device>(this.levelId, d)).elementId;
  }

  run_(discipline: Discipline, system: string, points: Vec2[], props: Props = {}, tag?: string): Id {
    const clean = dedupe(points);
    const r: Omit<Run, "id"> = { kind: "Run", discipline, system, points: clean, properties: props, ...(tag ? { tag } : {}) };
    return this.run(createLevelElement<Run>(this.levelId, r)).elementId;
  }

  note(discipline: Discipline, style: AnnotationStyle, points: Vec2[], text?: string, props: Props = {}, textSize?: number): Id {
    const a: Omit<Annotation, "id"> = { kind: "Annotation", discipline, style, points, properties: props, ...(text !== undefined ? { text } : {}), ...(textSize ? { textSize } : {}) };
    return this.run(createLevelElement<Annotation>(this.levelId, a)).elementId;
  }

  dim(a: Vec2, b: Vec2, offset: number, discipline: Discipline = "ARQ"): Id {
    return this.note(discipline, "dimension", [a, b], undefined, { offset });
  }

  circuit(c: Omit<Circuit, "id" | "kind">): Id {
    return this.run(createEntity<Circuit>({ kind: "Circuit", ...c }, "Crear circuito")).elementId;
  }

  sheet(s: Omit<Sheet, "id" | "kind">): Id {
    return this.run(createEntity<Sheet>({ kind: "Sheet", ...s }, "Crear plano")).elementId;
  }

  snapshot(): BimModel {
    return this.store.snapshot();
  }
}

function dedupe(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) out.push(p);
  }
  // Quita vértices colineales intermedios.
  const res: Vec2[] = [];
  for (const p of out) {
    while (res.length >= 2) {
      const a = res[res.length - 2]!;
      const b = res[res.length - 1]!;
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (Math.abs(cross) < 1e-9) res.pop();
      else break;
    }
    res.push(p);
  }
  return res;
}

/** Recorrido ortogonal entre dos puntos: primero en x y luego en y (o al revés). */
export function ortho(a: Vec2, b: Vec2, first: "x" | "y" = "x"): Vec2[] {
  return first === "x" ? [a, v(b.x, a.y), b] : [a, v(a.x, b.y), b];
}

/** Ordena puntos por vecino más cercano partiendo de `start` (para encadenar salidas de un circuito). */
export function chain(start: Vec2, pts: readonly Vec2[]): Vec2[] {
  const rest = [...pts];
  const out: Vec2[] = [];
  let cur = start;
  while (rest.length) {
    let bi = 0;
    let bd = Infinity;
    rest.forEach((p, i) => {
      const d = Math.abs(p.x - cur.x) + Math.abs(p.y - cur.y);
      if (d < bd) (bd = d), (bi = i);
    });
    cur = rest.splice(bi, 1)[0]!;
    out.push(cur);
  }
  return out;
}

/** Polilínea ortogonal que pasa por una secuencia de puntos. */
export function orthoPath(points: readonly Vec2[], first: "x" | "y" = "x"): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i === 0) out.push(points[0]!);
    else out.push(...ortho(points[i - 1]!, points[i]!, first).slice(1));
  }
  return out;
}

/** Rejilla de puntos centrada en un rectángulo (luminarias). */
export function grid(x0: number, x1: number, y0: number, y1: number, nx: number, ny: number): Vec2[] {
  const out: Vec2[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push(v(x0 + ((x1 - x0) * (i + 0.5)) / nx, y0 + ((y1 - y0) * (j + 0.5)) / ny));
  return out;
}

export const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)];

export { newId };
