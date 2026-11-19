# ARKEN

Software de diseño arquitectónico BIM, construido desde cero y paso a paso.

Principios:

1. **Única Fuente de Verdad.** El núcleo es un grafo de objetos BIM (entidades + relaciones). Las vistas 2D y 3D solo leen y reaccionan a los cambios.
2. **Modelo inspirado en IFC.** Muros, huecos, puertas, ventanas, niveles y materiales con dimensiones reales en metros.
3. **Rendimiento.** La lógica está separada del render, la geometría es derivada y la selección usa un R-Tree.

## Estructura

```
packages/
  core/       Modelo de datos (Paso 1) y BimStore: comandos, transacciones, invariantes,
              índices inversos, eventos, deshacer/rehacer (Paso 2)
  geometry/   Motor de geometría de planta: marco local del muro, capas, uniones en L
              (inglete) y T (tope), huecos con plano de corte, símbolos de puerta y
              ventana, cajas envolventes (Paso 3)
  spatial/    R-Tree por nivel, clic en dos fases, selección por rectángulo, snapping (Paso 4)
  calc/       Cálculos de ingeniería: cuadros de cargas, caída de tensión, acometida (NTC 2050),
              iluminación (RETILAP), Hunter (NTC 1500), sanitaria, lluvias, gas (Renouard), solar
  sheets/     Planos: rótulo editable, cuadros, unifilar, fachadas, convenciones y notas
  projects/   ProjectBuilder, proyectos completos (Casa Lote 01 · Bosque de Agua) y el generador
              de proyectos por especificaciones
  terrain/    Topografía: lectura del levantamiento (DXF, PNEZD), TIN de Delaunay, curvas de nivel,
              implantación y movimiento de tierras
  app/        Aplicación web ARKEN DISEÑO: planos y modelo, edición, rótulos, exportación
proyectos/    Modelos guardados (.arken.json) que se abren con el botón Abrir
docs/         Documentos de diseño de los Pasos 1 a 4
```

Dependencias entre paquetes: `app → projects → sheets → calc → geometry → core`, `app → spatial` y `app → terrain`. `core` no depende de nada.

## Proyecto Casa Lote 01 · Bosque de Agua

Casa de un piso de 180 m² (12 × 15 m) con 11 planos A1: arquitectura (A-01 a A-03), eléctrica, iluminación y
unifilar (E-01 a E-03), domótica (D-01), hidráulica (H-01), sanitaria y lluvias (S-01), gas (G-01) y solar (FV-01).
Se construye en `packages/projects/src/lote01.ts`; la app lo abre al iniciar y con el botón **Proyecto Lote 01**.
Los cuadros de cálculo se recalculan al editar el modelo.

## Uso

Requiere Node.js 20 o superior.

```bash
npm install
npm run dev        # abre la aplicación en http://localhost:5173
npm test           # tests de core, geometry y spatial
npm run typecheck  # comprobación de tipos de todo el monorepo
npm run build      # build de producción de la app en packages/app/dist
npm run build:single  # además empaqueta la app en un solo archivo: packages/app/dist/arken-diseno.html
```

## Atajos de la aplicación

| Tecla | Acción |
|---|---|
| `M` | Muro: clic para empezar, clic para terminar; encadena muros. `Mayús` = ortogonal |
| `P` | Puerta: pasa sobre un muro y haz clic. El lado del cursor decide hacia dónde abre. `F` cambia la bisagra |
| `N` | Ventana |
| `E` | Equipo o salida de red (elige el símbolo; `R` lo gira) |
| `R` | Recorrido de tubería o canalización: clic por vértice, doble clic o `Intro` termina |
| `T` / `C` | Texto / cota |
| `V` | Seleccionar. Arrastra un muro para moverlo; arrastra en vacío para seleccionar por rectángulo |
| `Supr` | Borrar la selección (en cascada: muro → huecos → puertas y ventanas) |
| `Ctrl+Z` / `Ctrl+Y` | Deshacer / rehacer |
| `Esc` | Cancelar lo que esté a medias |
| Rueda, botón central o `Espacio`+arrastrar | Zoom y desplazamiento |

**Guardar** descarga el modelo (solo entidades y relaciones; la geometría siempre se recalcula) y **Abrir** lo carga.
Sin nada seleccionado, el panel derecho edita el rótulo del proyecto y los campos del plano activo, el tamaño
del rótulo (80 % a 160 %: casillas, textos y logo crecen juntos) y el logo (ARKEN DISEÑO, uno propio o ninguno).

- **Nuevo proyecto**: formulario de especificaciones (rótulo, medidas de la casa, cubierta y parámetros de redes).
  Ajusta el diseño aprobado del Lote 01 a esas medidas, redimensiona luminarias y calibres y genera los 11 planos.
- **Guardar planos**: un .zip con cada plano en PDF vectorial y DXF, el juego completo en un PDF, el modelo en
  metros para AutoCAD, las memorias de cálculo y el modelo BIM. Cada archivo se llama
  `ARKEN DISENO-TIPO DE PLANO-AAAA-MM-DD-NOMBRE DEL PROYECTO`.
- **Memorias**: reporte de cálculo de cada diseño (normas, método, fórmulas, cálculo tipo, cuadros y resumen).
- **Topografía**: carga el levantamiento del topógrafo (DXF o PNEZD), muestra el terreno en 3D, ubica la casa
  (posición, giro y NPT), calcula corte y lleno y genera el plano T-01 de implantación.
- Plano activo: PDF, PNG (≈200 ppp), SVG y DXF (mm de papel, capas por disciplina).

## Pendiente (próximos pasos)

- Al mover un muro, estirar los muros unidos a él (hoy la unión se rompe si dejan de tocarse)
- Uniones con más de dos muros en el mismo punto y prioridad de capas en las esquinas

- Representación 3D (Body) del edificio completo
- Mover el BimStore y el motor de geometría a un Web Worker
- Varios niveles, tipos de muro (WallType), panel de propiedades editable
