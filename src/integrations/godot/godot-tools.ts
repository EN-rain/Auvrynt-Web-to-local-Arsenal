import { readFile, readdir } from "node:fs/promises";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { WorkspaceRegistry } from "../../workspaces.js";
import type { ProcessManager } from "../../processes.js";

export interface DetectGodotProjectInput {
  workspaceId: string;
  path?: string;
}

export interface GodotCheckInput {
  workspaceId: string;
  projectPath: string;
}

export interface GodotRunInput {
  workspaceId: string;
  projectPath: string;
  scenePath?: string;
  editor?: boolean;
  debug?: boolean;
  additionalArguments?: string[];
}

export interface GodotGetLogsInput {
  workspaceId: string;
  processId: string;
  severity?: Array<"error" | "warning" | "info">;
  lines?: number;
}

export interface GodotExportInput {
  workspaceId: string;
  projectPath: string;
  preset: string;
  outputPath: string;
  mode?: "debug" | "release";
}

export interface InspectGodotSceneInput {
  workspaceId: string;
  scenePath: string;
}

export interface GodotSceneNode {
  name: string;
  type: string;
  parent?: string;
  script?: string;
  properties: Record<string, string>;
}

export function parseGodotProjectFile(content: string): {
  configVersion: number;
  name: string;
  mainScene: string;
  renderer: string;
  features: string[];
  autoloads: Record<string, string>;
  inputActions: string[];
} {
  let configVersion = 5;
  let name = "Godot Project";
  let mainScene = "";
  let renderer = "Forward+";
  const features: string[] = [];
  const autoloads: Record<string, string> = {};
  const inputActions: string[] = [];

  const nameMatch = content.match(/config\/name="([^"]+)"/);
  if (nameMatch) name = nameMatch[1];
  const sceneMatch = content.match(/run\/main_scene="([^"]+)"/);
  if (sceneMatch) mainScene = sceneMatch[1];
  const versionMatch = content.match(/config_version=(\d+)/);
  if (versionMatch) configVersion = Number(versionMatch[1]);
  const rendererMatch = content.match(/rendering\/renderer\/rendering_method="([^"]+)"/);
  if (rendererMatch) renderer = rendererMatch[1];
  const featureMatch = content.match(/config\/features=PackedStringArray\((.*?)\)/);
  if (featureMatch) features.push(...featureMatch[1].split(",").map((feature) => feature.replace(/"/g, "").trim()));

  const autoloadSection = content.match(/\[autoload\]([\s\S]*?)(?=\n\[|$)/);
  if (autoloadSection) {
    for (const line of autoloadSection[1].split("\n")) {
      const keyValue = line.match(/^(\w+)="([^"]+)"/);
      if (keyValue) autoloads[keyValue[1]] = keyValue[2];
    }
  }

  const inputSection = content.match(/\[input\]([\s\S]*?)(?=\n\[|$)/);
  if (inputSection) {
    for (const line of inputSection[1].split("\n")) {
      const keyValue = line.match(/^(\w+)=\{/);
      if (keyValue) inputActions.push(keyValue[1]);
    }
  }

  return { configVersion, name, mainScene, renderer, features, autoloads, inputActions };
}

export function parseGodotScene(content: string): {
  rootNode?: string;
  nodes: GodotSceneNode[];
  externalResources: Array<{ id: string; type: string; path: string }>;
  signals: Array<{ signal: string; from: string; to: string; method: string }>;
} {
  const nodes: GodotSceneNode[] = [];
  const externalResources: Array<{ id: string; type: string; path: string }> = [];
  const signals: Array<{ signal: string; from: string; to: string; method: string }> = [];
  let currentElement: { type: "node" | "ext_resource" | "connection"; data: any } | null = null;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[ext_resource")) {
      const idMatch = trimmed.match(/id="([^"]+)"/);
      const typeMatch = trimmed.match(/type="([^"]+)"/);
      const pathMatch = trimmed.match(/path="([^"]+)"/);
      if (idMatch && typeMatch && pathMatch) {
        externalResources.push({ id: idMatch[1], type: typeMatch[1], path: pathMatch[1] });
      }
    } else if (trimmed.startsWith("[node")) {
      const nameMatch = trimmed.match(/name="([^"]+)"/);
      const typeMatch = trimmed.match(/type="([^"]+)"/);
      const parentMatch = trimmed.match(/parent="([^"]+)"/);
      if (nameMatch) {
        const node: GodotSceneNode = {
          name: nameMatch[1],
          type: typeMatch ? typeMatch[1] : "Node",
          parent: parentMatch ? parentMatch[1] : undefined,
          properties: {},
        };
        nodes.push(node);
        currentElement = { type: "node", data: node };
      }
    } else if (trimmed.startsWith("[connection")) {
      const signalMatch = trimmed.match(/signal="([^"]+)"/);
      const fromMatch = trimmed.match(/from="([^"]+)"/);
      const toMatch = trimmed.match(/to="([^"]+)"/);
      const methodMatch = trimmed.match(/method="([^"]+)"/);
      if (signalMatch && fromMatch && toMatch && methodMatch) {
        signals.push({ signal: signalMatch[1], from: fromMatch[1], to: toMatch[1], method: methodMatch[1] });
      }
    } else if (currentElement?.type === "node" && trimmed.includes("=")) {
      const equalsIndex = trimmed.indexOf("=");
      currentElement.data.properties[trimmed.slice(0, equalsIndex).trim()] = trimmed.slice(equalsIndex + 1).trim();
    }
  }

  return { rootNode: nodes.find((node) => !node.parent)?.name, nodes, externalResources, signals };
}

