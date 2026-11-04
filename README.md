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
  app/        Aplicación web: planta 2D en canvas con herramientas de dibujo
docs/         Documentos de diseño de los Pasos 1 a 4
```

Dependencias entre paquetes: `app → spatial → geometry → core`. `core` no depende de nada.

## Uso

Requiere Node.js 20 o superior.

```bash
npm install
npm run dev        # abre la aplicación en http://localhost:5173
npm test           # tests de core, geometry y spatial
npm run typecheck  # comprobación de tipos de todo el monorepo
npm run build      # build de producción de la app en packages/app/dist
```

## Atajos de la aplicación

| Tecla | Acción |
|---|---|
| `M` | Muro: clic para empezar, clic para terminar; encadena muros. `Mayús` = ortogonal |
| `P` | Puerta: pasa sobre un muro y haz clic. El lado del cursor decide hacia dónde abre. `F` cambia la bisagra |
| `N` | Ventana |
| `V` | Seleccionar. Arrastra un muro para moverlo; arrastra en vacío para seleccionar por rectángulo |
| `Supr` | Borrar la selección (en cascada: muro → huecos → puertas y ventanas) |
| `Ctrl+Z` / `Ctrl+Y` | Deshacer / rehacer |
| `Esc` | Cancelar lo que esté a medias |
| Rueda, botón central o `Espacio`+arrastrar | Zoom y desplazamiento |

**Guardar JSON** descarga el modelo (solo entidades y relaciones; la geometría siempre se recalcula).

## Pendiente (próximos pasos)

- Al mover un muro, estirar los muros unidos a él (hoy la unión se rompe si dejan de tocarse)
- Uniones con más de dos muros en el mismo punto y prioridad de capas en las esquinas

- Representación 3D (Body) y vista 3D
- Mover el BimStore y el motor de geometría a un Web Worker
- Varios niveles, tipos de muro (WallType), panel de propiedades editable
