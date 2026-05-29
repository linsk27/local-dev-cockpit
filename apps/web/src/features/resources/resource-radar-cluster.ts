import type * as Three from "three";
import type { RadarItem } from "../../api";
import { clamp, colorForResource, nodePosition } from "./resource-radar-model";
import type { RadarCluster } from "./resource-radar-model";
import {
  createClusterLabelTexture,
  createResourceCardTexture,
  type RadarTokens
} from "./resource-radar-textures";

export type BuildRadarClusterOptions = {
  category: RadarCluster;
  categoryIndex: number;
  center: Three.Vector3;
  cloudObjects: Three.Object3D[];
  cloudTexture: Three.CanvasTexture;
  clusterGroups: Array<Three.Group & { userData: ClusterGroupData }>;
  glowTexture: Three.CanvasTexture;
  nodeById: Map<string, Three.Sprite>;
  nodeObjects: Three.Sprite[];
  orbitObjects: Three.Object3D[];
  rootGroup: Three.Group;
  three: typeof import("./resource-radar-three");
  tokens: RadarTokens;
};

type ClusterGroupData = {
  baseX: number;
  baseY: number;
  baseZ: number;
  category: string;
  phase: number;
};

export function buildRadarCluster(options: BuildRadarClusterOptions): void {
  const { category, categoryIndex, center, cloudObjects, cloudTexture, clusterGroups, glowTexture, nodeById, nodeObjects, orbitObjects, rootGroup, three, tokens } =
    options;
  const clusterSize = Math.min(9, Math.max(2, category.items.length));
  const clusterGroup = new three.Group() as Three.Group & { userData: ClusterGroupData };
  clusterGroup.position.copy(center);
  clusterGroup.userData = {
    baseX: center.x,
    baseY: center.y,
    baseZ: center.z,
    category: category.category,
    phase: categoryIndex * 1.31
  };
  clusterGroups.push(clusterGroup);
  rootGroup.add(clusterGroup);

  const localCenter = new three.Vector3(0, 0, 0);
  addClusterCore(options, clusterGroup, localCenter, clusterSize);
  addClusterLabel(options, clusterGroup);
  addClusterOrbits(options, clusterGroup, localCenter);
  addResourceNodes(options, clusterGroup, localCenter);
}

function addClusterCore(
  options: BuildRadarClusterOptions,
  clusterGroup: Three.Group,
  localCenter: Three.Vector3,
  clusterSize: number
): void {
  const { category, categoryIndex, cloudObjects, cloudTexture, glowTexture, three } = options;
  const cloud = new three.Sprite(
    new three.SpriteMaterial({
      map: cloudTexture,
      color: category.color,
      transparent: true,
      opacity: 0.34,
      blending: three.AdditiveBlending,
      depthWrite: false
    })
  );
  cloud.position.copy(localCenter);
  cloud.scale.setScalar(3.1 + clusterSize * 0.16);
  cloud.userData.baseScale = cloud.scale.x;
  cloud.userData.phase = categoryIndex * 1.3;
  cloudObjects.push(cloud);
  clusterGroup.add(cloud);

  const core = new three.Sprite(
    new three.SpriteMaterial({
      map: glowTexture,
      color: category.color,
      transparent: true,
      opacity: 0.72,
      blending: three.AdditiveBlending,
      depthWrite: false
    })
  );
  core.position.copy(localCenter);
  core.scale.setScalar(0.52 + clusterSize * 0.035);
  core.userData.baseScale = core.scale.x;
  core.userData.phase = categoryIndex * 1.3 + 0.6;
  cloudObjects.push(core);
  clusterGroup.add(core);
}

