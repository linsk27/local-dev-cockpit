import { describe, expect, it } from "vitest";
import type { Project } from "@local-dev-cockpit/core";
import {
  assignExternalPortOwners,
  commandLineReferencesProject,
  filterStaleLogPorts,
  logIndicatesExistingServer,
  parseExternalPortOwners,
  parseLocalEndpointsFromLogs,
  parseNetstatListeningPids,
  parseStoppedChildrenOutput
} from "./server.js";

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

describe("parseExternalPortOwners", () => {
  it("parses Windows listener process rows from PowerShell JSON", () => {
    const owners = parseExternalPortOwners(
      JSON.stringify([
        {
          port: 3000,
          host: "127.0.0.1",
          pid: 23392,
          commandLine: "C:\\nvm4w\\nodejs\\node.exe D:\\个人\\demo\\node_modules\\next\\dist\\server\\lib\\start-server.js"
        },
        { port: "not-a-port", host: "127.0.0.1", pid: 1, commandLine: "bad" }
      ])
    );

    expect(owners).toEqual([
      {
        port: 3000,
        host: "127.0.0.1",
        pid: 23392,
        commandLine: "C:\\nvm4w\\nodejs\\node.exe D:\\个人\\demo\\node_modules\\next\\dist\\server\\lib\\start-server.js"
      }
    ]);
  });
});

describe("commandLineReferencesProject", () => {
  it("matches project-local Node and Python command lines", () => {
    expect(
      commandLineReferencesProject(
        'node "D:\\个人\\frontend\\node_modules\\.bin\\..\\vite\\bin\\vite.js" --host 127.0.0.1',
        "D:\\个人\\frontend"
      )
    ).toBe(true);
    expect(commandLineReferencesProject('"D:\\miniconda\\python.exe" -m uvicorn app.main:app', "D:\\个人\\backend")).toBe(false);
  });

  it("does not match sibling paths with the same prefix", () => {
    expect(commandLineReferencesProject("node D:\\个人\\frontend-old\\server.js", "D:\\个人\\frontend")).toBe(false);
  });
});

describe("assignExternalPortOwners", () => {
  it("assigns a listener to the most specific matching project path", () => {
    const root = project("root", "D:\\个人\\langchain-ai-langchain");
    const frontend = project("frontend", "D:\\个人\\langchain-ai-langchain\\frontend");
    const assignments = assignExternalPortOwners([root, frontend], [
      {
        port: 3000,
        host: "127.0.0.1",
        pid: 23392,
        commandLine: "node D:\\个人\\langchain-ai-langchain\\frontend\\node_modules\\next\\dist\\server\\lib\\start-server.js"
      }
    ]);

    expect(assignments.get(frontend.id)?.map((owner) => owner.port)).toEqual([3000]);
    expect(assignments.has(root.id)).toBe(false);
  });
});

describe("filterStaleLogPorts", () => {
  it("drops open ports from old logs when another project owns the current listener", () => {
    expect(
      filterStaleLogPorts(
        "ai-v0",
        {
          id: "old-run",
          projectId: "ai-v0",
          commandId: "script-dev",
          status: "stopped",
          startedAt: "2026-05-18T00:00:00.000Z",
          logPath: "old.log"
        },
        [{ port: 3000, host: "localhost", status: "open", source: "detected" }],
        [],
        new Map([[3000, new Set(["frontend"])]])
      )
    ).toEqual([]);
  });

  it("keeps running-process ports even when another external claim exists", () => {
    const ports = [{ port: 3000, host: "localhost", status: "open" as const, source: "process" as const }];
    expect(
      filterStaleLogPorts(
        "frontend",
        {
          id: "run",
          projectId: "frontend",
          commandId: "script-dev",
          status: "running",
          startedAt: "2026-05-18T00:00:00.000Z",
          logPath: "run.log"
        },
        ports,
        [],
        new Map([[3000, new Set(["other"])]])
      )
    ).toEqual(ports);
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

function project(id: string, projectPath: string): Project {
  return {
    id,
    name: id,
    path: projectPath,
    kind: "node",
    git: { branch: "main", dirtyCount: 0 },
    commands: [],
    ports: [],
    markers: []
  };
}
