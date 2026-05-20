import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeProcessAdapter, type Project } from "@local-dev-cockpit/core";
import {
  assignExternalPortOwners,
  checkForUpdates,
  commandStartBlockReason,
  commandLineReferencesProject,
  createEditorCommand,
  createOpenFolderCommand,
  externalListenerProbeCandidates,
  filterStaleLogPorts,
  findExternalProjectPorts,
  formatUpdateCheckError,
  isNewerVersion,
  isLocalHttpEndpointReachable,
  isObsoleteMissingToolFailure,
  logIndicatesExistingServer,
  normalizeScannedPorts,
  parseExternalPortOwners,
  parseEditorCommand,
  parseLocalEndpointsFromLogs,
  parseMissingToolName,
  parseNetstatListeningPids,
  parseNpmLatest,
  parseStoppedChildrenOutput,
  selectUpdateAssets,
  stopPort,
  writeProjectContextFiles
} from "./server.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("update checks", () => {
  it("compares semantic versions without treating equal versions as updates", () => {
    expect(isNewerVersion("v0.1.4", "0.1.3")).toBe(true);
    expect(isNewerVersion("0.1.3", "0.1.3")).toBe(false);
    expect(isNewerVersion("0.1.2", "0.1.3")).toBe(false);
  });

  it("selects installer and portable Windows assets", () => {
    expect(
      selectUpdateAssets([
        { name: "Source code.zip", size: 1, downloadUrl: "https://example.test/source.zip" },
        { name: "Dev-Cockpit-Setup-0.1.4-win-x64.exe", size: 2, downloadUrl: "https://example.test/setup.exe" },
        { name: "Dev-Cockpit-0.1.4-win-x64.exe", size: 3, downloadUrl: "https://example.test/portable.exe" }
      ])
    ).toEqual({
      installerAsset: { name: "Dev-Cockpit-Setup-0.1.4-win-x64.exe", size: 2, downloadUrl: "https://example.test/setup.exe" },
      portableAsset: { name: "Dev-Cockpit-0.1.4-win-x64.exe", size: 3, downloadUrl: "https://example.test/portable.exe" }
    });
  });

  it("returns user-facing update errors instead of raw fetch failures", () => {
    expect(formatUpdateCheckError(new TypeError("fetch failed"))).toContain("无法连接 GitHub Releases");
    expect(formatUpdateCheckError(new Error("GitHub releases request failed: 403"))).toContain("GitHub API");
  });

  it("parses npm latest package metadata", () => {
    expect(parseNpmLatest({ version: "v0.1.9" })).toEqual({ version: "0.1.9" });
    expect(() => parseNpmLatest({})).toThrow("missing version");
  });

  it("uses GitHub release metadata when GitHub is reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tag_name: "v0.1.9",
            html_url: "https://github.com/linsk27/local-dev-cockpit/releases/tag/v0.1.9",
            assets: [
              {
                name: "Dev-Cockpit-Setup-0.1.9-win-x64.exe",
                size: 100,
                browser_download_url: "https://example.test/setup.exe"
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    await expect(checkForUpdates("0.1.8")).resolves.toMatchObject({
      latestVersion: "0.1.9",
      hasUpdate: true,
      source: "github",
      installerAsset: {
        name: "Dev-Cockpit-Setup-0.1.9-win-x64.exe",
        size: 100,
        downloadUrl: "https://example.test/setup.exe"
      }
    });
  });

  it("falls back to npm latest when GitHub releases cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(new Response(JSON.stringify({ version: "0.1.9" }), { status: 200, headers: { "content-type": "application/json" } }))
    );

    await expect(checkForUpdates("0.1.8")).resolves.toMatchObject({
      latestVersion: "0.1.9",
      hasUpdate: true,
      source: "npm",
      warning: expect.stringContaining("npm registry"),
      releaseUrl: "https://github.com/linsk27/local-dev-cockpit/releases/tag/v0.1.9",
      installerAsset: {
        name: "Dev-Cockpit-Setup-0.1.9-win-x64.exe",
        size: 0,
        downloadUrl: "https://github.com/linsk27/local-dev-cockpit/releases/download/v0.1.9/Dev-Cockpit-Setup-0.1.9-win-x64.exe"
      }
    });
  });

  it("returns a manual release URL when both update sources fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(checkForUpdates("0.1.8")).resolves.toMatchObject({
      hasUpdate: false,
      releaseUrl: "https://github.com/linsk27/local-dev-cockpit/releases/latest",
      error: expect.stringContaining("无法连接 GitHub Releases，也无法连接 npm registry")
    });
  });
});

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

