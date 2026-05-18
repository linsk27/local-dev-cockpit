import { describe, expect, it } from "vitest";
import { summarizeFailedRun } from "./process-manager.js";

describe("summarizeFailedRun", () => {
  it("prefers actionable Next.js duplicate server messages", () => {
    const summary = summarizeFailedRun(
      [
        "Next.js 16.2.0\n",
        "Port 3000 is in use by process 5796, using available port 3001 instead.\n",
        "Local:         http://localhost:3001\n",
        "Another next dev server is already running.\n",
        "PID:          5796\n",
        "Run taskkill /PID 5796 /F to stop it.\n",
        "Command failed with exit code 1.\n"
      ],
      1
    );

    expect(summary).toContain("Another next dev server is already running.");
    expect(summary).toContain("Run taskkill /PID 5796 /F to stop it.");
    expect(summary).toContain("exit code 1");
  });
});