function addClusterLabel(options: BuildRadarClusterOptions, clusterGroup: Three.Group): void {
  const { category, three, tokens } = options;
  const labelTexture = createClusterLabelTexture(three, category.category, category.items.length, category.color, tokens);
  const label = new three.Sprite(new three.SpriteMaterial({ map: labelTexture, transparent: true, opacity: 0.96, depthWrite: false }));
  label.position.set(0, 1.55 + Math.min(category.items.length, 8) * 0.04, 0.18);
  label.scale.set(2.35, 0.48, 1);
  clusterGroup.add(label);
}

function addClusterOrbits(options: BuildRadarClusterOptions, clusterGroup: Three.Group, localCenter: Three.Vector3): void {
  const { category, categoryIndex, orbitObjects, three } = options;
  const orbitMaterial = new three.MeshBasicMaterial({
    color: category.color,
    transparent: true,
    opacity: 0.12,
    depthWrite: false
  });
  for (let index = 0; index < 3; index += 1) {
    const orbit = new three.Mesh(new three.TorusGeometry(1.5 + index * 0.42, 0.004, 8, 96), orbitMaterial.clone());
    orbit.position.copy(localCenter);
    orbit.rotation.x = Math.PI / (2.25 + index * 0.28);
    orbit.rotation.y = categoryIndex * 0.42 + index * 0.55;
    orbit.rotation.z = categoryIndex * 0.6;
    orbit.userData.speed = 0.0018 + index * 0.0008 + categoryIndex * 0.00025;
    orbitObjects.push(orbit);
    clusterGroup.add(orbit);
  }
}

function addResourceNodes(options: BuildRadarClusterOptions, clusterGroup: Three.Group, localCenter: Three.Vector3): void {
  const { category, categoryIndex, glowTexture, nodeById, nodeObjects, three, tokens } = options;
  const lineMaterial = new three.LineBasicMaterial({
    color: category.color,
    transparent: true,
    opacity: 0.24
  });

  category.items.forEach((item, itemIndex) => {
    const position = nodePosition(three, localCenter, itemIndex, category.items.length);
    const card = createResourceCardSprite(options, item, position, categoryIndex, itemIndex);
    nodeObjects.push(card);
    nodeById.set(item.id, card);
    clusterGroup.add(card);

    const anchor = createAnchorSprite(three, item, category.color, glowTexture, tokens);
    anchor.position.set(position.x - card.userData.baseWidth * 0.52, position.y + 0.02, position.z + 0.02);
    clusterGroup.add(anchor);

    const geometry = new three.BufferGeometry().setFromPoints([localCenter, position]);
    clusterGroup.add(new three.Line(geometry, lineMaterial.clone()));
  });
}

function createResourceCardSprite(
  options: BuildRadarClusterOptions,
  item: RadarItem,
  position: Three.Vector3,
  categoryIndex: number,
  itemIndex: number
): Three.Sprite {
  const { category, three, tokens } = options;
  const texture = createResourceCardTexture(three, item, category.color, tokens);
  const card = new three.Sprite(
    new three.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    })
  );
  const width = clamp(3.05 + [...item.title].length * 0.025, 3.05, 4.35);
  card.position.copy(position);
  card.scale.set(width, 0.92, 1);
  card.userData.resourceId = item.id;
  card.userData.baseWidth = width;
  card.userData.baseHeight = 0.92;
  card.userData.baseY = position.y;
  card.userData.phase = categoryIndex * 1.75 + itemIndex * 0.83;
  return card;
}

function createAnchorSprite(
  three: typeof import("./resource-radar-three"),
  item: RadarItem,
  color: string,
  glowTexture: Three.CanvasTexture,
  tokens: RadarTokens
): Three.Sprite {
  const anchor = new three.Sprite(
    new three.SpriteMaterial({
      map: glowTexture,
      color: colorForResource(item, { accent: color, success: tokens.success, warn: tokens.warn, danger: tokens.danger, muted: tokens.muted }),
      transparent: true,
      opacity: 0.55,
      blending: three.AdditiveBlending,
      depthWrite: false
    })
  );
  anchor.scale.setScalar(0.5);
  return anchor;
}
