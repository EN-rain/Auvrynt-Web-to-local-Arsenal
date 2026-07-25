import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { WorkspaceRegistry } from "./workspaces.js";

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
    const { stdout } = await execFileAsync("dotnet", ["--info"]);
    const lines = stdout.split(/\r?\n/);

    const sdkVersions: string[] = [];
    let selectedSdk: string | undefined;
    let arch: string | undefined;

    for (const line of lines) {
      if (line.includes("Architecture:")) {
        const parts = line.split(":");
        if (parts[1]) arch = parts[1].trim();
      }
      const sdkMatch = line.trim().match(/^(\d+\.\d+\.\d+)\s+\[/);
      if (sdkMatch) {
        sdkVersions.push(sdkMatch[1]);
      }
    }

    if (sdkVersions.length > 0) {
      selectedSdk = sdkVersions[sdkVersions.length - 1];
    }

    return {
      dotnetExecutable: "dotnet",
      dotnetSdkVersions: sdkVersions,
      selectedDotnetSdk: selectedSdk,
      architecture: arch ?? process.arch,
    };
  } catch {
    return {
      dotnetSdkVersions: [],
      architecture: process.arch,
    };
  }
}

export function findGodotExecutableCandidates(): string[] {
  const candidates: string[] = [];

  if (process.env.GODOT_DOTNET_EXECUTABLE) {
    candidates.push(process.env.GODOT_DOTNET_EXECUTABLE);
  }
  if (process.env.GODOT_EXECUTABLE) {
    candidates.push(process.env.GODOT_EXECUTABLE);
  }

  const commonNames = [
    "godot-mono",
    "Godot_v4.3-stable_mono_win64.exe",
    "Godot_v4.2-stable_mono_win64.exe",
    "Godot_v4.1-stable_mono_win64.exe",
    "Godot_v4.0-stable_mono_win64.exe",
    "Godot_v4.4_mono_win64.exe",
    "godot",
  ];

  candidates.push(...commonNames);

  // Common Windows paths (Scoop, Chocolatey, User apps)
  const home = homedir();
  const windowsPaths = [
    join(home, "scoop", "apps", "godot-mono", "current", "godot.exe"),
    join(home, "AppData", "Local", "Programs", "Godot", "godot.exe"),
    "C:\\Program Files\\Godot\\godot.exe",
  ];

  for (const p of windowsPaths) {
    if (existsSync(p)) candidates.push(p);
  }

  return Array.from(new Set(candidates));
}

export async function verifyGodotExecutable(exePath: string): Promise<{
  valid: boolean;
  version?: string;
  hasDotnetSupport: boolean;
}> {
  try {
    const { stdout, stderr } = await execFileAsync(exePath, ["--version"]);
    const output = (stdout + "\n" + stderr).trim();

    const version = output.split(/\r?\n/)[0] ?? output;
    // Godot .NET edition versions contain ".mono" or "mono" in the version string
    const hasDotnetSupport = version.toLowerCase().includes("mono") || output.toLowerCase().includes("mono");

    return {
      valid: true,
      version,
      hasDotnetSupport,
    };
  } catch {
    return {
      valid: false,
      hasDotnetSupport: false,
    };
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

  const candidateExes = findGodotExecutableCandidates();
  let selectedGodotExe: string | undefined;
  let selectedGodotVersion: string | undefined;
  let godotHasDotnetSupport = false;

  for (const candidate of candidateExes) {
    const check = await verifyGodotExecutable(candidate);
    if (check.valid) {
      selectedGodotExe = candidate;
      selectedGodotVersion = check.version;
      godotHasDotnetSupport = check.hasDotnetSupport;
      if (godotHasDotnetSupport) break; // Found proper .NET edition
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
    // Check if project contains .csproj
    try {
      const { readdir, readFile } = await import("node:fs/promises");
      const files = await readdir(targetDir);
      const csproj = files.find((f) => f.endsWith(".csproj"));
      if (csproj) {
        const content = await readFile(join(targetDir, csproj), "utf8");
        const tfm = content.match(/<TargetFrameworks?>(.*?)<\/TargetFrameworks?>/i);
        if (tfm) projectTargetFrameworks = tfm[1].split(";").map((t) => t.trim());
      }
    } catch {}
  }

  let status: "ready" | "incomplete" | "invalid" = "ready";
  if (problems.some((p) => p.code === "MISSING_DOTNET_SDK" || p.code === "MISSING_GODOT_EXECUTABLE")) {
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