describe("stopPort", () => {
  it("treats an already closed port as a successful cleanup", async () => {
    const server = createServer((_request, response) => {
      response.end("ok");
    });
    const port = await listenOnRandomPort(server);
    await closeServer(server);

    await expect(stopPort(port)).resolves.toMatchObject({
      stopped: true,
      port,
      pids: [],
      alreadyClosed: true
    });
  });

  it("treats stale Windows PID rows as successful cleanup when the port is closed", async () => {
    if (process.platform !== "win32") return;

    vi.spyOn(NodeProcessAdapter.prototype, "execFile").mockImplementation(async (command, args) => {
      if (command === "netstat.exe") {
        expect(args).toEqual(["-ano"]);
        return {
          stdout: "TCP    127.0.0.1:54321        0.0.0.0:0              LISTENING       4242\n",
          stderr: "",
          exitCode: 0
        };
      }
      if (command === "powershell.exe") {
        return { stdout: "PID_NOT_FOUND\n", stderr: "", exitCode: 2 };
      }
      return { stdout: "", stderr: `unexpected command ${command}`, exitCode: 1 };
    });
    vi.spyOn(NodeProcessAdapter.prototype, "isPortOpen").mockResolvedValue(false);

    await expect(stopPort(54321)).resolves.toMatchObject({
      stopped: true,
      port: 54321,
      pids: [4242],
      alreadyClosed: true
    });
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

describe("findExternalProjectPorts", () => {
  it("detects reachable wildcard listeners through loopback candidates", async () => {
    const server = createServer((_request, response) => {
      response.end("ok");
    });
    const port = await listenOnRandomPort(server);
    try {
      const [detected] = await findExternalProjectPorts(project("demo", "D:\\个人\\demo"), [
        {
          port,
          host: "::",
          pid: 23392,
          commandLine: "node D:\\个人\\demo\\node_modules\\next\\dist\\server\\lib\\start-server.js"
        }
      ]);

      expect(detected).toMatchObject({
        port,
        host: "127.0.0.1",
        status: "open",
        source: "detected"
      });
    } finally {
      await closeServer(server);
    }
  });

  it("hides unreachable project-owned internal ports that are not known entrypoints", async () => {
    await expect(
      findExternalProjectPorts(project("demo", "D:\\个人\\demo"), [
        {
          port: 9,
          host: "127.0.0.1",
          pid: 23392,
          commandLine: "node D:\\个人\\demo\\node_modules\\next\\dist\\server\\lib\\start-server.js"
        }
      ])
    ).resolves.toEqual([]);
  });

  it("keeps unreachable declared project ports visible as stale instead of online", async () => {
    const target = project("demo", "D:\\个人\\demo");
    target.ports = [{ port: 9, host: "127.0.0.1", status: "closed", source: "detected" }];

    await expect(
      findExternalProjectPorts(target, [
        {
          port: 9,
          host: "127.0.0.1",
          pid: 23392,
          commandLine: "node D:\\个人\\demo\\node_modules\\next\\dist\\server\\lib\\start-server.js"
        }
      ])
    ).resolves.toEqual([
      {
        port: 9,
        host: "127.0.0.1",
        url: "http://127.0.0.1:9",
        status: "unknown",
        source: "detected"
      }
    ]);
  });

  it("keeps ports learned from previous logs as stale after the managed process is gone", async () => {
    await expect(
      findExternalProjectPorts(
        project("demo", "D:\\个人\\demo"),
        [
          {
            port: 9,
            host: "127.0.0.1",
            pid: 23392,
            commandLine: "node D:\\个人\\demo\\node_modules\\next\\dist\\server\\lib\\start-server.js"
          }
        ],
        [{ port: 9, host: "localhost", url: "http://localhost:9", status: "closed", source: "detected" }]
      )
    ).resolves.toEqual([
      {
        port: 9,
        host: "127.0.0.1",
        url: "http://127.0.0.1:9",
        status: "unknown",
        source: "detected"
      }
    ]);
  });
});

describe("normalizeScannedPorts", () => {
  it("keeps unique scanned ports online only when HTTP is reachable", async () => {
    const server = createServer((_request, response) => {
      response.end("ok");
    });
    const port = await listenOnRandomPort(server);
    const target = project("demo", "D:\\个人\\demo");
    target.ports = [{ port, host: "127.0.0.1", status: "open", source: "detected" }];
    try {
      await expect(normalizeScannedPorts(target, [], new Map([[port, 1]]))).resolves.toEqual([
        {
          port,
          host: "127.0.0.1",
          url: `http://127.0.0.1:${port}`,
          status: "open",
          source: "detected"
        }
      ]);
    } finally {
      await closeServer(server);
    }
  });

  it("marks unique scanned ports stale when TCP is open but HTTP is unreachable", async () => {
    const target = project("demo", "D:\\个人\\demo");
    target.ports = [{ port: 9, host: "127.0.0.1", status: "open", source: "detected" }];

    await expect(normalizeScannedPorts(target, [], new Map([[9, 1]]))).resolves.toEqual([
      { port: 9, host: "127.0.0.1", status: "unknown", source: "detected" }
    ]);
  });

  it("keeps external-owner matched scanned ports without another HTTP probe", async () => {
    const target = project("demo", "D:\\个人\\demo");
    target.ports = [{ port: 9, host: "127.0.0.1", status: "open", source: "detected" }];

    await expect(
      normalizeScannedPorts(target, [{ port: 9, host: "127.0.0.1", status: "unknown", source: "detected" }], new Map([[9, 1]]))
    ).resolves.toEqual([{ port: 9, host: "127.0.0.1", status: "open", source: "detected" }]);
  });
});

describe("externalListenerProbeCandidates", () => {
  it("probes wildcard listeners through browser-usable loopback addresses first", () => {
    expect(externalListenerProbeCandidates(3000, "::").map((candidate) => candidate.url)).toEqual([
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
      "http://localhost:3000"
    ]);
    expect(externalListenerProbeCandidates(3000, "0.0.0.0").map((candidate) => candidate.url)).toEqual([
      "http://127.0.0.1:3000",
      "http://localhost:3000"
    ]);
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

describe("isLocalHttpEndpointReachable", () => {
  it("requires an HTTP response before a local endpoint is treated as reachable", async () => {
    const server = createServer((_request, response) => {
      response.end("ok");
    });
    const port = await listenOnRandomPort(server);
    try {
      await expect(isLocalHttpEndpointReachable({ port, host: "127.0.0.1", url: `http://127.0.0.1:${port}` })).resolves.toBe(true);
      await expect(isLocalHttpEndpointReachable({ port: 9, host: "127.0.0.1", url: "http://127.0.0.1:9" }, 300)).resolves.toBe(false);
    } finally {
      await closeServer(server);
    }
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

describe("obsolete missing tool failures", () => {
  it("clears old package-manager failures after command detection changes", () => {
    const target = project("avue-cli", "D:\\个人\\AI-Vue3-python-flask-Blog\\avue-cli");
    target.commands = [
      {
        id: "script-dev",
        label: "dev",
        command: "npm",
        args: ["run", "dev"],
        cwd: target.path,
        source: "package-script",
        kind: "dev"
      }
    ];

    expect(parseMissingToolName("'yarn.cmd' 不是内部或外部命令，也不是可运行的程序。")).toBe("yarn");
    expect(
      isObsoleteMissingToolFailure(
        target,
        {
          id: "run",
          projectId: target.id,
          commandId: "script-dev",
          status: "failed",
          startedAt: "2026-05-18T00:00:00.000Z",
          logPath: "run.log",
          exitCode: 1
        },
        {
          commandId: "script-dev",
          message: "'yarn.cmd' 不是内部或外部命令，也不是可运行的程序。 (exit code 1)",
          occurredAt: "2026-05-18T00:00:01.000Z"
        }
      )
    ).toBe(true);
  });
});

describe("commandStartBlockReason", () => {
  it("blocks duplicate starts when a dev command would reuse an online port", () => {
    const target = project("api", "D:\\个人\\api");
    target.commands = [
      {
        id: "python-fastapi-app-main",
        label: "Uvicorn app.main",
        command: "python",
        args: ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd: target.path,
        source: "detected",
        kind: "dev"
      }
    ];
    target.ports = [{ port: 8000, host: "127.0.0.1", status: "open", source: "detected" }];

    expect(commandStartBlockReason(target, target.commands[0]!)).toContain("服务已经在线");
  });

  it("blocks starts when a stale detected port would be reused", () => {
    const target = project("web", "D:\\个人\\web");
    target.commands = [
      {
        id: "script-dev",
        label: "dev",
        command: "npm",
        args: ["run", "dev"],
        cwd: target.path,
        source: "package-script",
        kind: "dev"
      }
    ];
    target.ports = [{ port: 3000, host: "localhost", status: "unknown", source: "detected" }];

    expect(commandStartBlockReason(target, target.commands[0]!)).toContain("残留端口");
  });

  it("uses package script port hints when blocking duplicate starts", () => {
    const target = project("web", "D:\\个人\\web");
    target.commands = [
      {
        id: "script-dev",
        label: "dev",
        command: "pnpm",
        args: ["run", "dev"],
        ports: [5179],
        cwd: target.path,
        source: "package-script",
        kind: "dev"
      }
    ];
    target.ports = [{ port: 5179, host: "127.0.0.1", status: "open", source: "detected" }];

    expect(commandStartBlockReason(target, target.commands[0]!)).toContain("服务已经在线");
  });
});

describe("parseStoppedChildrenOutput", () => {
  it("extracts child process ids from Windows stop fallback output", () => {
    expect(parseStoppedChildrenOutput("STOPPED_CHILDREN:13552, 18268")).toEqual([13552, 18268]);
    expect(parseStoppedChildrenOutput("STOPPED_TARGET")).toEqual([]);
  });
});

describe("writeProjectContextFiles", () => {
  it("writes PROJECT_CONTEXT.md and AGENTS.md only when explicitly called", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-context-"));
    try {
      const result = await writeProjectContextFiles(project("demo", dir));

      expect(result.files.map((file) => path.basename(file))).toEqual(["PROJECT_CONTEXT.md", "AGENTS.md"]);
      await expect(fs.readFile(path.join(dir, "PROJECT_CONTEXT.md"), "utf8")).resolves.toContain("# demo");
      await expect(fs.readFile(path.join(dir, "AGENTS.md"), "utf8")).resolves.toContain("demo");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("createOpenFolderCommand", () => {
  it("uses the native folder opener for each platform", () => {
    expect(createOpenFolderCommand("win32", "D:\\projects\\demo")).toEqual({
      command: "explorer.exe",
      args: ["D:\\projects\\demo"]
    });
    expect(createOpenFolderCommand("darwin", "/Users/me/demo")).toEqual({
      command: "open",
      args: ["/Users/me/demo"]
    });
    expect(createOpenFolderCommand("linux", "/home/me/demo")).toEqual({
      command: "xdg-open",
      args: ["/home/me/demo"]
    });
  });
});

describe("createEditorCommand", () => {
  it("appends the project path without building a shell string", () => {
    expect(createEditorCommand("win32", "code --reuse-window", "D:\\projects\\demo")).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "code", "--reuse-window", "D:\\projects\\demo"]
    });
    expect(createEditorCommand("linux", "cursor", "/home/me/demo")).toEqual({
      command: "cursor",
      args: ["/home/me/demo"]
    });
    expect(createEditorCommand("win32", "C:\\Program Files\\Editor\\editor.exe", "D:\\projects\\demo")).toEqual({
      command: "C:\\Program Files\\Editor\\editor.exe",
      args: ["D:\\projects\\demo"]
    });
  });

  it("parses quoted editor paths and reports bad quotes", () => {
    expect(parseEditorCommand('"C:\\Program Files\\Editor\\editor.exe" --new-window')).toEqual({
      command: "C:\\Program Files\\Editor\\editor.exe",
      args: ["--new-window"]
    });
    expect(() => parseEditorCommand('"code')).toThrow("unclosed quote");
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

function listenOnRandomPort(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address) {
        resolve(address.port);
        return;
      }
      reject(new Error("No server address"));
    });
  });
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
