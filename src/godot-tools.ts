import { readFile, readdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, relative } from "node:path";
import type { WorkspaceRegistry } from "./workspaces.js";
import type { ProcessManager } from "./processes.js";

const execFileAsync = promisify(execFile);

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
  if (featureMatch) {
    features.push(...featureMatch[1].split(",").map((f) => f.replace(/"/g, "").trim()));
  }

  // Parse [autoload] section
  const autoloadSection = content.match(/\[autoload\]([\s\S]*?)(?=\n\[|$)/);
  if (autoloadSection) {
    const lines = autoloadSection[1].split("\n");
    for (const line of lines) {
      const kv = line.match(/^(\w+)="([^"]+)"/);
      if (kv) autoloads[kv[1]] = kv[2];
    }
  }

  // Parse [input] section
  const inputSection = content.match(/\[input\]([\s\S]*?)(?=\n\[|$)/);
  if (inputSection) {
    const lines = inputSection[1].split("\n");
    for (const line of lines) {
      const kv = line.match(/^(\w+)=\{/);
      if (kv) inputActions.push(kv[1]);
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

  const lines = content.split(/\r?\n/);
  let currentElement: { type: "node" | "ext_resource" | "connection"; data: any } | null = null;

  for (const line of lines) {
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
        signals.push({
          signal: signalMatch[1],
          from: fromMatch[1],
          to: toMatch[1],
          method: methodMatch[1],
        });
      }
    } else if (currentElement?.type === "node" && trimmed.includes("=")) {
      const eqIdx = trimmed.indexOf("=");
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim();
      currentElement.data.properties[k] = v;
    }
  }

  const rootNode = nodes.find((n) => !n.parent)?.name;
  return { rootNode, nodes, externalResources, signals };
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
  const targetDir = input.path
    ? registry.resolvePath(workspace, input.path)
    : workspace.root;

  const projectGodotPath = join(targetDir, "project.godot");

  let content = "";
  try {
    content = await readFile(projectGodotPath, "utf8");
  } catch {
    return {
      projectPath: input.path ?? ".",
      godotProjectFound: false,
      hasCSharp: false,
    };
  }

  const parsed = parseGodotProjectFile(content);

  let dirFiles: string[] = [];
  try {
    dirFiles = await readdir(targetDir);
  } catch {}

  const hasCSharp = dirFiles.some((f) => f.endsWith(".csproj") || f.endsWith(".sln"));

  return {
    projectPath: input.path ?? ".",
    godotProjectFound: true,
    ...parsed,
    hasCSharp,
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

  if (input.scenePath) {
    const absScene = registry.resolvePath(workspace, input.scenePath);
    args.push(`"${absScene}"`);
  }
  if (input.editor) args.push("-e");
  if (input.debug) args.push("-d");
  if (input.additionalArguments) args.push(...input.additionalArguments);

  const command = `${godotBin} ${args.join(" ")}`;

  const result = processManager.startProcess({
    workspaceId: input.workspaceId,
    command,
    workingDirectory: projectDir,
  });

  return {
    processId: result.processId,
    status: result.status,
    detectedUrls: result.detectedUrls,
  };
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

  if (input.scenePath.endsWith(".scn")) {
    throw new Error("Binary .scn scenes are not supported. Use text .tscn format.");
  }

  const content = await readFile(absolutePath, "utf8");
  const parsed = parseGodotScene(content);

  const nodeTypes = Array.from(new Set(parsed.nodes.map((n) => n.type)));

  return {
    scenePath: input.scenePath,
    rootNode: parsed.rootNode,
    nodeCount: parsed.nodes.length,
    nodeTypes,
    nodes: parsed.nodes,
    externalResources: parsed.externalResources,
    signals: parsed.signals,
  };
}
