import { readdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, relative } from "node:path";
import type { WorkspaceRegistry } from "../../workspaces.js";
import { parseGodotProjectFile } from "./godot-tools.js";

const execFileAsync = promisify(execFile);

export interface InspectGodotDotnetProjectInput {
  workspaceId: string;
  projectPath?: string;
}

export interface GodotBuildSolutionsInput {
  workspaceId: string;
  projectPath: string;
}

export interface GodotDotnetRestoreInput {
  workspaceId: string;
  projectPath: string;
  lockedMode?: boolean;
}

export interface GodotDotnetProjectDetails {
  projectGodotPath: string;
  name: string;
  mainScene: string;
  renderer: string;
  godotVersionFeatures: string[];
  csprojPath?: string;
  slnPath?: string;
  targetFrameworks: string[];
  godotNetSdkVersion?: string;
  packageReferences: string[];
  projectReferences: string[];
  nullable: string;
  implicitUsings: string;
  rootNamespace?: string;
  assemblyName?: string;
  autoloads: Record<string, string>;
  inputActions: string[];
  csharpScriptCount: number;
  gdscriptCount: number;
  isMixedLanguage: boolean;
  requiresSolutionRegeneration: boolean;
}

export async function inspectGodotDotnetProject(
  registry: WorkspaceRegistry,
  input: InspectGodotDotnetProjectInput,
): Promise<GodotDotnetProjectDetails> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const targetDir = input.projectPath
    ? registry.resolvePath(workspace, input.projectPath)
    : workspace.root;
  const projectGodotPath = join(targetDir, "project.godot");

  let projectGodotContent = "";
  try {
    projectGodotContent = await readFile(projectGodotPath, "utf8");
  } catch {
    throw new Error(`project.godot not found in directory: ${input.projectPath ?? "."}`);
  }

  const parsedGodot = parseGodotProjectFile(projectGodotContent);
  let csharpScriptCount = 0;
  let gdscriptCount = 0;
  let csprojFile: string | undefined;
  let slnFile: string | undefined;

  async function scanDir(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if ([".godot", "bin", "obj", "node_modules", ".git"].includes(entry.name)) continue;
        await scanDir(join(dir, entry.name));
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".cs")) csharpScriptCount++;
        else if (entry.name.endsWith(".gd")) gdscriptCount++;
        else if (entry.name.endsWith(".csproj")) csprojFile = join(dir, entry.name);
        else if (entry.name.endsWith(".sln")) slnFile = join(dir, entry.name);
      }
    }
  }

  await scanDir(targetDir);

  let targetFrameworks: string[] = [];
  let godotNetSdkVersion: string | undefined;
  const packageReferences: string[] = [];
  const projectReferences: string[] = [];
  const nullable = "enable";
  const implicitUsings = "enable";
  let rootNamespace: string | undefined;
  let assemblyName: string | undefined;

  if (csprojFile) {
    try {
      const xml = await readFile(csprojFile, "utf8");
      const tfmMatch = xml.match(/<TargetFrameworks?>(.*?)<\/TargetFrameworks?>/i);
      if (tfmMatch) targetFrameworks = tfmMatch[1].split(";").map((t) => t.trim());
      const sdkMatch = xml.match(/Godot\.NET\.Sdk\/([0-9.]+)/i);
      if (sdkMatch) godotNetSdkVersion = sdkMatch[1];
      const nsMatch = xml.match(/<RootNamespace>(.*?)<\/RootNamespace>/i);
      if (nsMatch) rootNamespace = nsMatch[1].trim();
      const asmMatch = xml.match(/<AssemblyName>(.*?)<\/AssemblyName>/i);
      if (asmMatch) assemblyName = asmMatch[1].trim();
      const pkgRegex = /<PackageReference\s+Include="([^"]+)"/g;
      let match;
      while ((match = pkgRegex.exec(xml)) !== null) packageReferences.push(match[1]);
    } catch {}
  }

  const isMixedLanguage = csharpScriptCount > 0 && gdscriptCount > 0;
  const requiresSolutionRegeneration = !slnFile || !csprojFile;

  return {
    projectGodotPath: relative(workspace.root, projectGodotPath).replace(/\\/g, "/"),
    name: parsedGodot.name,
    mainScene: parsedGodot.mainScene,
    renderer: parsedGodot.renderer,
    godotVersionFeatures: parsedGodot.features,
    csprojPath: csprojFile ? relative(workspace.root, csprojFile).replace(/\\/g, "/") : undefined,
    slnPath: slnFile ? relative(workspace.root, slnFile).replace(/\\/g, "/") : undefined,
    targetFrameworks,
    godotNetSdkVersion,
    packageReferences,
    projectReferences,
    nullable,
    implicitUsings,
    rootNamespace,
    assemblyName,
    autoloads: parsedGodot.autoloads,
    inputActions: parsedGodot.inputActions,
    csharpScriptCount,
    gdscriptCount,
    isMixedLanguage,
    requiresSolutionRegeneration,
  };
}

export async function godotBuildSolutions(
  registry: WorkspaceRegistry,
  input: GodotBuildSolutionsInput,
): Promise<{
  success: boolean;
  durationMs: number;
  generatedSln?: string;
  generatedCsproj?: string;
  output: string;
}> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const targetDir = registry.resolvePath(workspace, input.projectPath);
  const godotExe = process.env.GODOT_DOTNET_EXECUTABLE ?? process.env.GODOT_EXECUTABLE ?? "godot-mono";
  const args = ["--headless", "--path", targetDir, "--build-solutions", "--quit"];
  const start = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(godotExe, args, { cwd: targetDir, windowsHide: true });
    const details = await inspectGodotDotnetProject(registry, { workspaceId: input.workspaceId, projectPath: input.projectPath });
    return {
      success: true,
      durationMs: Date.now() - start,
      generatedSln: details.slnPath,
      generatedCsproj: details.csprojPath,
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

export async function godotDotnetRestore(
  registry: WorkspaceRegistry,
  input: GodotDotnetRestoreInput,
): Promise<{ success: boolean; durationMs: number; output: string }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const targetDir = registry.resolvePath(workspace, input.projectPath);
  const args = ["restore", targetDir];
  if (input.lockedMode) args.push("--locked-mode");
  const start = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync("dotnet", args, { cwd: targetDir, windowsHide: true });
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
