// Escritor de PDF vectorial mínimo (PDF 1.4), sin dependencias.
//
// Las páginas se dibujan en mm de papel con el eje y hacia abajo, igual que el SVG del plano.
// Texto en Helvetica / Helvetica-Bold (WinAnsi), trazos con grosor y discontinuas en mm,
// rellenos con transparencia (ExtGState) e imágenes RGB con canal alfa (SMask).
// Los flujos se comprimen con Deflate cuando el entorno trae CompressionStream.

const PT = 72 / 25.4;

export interface PdfImage {
  readonly width: number;
  readonly height: number;
  /** Píxeles RGB, 3 bytes por píxel. */
  readonly rgb: Uint8Array;
  /** Alfa, 1 byte por píxel (opcional). */
  readonly alpha?: Uint8Array;
}

export interface StrokeStyle {
  readonly stroke?: string;
  /** mm */
  readonly width?: number;
  /** mm */
  readonly dash?: readonly number[];
  readonly fill?: string;
  readonly fillOpacity?: number;
  readonly round?: boolean;
}

export interface TextStyle {
  readonly bold?: boolean;
  readonly align?: "left" | "center" | "right";
  readonly color?: string;
  /** Radianes, antihorario a la vista. */
  readonly rotation?: number;
}

/** Ancho de un texto por unidad de tamaño de letra. */
export type Measure = (text: string, bold: boolean) => number;

const fallbackMeasure: Measure = (t, bold) => t.length * (bold ? 0.58 : 0.54);

const r3 = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** "#rgb", "#rrggbb", "rgb(a)(...)", "white"/"black" → [r,g,b] 0..1 mezclado con blanco según alfa. */
export function parseColor(c: string | undefined): [number, number, number] | undefined {
  if (!c || c === "none") return undefined;
  const s = c.trim().toLowerCase();
  if (s === "white") return [1, 1, 1];
  if (s === "black") return [0, 0, 0];
  let r = 0,
    g = 0,
    b = 0,
    a = 1;
  if (s.startsWith("#")) {
    const h = s.slice(1);
    const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
    r = parseInt(full.slice(0, 2), 16);
    g = parseInt(full.slice(2, 4), 16);
    b = parseInt(full.slice(4, 6), 16);
  } else {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0];
    const v = m[1]!.split(",").map((x) => Number(x.trim()));
    [r, g, b] = [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
    a = v[3] ?? 1;
  }
  const mix = (x: number) => (x / 255) * a + (1 - a);
  return [mix(r), mix(g), mix(b)];
}

const WIN: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "‰": 0x89, "‹": 0x8b, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99, "›": 0x9b,
};
const SUBST: Record<string, string> = { "Δ": "D", "Σ": "S", "Φ": "F", "≤": "<=", "≥": ">=", "→": "->", "←": "<-", "↔": "<->", "√": "raiz ", "π": "pi", "≈": "~", "Ω": "Ohm", "″": "\"", "′": "'", "∅": "Ø", "⌀": "Ø", "·": "·" };

/** Texto Unicode → cadena literal PDF en WinAnsi. */
export function pdfString(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const sub = SUBST[ch];
    const seq = sub ?? ch;
    for (const c of seq) {
      const code = c.codePointAt(0)!;
      let b = code < 256 ? code : WIN[c];
      if (b === undefined) b = 63; // "?"
      if (b === 40 || b === 41 || b === 92) out += "\\" + String.fromCharCode(b);
      else if (b < 32 || b > 126) out += "\\" + b.toString(8).padStart(3, "0");
      else out += String.fromCharCode(b);
    }
  }
  return `(${out})`;
}

export class PdfPage {
  readonly ops: string[] = [];
  readonly images = new Set<string>();
  readonly states = new Set<string>();
  constructor(
    readonly wMm: number,
    readonly hMm: number,
    private readonly measure: Measure,
  ) {}

  private gs(alpha: number): string {
    const key = `A${Math.round(alpha * 1000)}`;
    this.states.add(key);
    return key;
  }

  path(points: readonly { x: number; y: number }[], closed: boolean, st: StrokeStyle): void {
    if (points.length < 2) return;
    const stroke = parseColor(st.stroke);
    const fill = closed ? parseColor(st.fill) : undefined;
    if (!stroke && !fill) return;
    const o = this.ops;
    const segs = points.map((p, i) => `${r3(p.x)} ${r3(p.y)} ${i ? "l" : "m"}`).join(" ") + (closed ? " h" : "");
    if (fill) {
      const a = st.fillOpacity ?? 1;
      o.push("q");
      if (a < 0.999) o.push(`/${this.gs(a)} gs`);
      o.push(`${fill.map(r3).join(" ")} rg ${segs} f Q`);
    }
    if (stroke) {
      o.push(`${stroke.map(r3).join(" ")} RG ${r3(Math.max(0.05, st.width ?? 0.25))} w ${st.round === false || st.dash ? "0 J" : "1 J"} 1 j [${(st.dash ?? []).map(r3).join(" ")}] 0 d ${segs} S`);
    }
  }

