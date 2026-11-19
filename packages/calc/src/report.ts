// Memorias de cálculo: un reporte HTML autocontenido con cada diseño del proyecto.
//
// Cada capítulo expone, en orden: normas y bases de diseño, datos de entrada, método y fórmulas,
// un cálculo tipo con los números reales del modelo, el cuadro de resultados y las verificaciones.
// Todo se calcula en el momento a partir del modelo, con las mismas funciones que llenan los cuadros
// de los planos, así el reporte y los planos nunca se contradicen.

import { polygonArea, polylineLength, type ModelReader, type Project, type Space } from "@arken/core";
import {
  areaTable,
  circuitResults,
  demandTable,
  gasTable,
  hunterFlow,
  lightingTable,
  loadScheduleTable,
  projectNumber,
  rainTable,
  renouardDrop,
  sanitaryTable,
  serviceDemand,
  solarResult,
  solarTable,
  waterTable,
  RESISTANCE_OHM_KM,
  AMPACITY_75C,
  type Table,
} from "./index";

export interface ReportOptions {
  /** Logo (data URL) para la portada y el encabezado. */
  readonly logo?: string;
  /** Fecha de emisión (texto). */
  readonly date?: string;
  /** Capítulos adicionales (por ejemplo, topografía y movimiento de tierras). */
  readonly extra?: readonly ReportChapter[];
}

export interface ReportChapter {
  readonly title: string;
  /** HTML del cuerpo (ya escapado). */
  readonly html: string;
  /** Verificaciones del capítulo, para el resumen. */
  readonly checks?: readonly Check[];
}

export interface Check {
  readonly item: string;
  readonly ok: boolean;
  readonly detail: string;
}

const f = (x: number, d = 2) => x.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });
export const escHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const e = escHtml;

function project(reader: ModelReader): Project | undefined {
  for (const x of reader.entities()) if (x.kind === "Project") return x;
  return undefined;
}

export function tableHtml(t: Table): string {
  const cols = t.columns.map((c, i) => `<th style="width:${((t.widths[i] ?? 1) / t.widths.reduce((a, b) => a + b, 0)) * 100}%">${e(c)}</th>`).join("");
  const rows = t.rows
    .map((r) => {
      const cls = [r.bold ? "b" : "", r.status === "revisar" ? "bad" : ""].filter(Boolean).join(" ");
      return `<tr${cls ? ` class="${cls}"` : ""}>${r.cells.map((c, i) => `<td${i > 0 && /^[-\d.,\s%]+$/.test(c) ? ' class="n"' : ""}>${c === "OK" ? '<span class="ok">OK</span>' : c === "REVISAR" ? '<span class="no">REVISAR</span>' : e(c)}</td>`).join("")}</tr>`;
    })
    .join("");
  const notes = (t.notes ?? []).map((n) => `<li>${e(n)}</li>`).join("");
  return `<figure class="tbl"><figcaption>${e(t.title)}</figcaption><table><thead><tr>${cols}</tr></thead><tbody>${rows}</tbody></table>${notes ? `<ul class="notes">${notes}</ul>` : ""}</figure>`;
}

const eq = (s: string) => `<div class="eq">${s}</div>`;
const p = (s: string) => `<p>${s}</p>`;
const h3 = (s: string) => `<h3>${e(s)}</h3>`;
const dl = (rows: [string, string][]) => `<table class="kv">${rows.map(([k, v]) => `<tr><th>${e(k)}</th><td>${v}</td></tr>`).join("")}</table>`;
const norms = (items: string[]) => `<ul class="norms">${items.map((n) => `<li>${e(n)}</li>`).join("")}</ul>`;

function tableChecks(t: Table, label: (cells: readonly string[]) => string): Check[] {
  return t.rows.filter((r) => r.status === "ok" || r.status === "revisar").map((r) => ({ item: label(r.cells), ok: r.status === "ok", detail: t.title }));
}

// ─── Capítulos ───────────────────────────────────────────────

