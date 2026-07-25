import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkspaceRegistry, Workspace } from "./workspaces.js";

const execFileAsync = promisify(execFile);

const SECRET_KEYWORD_REGEX = /(TOKEN|SECRET|PASSWORD|KEY|CONNECTION_STRING)/i;
const URL_REGEX = /https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/[^\s]*)?/gi;

function secretValues(environment?: Record<string, string>): string[] {
  return Object.entries({ ...process.env, ...(environment ?? {}) })
    .filter(([key, value]) => SECRET_KEYWORD_REGEX.test(key) && Boolean(value) && value!.length >= 4)
    .map(([, value]) => value!)
    .sort((a, b) => b.length - a.length);
}

export function redactProcessText(text: string, environment?: Record<string, string>): string {
  return secretValues(environment).reduce((result, secret) => result.split(secret).join("[REDACTED]"), text);
}

export interface TrackedProcess {
  id: string;
  workspaceId: string;
  command: string;
  workingDirectory: string;
  startTime: string;
  child: ChildProcess;
  pid: number | undefined;
  status: "running" | "exited";
  exitCode?: number;
  stdoutLogs: string[];
  stderrLogs: string[];
  combinedLogs: string[];
  detectedUrls: Set<string>;
  maxLogLines: number;
}

export interface StartProcessInput {
  workspaceId: string;
  command: string;
  workingDirectory?: string;
  environment?: Record<string, string>;
  useShell?: boolean;
}

export interface GetProcessLogsInput {
  workspaceId: string;
  processId: string;
  lines?: number;
  stream?: "stdout" | "stderr" | "both";
}

export interface ListProcessesInput {
  workspaceId: string;
}

export interface StopProcessInput {
  workspaceId: string;
  processId: string;
  force?: boolean;
}

