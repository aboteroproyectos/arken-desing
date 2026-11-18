// CASA LOTE 01 · PARCELACIÓN BOSQUE DE AGUA (Alto de Las Palmas, Envigado, Antioquia)
// Diseño: ARKEN 360. Modelo generado con los comandos de ARKEN DISEÑO: se abre en la aplicación y
// se edita como cualquier otro proyecto.
//
// Convenciones del modelo
//  - Origen en la esquina exterior suroccidental de la casa. x hacia el oriente, y hacia el norte.
//  - Casa de 12.00 m (oriente-occidente) × 15.00 m (norte-sur) a caras exteriores = 180 m².
//  - Ejes de muros de fachada a 0.10 m de la cara exterior (muro de 0.20 m); muros interiores de 0.12 m.
//  - Alturas en metros sobre el piso terminado (NPT ±0.00).

import type { BimModel, Id, Vec2 } from "@arken/core";
import { ProjectBuilder, chain, grid, newId, orthoPath, rect, v, type Props } from "./builder";

const PI = Math.PI;
const R_W = -PI / 2; // mueble contra muro occidental (mira al oriente)
const R_E = PI / 2; // contra muro oriental
const R_N = PI; // contra muro norte

export function buildLote01(): BimModel {
  const b = new ProjectBuilder();

  // ─── Proyecto, edificio, niveles, materiales ──────────────────
  const projectId = newId();
  const buildingId = newId();
  const level = newId();
  const roof = newId();
  const m = { acabado: newId(), fibro: newId(), perfil: newId(), yeso: newId(), yesoRH: newId() };
  const fachada = newId();
  const interior = newId();
  const humedo = newId();

  b.put(
    {
      id: projectId,
      kind: "Project",
      name: "Casa Lote 01 · Bosque de Agua",
      lengthUnit: "m",
      titleBlock: {
        empresa: "ARKEN 360",
        lema: "Arquitectura · Ingeniería · Construcción",
        empresa_contacto: "Diseño integral BIM",
        empresa_web: "",
        proyecto: "CASA LOTE 01 · PARCELACIÓN BOSQUE DE AGUA",
        localizacion: "Lote 01, Parcelación Bosque de Agua, Alto de Las Palmas, Envigado (Antioquia)",
        propietario: "Por definir",
        diseno: "ARKEN 360",
        matricula: "Mat. prof. por diligenciar",
        dibujo: "ARKEN DISEÑO",
        reviso: "",
        aprobo: "",
        fecha: "Noviembre 2026",
        revision: "0",
        archivo: "BDA-L01",
      },
      properties: {
        area_construida_m2: 180,
        ev_limite_A: 40,
        factor_mantenimiento: 0.8,
        velocidad_max_m_s: 2.0,
        lluvia_mm_h: 120,
        coef_escorrentia: 0.95,
        gas_pc_kwh_m3: 10.35,
        gas_densidad_rel: 0.62,
        gas_dp_max_mbar: 2.0,
        solar_hsp: 4.2,
        solar_pr: 0.8,
        consumo_kwh_mes: 750,
        modulo_voc: 51.67,
        modulo_vmp: 42.89,
        modulo_isc: 14.27,
        modulo_beta_voc_pct: -0.25,
        temp_min_c: 5,
        inversor_vdc_max: 500,
        inversor_mppt_min: 125,
        inversor_mppt_max: 425,
        casa_xmin: 0,
        casa_xmax: 12,
        casa_ymin: 0,
        casa_ymax: 15,
        cubierta_alta_m: 4.2,
        cubierta_pendiente_pct: 10,
        cubierta_alero_m: 0.9,
        cubierta_espesor_m: 0.25,
        fachadas_escala: 75,
        fachada_S_madera: "3.66-6.74",
        parqueadero_xmin: -6.25,
        parqueadero_xmax: -0.05,
        parqueadero_ymin: -0.15,
        parqueadero_ymax: 6.35,
        parqueadero_altura_m: 2.8,
        red_operador: "Red BT del operador de red · 120/240 V monofásica trifilar",
        medidor: "Medidor bidireccional clase 1, 120/240 V, con DPS tipo 1",
        acometida: "Acometida subterránea 2#1 + 1#1(N) + 1#6(T) Cu THWN-2 en PVC Ø 2\"",
        totalizador: "Totalizador 2P-125 A · DPS tipo 2 (40 kA) en TG",
        tablero_TG: "Tablero general 30 ctos., barraje 150 A, cuarto técnico",
        tablero_TR: "Tablero de respaldo 12 ctos., alimentado por el inversor híbrido",
        unifilar_notas:
          "Inversor híbrido 8 kW 120/240 V: puerto RED desde TG (2P-50 A, 2#6+1#6N+1#10T) y puerto CARGA hacia TR (respaldo con baterías).|Generador FV 8.12 kWp: 2 cadenas de 7 módulos de 580 Wp → caja combinadora CC-DC (fusibles 20 A, DPS DC 600 V, seccionador) → MPPT 1 y 2.|Baterías LiFePO4 48 V, 10.24 kWh, con BMS comunicado al inversor; protección DC 125 A.|Sistema de puesta a tierra único: varilla Cu 5/8\" × 2.40 m, R ≤ 25 Ω (RETIE), equipotencial con estructura metálica y marcos FV.|Gestión de carga EV: los dos cargadores comparten 40 A en total (OCPP / domótica).",
      },
    },
    { id: buildingId, kind: "Building", name: "Casa" },
    { id: level, kind: "Level", name: "Primer piso", elevation: 0, height: 3.0 },
    { id: roof, kind: "Level", name: "Cubierta", elevation: 4.2, height: 0.3 },
    { id: m.acabado, kind: "Material", name: "Estuco acrílico sobre malla (EIFS)", displayColor: "#e9e4da" },
    { id: m.fibro, kind: "Material", name: "Placa de fibrocemento 12 mm", displayColor: "#cfc8bb" },
    { id: m.perfil, kind: "Material", name: "Perfil de acero galvanizado + lana mineral", density: 40, thermalConductivity: 0.035, displayColor: "#c9c4b8" },
    { id: m.yeso, kind: "Material", name: "Placa de yeso 12.7 mm", displayColor: "#f4f1ea" },
    { id: m.yesoRH, kind: "Material", name: "Placa de yeso RH (resistente a la humedad)", displayColor: "#dfe9e2" },
    {
      id: fachada,
      kind: "MaterialLayerSet",
      name: "Fachada 200 (steel frame + EIFS)",
      layers: [
        { materialId: m.acabado, thickness: 0.025 },
        { materialId: m.fibro, thickness: 0.012 },
        { materialId: m.perfil, thickness: 0.15 },
        { materialId: m.yeso, thickness: 0.013 },
      ],
    },
    {
      id: interior,
      kind: "MaterialLayerSet",
      name: "Divisorio 120 (drywall con aislamiento acústico)",
      layers: [
        { materialId: m.yeso, thickness: 0.015 },
        { materialId: m.perfil, thickness: 0.09 },
        { materialId: m.yeso, thickness: 0.015 },
      ],
    },
    {
      id: humedo,
      kind: "MaterialLayerSet",
      name: "Divisorio húmedo 120 (yeso RH)",
      layers: [
        { materialId: m.yesoRH, thickness: 0.015 },
        { materialId: m.perfil, thickness: 0.09 },
        { materialId: m.yesoRH, thickness: 0.015 },
      ],
    },
  );
  // Relaciones de agregación proyecto → edificio → niveles.
  b.run({
    label: "Estructura espacial",
    execute(tx) {
      tx.apply({ type: "putRelation", relation: { id: newId(), kind: "RelAggregates", parentId: projectId, childIds: [buildingId] } });
      tx.apply({ type: "putRelation", relation: { id: newId(), kind: "RelAggregates", parentId: buildingId, childIds: [level, roof] } });
    },
  });
  b.levelId = level;

  // ─── Muros ────────────────────────────────────────────────────
  // Fachadas en sentido horario (vista en planta) para que la cara "exterior" del muro mire afuera.
  const WS = b.wall(fachada, v(11.9, 0.1), v(0.1, 0.1), 4.2, { fachada: "S" }, "Fachada sur");
  const WW = b.wall(fachada, v(0.1, 0.1), v(0.1, 14.9), 4.2, { fachada: "W" }, "Fachada occidental");
  const WN = b.wall(fachada, v(0.1, 14.9), v(11.9, 14.9), 4.2, { fachada: "N" }, "Fachada norte");
  const WE = b.wall(fachada, v(11.9, 14.9), v(11.9, 0.1), 3.0, { fachada: "E" }, "Fachada oriental");
  const W1 = b.wall(humedo, v(2.0, 0.1), v(2.0, 2.6), 3.0);
  const W2 = b.wall(humedo, v(0.1, 2.6), v(5.2, 2.6), 3.0);
  b.wall(interior, v(3.6, 0.1), v(3.6, 2.6), 3.0);
  b.wall(humedo, v(3.6, 2.6), v(3.6, 4.6), 3.0);
  const W4 = b.wall(humedo, v(3.6, 4.6), v(5.2, 4.6), 3.0);
  const W5 = b.wall(humedo, v(5.2, 2.6), v(5.2, 4.6), 3.0);
  const W6 = b.wall(interior, v(6.8, 0.1), v(6.8, 9.0), 3.0);
  const W7 = b.wall(humedo, v(6.8, 3.6), v(11.9, 3.6), 3.0);
  b.wall(humedo, v(9.6, 3.6), v(9.6, 5.8), 3.0);
  b.wall(humedo, v(6.8, 5.8), v(11.9, 5.8), 3.0);
  const W10 = b.wall(interior, v(5.2, 9.0), v(11.9, 9.0), 3.0);
  b.wall(interior, v(5.2, 9.0), v(5.2, 14.9), 3.0);
  const W12 = b.wall(humedo, v(5.2, 12.4), v(11.9, 12.4), 3.0);
  const W13 = b.wall(humedo, v(8.4, 12.4), v(8.4, 14.9), 3.0);
  void W1;
  void W4;

  // ─── Puertas ──────────────────────────────────────────────────
  b.door(WS, v(5.2, 0.1), 1.2, v(5.2, 1), v(4.6, 0.1), "P-1 Puerta principal pivotante, madera maciza y vidrio, 1.20 × 2.40", { cerradura: "inteligente" });
  b.door(WW, v(0.1, 2.05), 0.8, v(1, 2.05), v(0.1, 2.45), "P-2 Puerta ropas–parqueadero, aluminio y vidrio templado");
  b.door(WS, v(2.8, 0.1), 0.9, v(2.8, -1), v(3.25, 0.1), "P-3 Puerta cuarto técnico, aluminio con persiana de ventilación");
  b.door(W2, v(1.2, 2.6), 0.8, v(1.2, 1.5), v(0.8, 2.6), "P-4 Puerta ropas–cocina, entamborada lacada");
  b.door(W5, v(5.2, 3.7), 0.8, v(4.4, 3.7), v(5.2, 4.1), "P-5 Puerta baño social, entamborada lacada");
  b.door(W6, v(6.8, 2.95), 0.9, v(7.6, 2.95), v(6.8, 2.45), "P-6 Puerta habitación 2");
  b.door(W6, v(6.8, 4.75), 0.8, v(7.6, 4.75), v(6.8, 5.15), "P-7 Puerta baño 2");
  b.door(W7, v(10.75, 3.6), 0.8, v(10.75, 4.2), v(11.15, 3.6), "P-8 Puerta vestier habitación 2");
  b.door(W6, v(6.8, 6.45), 0.9, v(7.6, 6.45), v(6.8, 6.0), "P-9 Puerta habitación 3");
  b.door(W10, v(6.0, 9.0), 0.9, v(6.0, 9.8), v(5.55, 9.0), "P-10 Puerta habitación principal");
  b.door(W12, v(6.0, 12.4), 0.9, v(6.0, 13.2), v(5.55, 12.4), "P-11 Puerta vestier principal");
  b.door(W13, v(8.4, 13.0), 0.8, v(9.0, 13.0), v(8.4, 12.6), "P-12 Puerta baño principal");

  // ─── Ventanería (fachadas en vidrio) ─────────────────────────
  const glass = "Ventanería en aluminio arquitectónico negro mate, vidrio laminado 6+6 mm con control solar";
  b.window(WS, v(4.15, 0.1), 0.7, 0, 2.4, "V-1 Paño fijo acceso", { operacion: "fixed", descripcion: glass });
  b.window(WS, v(6.3, 0.1), 0.7, 0, 2.4, "V-2 Paño fijo acceso", { operacion: "fixed", descripcion: glass });
  b.window(WS, v(9.4, 0.1), 2.0, 0.45, 2.0, "V-3 Ventana habitación 2 (sur)", { descripcion: glass });
  b.window(WW, v(0.1, 5.25), 2.9, 1.05, 1.35, "V-4 Ventana cocina sobre mesón", { descripcion: glass });
  b.window(WW, v(0.1, 8.3), 1.1, 0, 2.6, "V-5 Ventanal comedor", { operacion: "fixed", descripcion: glass });
  b.window(WW, v(0.1, 9.8), 1.3, 0, 2.6, "V-6 Ventanal comedor corredizo", { descripcion: glass });
  b.window(WW, v(0.1, 12.725), 3.95, 0, 2.6, "V-7 Ventanal sala occidental piso-techo", { descripcion: glass });
  b.window(WN, v(2.6, 14.9), 4.6, 0, 2.6, "V-8 Ventanal sala norte corredizo a terraza", { descripcion: glass });
  b.window(WN, v(7.6, 14.9), 1.0, 1.5, 0.8, "V-9 Ventana alta vestier", { descripcion: glass });
  b.window(WN, v(10.15, 14.9), 2.5, 1.5, 0.8, "V-10 Ventana alta baño principal, vidrio esmerilado", { descripcion: glass });
  b.window(WE, v(11.9, 10.7), 2.8, 0, 2.4, "V-11 Ventanal habitación principal piso-techo", { descripcion: glass });
  b.window(WE, v(11.9, 7.4), 2.4, 0.45, 2.0, "V-12 Ventana habitación 3", { descripcion: glass });
  b.window(WE, v(11.9, 1.85), 2.5, 0.45, 2.0, "V-13 Ventana habitación 2 (oriente)", { descripcion: glass });

  // ─── Espacios (contornos a caras interiores) ─────────────────
  // Acabado de piso abreviado en planta; la especificación completa va en el cuadro de áreas y las notas.
  const social = "Porcelanato 120×60";
  const madera = "Madera de roble";
  const bano = "Porcelanato 60×120";
  const servicio = "Porcelanato 60×60";
  b.space("1.01", "Acceso", rect(3.66, 0.2, 6.74, 2.54), { piso: social, lux_objetivo: 150, etiqueta_x: 5.4, etiqueta_y: 1.95 });
  b.space("1.02", "Galería", [v(5.26, 2.54), v(6.74, 2.54), v(6.74, 8.94), v(5.14, 8.94), v(5.14, 4.66), v(5.26, 4.66)], { piso: social, lux_objetivo: 100, etiqueta_x: 6.0, etiqueta_y: 6.9 });
  b.space("1.03", "Baño social", rect(3.66, 2.66, 5.14, 4.54), { piso: bano, lux_objetivo: 200, etiqueta_x: 4.17, etiqueta_y: 3.62 });
  b.space("1.04", "Cocina", [v(0.2, 2.66), v(3.54, 2.66), v(3.54, 4.66), v(5.14, 4.66), v(5.14, 7.6), v(0.2, 7.6)], { piso: social, lux_objetivo: 300, etiqueta_x: 3.55, etiqueta_y: 6.9 });
  b.space("1.05", "Comedor", rect(0.2, 7.6, 5.14, 10.6), { piso: social, lux_objetivo: 200, etiqueta_x: 2.65, etiqueta_y: 7.85 });
  b.space("1.06", "Sala", rect(0.2, 10.6, 5.14, 14.8), { piso: social, lux_objetivo: 200, etiqueta_x: 3.3, etiqueta_y: 11.65 });
  b.space("1.07", "Ropas", rect(0.2, 0.2, 1.94, 2.54), { piso: servicio, lux_objetivo: 200, etiqueta_y: 1.4, etiqueta_x: 0.95 });
  b.space("1.08", "Cuarto técnico", rect(2.06, 0.2, 3.54, 2.54), { piso: servicio, lux_objetivo: 300, etiqueta_x: 2.8, etiqueta_y: 1.3 });
  b.space("1.09", "Habitación 2", rect(6.86, 0.2, 11.8, 3.54), { piso: madera, lux_objetivo: 150, etiqueta_x: 9.0, etiqueta_y: 1.1 });
  b.space("1.10", "Vestier hab. 2", rect(9.66, 3.66, 11.8, 5.74), { piso: madera, lux_objetivo: 200, etiqueta_x: 10.3, etiqueta_y: 4.78 });
  b.space("1.11", "Baño 2", rect(6.86, 3.66, 9.54, 5.74), { piso: bano, lux_objetivo: 200, etiqueta_x: 8.05, etiqueta_y: 4.47 });
  b.space("1.12", "Habitación 3", rect(6.86, 5.86, 11.8, 8.94), { piso: madera, lux_objetivo: 150, etiqueta_x: 10.2, etiqueta_y: 7.6 });
  b.space("1.13", "Habitación principal", rect(5.26, 9.06, 11.8, 12.34), { piso: madera, lux_objetivo: 150, etiqueta_x: 8.55, etiqueta_y: 9.75 });
  b.space("1.14", "Vestier principal", rect(5.26, 12.46, 8.34, 14.8), { piso: madera, lux_objetivo: 300, etiqueta_x: 7.35, etiqueta_y: 12.8 });
  b.space("1.15", "Baño principal", rect(8.46, 12.46, 11.8, 14.8), { piso: bano, lux_objetivo: 250, etiqueta_x: 10.0, etiqueta_y: 13.25 });
  b.space("2.01", "Parqueadero cubierto", rect(-6.1, 0.0, -0.05, 6.2), { piso: "Adoquín de concreto sobre base granular", exterior: true, etiqueta_x: -3.2, etiqueta_y: 3.05 });
  b.space("2.02", "Terraza", rect(0.0, 15.05, 7.0, 18.0), { piso: "Deck en madera teca inmunizada", exterior: true, etiqueta_x: 6.0, etiqueta_y: 16.1 });
  b.space("2.03", "Zona técnica exterior", rect(-6.6, 6.5, -3.8, 8.6), { piso: "Placa de concreto con cerramiento en celosía", exterior: true, etiqueta_x: -5.2, etiqueta_y: 8.95 });

  // ─── Mobiliario y aparatos (planta amoblada) ─────────────────
  const A = (sym: string, at: Vec2, rot: number, props: Props = {}) => b.device("ARQ", sym, at, 0, props, { rot });
  A("electrodomestico", v(0.55, 0.2), 0, { ancho_m: 0.6, fondo_m: 0.6, rotulo: "LAV", tipo: "redondo" });
  A("electrodomestico", v(1.2, 0.2), 0, { ancho_m: 0.6, fondo_m: 0.6, rotulo: "SEC", tipo: "redondo" });
  A("lavaplatos", v(1.94, 0.75), R_E, { ancho_m: 0.6 });
  A("electrodomestico", v(0.2, 3.2), R_W, { ancho_m: 0.9, fondo_m: 0.7, rotulo: "NEV" });
  A("mueble", v(0.2, 4.0), R_W, { ancho_m: 0.7, fondo_m: 0.6, tipo: "alto", rotulo: "" });
  A("mueble", v(0.2, 5.85), R_W, { ancho_m: 3.0, fondo_m: 0.6, rotulo: "" });
  A("lavaplatos", v(0.2, 5.25), R_W, { ancho_m: 0.9 });
  A("mueble", v(1.9, 5.0), -PI / 2, { ancho_m: 2.4, fondo_m: 1.0, rotulo: "" });
  A("estufa", v(2.15, 5.0), -PI / 2);
  A("mesa", v(2.65, 9.3), 0, { ancho_m: 2.2, fondo_m: 1.0, sillas_lado: 3 });
  A("sofa", v(1.0, 12.7), R_W, { ancho_m: 2.6, fondo_m: 0.9 });
  A("sofa", v(3.1, 14.25), R_N, { ancho_m: 1.9, fondo_m: 0.85 });
  A("mueble", v(3.2, 12.4), 0, { ancho_m: 1.2, fondo_m: 0.6, rotulo: "" });
  A("mueble", v(5.14, 12.7), R_E, { ancho_m: 2.4, fondo_m: 0.45, rotulo: "TV · CHIMENEA" });
  A("mueble", v(3.66, 1.4), R_W, { ancho_m: 1.2, fondo_m: 0.35, rotulo: "" });
  A("cama", v(9.05, 3.54), R_N, { ancho_m: 1.6, largo_m: 2.0 });
  A("mueble", v(7.6, 0.2), 0, { ancho_m: 1.2, fondo_m: 0.55, rotulo: "ESCRITORIO" });
  A("mueble", v(11.8, 4.7), R_E, { ancho_m: 2.0, fondo_m: 0.6, tipo: "closet" });
  A("mueble", v(10.4, 5.74), R_N, { ancho_m: 1.4, fondo_m: 0.6, tipo: "closet" });
  A("cama", v(6.86, 7.9), R_W, { ancho_m: 1.6, largo_m: 2.0, mesas: 0 });
  A("mueble", v(9.4, 5.86), 0, { ancho_m: 2.8, fondo_m: 0.6, tipo: "closet" });
  A("cama", v(8.55, 12.34), R_N, { ancho_m: 2.0, largo_m: 2.1 });
  A("mueble", v(8.55, 9.06), 0, { ancho_m: 1.8, fondo_m: 0.4, rotulo: "TV" });
  A("mueble", v(5.26, 13.6), R_W, { ancho_m: 2.2, fondo_m: 0.6, tipo: "closet" });
  A("mueble", v(7.1, 14.8), R_N, { ancho_m: 2.4, fondo_m: 0.6, tipo: "closet" });
  A("mueble", v(7.1, 13.1), 0, { ancho_m: 1.0, fondo_m: 0.6, rotulo: "ISLA" });
  A("ducha", v(9.21, 14.8), R_N, { ancho_m: 1.5, fondo_m: 1.1 });
  A("wc", v(10.55, 14.8), R_N);
  A("lavamanos", v(11.8, 13.5), R_E, { ancho_m: 1.6, pocetas: 2 });
  A("lavamanos", v(8.0, 3.66), 0, { ancho_m: 1.4, pocetas: 2 });
  A("ducha", v(8.99, 5.74), R_N, { ancho_m: 1.1, fondo_m: 1.08 });
  A("wc", v(9.54, 4.2), R_E);
  A("wc", v(4.3, 2.66), 0);
  A("lavamanos", v(4.0, 4.54), R_N, { ancho_m: 0.6 });
  A("carro", v(-3.2, 1.5), 0);
  A("carro", v(-3.2, 4.6), 0);
  A("mesa", v(2.9, 16.4), 0, { ancho_m: 1.8, fondo_m: 0.9, sillas_lado: 2 });
  A("mueble", v(4.6, 17.98), R_N, { ancho_m: 1.4, fondo_m: 0.6, rotulo: "BBQ" });

  // ─── Estructura metálica: ejes y columnas ────────────────────
  const xs: [string, number][] = [["1", 0.1], ["2", 6.8], ["3", 11.9]];
  const ys: [string, number][] = [["A", 0.1], ["B", 3.6], ["C", 9.0], ["D", 14.9]];
  for (const [n, x] of xs) {
    b.note("EST", "axis", [v(x, 15.6), v(x, 20.7)], n);
    b.note("EST", "axis", [v(x, -0.6), v(x, -4.6)], n);
  }
  for (const [n, y] of ys) {
    b.note("EST", "axis", [v(-0.6, y), v(-8.8, y)], n);
    b.note("EST", "axis", [v(12.6, y), v(17.1, y)], n);
  }
  const column = (x: number, y: number, s = 0.15) => b.note("EST", "solid", rect(x - s / 2, y - s / 2, x + s / 2, y + s / 2), undefined, { perfil: "HSS 150×150×6 mm" });
  for (const [, x] of xs) for (const [, y] of ys) column(x, y);
  column(-5.95, 0.15, 0.12);
  column(-5.95, 6.05, 0.12);

  // ─── Exteriores y cubierta proyectada ────────────────────────
  b.note("ARQ", "dashed", [v(-0.9, -0.8), v(12.9, -0.8), v(12.9, 15.8), v(-0.9, 15.8), v(-0.9, -0.8)], undefined, { descripcion: "Proyección de cubierta" });
  b.note("ARQ", "text", [v(9.2, -0.62)], "PROYECCIÓN DE CUBIERTA (ALERO 0.90 / 0.80 m)", {}, 1.8);
  b.note("ARQ", "dashed", [v(-6.25, -0.15), v(-0.05, -0.15), v(-0.05, 6.35), v(-6.25, 6.35), v(-6.25, -0.15)], undefined, { descripcion: "Cubierta del parqueadero" });
  b.note("ARQ", "outline", rect(4.4, -4.2, 6.0, 0.0), undefined, { descripcion: "Sendero de acceso en piedra" });
  b.note("ARQ", "text", [v(5.2, -3.0)], "SENDERO DE ACCESO", { align: "center", rot: PI / 2 }, 1.8);
  b.note("ARQ", "outline", rect(-6.6, 6.5, -3.8, 8.6), undefined, {});
  b.note("ARQ", "outline", rect(-3.6, -3.4, -0.3, -2.6), undefined, { descripcion: "Murete de medidores" });
  b.note("ARQ", "text", [v(-1.95, -3.8)], "MURETE DE MEDIDORES (ENERGÍA · GAS · AGUA)", { align: "center" }, 1.8);
  b.note("ARQ", "text", [v(-3.2, -0.55)], "ACCESO VEHICULAR →", { align: "center" }, 2);
  b.note("ARQ", "text", [v(6.25, 0.45)], "NPT ±0.00", { align: "center" }, 1.8);
  b.note("ARQ", "text", [v(-3.2, 5.75)], "NPT −0.15", { align: "center" }, 1.8);
  b.note("ARQ", "text", [v(6.2, 15.45)], "NPT −0.10", { align: "center" }, 1.8);
  b.note("ARQ", "text", [v(-5.2, 6.75)], "TANQUE 2 m³ · EQUIPO DE PRESIÓN", { align: "center" }, 1.6);

  // ─── Cotas ───────────────────────────────────────────────────
  b.dim(v(0, 0), v(12, 0), -3.6);
  b.dim(v(0.1, 0.1), v(6.8, 0.1), -2.9);
  b.dim(v(6.8, 0.1), v(11.9, 0.1), -2.9);
  b.dim(v(0, 15), v(12, 15), 4.4);
  b.dim(v(0, 0), v(0, 15), 8.0);
  b.dim(v(0.1, 0.1), v(0.1, 3.6), 7.2);
  b.dim(v(0.1, 3.6), v(0.1, 9.0), 7.2);
  b.dim(v(0.1, 9.0), v(0.1, 14.9), 7.2);
  b.dim(v(12, 0), v(12, 15), -3.9);
  b.dim(v(11.9, 0.1), v(11.9, 3.6), -3.2);
  b.dim(v(11.9, 3.6), v(11.9, 9.0), -3.2);
  b.dim(v(11.9, 9.0), v(11.9, 14.9), -3.2);
  // Cadenas de muros interiores (a ejes) por fuera de la casa
  const chainDims = (pts: number[], fixed: number, offset: number, vertical: boolean) => {
    for (let i = 0; i + 1 < pts.length; i++) b.dim(vertical ? v(fixed, pts[i]!) : v(pts[i]!, fixed), vertical ? v(fixed, pts[i + 1]!) : v(pts[i + 1]!, fixed), offset);
  };
  chainDims([0.1, 2.0, 3.6, 6.8, 11.9], 0.1, -2.2, false);
  chainDims([0.1, 5.2, 8.4, 11.9], 14.9, 3.8, false);
  chainDims([0.1, 3.6, 5.8, 9.0, 12.4, 14.9], 11.9, -2.5, true);
  // Zona social abierta (a caras terminadas)
  for (const [a, c] of [[4.66, 7.6], [7.6, 10.6], [10.6, 14.8]] as const) b.dim(v(4.45, a), v(4.45, c), 0);

  // ─── ELÉCTRICA: circuitos ────────────────────────────────────
  const C = (number: string, panel: string, description: string, voltage: 120 | 240, phase: "A" | "B" | "AB", breakerA: number, conductorAwg: string, conduit: string, tipo: string, extra: { continuous?: boolean; extraLoadVA?: number } = {}) =>
    b.circuit({ number, panel, description, voltage, phase, breakerA, conductorAwg, conduit, properties: { tipo }, ...extra });
  C("C1", "TR", "Alumbrado zona social y servicios", 120, "A", 15, "14", "PVC 1/2\"", "alumbrado");
  C("C2", "TR", "Alumbrado zona privada", 120, "B", 15, "14", "PVC 1/2\"", "alumbrado");
  C("C3", "TR", "Alumbrado exterior y paisajismo", 120, "A", 15, "12", "PVC 3/4\"", "alumbrado");
  C("C4", "TG", "Tomas sala, comedor, acceso y galería", 120, "A", 20, "12", "PVC 3/4\"", "tomas");
  C("C5", "TG", "Tomas cocina mesón (GFCI)", 120, "A", 20, "12", "PVC 3/4\"", "pequenos-artefactos");
  C("C6", "TG", "Tomas cocina isla (GFCI)", 120, "B", 20, "12", "PVC 3/4\"", "pequenos-artefactos");
  C("C7", "TG", "Tomas habitaciones 2 y 3", 120, "B", 20, "12", "PVC 3/4\"", "tomas");
  C("C8", "TG", "Tomas habitación principal y vestier", 120, "A", 20, "12", "PVC 3/4\"", "tomas");
  C("C9", "TG", "Tomas baños (GFCI) y toallero", 120, "B", 20, "12", "PVC 3/4\"", "tomas");
  C("C10", "TG", "Ropas: lavadora, secadora, plancha", 120, "A", 20, "12", "PVC 3/4\"", "lavanderia");
  C("C11", "TR", "Nevera (respaldo)", 120, "A", 20, "12", "PVC 3/4\"", "fijo");
  C("C12", "TG", "Horno eléctrico empotrado 3.6 kW", 240, "AB", 20, "12", "PVC 3/4\"", "fijo", { continuous: true });
  C("C13", "TG", "Lavavajillas", 120, "B", 20, "12", "PVC 3/4\"", "fijo");
  C("C14", "TG", "Microondas y campana de isla", 120, "A", 20, "12", "PVC 3/4\"", "fijo");
  C("C15", "TG", "Cargador vehículo eléctrico 1", 240, "AB", 40, "8", "PVC 1\"", "ev", { continuous: true });
  C("C16", "TG", "Cargador vehículo eléctrico 2", 240, "AB", 40, "8", "PVC 1\"", "ev", { continuous: true });
  C("C17", "TR", "Equipo de presión 1 HP", 240, "AB", 20, "12", "PVC 3/4\"", "fijo", { continuous: true });
  C("C18", "TG", "Tomas exteriores IP66 (GFCI)", 120, "B", 20, "12", "PVC 3/4\"", "tomas");
  C("C19", "TR", "Domótica, rack, CCTV y WiFi (UPS)", 120, "B", 20, "12", "PVC 3/4\"", "fijo", { continuous: true });
  C("C20", "TR", "Calentador y bomba de recirculación ACS", 120, "B", 20, "12", "PVC 3/4\"", "fijo");
  C("C21", "TG", "Cortinas motorizadas y chimenea", 120, "B", 20, "12", "PVC 3/4\"", "fijo");
  C("C22", "TG", "Inversor híbrido 8 kW (puerto red) → TR", 240, "AB", 50, "6", "PVC 1-1/4\"", "inversor");
  C("C23", "TG", "Reserva equipada", 120, "A", 20, "12", "—", "reserva");
  C("C24", "TG", "Reserva equipada", 120, "B", 20, "12", "—", "reserva");

  // ─── ELÉCTRICA: tableros y salidas ──────────────────────────
  const TG = v(3.44, 0.9);
  const TRp = v(3.44, 1.9);
  b.device("ELE", "tablero", TG, 1.5, { tablero: "TG", descripcion: "Tablero general TG" }, { rot: PI / 2, tag: "TG" });
  b.device("ELE", "tablero", TRp, 1.5, { tablero: "TR", descripcion: "Tablero de respaldo TR" }, { rot: PI / 2, tag: "TR" });
  b.device("ELE", "medidor", v(-2.9, -3.0), 1.5, { descripcion: "Medidor bidireccional" });
  b.device("ELE", "spt", v(-0.7, -0.7), 0, { descripcion: "Puesta a tierra" });

  type Out = [Vec2, number, string?];
  const E = (circuit: string, sym: string, outs: Out[], va: number, extra: Props = {}, panel = "TG") => {
    const ids: Vec2[] = [];
    for (const [at, h, name] of outs) {
      b.device("ELE", sym, at, h, { circuito: circuit, tablero: panel, va, ...extra }, name ? { name } : {});
      ids.push(at);
    }
    return ids;
  };
  const circuitRuns: { c: string; panel: string; pts: Vec2[]; disc: "ELE" | "ILU" | "DOM"; cond: string }[] = [];
  const addRun = (c: string, panel: string, pts: Vec2[], disc: "ELE" | "ILU" | "DOM" = "ELE", cond = "2#12+1#12T") => circuitRuns.push({ c, panel, pts, disc, cond });

  addRun("C4", "TG", E("C4", "toma", [[v(5.04, 10.9), 0.3], [v(5.04, 12.1), 0.3], [v(5.04, 14.3), 0.3], [v(5.04, 9.4), 0.3], [v(0.32, 9.0), 0.3], [v(3.78, 0.75), 0.3], [v(6.62, 7.8), 0.3]], 180));
  addRun("C5", "TG", E("C5", "toma-gfci", [[v(0.32, 4.6), 1.1], [v(0.32, 6.5), 1.1], [v(0.32, 7.25), 1.1]], 500));
  addRun("C6", "TG", E("C6", "toma-gfci", [[v(3.02, 4.1), 0.9], [v(3.02, 5.9), 0.9], [v(2.4, 5.75), 0.3, "Encendido cubierta de cocción"]], 500));
  addRun("C7", "TG", E("C7", "toma", [[v(7.85, 3.42), 0.5], [v(10.2, 3.42), 0.5], [v(7.9, 0.32), 0.8], [v(11.2, 0.32), 0.3], [v(6.98, 7.0), 0.5], [v(11.2, 5.98), 0.3], [v(11.68, 8.82), 0.3], [v(9.5, 8.82), 0.3]], 180));
  addRun("C8", "TG", E("C8", "toma", [[v(7.25, 12.22), 0.5], [v(9.85, 12.22), 0.5], [v(8.55, 9.18), 0.3], [v(5.38, 10.9), 0.3], [v(11.68, 12.22), 0.3], [v(8.22, 13.9), 1.1]], 180));
  addRun("C9", "TG", [
    ...E("C9", "toma-gfci", [[v(3.78, 4.2), 1.1], [v(8.9, 3.78), 1.1], [v(11.68, 14.45), 1.1]], 180),
    ...E("C9", "toma-especial", [[v(10.0, 12.58), 0.9, "Toallero eléctrico"]], 150),
  ]);
  addRun("C10", "TG", [
    ...E("C10", "toma-gfci", [[v(0.55, 0.32), 1.1, "Lavadora"]], 1000),
    ...E("C10", "toma", [[v(1.2, 0.32), 1.1, "Secadora a gas (motor)"]], 300),
    ...E("C10", "toma", [[v(1.82, 1.9), 1.1, "Plancha"]], 200),
  ]);
  addRun("C11", "TR", E("C11", "toma-especial", [[v(0.32, 3.2), 0.6, "Nevera"]], 600, {}, "TR"));
  addRun("C12", "TG", E("C12", "toma-240", [[v(0.32, 3.95), 0.6, "Horno eléctrico"]], 3600), "ELE", "2#12+1#12T");
  addRun("C13", "TG", E("C13", "toma-especial", [[v(0.32, 6.0), 0.3, "Lavavajillas"]], 1200));
  addRun("C14", "TG", [...E("C14", "toma-especial", [[v(0.32, 4.3), 1.5, "Microondas"]], 1200), ...E("C14", "toma-especial", [[v(2.4, 5.0), 2.6, "Campana de isla"]], 300)]);
  addRun("C15", "TG", E("C15", "ev", [[v(-0.12, 1.0), 1.2, "Cargador EV 1"]], 7680, { rotulo_dx: -9, rotulo_dy: 2.4 }), "ELE", "2#8+1#10T");
  addRun("C16", "TG", E("C16", "ev", [[v(-0.12, 4.6), 1.2, "Cargador EV 2"]], 7680, { rotulo_dx: -9, rotulo_dy: 2.4 }), "ELE", "2#8+1#10T");
  addRun("C17", "TR", E("C17", "salida-motor", [[v(-4.4, 7.2), 0.5, "Equipo de presión"]], 1920, {}, "TR"));
  addRun("C18", "TG", E("C18", "toma-ip", [[v(-0.12, 3.0), 0.4], [v(2.6, 15.12), 0.4], [v(12.12, 6.0), 0.4], [v(7.5, -0.12), 0.4]], 180));
  addRun("C19", "TR", E("C19", "toma-especial", [[v(2.2, 0.55), 0.5, "Rack de comunicaciones (UPS)"]], 800, {}, "TR"));
  addRun("C20", "TR", E("C20", "toma-especial", [[v(1.2, -0.14), 1.5, "Calentador de paso (encendido)"], [v(1.75, -0.14), 0.5, "Bomba de recirculación"]], 85, {}, "TR"));
  addRun("C21", "TG", E("C21", "toma-especial", [[v(5.04, 13.4), 0.3, "Chimenea a gas (ventilador y encendido)"]], 100));

  // ─── ILUMINACIÓN ─────────────────────────────────────────────
  const L18 = { w: 18, va: 18, lm: 1600, descripcion: "Downlight LED 18 W, 1600 lm, 3000 K, IRC 90, UGR < 19" };
  const L12 = { w: 12, va: 12, lm: 1000, descripcion: "Downlight LED 12 W, 1000 lm, 3000 K, IRC 90" };
  const L12IP = { w: 12, va: 12, lm: 1000, descripcion: "Downlight LED 12 W IP44, 1000 lm, 3000 K" };
  const I = (circuit: string, sym: string, pts: Vec2[], props: Props, h = 2.8, rot = 0) => {
    for (const p of pts) b.device("ILU", sym, p, h, { circuito: circuit, tablero: "TR", ...props, ocultar_rotulo: true }, { rot });
    return pts;
  };
  const c1: Vec2[] = [];
  c1.push(...I("C1", "downlight", grid(0.2, 5.14, 10.6, 14.8, 3, 2), L18));
  c1.push(...I("C1", "tira", [v(2.6, 14.62)], { w: 46, va: 46, lm: 4140, largo_m: 4.6, descripcion: "Tira LED 10 W/m en cortinero" }));
  c1.push(...I("C1", "colgante", [v(2.65, 9.3)], { w: 30, va: 30, lm: 2500, descripcion: "Lámpara colgante comedor 30 W" }, 2.0));
  c1.push(...I("C1", "downlight", [v(0.9, 8.1), v(4.4, 8.1), v(0.9, 10.1), v(4.4, 10.1)], L18));
  c1.push(...I("C1", "downlight", [v(1.25, 3.3), v(3.0, 3.3), v(1.25, 5.0), v(1.25, 6.8), v(3.3, 6.9), v(4.4, 5.6)], L18));
  c1.push(...I("C1", "lineal", [v(0.55, 5.85)], { w: 48, va: 48, lm: 4800, largo_m: 2.4, descripcion: "Perfil LED bajo alacena 20 W/m" }, 1.5, PI / 2));
  c1.push(...I("C1", "downlight", [v(4.5, 1.6), v(6.0, 1.6), v(5.2, 0.75)], L12));
  c1.push(...I("C1", "downlight", [v(6.0, 3.6), v(6.0, 5.9), v(6.0, 8.2)], L12));
  c1.push(...I("C1", "downlight-ip", [v(4.4, 3.6)], L12IP));
  c1.push(...I("C1", "aplique-espejo", [v(4.0, 4.42)], { w: 15, va: 15, lm: 1000, descripcion: "Luminaria de espejo 15 W" }, 1.9, PI));
  c1.push(...I("C1", "extractor", [v(4.85, 2.95)], { w: 15, va: 15, lm: 0 }));
  c1.push(...I("C1", "downlight", [v(1.07, 0.9), v(1.07, 1.9)], L12));
  c1.push(...I("C1", "lineal", [v(2.8, 1.3)], { w: 24, va: 24, lm: 2400, largo_m: 1.2, descripcion: "Perfil LED 1.20 m" }, 2.8, PI / 2));
  addRun("C1", "TR", c1, "ILU", "2#14+1#14T");

  const c2: Vec2[] = [];
  c2.push(...I("C2", "downlight", grid(6.86, 11.8, 0.2, 3.54, 2, 2), L18));
  c2.push(...I("C2", "downlight", [v(10.2, 4.7), v(11.25, 4.7)], L12));
  c2.push(...I("C2", "downlight-ip", [v(7.6, 4.6), v(8.99, 5.2)], L12IP));
  c2.push(...I("C2", "aplique-espejo", [v(8.0, 3.78)], { w: 15, va: 15, lm: 1000 }, 1.9));
  c2.push(...I("C2", "extractor", [v(7.25, 5.45)], { w: 15, va: 15, lm: 0 }));
  c2.push(...I("C2", "downlight", grid(6.86, 11.8, 5.86, 8.94, 2, 2), L18));
  c2.push(...I("C2", "downlight", [v(6.9, 9.9), v(10.2, 9.9), v(6.9, 11.5), v(10.2, 11.5)], L18));
  c2.push(...I("C2", "tira", [v(8.55, 12.2)], { w: 30, va: 30, lm: 2700, largo_m: 3.0, descripcion: "Tira LED en cabecero" }));
  c2.push(...I("C2", "downlight", grid(5.26, 8.34, 12.46, 14.8, 2, 2), L12));
  c2.push(...I("C2", "tira", [v(5.95, 13.6)], { w: 22, va: 22, lm: 1980, largo_m: 2.2, descripcion: "Tira LED en repisas" }, 1.0, PI / 2));
  c2.push(...I("C2", "downlight-ip", [v(9.2, 14.25), v(10.2, 13.4), v(11.0, 13.4)], L12IP));
  c2.push(...I("C2", "aplique-espejo", [v(11.68, 13.1), v(11.68, 13.9)], { w: 15, va: 15, lm: 1000 }, 1.9, PI / 2));
  c2.push(...I("C2", "extractor", [v(10.0, 12.75)], { w: 15, va: 15, lm: 0 }));
  addRun("C2", "TR", c2, "ILU", "2#14+1#14T");

  const c3: Vec2[] = [];
  c3.push(...I("C3", "downlight-ip", grid(-6.1, -0.05, 0, 6.2, 2, 2), { w: 15, va: 15, lm: 1300, descripcion: "Downlight LED 15 W IP65" }, 2.6));
  c3.push(...I("C3", "aplique", [v(3.6, -0.08), v(6.75, -0.08), v(2.15, -0.08)], { w: 10, va: 10, lm: 700 }, 2.2, PI));
  c3.push(...I("C3", "aplique", [v(5.0, 15.08), v(0.15, 15.08)], { w: 10, va: 10, lm: 700 }, 2.2, 0));
  c3.push(...I("C3", "aplique", [v(12.08, 4.6), v(12.08, 12.6)], { w: 10, va: 10, lm: 700 }, 2.2, -PI / 2));
  c3.push(...I("C3", "aplique", [v(-0.08, 9.0)], { w: 10, va: 10, lm: 700 }, 2.2, PI / 2));
  c3.push(...I("C3", "baliza", [v(1.0, 18.3), v(3.5, 18.3), v(6.0, 18.3), v(13.6, 2.0), v(13.6, 8.0), v(13.6, 14.0)], { w: 5, va: 5, lm: 300 }, 0.6));
  addRun("C3", "TR", c3, "ILU", "2#12+1#12T");

  // Recorridos de circuitos: cadena desde el tablero por vecino más cercano.
  for (const r of circuitRuns) {
    const panel = r.panel === "TG" ? TG : TRp;
    const ordered = chain(panel, r.pts);
    const path = orthoPath([panel, ...ordered], "y");
    b.run_(r.disc, "CIR", path, { circuito: r.c, tablero: r.panel, conductor: r.cond, rotulo_t: 0.5 }, `${r.c} · ${r.cond}`);
  }
  // Acometida eléctrica
  b.run_("ELE", "ACO", [v(-2.9, -3.0), v(-2.9, -1.6), v(3.0, -1.6), v(3.0, 0.9), TG], { conductor: "2#1+1#1N+1#6T" }, "Acometida 2#1+1#1(N)+1#6(T) Cu · PVC 2\"");

  // ─── DOMÓTICA Y COMUNICACIONES ───────────────────────────────
  const RACK = v(2.2, 0.9);
  b.device("DOM", "rack", RACK, 0.4, { descripcion: "Rack 12U: router, switch PoE 24p, KNX IP, NVR, UPS 1.5 kVA" }, { rot: PI / 2 });
  const D = (sym: string, pts: [Vec2, number, string?][], props: Props = {}) => pts.map(([p, h, name]) => (b.device("DOM", sym, p, h, { ...props, ocultar_rotulo: true }, name ? { name } : {}), p));
  const bus: Vec2[] = [];
  bus.push(...D("pulsador", [[v(6.62, 0.7), 1.2, "Acceso: escenas Llegada / Salida"], [v(3.44, 3.1), 1.2, "Cocina"], [v(5.04, 9.6), 1.2, "Comedor"], [v(5.04, 14.5), 1.2, "Sala / terraza"], [v(6.98, 2.3), 1.2, "Habitación 2"], [v(6.98, 7.1), 1.2, "Habitación 3"], [v(6.65, 9.18), 1.2, "Habitación principal"], [v(7.0, 12.22), 0.8, "Cabecero izq."], [v(10.1, 12.22), 0.8, "Cabecero der."], [v(6.6, 12.58), 1.2, "Vestier principal"], [v(1.82, 2.42), 1.2, "Ropas"]]));
  bus.push(...D("sensor-presencia", [[v(6.0, 4.7), 2.8], [v(4.6, 3.2), 2.8], [v(8.2, 4.4), 2.8], [v(9.9, 13.6), 2.8], [v(6.8, 13.75), 2.8], [v(10.7, 5.2), 2.8], [v(0.6, 1.4), 2.8], [v(3.0, 2.0), 2.8], [v(5.2, 1.9), 2.8], [v(-1.0, 3.0), 2.6, "PIR exterior parqueadero"], [v(5.2, -0.6), 2.6, "PIR exterior acceso"]]));
  bus.push(...D("termostato", [[v(5.04, 11.6), 1.5, "Sala"], [v(10.6, 9.18), 1.5, "Habitación principal"]]));
  const cort: [Vec2, number, string?][] = [[v(0.32, 12.7), 2.6, "Cortina sala occidente"], [v(2.6, 14.68), 2.6, "Cortina sala norte"], [v(0.32, 9.1), 2.6, "Cortina comedor"], [v(11.68, 10.7), 2.4, "Cortina habitación principal"], [v(11.68, 7.4), 2.4, "Cortina habitación 3"], [v(11.68, 1.85), 2.4, "Cortina habitación 2 oriente"], [v(9.4, 0.32), 2.4, "Cortina habitación 2 sur"]];
  for (const [p, h, name] of cort) b.device("DOM", "cortina", p, h, { circuito: "C21", tablero: "TG", va: 100, ocultar_rotulo: true }, name ? { name } : {});
  bus.push(...cort.map((c) => c[0]));
  bus.push(...D("fuga-agua", [[v(0.45, 5.25), 0.05], [v(0.45, 0.9), 0.05], [v(4.75, 2.9), 0.05], [v(8.0, 4.35), 0.05], [v(11.2, 14.55), 0.05], [v(3.2, 2.3), 0.05]]));
  bus.push(...D("detector-gas", [[v(0.35, 7.0), 2.5, "Cocina"], [v(0.35, 0.45), 2.5, "Ropas (secadora)"], [v(4.95, 14.1), 2.5, "Sala (chimenea)"]]));
  bus.push(...D("magnetico", [[v(5.75, 0.32), 2.2, "Puerta principal"], [v(0.32, 2.45), 2.2, "Puerta ropas"], [v(2.35, 0.32), 2.2, "Puerta cuarto técnico"]]));
  bus.push(...D("valvula-motorizada", [[v(0.45, 0.55), 0.3, "Electroválvula corte de agua"]]));
  bus.push(...D("cerradura", [[v(5.75, 0.62), 1.0, "Cerradura inteligente puerta principal"]]));
  b.run_("DOM", "BUS", orthoPath([RACK, ...chain(RACK, bus)], "x"), {}, "Bus KNX");
  const lan: Vec2[] = [];
  lan.push(...D("humo", [[v(6.0, 7.6), 2.8], [v(9.3, 1.9), 2.8], [v(9.3, 7.4), 2.8], [v(6.2, 10.7), 2.8], [v(3.0, 9.6), 2.8], [v(2.6, 0.55), 2.8]]));
  lan.push(...D("camara", [[v(-0.25, -0.25), 2.6, "Cámara parqueadero"], [v(7.1, -0.25), 2.6, "Cámara acceso"], [v(12.25, 15.25), 2.6, "Cámara terraza / jardín"], [v(-0.25, 15.25), 2.6, "Cámara terraza occidente"], [v(12.25, -0.25), 2.6, "Cámara costado oriental"]]));
  lan.push(...D("ap-wifi", [[v(6.0, 6.6), 2.8], [v(2.6, 12.0), 2.8], [v(8.6, 10.6), 2.8]]));
  lan.push(...D("tv", [[v(5.04, 12.7), 1.5, "TV sala"], [v(8.55, 9.18), 1.5, "TV habitación principal"]]));
  lan.push(...D("datos", [[v(8.2, 0.32), 0.8, "Escritorio habitación 2"], [v(9.5, 8.82), 0.8, "Habitación 3"], [v(3.44, 3.7), 1.2, "Pantalla domótica cocina"]]));
  lan.push(...D("videoportero", [[v(6.55, -0.15), 1.5, "Frente exterior"], [v(6.62, 1.5), 1.5, "Monitor interior"]]));
  b.run_("DOM", "DAT", orthoPath([RACK, ...chain(RACK, lan)], "y"), {}, "Cat 6A / PoE");
  b.run_("DOM", "DAT", orthoPath([RACK, v(-0.12, 1.0), v(-0.12, 4.6)], "x"), {}, "OCPP: gestión de carga EV");
  b.run_("DOM", "DAT", orthoPath([RACK, v(2.95, 2.3)], "y"), {}, "Monitoreo inversor");
  b.device("DOM", "valvula-motorizada", v(-1.3, -2.55), 0.5, { ocultar_rotulo: true }, { name: "Electroválvula de corte de gas" });

  // ─── HIDRÁULICA ──────────────────────────────────────────────
  const H = (sym: string, at: Vec2, h: number, props: Props, name: string) => b.device("HID", sym, at, h, { ...props, ocultar_rotulo: true }, { name });
  H("medidor-agua", v(-0.9, -3.0), 0.3, {}, "Medidor de agua 3/4\" con registro y cheque");
  H("tanque", v(-5.7, 7.55), 0, { diametro_m: 1.5, rotulo: "2 m³" }, "Tanque de reserva 2 000 L");
  H("bomba", v(-4.4, 7.55), 0.3, {}, "Equipo de presión 1 HP, 40 m.c.a., tanque 80 L");
  H("filtro", v(-4.4, 6.85), 0.3, {}, "Filtro de sedimentos + carbón activado");
  H("calentador", v(1.2, -0.38), 1.5, { uc_ac: 0 }, "Calentador de paso a gas 20 L/min, tiro forzado, tipo exterior");
  H("bomba-recirculacion", v(1.95, -0.38), 0.5, {}, "Bomba de recirculación ACS 1/25 HP con temporizador");
  // Salidas de aparatos con sus unidades de consumo (NTC 1500)
  const pts: [string, Vec2, number, Props, string][] = [
    ["punto-af", v(0.55, 0.32), 1.0, { uc_af: 2 }, "Lavadora"],
    ["punto-af", v(1.82, 0.75), 1.0, { uc_af: 2 }, "Lavadero"],
    ["punto-af", v(0.32, 3.2), 0.3, { uc_af: 0.5 }, "Nevera (dispensador)"],
    ["punto-afac", v(0.32, 5.25), 0.5, { uc_af: 1.5, uc_ac: 1.5 }, "Lavaplatos"],
    ["punto-af", v(0.32, 6.0), 0.4, { uc_af: 1.5 }, "Lavavajillas"],
    ["punto-af", v(4.3, 2.78), 0.2, { uc_af: 3 }, "Sanitario baño social"],
    ["punto-af", v(4.0, 4.42), 0.55, { uc_af: 0.75 }, "Lavamanos baño social"],
    ["punto-afac", v(7.65, 3.78), 0.55, { uc_af: 0.75, uc_ac: 0.75 }, "Lavamanos 1 baño 2"],
    ["punto-afac", v(8.35, 3.78), 0.55, { uc_af: 0.75, uc_ac: 0.75 }, "Lavamanos 2 baño 2"],
    ["punto-af", v(9.42, 4.2), 0.2, { uc_af: 3 }, "Sanitario baño 2"],
    ["punto-afac", v(8.99, 5.62), 1.1, { uc_af: 1.5, uc_ac: 1.5 }, "Ducha baño 2 (mezclador termostático)"],
    ["punto-af", v(10.55, 14.68), 0.2, { uc_af: 3 }, "Sanitario baño principal"],
    ["punto-afac", v(11.68, 13.1), 0.55, { uc_af: 0.75, uc_ac: 0.75 }, "Lavamanos 1 baño principal"],
    ["punto-afac", v(11.68, 13.9), 0.55, { uc_af: 0.75, uc_ac: 0.75 }, "Lavamanos 2 baño principal"],
    ["punto-afac", v(9.21, 14.68), 1.1, { uc_af: 1.5, uc_ac: 1.5 }, "Ducha baño principal (lluvia + mano)"],
  ];
  for (const [sym, at, h, props, name] of pts) H(sym, at, h, props, name);
  H("llave-jardin", v(2.0, 15.12), 0.5, { uc_af: 2 }, "Llave de jardín terraza");
  H("llave-jardin", v(12.12, 4.0), 0.5, { uc_af: 2 }, "Llave de jardín oriente");
  H("llave-jardin", v(-0.12, 5.6), 0.5, { uc_af: 2 }, "Llave de lavado parqueadero");
  for (const [at, name] of [[v(0.45, 0.7), "Registro general"], [v(0.45, 2.35), "Registro cocina"], [v(4.2, 2.35), "Registro baño social"], [v(6.0, 4.0), "Registro baño 2"], [v(6.0, 8.7), "Registro baño principal"], [v(-4.4, 6.4), "Registro salida equipo de presión"]] as const) H("valvula", at, 0.3, {}, name);

  const AF = (tag: string, path: Vec2[], props: Props) => b.run_("HID", "AF", path, props, tag);
  const ACr = (tag: string, path: Vec2[], props: Props) => b.run_("HID", "AC", path, props, tag);
  b.run_("HID", "PRI", [v(-0.9, -3.0), v(-0.9, -1.2), v(-7.0, -1.2), v(-7.0, 7.55), v(-6.45, 7.55)], { tramo: "T-0 Acometida → tanque", uc: 36.75, q_l_s: 0.3, di_mm: 30.2, diametro: "PVC 1\" RDE 21" }, "T-0 PVC 1\"");
  b.run_("HID", "PRI", [v(-4.4, 7.55), v(-4.4, 6.4), v(-0.35, 6.4), v(-0.35, 0.7), v(0.45, 0.7)], { tramo: "T-1 Bomba → registro general", uc: 36.75, di_mm: 38.1, diametro: "PVC 1-1/4\" RDE 21" }, "T-1 PVC 1-1/4\"");
  AF("T-2 Ø40", [v(0.45, 0.7), v(0.45, 2.35)], { tramo: "T-2 Registro general → derivación cocina", uc: 36.75, di_mm: 33, diametro: "Multicapa 40" });
  AF("T-3 Ø25", [v(0.45, 0.7), v(1.2, 0.7), v(1.2, -0.38)], { tramo: "T-3 Alimentación calentador", uc: 7.5, di_mm: 20, diametro: "Multicapa 25" });
  AF("Ø20", [v(0.45, 0.7), v(0.55, 0.7), v(0.55, 0.32)], {});
  AF("Ø20", [v(1.2, 0.7), v(1.82, 0.7), v(1.82, 0.75)], {});
  AF("T-5 Ø25", [v(0.45, 2.35), v(0.32, 2.35), v(0.32, 6.0)], { tramo: "T-5 Ramal cocina", uc: 7.5, di_mm: 20, diametro: "Multicapa 25" });
  AF("Ø20", [v(0.32, 5.6), v(-0.12, 5.6)], {});
  AF("Ø20", [v(0.32, 6.0), v(0.32, 6.3), v(0.6, 6.3), v(0.6, 14.55), v(2.0, 14.55), v(2.0, 15.12)], {});
  AF("T-4 Ø32", [v(0.45, 2.35), v(6.0, 2.35)], { tramo: "T-4 Troncal social → galería", uc: 25.25, di_mm: 26, diametro: "Multicapa 32" });
  AF("T-6 Ø20", [v(4.2, 2.35), v(4.2, 4.42), v(4.0, 4.42)], { tramo: "T-6 Ramal baño social", uc: 3.75, di_mm: 16, diametro: "Multicapa 20" });
  AF("Ø16", [v(4.2, 2.78), v(4.3, 2.78)], {});
  AF("T-7 Ø32", [v(6.0, 2.35), v(6.0, 8.7)], { tramo: "T-7 Troncal galería", uc: 14, di_mm: 26, diametro: "Multicapa 32" });
  AF("T-8 Ø25", [v(6.0, 4.0), v(9.42, 4.0), v(9.42, 4.2)], { tramo: "T-8 Ramal baño 2 + llave oriente", uc: 8, di_mm: 20, diametro: "Multicapa 25" });
  AF("Ø16", [v(7.65, 4.0), v(7.65, 3.78)], {});
  AF("Ø16", [v(8.35, 4.0), v(8.35, 3.78)], {});
  AF("Ø16", [v(9.1, 4.0), v(9.1, 5.62), v(8.99, 5.62)], {});
  AF("Ø20", [v(9.42, 4.0), v(12.12, 4.0)], {});
  AF("T-9 Ø25", [v(6.0, 8.7), v(9.0, 8.7), v(9.0, 12.9), v(11.55, 12.9), v(11.55, 13.9), v(11.68, 13.9)], { tramo: "T-9 Ramal baño principal", uc: 6, di_mm: 20, diametro: "Multicapa 25" });
  AF("Ø16", [v(11.55, 13.1), v(11.68, 13.1)], {});
  AF("Ø16", [v(9.0, 12.9), v(9.0, 14.68), v(9.21, 14.68)], {});
  AF("Ø16", [v(9.0, 14.3), v(10.55, 14.3), v(10.55, 14.68)], {});
  // Agua caliente y recirculación
  ACr("T-10 Ø25", [v(1.2, -0.38), v(1.35, -0.38), v(1.35, 2.25), v(5.9, 2.25), v(5.9, 8.6), v(8.9, 8.6), v(8.9, 12.8)], { tramo: "T-10 Troncal agua caliente", uc: 7.5, di_mm: 20, diametro: "Multicapa 25 aislada" });
  ACr("T-11 Ø16", [v(1.35, 2.25), v(0.42, 2.25), v(0.42, 5.25), v(0.32, 5.25)], { tramo: "T-11 Ramal AC cocina", uc: 1.5, di_mm: 12, diametro: "Multicapa 16 aislada" });
  ACr("T-12 Ø16", [v(5.9, 3.9), v(8.9, 3.9), v(8.9, 5.62), v(8.99, 5.62)], { tramo: "T-12 Ramal AC baño 2", uc: 3, di_mm: 12, diametro: "Multicapa 16 aislada" });
  ACr("Ø16", [v(7.65, 3.9), v(7.65, 3.78)], {});
  ACr("Ø16", [v(8.35, 3.9), v(8.35, 3.78)], {});
  ACr("T-13 Ø16", [v(8.9, 12.8), v(11.45, 12.8), v(11.45, 13.9), v(11.68, 13.9)], { tramo: "T-13 Ramal AC baño principal", uc: 3, di_mm: 12, diametro: "Multicapa 16 aislada" });
  ACr("Ø16", [v(11.45, 13.1), v(11.68, 13.1)], {});
  ACr("Ø16", [v(8.9, 12.8), v(8.9, 14.6), v(9.21, 14.6), v(9.21, 14.68)], {});
  b.run_("HID", "RC", [v(11.45, 13.9), v(11.35, 13.9), v(11.35, 12.7), v(8.8, 12.7), v(8.8, 8.5), v(5.8, 8.5), v(5.8, 2.15), v(1.45, 2.15), v(1.45, -0.2), v(1.95, -0.2), v(1.95, -0.38)], {}, "Retorno recirculación Ø16");

  // ─── SANITARIA ───────────────────────────────────────────────
  const S = (sym: string, at: Vec2, props: Props, name: string, tag?: string) => b.device("SAN", sym, at, 0, { ...props, ocultar_rotulo: true }, { name, ...(tag ? { tag } : {}) });
  S("salida-sanitario", v(10.55, 14.45), { ud: 4 }, "Sanitario baño principal");
  S("sifon", v(11.55, 13.1), { ud: 1 }, "Lavamanos 1 baño principal");
  S("sifon", v(11.55, 13.9), { ud: 1 }, "Lavamanos 2 baño principal");
  S("rejilla", v(9.21, 14.25), { ud: 2 }, "Rejilla ducha baño principal");
  S("salida-sanitario", v(9.2, 4.2), { ud: 4 }, "Sanitario baño 2");
  S("sifon", v(7.65, 3.9), { ud: 1 }, "Lavamanos 1 baño 2");
  S("sifon", v(8.35, 3.9), { ud: 1 }, "Lavamanos 2 baño 2");
  S("rejilla", v(8.99, 5.19), { ud: 2 }, "Rejilla ducha baño 2");
  S("salida-sanitario", v(4.3, 2.98), { ud: 4 }, "Sanitario baño social");
  S("sifon", v(4.0, 4.3), { ud: 1 }, "Lavamanos baño social");
  S("rejilla", v(4.75, 3.7), { ud: 1 }, "Rejilla de piso baño social");
  S("sifon", v(0.42, 5.25), { ud: 2 }, "Lavaplatos (con trampa de grasas)");
  S("sifon", v(0.42, 6.0), { ud: 2 }, "Lavavajillas");
  S("sifon", v(0.55, 0.45), { ud: 3 }, "Lavadora");
  S("sifon", v(1.75, 0.75), { ud: 2 }, "Lavadero");
  S("rejilla", v(1.0, 1.55), { ud: 1 }, "Rejilla de piso ropas");
  for (const [at, name] of [[v(10.0, 14.45), "Ventilación baño principal"], [v(9.4, 4.55), "Ventilación baño 2"], [v(4.95, 2.85), "Ventilación baño social"], [v(0.42, 6.55), "Ventilación cocina"], [v(1.8, 0.4), "Ventilación ropas"]] as const) S("ventilacion", at, {}, name);
  const cajas: [string, Vec2, string][] = [
    ["CI-1", v(13.0, 13.6), "Caja de inspección 60×60, batea −0.45"],
    ["CI-2", v(13.0, 4.3), "Caja de inspección 60×60, batea −0.64"],
    ["CI-3", v(13.0, -1.6), "Caja de inspección 80×80, batea −0.80"],
    ["CI-4", v(4.0, -1.6), "Caja de inspección 60×60, batea −0.55"],
    ["CI-5", v(8.5, -1.6), "Caja de inspección 60×60, batea −0.66"],
    ["CI-W", v(-0.75, -1.6), "Caja de inspección 60×60, batea −0.62"],
  ];
  for (const [tag, at, name] of cajas) S("caja", at, { lado_m: tag === "CI-3" ? 0.8 : 0.6 }, name, tag);
  S("trampa-grasas", v(-0.75, 5.4), {}, "Trampa de grasas 60 L");
  S("septico", v(15.6, -3.4), { largo_m: 2.6, ancho_m: 1.4, rotulo: "SÉPTICO + FAFA" }, "Sistema séptico integrado 2 000 L + FAFA (si la parcelación no tiene alcantarillado)");
  b.note("SAN", "dashed", rect(14.3, -6.4, 19.2, -4.6), undefined, {});
  b.note("SAN", "text", [v(16.75, -5.3)], "CAMPO DE INFILTRACIÓN", { align: "center", bold: true }, 1.8);
  b.note("SAN", "text", [v(16.75, -5.75)], "(según ensayo de percolación)", { align: "center" }, 1.6);
  b.run_("SAN", "AN", [v(16.9, -4.1), v(16.9, -4.6)], {}, "");
  const AN = (tag: string, path: Vec2[], props: Props) => b.run_("SAN", "AN", path, props, tag);
  AN("Ø2\"", [v(11.55, 13.1), v(11.55, 13.6)], {});
  AN("Ø2\"", [v(11.55, 13.9), v(11.55, 13.6)], {});
  AN("Ø2\"", [v(9.21, 14.25), v(9.21, 13.6)], {});
  AN("Ø4\"", [v(10.55, 14.45), v(10.55, 13.6)], {});
  AN("R-1 Ø4\" S=2%", [v(9.21, 13.6), v(13.0, 13.6)], { tramo: "R-1 Baño principal → CI-1", ud: 8, diametro_pulg: "4", pendiente_pct: 2, sanitarios: 1 });
  AN("Ø2\"", [v(7.65, 3.9), v(7.65, 4.35)], {});
  AN("Ø2\"", [v(8.35, 3.9), v(8.35, 4.35)], {});
  AN("Ø2\"", [v(8.99, 5.19), v(8.99, 4.35)], {});
  AN("Ø4\"", [v(9.2, 4.2), v(9.2, 4.35)], {});
  AN("R-2 Ø4\" S=2%", [v(7.65, 4.35), v(13.0, 4.35), v(13.0, 4.3)], { tramo: "R-2 Baño 2 → CI-2", ud: 8, diametro_pulg: "4", pendiente_pct: 2, sanitarios: 1 });
  AN("R-3 Ø4\" S=2%", [v(13.0, 13.6), v(13.0, 4.3)], { tramo: "R-3 CI-1 → CI-2", ud: 8, diametro_pulg: "4", pendiente_pct: 2, sanitarios: 1 });
  AN("R-4 Ø4\" S=2%", [v(13.0, 4.3), v(13.0, -1.6)], { tramo: "R-4 CI-2 → CI-3", ud: 16, diametro_pulg: "4", pendiente_pct: 2, sanitarios: 2 });
  AN("R-5 Ø3\" S=2%", [v(0.42, 6.0), v(0.42, 5.25), v(-0.75, 5.25), v(-0.75, 5.4)], { tramo: "R-5 Cocina → trampa de grasas", ud: 4, diametro_pulg: "3", pendiente_pct: 2 });
  AN("R-6 Ø3\" S=2%", [v(-0.75, 5.4), v(-0.75, -1.6)], { tramo: "R-6 Trampa de grasas → CI-W", ud: 4, diametro_pulg: "3", pendiente_pct: 2 });
  AN("R-7 Ø3\" S=2%", [v(1.75, 0.75), v(1.0, 0.75), v(1.0, 1.55), v(0.55, 1.55), v(0.55, 0.45), v(-0.75, 0.45)], { tramo: "R-7 Ropas → colector occidental", ud: 6, diametro_pulg: "3", pendiente_pct: 2 });
  AN("Ø2\"", [v(4.0, 4.3), v(4.0, 3.7), v(4.75, 3.7)], {});
  AN("R-8 Ø4\" S=2%", [v(4.0, 3.7), v(4.0, 2.98), v(4.3, 2.98), v(4.0, 2.98), v(4.0, -1.6)], { tramo: "R-8 Baño social → CI-4", ud: 6, diametro_pulg: "4", pendiente_pct: 2, sanitarios: 1 });
  AN("R-9 Ø4\" S=2%", [v(-0.75, -1.6), v(4.0, -1.6)], { tramo: "R-9 CI-W → CI-4", ud: 10, diametro_pulg: "4", pendiente_pct: 2 });
  AN("R-10 Ø4\" S=2%", [v(4.0, -1.6), v(8.5, -1.6)], { tramo: "R-10 CI-4 → CI-5", ud: 16, diametro_pulg: "4", pendiente_pct: 2, sanitarios: 1 });
  AN("R-11 Ø4\" S=2%", [v(8.5, -1.6), v(13.0, -1.6)], { tramo: "R-11 CI-5 → CI-3", ud: 16, diametro_pulg: "4", pendiente_pct: 2, sanitarios: 1 });
  AN("R-12 Ø4\" S=2%", [v(13.0, -1.6), v(13.0, -3.4), v(14.3, -3.4)], { tramo: "R-12 CI-3 → sistema séptico", ud: 34, diametro_pulg: "4", pendiente_pct: 2, sanitarios: 3 });
  // Aguas lluvias en terreno
  const ALL = (tag: string, path: Vec2[], props: Props) => b.run_("SAN", "ALL", path, props, tag);
  for (const [tag, at] of [["CALL-1", v(13.75, 0.5)], ["CALL-2", v(13.75, 7.5)], ["CALL-3", v(13.75, 14.5)], ["CALL-4", v(-6.75, 6.2)]] as const) S("caja", at, { lado_m: 0.5 }, `Caja de aguas lluvias ${tag}`, tag);
  for (const at of [v(12.75, 0.5), v(12.75, 7.5), v(12.75, 14.5)]) S("bajante", at, {}, "Bajante de aguas lluvias Ø4\"");
  S("bajante", v(-6.3, 6.2), {}, "Bajante cubierta parqueadero Ø3\"");
  ALL("Ø4\"", [v(12.75, 14.5), v(13.75, 14.5)], {});
  ALL("Ø4\"", [v(12.75, 7.5), v(13.75, 7.5)], {});
  ALL("Ø4\"", [v(12.75, 0.5), v(13.75, 0.5)], {});
  ALL("ALL Ø6\" S=1%", [v(13.75, 14.5), v(13.75, 7.5), v(13.75, 0.5), v(13.75, -0.6), v(17.5, -0.6)], { tramo: "Colector oriental de aguas lluvias", area_m2: 229, diametro: "PVC 6\"", capacidad_l_s: 19 });
  ALL("Ø4\"", [v(-6.3, 6.2), v(-6.75, 6.2), v(-6.75, -0.6), v(-8.0, -0.6)], {});
  b.device("SAN", "tanque", v(15.4, 10.5), 0, { diametro_m: 1.5, rotulo: "ALL 2 m³", ocultar_rotulo: true }, { name: "Tanque de aprovechamiento de aguas lluvias para riego" });
  ALL("Ø4\" a tanque", [v(13.75, 10.5), v(14.65, 10.5)], {});
  b.note("SAN", "text", [v(17.6, -0.95)], "A CUNETA / POZO DE INFILTRACIÓN", {}, 1.6);
  b.note("SAN", "text", [v(-8.0, -0.95)], "A CUNETA", { align: "right" }, 1.6);

  // ─── GAS ─────────────────────────────────────────────────────
  b.device("GAS", "medidor-gas", v(-1.9, -3.0), 1.0, { ocultar_rotulo: true }, { name: "Centro de medición G6, regulador 2.ª etapa 20 mbar" });
  b.device("GAS", "valvula-gas", v(-1.9, -2.3), 0.5, { ocultar_rotulo: true }, { name: "Válvula de corte general" });
  const G = (at: Vec2, kw: number, tag: string, name: string, h = 0.6) => b.device("GAS", "artefacto-gas", at, h, { kw, ocultar_rotulo: true }, { name, tag });
  G(v(1.2, -0.85), 36, "CAL 36 kW", "Calentador de paso 20 L/min (36 kW)", 1.5);
  G(v(1.2, 1.25), 6, "SEC 6 kW", "Secadora a gas (6 kW)", 0.3);
  G(v(2.41, 4.35), 11, "EST 11 kW", "Cubierta de cocción 5 puestos (11 kW)", 0.5);
  G(v(4.6, 12.95), 8, "CHI 8 kW", "Chimenea a gas de cámara estanca (8 kW)", 0.3);
  G(v(4.6, 17.35), 10, "BBQ 10 kW", "Asador a gas terraza (10 kW)", 0.6);
  const gp = (at: Vec2, name: string) => b.device("GAS", "punto-gas", at, 0.5, { ocultar_rotulo: true }, { name });
  gp(v(1.0, -0.38), "Salida calentador");
  gp(v(1.35, 0.55), "Salida secadora");
  gp(v(2.6, 5.0), "Salida cubierta de cocción (bajo piso en camisa)");
  gp(v(4.95, 12.7), "Salida chimenea");
  gp(v(4.6, 17.7), "Salida asador");
  b.device("GAS", "rejilla-ventilacion", v(0.32, 1.3), 0.3, { ocultar_rotulo: true }, { name: "Rejilla de ventilación inferior ropas 150 cm²", rot: PI / 2 } as never);
  const GR = (tag: string, path: Vec2[], props: Props) => b.run_("GAS", "GAS", path, props, tag);
  GR("G-1 PE 1\"", [v(-1.9, -3.0), v(-1.9, -0.9), v(1.0, -0.9)], { tramo: "G-1 Medidor → derivación", kw: 71, di_mm: 26.2, diametro: "PE 32 mm SDR 11", ruta_critica: true, vertical_m: 0.6 });
  GR("G-2 Ø20", [v(1.0, -0.9), v(1.0, -0.38)], { tramo: "G-2 Ramal calentador", kw: 36, di_mm: 20, diametro: "PE-AL-PE 2025", vertical_m: 1.0 });
  GR("G-3 Ø20", [v(1.0, -0.9), v(0.9, -0.9), v(0.9, 0.55)], { tramo: "G-3 Subida → derivación secadora", kw: 35, di_mm: 20, diametro: "PE-AL-PE 2025", ruta_critica: true, vertical_m: 2.6 });
  GR("Ø16", [v(0.9, 0.55), v(1.35, 0.55)], { });
  GR("G-4 Ø20", [v(0.9, 0.55), v(0.9, 2.45), v(3.0, 2.45), v(3.0, 5.0)], { tramo: "G-4 Derivación secadora → cocina", kw: 29, di_mm: 20, diametro: "PE-AL-PE 2025", ruta_critica: true });
  GR("Ø16 bajo piso", [v(3.0, 5.0), v(2.6, 5.0)], {});
  GR("G-5 Ø20", [v(3.0, 5.0), v(3.0, 7.6), v(4.95, 7.6), v(4.95, 12.7)], { tramo: "G-5 Cocina → chimenea", kw: 18, di_mm: 20, diametro: "PE-AL-PE 2025", ruta_critica: true });
  GR("G-6 Ø16", [v(4.95, 12.7), v(4.95, 15.0), v(4.6, 15.0), v(4.6, 17.7)], { tramo: "G-6 Chimenea → asador terraza", kw: 10, di_mm: 16, diametro: "PE-AL-PE 1620", ruta_critica: true, vertical_m: 2.4 });

  // ─── SOLAR (equipos en cuarto técnico) ───────────────────────
  b.device("SOL", "inversor", v(2.95, 2.3), 1.4, { ocultar_rotulo: true }, { name: "Inversor híbrido 8 kW 120/240 V" });
  b.device("SOL", "bateria", v(2.95, 1.75), 0.1, { ocultar_rotulo: true }, { name: "Baterías LiFePO4 48 V 10.24 kWh" });
  b.device("SOL", "combinadora", v(2.8, 1.2), 1.6, { ocultar_rotulo: true }, { name: "Caja combinadora DC" });
  b.run_("SOL", "DC", [v(2.4, 2.54), v(2.4, 1.2), v(2.8, 1.2)], {}, "Bajante DC desde cubierta");
  b.run_("SOL", "DC", [v(2.8, 1.2), v(2.8, 2.3)], {}, "");
  b.run_("SOL", "ACS", [v(2.95, 2.3), v(3.3, 2.3), v(3.3, 0.9), TG], {}, "AC inversor ↔ TG/TR");

  // ─── CUBIERTA (nivel superior) ───────────────────────────────
  b.levelId = roof;
  b.note("ARQ", "outline", rect(-0.9, -0.8, 12.9, 15.8), undefined, { weight: 0.5 });
  b.note("ARQ", "dashed", rect(0, 0, 12, 15), undefined, {});
  b.note("ARQ", "text", [v(6.0, 15.3)], "CUBIERTA EN PANEL SÁNDWICH TERMOACÚSTICO e = 50 mm SOBRE CORREAS METÁLICAS", { align: "center", bold: true }, 2);
  for (const y of [2.0, 8.0, 13.6]) b.note("ARQ", "arrow", [v(7.4, y), v(11.4, y)], "PENDIENTE 10 %");
  b.note("ARQ", "text", [v(-0.7, 7.5)], "BORDE ALTO N+4.45", { rot: PI / 2, align: "center", bold: true }, 2);
  b.note("ARQ", "text", [v(13.3, 7.5)], "BORDE BAJO N+3.05", { rot: PI / 2, align: "center", bold: true }, 2);
  b.note("ARQ", "polygon", rect(3.9, 3.0, 4.9, 4.2), undefined, {});
  b.note("ARQ", "text", [v(4.4, 2.6)], "CLARABOYA", { align: "center" }, 1.6);
  b.note("ARQ", "polygon", rect(7.2, 4.4, 8.2, 5.4), undefined, {});
  b.note("ARQ", "text", [v(7.7, 4.0)], "CLARABOYA", { align: "center" }, 1.6);
  b.note("ARQ", "outline", rect(-6.25, -0.15, -0.9, 6.35), undefined, { weight: 0.4 });
  b.note("ARQ", "dashed", [v(-0.9, -0.15), v(-0.05, -0.15), v(-0.05, 6.35), v(-0.9, 6.35)], undefined, { weight: 0.18 });
  b.note("ARQ", "text", [v(-3.0, 3.4)], "CUBIERTA PARQUEADERO", { align: "center", bold: true }, 1.8);
  b.note("ARQ", "text", [v(-3.0, 2.9)], "LÁMINA TERMOACÚSTICA · PEND. 5 % → W", { align: "center" }, 1.6);
  for (let x = -5.6; x < -1.0; x += 1.1) b.note("ARQ", "line", [v(x, -0.15), v(x, 6.35)], undefined, { weight: 0.13 });
  for (const at of [v(10.0, 14.45), v(9.4, 4.55), v(4.95, 2.85), v(0.42, 6.55), v(1.8, 0.4)]) b.device("SAN", "ventilacion", at, 4.4, { ocultar_rotulo: true }, { name: "Remate de ventilación con sombrerete" });
  b.run_("SAN", "CANAL", [v(12.75, -0.8), v(12.75, 15.8)], { tramo: "Canal oriental 0.20 × 0.15 m, pendiente 0.5 %", area_m2: 229, diametro: "Canal 0.20 × 0.15", capacidad_l_s: 27 }, "CANAL 0.20 × 0.15 m · S = 0.5 %");
  for (const [tag, at] of [["B-1", v(12.75, 0.5)], ["B-2", v(12.75, 7.5)], ["B-3", v(12.75, 14.5)]] as const) {
    b.device("SAN", "bajante", at, 3.0, { ocultar_rotulo: true }, { name: `Bajante ${tag} Ø4"`, tag });
    b.run_("SAN", "ALL", [at, v(at.x + 0.01, at.y)], { tramo: `Bajante ${tag} Ø4"`, area_m2: 76.3, diametro: "PVC 4\"", capacidad_l_s: 9, ocultar_rotulo: true });
  }
  // Generador fotovoltaico: 2 cadenas de 7 módulos, retrato, lado largo en la pendiente
  const PW = 2.278;
  const PH = 1.134;
  for (let col = 0; col < 2; col++) {
    for (let row = 0; row < 7; row++) {
      const cx = 1.0 + PW / 2 + col * (PW + 0.1);
      const cy = 6.0 + PH / 2 + row * (PH + 0.02);
      b.device("SOL", "panel", v(cx, cy), 4.4, { wp: 580, string: `S${col + 1}`, largo_m: PW, ancho_m: PH, ocultar_rotulo: true }, { tag: `S${col + 1}-${row + 1}` });
    }
  }
  b.run_("SOL", "DC", [v(2.139, 6.0), v(2.139, 5.6), v(2.4, 5.6), v(2.4, 2.54)], {}, "S1 · 2×6 mm² PV + T");
  b.run_("SOL", "DC", [v(4.517, 6.0), v(4.517, 5.4), v(2.55, 5.4), v(2.55, 2.54)], {}, "S2 · 2×6 mm² PV + T");
  b.note("SOL", "text", [v(2.47, 2.2)], "BAJA A CUARTO TÉCNICO (CC-DC)", { align: "center" }, 1.6);
  b.note("SOL", "text", [v(3.4, 14.55)], "GENERADOR FV 14 × 580 Wp = 8.12 kWp · ESTRUCTURA COPLANAR EN ALUMINIO", { align: "center", bold: true }, 1.8);
  b.levelId = level;

  // ─── PLANOS (hojas A1) ───────────────────────────────────────
  const VP = { x: 30, y: 15, w: 616, h: 564 };
  const col = { x: 657, w: 168 };
  const notes = NOTES;
  type Blk = { type: string; x: number; y: number; w: number; h: number; title?: string; lines?: readonly string[] };
  const sheet = (order: number, number: string, title: string, levelId: Id, disciplines: string[], background: string[], blocks: Blk[], center: Vec2 = v(4.6, 7.4), fields: Record<string, string> = {}) =>
    b.sheet({ order, number, title, levelId, disciplines: disciplines as never, background: background as never, paper: "A1", scale: 50, viewCenter: center, viewport: VP, blocks, fields });
  sheet(1, "A-01", "Planta arquitectónica amoblada", level, ["ARQ", "EST"], [], [
    { type: "cuadro-areas", x: col.x, y: 330, w: col.w, h: 215 },
    { type: "notas", x: col.x, y: 112, w: col.w, h: 214, lines: notes.ARQ },
  ]);
  sheet(2, "A-02", "Planta de cubierta", roof, ["ARQ", "SAN", "SOL"], [], [
    { type: "convenciones", x: col.x, y: 380, w: col.w, h: 165 },
    { type: "notas", x: col.x, y: 112, w: col.w, h: 262, lines: notes.CUB },
  ]);
  sheet(3, "A-03", "Fachadas", level, [], [], [
    { type: "fachadas", x: 34, y: 20, w: 610, h: 555 },
    { type: "notas", x: col.x, y: 112, w: col.w, h: 430, lines: notes.FACH },
  ], v(1000, 1000), { escala: "1:75" });
  sheet(4, "E-01", "Instalaciones eléctricas: tomas, fuerza y cargadores EV", level, ["ELE", "SOL"], ["ARQ", "EST"], [
    { type: "convenciones", x: col.x, y: 345, w: col.w, h: 200 },
    { type: "notas", x: col.x, y: 112, w: col.w, h: 228, lines: notes.ELE },
  ]);
  sheet(5, "E-02", "Instalaciones eléctricas: iluminación", level, ["ILU"], ["ARQ", "EST"], [
    { type: "convenciones", x: col.x, y: 440, w: col.w, h: 105 },
    { type: "cuadro-iluminacion", x: col.x, y: 275, w: col.w, h: 160 },
    { type: "notas", x: col.x, y: 112, w: col.w, h: 158, lines: notes.ILU },
  ]);
  sheet(6, "E-03", "Diagrama unifilar, cuadros de cargas y acometida", level, [], [], [
    { type: "unifilar", x: 34, y: 20, w: 260, h: 555 },
    { type: "cuadro-cargas-TG", x: 300, y: 300, w: 345, h: 275 },
    { type: "cuadro-cargas-TR", x: 300, y: 160, w: 345, h: 135 },
    { type: "cuadro-acometida", x: 300, y: 20, w: 345, h: 135 },
    { type: "notas", x: col.x, y: 112, w: col.w, h: 430, lines: notes.UNI },
  ], v(1000, 1000), { escala: "Sin escala" });
  sheet(7, "D-01", "Domótica, seguridad y comunicaciones", level, ["DOM"], ["ARQ", "EST"], [
    { type: "convenciones", x: col.x, y: 300, w: col.w, h: 245 },
    { type: "notas", x: col.x, y: 112, w: col.w, h: 183, lines: notes.DOM },
  ]);
  sheet(8, "H-01", "Instalaciones hidráulicas: agua fría y caliente", level, ["HID"], ["ARQ", "EST"], [
    { type: "convenciones", x: col.x, y: 425, w: col.w, h: 120 },
    { type: "cuadro-hidraulico", x: col.x, y: 260, w: col.w, h: 160 },
    { type: "notas", x: col.x, y: 112, w: col.w, h: 143, lines: notes.HID },
  ]);
  sheet(9, "S-01", "Instalaciones sanitarias y aguas lluvias", level, ["SAN"], ["ARQ", "EST"], [
    { type: "convenciones", x: col.x, y: 445, w: col.w, h: 100 },
    { type: "cuadro-sanitario", x: col.x, y: 300, w: col.w, h: 140 },
    { type: "cuadro-lluvias", x: col.x, y: 235, w: col.w, h: 60 },
    { type: "notas", x: col.x, y: 112, w: col.w, h: 118, lines: notes.SAN },
  ]);
  sheet(10, "G-01", "Instalaciones de gas", level, ["GAS"], ["ARQ", "EST"], [
    { type: "convenciones", x: col.x, y: 460, w: col.w, h: 85 },
    { type: "cuadro-gas", x: col.x, y: 330, w: col.w, h: 125 },
    { type: "notas", x: col.x, y: 112, w: col.w, h: 213, lines: notes.GAS },
  ]);
  sheet(11, "FV-01", "Sistema solar fotovoltaico", roof, ["SOL"], ["ARQ"], [
    { type: "convenciones", x: col.x, y: 470, w: col.w, h: 75 },
    { type: "cuadro-solar", x: col.x, y: 385, w: col.w, h: 80 },
    { type: "notas", x: col.x, y: 112, w: col.w, h: 268, lines: notes.SOL },
  ]);

  return b.snapshot();
}

