// Asistente de diseño: el usuario describe la casa con sus palabras, el programa le hace las
// preguntas que faltan y diseña la casa completa con sus planos. Todo corre en el navegador con
// reglas de diseño: no usa ninguna conexión a inteligencia artificial.

import { summarize } from "./library";
import type { BimModel } from "@arken/core";
import {
  QUESTIONS,
  STYLES,
  answerText,
  completeProgram,
  describeProgram,
  designHouse,
  nextQuestion,
  parseDescription,
  reviewDesign,
  type ProgramDraft,
  type Question,
  type Review,
} from "@arken/projects";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export interface AssistantHost {
  /** Carga el modelo diseñado en el editor (pide confirmación si hay cambios). Devuelve false si el usuario cancela. */
  load(model: BimModel, msg: string): Promise<boolean>;
  /** Abre el formulario anterior para variantes de la casa Lote 01. */
  openLote01Variant(): void;
}

export function showDesignAssistant(host: AssistantHost): void {
  let draft: ProgramDraft = {};
  let understood: string[] = [];
  const asked: Question[] = [];
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `<div class="modal-card assist"><div class="modal-bar"><b>Asistente de diseño</b><span></span><button class="primary" data-a="go">Diseñar la casa</button><button data-a="x">Cerrar</button></div>
<div class="assist-body">
  <section class="assist-main">
    <p class="muted">Describa la casa que quiere con sus palabras. ARKEN DISEÑO entiende lo que escribe, le hace las preguntas que faltan y diseña la casa completa: plantas, cubierta, fachadas en el estilo elegido, cortes, acabados, puertas, ventanas, clósets y muebles, eléctricas, cuadros y memorias. Todo se calcula con reglas de diseño dentro del programa, sin conexión a inteligencia artificial.</p>
    <textarea class="assist-desc" rows="3" placeholder="Ejemplo: casa campestre contemporánea de dos pisos, 4 habitaciones, estudio, cocina abierta con isla, garaje para 2 carros con cargador eléctrico, techo a cuatro aguas, lote de 25 x 40, unos 350 m²"></textarea>
    <div class="assist-row"><button class="primary" data-a="parse">Entender la descripción</button><span class="assist-said"></span></div>
    <div class="assist-q"></div>
    <div class="assist-log"></div>
  </section>
  <aside class="assist-side">
    <h3>Programa de la casa</h3>
    <ul class="assist-prog"></ul>
    <p class="muted small">Lo que aún no ha definido se completa con la recomendación del diseño. Puede pulsar «Diseñar la casa» en cualquier momento.</p>
    <hr><button class="link" data-a="lote01">Variante de la casa Lote 01 por medidas…</button>
  </aside>
</div></div>`;
  const $ = <T extends HTMLElement>(s: string) => box.querySelector<T>(s)!;
  const qBox = $(".assist-q");
  const said = $(".assist-said");
  const log = $(".assist-log");

  const render = () => {
    const p = completeProgram(draft);
    $(".assist-prog").innerHTML = describeProgram(p).map((l) => `<li>${esc(l)}</li>`).join("");
    said.textContent = understood.length ? `Entendí: ${understood.join(" · ")}` : "";
    log.innerHTML = asked.length ? `<h4>Respuestas</h4><ol>${asked.map((q) => `<li><span>${esc(q.text)}</span> <b>${esc(answerLabel(q, draft))}</b> <button class="link" data-redo="${q.key}">cambiar</button></li>`).join("")}</ol>` : "";
    const q = nextQuestion(draft);
    if (!q) {
      qBox.innerHTML = `<div class="assist-card done"><b>Ya tengo todo lo necesario.</b><p>Revise el programa a la derecha y pulse <b>Diseñar la casa</b>.</p></div>`;
      return;
    }
    const n = QUESTIONS.filter((x) => !x.when || x.when(draft)).findIndex((x) => x.key === q.key) + 1;
    const total = QUESTIONS.filter((x) => !x.when || x.when(draft)).length;
    const opts = q.options
      .map((o, i) => {
        const st = q.key === "estilo" ? STYLES[o.patch.estilo!] : undefined;
        return st
          ? `<button class="opt style" data-opt="${i}"><b>${esc(st.name)}</b><small>${esc(st.summary)}</small><small class="muted">${esc(st.places)}</small></button>`
          : `<button class="opt" data-opt="${i}">${esc(o.label)}</button>`;
      })
      .join("");
    const free = q.input ? `<div class="assist-row"><input class="assist-free" placeholder="${q.input === "lote" ? "frente x fondo, p. ej. 20 x 30" : q.input === "number" ? "Escriba un número" : "Escriba la respuesta"}"><button data-a="free">Responder</button></div>` : "";
    qBox.innerHTML = `<div class="assist-card"><small class="muted">Pregunta ${n} de ${total}</small><h3>${esc(q.text)}</h3>${q.help ? `<p class="muted">${esc(q.help)}</p>` : ""}<div class="opts ${q.key === "estilo" ? "styles" : ""}">${opts}</div>${free}<div class="assist-row"><button class="link" data-a="skip">Dejar la recomendación del diseño</button><span class="assist-err"></span></div></div>`;
    qBox.querySelector<HTMLInputElement>(".assist-free")?.focus();
  };

  const answer = (q: Question, patch: ProgramDraft | undefined) => {
    if (!patch) {
      qBox.querySelector<HTMLElement>(".assist-err")!.textContent = "No entendí la respuesta; elija una opción o escríbala de otra forma.";
      return;
    }
    draft = { ...draft, ...patch };
    if (!asked.some((x) => x.key === q.key)) asked.push(q);
    render();
  };

  box.addEventListener("click", async (ev) => {
    const t = ev.target as HTMLElement;
    const a = t.closest<HTMLElement>("[data-a]")?.dataset.a;
    const q = nextQuestion(draft);
    if (ev.target === box || a === "x") return box.remove();
    if (a === "lote01") return box.remove(), host.openLote01Variant();
    if (a === "parse") {
      const r = parseDescription($<HTMLTextAreaElement>(".assist-desc").value);
      draft = { ...draft, ...r.draft };
      understood = r.understood.length ? [...r.understood] : ["no encontré datos de la casa; responda las preguntas"];
      return render();
    }
    const redo = t.closest<HTMLElement>("[data-redo]")?.dataset.redo;
    if (redo) {
      const next = { ...draft } as Record<string, unknown>;
      delete next[redo];
      if (redo === "loteFrente") delete next["loteFondo"];
      draft = next as ProgramDraft;
      asked.splice(asked.findIndex((x) => x.key === redo), 1);
      return render();
    }
    const opt = t.closest<HTMLElement>("[data-opt]")?.dataset.opt;
    if (q && opt !== undefined) return answer(q, q.options[Number(opt)]!.patch);
    if (q && a === "free") return answer(q, answerText(q, qBox.querySelector<HTMLInputElement>(".assist-free")!.value));
    if (q && a === "skip") {
      const def = completeProgram(draft)[q.key];
      return answer(q, { [q.key]: def, ...(q.key === "loteFrente" ? { loteFondo: completeProgram(draft).loteFondo } : {}) } as ProgramDraft);
    }
    if (a === "go") {
      try {
        const r = designHouse(draft);
        const rv = reviewDesign(r);
        const p = r.program;
        const area = summarize(r.model).area;
        if (!(await host.load(r.model, `Casa diseñada: ${STYLES[p.estilo].name}, ${p.pisos} ${p.pisos === 1 ? "piso" : "pisos"}, ${area.toFixed(0)} m². ${rv.summary}`))) return;
        box.remove();
        showReview(rv, `${p.proyecto} · ${STYLES[p.estilo].name} · ${area.toFixed(0)} m²`);
      } catch (err) {
        qBox.innerHTML = `<div class="assist-card"><b>No pude diseñar con esos datos.</b><p>${esc(err instanceof Error ? err.message : String(err))}</p></div>`;
      }
    }
  });
  box.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.target as HTMLElement).classList.contains("assist-free")) {
      const q = nextQuestion(draft);
      if (q) answer(q, answerText(q, (ev.target as HTMLInputElement).value));
    }
  });
  document.body.appendChild(box);
  render();
  $<HTMLTextAreaElement>(".assist-desc").focus();
}

