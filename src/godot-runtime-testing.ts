import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { WorkspaceRegistry } from "./workspaces.js";
import type { ProcessManager } from "./processes.js";
import type { GodotEditorBridgeClient } from "./godot-editor-bridge.js";
import { getBridgeClient } from "./godot-editor-bridge.js";
import { inspectImage } from "./image-tools.js";

const execFileAsync = promisify(execFile);

// ─── Remote Scene Tree ────────────────────────────────────────────────────

export async function getRemoteSceneTree(
  input: { workspaceId: string; maxDepth?: number },
  bridgeClient: GodotEditorBridgeClient,
): Promise<Record<string, unknown>> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected.");
  return bridgeClient.sendRequest("remote.get_scene_tree", {
    maxDepth: input.maxDepth ?? 10,
  });
}

export async function getRuntimeProperty(
  input: { workspaceId: string; nodePath: string; property: string },
  bridgeClient: GodotEditorBridgeClient,
): Promise<{ value: unknown; type: string }> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected.");
  return bridgeClient.sendRequest("remote.get_property", {
    nodePath: input.nodePath,
    property: input.property,
  });
}

export async function getPerformanceMonitors(
  input: { workspaceId: string },
  bridgeClient: GodotEditorBridgeClient,
): Promise<{
  fps: number;
  processTimeMs: number;
  physicsProcessTimeMs: number;
  memoryMb: number;
  nodeCount: number;
  objectCount: number;
  orphanNodeCount: number;
}> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected.");
  return bridgeClient.sendRequest("remote.get_performance_monitors", {});
}

// ─── C# Exception Inspection ─────────────────────────────────────────────

export interface CsharpException {
  exceptionType: string;
  message: string;
  innerExceptions: CsharpException[];
  stackFrames: Array<{ method?: string; path?: string; line?: number }>;
  nodePath?: string;
  firstOccurrence: string;
  repeatCount: number;
}

export function parseCsharpExceptions(logLines: string[]): CsharpException[] {
  const exceptions: CsharpException[] = [];
  let currentEx: CsharpException | null = null;

  const EXCEPTION_TYPES = [
    "NullReferenceException", "InvalidCastException", "ObjectDisposedException",
    "InvalidOperationException", "ArgumentException", "ArgumentNullException",
    "NotImplementedException", "IndexOutOfRangeException", "KeyNotFoundException",
    "IOException", "FileNotFoundException",
  ];

  for (const line of logLines) {
    const trimmed = line.trim();

    // Check inner exception prefix FIRST (before top-level exception detection)
    if (currentEx && trimmed.startsWith("---> ")) {
      const innerMatch = trimmed.slice(5).match(/(\w*Exception):\s*(.*)/);
      if (innerMatch) {
        currentEx.innerExceptions.push({
          exceptionType: innerMatch[1],
          message: innerMatch[2],
          innerExceptions: [],
          stackFrames: [],
          firstOccurrence: new Date().toISOString(),
          repeatCount: 1,
        });
      }
      continue;
    }

    const isException = EXCEPTION_TYPES.some((t) => trimmed.includes(t)) || trimmed.includes("Exception:");
    if (isException) {
      if (currentEx) exceptions.push(currentEx);
      const typeMatch = trimmed.match(/(\w+Exception):\s*(.*)/);
      currentEx = {
        exceptionType: typeMatch?.[1] ?? "Exception",
        message: typeMatch?.[2] ?? trimmed,
        innerExceptions: [],
        stackFrames: [],
        firstOccurrence: new Date().toISOString(),
        repeatCount: 1,
      };
      continue;
    }

    if (currentEx) {
      const frameMatch = trimmed.match(/^at\s+(.*?)(?:\s+in\s+(.*?):line\s+(\d+))?$/);
      if (frameMatch) {
        currentEx.stackFrames.push({
          method: frameMatch[1],
          path: frameMatch[2],
          line: frameMatch[3] ? Number(frameMatch[3]) : undefined,
        });
      }
    }
  }

  if (currentEx) exceptions.push(currentEx);

  // Collapse repeated exceptions
  const collapsed: CsharpException[] = [];
  for (const ex of exceptions) {
    const prev = collapsed.find((e) => e.exceptionType === ex.exceptionType && e.message === ex.message);
    if (prev) {
      prev.repeatCount++;
    } else {
      collapsed.push(ex);
    }
  }

  return collapsed;
}