export function sanitizeEnv(env?: Record<string, string>): Record<string, string> {
  if (!env) return {};
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (SECRET_KEYWORD_REGEX.test(key)) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export class ProcessManager {
  private readonly processes = new Map<string, TrackedProcess>();

  constructor(private readonly registry: WorkspaceRegistry) {}

  startProcess(input: StartProcessInput): {
    processId: string;
    status: "running" | "exited";
    exitCode?: number;
    detectedUrls: string[];
    recentOutput: string[];
  } {
    const workspace = this.registry.getWorkspace(input.workspaceId);
    const cwd = this.registry.resolveWorkingDirectory(workspace, input.workingDirectory);

    const processId = `proc_${randomUUID()}`;
    const maxLogLines = 1000;

    const childEnv = { ...process.env, ...(input.environment ?? {}) };
    const redactionEnvironment = input.environment;

    const useShell = input.useShell ?? true;
    const child = spawn(input.command, {
      cwd,
      env: childEnv,
      shell: useShell,
      detached: false,
    });

    const tracked: TrackedProcess = {
      id: processId,
      workspaceId: input.workspaceId,
      command: input.command,
      workingDirectory: cwd,
      startTime: new Date().toISOString(),
      child,
      pid: child.pid,
      status: "running",
      stdoutLogs: [],
      stderrLogs: [],
      combinedLogs: [],
      detectedUrls: new Set<string>(),
      maxLogLines,
    };

    const appendLog = (line: string, stream: "stdout" | "stderr") => {
      const trimmed = redactProcessText(line.trimEnd(), redactionEnvironment);
      if (!trimmed) return;

      const matches = trimmed.match(URL_REGEX);
      if (matches) {
        for (const match of matches) {
          tracked.detectedUrls.add(match);
        }
      }

      const formatted = `[${stream}] ${trimmed}`;
      tracked.combinedLogs.push(formatted);
      if (stream === "stdout") tracked.stdoutLogs.push(trimmed);
      if (stream === "stderr") tracked.stderrLogs.push(trimmed);

      if (tracked.combinedLogs.length > maxLogLines) {
        tracked.combinedLogs.shift();
      }
      if (tracked.stdoutLogs.length > maxLogLines) {
        tracked.stdoutLogs.shift();
      }
      if (tracked.stderrLogs.length > maxLogLines) {
        tracked.stderrLogs.shift();
      }
    };

    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        appendLog(line, "stdout");
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        appendLog(line, "stderr");
      }
    });

    child.on("exit", (code) => {
      tracked.status = "exited";
      tracked.exitCode = code ?? undefined;
    });

    child.on("error", (err) => {
      appendLog(`Process error: ${err.message}`, "stderr");
      tracked.status = "exited";
      tracked.exitCode = 1;
    });

    this.processes.set(processId, tracked);

    return {
      processId,
      status: tracked.status,
      exitCode: tracked.exitCode,
      detectedUrls: Array.from(tracked.detectedUrls),
      recentOutput: tracked.combinedLogs.slice(-20),
    };
  }

  getProcessLogs(input: GetProcessLogsInput): {
    processId: string;
    lines: string[];
    totalLinesAvailable: number;
  } {
    const tracked = this.getTrackedProcess(input.workspaceId, input.processId);

    const stream = input.stream ?? "both";
    let sourceLogs: string[];
    if (stream === "stdout") sourceLogs = tracked.stdoutLogs;
    else if (stream === "stderr") sourceLogs = tracked.stderrLogs;
    else sourceLogs = tracked.combinedLogs;

    const limit = Math.min(Math.max(input.lines ?? 100, 1), 500);
    const recent = sourceLogs.slice(-limit);

    return {
      processId: tracked.id,
      lines: recent,
      totalLinesAvailable: sourceLogs.length,
    };
  }

  listProcesses(input: ListProcessesInput): Array<{
    processId: string;
    command: string;
    workingDirectory: string;
    startTime: string;
    status: "running" | "exited";
    exitCode?: number;
    detectedUrls: string[];
  }> {
    const list: Array<{
      processId: string;
      command: string;
      workingDirectory: string;
      startTime: string;
      status: "running" | "exited";
      exitCode?: number;
      detectedUrls: string[];
    }> = [];

    for (const tracked of this.processes.values()) {
      if (tracked.workspaceId === input.workspaceId) {
        list.push({
          processId: tracked.id,
          command: tracked.command,
          workingDirectory: tracked.workingDirectory,
          startTime: tracked.startTime,
          status: tracked.status,
          exitCode: tracked.exitCode,
          detectedUrls: Array.from(tracked.detectedUrls),
        });
      }
    }

    return list;
  }

  async stopProcess(input: StopProcessInput): Promise<{
    processId: string;
    stopped: boolean;
    exitCode?: number;
  }> {
    const tracked = this.getTrackedProcess(input.workspaceId, input.processId);

    if (tracked.status === "exited") {
      return { processId: tracked.id, stopped: true, exitCode: tracked.exitCode };
    }

    const pid = tracked.pid;
    if (!pid) {
      tracked.child.kill("SIGKILL");
      tracked.status = "exited";
      return { processId: tracked.id, stopped: true };
    }

    if (input.force) {
      await this.killProcessTree(pid);
      tracked.status = "exited";
      return { processId: tracked.id, stopped: true };
    }

    // Try graceful kill first
    tracked.child.kill("SIGTERM");

    // Wait up to 1.5 seconds for graceful exit
    const exited = await this.waitForExit(tracked, 1500);
    if (!exited) {
      await this.killProcessTree(pid);
      tracked.status = "exited";
    }

    return { processId: tracked.id, stopped: true, exitCode: tracked.exitCode };
  }

  getTrackedProcess(workspaceId: string, processId: string): TrackedProcess {
    const tracked = this.processes.get(processId);
    if (!tracked || tracked.workspaceId !== workspaceId) {
      throw new Error(`Process ${processId} not found in workspace ${workspaceId}`);
    }
    return tracked;
  }

  private async waitForExit(tracked: TrackedProcess, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (tracked.status === "exited") return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return tracked.status === "exited";
  }

  private async killProcessTree(pid: number): Promise<void> {
    if (process.platform === "win32") {
      try {
        await execFileAsync("taskkill", ["/F", "/T", "/PID", String(pid)]);
      } catch {}
    } else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
    }
  }
}
