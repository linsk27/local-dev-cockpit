import type { ApiLensRequestRecord, ApiLensTarget } from "./types.js";

export function createApiLensContext(record: ApiLensRequestRecord, target?: ApiLensTarget): string {
  const lines = [
    "# API Lens Request Context",
    "",
    `Target: ${target?.name ?? record.targetId}`,
    `Base URL: ${target?.baseUrl ?? "unknown"}`,
    `Request: ${record.method} ${record.path}`,
    `Status: ${record.status ?? "failed"}`,
    `Duration: ${record.durationMs}ms`,
    `Started: ${record.startedAt}`
  ];
  if (record.error) lines.push(`Error: ${record.error}`);
  lines.push("", "## Request Headers", fenced(JSON.stringify(record.request.headers, null, 2)));
  if (record.request.body) lines.push("", "## Request Body Preview", fenced(JSON.stringify(record.request.body, null, 2)));
  if (record.response?.headers) lines.push("", "## Response Headers", fenced(JSON.stringify(record.response.headers, null, 2)));
  if (record.response?.body) lines.push("", "## Response Body Preview", fenced(JSON.stringify(record.response.body, null, 2)));
  return lines.join("\n");
}

function fenced(value: string): string {
  return ["```json", value, "```"].join("\n");
}
