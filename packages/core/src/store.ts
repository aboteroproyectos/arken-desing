// BimStore: el guardián de la Única Fuente de Verdad (Paso 2).
//
// Reglas:
//  - Nadie modifica el modelo directamente; todo entra por run() o por una sesión interactiva.
//  - Un comando solo emite operaciones (las 4 de abajo) dentro de una transacción.
//  - Un commit valida invariantes y produce un ChangeSet: una entrada de historial y un evento.
//
// Nota de implementación: la transacción aplica las operaciones directamente sobre el estado
// vivo y guarda el "antes" de cada una; si la validación falla, las revierte. Como el núcleo es
// de un solo hilo y los eventos solo se emiten al confirmar, desde fuera es equivalente a un
// borrador aislado, pero mucho más simple y rápido.

import { MutableIndices, type Indices } from "./indices";
import { validate, type InvariantViolation } from "./invariants";
import { relationParticipants, type BimModel, type Entity, type Id, type Relation } from "./model";
import type { ModelReader } from "./queries";

// ─── Operaciones de bajo nivel (las únicas 4 que existen) ───
export type Op =
  | { readonly type: "putEntity"; readonly entity: Entity }
  | { readonly type: "deleteEntity"; readonly id: Id }
  | { readonly type: "putRelation"; readonly relation: Relation }
  | { readonly type: "deleteRelation"; readonly id: Id };

export type AppliedOp =
  | { readonly target: "entity"; readonly id: Id; readonly before: Entity | null; readonly after: Entity | null }
  | { readonly target: "relation"; readonly id: Id; readonly before: Relation | null; readonly after: Relation | null };

export interface ChangeSet {
  readonly id: Id;
  readonly label: string;
  readonly ops: readonly AppliedOp[];
  readonly timestamp: number;
}

export interface ChangeEvent {
  readonly changeSetId: Id | null;
  /** Ids de entidades. Los oyentes deben tratar `added` y `modified` como "insertar o actualizar". */
  readonly added: readonly Id[];
  readonly modified: readonly Id[];
  readonly removed: readonly Id[];
  readonly preview: boolean;
  /** true cuando se cargó un modelo nuevo entero: los oyentes deben reconstruirlo todo. */
  readonly reset: boolean;
  readonly source: "run" | "undo" | "redo" | "interactive" | "load";
}

export interface Transaction extends ModelReader {
  apply(op: Op): void;
  readonly touched: ReadonlySet<Id>;
}

export interface Command {
  readonly label: string;
  execute(tx: Transaction): void;
}

export type CommitResult =
  | { readonly ok: true; readonly changeSet: ChangeSet | null }
  | { readonly ok: false; readonly violations: readonly InvariantViolation[] };

export interface InteractiveSession {
  /** Reemplaza la vista previa por el resultado de este comando (p. ej. en cada movimiento del ratón). */
  update(cmd: Command): CommitResult;
  /** Valida y confirma: un solo paso de deshacer. Si falla, la sesión sigue abierta. */
  commit(): CommitResult;
  /** Descarta todo sin dejar rastro (tecla Esc). */
  cancel(): void;
  readonly active: boolean;
}

export type ChangeListener = (e: ChangeEvent) => void;

export function newId(): Id {
  return globalThis.crypto.randomUUID();
}

export function emptyModel(): BimModel {
  return { schemaVersion: 1, entities: {}, relations: {} };
}

export class BimStore implements ModelReader {
  private ents = new Map<Id, Entity>();
  private rels = new Map<Id, Relation>();
  private idx = new MutableIndices();
  private readonly undoStack: ChangeSet[] = [];
  private readonly redoStack: ChangeSet[] = [];
  private readonly listeners = new Set<ChangeListener>();
  private busy = false;
  private session: SessionImpl | null = null;

  constructor(model: BimModel = emptyModel()) {
    this.loadSilently(model);
  }

  // ─── Lectura ──────────────────────────────────────────────
  get indices(): Indices {
    return this.idx;
  }
  getEntity(id: Id): Entity | undefined {
    return this.ents.get(id);
  }
  getRelation(id: Id): Relation | undefined {
    return this.rels.get(id);
  }
  entities(): IterableIterator<Entity> {
    return this.ents.values();
  }
  relations(): IterableIterator<Relation> {
    return this.rels.values();
  }

  // ─── Escritura ────────────────────────────────────────────
  run(cmd: Command): CommitResult {
    this.assertIdle();
    const result = this.execute(cmd);
    if (!result.ok) return result;
    const { ops } = result;
    const violations = validate(this, touchedIds(ops));
    if (violations.length > 0) {
      this.revert(ops);
      return { ok: false, violations };
    }
    return { ok: true, changeSet: this.commitOps(cmd.label, ops, "run") };
  }

