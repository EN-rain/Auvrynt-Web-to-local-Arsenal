import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname } from "node:path";
import type { WorkspaceRegistry } from "./workspaces.js";
import { parseDotnetBuildOutput, type DotnetDiagnostic } from "./dotnet-tools.js";
import { inspectGodotDotnetProject } from "./godot-csharp-project.js";

const execFileAsync = promisify(execFile);

export interface GodotDotnetBuildInput {
  workspaceId: string;
  projectPath: string;
  configuration?: "Debug" | "Release";
  noRestore?: boolean;
  treatWarningsAsErrors?: boolean;
}

export interface GodotDotnetCleanInput {
  workspaceId: string;
  projectPath: string;
  configuration?: "Debug" | "Release";
}

export interface GodotBuildDiagnostic {
  source: "csharp" | "msbuild" | "nuget" | "godot";
  code?: string;
  message: string;
  path?: string;
  line?: number;
  column?: number;
}

export function parseGodotBuildDiagnostics(output: string): {
  success: boolean;
  errors: GodotBuildDiagnostic[];
  warnings: GodotBuildDiagnostic[];
} {
  const base = parseDotnetBuildOutput(output);

  const mapDiag = (d: DotnetDiagnostic): GodotBuildDiagnostic => {
    let source: "csharp" | "msbuild" | "nuget" | "godot" = "csharp";
    if (d.code?.startsWith("CS")) source = "csharp";
    else if (d.code?.startsWith("MSB")) source = "msbuild";
    else if (d.code?.startsWith("NU")) source = "nuget";
    else if (d.message.toLowerCase().includes("godot")) source = "godot";

    return {
      source,
      code: d.code,
      message: d.message,
      path: d.path,
      line: d.line,
      column: d.column,
    };
  };

  return {
    success: base.success,
    errors: base.errors.map(mapDiag),
    warnings: base.warnings.map(mapDiag),
  };
}

export async function godotDotnetBuild(
  registry: WorkspaceRegistry,
  input: GodotDotnetBuildInput,
): Promise<{
  success: boolean;
  configuration: string;
  targetFrameworks: string[];
  outputAssemblies: string[];
  errors: GodotBuildDiagnostic[];
  warnings: GodotBuildDiagnostic[];
  durationMs: number;
}> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const targetDir = registry.resolvePath(workspace, input.projectPath);

  const details = await inspectGodotDotnetProject(registry, { workspaceId: input.workspaceId, projectPath: input.projectPath });
  const buildTarget = details.slnPath ? registry.resolvePath(workspace, details.slnPath) : (details.csprojPath ? registry.resolvePath(workspace, details.csprojPath) : targetDir);

  const config = input.configuration ?? "Debug";
  const args = ["build", buildTarget, "-c", config];
  if (input.noRestore) args.push("--no-restore");

  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync("dotnet", args, { cwd: dirname(buildTarget) });
    const fullOutput = stdout + "\n" + stderr;
    const parsed = parseGodotBuildDiagnostics(fullOutput);

    return {
      success: parsed.success,
      configuration: config,
      targetFrameworks: details.targetFrameworks,
      outputAssemblies: details.assemblyName ? [`${details.assemblyName}.dll`] : [],
      errors: parsed.errors,
      warnings: parsed.warnings,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    const fullOutput = (err.stdout ?? "") + "\n" + (err.stderr ?? err.message);
    const parsed = parseGodotBuildDiagnostics(fullOutput);

    return {
      success: false,
      configuration: config,
      targetFrameworks: details.targetFrameworks,
      outputAssemblies: [],
      errors: parsed.errors.length > 0 ? parsed.errors : [{ source: "csharp", message: err.message }],
      warnings: parsed.warnings,
      durationMs: Date.now() - start,
    };
  }
}

export async function godotDotnetClean(
  registry: WorkspaceRegistry,
  input: GodotDotnetCleanInput,
): Promise<{ success: boolean; durationMs: number; output: string }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const targetDir = registry.resolvePath(workspace, input.projectPath);

  const config = input.configuration ?? "Debug";
  const args = ["clean", targetDir, "-c", config];

  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync("dotnet", args, { cwd: targetDir });
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
