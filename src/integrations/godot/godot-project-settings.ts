import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { WorkspaceRegistry } from "../../workspaces.js";

export interface GodotSetProjectSettingInput {
  workspaceId: string;
  projectPath: string;
  settingKey: string;
  value: unknown;
}

export interface GodotAddInputActionInput {
  workspaceId: string;
  projectPath: string;
  actionName: string;
  events?: Array<{
    type: "key" | "mouse_button" | "joypad_button" | "joypad_axis";
    keycode?: number;
    physicalKeycode?: number;
    button?: number;
    axis?: number;
    axisValue?: number;
    deadzone?: number;
  }>;
}

export interface GodotAutoloadInput {
  workspaceId: string;
  projectPath: string;
  autoloadName: string;
  path?: string;
}

export async function getProjectSettings(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; projectPath: string },
): Promise<Record<string, string>> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const godotFile = join(registry.resolvePath(workspace, input.projectPath), "project.godot");
  const content = await readFile(godotFile, "utf8");
  const settings: Record<string, string> = {};
  let currentSection = "";

  for (const line of content.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\[(\w+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }
    const keyValueMatch = line.match(/^(\S+)\s*=\s*(.+)$/);
    if (keyValueMatch) {
      const key = currentSection ? `${currentSection}/${keyValueMatch[1]}` : keyValueMatch[1];
      settings[key] = keyValueMatch[2].trim();
    }
  }
  return settings;
}

export async function setProjectSetting(
  registry: WorkspaceRegistry,
  input: GodotSetProjectSettingInput,
): Promise<{ previousValue?: string; newValue: string }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const godotFile = join(registry.resolvePath(workspace, input.projectPath), "project.godot");
  let content = await readFile(godotFile, "utf8");
  const newValue = JSON.stringify(input.value);
  const [section, ...keyRest] = input.settingKey.split("/");
  const key = keyRest.join("/");
  const keyRegex = new RegExp(`^(${key}\\s*=\\s*)(.+)$`, "m");
  const previousValue = keyRegex.exec(content)?.[2];

  if (keyRegex.test(content)) {
    content = content.replace(keyRegex, `$1${newValue}`);
  } else {
    const sectionRegex = new RegExp(`\\[${section}\\]`, "m");
    content = sectionRegex.test(content)
      ? content.replace(sectionRegex, `[${section}]\n${key}=${newValue}`)
      : `${content}\n[${section}]\n${key}=${newValue}\n`;
  }

  await writeFile(godotFile, content, "utf8");
  return { previousValue, newValue };
}

export async function getInputMap(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; projectPath: string },
): Promise<Record<string, unknown[]>> {
  const inputActions: Record<string, unknown[]> = {};
  for (const [key, value] of Object.entries(await getProjectSettings(registry, input))) {
    if (key.startsWith("input/")) inputActions[key.replace("input/", "")] = [value];
  }
  return inputActions;
}

export async function getAutoloads(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; projectPath: string },
): Promise<Record<string, string>> {
  const autoloads: Record<string, string> = {};
  for (const [key, value] of Object.entries(await getProjectSettings(registry, input))) {
    if (key.startsWith("autoload/")) autoloads[key.replace("autoload/", "")] = value;
  }
  return autoloads;
}

export interface GodotGetTextureImportSettingsInput {
  workspaceId: string;
  texturePath: string;
}

export interface GodotSetTextureImportSettingsInput {
  workspaceId: string;
  texturePath: string;
  settings: {
    filterMode?: "nearest" | "linear" | "linear_mipmap";
    mipmaps?: boolean;
    compression?: "lossless" | "lossy" | "vram_compressed";
    repeat?: boolean;
    fixAlphaBorder?: boolean;
  };
}