function chapterProject(reader: ModelReader): ReportChapter {
  const pr = project(reader);
  const tb = pr?.titleBlock ?? {};
  const spaces = [...reader.entities()].filter((x): x is Space => x.kind === "Space");
  const inner = spaces.filter((s) => s.properties?.["exterior"] !== true).reduce((t, s) => t + polygonArea(s.boundary), 0);
  const built = projectNumber(reader, "area_construida_m2", 0);
  const W = projectNumber(reader, "casa_xmax", 0) - projectNumber(reader, "casa_xmin", 0);
  const L = projectNumber(reader, "casa_ymax", 0) - projectNumber(reader, "casa_ymin", 0);
  const sheets = [...reader.entities()].filter((x) => x.kind === "Sheet").length;
  const rows: [string, string][] = [
    ["Proyecto", e(tb["proyecto"] ?? pr?.name ?? "")],
    ["Localización", e(tb["localizacion"] ?? "")],
    ["Propietario", e(tb["propietario"] ?? "")],
    ["Diseño", e(`${tb["diseno"] ?? ""} ${tb["matricula"] ? "· " + tb["matricula"] : ""}`)],
  ];
  if (W > 0 && L > 0) rows.push(["Huella", `${f(W, 2)} m × ${f(L, 2)} m = ${f(W * L, 2)} m²`]);
  if (built > 0) rows.push(["Área construida cubierta", `${f(built, 2)} m²`]);
  rows.push(["Área útil interior", `${f(inner, 2)} m²`], ["Planos del juego", String(sheets)]);
  const roof = projectNumber(reader, "cubierta_pendiente_pct", 0);
  if (roof > 0) rows.push(["Cubierta", `metálica a una agua, pendiente ${f(roof, 0)} %, alero ${f(projectNumber(reader, "cubierta_alero_m", 0), 2)} m`]);
  return {
    title: "Datos generales del proyecto",
    html: dl(rows) + tableHtml(areaTable(reader)) + p("Las áreas se miden sobre la cara interior de los muros (área útil) y sobre el perímetro exterior de la envolvente (área construida)."),
  };
}

function chapterElectric(reader: ModelReader): ReportChapter {
  const results = circuitResults(reader);
  const panels = [...new Set(results.map((r) => r.circuit.panel))].sort();
  const d = serviceDemand(reader);
  let html = norms([
    "NTC 2050 (Código Eléctrico Colombiano): Sec. 210, 220, 240, 250 y 310.",
    "RETIE, Resolución 40117 de 2024 del Ministerio de Minas y Energía.",
    "Conductores de cobre THHN/THWN-2, ampacidad a 75 °C (NTC 2050 Tabla 310-16).",
  ]);
  html += h3("Método");
  html += p("Para cada circuito se suman las cargas de sus salidas y se calcula la corriente; se verifica que la protección cubra la corriente (125 % si la carga es continua), que el conductor quede protegido por el interruptor y que la caída de tensión no supere el 3 %.");
  html += eq("I = S / V") + eq("I<sub>req</sub> = 1,25 · I (carga continua) ≤ I<sub>prot</sub> ≤ I<sub>conductor</sub>");
  html += eq("ΔV % = 2 · Σ(I<sub>i</sub> · L<sub>i</sub>) · R / 1000 / V · 100");
  html += p("Las longitudes L<sub>i</sub> se miden sobre el recorrido dibujado desde el tablero hasta cada salida, más 2,5 m de bajada o subida en muro. R es la resistencia del conductor en Ω/km.");
  // Cálculo tipo: el circuito con mayor caída de tensión.
  const worst = [...results].sort((a, b) => b.dropPct - a.dropPct)[0];
  if (worst) {
    const c = worst.circuit;
    const R = RESISTANCE_OHM_KM[c.conductorAwg] ?? 6.6;
    const need = worst.currentA * (c.continuous ? 1.25 : 1);
    html += h3(`Cálculo tipo: circuito ${c.number} (${c.description})`);
    html += dl([
      ["Carga", `S = ${f(worst.loadVA, 0)} VA en ${worst.devices} salidas`],
      ["Corriente", `I = ${f(worst.loadVA, 0)} / ${c.voltage} = <b>${f(worst.currentA, 2)} A</b>`],
      ["Corriente requerida", `${c.continuous ? "1,25 × " + f(worst.currentA, 2) + " = " : ""}<b>${f(need, 2)} A</b> ≤ protección ${c.breakerA} A`],
      ["Conductor", `#${c.conductorAwg} AWG Cu, ampacidad ${AMPACITY_75C[c.conductorAwg] ?? "—"} A, R = ${f(R, 2)} Ω/km`],
      ["Longitud a la salida más lejana", `${f(worst.lengthM, 1)} m`],
      ["Caída de tensión", `<b>${f(worst.dropPct, 2)} %</b> ${worst.dropPct <= 3 ? "≤ 3 % (cumple)" : "> 3 % (revisar)"}`],
    ]);
  }
  for (const panel of panels) html += tableHtml(loadScheduleTable(reader, panel));
  html += h3("Acometida y totalizador");
  html += p("Carga de la vivienda por el método estándar de NTC 2050 Sec. 220: alumbrado general a 32 VA/m², 1 500 VA por circuito de pequeños artefactos y de lavandería, los primeros 3 000 VA al 100 % y el resto al 35 %; artefactos fijos al 75 % cuando son cuatro o más; cargadores de vehículo eléctrico al 100 % del límite de su gestión de carga.");
  html += tableHtml(demandTable(reader));
  html += eq(`I = ${f(d.demandVA, 0)} VA / 240 V = ${f(d.currentA, 1)} A → 1,1 × I = ${f(d.currentA * 1.1, 1)} A → totalizador 2P-${d.mainBreakerA} A`);
  const checks: Check[] = results.map((r) => ({ item: `Circuito ${r.circuit.number}`, ok: r.issues.length === 0, detail: r.issues.join("; ") || `I ${f(r.currentA, 1)} A, ΔV ${f(r.dropPct, 2)} %` }));
  return { title: "Instalaciones eléctricas", html, checks };
}

