// Exportación de planos: SVG vectorial (imprimir / PDF), PNG de alta resolución y DXF R12.

import { PAPER_MM, type ModelReader, type Sheet, type Vec2 } from "@arken/core";
import { sheetTransform, type SheetGeometry } from "@arken/sheets";
import type { ElementPlanGeometry, PlanPrimitive } from "@arken/geometry";
import { FONT, TEXT_EM, imageFor, paintCanvas, preloadImages, primitivePoints, primitivesToSvg, resolvePaint, textColor, toDxf, type DxfEntity, type PaintMode } from "./paint";
import { PdfDocument, PdfPage, type Measure, type PdfImage } from "./pdf";
import type { Visible } from "./scene";

function paperXf(sheet: Sheet): { toPaper(p: Vec2): Vec2; mmPerM: number; toPaperUp(p: Vec2): Vec2 } {
  const { k, origin } = sheetTransform(sheet);
  const H = PAPER_MM[sheet.paper].h;
  return {
    mmPerM: 1 / k,
    toPaper: (p) => ({ x: (p.x - origin.x) / k, y: H - (p.y - origin.y) / k }),
    toPaperUp: (p) => ({ x: (p.x - origin.x) / k, y: (p.y - origin.y) / k }),
  };
}

/** Ventana del dibujo en mm de papel (y hacia abajo), ya recortada por el rótulo escalado. */
function paperClip(sheet: Sheet, geo: SheetGeometry): { x: number; y: number; w: number; h: number } {
  const xf = paperXf(sheet);
  const a = xf.toPaper({ x: geo.viewport.minX, y: geo.viewport.maxY });
  const b = xf.toPaper({ x: geo.viewport.maxX, y: geo.viewport.minY });
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

export function sheetSvg(model: ModelReader, sheet: Sheet, geo: SheetGeometry, items: readonly Visible[]): string {
  const { w, h } = PAPER_MM[sheet.paper];
  const xf = paperXf(sheet);
  const vp = paperClip(sheet, geo);
  const body = items.map((it) => primitivesToSvg(model, it.geom.primitives, xf, { background: it.background })).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" font-family='${FONT}'>
<title>${sheet.number} ${sheet.title}</title>
<defs><clipPath id="vp"><rect x="${vp.x}" y="${vp.y}" width="${vp.w}" height="${vp.h}"/></clipPath></defs>
<g id="hoja">
${primitivesToSvg(model, geo.primitives, xf)}
</g>
<g id="modelo" clip-path="url(#vp)">
${body}
</g>
</svg>`;
}

/** PNG del plano completo a `pxPerMm` píxeles por mm (8 ≈ 200 ppp). */
export async function sheetPng(model: ModelReader, sheet: Sheet, geo: SheetGeometry, items: readonly Visible[], pxPerMm = 8): Promise<Blob> {
  const { w, h } = PAPER_MM[sheet.paper];
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * pxPerMm);
  canvas.height = Math.round(h * pxPerMm);
  const ctx = canvas.getContext("2d")!;
  const xf0 = paperXf(sheet);
  const xf = { toScreen: (p: Vec2) => { const q = xf0.toPaper(p); return { x: q.x * pxPerMm, y: q.y * pxPerMm }; }, pxPerMm, pxPerM: pxPerMm * xf0.mmPerM };
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await preloadImages(geo.primitives);
  paintCanvas(ctx, model, geo.primitives, xf);
  const vp = paperClip(sheet, geo);
  ctx.save();
  ctx.beginPath();
  ctx.rect(vp.x * pxPerMm, vp.y * pxPerMm, vp.w * pxPerMm, vp.h * pxPerMm);
  ctx.clip();
  for (const it of items) paintCanvas(ctx, model, it.geom.primitives, xf, { background: it.background });
  ctx.restore();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo generar el PNG"))), "image/png"));
}

export function sheetDxf(model: ModelReader, sheet: Sheet, geo: SheetGeometry, items: readonly Visible[]): string {
  const xf0 = paperXf(sheet);
  const vp = geo.viewport;
  const inside = (b: { minX: number; minY: number; maxX: number; maxY: number }) => b.maxX >= vp.minX && b.minX <= vp.maxX && b.maxY >= vp.minY && b.minY <= vp.maxY;
  const ents: DxfEntity[] = geo.primitives.map((prim) => ({ layer: "ROTULO", prim }));
  for (const it of items) {
    if (!inside(it.geom.box)) continue;
    const layer = it.background ? "FONDO" : `${it.geom.discipline}-${KIND_LAYER[it.geom.kind] ?? it.geom.kind.toUpperCase()}`;
    for (const prim of it.geom.primitives) ents.push({ layer, prim });
  }
  return toDxf(model, ents, { toPaper: xf0.toPaperUp, mmPerM: xf0.mmPerM });
}

type HostDownloads = { save(r: { filename: string; data: string | Blob }): Promise<unknown> };
type HostClaude = { use(name: string): Promise<unknown> };

/** Descarga un archivo. Dentro de un visor que lo exige (página publicada) usa su diálogo de descarga. */
export async function download(name: string, data: Blob | string, type = "application/octet-stream"): Promise<void> {
  const host = (window as unknown as { claude?: HostClaude }).claude;
  if (host?.use) {
    const dl = (await host.use("downloads").catch(() => null)) as HostDownloads | null;
    if (dl) {
      try {
        await dl.save({ filename: name, data });
        return;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "declined") throw new Error("Descarga cancelada.");
        if (code === "rejected_extension") throw new Error(`Este visor no permite descargar archivos .${name.split(".").pop()}; abre la app local para este formato.`);
        throw new Error("No se pudo descargar el archivo en este visor.");
      }
    }
  }
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ─── PDF vectorial ──────────────────────────────────────────

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Mide con Arial/Helvetica (mismas métricas) en un lienzo; sin lienzo, una aproximación. */
export const canvasMeasure: Measure = (text, bold) => {
  if (measureCtx === undefined) measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  if (!measureCtx) return text.length * (bold ? 0.58 : 0.54);
  measureCtx.font = `${bold ? "bold " : ""}100px Helvetica, Arial, sans-serif`;
  return measureCtx.measureText(text).width / 100;
};

/** Píxeles RGB + alfa de una imagen ya cargada (máx. 600 px de alto). */
function imagePixels(src: string): PdfImage | undefined {
  const img = imageFor(src);
  if (!img) return undefined;
  const h = Math.min(600, img.naturalHeight);
  const w = Math.max(1, Math.round((img.naturalWidth / img.naturalHeight) * h));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const rgb = new Uint8Array(w * h * 3);
  const alpha = new Uint8Array(w * h);
  let opaque = true;
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    rgb[i * 3] = px[j]!;
    rgb[i * 3 + 1] = px[j + 1]!;
    rgb[i * 3 + 2] = px[j + 2]!;
    alpha[i] = px[j + 3]!;
    if (px[j + 3]! < 255) opaque = false;
  }
  return { width: w, height: h, rgb, alpha: opaque ? undefined : alpha };
}

function pdfPrims(doc: PdfDocument, page: PdfPage, model: ModelReader, prims: Iterable<PlanPrimitive>, xf: ReturnType<typeof paperXf>, mode: PaintMode = {}): void {
  for (const p of prims) {
    if (p.kind === "image") {
      let key = doc.hasImage(p.src);
      if (!key) {
        const px = imagePixels(p.src);
        if (!px) continue;
        key = doc.addImage(p.src, px);
      }
      const a = xf.toPaper(p.points[3]!);
      const b = xf.toPaper(p.points[1]!);
      page.image(key, a.x, a.y, b.x - a.x, b.y - a.y);
      continue;
    }
    if (p.kind === "text") {
      const size = p.height * xf.mmPerM;
      const at = xf.toPaper(p.at);
      page.text(p.text, at.x, at.y + size * 0.06, size * TEXT_EM, { bold: p.bold, align: p.align, color: textColor(p, mode), rotation: p.rotation });
      continue;
    }
    const r = resolvePaint(model, p, mode);
    const pts = primitivePoints(p).map((q) => xf.toPaper(q));
    page.path(pts, p.kind === "polygon", { stroke: r.stroke, width: r.weight, dash: r.dash, fill: r.fill, fillOpacity: r.fillOpacity });
  }
}

/** Añade el plano como una página del documento PDF (a tamaño real de papel). */
export async function sheetPdfPage(doc: PdfDocument, model: ModelReader, sheet: Sheet, geo: SheetGeometry, items: readonly Visible[]): Promise<void> {
  const { w, h } = PAPER_MM[sheet.paper];
  await preloadImages(geo.primitives);
  const xf = paperXf(sheet);
  const page = doc.addPage(w, h);
  pdfPrims(doc, page, model, geo.primitives, xf);
  const vp = paperClip(sheet, geo);
  page.clip(vp.x, vp.y, vp.w, vp.h);
  for (const it of items) pdfPrims(doc, page, model, it.geom.primitives, xf, { background: it.background });
  page.unclip();
}

// ─── DXF del modelo en metros ───────────────────────────────

/** Todo el modelo en espacio modelo, en metros, con una capa por nivel, disciplina y tipo de elemento. */
export function modelDxf(model: ModelReader, geoms: Iterable<ElementPlanGeometry>): string {
  const levels = new Map<string, string>();
  for (const e of model.entities()) if (e.kind === "Level") levels.set(e.id, e.name ?? "N");
  const multi = levels.size > 1;
  const ents: DxfEntity[] = [];
  for (const g of geoms) {
    const lv = multi ? `${(levels.get(g.levelId) ?? "N").normalize("NFD").replace(/[^\w]+/g, "_").toUpperCase()}-` : "";
    const layer = `${g.discipline}-${lv}${KIND_LAYER[g.kind] ?? g.kind.toUpperCase()}`;
    for (const prim of g.primitives) ents.push({ layer, prim });
  }
  return toDxf(model, ents, { toPaper: (p) => p, mmPerM: 1 }, { widths: false });
}

const KIND_LAYER: Record<string, string> = { Wall: "MUROS", Door: "PUERTAS", Window: "VENTANAS", Space: "ESPACIOS", Device: "EQUIPOS", Run: "REDES", Annotation: "ANOTACIONES" };