export async function applyPixelArtImportPreset(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; paths: string[] },
): Promise<{ changed: string[]; errors: string[] }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const changed: string[] = [];
  const errors: string[] = [];

  for (const texturePath of input.paths) {
    try {
      const importPath = registry.resolvePath(workspace, texturePath) + ".import";
      let importContent: string;
      try {
        importContent = await readFile(importPath, "utf8");
      } catch {
        importContent = `[remap]\n\nimporter="texture"\n`;
      }

      for (const [key, value] of [
        ["process/fix_alpha_border", "false"],
        ["process/premult_alpha", "false"],
        ["compress/mode", "0"],
        ["compress/high_quality", "false"],
        ["flags/repeat", "0"],
        ["flags/filter", "false"],
        ["flags/mipmaps", "false"],
        ["flags/anisotropic", "false"],
        ["flags/srgb", "2"],
      ]) {
        const keyRegex = new RegExp(`^(${key}\\s*=\\s*)(.*)$`, "m");
        if (keyRegex.test(importContent)) importContent = importContent.replace(keyRegex, `$1${value}`);
      }

      await writeFile(importPath, importContent, "utf8");
      changed.push(texturePath);
    } catch (error) {
      errors.push(`${texturePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { changed, errors };
}

export async function generateVscodeConfig(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; projectPath: string; godotExecutable?: string },
): Promise<{ generated: string[]; skipped: string[] }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const targetDir = registry.resolvePath(workspace, input.projectPath);
  const vscodeDir = join(targetDir, ".vscode");
  await mkdir(vscodeDir, { recursive: true });
  const generated: string[] = [];
  const skipped: string[] = [];
  const godotExe = input.godotExecutable ?? "${env:GODOT_DOTNET_EXECUTABLE}";

  const tasksPath = join(vscodeDir, "tasks.json");
  let tasksContent: any = { version: "2.0.0", tasks: [] };
  try {
    tasksContent = JSON.parse(await readFile(tasksPath, "utf8"));
  } catch {}

  const godotTasks = [
    { label: "Godot: Build C#", type: "shell", command: "dotnet build", args: ["${workspaceFolder}"], group: "build" },
    { label: "Godot: Restore NuGet", type: "shell", command: "dotnet restore", args: ["${workspaceFolder}"] },
    { label: "Godot: Run Project", type: "shell", command: godotExe, args: ["--path", "${workspaceFolder}", "-d"] },
    { label: "Godot: Headless Validate", type: "shell", command: godotExe, args: ["--headless", "--path", "${workspaceFolder}", "--editor", "--quit"] },
  ];
  const existingLabels = new Set((tasksContent.tasks ?? []).map((task: any) => task.label));
  for (const task of godotTasks) {
    if (!existingLabels.has(task.label)) tasksContent.tasks.push(task);
  }
  await writeFile(tasksPath, JSON.stringify(tasksContent, null, 2), "utf8");
  generated.push(relative(workspace.root, tasksPath).replace(/\\/g, "/"));

  const launchPath = join(vscodeDir, "launch.json");
  let launchContent: any = { version: "0.2.0", configurations: [] };
  try {
    launchContent = JSON.parse(await readFile(launchPath, "utf8"));
  } catch {}
  const existingNames = new Set((launchContent.configurations ?? []).map((configuration: any) => configuration.name));
  if (!existingNames.has("Godot C# Debug")) {
    launchContent.configurations.push({
      name: "Godot C# Debug",
      type: "coreclr",
      request: "attach",
      processId: "${command:pickProcess}",
      program: "${workspaceFolder}/bin/Debug/net8.0/${workspaceFolderBasename}.dll",
    });
    await writeFile(launchPath, JSON.stringify(launchContent, null, 2), "utf8");
    generated.push(relative(workspace.root, launchPath).replace(/\\/g, "/"));
  } else {
    skipped.push(relative(workspace.root, launchPath).replace(/\\/g, "/"));
  }

  return { generated, skipped };
}

export interface GodotListExportPresetsInput {
  workspaceId: string;
  projectPath: string;
}

export async function listExportPresets(
  registry: WorkspaceRegistry,
  input: GodotListExportPresetsInput,
): Promise<Array<{ name: string; platform: string; mode: string }>> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const presetFile = join(registry.resolvePath(workspace, input.projectPath), "export_presets.cfg");
  let content: string;
  try {
    content = await readFile(presetFile, "utf8");
  } catch {
    return [];
  }

  const presets: Array<{ name: string; platform: string; mode: string }> = [];
  let currentPreset: { name: string; platform: string; mode: string } | null = null;
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith("[preset.")) {
      if (currentPreset) presets.push(currentPreset);
      currentPreset = { name: "", platform: "", mode: "release" };
    } else if (currentPreset) {
      if (line.startsWith("name=")) currentPreset.name = line.replace(/^name=/, "").replace(/"/g, "").trim();
      else if (line.startsWith("platform=")) currentPreset.platform = line.replace(/^platform=/, "").replace(/"/g, "").trim();
      else if (line.startsWith("export_debug=")) currentPreset.mode = line.includes("true") ? "debug" : "release";
    }
  }
  if (currentPreset) presets.push(currentPreset);
  return presets;
}
