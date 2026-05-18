import { describe, expect, it } from "vitest";
import { logIndicatesExistingServer, parseLocalEndpointsFromLogs, parseNetstatListeningPids, parseStoppedChildrenOutput } from "./server.js";

describe("parseNetstatListeningPids", () => {
  it("extracts listening process ids for the requested port", () => {
    const output = [
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    127.0.0.1:8000         0.0.0.0:0              LISTENING       34204",
      "  TCP    [::1]:8000             [::]:0                 LISTENING       34205",
      "  TCP    127.0.0.1:8001         0.0.0.0:0              LISTENING       34206",
      "  TCP    127.0.0.1:61130        127.0.0.1:8000         TIME_WAIT       0"
    ].join("\n");

    expect(parseNetstatListeningPids(output, 8000)).toEqual([34204, 34205]);
  });
});

describe("parseLocalEndpointsFromLogs", () => {
  it("extracts existing Next.js server endpoints from failed logs", () => {
    const endpoints = parseLocalEndpointsFromLogs(
      [
        "Port 3000 is in use by process 5796, using available port 3001 instead.",
        "Local:         http://localhost:3001",
        "Another next dev server is already running.",
        "Local:         http://localhost:3000",
        "PID:           5796",
        "Dir:           D:\\个人\\AI-v0.dev-"
      ].join("\n")
    );

    expect(endpoints).toEqual([
      { port: 3001, host: "localhost", url: "http://localhost:3001" },
      { port: 3000, host: "localhost", url: "http://localhost:3000" }
    ]);
  });
});

describe("logIndicatesExistingServer", () => {
  it("recognizes duplicate dev server and port-in-use failures", () => {
    expect(logIndicatesExistingServer("Another next dev server is already running.")).toBe(true);
    expect(logIndicatesExistingServer("Another next dev server is already running.\n- Dir: D:\\个人\\AI-v0.dev-", "D:\\个人\\AI-v0.dev-")).toBe(true);
    expect(logIndicatesExistingServer("Another next dev server is already running.\n- Dir: D:\\个人\\AI-v0.dev-", "D:\\个人\\other")).toBe(false);
    expect(logIndicatesExistingServer("ERROR: address already in use")).toBe(true);
    expect(logIndicatesExistingServer("Cannot find module")).toBe(false);
  });
});

describe("parseStoppedChildrenOutput", () => {
  it("extracts child process ids from Windows stop fallback output", () => {
    expect(parseStoppedChildrenOutput("STOPPED_CHILDREN:13552, 18268")).toEqual([13552, 18268]);
    expect(parseStoppedChildrenOutput("STOPPED_TARGET")).toEqual([]);
  });
});
