import type { IncomingMessage, ServerResponse } from "node:http";
import { resourceAiConfigUpdateSchema } from "@local-dev-cockpit/core";
import { createSkillContext, createSkillDraft, testAiConnection } from "../services/skill-radar/index.js";
import { AI_PROVIDER_PRESETS, toPublicAiSettings } from "../store.js";
import { readJson, sendJson } from "./shared.js";
import type { ServerRouteContext } from "./types.js";

export async function handleResourceRoute(
  method: string,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  context: ServerRouteContext
): Promise<boolean> {
  if (method === "GET" && url.pathname === "/api/skills") {
    if (url.searchParams.get("summary") === "1") {
      sendJson(res, 200, await context.skillRadar.summary());
      return true;
    }
    sendJson(res, 200, { skills: await context.skillRadar.list() });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/skills/export") {
    sendJson(res, 200, await context.skillRadar.exportData());
    return true;
  }

  if (method === "POST" && url.pathname === "/api/skills/import") {
    sendJson(res, 200, await context.skillRadar.importData(await readJson(req)));
    return true;
  }

  if (method === "GET" && url.pathname === "/api/skills/ai-config") {
    sendJson(res, 200, { config: toPublicAiSettings(await context.store.readAiSettings()) });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/ai/config") {
    sendJson(res, 200, { config: toPublicAiSettings(await context.store.readAiSettings()), providers: AI_PROVIDER_PRESETS });
    return true;
  }

  if (method === "PATCH" && url.pathname === "/api/skills/ai-config") {
    const settings = await context.store.updateAiSettings(resourceAiConfigUpdateSchema.parse(await readJson(req)));
    sendJson(res, 200, { config: toPublicAiSettings(settings) });
    return true;
  }

  if (method === "PATCH" && url.pathname === "/api/ai/config") {
    const settings = await context.store.updateAiSettings(resourceAiConfigUpdateSchema.parse(await readJson(req)));
    sendJson(res, 200, { config: toPublicAiSettings(settings), providers: AI_PROVIDER_PRESETS });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/ai/test") {
    const candidate = await context.store.previewAiSettings(resourceAiConfigUpdateSchema.parse(await readJson(req)));
    sendJson(res, 200, await testAiConnection(candidate));
    return true;
  }

  if (method === "POST" && url.pathname === "/api/skills/preview") {
    const preview = await context.skillRadar.preview(await readJson(req), { aiSettings: await context.store.readAiSettings() });
    sendJson(res, 200, { preview });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/skills/commit") {
    const skill = await context.skillRadar.commitPreview(await readJson(req));
    sendJson(res, 201, { skill });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/skills") {
    const skill = await context.skillRadar.create(await readJson(req), { aiSettings: await context.store.readAiSettings() });
    sendJson(res, 201, { skill });
    return true;
  }

  const skillMatch = url.pathname.match(/^\/api\/skills\/([^/]+)$/);
  if (skillMatch) {
    const skillId = decodeURIComponent(skillMatch[1] ?? "");
    if (method === "GET") {
      const skill = await context.skillRadar.get(skillId);
      if (!skill) {
        sendJson(res, 404, { error: "Skill not found" });
        return true;
      }
      sendJson(res, 200, { skill });
      return true;
    }
    if (method === "PATCH") {
      const skill = await context.skillRadar.update(skillId, await readJson(req));
      if (!skill) {
        sendJson(res, 404, { error: "Skill not found" });
        return true;
      }
      sendJson(res, 200, { skill });
      return true;
    }
    if (method === "DELETE") {
      const removed = await context.skillRadar.remove(skillId);
      sendJson(res, removed ? 200 : 404, removed ? { removed: true } : { error: "Skill not found" });
      return true;
    }
  }

  const skillContextMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/context$/);
  if (method === "GET" && skillContextMatch) {
    const skill = await context.skillRadar.get(decodeURIComponent(skillContextMatch[1] ?? ""));
    if (!skill) {
      sendJson(res, 404, { error: "Skill not found" });
      return true;
    }
    sendJson(res, 200, createSkillContext(skill));
    return true;
  }

  const skillDraftMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/generate-skill$/);
  if (method === "POST" && skillDraftMatch) {
    const skill = await context.skillRadar.get(decodeURIComponent(skillDraftMatch[1] ?? ""));
    if (!skill) {
      sendJson(res, 404, { error: "Skill not found" });
      return true;
    }
    sendJson(res, 200, createSkillDraft(skill));
    return true;
  }

  const skillAnalyzeMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/analyze$/);
  if (method === "POST" && skillAnalyzeMatch) {
    const skill = await context.skillRadar.analyze(decodeURIComponent(skillAnalyzeMatch[1] ?? ""), {
      aiSettings: await context.store.readAiSettings()
    });
    if (!skill) {
      sendJson(res, 404, { error: "Skill not found" });
      return true;
    }
    sendJson(res, 200, { skill });
    return true;
  }

  return false;
}