// ─── Input Simulation ─────────────────────────────────────────────────────

export interface GodotInputActionInput {
  workspaceId: string;
  processId: string;
  action: string;
  durationMs?: number;
}

export async function pressAction(
  input: GodotInputActionInput,
  bridgeClient: GodotEditorBridgeClient,
): Promise<{ sent: boolean }> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected for input simulation.");
  const duration = Math.min(input.durationMs ?? 100, 2000);
  await bridgeClient.sendRequest("input.press_action", { action: input.action, durationMs: duration });
  return { sent: true };
}

export async function releaseAction(
  input: { workspaceId: string; processId: string; action: string },
  bridgeClient: GodotEditorBridgeClient,
): Promise<{ sent: boolean }> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected.");
  await bridgeClient.sendRequest("input.release_action", { action: input.action });
  return { sent: true };
}

export async function mouseClick(
  input: { workspaceId: string; processId: string; x: number; y: number; button?: number },
  bridgeClient: GodotEditorBridgeClient,
): Promise<{ sent: boolean }> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected.");
  await bridgeClient.sendRequest("input.mouse_click", { x: input.x, y: input.y, button: input.button ?? 1 });
  return { sent: true };
}

// ─── Gameplay Assertions ─────────────────────────────────────────────────

export interface AssertPropertyInput {
  workspaceId: string;
  nodePath: string;
  property: string;
  comparison: "eq" | "neq" | "gt" | "lt" | "approx" | "contains" | "exists" | "changed";
  expected: unknown;
}

export async function assertNodeExists(
  input: { workspaceId: string; nodePath: string },
  bridgeClient: GodotEditorBridgeClient,
): Promise<{ passed: boolean; message: string }> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected.");
  try {
    await bridgeClient.sendRequest("remote.get_node", { nodePath: input.nodePath });
    return { passed: true, message: `Node '${input.nodePath}' exists.` };
  } catch {
    return { passed: false, message: `Node '${input.nodePath}' does not exist.` };
  }
}

export async function assertProperty(
  input: AssertPropertyInput,
  bridgeClient: GodotEditorBridgeClient,
): Promise<{ passed: boolean; actual: unknown; expected: unknown; message: string }> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected.");
  const { value } = await getRuntimeProperty({ workspaceId: input.workspaceId, nodePath: input.nodePath, property: input.property }, bridgeClient);

  let passed: boolean;
  switch (input.comparison) {
    case "eq": passed = JSON.stringify(value) === JSON.stringify(input.expected); break;
    case "neq": passed = JSON.stringify(value) !== JSON.stringify(input.expected); break;
    case "gt": passed = (value as number) > (input.expected as number); break;
    case "lt": passed = (value as number) < (input.expected as number); break;
    case "approx": passed = Math.abs((value as number) - (input.expected as number)) < 0.001; break;
    case "contains": passed = String(value).includes(String(input.expected)); break;
    case "exists": passed = value !== null && value !== undefined; break;
    default: passed = false;
  }

  return {
    passed,
    actual: value,
    expected: input.expected,
    message: passed
      ? `Property '${input.property}' assertion passed.`
      : `Expected '${input.property}' to be ${input.comparison} '${JSON.stringify(input.expected)}', got '${JSON.stringify(value)}'.`,
  };
}

// ─── Gameplay Test Sequence ───────────────────────────────────────────────

export type TestStep =
  | { type: "press_action"; action: string; durationMs?: number }
  | { type: "wait"; durationMs: number }
  | { type: "screenshot"; outputPath: string }
  | { type: "assert_property"; nodePath: string; property: string; comparison: string; expected: unknown }
  | { type: "assert_node_exists"; nodePath: string }
  | { type: "assert_no_errors" };

export interface GodotRunTestSequenceInput {
  workspaceId: string;
  processId: string;
  steps: TestStep[];
}

