import type * as Three from "three";
import type { RadarItem } from "../../api";
import { displayCategoryPath } from "./resource-filters";

export interface RadarCluster {
  category: string;
  color: string;
  items: RadarItem[];
}

export type ClusterGroupData = {
  baseX: number;
  baseY: number;
  baseZ: number;
  category: string;
  phase: number;
};

const goldenAngle = Math.PI * (3 - Math.sqrt(5));

export function majorCategoryOf(item: RadarItem): string {
  return displayCategoryPath(item)[0] || item.category || "未分类";
}

export function groupResourcesByMajorCategory(items: RadarItem[]): RadarCluster[] {
  const groups = new Map<string, RadarItem[]>();
  for (const item of items) {
    const major = majorCategoryOf(item);
    const group = groups.get(major) ?? [];
    group.push(item);
    groups.set(major, group);
  }
  return [...groups.entries()]
    .map(([category, groupItems], index) => ({ category, items: groupItems, color: clusterColor(index) }))
    .sort((left, right) => right.items.length - left.items.length || left.category.localeCompare(right.category, "zh-CN"));
}

export function clusterColor(index: number): string {
  const palette = ["#8b78ff", "#20b486", "#f0a24a", "#4a9dff", "#d76df1", "#e75f75", "#7ba15a"];
  return palette[index % palette.length]!;
}

export function clusterCenter(three: typeof import("./resource-radar-three"), index: number, total: number): Three.Vector3 {
  if (total <= 1) return new three.Vector3(0, 0.22, 0);
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  const radius = total <= 2 ? 4.8 : total <= 3 ? 5.65 : 6.35;
  const verticalRadius = total <= 2 ? 1.15 : 1.85;
  const depthRadius = total <= 2 ? 2.85 : 3.35;
  return new three.Vector3(Math.cos(angle) * radius, Math.sin(angle) * verticalRadius, Math.sin(angle) * depthRadius);
}

export function nodePosition(
  three: typeof import("./resource-radar-three"),
  center: Three.Vector3,
  index: number,
  total: number
): Three.Vector3 {
  if (total === 1) return new three.Vector3(center.x + 1.72, center.y - 0.08, center.z + 0.28);

  if (total <= 6) {
    const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
    const radius = 2.88 + total * 0.12;
    const offset = index % 2 === 0 ? 0.18 : -0.24;
    return new three.Vector3(
      center.x + Math.cos(angle) * radius + offset,
      center.y + Math.sin(angle) * 1.18 + 0.2,
      center.z + Math.sin(angle + Math.PI / 5) * 1.45 + offset * 0.45
    );
  }

  const angle = index * goldenAngle;
  const radius = 1.95 + Math.sqrt(index + 1) * 0.38;
  const vertical = ((index % 3) - 1) * 0.68;
  return new three.Vector3(
    center.x + Math.cos(angle) * radius,
    center.y + vertical + Math.sin(angle * 0.7) * 0.32,
    center.z + Math.sin(angle) * radius * 0.94
  );
}

export function colorForResource(
  item: RadarItem,
  colors: { accent: string; success: string; warn: string; danger: string; muted: string }
): string {
  if (item.status === "useful") return colors.success;
  if (item.status === "archived") return colors.muted;
  if (item.kind === "unknown") return colors.warn;
  return colors.accent;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function fract(value: number): number {
  return value - Math.floor(value);
}
