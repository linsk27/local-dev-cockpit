export function summarizeFallbackFailure(rawLog: string, exitCode: number | null): string {
  const lines = rawLog
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const priorityIndex = findFailureLine(lines);
  const window = priorityIndex >= 0 ? lines.slice(priorityIndex, priorityIndex + 8) : lines.slice(-4);
  const taskkillIndex = window.findIndex((line) => /taskkill/i.test(line));
  const selected = taskkillIndex >= 0 ? window.slice(0, taskkillIndex + 1) : window.slice(0, 4);
  const detail = selected.join(" ");
  return detail ? `${detail} (exit code ${exitCode ?? "unknown"})` : `Command exited with code ${exitCode}`;
}

function findFailureLine(lines: string[]): number {
  const priorityPatterns = [
    /ModuleNotFoundError:\s*No module named/i,
    /Cannot find package ['"][^'"]+['"]|Cannot find module ['"][^'"]+['"]/i,
    /not recognized as an internal or external command|command not found|spawn .+ ENOENT/i,
    /another .+server.+already running/i,
    /address already in use|eaddrinuse/i,
    /permission denied/i,
    /cannot find module|module not found/i,
    /port \d+ is in use/i
  ];
  for (const pattern of priorityPatterns) {
    const index = lines.findIndex((line) => pattern.test(line));
    if (index >= 0) return index;
  }
  return -1;
}
