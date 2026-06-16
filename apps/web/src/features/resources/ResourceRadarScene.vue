<template>
  <div class="resource-radar-scene">
    <div v-if="items.length === 0" class="resource-insight-empty">
      <strong>{{ preferences.locale === "zh-CN" ? "还没有资源节点。" : "No resource nodes yet." }}</strong>
      <span>{{ preferences.locale === "zh-CN" ? "先在顶部粘贴链接或文本。" : "Paste a link or text at the top first." }}</span>
    </div>
    <div v-else class="resource-radar-stage">
      <canvas
        ref="canvasRef"
        class="resource-radar-canvas"
        :class="{ 'is-dragging': isDragging }"
        aria-label="Resource Radar 3D graph"
      />
      <div
        class="resource-radar-toolbar"
        :title="preferences.locale === 'zh-CN' ? '拖拽旋转，滚轮缩放，点击资源卡' : 'Drag to rotate, scroll to zoom, click a resource card'"
      >
        <button type="button" @click="resetView">
          {{ preferences.locale === "zh-CN" ? "重置视角" : "Reset" }}
        </button>
      </div>
      <div class="resource-radar-legend" aria-label="Resource radar clusters">
        <button
          v-for="cluster in clusters"
          :key="cluster.category"
          class="resource-radar-cluster"
          :class="{ active: cluster.category === focusedCategory }"
          :style="{ '--cluster-color': cluster.color }"
          type="button"
          @click="selectCluster(cluster)"
        >
          <span />
          <strong :title="cluster.category">{{ cluster.category }}</strong>
          <small>{{ cluster.totalCount }}</small>
        </button>
      </div>
      <div v-if="densityMode !== 'full'" class="resource-radar-density">
        {{
          densityMode === "representative"
            ? preferences.locale === "zh-CN"
              ? "代表节点模式"
              : "Representative mode"
            : preferences.locale === "zh-CN"
              ? "分类聚合模式"
              : "Cluster summary mode"
        }}
      </div>
      <div v-if="hoverItem" class="resource-radar-hover">
        <strong :title="hoverItem.title">{{ hoverItem.title }}</strong>
        <span :title="displayCategory(hoverItem)">{{ displayCategory(hoverItem) }}</span>
      </div>
      <div v-if="selectedItem" class="resource-radar-selected">
        <strong :title="selectedItem.title">{{ selectedItem.title }}</strong>
        <span :title="displayCategory(selectedItem)">{{ displayCategory(selectedItem) }}</span>
        <p :title="selectedItem.summary">{{ selectedItem.summary }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type * as Three from "three";
import type { RadarItem } from "../../api";
import { usePreferencesStore } from "../../stores/preferences";
import { displayCategory } from "./resource-filters";
import { animateRadarFocus, animateRadarScene, type RadarAnimationState } from "./resource-radar-animation";
import { buildRadarCluster } from "./resource-radar-cluster";
import { disposeSceneResources } from "./resource-radar-dispose";
import {
  clamp,
  clusterCenter,
  fract,
  groupResourcesForRadar,
  majorCategoryOf,
  radarDensityMode,
  type ClusterGroupData,
  type RadarCluster
} from "./resource-radar-model";
import { createCloudTexture, createGlowTexture, readRadarTokens } from "./resource-radar-textures";

const props = defineProps<{
  items: RadarItem[];
  selectedId?: string;
}>();

const emit = defineEmits<{
  select: [resourceId: string];
  preview: [resourceId: string];
}>();

const initialCameraZ = 12.8;
const initialRotation = { x: -0.24, y: -0.18 };
const preferences = usePreferencesStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const isDragging = ref(false);
const hoverItem = ref<RadarItem | undefined>();
const focusedCategory = ref<string | undefined>();
const densityMode = computed(() => radarDensityMode(props.items.length));
const clusters = computed(() => groupResourcesForRadar(props.items, { mode: densityMode.value, focusedCategory: focusedCategory.value }));
const selectedItem = computed(() => props.items.find((item) => item.id === props.selectedId));

let THREE: typeof import("./resource-radar-three") | undefined;
let renderer: Three.WebGLRenderer | undefined;
let scene: Three.Scene | undefined;
let camera: Three.PerspectiveCamera | undefined;
let rootGroup: Three.Group | undefined;
let frame = 0;
let resizeObserver: ResizeObserver | undefined;
let raycaster: Three.Raycaster | undefined;
let pointer: Three.Vector2 | undefined;
let clusterGroups: Array<Three.Group & { userData: ClusterGroupData }> = [];
let nodeObjects: Three.Sprite[] = [];
let nodeById = new Map<string, Three.Sprite>();
let cloudObjects: Three.Object3D[] = [];
let orbitObjects: Three.Object3D[] = [];
const focusScratch = { position: undefined as Three.Vector3 | undefined, scale: undefined as Three.Vector3 | undefined };
let reducedMotion = false;
let pointerDown = false;
let pointerMoved = false;
let pointerStartX = 0;
let pointerStartY = 0;
let pointerLastX = 0;
let pointerLastY = 0;

watch(
  () => props.items,
  () => {
    void rebuild();
  },
  { deep: true, flush: "post" }
);

watch(focusedCategory, () => {
  if (densityMode.value !== "full") void rebuild();
});

watch(
  () => props.selectedId,
  () => {
    const selected = selectedItem.value;
    if (selected) focusedCategory.value = majorCategoryOf(selected);
    updateNodeVisuals();
  }
);

async function rebuild(): Promise<void> {
  disposeScene();
  await nextTick();
  if (!canvasRef.value || props.items.length === 0) return;
  reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  try {
    THREE = await import("./resource-radar-three");
    createScene(canvasRef.value);
  } catch {
    disposeScene();
  }
}

function createScene(canvas: HTMLCanvasElement): void {
  const three = THREE;
  if (!three) return;
  const tokens = readRadarTokens();
  const glowTexture = createGlowTexture(three);
  const cloudTexture = createCloudTexture(three);

  scene = new three.Scene();
  camera = new three.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, 0, initialCameraZ);
  renderer = new three.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.55));

  rootGroup = new three.Group();
  const sceneRoot = rootGroup;
  sceneRoot.rotation.x = initialRotation.x;
  sceneRoot.rotation.y = initialRotation.y;
  scene.add(createStarField(three, tokens.muted, tokens.accent));
  scene.add(sceneRoot);
  scene.add(new three.AmbientLight(tokens.text, 1.25));
  const keyLight = new three.PointLight(tokens.accent, 2.4, 38);
  keyLight.position.set(5, 7, 10);
  scene.add(keyLight);
  const fillLight = new three.PointLight(tokens.success, 0.9, 30);
  fillLight.position.set(-7, -2, 7);
  scene.add(fillLight);

  const categories = clusters.value;
  if (focusedCategory.value && !categories.some((category) => category.category === focusedCategory.value)) {
    focusedCategory.value = undefined;
  }
  categories.forEach((category, categoryIndex) => {
    const center = clusterCenter(three, categoryIndex, categories.length);
    buildRadarCluster({
      category,
      categoryIndex,
      center,
      cloudObjects,
      cloudTexture,
      clusterGroups,
      glowTexture,
      nodeById,
      nodeObjects,
      orbitObjects,
      rootGroup: sceneRoot,
      three,
      tokens
    });
  });

  raycaster = new three.Raycaster();
  pointer = new three.Vector2();
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();
  updateNodeVisuals();

  const render = (time = 0) => {
    if (!renderer || !scene || !camera || !rootGroup) return;
    const seconds = time / 1000;
    animateFocus(seconds);
    animateScene(seconds);
    renderer.render(scene, camera);
    frame = window.requestAnimationFrame(render);
  };
  render();
}