export async function runTestSequence(
  registry: WorkspaceRegistry,
  processManager: ProcessManager,
  input: GodotRunTestSequenceInput,
  bridgeClient: GodotEditorBridgeClient,
): Promise<{ results: Array<{ step: number; type: string; passed: boolean; message: string }> }> {
  const MAX_STEPS = 50;
  const MAX_DURATION_MS = 30000;
  const MAX_SCREENSHOTS = 5;

  if (input.steps.length > MAX_STEPS) {
    throw new Error(`Test sequence too long (max ${MAX_STEPS} steps).`);
  }

  const results: Array<{ step: number; type: string; passed: boolean; message: string }> = [];
  let totalDuration = 0;
  let screenshotCount = 0;

  for (let i = 0; i < input.steps.length; i++) {
    const step = input.steps[i];

    switch (step.type) {
      case "wait": {
        const delay = Math.min(step.durationMs, 5000);
        totalDuration += delay;
        if (totalDuration > MAX_DURATION_MS) {
          results.push({ step: i, type: step.type, passed: false, message: "Total duration limit exceeded." });
          return { results };
        }
        await new Promise((r) => setTimeout(r, delay));
        results.push({ step: i, type: step.type, passed: true, message: `Waited ${delay}ms.` });
        break;
      }
      case "press_action": {
        const r = await pressAction({ workspaceId: input.workspaceId, processId: input.processId, action: step.action, durationMs: step.durationMs }, bridgeClient).catch((err) => ({ sent: false, error: err.message }));
        results.push({ step: i, type: step.type, passed: (r as any).sent ?? false, message: `Press action '${step.action}'` });
        break;
      }
      case "screenshot": {
        if (screenshotCount >= MAX_SCREENSHOTS) {
          results.push({ step: i, type: step.type, passed: false, message: "Screenshot limit exceeded." });
          break;
        }
        screenshotCount++;
        results.push({ step: i, type: step.type, passed: true, message: `Screenshot step queued to ${step.outputPath}.` });
        break;
      }
      case "assert_node_exists": {
        const r = await assertNodeExists({ workspaceId: input.workspaceId, nodePath: step.nodePath }, bridgeClient).catch(() => ({ passed: false, message: "Bridge error" }));
        results.push({ step: i, type: step.type, passed: r.passed, message: r.message });
        break;
      }
      case "assert_property": {
        const r = await assertProperty({ workspaceId: input.workspaceId, nodePath: step.nodePath, property: step.property, comparison: step.comparison as any, expected: step.expected }, bridgeClient).catch((err) => ({ passed: false, actual: null, expected: step.expected, message: err.message }));
        results.push({ step: i, type: step.type, passed: r.passed, message: r.message });
        break;
      }
      case "assert_no_errors": {
        const logs = processManager.getProcessLogs({ workspaceId: input.workspaceId, processId: input.processId, lines: 100 });
        const hasErrors = logs.lines.some((l) => l.includes("ERROR:") || l.includes("Exception:"));
        results.push({ step: i, type: step.type, passed: !hasErrors, message: hasErrors ? "Runtime errors detected." : "No runtime errors." });
        break;
      }
      default: {
        results.push({ step: i, type: (step as any).type ?? "unknown", passed: false, message: "Unknown step type." });
      }
    }
  }

  return { results };
}

// ─── Godot Export ────────────────────────────────────────────────────────

export interface GodotExportProjectInput {
  workspaceId: string;
  projectPath: string;
  preset: string;
  outputPath: string;
  mode?: "debug" | "release";
}

export async function exportGodotProject(
  registry: WorkspaceRegistry,
  input: GodotExportProjectInput,
): Promise<{ success: boolean; outputFiles: string[]; durationMs: number; output: string }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const projectDir = registry.resolvePath(workspace, input.projectPath);
  const absoluteOutputPath = registry.resolvePath(workspace, input.outputPath);
  await mkdir(dirname(absoluteOutputPath), { recursive: true });

  const godotExe = process.env.GODOT_DOTNET_EXECUTABLE ?? process.env.GODOT_EXECUTABLE ?? "godot-mono";
  const exportFlag = (input.mode ?? "debug") === "debug" ? "--export-debug" : "--export-release";
  const args = ["--headless", "--path", projectDir, exportFlag, input.preset, absoluteOutputPath];

  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(godotExe, args, { cwd: projectDir });
    return {
      success: true,
      outputFiles: [relative(workspace.root, absoluteOutputPath).replace(/\\/g, "/")],
      durationMs: Date.now() - start,
      output: (stdout + "\n" + stderr).slice(0, 1000),
    };
  } catch (err: any) {
    return {
      success: false,
      outputFiles: [],
      durationMs: Date.now() - start,
      output: (err.stdout ?? "") + "\n" + (err.stderr ?? err.message),
    };
  }
}