  beginInteractive(label: string): InteractiveSession {
    this.assertIdle();
    this.session = new SessionImpl(this, label);
    return this.session;
  }

  undo(): ChangeSet | undefined {
    this.assertIdle();
    const cs = this.undoStack.pop();
    if (!cs) return undefined;
    this.revert(cs.ops);
    this.redoStack.push(cs);
    this.emit(eventFromOps(cs.id, invertOps(cs.ops), this, false, "undo"));
    return cs;
  }

  redo(): ChangeSet | undefined {
    this.assertIdle();
    const cs = this.redoStack.pop();
    if (!cs) return undefined;
    for (const op of cs.ops) this.write(op.target, op.id, op.after);
    this.undoStack.push(cs);
    this.emit(eventFromOps(cs.id, cs.ops, this, false, "redo"));
    return cs;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }
  get redoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  load(model: BimModel): void {
    this.assertIdle();
    this.loadSilently(model);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit({
      changeSetId: null,
      added: [...this.ents.keys()],
      modified: [],
      removed: [],
      preview: false,
      reset: true,
      source: "load",
    });
  }

  snapshot(): BimModel {
    return {
      schemaVersion: 1,
      entities: Object.fromEntries(this.ents),
      relations: Object.fromEntries(this.rels),
    };
  }

  /** Solo para tests: índices incrementales vs. reconstruidos desde cero. */
  debugIndicesMatchRebuild(): boolean {
    const rebuilt = MutableIndices.fromRelations(this.rels.values());
    return JSON.stringify(rebuilt.dump()) === JSON.stringify(this.idx.dump());
  }

  // ─── Internos (usados también por la sesión interactiva) ──
  /** @internal */
  execute(cmd: Command): { ok: true; ops: AppliedOp[] } | { ok: false; violations: InvariantViolation[] } {
    const ops: AppliedOp[] = [];
    const touched = new Set<Id>();
    const tx: Transaction = {
      apply: (op) => {
        const applied = this.applyOp(op);
        ops.push(applied);
        touched.add(applied.id);
      },
      touched,
      getEntity: (id) => this.getEntity(id),
      getRelation: (id) => this.getRelation(id),
      entities: () => this.entities(),
      relations: () => this.relations(),
      indices: this.idx,
    };
    this.busy = true;
    try {
      cmd.execute(tx);
      return { ok: true, ops };
    } catch (err) {
      this.revert(ops);
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, violations: [{ rule: "command-error", entityIds: [], message }] };
    } finally {
      this.busy = false;
    }
  }

  /** @internal */
  revert(ops: readonly AppliedOp[]): void {
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i]!;
      this.write(op.target, op.id, op.before);
    }
  }

  /** @internal */
  commitOps(label: string, ops: AppliedOp[], source: ChangeEvent["source"]): ChangeSet | null {
    if (ops.length === 0) return null;
    const cs: ChangeSet = { id: newId(), label, ops, timestamp: Date.now() };
    this.undoStack.push(cs);
    this.redoStack.length = 0;
    this.emit(eventFromOps(cs.id, ops, this, false, source));
    return cs;
  }

  /** @internal */
  emit(e: ChangeEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** @internal */
  endSession(): void {
    this.session = null;
  }

  private assertIdle(): void {
    if (this.busy) throw new Error("No se puede modificar el modelo desde dentro de un comando.");
    if (this.session) throw new Error("Hay una sesión interactiva abierta: confírmala o cancélala primero.");
  }

  private applyOp(op: Op): AppliedOp {
    switch (op.type) {
      case "putEntity": {
        const before = this.ents.get(op.entity.id) ?? null;
        this.write("entity", op.entity.id, op.entity);
        return { target: "entity", id: op.entity.id, before, after: op.entity };
      }
      case "deleteEntity": {
        const before = this.ents.get(op.id) ?? null;
        this.write("entity", op.id, null);
        return { target: "entity", id: op.id, before, after: null };
      }
      case "putRelation": {
        const before = this.rels.get(op.relation.id) ?? null;
        this.write("relation", op.relation.id, op.relation);
        return { target: "relation", id: op.relation.id, before, after: op.relation };
      }
      case "deleteRelation": {
        const before = this.rels.get(op.id) ?? null;
        this.write("relation", op.id, null);
        return { target: "relation", id: op.id, before, after: null };
      }
    }
  }

  /** Único punto donde cambia el estado. Mantiene los índices al día. */
  private write(target: "entity" | "relation", id: Id, value: Entity | Relation | null): void {
    if (target === "entity") {
      if (value) this.ents.set(id, value as Entity);
      else this.ents.delete(id);
      return;
    }
    const old = this.rels.get(id);
    if (old) this.idx.remove(old);
    if (value) {
      this.rels.set(id, value as Relation);
      this.idx.add(value as Relation);
    } else {
      this.rels.delete(id);
    }
  }

  private loadSilently(model: BimModel): void {
    this.ents = new Map(Object.entries(model.entities));
    this.rels = new Map(Object.entries(model.relations));
    this.idx = MutableIndices.fromRelations(this.rels.values());
  }
}

