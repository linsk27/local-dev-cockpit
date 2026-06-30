import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { chooseProjectRootFolder } from "../services/native-shell.js";
import { rootId } from "../store.js";
import { readJson, sendJson } from "./shared.js";
import type { ServerRouteContext } from "./types.js";

const addRootSchema = z.object({ path: z.string().min(1) });
const openFolderDialogSchema = z.object({ initialPath: z.string().max(500).optional().default("") });
const updateConfigSchema = z.object({ editorCommand: z.string().min(1).max(260).optional() });

export async function handleConfigRoute(
  method: string,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  context: ServerRouteContext
): Promise<boolean> {
  if (method === "GET" && url.pathname === "/api/roots") {
    const config = await context.store.readConfig();
    sendJson(res, 200, {
      roots: config.roots.map((root) => ({
        id: rootId(root),
        path: root
      }))
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, { config: await context.store.readConfig() });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/dialogs/open-folder") {
    const body = openFolderDialogSchema.parse(await readJson(req));
    sendJson(res, 200, await chooseProjectRootFolder(body.initialPath));
    return true;
  }

  if (method === "PATCH" && url.pathname === "/api/config") {
    const body = updateConfigSchema.parse(await readJson(req));
    let config = await context.store.readConfig();
    if (body.editorCommand !== undefined) {
      config = await context.store.updateEditorCommand(body.editorCommand);
    }
    sendJson(res, 200, { config });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/roots") {
    const body = addRootSchema.parse(await readJson(req));
    const config = await context.store.addRoot(body.path);
    context.projectCache.invalidate();
    sendJson(res, 200, { config });
    return true;
  }

  const rootDelete = url.pathname.match(/^\/api\/roots\/([^/]+)$/);
  if (method === "DELETE" && rootDelete) {
    const config = await context.store.removeRoot(rootDelete[1] ?? "");
    context.projectCache.invalidate();
    sendJson(res, 200, { config });
    return true;
  }

  return false;
}
