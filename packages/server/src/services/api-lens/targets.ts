import { randomUUID } from "node:crypto";
import net from "node:net";
import type { AppConfig } from "../../store.js";
import type { ApiLensTarget } from "./types.js";

export interface CreateApiLensTargetInput {
  name: string;
  baseUrl: string;
  projectId?: string;
}

export function createApiLensTarget(input: CreateApiLensTargetInput): ApiLensTarget {
  const baseUrl = normalizeTargetBaseUrl(input.baseUrl);
  return {
    id: randomUUID(),
    name: input.name.trim() || new URL(baseUrl).host,
    baseUrl,
    projectId: input.projectId?.trim() || undefined,
    createdAt: new Date().toISOString()
  };
}

export function addApiLensTarget(config: AppConfig, target: ApiLensTarget): AppConfig {
  return {
    ...config,
    apiLens: {
      targets: [target, ...config.apiLens.targets.filter((item) => item.id !== target.id)]
    }
  };
}

export function removeApiLensTarget(config: AppConfig, targetId: string): AppConfig {
  return {
    ...config,
    apiLens: {
      targets: config.apiLens.targets.filter((target) => target.id !== targetId)
    }
  };
}

export function normalizeTargetBaseUrl(raw: string): string {
  const parsed = new URL(raw.trim());
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("API Lens only supports http and https targets.");
  }
  if (!isAllowedLocalHost(parsed.hostname)) {
    throw new Error("API Lens only proxies localhost or private-network targets.");
  }
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

export function isAllowedLocalHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "localhost" || normalized === "::1") return true;
  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) return isPrivateIpv4(normalized);
  if (ipVersion === 6) return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  return false;
}

function isPrivateIpv4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map((part) => Number(part));
  return a === 10 || a === 127 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 169 && b === 254;
}