class SessionImpl implements InteractiveSession {
  private ops: AppliedOp[] = [];
  private lastIds = new Set<Id>();
  active = true;

  constructor(
    private readonly store: BimStore,
    private readonly label: string,
  ) {}

  update(cmd: Command): CommitResult {
    this.assertActive();
    this.store.revert(this.ops);
    this.ops = [];
    const result = this.store.execute(cmd);
    if (result.ok) this.ops = result.ops;
    this.emitPreview();
    if (!result.ok) return result;
    return { ok: true, changeSet: null };
  }

  commit(): CommitResult {
    this.assertActive();
    const violations = validate(this.store, touchedIds(this.ops));
    if (violations.length > 0) return { ok: false, violations };
    this.close();
    // Las vistas ya muestran el estado final; el evento definitivo marca preview: false.
    return { ok: true, changeSet: this.store.commitOps(this.label, this.ops, "interactive") };
  }

  cancel(): void {
    if (!this.active) return;
    this.store.revert(this.ops);
    this.ops = [];
    this.emitPreview();
    this.close();
  }

  private emitPreview(): void {
    // Ids afectados por la vista previa anterior y por la nueva: todos deben refrescarse.
    const ids = new Set([...this.lastIds, ...affectedEntityIds(this.ops)]);
    this.lastIds = new Set(affectedEntityIds(this.ops));
    const modified: Id[] = [];
    const removed: Id[] = [];
    for (const id of ids) (this.store.getEntity(id) ? modified : removed).push(id);
    this.store.emit({ changeSetId: null, added: [], modified, removed, preview: true, reset: false, source: "interactive" });
  }

  private close(): void {
    this.active = false;
    this.store.endSession();
  }

  private assertActive(): void {
    if (!this.active) throw new Error("La sesión interactiva ya terminó.");
  }
}

// ─── Utilidades sobre listas de operaciones ─────────────────

function touchedIds(ops: readonly AppliedOp[]): Set<Id> {
  return new Set(ops.map((o) => o.id));
}

function invertOps(ops: readonly AppliedOp[]): AppliedOp[] {
  return [...ops].reverse().map((o) => ({ ...o, before: o.after, after: o.before }) as AppliedOp);
}

/** Entidades cambiadas + participantes de las relaciones cambiadas. */
function affectedEntityIds(ops: readonly AppliedOp[]): Set<Id> {
  const ids = new Set<Id>();
  for (const o of ops) {
    if (o.target === "entity") ids.add(o.id);
    else for (const r of [o.before, o.after]) if (r) for (const p of relationParticipants(r)) ids.add(p);
  }
  return ids;
}

function eventFromOps(
  changeSetId: Id,
  ops: readonly AppliedOp[],
  reader: ModelReader,
  preview: boolean,
  source: ChangeEvent["source"],
): ChangeEvent {
  // Estado inicial y final de cada entidad tocada directamente.
  const first = new Map<Id, Entity | null>();
  const last = new Map<Id, Entity | null>();
  for (const o of ops) {
    if (o.target !== "entity") continue;
    if (!first.has(o.id)) first.set(o.id, o.before);
    last.set(o.id, o.after);
  }
  const added: Id[] = [];
  const modified: Id[] = [];
  const removed: Id[] = [];
  for (const [id, before] of first) {
    const after = last.get(id) ?? null;
    if (!before && after) added.push(id);
    else if (before && !after) removed.push(id);
    else if (before && after && before !== after) modified.push(id);
  }
  // Las entidades que participan en relaciones cambiadas también "cambiaron" para las vistas.
  const seen = new Set([...added, ...modified, ...removed]);
  for (const id of affectedEntityIds(ops)) {
    if (!seen.has(id) && reader.getEntity(id)) {
      modified.push(id);
      seen.add(id);
    }
  }
  return { changeSetId, added, modified, removed, preview, reset: false, source };
}
