import type { Server } from "node:http";

export async function listenOnAvailablePort(server: Server, preferredPort: number): Promise<number> {
  for (let port = preferredPort; port <= preferredPort + 12; port += 1) {
    const result = await new Promise<"ok" | "busy">((resolve, reject) => {
      server.once("error", (error: NodeJS.ErrnoException) => {
        server.removeAllListeners("listening");
        if (error.code === "EADDRINUSE") resolve("busy");
        else reject(error);
      });
      server.once("listening", () => {
        server.removeAllListeners("error");
        resolve("ok");
      });
      server.listen(port, "127.0.0.1");
    });
    if (result === "ok") return port;
  }
  throw new Error(`No free port found near ${preferredPort}`);
}
