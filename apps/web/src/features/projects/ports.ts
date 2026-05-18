import type { PortStatus } from "@local-dev-cockpit/core";

export function formatPortEndpoint(port: Pick<PortStatus, "port" | "host">): string {
  return port.host ? `${port.host}:${port.port}` : String(port.port);
}