export async function detectGodotProject(
  registry: WorkspaceRegistry,
  input: DetectGodotProjectInput,
): Promise<{
  projectPath: string;
  godotProjectFound: boolean;
  name?: string;
  mainScene?: string;
  renderer?: string;
  features?: string[];
  hasCSharp: boolean;
  autoloads?: Record<string, string>;
  inputActions?: string[];
}> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const targetDir = input.path ? registry.resolvePath(workspace, input.path) : workspace.root;
  let content = "";
  try {
    content = await readFile(join(targetDir, "project.godot"), "utf8");
  } catch {
    return { projectPath: input.path ?? ".", godotProjectFound: false, hasCSharp: false };
  }

  let directoryFiles: string[] = [];
  try {
    directoryFiles = await readdir(targetDir);
  } catch {}

  return {
    projectPath: input.path ?? ".",
    godotProjectFound: true,
    ...parseGodotProjectFile(content),
    hasCSharp: directoryFiles.some((file) => file.endsWith(".csproj") || file.endsWith(".sln")),
  };
}

export async function godotRun(
  registry: WorkspaceRegistry,
  processManager: ProcessManager,
  input: GodotRunInput,
): Promise<{ processId: string; status: string; detectedUrls: string[] }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const projectDir = registry.resolvePath(workspace, input.projectPath);
  const godotBin = process.env.GODOT_EXECUTABLE ?? "godot";
  const args = ["--path", `"${projectDir}"`];
  if (input.scenePath) args.push(`"${registry.resolvePath(workspace, input.scenePath)}"`);
  if (input.editor) args.push("-e");
  if (input.debug) args.push("-d");
  if (input.additionalArguments) args.push(...input.additionalArguments);

  const result = processManager.startProcess({
    workspaceId: input.workspaceId,
    command: `${godotBin} ${args.join(" ")}`,
    workingDirectory: projectDir,
  });
  return { processId: result.processId, status: result.status, detectedUrls: result.detectedUrls };
}

export async function inspectGodotScene(
  registry: WorkspaceRegistry,
  input: InspectGodotSceneInput,
): Promise<{
  scenePath: string;
  rootNode?: string;
  nodeCount: number;
  nodeTypes: string[];
  nodes: GodotSceneNode[];
  externalResources: Array<{ id: string; type: string; path: string }>;
  signals: Array<{ signal: string; from: string; to: string; method: string }>;
}> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absolutePath = registry.resolvePath(workspace, input.scenePath);
  if (input.scenePath.endsWith(".scn")) throw new Error("Binary .scn scenes are not supported. Use text .tscn format.");
  const parsed = parseGodotScene(await readFile(absolutePath, "utf8"));
  return {
    scenePath: input.scenePath,
    rootNode: parsed.rootNode,
    nodeCount: parsed.nodes.length,
    nodeTypes: Array.from(new Set(parsed.nodes.map((node) => node.type))),
    nodes: parsed.nodes,
    externalResources: parsed.externalResources,
    signals: parsed.signals,
  };
}

function globalGodotPluginTarget(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "Godot", "editor_plugins", "auvrynt_bridge");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Godot", "editor_plugins", "auvrynt_bridge");
  }
  return join(homedir(), ".config", "godot", "editor_plugins", "auvrynt_bridge");
}

function globalGodotPluginSource(): string | undefined {
  const candidateSourceDirs: string[] = [];
  try {
    const currentFile = fileURLToPath(import.meta.url);
    candidateSourceDirs.push(join(dirname(currentFile), "..", "..", "..", "addons", "auvrynt_bridge"));
  } catch {
    // Fall through to the development checkout candidate.
  }
  candidateSourceDirs.push(join(process.cwd(), "addons", "auvrynt_bridge"));
  return candidateSourceDirs.find((candidate) =>
    existsSync(join(candidate, "plugin.cfg")) && existsSync(join(candidate, "auvrynt_bridge.gd"))
  );
}

export function getGlobalGodotPluginStatus(): { installed: boolean; targetPath: string } {
  const targetPath = globalGodotPluginTarget();
  return {
    targetPath,
    installed: existsSync(join(targetPath, "plugin.cfg")) && existsSync(join(targetPath, "auvrynt_bridge.gd")),
  };
}

export function ensureGlobalGodotPlugin(): { installed: boolean; targetPath: string } {
  const targetPath = globalGodotPluginTarget();
  const sourceDir = globalGodotPluginSource();
  if (!sourceDir) return { installed: false, targetPath };

  try {
    mkdirSync(targetPath, { recursive: true });
    cpSync(sourceDir, targetPath, { recursive: true, force: true });
    return getGlobalGodotPluginStatus();
  } catch {
    return { installed: false, targetPath };
  }
}
