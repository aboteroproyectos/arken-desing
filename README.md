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
  projects/   ProjectBuilder y proyectos completos (Casa Lote 01 · Bosque de Agua)
  app/        Aplicación web ARKEN DISEÑO: planos y modelo, edición, rótulos, exportación
proyectos/    Modelos guardados (.arken.json) que se abren con el botón Abrir
docs/         Documentos de diseño de los Pasos 1 a 4
```

Dependencias entre paquetes: `app → projects → sheets → calc → geometry → core` y `app → spatial`. `core` no depende de nada.

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
Sin nada seleccionado, el panel derecho edita el rótulo del proyecto y los campos del plano activo.
Los planos se exportan en PDF (impresión a tamaño real), PNG (≈200 ppp), SVG y DXF R12.

## Pendiente (próximos pasos)

- Al mover un muro, estirar los muros unidos a él (hoy la unión se rompe si dejan de tocarse)
- Uniones con más de dos muros en el mismo punto y prioridad de capas en las esquinas

- Representación 3D (Body) y vista 3D
- Mover el BimStore y el motor de geometría a un Web Worker
- Varios niveles, tipos de muro (WallType), panel de propiedades editable
