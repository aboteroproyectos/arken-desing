// Estudio de renders 3D: vista previa interactiva con trazado de rayos progresivo, controles de
// cámara, luz, materiales y entorno, y render final a alta resolución que se guarda en PNG, JPG,
// WebP, TIFF o PDF. Todo corre en el navegador, con la GPU del equipo, sin servicios externos.

import type { ModelReader } from "@arken/core";
import { AgXToneMapping, DirectionalLight, MathUtils, NeutralToneMapping, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, type Group, type Texture } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { DenoiseMaterial, PhysicalCamera, WebGLPathTracer } from "three-gpu-pathtracer";
import { PdfDocument } from "../pdf";
import { buildHouse, styleDefaults, type HouseInfo, type SceneOptions } from "./build";
import { makeSky, sunDirection, sunLight } from "./sky";

export interface RenderHost {
  reader(): ModelReader;
  projectName(): string;
  /** Nombre de archivo ARKEN DISENO-TIPO-FECHA-PROYECTO (sin extensión). */
  fileName(tipo: string): string;
  save(name: string, data: Blob | Uint8Array): Promise<void>;
  say(msg: string, ok?: boolean): void;
  measure: (text: string, bold: boolean) => number;
  logo?: string;
}

type ViewKey = "aerea-se" | "aerea-so" | "aerea-ne" | "aerea-no" | "frontal" | "peatonal" | "interior" | "planta";
const VIEWS: [ViewKey, string][] = [
  ["peatonal", "Peatonal 3/4"],
  ["frontal", "Fachada principal"],
  ["aerea-se", "Aérea suroriente"],
  ["aerea-so", "Aérea suroccidente"],
  ["aerea-ne", "Aérea nororiente"],
  ["aerea-no", "Aérea noroccidente"],
  ["interior", "Interior zona social"],
  ["planta", "Planta aérea"],
];
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const ASPECTS: [string, number][] = [["16:9", 16 / 9], ["3:2", 3 / 2], ["4:3", 4 / 3], ["1:1", 1], ["4:5 vertical", 4 / 5], ["9:16 vertical", 9 / 16]];
const SIZES: [string, number][] = [["HD · 1920 px", 1920], ["2K · 2560 px", 2560], ["4K · 3840 px", 3840], ["6K · 6000 px", 6000]];
const QUALITY: [string, number][] = [["Borrador · 64 muestras", 64], ["Alta · 400 muestras", 400], ["Máxima · 1500 muestras", 1500]];