function chapterLighting(reader: ModelReader): ReportChapter {
  const t = lightingTable(reader);
  if (!t.rows.length) return { title: "Iluminación", html: p("El modelo no tiene espacios con nivel de iluminación objetivo.") };
  let html = norms(["RETILAP (Reglamento Técnico de Iluminación y Alumbrado Público), Tabla 410.1 de niveles de iluminancia.", "Método de los lúmenes (cavidad zonal)."]);
  html += h3("Método");
  html += eq("E = Φ · CU · FM / A");
  html += p("Φ es el flujo total de las luminarias dentro del espacio, CU el coeficiente de utilización del local, FM el factor de mantenimiento y A el área. Se acepta el espacio cuando E ≥ 90 % del nivel objetivo.");
  const first = t.rows[0]!;
  html += h3(`Cálculo tipo: ${first.cells[1]}`);
  html += eq(`E = ${first.cells[4]} lm × ${first.cells[6]} × ${f(projectNumber(reader, "factor_mantenimiento", 0.8), 2)} / ${first.cells[2]} m² = <b>${first.cells[7]} lx</b> (objetivo ${first.cells[8]} lx)`);
  html += tableHtml(t);
  return { title: "Iluminación", html, checks: tableChecks(t, (c) => `Iluminancia ${c[1]}`) };
}

function chapterWater(reader: ModelReader): ReportChapter {
  const t = waterTable(reader);
  const vmax = projectNumber(reader, "velocidad_max_m_s", 2);
  let html = norms(["NTC 1500 (Código colombiano de instalaciones hidráulicas y sanitarias).", "Método de Hunter (unidades de consumo) para el caudal probable."]);
  html += h3("Método");
  html += p("A cada aparato se le asignan unidades de consumo (UC); en cada tramo se suman las UC aguas abajo y se obtiene el caudal probable con la curva de Hunter para aparatos de tanque. El diámetro se elige para que la velocidad no supere el máximo de diseño.");
  html += eq("Q = f<sub>Hunter</sub>(ΣUC)") + eq("v = Q / (π · D<sub>i</sub>² / 4) ≤ " + f(vmax, 1) + " m/s");
  const r0 = t.rows[0];
  if (r0) {
    const uc = Number(r0.cells[2]!.replace(/\./g, "").replace(",", "."));
    html += h3(`Cálculo tipo: tramo ${r0.cells[0]}`);
    html += eq(`ΣUC = ${r0.cells[2]} → Q = ${f(hunterFlow(uc), 2)} L/s; Ø ${r0.cells[4]} (D<sub>i</sub> = ${r0.cells[5]} mm) → v = <b>${r0.cells[6]} m/s</b>`);
  }
  html += tableHtml(t);
  return { title: "Red hidráulica (agua fría y caliente)", html, checks: tableChecks(t, (c) => `Tramo AP ${c[0]}`) };
}

