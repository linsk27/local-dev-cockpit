import type { IncomingMessage, ServerResponse } from "node:http";
import { handleConfigRoute } from "./routes/config.js";
import { handleProjectRoute } from "./routes/projects.js";
import { handleResourceRoute } from "./routes/resources.js";
import { handleSystemRoute } from "./routes/system.js";
import type { ServerRouteContext } from "./routes/types.js";

export type { ServerRouteContext } from "./routes/types.js";
export { sendJson } from "./routes/shared.js";

export async function handleApiRoute(req: IncomingMessage, res: ServerResponse, context: ServerRouteContext): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  const handlers = [handleSystemRoute, handleResourceRoute, handleConfigRoute, handleProjectRoute];

  for (const handler of handlers) {
    if (await handler(method, url, req, res, context)) return true;
  }

  return false;
}