interface State extends SceneOptions {
  view: ViewKey;
  focal: number;
  straight: boolean;
  fstop: number;
  hour: number;
  month: number;
  latitude: number;
  northDeg: number;
  clouds: number;
  haze: number;
  exposure: number;
  tone: "agx" | "neutral";
  aspect: number;
  size: number;
  samples: number;
  signature: boolean;
  vignette: boolean;
  denoise: boolean;
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

export function showRenderStudio(host: RenderHost): void {
  const reader = host.reader();
  const d = styleDefaults(reader);
  const st: State = {
    view: "peatonal",
    focal: 24,
    straight: true,
    fstop: 0,
    hour: 16.25,
    month: 7,
    latitude: 6.2,
    northDeg: 0,
    clouds: 0.35,
    haze: 0.15,
    exposure: 0,
    tone: "agx",
    wallColor: d.wallColor,
    roofColor: d.roofColor,
    accentColor: d.accentColor,
    frameColor: d.frameColor,
    glass: "claro",
    trees: 1,
    shrubs: true,
    furniture: true,
    interiorLights: false,
    ground: "cesped",
    aspect: 16 / 9,
    size: 3840,
    samples: 400,
    signature: false,
    vignette: true,
    denoise: true,
  };

  // ─── Interfaz ─────────────────────────────────────────────
  const box = document.createElement("div");
  box.className = "modal r3d";
  const opt = (pairs: [string | number, string][], v: string | number) => pairs.map(([k, l]) => `<option value="${k}"${String(k) === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("");
  const range = (k: keyof State, label: string, min: number, max: number, step: number, fmt: (v: number) => string) =>
    `<label class="r3-f"><span>${label}<b data-out="${k}">${fmt(st[k] as number)}</b></span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${st[k]}"></label>`;
  const color = (k: keyof State, label: string) => `<label class="r3-c"><input type="color" data-k="${k}" value="${st[k]}"><span>${label}</span></label>`;
  const check = (k: keyof State, label: string) => `<label class="r3-t"><input type="checkbox" data-k="${k}"${st[k] ? " checked" : ""}><span>${label}</span></label>`;
  const select = (k: keyof State, label: string, pairs: [string | number, string][]) => `<label class="r3-f"><span>${label}</span><select data-k="${k}">${opt(pairs, st[k] as string | number)}</select></label>`;
  box.innerHTML = `<div class="r3-card">
  <header class="r3-head">
    <div><span class="lib-eyebrow">ARKEN 360 · Estudio de renders</span><h2>Render 3D</h2><p class="r3-sub">${esc(host.projectName())} · ${esc(d.name)} · trazado de rayos con luz física</p></div>
    <div class="r3-actions"><button class="lib-btn" data-a="go">Generar render</button><button class="lib-btn ghost" data-a="x">Cerrar</button></div>
  </header>
  <div class="r3-body">
    <section class="r3-stage"><div class="r3-frame"><canvas class="r3-canvas"></canvas><div class="r3-hud"><span class="r3-samples">Preparando la escena…</span><span class="r3-hint">Arrastre para girar · clic derecho para desplazar · rueda para acercar</span></div></div>
      <div class="r3-done" hidden><img alt="Render terminado"><div class="r3-done-bar"><span class="r3-done-info"></span><span class="r3-save">Guardar:</span><button class="lib-btn" data-f="png">PNG</button><button class="lib-btn ghost" data-f="jpg">JPG</button><button class="lib-btn ghost" data-f="webp">WebP</button><button class="lib-btn ghost" data-f="tiff">TIFF</button><button class="lib-btn ghost" data-f="pdf">PDF</button><button class="lib-btn ghost" data-a="back">Volver al estudio</button></div></div>
      <div class="r3-busy" hidden><div class="r3-bar"><i></i></div><p class="r3-busy-txt"></p><button class="lib-btn ghost" data-a="stop">Detener</button></div>
    </section>
    <aside class="r3-side">
      <details open><summary>Vista</summary>
        <div class="r3-views">${VIEWS.map(([k, l]) => `<button class="r3-v${k === st.view ? " on" : ""}" data-view="${k}">${l}</button>`).join("")}</div>
        ${range("focal", "Lente", 14, 85, 1, (v) => `${v} mm`)}
        ${check("straight", "Verticales rectas (corrección de perspectiva)")}
        ${select("fstop", "Profundidad de campo", [[0, "Todo enfocado"], [2.8, "f/2.8 · fondo muy difuso"], [5.6, "f/5.6 · fondo difuso"], [11, "f/11 · leve"]])}
      </details>
      <details open><summary>Sol y cielo</summary>
        ${range("hour", "Hora", 5.5, 19, 0.25, hhmm)}
        ${select("month", "Mes", MONTHS.map((m, i) => [i + 1, m]))}
        ${range("northDeg", "Norte del proyecto", 0, 359, 1, (v) => `${v}°`)}
        ${range("latitude", "Latitud", -40, 40, 0.1, (v) => `${v.toFixed(1)}°`)}
        ${range("clouds", "Nubes", 0, 1, 0.05, (v) => `${Math.round(v * 100)} %`)}
        ${range("haze", "Bruma", 0, 1, 0.05, (v) => `${Math.round(v * 100)} %`)}
        ${range("exposure", "Exposición", -2, 2, 0.1, (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} EV`)}
        ${select("tone", "Respuesta de color", [["agx", "Fotográfica (AgX)"], ["neutral", "Neutra"]])}
        ${check("interiorLights", "Luces interiores encendidas")}
      </details>
      <details><summary>Materiales</summary>
        <div class="r3-colors">${color("wallColor", "Muros")}${color("roofColor", "Cubierta")}${color("accentColor", "Madera y acentos")}${color("frameColor", "Marcos")}</div>
        ${select("glass", "Vidrio", [["claro", "Claro extra"], ["gris", "Gris"], ["bronce", "Bronce"], ["verde", "Verde"]])}
        <button class="lib-btn ghost r3-reset" data-a="style">Volver a los del estilo</button>
      </details>
      <details><summary>Entorno</summary>
        ${select("trees", "Árboles", [[0, "Sin árboles"], [1, "Pocos"], [2, "Muchos"]])}
        ${check("shrubs", "Arbustos junto a la casa")}
        ${check("furniture", "Mobiliario")}
        ${select("ground", "Terreno", [["cesped", "Césped"], ["grava", "Grava"]])}
      </details>
      <details open><summary>Imagen</summary>
        ${select("aspect", "Formato", ASPECTS.map(([l, v]) => [v, l]))}
        ${select("size", "Resolución (lado mayor)", SIZES.map(([l, v]) => [v, l]))}
        ${select("samples", "Calidad", QUALITY.map(([l, v]) => [v, l]))}
        ${check("denoise", "Limpieza de ruido final (conserva bordes)")}
        ${check("vignette", "Viñeta suave")}
        ${check("signature", "Firma ARKEN 360 y nombre del proyecto")}
      </details>
    </aside>
  </div>
</div>`;
  document.body.appendChild(box);
  const q = <T extends HTMLElement>(s: string) => box.querySelector(s) as T;
  const canvas = q<HTMLCanvasElement>(".r3-canvas");
  const frame = q<HTMLDivElement>(".r3-frame");
  const hud = q<HTMLSpanElement>(".r3-samples");

  // ─── Escena ───────────────────────────────────────────────
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch {
    hud.textContent = "Este equipo o navegador no tiene WebGL 2: no se puede usar el estudio de renders.";
    return;
  }
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new Scene();
  const sun = new DirectionalLight(0xffffff, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const camera = new PhysicalCamera(40, 16 / 9, 0.1, 2000);
  // Las órbitas mueven una cámara guía; la cámara física copia su posición y, si se piden verticales
  // rectas, mira en horizontal con el encuadre desplazado (así OrbitControls no pelea con la corrección).
  const guide = new PerspectiveCamera();
  const orbit = new OrbitControls(guide, canvas);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.12;
  orbit.maxPolarAngle = Math.PI * 0.495;
  const tracer = new WebGLPathTracer(renderer);
  tracer.renderScale = 0.6;
  tracer.minSamples = 1;
  tracer.renderDelay = 250;
  tracer.fadeDuration = 350;
  tracer.dynamicLowRes = true;
  tracer.lowResScale = 0.25;
  tracer.bounces = 6;
  tracer.transmissiveBounces = 8;
  tracer.filterGlossyFactor = 0.5;
  tracer.tiles.set(2, 2);
  let house: Group | undefined;
  let info: HouseInfo | undefined;
  let sky: Texture | undefined;
  let bg: Texture | undefined;
  let ready = false;
  let alive = true;

  function applyTone(r: WebGLRenderer): void {
    r.toneMapping = st.tone === "agx" ? AgXToneMapping : NeutralToneMapping;
    r.toneMappingExposure = Math.pow(2, st.exposure) * (st.tone === "agx" ? 1.15 : 0.8);
  }
  function lighting(): void {
    const s = sunDirection({ hour: st.hour, month: st.month, latitude: st.latitude, northDeg: st.northDeg });
    const l = sunLight(s.elevation, st.haze);
    const b = info?.box;
    const c = b ? b.getCenter(new Vector3()) : new Vector3();
    const R = b ? b.getSize(new Vector3()).length() : 30;
    sun.position.copy(c).addScaledVector(s.dir, R * 2);
    sun.target.position.copy(c);
    sun.color.copy(l.color);
    sun.intensity = l.intensity * (1 - 0.55 * st.clouds);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -R * 0.8;
    sc.right = sc.top = R * 0.8;
    sc.near = 0.5;
    sc.far = R * 4;
    sc.updateProjectionMatrix();
    sky?.dispose();
    bg?.dispose();
    // Fondo con el sol visible; iluminación sin el halo intenso (el sol directo lo aporta la luz direccional).
    const k = { sun: s.dir, elevation: s.elevation, clouds: st.clouds, haze: st.haze };
    sky = makeSky({ ...k, sunDisc: false }, 512, 256);
    bg = makeSky(k, 2048, 1024);
    scene.environment = sky;
    scene.background = bg;
    applyTone(renderer);
  }
  async function rebuild(): Promise<void> {
    ready = false;
    hud.textContent = "Construyendo el modelo 3D…";
    if (house) {
      scene.remove(house);
      house.traverse((o) => (o as { geometry?: { dispose(): void } }).geometry?.dispose());
    }
    const built = buildHouse(reader, st);
    house = built.group;
    const first = !info;
    info = built.info;
    scene.add(house);
    lighting();
    if (first) setView(st.view);
    hud.textContent = "Preparando el trazado de rayos…";
    await new Promise((r) => setTimeout(r, 30));
    tracer.setScene(scene, camera);
    ready = true;
  }

  // ─── Cámara ───────────────────────────────────────────────
  function setView(v: ViewKey): void {
    if (!info) return;
    st.view = v;
    box.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
    const b = info.box;
    const c = b.getCenter(new Vector3());
    const size = b.getSize(new Vector3());
    const H = size.y;
    const ground = b.min.y + 0.15;
    // Radio horizontal de la casa y distancia que la deja ocupar ~78 % del ancho del cuadro.
    const rad = Math.hypot(size.x, size.z) / 2;
    const fit = (mm: number, fill = 0.78) => {
      const film = st.aspect >= 1 ? 36 : 36 * st.aspect;
      const half = Math.atan(film / 2 / mm);
      return rad / Math.tan(half) / fill;
    };
    const f = info.frontDir.clone().setY(0).normalize();
    const side = new Vector3(-f.z, 0, f.x);
    const around = (deg: number) => f.clone().applyAxisAngle(new Vector3(0, 1, 0), MathUtils.degToRad(deg));
    let eye: Vector3, look: Vector3;
    let focal = 28, straight = true;
    // Sur = +Z (el norte del plano queda hacia −Z).
    const dirs: Record<string, [number, number]> = { "aerea-se": [1, 1], "aerea-so": [-1, 1], "aerea-ne": [1, -1], "aerea-no": [-1, -1] };
    if (v in dirs) {
      const [sx, sz] = dirs[v]!;
      focal = 32;
      const d = fit(focal, 0.6);
      const dir = new Vector3(sx, 0, sz).normalize();
      // Unos 20° hacia abajo: se leen cubierta y dos fachadas sin perder el horizonte.
      eye = c.clone().addScaledVector(dir, d * 0.95).setY(ground + d * 0.34 + H * 0.5);
      look = new Vector3(c.x, ground + H * 0.3, c.z);
      straight = false;
    } else if (v === "frontal") {
      focal = 30;
      eye = c.clone().addScaledVector(f, fit(focal, 0.8)).setY(ground + 1.6);
      look = new Vector3(c.x, ground + H * 0.42, c.z);
    } else if (v === "peatonal") {
      focal = 26;
      const dir = around(-38);
      eye = c.clone().addScaledVector(dir, fit(focal, 0.82)).setY(ground + 1.65);
      look = c.clone().addScaledVector(side, -rad * 0.05).setY(ground + H * 0.4);
    } else if (v === "interior" && info.interior) {
      eye = info.interior.eye.clone();
      look = info.interior.look.clone();
      focal = 18;
    } else if (v === "planta") {
      eye = new Vector3(c.x, ground + Math.max(size.x, size.z) * 1.6 + 10, c.z + 0.01);
      look = new Vector3(c.x, ground, c.z);
      focal = 35;
      straight = false;
    } else return setView("peatonal");
    st.focal = focal;
    st.straight = straight;
    syncInputs();
    guide.position.copy(eye);
    orbit.target.copy(look);
    orbit.update();
    applyCamera();
  }
  function applyCamera(): void {
    const aspect = st.aspect;
    camera.position.copy(guide.position);
    camera.up.set(0, 1, 0);
    camera.aspect = aspect;
    // Lente equivalente de formato completo: 36 mm en el lado mayor del cuadro.
    const filmV = aspect >= 1 ? 36 / aspect : 36;
    camera.fov = MathUtils.radToDeg(2 * Math.atan(filmV / 2 / st.focal));
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    if (st.straight) {
      // Verticales rectas: la cámara mira en horizontal y el encuadre se desplaza (como un lente de descentramiento).
      const to = orbit.target.clone().sub(camera.position);
      const horiz = Math.hypot(to.x, to.z);
      const look = camera.position.clone().add(new Vector3(to.x, 0, to.z));
      camera.lookAt(look);
      const tanHalf = Math.tan(MathUtils.degToRad(camera.fov / 2));
      const shift = MathUtils.clamp(to.y / Math.max(horiz, 0.01) / tanHalf, -0.9, 0.9);
      const Hpx = 1000;
      camera.setViewOffset(Hpx * aspect, Hpx, 0, (-shift * Hpx) / 2, Hpx * aspect, Hpx);
    } else camera.lookAt(orbit.target);
    camera.fStop = st.fstop || 22;
    camera.bokehSize = st.fstop ? (camera.getFocalLength() / st.fstop) * 0.5 : 0;
    camera.focusDistance = camera.position.distanceTo(orbit.target);
    camera.updateMatrixWorld();
    if (ready) tracer.updateCamera();
  }
  orbit.addEventListener("change", applyCamera);

  // ─── Tamaño del marco de la vista previa (respeta el formato elegido) ──
  function fit(): void {
    const stage = q<HTMLElement>(".r3-stage");
    const W0 = stage.clientWidth - 24;
    const H0 = stage.clientHeight - 24;
    let w = W0, h = W0 / st.aspect;
    if (h > H0) (h = H0), (w = H0 * st.aspect);
    frame.style.width = `${Math.floor(w)}px`;
    frame.style.height = `${Math.floor(h)}px`;
    renderer.setSize(Math.floor(w), Math.floor(h), false);
    applyCamera();
    if (ready) tracer.reset();
  }
  const ro = new ResizeObserver(fit);
  ro.observe(q<HTMLElement>(".r3-stage"));

  // ─── Bucle de la vista previa ─────────────────────────────
  let paused = false;
  function loop(): void {
    if (!alive) return;
    requestAnimationFrame(loop);
    orbit.update();
    if (!ready || paused) return;
    tracer.renderSample();
    hud.textContent = `Vista previa con trazado de rayos · ${Math.floor(tracer.samples)} muestras`;
  }

  // ─── Controles ────────────────────────────────────────────
  function syncInputs(): void {
    box.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-k]").forEach((el) => {
      const k = el.dataset.k as keyof State;
      if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = !!st[k];
      else el.value = String(st[k]);
    });
    box.querySelectorAll<HTMLElement>("[data-out]").forEach((o) => {
      const k = o.dataset.out as keyof State;
      const v = st[k] as number;
      o.textContent = k === "hour" ? hhmm(v) : k === "focal" ? `${v} mm` : k === "northDeg" ? `${v}°` : k === "latitude" ? `${v.toFixed(1)}°` : k === "exposure" ? `${v > 0 ? "+" : ""}${v.toFixed(1)} EV` : `${Math.round(v * 100)} %`;
    });
  }
  const REBUILD = new Set<keyof State>(["wallColor", "roofColor", "accentColor", "frameColor", "glass", "trees", "shrubs", "furniture", "interiorLights", "ground"]);
  const LIGHT = new Set<keyof State>(["hour", "month", "northDeg", "latitude", "clouds", "haze"]);
  let rebuildTimer: number | undefined;
  let lightTimer: number | undefined;
  box.addEventListener("input", (ev) => {
    const el = ev.target as HTMLInputElement | HTMLSelectElement;
    const k = el.dataset.k as keyof State | undefined;
    if (!k) return;
    const raw = el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : el.value;
    const cur = st[k];
    (st as unknown as Record<string, unknown>)[k] = typeof cur === "number" ? Number(raw) : raw;
    syncInputs();
    if (REBUILD.has(k)) {
      window.clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(() => void rebuild(), 350);
    } else if (LIGHT.has(k)) {
      window.clearTimeout(lightTimer);
      lightTimer = window.setTimeout(() => {
        lighting();
        if (ready) (tracer.updateEnvironment(), tracer.updateLights());
      }, 120);
    } else if (k === "exposure" || k === "tone") applyTone(renderer);
    else if (k === "aspect") fit();
    else if (k === "focal" || k === "straight" || k === "fstop") applyCamera();
  });
  box.addEventListener("click", async (ev) => {
    const t = ev.target as HTMLElement;
    const v = t.closest<HTMLElement>("[data-view]")?.dataset.view as ViewKey | undefined;
    if (v) return setView(v);
    const f = t.closest<HTMLElement>("[data-f]")?.dataset.f;
    if (f) return void saveAs(f);
    const a = t.closest<HTMLElement>("[data-a]")?.dataset.a;
    if (a === "x") return close();
    if (a === "style") {
      Object.assign(st, { wallColor: d.wallColor, roofColor: d.roofColor, accentColor: d.accentColor, frameColor: d.frameColor });
      syncInputs();
      return void rebuild();
    }
    if (a === "go") return void finalRender();
    if (a === "stop") stopFlag = true;
    if (a === "back") {
      q<HTMLElement>(".r3-done").hidden = true;
      paused = false;
    }
  });
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  function close(): void {
    alive = false;
    stopFlag = true;
    document.removeEventListener("keydown", onKey);
    ro.disconnect();
    tracer.dispose();
    renderer.dispose();
    box.remove();
  }

  // ─── Render final ─────────────────────────────────────────
  let stopFlag = false;
  let result: HTMLCanvasElement | undefined;
  let resultName = "";
  async function finalRender(): Promise<void> {
    if (!ready || !info) return;
    stopFlag = false;
    paused = true;
    const busy = q<HTMLElement>(".r3-busy");
    const bar = q<HTMLElement>(".r3-bar i");
    const txt = q<HTMLElement>(".r3-busy-txt");
    busy.hidden = false;
    const w = st.aspect >= 1 ? st.size : Math.round(st.size * st.aspect);
    const h = st.aspect >= 1 ? Math.round(st.size / st.aspect) : st.size;
    txt.textContent = `Preparando ${w} × ${h} px…`;
    bar.style.width = "0%";
    const c = document.createElement("canvas");
    let r2: WebGLRenderer | undefined;
    let t2: WebGLPathTracer | undefined;
    try {
      r2 = new WebGLRenderer({ canvas: c, antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
      r2.setPixelRatio(1);
      r2.setSize(w, h, false);
      r2.outputColorSpace = SRGBColorSpace;
      applyTone(r2);
      t2 = new WebGLPathTracer(r2);
      t2.renderDelay = 0;
      t2.fadeDuration = 0;
      t2.minSamples = 0;
      t2.dynamicLowRes = false;
      t2.rasterizeScene = false;
      t2.renderToCanvas = true;
      t2.bounces = 8;
      t2.transmissiveBounces = 10;
      t2.filterGlossyFactor = 0.25;
      t2.tiles.set(Math.max(1, Math.ceil(w / 1280)), Math.max(1, Math.ceil(h / 1280)));
      const cam = camera.clone();
      cam.aspect = w / h;
      if (camera.view?.enabled) cam.setViewOffset(camera.view.fullWidth, camera.view.fullHeight, camera.view.offsetX, camera.view.offsetY, camera.view.width, camera.view.height);
      cam.updateProjectionMatrix();
      t2.setScene(scene, cam);
      const t0 = performance.now();
      while (t2.samples < st.samples && !stopFlag) {
        for (let i = 0; i < 2 && t2.samples < st.samples; i++) t2.renderSample();
        await new Promise((r) => requestAnimationFrame(r));
        const p = Math.min(1, t2.samples / st.samples);
        const el = (performance.now() - t0) / 1000;
        const left = p > 0.02 ? (el / p) * (1 - p) : NaN;
        bar.style.width = `${(p * 100).toFixed(1)}%`;
        txt.textContent = `Trazando ${w} × ${h} px · ${Math.floor(t2.samples)} de ${st.samples} muestras${Number.isFinite(left) ? ` · faltan ≈ ${left > 90 ? `${Math.ceil(left / 60)} min` : `${Math.ceil(left)} s`}` : ""}`;
      }
      const samples = Math.floor(t2.samples);
      if (st.denoise && samples > 0) {
        // Filtro que promedia solo píxeles parecidos: quita el grano residual sin borrar bordes ni texturas.
        const sigma = samples < 100 ? 2.2 : samples < 600 ? 1.5 : 1.1;
        const dm = new DenoiseMaterial({ map: t2.target.texture, sigma, kSigma: 1.6, threshold: samples < 100 ? 0.07 : 0.045 });
        const fq = new FullScreenQuad(dm);
        r2.setRenderTarget(null);
        fq.render(r2);
        fq.dispose();
        dm.dispose();
      }
      result = finish(c, w, h);
      const vname = VIEWS.find(([k]) => k === st.view)?.[1] ?? "Vista";
      resultName = host.fileName(`RENDER ${vname}`);
      const img = q<HTMLImageElement>(".r3-done img");
      img.src = result.toDataURL("image/jpeg", 0.9);
      q<HTMLElement>(".r3-done-info").textContent = `${w} × ${h} px · ${samples} muestras · ${vname}`;
      q<HTMLElement>(".r3-done").hidden = false;
      host.say(`Render terminado: ${w} × ${h} px, ${samples} muestras.`, true);
    } catch (err) {
      host.say(`No se pudo generar el render: ${err instanceof Error ? err.message : String(err)}`);
      paused = false;
    } finally {
      t2?.dispose();
      r2?.dispose();
      busy.hidden = true;
    }
  }
  /** Copia la imagen trazada y aplica la viñeta y la firma, si se eligieron. */
  function finish(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const x = out.getContext("2d")!;
    x.drawImage(src, 0, 0);
    if (st.vignette) {
      const g = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.hypot(w, h) * 0.62);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.28)");
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    }
    if (st.signature) {
      const u = Math.max(w, h) / 1920;
      const pad = 36 * u;
      x.fillStyle = "rgba(20,21,23,0.55)";
      x.fillRect(0, h - 92 * u, w, 92 * u);
      x.fillStyle = "#e9d7b0";
      x.font = `600 ${15 * u}px "Futura", "Century Gothic", "Avenir Next", system-ui, sans-serif`;
      x.textBaseline = "middle";
      x.fillText("ARKEN 360 · ARQUITECTURA · INGENIERÍA · CONSTRUCCIÓN", pad, h - 58 * u);
      x.fillStyle = "#ffffff";
      x.font = `500 ${24 * u}px "Futura", "Century Gothic", "Avenir Next", system-ui, sans-serif`;
      x.fillText(host.projectName().toUpperCase(), pad, h - 30 * u);
      x.textAlign = "right";
      x.font = `${13 * u}px system-ui, sans-serif`;
      x.fillStyle = "rgba(255,255,255,0.75)";
      x.fillText("Imagen de referencia del diseño", w - pad, h - 30 * u);
    }
    return out;
  }
  async function saveAs(fmt: string): Promise<void> {
    if (!result) return;
    const c = result;
    try {
      if (fmt === "png" || fmt === "jpg" || fmt === "webp") {
        const type = fmt === "png" ? "image/png" : fmt === "jpg" ? "image/jpeg" : "image/webp";
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type, 0.95));
        if (!blob) throw new Error("el navegador no pudo codificar la imagen");
        await host.save(`${resultName}.${fmt}`, blob);
      } else if (fmt === "tiff") {
        await host.save(`${resultName}.tif`, new Blob([tiff(c) as Uint8Array<ArrayBuffer>], { type: "image/tiff" }));
      } else if (fmt === "pdf") {
        const doc = new PdfDocument(host.measure, `Render · ${host.projectName()}`);
        // A3 horizontal o vertical según la imagen, con margen y pie de rótulo.
        const land = c.width >= c.height;
        const pw = land ? 420 : 297, ph = land ? 297 : 420;
        const page = doc.addPage(pw, ph);
        const m = 12;
        const maxW = pw - 2 * m, maxH = ph - 2 * m - 14;
        const k = Math.min(maxW / c.width, maxH / c.height);
        const iw = c.width * k, ih = c.height * k;
        const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        const rgb = new Uint8Array(c.width * c.height * 3);
        for (let i = 0, j = 0; i < data.length; i += 4, j += 3) (rgb[j] = data[i]!), (rgb[j + 1] = data[i + 1]!), (rgb[j + 2] = data[i + 2]!);
        const key = doc.addImage("render", { width: c.width, height: c.height, rgb });
        page.image(key, (pw - iw) / 2, m, iw, ih);
        page.text("ARKEN 360", m, ph - m - 6, 5, { bold: true, color: "#16181a" });
        page.text(`${host.projectName().toUpperCase()} · ${VIEWS.find(([k2]) => k2 === st.view)?.[1] ?? ""}`, m, ph - m - 0.5, 3.2, { color: "#41464c" });
        page.text("Imagen de referencia del diseño · ARKEN DISEÑO", pw - m, ph - m - 0.5, 2.6, { align: "right", color: "#767c83" });
        await host.save(`${resultName}.pdf`, new Blob([await doc.build()], { type: "application/pdf" }));
      }
      host.say(`Guardado: ${resultName}.${fmt === "tiff" ? "tif" : fmt}`, true);
    } catch (err) {
      host.say(err instanceof Error ? err.message : String(err));
    }
  }

  // Arranque
  fit();
  requestAnimationFrame(loop);
  void rebuild().catch((err: unknown) => {
    hud.textContent = `No se pudo preparar la escena: ${err instanceof Error ? err.message : String(err)}`;
  });
}

/** TIFF RGB de 8 bits sin compresión (lo abren Photoshop, Lightroom, GIMP y los programas de impresión). */
export function tiff(c: HTMLCanvasElement): Uint8Array<ArrayBuffer> {
  const w = c.width, h = c.height;
  const px = c.getContext("2d")!.getImageData(0, 0, w, h).data;
  const n = 11;
  const ifd = 8;
  const extra = ifd + 2 + n * 12 + 4;
  const bps = extra; // 3 × SHORT
  const res = bps + 6; // 2 × RATIONAL
  const data = res + 16;
  const buf = new Uint8Array(data + w * h * 3);
  const dv = new DataView(buf.buffer);
  buf.set([0x49, 0x49, 42, 0]);
  dv.setUint32(4, ifd, true);
  dv.setUint16(ifd, n, true);
  let p = ifd + 2;
  const tag = (id: number, type: number, count: number, value: number) => {
    dv.setUint16(p, id, true);
    dv.setUint16(p + 2, type, true);
    dv.setUint32(p + 4, count, true);
    if (type === 3 && count === 1) dv.setUint16(p + 8, value, true);
    else dv.setUint32(p + 8, value, true);
    p += 12;
  };
  tag(256, 4, 1, w); // ancho
  tag(257, 4, 1, h); // alto
  tag(258, 3, 3, bps); // bits por muestra
  tag(259, 3, 1, 1); // sin compresión
  tag(262, 3, 1, 2); // RGB
  tag(273, 4, 1, data); // inicio de la imagen
  tag(277, 3, 1, 3); // muestras por píxel
  tag(278, 4, 1, h); // filas por tira
  tag(279, 4, 1, w * h * 3); // bytes de la tira
  tag(282, 5, 1, res); // resolución x
  tag(283, 5, 1, res + 8); // resolución y
  dv.setUint32(p, 0, true);
  for (let i = 0; i < 3; i++) dv.setUint16(bps + i * 2, 8, true);
  dv.setUint32(res, 300, true), dv.setUint32(res + 4, 1, true), dv.setUint32(res + 8, 300, true), dv.setUint32(res + 12, 1, true);
  for (let i = 0, j = data; i < px.length; i += 4, j += 3) (buf[j] = px[i]!), (buf[j + 1] = px[i + 1]!), (buf[j + 2] = px[i + 2]!);
  return buf;
}