  /** Texto centrado verticalmente en `y` (como el plano): `size` es el tamaño de letra en mm. */
  text(text: string, x: number, y: number, size: number, st: TextStyle = {}): void {
    if (!text || size <= 0) return;
    const th = st.rotation ?? 0;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const w = this.measure(text, !!st.bold) * size;
    const shift = st.align === "center" ? w / 2 : st.align === "right" ? w : 0;
    // Línea base: 0.35·tamaño por debajo del centro óptico; u = dirección del texto, -v = hacia abajo.
    const down = size * 0.35;
    const bx = x - c * shift + s * down;
    const by = y + s * shift + c * down;
    const col = parseColor(st.color ?? "#000000") ?? [0, 0, 0];
    this.ops.push(`BT ${col.map(r3).join(" ")} rg /${st.bold ? "F2" : "F1"} ${r3(size)} Tf ${r3(c)} ${r3(-s)} ${r3(-s)} ${r3(-c)} ${r3(bx)} ${r3(by)} Tm ${pdfString(text)} Tj ET`);
  }

  image(key: string, x: number, y: number, w: number, h: number): void {
    this.images.add(key);
    // La imagen ocupa el cuadrado unidad; con el eje y hacia abajo se voltea para que no salga invertida.
    this.ops.push(`q ${r3(w)} 0 0 ${r3(-h)} ${r3(x)} ${r3(y + h)} cm /${key} Do Q`);
  }

  clip(x: number, y: number, w: number, h: number): void {
    this.ops.push(`q ${r3(x)} ${r3(y)} ${r3(w)} ${r3(h)} re W n`);
  }

  unclip(): void {
    this.ops.push("Q");
  }
}

const enc = (s: string) => {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
};

async function deflate(data: Uint8Array): Promise<Uint8Array | undefined> {
  const CS = (globalThis as { CompressionStream?: new (f: string) => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } }).CompressionStream;
  if (!CS) return undefined;
  try {
    const cs = new CS("deflate");
    const w = cs.writable.getWriter();
    void w.write(data);
    void w.close();
    const buf = await new Response(cs.readable as unknown as BodyInit).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return undefined;
  }
}

export class PdfDocument {
  readonly pages: PdfPage[] = [];
  private readonly imgs = new Map<string, PdfImage>();
  constructor(
    private readonly measure: Measure = fallbackMeasure,
    readonly title = "",
  ) {}

  addPage(wMm: number, hMm: number): PdfPage {
    const p = new PdfPage(wMm, hMm, this.measure);
    this.pages.push(p);
    return p;
  }

  /** Registra una imagen y devuelve su nombre de recurso. */
  addImage(id: string, img: PdfImage): string {
    const key = "Im" + [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
    if (!this.imgs.has(key)) this.imgs.set(key, img);
    return key;
  }

  hasImage(id: string): string | undefined {
    const key = "Im" + [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
    return this.imgs.has(key) ? key : undefined;
  }

  async build(): Promise<Uint8Array<ArrayBuffer>> {
    const objs: Uint8Array[] = [];
    const add = (body: Uint8Array | string): number => {
      objs.push(typeof body === "string" ? enc(body) : body);
      return objs.length;
    };
    const stream = async (dict: string, raw: Uint8Array): Promise<Uint8Array> => {
      const z = await deflate(raw);
      const data = z ?? raw;
      const head = enc(`<< ${dict} /Length ${data.length}${z ? " /Filter /FlateDecode" : ""} >>\nstream\n`);
      const tail = enc("\nendstream");
      const out = new Uint8Array(head.length + data.length + tail.length);
      out.set(head, 0);
      out.set(data, head.length);
      out.set(tail, head.length + data.length);
      return out;
    };
    const catalog = add("");
    const pagesObj = add("");
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const imgRef = new Map<string, number>();
    for (const [key, im] of this.imgs) {
      let smask = "";
      if (im.alpha) smask = ` /SMask ${add(await stream(`/Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceGray /BitsPerComponent 8`, im.alpha))} 0 R`;
      imgRef.set(key, add(await stream(`/Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8${smask}`, im.rgb)));
    }
    const kids: number[] = [];
    for (const pg of this.pages) {
      const H = pg.hMm * PT;
      const content = `${r3(PT)} 0 0 ${r3(-PT)} 0 ${r3(H)} cm\n${pg.ops.join("\n")}`;
      const cRef = add(await stream("", enc(content)));
      const xo = [...pg.images].map((k) => `/${k} ${imgRef.get(k)} 0 R`).join(" ");
      const gs = [...pg.states].map((k) => `/${k} << /Type /ExtGState /ca ${r3(Number(k.slice(1)) / 1000)} >>`).join(" ");
      kids.push(
        add(
          `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${r3(pg.wMm * PT)} ${r3(H)}] /Contents ${cRef} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xo ? ` /XObject << ${xo} >>` : ""}${gs ? ` /ExtGState << ${gs} >>` : ""} >> >>`,
        ),
      );
    }
    objs[pagesObj - 1] = enc(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);
    const info = add(`<< /Title ${pdfString(this.title)} /Producer (ARKEN DISENO) /Creator (ARKEN DISENO - ARKEN 360) >>`);
    objs[catalog - 1] = enc(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);

    const parts: Uint8Array[] = [enc("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")];
    let pos = parts[0]!.length;
    const offsets: number[] = [];
    objs.forEach((body, i) => {
      offsets.push(pos);
      const head = enc(`${i + 1} 0 obj\n`);
      const tail = enc("\nendobj\n");
      parts.push(head, body, tail);
      pos += head.length + body.length + tail.length;
    });
    const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
    parts.push(enc(xref));
    const total = parts.reduce((t, p) => t + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}