function chapterSanitary(reader: ModelReader): ReportChapter {
  const t = sanitaryTable(reader);
  const r = rainTable(reader);
  const i = projectNumber(reader, "lluvia_mm_h", 120);
  const c = projectNumber(reader, "coef_escorrentia", 0.95);
  let html = norms(["NTC 1500: unidades de descarga y capacidad de colectores horizontales.", "Método racional para aguas lluvias."]);
  html += h3("Aguas residuales");
  html += p("Cada aparato aporta unidades de descarga (UD). La capacidad de cada colector se toma de la tabla de NTC 1500 a pendiente 2 % y se ajusta a la pendiente real; un inodoro exige como mínimo Ø 3\" (máximo dos por colector de 3\") y la pendiente mínima es 1 %.");
  html += eq("UD<sub>máx</sub>(S) = UD<sub>máx</sub>(2 %) · √(S / 2)");
  html += tableHtml(t);
  html += h3("Aguas lluvias");
  html += eq("Q = C · i · A / 3600 &nbsp; [L/s, con i en mm/h y A en m²]");
  const r0 = r.rows[0];
  if (r0) html += eq(`Cálculo tipo (${e(r0.cells[0]!)}): Q = ${f(c, 2)} × ${f(i, 0)} × ${r0.cells[1]} / 3600 = <b>${r0.cells[2]} L/s</b>`);
  html += tableHtml(r);
  return { title: "Red sanitaria y aguas lluvias", html, checks: [...tableChecks(t, (x) => `Colector ${x[0]}`), ...tableChecks(r, (x) => `Aguas lluvias ${x[0]}`)] };
}

function chapterGas(reader: ModelReader): ReportChapter {
  const t = gasTable(reader);
  if (t.rows.length <= 1) return { title: "Red de gas", html: p("El modelo no tiene tramos de gas con potencia asignada.") };
  const pci = projectNumber(reader, "gas_pc_kwh_m3", 10.35);
  const s = projectNumber(reader, "gas_densidad_rel", 0.62);
  let html = norms(["NTC 2505 (instalaciones para suministro de gas en edificaciones residenciales).", "NTC 3631 (ventilación de recintos con artefactos a gas).", "Fórmula de Renouard lineal para baja presión."]);
  html += h3("Método");
  html += eq("Q = P / PC &nbsp; [m³/h]") + eq("ΔP = 23 200 · s · L<sub>e</sub> · Q<sup>1,82</sup> · D<sup>−4,82</sup> &nbsp; [mbar, D en mm]") + eq("L<sub>e</sub> = 1,2 · L (accesorios)");
  const runs = [...reader.entities()].filter((x) => x.kind === "Run" && x.discipline === "GAS" && typeof x.properties?.["kw"] === "number");
  const r0 = runs[0];
  if (r0 && r0.kind === "Run") {
    const kw = Number(r0.properties?.["kw"]);
    const di = Number(r0.properties?.["di_mm"] ?? 16);
    const L = polylineLength(r0.points) + Number(r0.properties?.["vertical_m"] ?? 0);
    const q = kw / pci;
    html += h3(`Cálculo tipo: tramo ${String(r0.properties?.["tramo"] ?? r0.tag ?? "")}`);
    html += eq(`Q = ${f(kw, 1)} / ${f(pci, 2)} = ${f(q, 3)} m³/h; L<sub>e</sub> = 1,2 × ${f(L, 2)} = ${f(L * 1.2, 2)} m; ΔP = <b>${f(renouardDrop(s, L * 1.2, q, di), 3)} mbar</b>`);
  }
  html += tableHtml(t);
  return { title: "Red de gas natural", html, checks: tableChecks(t, () => "Ruta crítica de gas") };
}

