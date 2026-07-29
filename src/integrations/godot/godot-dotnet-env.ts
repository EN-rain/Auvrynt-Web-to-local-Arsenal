import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { WorkspaceRegistry } from "../../workspaces.js";

const execFileAsync = promisify(execFile);

export interface GodotDotnetEnvironmentInput {
  workspaceId: string;
  projectPath?: string;
}

export interface EnvironmentProblem {
  code: string;
  message: string;
  suggestedFix?: string;
}

export interface GodotDotnetEnvironmentResult {
  godotExecutable?: string;
  godotVersion?: string;
  godotHasDotnetSupport: boolean;
  dotnetExecutable?: string;
  dotnetSdkVersions: string[];
  selectedDotnetSdk?: string;
  projectTargetFrameworks: string[];
  architecture?: string;
  exportTemplatesInstalled?: boolean;
  status: "ready" | "incomplete" | "invalid";
  problems: EnvironmentProblem[];
}

export async function detectDotnetSdk(): Promise<{
  dotnetExecutable?: string;
  dotnetSdkVersions: string[];
  selectedDotnetSdk?: string;
  architecture?: string;
}> {
  try {
    const { stdout } = await execFileAsync("dotnet", ["--info"], { windowsHide: true });
    const sdkVersions: string[] = [];
    let architecture: string | undefined;
    for (const line of stdout.split(/\r?\n/)) {
      if (line.includes("Architecture:")) architecture = line.split(":")[1]?.trim();
      const sdkMatch = line.trim().match(/^(\d+\.\d+\.\d+)\s+\[/);
      if (sdkMatch) sdkVersions.push(sdkMatch[1]);
    }
    return {
      dotnetExecutable: "dotnet",
      dotnetSdkVersions: sdkVersions,
      selectedDotnetSdk: sdkVersions.at(-1),
      architecture: architecture ?? process.arch,
    };
  } catch {
    return { dotnetSdkVersions: [], architecture: process.arch };
  }
}

export function findGodotExecutableCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.GODOT_DOTNET_EXECUTABLE) candidates.push(process.env.GODOT_DOTNET_EXECUTABLE);
  if (process.env.GODOT_EXECUTABLE) candidates.push(process.env.GODOT_EXECUTABLE);
  candidates.push(
    "godot-mono",
    "Godot_v4.6-stable_mono_win64.exe",
    "Godot_v4.5-stable_mono_win64.exe",
    "Godot_v4.4-stable_mono_win64.exe",
    "Godot_v4.3-stable_mono_win64.exe",
    "Godot_v4.2-stable_mono_win64.exe",
    "Godot_v4.1-stable_mono_win64.exe",
    "Godot_v4.0-stable_mono_win64.exe",
    "godot",
  );

  const home = homedir();
  for (const path of [
    join(home, "scoop", "apps", "godot-mono", "current", "godot.exe"),
    join(home, "AppData", "Local", "Programs", "Godot", "godot.exe"),
    "C:\\Program Files\\Godot\\godot.exe",
  ]) {
    if (existsSync(path)) candidates.push(path);
  }
  return Array.from(new Set(candidates));
}

export async function verifyGodotExecutable(exePath: string): Promise<{
  valid: boolean;
  version?: string;
  hasDotnetSupport: boolean;
}> {
  try {
    const { stdout, stderr } = await execFileAsync(exePath, ["--version"], { windowsHide: true });
    const output = (stdout + "\n" + stderr).trim();
    const version = output.split(/\r?\n/)[0] ?? output;
    const hasDotnetSupport = version.toLowerCase().includes("mono") || output.toLowerCase().includes("mono");
    return { valid: true, version, hasDotnetSupport };
  } catch {
    return { valid: false, hasDotnetSupport: false };
  }
}

export async function inspectGodotDotnetEnvironment(
  registry: WorkspaceRegistry,
  input: GodotDotnetEnvironmentInput,
): Promise<GodotDotnetEnvironmentResult> {
  const problems: EnvironmentProblem[] = [];
  const dotnetInfo = await detectDotnetSdk();
  if (dotnetInfo.dotnetSdkVersions.length === 0) {
    problems.push({
      code: "MISSING_DOTNET_SDK",
      message: ".NET SDK was not detected or `dotnet` command failed.",
      suggestedFix: "Install a 64-bit .NET 8.0 SDK from https://dotnet.microsoft.com/download",
    });
  }

  let selectedGodotExe: string | undefined;
  let selectedGodotVersion: string | undefined;
  let godotHasDotnetSupport = false;
  for (const candidate of findGodotExecutableCandidates()) {
    const check = await verifyGodotExecutable(candidate);
    if (check.valid) {
      selectedGodotExe = candidate;
      selectedGodotVersion = check.version;
      godotHasDotnetSupport = check.hasDotnetSupport;
      if (godotHasDotnetSupport) break;
    }
  }

  if (!selectedGodotExe) {
    problems.push({
      code: "MISSING_GODOT_EXECUTABLE",
      message: "Godot executable was not found on PATH or configured locations.",
      suggestedFix: "Download Godot 4 .NET edition and set GODOT_DOTNET_EXECUTABLE environment variable.",
    });
  } else if (!godotHasDotnetSupport) {
    problems.push({
      code: "GODOT_MISSING_DOTNET_SUPPORT",
      message: `Godot executable (${selectedGodotExe}) was found, but it does not include .NET/C# support.`,
      suggestedFix: "Install or configure the Godot 4 .NET (Mono) edition.",
    });
  }

  let projectTargetFrameworks: string[] = [];
  if (input.projectPath) {
    const workspace = registry.getWorkspace(input.workspaceId);
    const targetDir = registry.resolvePath(workspace, input.projectPath);
    try {
      const { readdir, readFile } = await import("node:fs/promises");
      const files = await readdir(targetDir);
      const csproj = files.find((file) => file.endsWith(".csproj"));
      if (csproj) {
        const content = await readFile(join(targetDir, csproj), "utf8");
        const tfm = content.match(/<TargetFrameworks?>(.*?)<\/TargetFrameworks?>/i);
        if (tfm) projectTargetFrameworks = tfm[1].split(";").map((target) => target.trim());
      }
    } catch {}
  }

  let status: "ready" | "incomplete" | "invalid" = "ready";
  if (problems.some((problem) => problem.code === "MISSING_DOTNET_SDK" || problem.code === "MISSING_GODOT_EXECUTABLE")) {
    status = "invalid";
  } else if (problems.length > 0) {
    status = "incomplete";
  }

  return {
    godotExecutable: selectedGodotExe,
    godotVersion: selectedGodotVersion,
    godotHasDotnetSupport,
    dotnetExecutable: dotnetInfo.dotnetExecutable,
    dotnetSdkVersions: dotnetInfo.dotnetSdkVersions,
    selectedDotnetSdk: dotnetInfo.selectedDotnetSdk,
    projectTargetFrameworks,
    architecture: dotnetInfo.architecture,
    exportTemplatesInstalled: true,
    status,
    problems,
  };
}
