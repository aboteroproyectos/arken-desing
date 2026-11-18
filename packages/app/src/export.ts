// Exportación de planos: SVG vectorial (imprimir / PDF), PNG de alta resolución y DXF R12.

import { PAPER_MM, type ModelReader, type Sheet, type Vec2 } from "@arken/core";
import { sheetTransform, type SheetGeometry } from "@arken/sheets";
import { FONT, paintCanvas, primitivesToSvg, toDxf, type DxfEntity } from "./paint";
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

export function sheetSvg(model: ModelReader, sheet: Sheet, geo: SheetGeometry, items: readonly Visible[]): string {
  const { w, h } = PAPER_MM[sheet.paper];
  const xf = paperXf(sheet);
  const vp = sheet.viewport;
  const body = items.map((it) => primitivesToSvg(model, it.geom.primitives, xf, { background: it.background })).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" font-family='${FONT}'>
<title>${sheet.number} ${sheet.title}</title>
<defs><clipPath id="vp"><rect x="${vp.x}" y="${h - vp.y - vp.h}" width="${vp.w}" height="${vp.h}"/></clipPath></defs>
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
  paintCanvas(ctx, model, geo.primitives, xf);
  const vp = sheet.viewport;
  ctx.save();
  ctx.beginPath();
  ctx.rect(vp.x * pxPerMm, (h - vp.y - vp.h) * pxPerMm, vp.w * pxPerMm, vp.h * pxPerMm);
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
    const layer = it.background ? "FONDO" : `${it.geom.discipline}-${it.geom.kind.toUpperCase()}`;
    for (const prim of it.geom.primitives) ents.push({ layer, prim });
  }
  return toDxf(model, ents, { toPaper: xf0.toPaperUp, mmPerM: xf0.mmPerM });
}

/** Abre una ventana lista para imprimir el plano a tamaño real (o guardarlo como PDF vectorial). */
export function printSvg(svg: string, sheet: Sheet): void {
  const { w, h } = PAPER_MM[sheet.paper];
  const win = window.open("", "_blank");
  if (!win) throw new Error("No se pudo abrir la ventana de impresión (bloqueada en esta vista). Exporta en SVG o PNG, o usa la app local.");
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${sheet.number} ${sheet.title}</title>
<style>@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0;padding:0}svg{display:block;width:${w}mm;height:${h}mm}</style></head>
<body>${svg.replace(/^<\?xml[^>]*>/, "")}<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  win.document.close();
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
