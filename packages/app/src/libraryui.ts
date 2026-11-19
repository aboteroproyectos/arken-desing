// Ventana de la biblioteca de proyectos: fichas con miniatura de planta, datos precisos y acciones.

import type { BimModel } from "@arken/core";
import { deleteProject, getProject, listProjects, newId, persistent, projectName, putProject, summarize, type LibRecord } from "./library";

export interface LibraryHost {
  /** Id de la ficha del proyecto abierto, si está en la biblioteca. */
  currentId(): string | undefined;
  /** Guarda el proyecto abierto en la biblioteca (nueva ficha o actualiza la suya). */
  saveCurrent(): Promise<void>;
  /** Abre una ficha; false si el usuario cancela el reemplazo. */
  open(r: LibRecord): Promise<boolean>;
  thumbnail(m: BimModel): string;
  download(r: LibRecord): void;
  importFile(): void;
  say(msg: string, ok?: boolean): void;
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const m2 = (n: number) => n.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fecha(t: number): string {
  const d = new Date(t);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getDate())} ${MESES[d.getMonth()]} ${d.getFullYear()} · ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

const TIPOS: Record<string, string> = { "contemporáneo": "Casa contemporánea tropical", minimalista: "Casa minimalista", neocolonial: "Casa hacienda", brutalismo: "Casa brutalista", "casa de montaña": "Casa de montaña", "casa de playa": "Casa de playa" };
/** Ficha nueva a partir de un modelo. */
export function makeRecord(model: BimModel, origen: string, thumb: string, nombre?: string): LibRecord {
  const now = Date.now();
  const resumen = summarize(model);
  let n = nombre ?? projectName(model);
  // Nombre genérico del asistente: se nombra por lo que es, para distinguirla en la biblioteca.
  if (!nombre && /^(casa nueva|proyecto( sin nombre)?)$/i.test(n)) {
    const tipo = Object.entries(TIPOS).find(([k]) => resumen.estilo.toLowerCase().startsWith(k))?.[1] ?? "Casa";
    const planta = resumen.huella === "Rectangular" ? "" : resumen.huella === "Cuadrada con patio" ? " con patio central" : ` ${resumen.huella.replace(/^En /, "en ")}`;
    n = `${tipo}${planta} · ${Math.round(resumen.area)} m²`;
  }
  return { id: newId(), nombre: n, creado: now, actualizado: now, origen, resumen, miniatura: thumb, modelo: model };
}