function createStarField(three: NonNullable<typeof THREE>, muted: string, accent: string): Three.Points {
  const geometry = new three.BufferGeometry();
  const positions: number[] = [];
  for (let index = 0; index < 360; index += 1) {
    const a = index * 12.9898;
    const b = index * 78.233;
    const x = (fract(Math.sin(a) * 43758.5453) - 0.5) * 18;
    const y = (fract(Math.sin(b) * 24634.6345) - 0.5) * 10;
    const z = (fract(Math.sin(a + b) * 91573.2342) - 0.5) * 12 - 2;
    positions.push(x, y, z);
  }
  geometry.setAttribute("position", new three.Float32BufferAttribute(positions, 3));
  const material = new three.PointsMaterial({
    color: muted || accent,
    size: 0.026,
    transparent: true,
    opacity: 0.34,
    depthWrite: false
  });
  return new three.Points(geometry, material);
}

function animateScene(seconds: number): void {
  const state = createAnimationState();
  if (state) animateRadarScene(state, seconds);
}

function animateFocus(seconds: number): void {
  const state = createAnimationState();
  if (state) animateRadarFocus(state, seconds);
}

function createAnimationState(): RadarAnimationState | undefined {
  const three = THREE;
  if (!three || !rootGroup) return undefined;
  return {
    cloudObjects,
    clusterGroups,
    focusedCategory: focusedCategory.value,
    focusScratch,
    isDragging: isDragging.value,
    nodeObjects,
    orbitObjects,
    reducedMotion,
    rootGroup,
    three
  };
}

function resize(): void {
  if (!canvasRef.value || !renderer || !camera) return;
  const rect = canvasRef.value.getBoundingClientRect();
  renderer.setSize(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)), false);
  camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
  camera.updateProjectionMatrix();
}

