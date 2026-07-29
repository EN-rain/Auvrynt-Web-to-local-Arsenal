import type { WorkspaceRegistry } from "../../workspaces.js";
import type { ProcessManager } from "../../processes.js";
import { inspectGodotDotnetProject } from "./godot-csharp-project.js";

export interface GodotRunProjectInput {
  workspaceId: string;
  projectPath: string;
  debug?: boolean;
  windowed?: boolean;
  resolution?: {
    width: number;
    height: number;
  };
  additionalGodotArguments?: string[];
  userArguments?: string[];
}

export interface GodotRunSceneInput {
  workspaceId: string;
  projectPath: string;
  scenePath: string;
  debug?: boolean;
}

export interface GodotGetRuntimeLogsInput {
  workspaceId: string;
  processId: string;
  severity?: Array<"error" | "warning" | "info" | "print">;
  lines?: number;
}

export interface StructuredRuntimeLogEntry {
  timestamp?: string;
  severity: "error" | "warning" | "info" | "print";
  category: string;
  message: string;
  path?: string;
  line?: number;
  stackFrames?: Array<{
    method?: string;
    path?: string;
    line?: number;
  }>;
  repeatCount?: number;
}

export async function godotRunProject(
  registry: WorkspaceRegistry,
  processManager: ProcessManager,
  input: GodotRunProjectInput,
): Promise<{
  processId: string;
  status: "running" | "exited";
  windowDetected: boolean;
  projectName?: string;
}> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const projectDir = registry.resolvePath(workspace, input.projectPath);
  const details = await inspectGodotDotnetProject(registry, { workspaceId: input.workspaceId, projectPath: input.projectPath });

  const godotExe = process.env.GODOT_DOTNET_EXECUTABLE ?? process.env.GODOT_EXECUTABLE ?? "godot-mono";
  const args = ["--path", `"${projectDir}"`];
  if (input.debug ?? true) args.push("-d");
  if (input.windowed) args.push("-w");
  if (input.resolution) args.push("--resolution", `${input.resolution.width}x${input.resolution.height}`);
  if (input.additionalGodotArguments) args.push(...input.additionalGodotArguments);
  if (input.userArguments && input.userArguments.length > 0) args.push("--", ...input.userArguments);

  const result = processManager.startProcess({
    workspaceId: input.workspaceId,
    command: `${godotExe} ${args.join(" ")}`,
    workingDirectory: projectDir,
  });

  return {
    processId: result.processId,
    status: result.status,
    windowDetected: !args.includes("--headless"),
    projectName: details.name,
  };
}

export async function godotRunScene(
  registry: WorkspaceRegistry,
  processManager: ProcessManager,
  input: GodotRunSceneInput,
): Promise<{ processId: string; status: "running" | "exited" }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const projectDir = registry.resolvePath(workspace, input.projectPath);
  const absoluteScene = registry.resolvePath(workspace, input.scenePath);

  if (!input.scenePath.endsWith(".tscn")) {
    throw new Error(`Invalid scene file extension: ${input.scenePath}. Only .tscn text scenes are supported.`);
  }

  const godotExe = process.env.GODOT_DOTNET_EXECUTABLE ?? process.env.GODOT_EXECUTABLE ?? "godot-mono";
  const args = ["--path", `"${projectDir}"`, `"${absoluteScene}"`];
  if (input.debug ?? true) args.push("-d");

  const result = processManager.startProcess({
    workspaceId: input.workspaceId,
    command: `${godotExe} ${args.join(" ")}`,
    workingDirectory: projectDir,
  });

  return { processId: result.processId, status: result.status };
}

export function parseStructuredRuntimeLogs(rawLines: string[]): StructuredRuntimeLogEntry[] {
  const entries: StructuredRuntimeLogEntry[] = [];
  let currentEntry: StructuredRuntimeLogEntry | null = null;

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.includes("Exception:") || trimmed.startsWith("System.") || trimmed.includes("NullReferenceException") || trimmed.includes("InvalidCastException")) {
      if (currentEntry) entries.push(currentEntry);
      currentEntry = {
        severity: "error",
        category: "csharp_exception",
        message: trimmed,
        stackFrames: [],
      };
      continue;
    }

    const stackMatch = trimmed.match(/^at\s+(.*?)(?:\s+in\s+(.*?):line\s+(\d+))?$/);
    if (stackMatch && currentEntry && currentEntry.category === "csharp_exception") {
      currentEntry.stackFrames = currentEntry.stackFrames ?? [];
      currentEntry.stackFrames.push({
        method: stackMatch[1],
        path: stackMatch[2],
        line: stackMatch[3] ? Number(stackMatch[3]) : undefined,
      });
      continue;
    }

    if (trimmed.includes("ERROR:") || trimmed.includes("SCRIPT ERROR:")) {
      if (currentEntry) entries.push(currentEntry);
      currentEntry = { severity: "error", category: "godot_error", message: trimmed };
    } else if (trimmed.includes("WARNING:")) {
      if (currentEntry) entries.push(currentEntry);
      currentEntry = { severity: "warning", category: "godot_warning", message: trimmed };
    } else {
      if (currentEntry && currentEntry.category !== "print") {
        entries.push(currentEntry);
        currentEntry = null;
      }
      entries.push({ severity: "print", category: "gd_print", message: trimmed });
    }
  }

  if (currentEntry) entries.push(currentEntry);

  const grouped: StructuredRuntimeLogEntry[] = [];
  for (const entry of entries) {
    const previous = grouped[grouped.length - 1];
    if (previous && previous.message === entry.message && previous.severity === entry.severity) {
      previous.repeatCount = (previous.repeatCount ?? 1) + 1;
    } else {
      grouped.push(entry);
    }
  }
  return grouped;
}

export function getGodotRuntimeLogs(
  processManager: ProcessManager,
  input: GodotGetRuntimeLogsInput,
): { processId: string; entries: StructuredRuntimeLogEntry[]; totalEntries: number } {
  const logs = processManager.getProcessLogs({
    workspaceId: input.workspaceId,
    processId: input.processId,
    lines: input.lines ?? 100,
  });
  const parsed = parseStructuredRuntimeLogs(logs.lines);
  const severityFilter = input.severity ? new Set(input.severity) : null;
  const filtered = severityFilter ? parsed.filter((entry) => severityFilter.has(entry.severity)) : parsed;
  return { processId: input.processId, entries: filtered, totalEntries: filtered.length };
}
