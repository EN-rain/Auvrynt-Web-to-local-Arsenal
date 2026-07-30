import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkspaceRegistry } from "../../workspaces.js";
import { godotDotnetBuild, type GodotBuildDiagnostic } from "./godot-csharp-build.js";
import { parseStructuredRuntimeLogs, type StructuredRuntimeLogEntry } from "./godot-csharp-runner.js";

const execFileAsync = promisify(execFile);

export interface GodotValidateProjectInput {
  workspaceId: string;
  projectPath: string;
  buildCsharpFirst?: boolean;
}

export interface GodotImportAssetsInput {
  workspaceId: string;
  projectPath: string;
}

export interface GodotReimportAssetInput {
  workspaceId: string;
  assetPath: string;
}

export async function godotValidateProject(
  registry: WorkspaceRegistry,
  input: GodotValidateProjectInput,
): Promise<{
  status: "valid" | "invalid" | "warnings";
  csharpDiagnostics?: {
    success: boolean;
    errors: GodotBuildDiagnostic[];
    warnings: GodotBuildDiagnostic[];
  };
  godotDiagnostics: StructuredRuntimeLogEntry[];
  missingResources: string[];
  failedImports: string[];
  durationMs: number;
}> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const targetDir = registry.resolvePath(workspace, input.projectPath);
  const start = Date.now();
  let csharpDiagnostics: any = undefined;

  if (input.buildCsharpFirst ?? true) {
    csharpDiagnostics = await godotDotnetBuild(registry, {
      workspaceId: input.workspaceId,
      projectPath: input.projectPath,
    });
  }

  const godotExe = process.env.GODOT_DOTNET_EXECUTABLE ?? process.env.GODOT_EXECUTABLE ?? "godot-mono";
  const args = ["--headless", "--path", targetDir, "--editor", "--quit"];

  let rawLogs: string[] = [];
  try {
    const { stdout, stderr } = await execFileAsync(godotExe, args, { cwd: targetDir, windowsHide: true });
    rawLogs = (stdout + "\n" + stderr).split(/\r?\n/);
  } catch (err: any) {
    rawLogs = ((err.stdout ?? "") + "\n" + (err.stderr ?? err.message)).split(/\r?\n/);
  }

  const godotDiagnostics = parseStructuredRuntimeLogs(rawLogs);
  const missingResources: string[] = [];
  const failedImports: string[] = [];

  for (const entry of godotDiagnostics) {
    if (entry.message.includes("Resource not found") || entry.message.includes("Failed loading resource")) {
      missingResources.push(entry.message);
    }
    if (entry.message.includes("Import error") || entry.message.includes("Failed to import")) {
      failedImports.push(entry.message);
    }
  }

  const hasErrors = (csharpDiagnostics && !csharpDiagnostics.success) || godotDiagnostics.some((d) => d.severity === "error");
  const hasWarnings = godotDiagnostics.some((d) => d.severity === "warning");
  const status = hasErrors ? "invalid" : (hasWarnings ? "warnings" : "valid");

  return {
    status,
    csharpDiagnostics,
    godotDiagnostics,
    missingResources,
    failedImports,
    durationMs: Date.now() - start,
  };
}

export async function godotImportAssets(
  registry: WorkspaceRegistry,
  input: GodotImportAssetsInput,
): Promise<{ success: boolean; durationMs: number; output: string }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const targetDir = registry.resolvePath(workspace, input.projectPath);
  const godotExe = process.env.GODOT_DOTNET_EXECUTABLE ?? process.env.GODOT_EXECUTABLE ?? "godot-mono";
  const args = ["--headless", "--path", targetDir, "--editor", "--quit"];

  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(godotExe, args, { cwd: targetDir, windowsHide: true });
    return {
      success: true,
      durationMs: Date.now() - start,
      output: (stdout + "\n" + stderr).slice(0, 1000),
    };
  } catch (err: any) {
    return {
      success: false,
      durationMs: Date.now() - start,
      output: (err.stdout ?? "") + "\n" + (err.stderr ?? err.message),
    };
  }
}