function chapterSolar(reader: ModelReader): ReportChapter {
  const r = solarResult(reader);
  if (!r.modules) return { title: "Energía solar fotovoltaica", html: p("El modelo no tiene módulos fotovoltaicos.") };
  const t = solarTable(reader);
  const beta = projectNumber(reader, "modulo_beta_voc_pct", -0.25);
  const tmin = projectNumber(reader, "temp_min_c", 5);
  const hsp = projectNumber(reader, "solar_hsp", 4.2);
  const pr = projectNumber(reader, "solar_pr", 0.8);
  let html = norms(["NTC 2050 Sec. 690 (sistemas solares fotovoltaicos).", "CREG 174 de 2021 (autogeneración a pequeña escala).", "RETIE."]);
  html += h3("Método");
  html += eq("V<sub>oc,frío</sub> = n · V<sub>oc</sub> · [1 + β · (T<sub>mín</sub> − 25)] ≤ V<sub>dc,máx</sub>") + eq("MPPT<sub>mín</sub> ≤ n · V<sub>mp</sub> ≤ MPPT<sub>máx</sub>") + eq("E<sub>mes</sub> = P<sub>pico</sub> · HSP · PR · 30");
  const s0 = r.strings[0];
  if (s0) html += eq(`Cálculo tipo (${s0.name}): ${s0.modules} × ${f(projectNumber(reader, "modulo_voc", 51.67), 2)} V × [1 + (${f(beta, 2)} %)(${f(tmin, 0)} − 25)] = <b>${f(s0.vocCold, 1)} V</b>`);
  html += eq(`E<sub>mes</sub> = ${f(r.kWp, 2)} kWp × ${f(hsp, 1)} h × ${f(pr, 2)} × 30 = <b>${f(r.monthlyKWh, 0)} kWh/mes</b>`);
  html += tableHtml(t);
  return { title: "Energía solar fotovoltaica", html, checks: tableChecks(t, (c) => `Cadena ${c[0]}`) };
}

// ─── Documento ───────────────────────────────────────────────

/** Capítulos de cálculo del modelo (sin los adicionales). */
export function reportChapters(reader: ModelReader): ReportChapter[] {
  return [chapterProject(reader), chapterElectric(reader), chapterLighting(reader), chapterWater(reader), chapterSanitary(reader), chapterGas(reader), chapterSolar(reader)];
}