function answerLabel(q: Question, d: ProgramDraft): string {
  const v = d[q.key];
  const o = q.options.find((o) => Object.entries(o.patch).every(([k, x]) => (d as Record<string, unknown>)[k] === x));
  if (o) return o.label;
  if (q.key === "loteFrente") return `${d.loteFrente} × ${d.loteFondo} m`;
  if (typeof v === "boolean") return v ? "Sí" : "No";
  return String(v ?? "");
}

/** Muestra la revisión de calidad del diseño. */
export function showReview(rv: Review, title: string): void {
  const box = document.createElement("div");
  box.className = "modal";
  const groups = [...new Set(rv.items.map((i) => i.area))];
  const icon = { ok: "✓", aviso: "!", falla: "✕" } as const;
  box.innerHTML = `<div class="modal-card review"><div class="modal-bar"><b>Revisión de calidad del diseño</b><span></span><button class="primary" data-a="x">Ver los planos</button></div>
<div class="review-body">
  <div class="review-head"><div class="score s${rv.score >= 85 ? "a" : rv.score >= 70 ? "b" : "c"}"><b>${rv.score}</b><small>/ 100</small></div><div><h3>${esc(rv.grade)}</h3><p>${esc(title)}</p><p class="muted">${esc(rv.summary)}</p></div></div>
  ${groups
    .map(
      (g) =>
        `<h4>${esc(g)}</h4><ul class="review-list">${rv.items
          .filter((i) => i.area === g)
          .map((i) => `<li class="${i.level}"><span class="ic">${icon[i.level]}</span><b>${esc(i.item)}</b> <span>${esc(i.detail)}</span></li>`)
          .join("")}</ul>`,
    )
    .join("")}
  <p class="muted small">La revisión aplica criterios de arquitectura residencial (áreas y proporciones, luz y ventilación natural, circulaciones, escaleras, baños, clósets, implantación) y las verificaciones de cálculo del modelo. Es una ayuda de diseño: cada proyecto debe revisarlo y firmarlo un arquitecto con matrícula profesional.</p>
</div></div>`;
  box.addEventListener("click", (ev) => {
    if (ev.target === box || (ev.target as HTMLElement).closest("[data-a=x]")) box.remove();
  });
  document.body.appendChild(box);
}
