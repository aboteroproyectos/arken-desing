// Modelo inicial mínimo para empezar a dibujar: proyecto, edificio, planta baja,
// tres materiales y dos recetas de capas.

import type { BimModel, Entity, Id, Relation } from "./model";
import { newId } from "./store";

export interface StarterIds {
  projectId: Id;
  buildingId: Id;
  levelId: Id;
  layerSets: { tabique15: Id; exterior25: Id };
}

export function createStarterModel(): { model: BimModel; ids: StarterIds } {
  const projectId = newId();
  const buildingId = newId();
  const levelId = newId();
  const yeso = newId();
  const ladrillo = newId();
  const aislante = newId();
  const tabique15 = newId();
  const exterior25 = newId();

  const entities: Entity[] = [
    { id: projectId, kind: "Project", name: "Proyecto nuevo", lengthUnit: "m" },
    { id: buildingId, kind: "Building", name: "Edificio" },
    { id: levelId, kind: "Level", name: "Planta Baja", elevation: 0, height: 2.8 },
    { id: yeso, kind: "Material", name: "Yeso", density: 1000, displayColor: "#ece7dc" },
    { id: ladrillo, kind: "Material", name: "Ladrillo", density: 1800, displayColor: "#c9774f" },
    { id: aislante, kind: "Material", name: "Aislante", density: 40, thermalConductivity: 0.035, displayColor: "#e8d36a" },
    {
      id: tabique15,
      kind: "MaterialLayerSet",
      name: "Tabique 15",
      layers: [
        { materialId: yeso, thickness: 0.015 },
        { materialId: ladrillo, thickness: 0.12 },
        { materialId: yeso, thickness: 0.015 },
      ],
    },
    {
      id: exterior25,
      kind: "MaterialLayerSet",
      name: "Muro exterior 25",
      layers: [
        { materialId: ladrillo, thickness: 0.12 },
        { materialId: aislante, thickness: 0.05 },
        { materialId: ladrillo, thickness: 0.065 },
        { materialId: yeso, thickness: 0.015 },
      ],
    },
  ];
  const relations: Relation[] = [
    { id: newId(), kind: "RelAggregates", parentId: projectId, childIds: [buildingId] },
    { id: newId(), kind: "RelAggregates", parentId: buildingId, childIds: [levelId] },
  ];

  return {
    model: {
      schemaVersion: 1,
      entities: Object.fromEntries(entities.map((e) => [e.id, e])),
      relations: Object.fromEntries(relations.map((r) => [r.id, r])),
    },
    ids: { projectId, buildingId, levelId, layerSets: { tabique15, exterior25 } },
  };
}