export function calcReportHtml(reader: ModelReader, opts: ReportOptions = {}): string {
  const pr = project(reader);
  const tb = pr?.titleBlock ?? {};
  const chapters = [...reportChapters(reader), ...(opts.extra ?? [])];
  const checks = chapters.flatMap((c, i) => (c.checks ?? []).map((k) => ({ ...k, ch: i + 1 })));
  const bad = checks.filter((c) => !c.ok);
  const title = tb["proyecto"] ?? pr?.name ?? "Proyecto";
  const date = opts.date ?? tb["fecha"] ?? "";
  const logo = opts.logo ? `<img class="logo" src="${opts.logo}" alt="">` : "";
  const toc = chapters.map((c, i) => `<li><a href="#c${i + 1}">${i + 1}. ${e(c.title)}</a></li>`).join("");
  const summary =
    `<table class="sum"><thead><tr><th>Cap.</th><th>Verificación</th><th>Resultado</th><th>Estado</th></tr></thead><tbody>` +
    checks.map((c) => `<tr${c.ok ? "" : ' class="bad"'}><td>${c.ch}</td><td>${e(c.item)}</td><td>${e(c.detail)}</td><td>${c.ok ? '<span class="ok">CUMPLE</span>' : '<span class="no">REVISAR</span>'}</td></tr>`).join("") +
    `</tbody></table>`;
  const body = chapters.map((c, i) => `<section id="c${i + 1}"><h2><span>${i + 1}</span>${e(c.title)}</h2>${c.html}</section>`).join("");
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Memorias de cálculo · ${e(title)}</title>
<style>
:root{--navy:#142339;--navy2:#0b1525;--gold:#ba985b;--soft:#d9dde4;--ink:#1d2533;--muted:#5f6b7d}
*{box-sizing:border-box}body{margin:0;background:#eef0f4;color:var(--ink);font:13px/1.5 Arial,Helvetica,sans-serif}
.doc{max-width:900px;margin:0 auto;background:#fff;box-shadow:0 2px 18px rgba(20,35,57,.12)}
header.cover{background:linear-gradient(160deg,var(--navy),var(--navy2));color:#fff;padding:36px 40px 28px;border-bottom:5px solid var(--gold);display:flex;gap:24px;align-items:center}
header.cover .logo{width:92px;background:#fff;border-radius:10px;padding:6px}
header.cover h1{margin:0;font-size:26px;letter-spacing:.04em}header.cover .k{color:var(--gold);letter-spacing:.2em;font-size:11px;font-weight:bold}
header.cover p{margin:6px 0 0;color:#c9d0db}
main{padding:24px 40px 40px}
.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px}.meta div{border:1px solid var(--soft);border-radius:6px;padding:8px 10px}.meta b{display:block;font-size:10px;letter-spacing:.08em;color:var(--muted);text-transform:uppercase}
nav ol{columns:2;margin:6px 0 18px;padding-left:0;list-style:none}nav a{color:var(--navy);text-decoration:none}
h2{font-size:17px;color:var(--navy);border-bottom:2px solid var(--gold);padding-bottom:5px;margin:30px 0 10px;display:flex;gap:10px;align-items:center}
h2 span{background:var(--navy);color:#fff;border-radius:4px;min-width:26px;text-align:center;font-size:13px;padding:2px 6px}
h3{font-size:13.5px;color:var(--navy);margin:16px 0 6px}
.eq{font-family:"Cambria Math",Cambria,Georgia,serif;font-size:14px;background:#f6f4ee;border-left:3px solid var(--gold);padding:6px 12px;margin:6px 0}
ul.norms{margin:4px 0 8px;padding-left:18px;color:var(--muted)}
table{border-collapse:collapse;width:100%}figure.tbl{margin:12px 0}figcaption{background:var(--navy);color:#fff;font-weight:bold;font-size:11.5px;letter-spacing:.04em;padding:5px 8px}
figure table th{background:#e9ecf1;color:var(--navy);font-size:10.5px;text-align:left;padding:4px 5px;border:1px solid var(--soft)}
figure table td{font-size:11px;padding:3px 5px;border:1px solid var(--soft);vertical-align:top}td.n{text-align:right;font-variant-numeric:tabular-nums}
tr.b td{font-weight:bold;background:#f7f8fa}tr.bad td{background:#fdecea}
.ok{color:#1e7a3c;font-weight:bold}.no{color:#b3261e;font-weight:bold}
ul.notes{margin:4px 0 0;padding-left:18px;color:var(--muted);font-size:11px}
table.kv th{width:32%;text-align:left;color:var(--muted);font-weight:normal;padding:3px 8px 3px 0;border-bottom:1px solid #eef0f4}table.kv td{padding:3px 0;border-bottom:1px solid #eef0f4}
table.sum th{background:var(--navy);color:#fff;text-align:left;padding:5px;font-size:11px}table.sum td{border-bottom:1px solid var(--soft);padding:4px 5px;font-size:11px}
.verdict{margin:10px 0 18px;padding:10px 14px;border-radius:6px;font-weight:bold;${bad.length ? "background:#fdecea;color:#b3261e" : "background:#e8f4ec;color:#1e7a3c"}}
footer{border-top:1px solid var(--soft);color:var(--muted);font-size:11px;padding:12px 40px 20px}
@media print{body{background:#fff}.doc{box-shadow:none;max-width:none}section{break-inside:auto}h2{break-after:avoid}figure{break-inside:avoid}@page{size:A4;margin:16mm 14mm}}
</style></head><body><div class="doc">
<header class="cover">${logo}<div><div class="k">${e(tb["empresa"] ?? "ARKEN 360")} · ARKEN DISEÑO</div><h1>Memorias de cálculo</h1><p>${e(title)}</p></div></header>
<main>
<div class="meta"><div><b>Localización</b>${e(tb["localizacion"] ?? "")}</div><div><b>Diseño</b>${e(tb["diseno"] ?? "")} ${e(tb["matricula"] ?? "")}</div><div><b>Fecha · Revisión</b>${e(date)} · Rev. ${e(tb["revision"] ?? "0")}</div></div>
<nav><b>Contenido</b><ol>${toc}<li><a href="#resumen">${chapters.length + 1}. Resumen de verificaciones</a></li></ol></nav>
${body}
<section id="resumen"><h2><span>${chapters.length + 1}</span>Resumen de verificaciones</h2>
<div class="verdict">${checks.length - bad.length} de ${checks.length} verificaciones cumplen${bad.length ? `; ${bad.length} requieren revisión.` : ". El diseño cumple en todos los puntos verificados."}</div>
${summary}</section>
</main>
<footer>Generado con ARKEN DISEÑO a partir del modelo del proyecto. Los valores se recalculan cada vez que cambia el diseño; este documento refleja el modelo en la fecha de emisión. Debe ser revisado y firmado por el profesional responsable con matrícula vigente.</footer>
</div></body></html>`;
}
