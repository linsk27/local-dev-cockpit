import type * as Three from "three";
import type { RadarItem } from "../../api";
import { displayCategory } from "./resource-filters";

export type RadarTokens = {
  accent: string;
  border: string;
  card: string;
  danger: string;
  muted: string;
  surface: string;
  success: string;
  text: string;
  textStrong: string;
  warn: string;
};

export function readRadarTokens(): RadarTokens {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const theme = document.documentElement.dataset.theme;
  const card = theme === "dark" ? "rgba(12,16,28,0.92)" : theme === "cream" ? "rgba(255,247,235,0.9)" : "rgba(255,255,255,0.92)";
  return {
    accent: token("--accent", "#8f7dff"),
    border: token("--border", "rgba(140,148,170,0.34)"),
    card,
    danger: token("--danger", "#ff6262"),
    muted: token("--muted", "#858b99"),
    surface: token("--surface-soft", "rgba(20,24,36,0.86)"),
    success: token("--success", "#28d17c"),
    text: token("--text", "#eef0f5"),
    textStrong: token("--text-strong", "#ffffff"),
    warn: token("--warn", "#f0b94d")
  };
}

export function createResourceCardTexture(
  three: typeof import("./resource-radar-three"),
  item: RadarItem,
  color: string,
  tokens: RadarTokens
): Three.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 760;
  canvas.height = 220;
  const context = canvas.getContext("2d");
  if (!context) return new three.CanvasTexture(canvas);

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.shadowColor = color;
  context.shadowBlur = 30;
  fillRoundRect(context, 24, 22, 712, 176, 34, "rgba(255,255,255,0.18)");
  context.shadowBlur = 0;
  fillRoundRect(context, 22, 18, 716, 178, 34, tokens.card);
  strokeRoundRect(context, 22, 18, 716, 178, 34, normalizeCanvasColor(tokens.border, "rgba(180,190,220,0.28)"), 2);

  context.fillStyle = color;
  context.beginPath();
  context.arc(64, 72, 12, 0, Math.PI * 2);
  context.fill();

  context.font = "700 34px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  context.fillStyle = normalizeCanvasColor(tokens.textStrong, "#ffffff");
  context.fillText(fitText(context, item.title || "Untitled", 505), 92, 82);

  context.font = "600 23px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  context.fillStyle = normalizeCanvasColor(tokens.muted, "rgba(210,216,230,0.74)");
  const subline = [kindLabel(item.kind), displayCategory(item)].filter(Boolean).join(" · ");
  context.fillText(fitText(context, subline, 560), 92, 128);

  const score = `${Math.round(item.confidence || 0)}/100`;
  context.font = "800 24px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const scoreWidth = context.measureText(score).width + 34;
  fillRoundRect(context, 706 - scoreWidth, 56, scoreWidth, 42, 21, "rgba(255,255,255,0.08)");
  context.fillStyle = normalizeCanvasColor(tokens.text, "#eef0f5");
  context.fillText(score, 723 - scoreWidth, 84);

  const texture = new three.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function createClusterLabelTexture(
  three: typeof import("./resource-radar-three"),
  title: string,
  count: number,
  color: string,
  tokens: RadarTokens
): Three.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 560;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return new three.CanvasTexture(canvas);

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.shadowColor = color;
  context.shadowBlur = 18;
  fillRoundRect(context, 18, 18, 524, 84, 42, "rgba(255,255,255,0.14)");
  context.shadowBlur = 0;
  fillRoundRect(context, 16, 14, 528, 86, 43, tokens.card);
  strokeRoundRect(context, 16, 14, 528, 86, 43, color, 2);
  context.fillStyle = color;
  context.beginPath();
  context.arc(60, 57, 12, 0, Math.PI * 2);
  context.fill();
  context.font = "800 30px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  context.fillStyle = normalizeCanvasColor(tokens.textStrong, "#ffffff");
  context.fillText(fitText(context, title, 320), 88, 68);
  context.font = "800 24px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  context.fillStyle = normalizeCanvasColor(tokens.muted, "rgba(210,216,230,0.74)");
  context.fillText(`${count}`, 462, 68);
  const texture = new three.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function createGlowTexture(three: typeof import("./resource-radar-three")): Three.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 62);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.18, "rgba(255,255,255,0.92)");
    gradient.addColorStop(0.42, "rgba(255,255,255,0.24)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  return new three.CanvasTexture(canvas);
}

export function createCloudTexture(three: typeof import("./resource-radar-three")): Three.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(128, 128, 4, 128, 128, 126);
    gradient.addColorStop(0, "rgba(255,255,255,0.48)");
    gradient.addColorStop(0.32, "rgba(255,255,255,0.18)");
    gradient.addColorStop(0.68, "rgba(255,255,255,0.06)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
  }
  return new three.CanvasTexture(canvas);
}

function fillRoundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, color: string): void {
  context.fillStyle = color;
  roundedPath(context, x, y, width, height, radius);
  context.fill();
}

function strokeRoundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: string,
  lineWidth: number
): void {
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  roundedPath(context, x, y, width, height, radius);
  context.stroke();
}

function roundedPath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text;
  const chars = [...text];
  while (chars.length > 1 && context.measureText(`${chars.join("")}...`).width > maxWidth) chars.pop();
  return `${chars.join("")}...`;
}

function normalizeCanvasColor(value: string, fallback: string): string {
  if (!value || value.includes("color-mix")) return fallback;
  return value;
}

function kindLabel(kind: RadarItem["kind"]): string {
  const map: Record<string, string> = {
    "github-repo": "GitHub",
    "skill-md": "Skill",
    article: "Article",
    demo: "Demo",
    mcp: "MCP",
    prompt: "Prompt",
    tool: "Tool",
    workflow: "Workflow",
    unknown: "Resource"
  };
  return map[kind] ?? "Resource";
}
