// Biblioteca de proyectos: cada proyecto diseñado, generado o abierto queda guardado en este equipo
// (IndexedDB del navegador) con su ficha técnica y una miniatura de la planta del primer piso.

import type { BimModel } from "@arken/core";

export interface LibSummary {
  readonly estilo: string;
  readonly huella: string;
  readonly pisos: number;
  readonly area: number;
  readonly habitaciones: number;
  readonly banos: number;
  readonly planos: number;
  readonly espacios: number;
  readonly cubierta: string;
  readonly elementos: number;
}

export interface LibRecord {
  readonly id: string;
  nombre: string;
  readonly creado: number;
  actualizado: number;
  origen: string;
  resumen: LibSummary;
  miniatura: string;
  modelo: BimModel;
}

type Ent = { kind?: string; name?: string; titleBlock?: Record<string, string>; properties?: Record<string, unknown> };

const HUELLAS: Record<string, string> = { rectangular: "Rectangular", cuadrada: "Cuadrada con patio", L: "En L", T: "En T", U: "En U", X: "En cruz" };
const CUBIERTAS: Record<string, string> = { plana: "Plana", "una-agua": "Una agua", "dos-aguas": "Dos aguas", "cuatro-aguas": "Cuatro aguas" };

export function projectName(m: BimModel): string {
  const p = Object.values(m.entities as Record<string, Ent>).find((e) => e.kind === "Project");
  return (p?.titleBlock?.["proyecto"] || p?.name || "Proyecto sin nombre").trim();
}

/** Ficha técnica leída del modelo: solo cuenta lo que el modelo tiene, no supone nada. */
export function summarize(m: BimModel): LibSummary {
  const ents = Object.values(m.entities as Record<string, Ent>);
  const p = ents.find((e) => e.kind === "Project");
  const pp = p?.properties ?? {};
  const levels = ents.filter((e) => e.kind === "Level" && !/cubierta/i.test(e.name ?? ""));
  const spaces = ents.filter((e) => e.kind === "Space");
  let area = Number(pp["area_construida_m2"]) || 0;
  if (!area) area = levels.reduce((t, l) => t + (Number(l.properties?.["area_construida_m2"]) || 0), 0);
  const cub = String(pp["cubierta_tipo"] ?? "");
  return {
    estilo: String(pp["estilo_nombre"] ?? "Diseño a medida"),
    huella: HUELLAS[String(pp["huella"] ?? "rectangular")] ?? "Rectangular",
    pisos: Number(pp["pisos"]) || levels.length,
    area,
    habitaciones: spaces.filter((s) => /^(habitaci|alcoba|suite)/i.test(s.name ?? "")).length,
    banos: spaces.filter((s) => /^baño/i.test(s.name ?? "")).length,
    planos: ents.filter((e) => e.kind === "Sheet").length,
    espacios: spaces.length,
    cubierta: CUBIERTAS[cub] ?? (cub || (Number(pp["cubierta_pendiente_pct"]) ? `Pendiente ${Number(pp["cubierta_pendiente_pct"])} %` : "—")),
    elementos: ents.length,
  };
}

// ─── Almacenamiento ───────────────────────────────────────────
const DB = "arken-diseno-biblioteca";
const OS = "proyectos";
let dbp: Promise<IDBDatabase | null> | undefined;
const memory = new Map<string, LibRecord>();

function db(): Promise<IDBDatabase | null> {
  dbp ??= new Promise((resolve) => {
    try {
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(OS, { keyPath: "id" });
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(null);
      rq.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}
function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        if (!d) return reject(new Error("sin almacenamiento"));
        const r = fn(d.transaction(OS, mode).objectStore(OS));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

/** ¿Los proyectos quedan guardados en el equipo (true) o solo mientras la página está abierta (false)? */
export async function persistent(): Promise<boolean> {
  return (await db()) !== null;
}
export async function listProjects(): Promise<LibRecord[]> {
  let all: LibRecord[];
  try {
    all = await tx<LibRecord[]>("readonly", (s) => s.getAll() as IDBRequest<LibRecord[]>);
  } catch {
    all = [...memory.values()];
  }
  return all.sort((a, b) => b.actualizado - a.actualizado);
}
export async function getProject(id: string): Promise<LibRecord | undefined> {
  try {
    return await tx<LibRecord | undefined>("readonly", (s) => s.get(id) as IDBRequest<LibRecord | undefined>);
  } catch {
    return memory.get(id);
  }
}
export async function putProject(r: LibRecord): Promise<void> {
  try {
    await tx("readwrite", (s) => s.put(r));
  } catch {
    memory.set(r.id, r);
  }
}
export async function deleteProject(id: string): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(id));
  } catch {
    memory.delete(id);
  }
}
export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
