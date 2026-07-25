import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import type { WorkspaceRegistry } from "./workspaces.js";

// ─── Project Settings, Input Map, Autoloads ─────────────────────────────────

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
  const lines = content.split(/\r?\n/);
  let currentSection = "";

  for (const line of lines) {
    const sectionMatch = line.match(/^\[(\w+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }
    const kvMatch = line.match(/^(\S+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = currentSection ? `${currentSection}/${kvMatch[1]}` : kvMatch[1];
      settings[key] = kvMatch[2].trim();
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

  const newValueStr = JSON.stringify(input.value);
  const keyParts = input.settingKey.split("/");
  const [section, ...keyRest] = keyParts;
  const key = keyRest.join("/");

  const keyRegex = new RegExp(`^(${key}\\s*=\\s*)(.+)$`, "m");
  const prev = keyRegex.exec(content)?.[2];

  if (keyRegex.test(content)) {
    content = content.replace(keyRegex, `$1${newValueStr}`);
  } else {
    const sectionRegex = new RegExp(`\\[${section}\\]`, "m");
    if (sectionRegex.test(content)) {
      content = content.replace(sectionRegex, `[${section}]\n${key}=${newValueStr}`);
    } else {
      content += `\n[${section}]\n${key}=${newValueStr}\n`;
    }
  }

  await writeFile(godotFile, content, "utf8");
  return { previousValue: prev, newValue: newValueStr };
}

export async function getInputMap(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; projectPath: string },
): Promise<Record<string, unknown[]>> {
  const settings = await getProjectSettings(registry, input);
  const inputActions: Record<string, unknown[]> = {};

  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith("input/")) {
      const actionName = key.replace("input/", "");
      inputActions[actionName] = [value];
    }
  }

  return inputActions;
}

export async function getAutoloads(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; projectPath: string },
): Promise<Record<string, string>> {
  const settings = await getProjectSettings(registry, input);
  const autoloads: Record<string, string> = {};

  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith("autoload/")) {
      const name = key.replace("autoload/", "");
      autoloads[name] = value;
    }
  }

  return autoloads;
}

// ─── Pixel Art Import Presets ────────────────────────────────────────────────

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
      const absPath = registry.resolvePath(workspace, texturePath);
      const importPath = absPath + ".import";

      let importContent: string;
      try {
        importContent = await readFile(importPath, "utf8");
      } catch {
        // Create a minimal .import file
        importContent = `[remap]\n\nimporter="texture"\n`;
      }

      // Apply pixel art import settings
      const pixelArtSettings = [
        ["process/fix_alpha_border", "false"],
        ["process/premult_alpha", "false"],
        ["compress/mode", "0"],  // Lossless
        ["compress/high_quality", "false"],
        ["flags/repeat", "0"],
        ["flags/filter", "false"],  // nearest neighbour
        ["flags/mipmaps", "false"],
        ["flags/anisotropic", "false"],
        ["flags/srgb", "2"],
      ];

      for (const [key, val] of pixelArtSettings) {
        const keyRegex = new RegExp(`^(${key}\\s*=\\s*)(.*)$`, "m");
        if (keyRegex.test(importContent)) {
          importContent = importContent.replace(keyRegex, `$1${val}`);
        }
      }

      await writeFile(importPath, importContent, "utf8");
      changed.push(texturePath);
    } catch (err) {
      errors.push(`${texturePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { changed, errors };
}

// ─── VS Code Configuration Generator ────────────────────────────────────────

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

  // tasks.json
  const tasksPath = join(vscodeDir, "tasks.json");
  let tasksContent: any = { version: "2.0.0", tasks: [] };
  try {
    tasksContent = JSON.parse(await readFile(tasksPath, "utf8"));
  } catch {}

  const godotTasks = [
    {
      label: "Godot: Build C#",
      type: "shell",
      command: "dotnet build",
      args: ["${workspaceFolder}"],
      group: "build",
    },
    {
      label: "Godot: Restore NuGet",
      type: "shell",
      command: "dotnet restore",
      args: ["${workspaceFolder}"],
    },
    {
      label: "Godot: Run Project",
      type: "shell",
      command: godotExe,
      args: ["--path", "${workspaceFolder}", "-d"],
    },
    {
      label: "Godot: Headless Validate",
      type: "shell",
      command: godotExe,
      args: ["--headless", "--path", "${workspaceFolder}", "--editor", "--quit"],
    },
  ];

  const existingLabels = new Set((tasksContent.tasks ?? []).map((t: any) => t.label));
  for (const task of godotTasks) {
    if (!existingLabels.has(task.label)) {
      tasksContent.tasks.push(task);
    }
  }

  await writeFile(tasksPath, JSON.stringify(tasksContent, null, 2), "utf8");
  generated.push(relative(workspace.root, tasksPath).replace(/\\/g, "/"));

  // launch.json
  const launchPath = join(vscodeDir, "launch.json");
  let launchContent: any = { version: "0.2.0", configurations: [] };
  try {
    launchContent = JSON.parse(await readFile(launchPath, "utf8"));
  } catch {}

  const existingNames = new Set((launchContent.configurations ?? []).map((c: any) => c.name));
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

// ─── Export Preset support ───────────────────────────────────────────────────

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
  const lines = content.split(/\r?\n/);
  let currentPreset: any = null;

  for (const line of lines) {
    if (line.startsWith("[preset.")) {
      if (currentPreset) presets.push(currentPreset);
      currentPreset = { name: "", platform: "", mode: "release" };
    } else if (currentPreset) {
      if (line.startsWith("name=")) {
        currentPreset.name = line.replace(/^name=/, "").replace(/"/g, "").trim();
      } else if (line.startsWith("platform=")) {
        currentPreset.platform = line.replace(/^platform=/, "").replace(/"/g, "").trim();
      } else if (line.startsWith("export_debug=")) {
        currentPreset.mode = line.includes("true") ? "debug" : "release";
      }
    }
  }

  if (currentPreset) presets.push(currentPreset);
  return presets;
}