export function showLibrary(host: LibraryHost): void {
  const box = document.createElement("div");
  box.className = "modal lib";
  box.innerHTML = `<div class="lib-card">
  <header class="lib-head">
    <div class="lib-title"><span class="lib-eyebrow">ARKEN 360 · Biblioteca</span><h2>Proyectos</h2><p class="lib-stats"></p></div>
    <div class="lib-tools">
      <input class="lib-search" type="search" placeholder="Buscar por nombre, estilo o planta" aria-label="Buscar proyectos">
      <select class="lib-sort" aria-label="Ordenar">
        <option value="rec">Más recientes</option><option value="nom">Nombre A–Z</option><option value="area">Mayor área</option><option value="old">Más antiguos</option>
      </select>
      <button class="lib-btn" data-a="save">Guardar el proyecto abierto</button>
      <button class="lib-btn ghost" data-a="import">Importar .arken.json</button>
      <button class="lib-btn ghost" data-a="x" aria-label="Cerrar la biblioteca">Cerrar</button>
    </div>
  </header>
  <p class="lib-note"></p>
  <div class="lib-grid" role="list"></div>
</div>`;
  const grid = box.querySelector<HTMLDivElement>(".lib-grid")!;
  const stats = box.querySelector<HTMLParagraphElement>(".lib-stats")!;
  const note = box.querySelector<HTMLParagraphElement>(".lib-note")!;
  const search = box.querySelector<HTMLInputElement>(".lib-search")!;
  const sort = box.querySelector<HTMLSelectElement>(".lib-sort")!;
  let all: LibRecord[] = [];

  async function refresh(): Promise<void> {
    all = await listProjects();
    const area = all.reduce((t, r) => t + r.resumen.area, 0);
    const planos = all.reduce((t, r) => t + r.resumen.planos, 0);
    stats.innerHTML = `<b>${all.length}</b> ${all.length === 1 ? "proyecto" : "proyectos"} · <b>${m2(area)}</b> m² diseñados · <b>${planos}</b> planos`;
    if (!(await persistent())) note.textContent = "Este navegador no permite guardar en el equipo: la biblioteca dura mientras la página esté abierta. Descargue cada proyecto para conservarlo.";
    render();
  }
  function render(): void {
    const q = search.value.trim().toLowerCase();
    let list = all.filter((r) => !q || `${r.nombre} ${r.resumen.estilo} ${r.resumen.huella} ${r.origen}`.toLowerCase().includes(q));
    const s = sort.value;
    list = [...list].sort((a, b) =>
      s === "nom" ? a.nombre.localeCompare(b.nombre, "es") : s === "area" ? b.resumen.area - a.resumen.area : s === "old" ? a.creado - b.creado : b.actualizado - a.actualizado,
    );
    const cur = host.currentId();
    grid.innerHTML = list.length
      ? list.map((r, i) => card(r, r.id === cur, i)).join("")
      : `<div class="lib-empty"><span class="lib-eyebrow">${all.length ? "Sin resultados" : "Biblioteca vacía"}</span><p>${all.length ? "Ningún proyecto coincide con la búsqueda." : "Cada casa que diseñe con «Diseñar casa» se guarda aquí sola."}</p></div>`;
  }
  function card(r: LibRecord, open: boolean, i: number): string {
    const s = r.resumen;
    const row = (k: string, v: string) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    return `<article class="lib-item${open ? " open" : ""}" role="listitem" data-id="${r.id}">
  <div class="lib-thumb">${r.miniatura ? `<img alt="Planta del primer piso de ${esc(r.nombre)}" src="${r.miniatura}">` : ""}<span class="lib-no">N.º ${String(i + 1).padStart(3, "0")}</span>${open ? `<span class="lib-open">Abierto</span>` : ""}</div>
  <div class="lib-body">
    <h3 title="${esc(r.nombre)}">${esc(r.nombre)}</h3>
    <p class="lib-sub">${esc(s.estilo)}</p>
    <dl class="lib-specs">
      ${row("Área", `${m2(s.area)} m²`)}${row("Planta", esc(s.huella))}
      ${row("Pisos", String(s.pisos))}${row("Habitaciones", String(s.habitaciones))}
      ${row("Baños", String(s.banos))}${row("Cubierta", esc(s.cubierta))}
      ${row("Espacios", String(s.espacios))}${row("Planos", String(s.planos))}
    </dl>
    <p class="lib-meta">${esc(r.origen)} · Creado ${fecha(r.creado)}${r.actualizado - r.creado > 60000 ? `<br>Modificado ${fecha(r.actualizado)}` : ""}</p>
    <div class="lib-acts">
      <button class="lib-btn" data-a="open">${open ? "Volver al proyecto" : "Abrir"}</button>
      <button class="lib-btn ghost" data-a="ren">Renombrar</button>
      <button class="lib-btn ghost" data-a="dup">Duplicar</button>
      <button class="lib-btn ghost" data-a="dl">Descargar</button>
      <button class="lib-btn ghost danger" data-a="del" aria-label="Eliminar ${esc(r.nombre)}">Eliminar</button>
    </div>
  </div>
</article>`;
  }
  function ask(title: string, text: string, okLabel: string, value?: string): Promise<string | null> {
    return new Promise((resolve) => {
      const d = document.createElement("div");
      d.className = "modal confirm";
      d.innerHTML = `<div class="modal-card ask"><div class="modal-bar"><b>${esc(title)}</b></div><div class="ask-body"><p>${text}</p>${value !== undefined ? `<input class="lib-input" value="${esc(value)}" maxlength="80">` : ""}<div class="assist-row"><button class="primary" data-ok="1">${esc(okLabel)}</button><button data-ok="0">Cancelar</button></div></div></div>`;
      const input = d.querySelector<HTMLInputElement>(".lib-input");
      const done = (ok: boolean) => {
        d.remove();
        resolve(ok ? (input ? input.value.trim() : "") : null);
      };
      d.addEventListener("click", (ev) => {
        const ok = (ev.target as HTMLElement).closest<HTMLElement>("[data-ok]")?.dataset.ok;
        if (ok !== undefined) done(ok === "1");
        else if (ev.target === d) done(false);
      });
      input?.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") done(true);
        if (ev.key === "Escape") done(false);
      });
      document.body.appendChild(d);
      (input ?? d.querySelector<HTMLButtonElement>("[data-ok='1']")!).focus();
      input?.select();
    });
  }

  box.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-a]");
    if (ev.target === box) return close();
    if (!btn) return;
    const a = btn.dataset.a;
    if (a === "x") return close();
    if (a === "save") {
      await host.saveCurrent();
      return refresh();
    }
    if (a === "import") {
      close();
      return host.importFile();
    }
    const id = btn.closest<HTMLElement>("[data-id]")?.dataset.id;
    const r = id ? await getProject(id) : undefined;
    if (!r) return;
    if (a === "open") {
      if (r.id === host.currentId()) return close();
      if (await host.open(r)) close();
    } else if (a === "ren") {
      const n = await ask("Renombrar proyecto", "Nuevo nombre del proyecto en la biblioteca:", "Guardar", r.nombre);
      if (!n) return;
      r.nombre = n;
      r.actualizado = Date.now();
      await putProject(r);
      await refresh();
    } else if (a === "dup") {
      const c = makeRecord(r.modelo, `Copia de «${r.nombre}»`, r.miniatura, `${r.nombre} (copia)`);
      await putProject(c);
      host.say(`Proyecto duplicado: ${c.nombre}.`, true);
      await refresh();
    } else if (a === "dl") host.download(r);
    else if (a === "del") {
      const ok = await ask("Eliminar proyecto", `Se eliminará <b>${esc(r.nombre)}</b> de la biblioteca de este equipo. No se puede deshacer; si quiere conservarlo, descárguelo antes.`, "Eliminar");
      if (ok === null) return;
      await deleteProject(r.id);
      host.say(`Proyecto eliminado de la biblioteca: ${r.nombre}.`, true);
      await refresh();
    }
  });
  search.addEventListener("input", render);
  sort.addEventListener("change", render);
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && !document.querySelector(".modal.confirm")) close();
  };
  function close(): void {
    document.removeEventListener("keydown", onKey);
    box.remove();
  }
  document.addEventListener("keydown", onKey);
  document.body.appendChild(box);
  void refresh();
  search.focus();
}