const NOTES: Record<string, string[]> = {
  ARQ: [
    "Casa de un piso de 180 m² construidos (12.00 × 15.00 m a caras exteriores). Área útil interior según cuadro.",
    "Cotas en metros. Cotas exteriores a ejes estructurales y a caras de fachada; cotas interiores a caras terminadas.",
    "Estructura en acero: columnas HSS 150×150×6 mm, vigas IPE 220 inclinadas en la dirección oriente-occidente y correas C 160×60×2 mm. Diseño y memorias estructurales NSR-10 por ingeniero estructural (predimensionamiento indicativo).",
    "Fachadas en steel frame con aislamiento de lana mineral, placa de fibrocemento y acabado EIFS. Divisiones en drywall de 120 mm; zonas húmedas con placa RH.",
    "Acabados de piso: zona social en porcelanato rectificado 120×60 mate; habitaciones y vestieres en madera de ingeniería de roble; baños en porcelanato 60×120 con piso de ducha antideslizante (R11); servicios en porcelanato 60×60 antideslizante.",
    "Ventanería en aluminio arquitectónico negro mate y vidrio laminado 6+6 mm con control solar (NSR-10 Título K, vidrio de seguridad en piso-techo).",
    "Cielo raso: en la zona social sigue la pendiente de la cubierta (de 3.90 m a 3.40 m libres); en la zona privada cielo plano en drywall a 2.80 m.",
    "Parqueadero cubierto para dos vehículos con un cargador EV por puesto (ver E-01).",
    "Mejora propuesta: vestier de la habitación 2 y galería de circulación abierta a la cocina, sin pasillos cerrados.",
    "Verificar el levantamiento topográfico del Lote 01, retiros y norma de la parcelación antes de implantar.",
  ],
  CUB: [
    "Cubierta a una sola agua con pendiente del 10 % hacia el oriente: borde alto N+4.45 en la fachada occidental y borde bajo N+3.05 en la oriental.",
    "Panel sándwich termoacústico e = 50 mm (lámina prepintada + poliuretano) sobre correas metálicas; tornillería autoperforante con arandela EPDM.",
    "Aleros de 0.90 m en oriente y occidente y 0.80 m en norte y sur, con flanches y goteros en lámina galvanizada calibre 22.",
    "Canal oriental en lámina galvanizada 0.20 × 0.15 m con pendiente 0.5 % hacia tres bajantes de 4\" (B-1, B-2, B-3).",
    "Generador fotovoltaico de 14 módulos sobre estructura coplanar en aluminio anclada a las correas (ver FV-01). Se deja zona de mantenimiento de 0.60 m.",
    "Claraboyas en policarbonato alveolar sobre el baño social y el baño 2, con extracción mecánica.",
    "Los remates de ventilación sanitaria sobresalen 0.30 m del panel con sombrerete y babero.",
  ],
  FACH: [
    "Fachadas generadas automáticamente desde el modelo: al mover una ventana en planta, la fachada se actualiza.",
    "Escala 1:75. Alturas sobre el NPT ±0.00 de la planta.",
    "Vanos en vidrio con perfilería negra mate; muros con acabado EIFS color arena claro y detalles en madera teca en el acceso.",
    "La cubierta a una agua genera el frente alto hacia el occidente (zona social, ventanales piso-techo) y el frente bajo hacia el oriente (habitaciones).",
    "Cortes y detalles constructivos: se desarrollan en la etapa de detalle a partir de este mismo modelo.",
  ],
  ELE: [
    "Diseño según RETIE (Res. 40117 de 2024) y NTC 2050. Sistema monofásico trifilar 120/240 V.",
    "Tomas generales a 0.30 m, tomas de mesón a 1.10 m, salidas especiales a la altura indicada en cada equipo.",
    "Conductores de cobre THHN/THWN-2 a 90 °C (capacidad a 75 °C). Calibre mínimo #12 para tomas y #14 para alumbrado.",
    "Protección GFCI en cocina, baños, ropas y exteriores. Protección contra sobretensiones DPS tipo 2 en TG y tipo 1 en el medidor.",
    "Cargadores EV nivel 2 de 7.7 kW (32 A) con gestión dinámica de carga: entre ambos no superan 40 A, lo que evita sobredimensionar la acometida.",
    "Las cargas críticas (alumbrado, nevera, equipo de presión, domótica y calentador) están en el tablero de respaldo TR alimentado por el inversor híbrido.",
    "Canalización en PVC conduit embebida o en cielo; en exteriores tubería enterrada a 0.60 m con cinta de señalización.",
    "Los recorridos dibujados son esquemáticos (trazado de tubería); su longitud alimenta el cálculo de caída de tensión (cuadro en E-03).",
  ],
  ILU: [
    "Diseño según RETILAP. Iluminancias calculadas por el método de los lúmenes con los objetivos del cuadro.",
    "Luminarias LED de 3000 K e IRC ≥ 90; downlights antideslumbrantes UGR < 19. Baños y exteriores con grado IP44 / IP65.",
    "Todo el alumbrado es regulable (DALI-2 / KNX) y se controla por escenas desde la domótica (ver D-01).",
    "Sensores de presencia en baños, vestieres, galería, ropas y cuarto técnico.",
    "Alumbrado exterior con apliques IP65 y balizas de jardín; encendido por reloj astronómico.",
  ],
  UNI: [
    "Diagrama y cuadros generados automáticamente desde los circuitos y las salidas del modelo.",
    "La carga de cada circuito es la suma de sus salidas: tomas generales a 180 VA (NTC 2050 Art. 220-3) y equipos con su potencia de placa.",
    "Protecciones verificadas: corriente de diseño (125 % en cargas continuas) ≤ protección ≤ capacidad del conductor.",
    "Caída de tensión de cada circuito ≤ 3 % por el método de momentos eléctricos (cada salida a su distancia real sobre el recorrido + 2.50 m de bajante); alimentador ≤ 2 %.",
    "Acometida dimensionada por el método estándar de NTC 2050 Sec. 220 con la gestión de carga EV a 40 A.",
    "El operador de red y el certificador RETIE deben aprobar la conexión como autogenerador a pequeña escala (CREG 174 de 2021).",
    "Puesta a tierra única; medir resistencia antes de energizar (≤ 25 Ω).",
  ],
  DOM: [
    "Sistema domótico cableado KNX (estándar abierto ISO/IEC 14543) con controlador IP en el rack del cuarto técnico.",
    "Teclados KNX con escenas en cada acceso: Llegada, Salida, Cine, Noche y Todo apagado.",
    "Iluminación regulable, cortinas motorizadas, clima (sensores T/HR) y chimenea integrados en la misma interfaz.",
    "Seguridad: cámaras IP PoE con grabador NVR, contactos magnéticos en puertas exteriores, videoportero IP y cerradura inteligente.",
    "Protección técnica: sensores de inundación que cierran la electroválvula general de agua y detectores de gas que cierran la electroválvula de gas.",
    "Gestión de energía: monitoreo del inversor y del consumo; reparto dinámico de carga entre los dos cargadores EV por OCPP.",
    "Cableado estructurado Cat 6A y WiFi con puntos de acceso PoE en techo. Canalización independiente de la de potencia.",
  ],
  HID: [
    "Diseño según NTC 1500. Caudales probables por el método de Hunter con las unidades de consumo de cada aparato.",
    "Suministro desde la red de la parcelación a tanque de reserva de 2 000 L (1 día de consumo para 6 personas) y equipo de presión de 1 HP con tanque hidroacumulador.",
    "Distribución interior en tubería multicapa PEX-AL-PEX con accesorios de compresión/press-fit por cielo raso y bajadas en muro.",
    "Agua caliente con calentador de paso a gas de 20 L/min y recirculación con bomba temporizada: agua caliente inmediata en los baños.",
    "Tubería de agua caliente y retorno aislada con cañuela de espuma elastomérica de 9 mm.",
    "Presión mínima de servicio 10 m.c.a. en el aparato más desfavorable; velocidad máxima 2.0 m/s.",
    "Prueba hidrostática a 150 psi durante 2 h antes de cerrar muros.",
  ],
  SAN: [
    "Diseño según NTC 1500. Tubería PVC sanitaria; pendiente mínima de 2 % en colectores.",
    "Cajas de inspección en concreto con tapa, en cada cambio de dirección y cada 10 m como máximo.",
    "La cocina descarga a una trampa de grasas antes del colector.",
    "Ventilación de cada grupo sanitario con tubería de 2\" hasta la cubierta.",
    "Si la parcelación cuenta con alcantarillado, la caja CI-3 se conecta a la red y se omite el sistema séptico; de lo contrario se instala el sistema séptico integrado con FAFA y campo de infiltración (Res. 0330 de 2017), previo ensayo de percolación.",
    "Aguas lluvias: canal oriental, 3 bajantes de 4\" y colector de 6\"; parte del caudal llega a un tanque de 2 m³ para riego.",
  ],
  GAS: [
    "Diseño según NTC 2505, NTC 3631 (ventilación) y la normativa del distribuidor. Gas natural en baja presión, 20 mbar en el regulador.",
    "Si no hay red de gas natural en el sector, se convierte a GLP con tanque estacionario: recalcular los diámetros.",
    "Tubería enterrada en polietileno PE 100 a 0.60 m con cinta de señalización; tubería interior en PE-AL-PE por cielo raso.",
    "El tramo hacia la cubierta de cocción de la isla va bajo piso dentro de camisa de PVC con registro en ambos extremos.",
    "Válvula de corte de 1/4 de vuelta en cada artefacto. Electroválvula general comandada por los detectores de gas.",
    "Calentador tipo exterior y chimenea de cámara estanca con ducto coaxial: no consumen aire del interior.",
    "Prueba de hermeticidad a 1.5 veces la presión de operación y certificación por organismo acreditado antes del servicio.",
  ],
  SOL: [
    "Autogeneración a pequeña escala (AGPE) según CREG 174 de 2021, RETIE y NTC 2050 Sec. 690.",
    "Generador de 8.12 kWp: 14 módulos bifaciales de 580 Wp en 2 cadenas de 7 módulos, una por MPPT.",
    "Inversor híbrido de 8 kW, 120/240 V, con baterías LiFePO4 de 10.24 kWh para respaldo de las cargas críticas (tablero TR).",
    "Protección DC: fusibles de 20 A por cadena, DPS DC tipo 2 de 600 V y seccionador bajo carga en la caja combinadora.",
    "Cable fotovoltaico de 6 mm² doble aislamiento en tubería EMT; caída de tensión DC ≤ 1.5 %.",
    "Estructura coplanar en aluminio anodizado con tornillería inoxidable, anclada a las correas de la cubierta.",
    "Medidor bidireccional para entregar excedentes a la red y monitoreo de producción integrado a la domótica.",
  ],
};
