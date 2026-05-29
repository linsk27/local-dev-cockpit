import type * as Three from "three";
import { clamp } from "./resource-radar-model";

export type FocusScratch = {
  position?: Three.Vector3;
  scale?: Three.Vector3;
};

export type RadarAnimationState = {
  cloudObjects: Three.Object3D[];
  clusterGroups: Array<Three.Group & { userData: { baseX: number; baseY: number; baseZ: number; category: string; phase: number } }>;
  focusedCategory?: string;
  focusScratch: FocusScratch;
  isDragging: boolean;
  nodeObjects: Three.Sprite[];
  orbitObjects: Three.Object3D[];
  reducedMotion: boolean;
  rootGroup: Three.Group;
  three: typeof import("./resource-radar-three");
};

export function animateRadarScene(state: RadarAnimationState, seconds: number): void {
  const hasFocus = Boolean(state.focusedCategory);
  if (!state.isDragging) {
    state.rootGroup.rotation.y += hasFocus ? 0.0016 : 0.0072;
    if (!hasFocus) {
      state.rootGroup.rotation.x += Math.sin(seconds * 0.8) * 0.00075;
      state.rootGroup.rotation.x = clamp(state.rootGroup.rotation.x, -0.38, -0.08);
    }
  }

  for (const node of state.nodeObjects) {
    const baseY = typeof node.userData.baseY === "number" ? node.userData.baseY : node.position.y;
    const phase = typeof node.userData.phase === "number" ? node.userData.phase : 0;
    node.position.y = baseY + Math.sin(seconds * 2.1 + phase) * 0.12;
  }

  for (const cloud of state.cloudObjects) {
    const baseScale = typeof cloud.userData.baseScale === "number" ? cloud.userData.baseScale : cloud.scale.x;
    const phase = typeof cloud.userData.phase === "number" ? cloud.userData.phase : 0;
    cloud.scale.setScalar(baseScale * (1 + Math.sin(seconds * 1.15 + phase) * 0.085));
  }

  for (const orbit of state.orbitObjects) {
    const speed = typeof orbit.userData.speed === "number" ? orbit.userData.speed : 0.002;
    orbit.rotation.z += speed * 2.2;
  }

  for (const group of state.clusterGroups) {
    const phase = typeof group.userData.phase === "number" ? group.userData.phase : 0;
    const isFocused = group.userData.category === state.focusedCategory;
    group.rotation.y += hasFocus ? (isFocused ? 0.006 : 0.0018) : 0.0034;
    group.rotation.z = Math.sin(seconds * 0.52 + phase) * (isFocused ? 0.035 : 0.018);
  }
}

export function animateRadarFocus(state: RadarAnimationState, seconds: number): void {
  if (state.clusterGroups.length === 0) return;
  state.focusScratch.position ??= new state.three.Vector3();
  state.focusScratch.scale ??= new state.three.Vector3();
  const hasFocus = Boolean(state.focusedCategory);

  for (const group of state.clusterGroups) {
    const isFocused = group.userData.category === state.focusedCategory;
    let targetX = group.userData.baseX;
    let targetY = group.userData.baseY;
    let targetZ = group.userData.baseZ;
    let scale = 1;
    let opacity = 1;

    if (hasFocus && isFocused) {
      targetX = 0;
      targetY = 0.08;
      targetZ = 1.65;
      scale = 1.34;
    } else if (hasFocus) {
      targetX = group.userData.baseX * 0.34;
      targetY = group.userData.baseY * 0.28 - 0.16;
      targetZ = group.userData.baseZ - 5.8;
      scale = 0.5;
      opacity = 0.22;
    } else if (!state.reducedMotion) {
      targetY += Math.sin(seconds * 0.55 + group.userData.phase) * 0.09;
    }

    state.focusScratch.position.set(targetX, targetY, targetZ);
    state.focusScratch.scale.set(scale, scale, scale);
    group.position.lerp(state.focusScratch.position, hasFocus ? 0.12 : 0.055);
    group.scale.lerp(state.focusScratch.scale, hasFocus ? 0.12 : 0.055);
    setClusterOpacity(group, opacity);
  }
}

function setClusterOpacity(group: Three.Object3D, opacityFactor: number): void {
  group.traverse((object) => {
    const candidate = object as Three.Object3D & { material?: Three.Material | Three.Material[] };
    const material = candidate.material;
    if (Array.isArray(material)) material.forEach((entry) => setMaterialOpacity(entry, opacityFactor));
    else if (material) setMaterialOpacity(material, opacityFactor);
  });
}

function setMaterialOpacity(material: Three.Material, opacityFactor: number): void {
  material.userData.baseOpacity ??= material.opacity;
  material.transparent = true;
  material.opacity = Math.max(0.04, material.userData.baseOpacity * opacityFactor);
}