function onPointerDown(event: PointerEvent): void {
  if (!canvasRef.value) return;
  pointerDown = true;
  pointerMoved = false;
  isDragging.value = true;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  pointerLastX = event.clientX;
  pointerLastY = event.clientY;
  canvasRef.value.setPointerCapture?.(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  if (!canvasRef.value || !rootGroup) return;
  if (pointerDown) {
    const dx = event.clientX - pointerLastX;
    const dy = event.clientY - pointerLastY;
    if (Math.abs(event.clientX - pointerStartX) + Math.abs(event.clientY - pointerStartY) > 5) pointerMoved = true;
    rootGroup.rotation.y += dx * 0.006;
    rootGroup.rotation.x = clamp(rootGroup.rotation.x + dy * 0.004, -0.72, 0.72);
    pointerLastX = event.clientX;
    pointerLastY = event.clientY;
    return;
  }
  updateHover(event);
}

function onPointerUp(event: PointerEvent): void {
  canvasRef.value?.releasePointerCapture?.(event.pointerId);
  pointerDown = false;
  isDragging.value = false;
  if (!pointerMoved) selectNodeAt(event);
}

function onPointerLeave(): void {
  pointerDown = false;
  isDragging.value = false;
  hoverItem.value = undefined;
  updateNodeVisuals();
}

function onWheel(event: WheelEvent): void {
  if (!camera) return;
  event.preventDefault();
  camera.position.z = clamp(camera.position.z + event.deltaY * 0.012, 8.6, 22);
  camera.updateProjectionMatrix();
}

function resetView(): void {
  if (!camera || !rootGroup) return;
  focusedCategory.value = undefined;
  camera.position.set(0, 0, initialCameraZ);
  camera.updateProjectionMatrix();
  rootGroup.rotation.x = initialRotation.x;
  rootGroup.rotation.y = initialRotation.y;
  hoverItem.value = undefined;
  updateNodeVisuals();
}

function selectNodeAt(event: PointerEvent): void {
  const resourceId = resourceIdAt(event);
  if (resourceId) emit("select", resourceId);
}

function updateHover(event: PointerEvent): void {
  const resourceId = resourceIdAt(event);
  hoverItem.value = props.items.find((item) => item.id === resourceId);
  updateNodeVisuals();
}

function resourceIdAt(event: PointerEvent): string | undefined {
  if (!canvasRef.value || !camera || !raycaster || !pointer) return undefined;
  const rect = canvasRef.value.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(nodeObjects, false)[0];
  const resourceId = hit?.object.userData.resourceId;
  return typeof resourceId === "string" ? resourceId : undefined;
}

function updateNodeVisuals(): void {
  for (const [id, node] of nodeById.entries()) {
    const isSelected = id === props.selectedId;
    const isHovered = id === hoverItem.value?.id;
    const factor = isSelected ? 1.16 : isHovered ? 1.08 : 1;
    const baseWidth = typeof node.userData.baseWidth === "number" ? node.userData.baseWidth : 2.4;
    const baseHeight = typeof node.userData.baseHeight === "number" ? node.userData.baseHeight : 0.72;
    node.scale.set(baseWidth * factor, baseHeight * factor, 1);
    const material = node.material as Three.SpriteMaterial | undefined;
    if (material) material.opacity = isSelected ? 1 : isHovered ? 0.98 : 0.94;
  }
}

function selectCluster(cluster: RadarCluster): void {
  focusedCategory.value = cluster.category;
  const firstId = props.items.find((item) => majorCategoryOf(item) === cluster.category)?.id;
  if (firstId) emit("preview", firstId);
}

function disposeScene(): void {
  if (frame) window.cancelAnimationFrame(frame);
  frame = 0;
  resizeObserver?.disconnect();
  resizeObserver = undefined;
  canvasRef.value?.removeEventListener("pointerdown", onPointerDown);
  canvasRef.value?.removeEventListener("pointermove", onPointerMove);
  canvasRef.value?.removeEventListener("pointerup", onPointerUp);
  canvasRef.value?.removeEventListener("pointerleave", onPointerLeave);
  canvasRef.value?.removeEventListener("wheel", onWheel);
  disposeSceneResources(scene, renderer);
  renderer = undefined;
  scene = undefined;
  camera = undefined;
  rootGroup = undefined;
  raycaster = undefined;
  pointer = undefined;
  clusterGroups = [];
  nodeObjects = [];
  nodeById = new Map();
  cloudObjects = [];
  orbitObjects = [];
  hoverItem.value = undefined;
  pointerDown = false;
  pointerMoved = false;
  isDragging.value = false;
}

onMounted(() => {
  void rebuild();
});
onBeforeUnmount(disposeScene);
</script>
