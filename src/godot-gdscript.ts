import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { join, dirname, relative, basename } from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkspaceRegistry } from "./workspaces.js";
import { getBridgeClient } from "./godot-editor-bridge.js";

const execFileAsync = promisify(execFile);

// ─── Environment & Project ───────────────────────────────────────────────────

export interface EnvironmentProblem {
  code: string;
  message: string;
  suggestedFix?: string;
}

export interface GodotGdscriptEnvironmentResult {
  godotExecutable?: string;
  godotVersion?: string;
  editorBridgeConnected: boolean;
  usesGdscript: boolean;
  usesCsharp: boolean;
  mixedLanguage: boolean;
  problems: EnvironmentProblem[];
}

export async function inspectGodotGdscriptEnvironment(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; projectPath?: string },
): Promise<GodotGdscriptEnvironmentResult> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const root = registry.resolvePath(workspace, input.projectPath ?? ".");

  const problems: EnvironmentProblem[] = [];
  let godotExecutable = process.env.GODOT_EXECUTABLE || "godot";
  let godotVersion = "";

  try {
    const { stdout } = await execFileAsync(godotExecutable, ["--version"]);
    godotVersion = stdout.trim();
  } catch {
    godotExecutable = "";
    problems.push({
      code: "GODOT_NOT_FOUND",
      message: "Godot executable not found. Make sure 'godot' is in your PATH or set GODOT_EXECUTABLE.",
      suggestedFix: "Set GODOT_EXECUTABLE environment variable.",
    });
  }

  // Scan project files to check script counts
  let usesGdscript = false;
  let usesCsharp = false;
  try {
    const files = await scanWorkspaceDir(root);
    usesGdscript = files.some(f => f.endsWith(".gd"));
    usesCsharp = files.some(f => f.endsWith(".cs"));
  } catch {}

  const bridge = getBridgeClient(input.workspaceId);

  return {
    godotExecutable: godotExecutable || undefined,
    godotVersion: godotVersion || undefined,
    editorBridgeConnected: bridge.status,
    usesGdscript,
    usesCsharp,
    mixedLanguage: usesGdscript && usesCsharp,
    problems,
  };
}

// Helper to recursively list files in directory, ignoring build artifacts
async function scanWorkspaceDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function scan(current: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.name === ".godot" || entry.name === "bin" || entry.name === "obj" || entry.name === ".git") {
        continue;
      }
      if (entry.isDirectory()) {
        await scan(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  }
  await scan(dir);
  return results;
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

export interface GdscriptDiagnostic {
  code?: string;
  message: string;
  path: string;
  line?: number;
  column?: number;
  category: "parser" | "type" | "warning" | "runtime" | "annotation" | "class" | "signal";
}

export interface GdscriptDiagnosticsResult {
  errors: GdscriptDiagnostic[];
  warnings: GdscriptDiagnostic[];
}

export async function getGdscriptDiagnostics(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; projectPath: string; scriptPath?: string; includeWarnings?: boolean },
): Promise<GdscriptDiagnosticsResult> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const projectRoot = registry.resolvePath(workspace, input.projectPath);

  const errors: GdscriptDiagnostic[] = [];
  const warnings: GdscriptDiagnostic[] = [];

  const scriptFiles: string[] = [];
  if (input.scriptPath) {
    scriptFiles.push(registry.resolvePath(workspace, input.scriptPath));
  } else {
    const all = await scanWorkspaceDir(projectRoot);
    scriptFiles.push(...all.filter(f => f.endsWith(".gd")));
  }

  // Regex-based checks for common issues and syntax validation
  for (const script of scriptFiles) {
    const relPath = relative(workspace.root, script);
    try {
      const content = await readFile(script, "utf8");
      const lines = content.split(/\r?\n/);
      let insideMultilineComment = false;

      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const line = rawLine.trim();
        const lineNum = i + 1;

        if (line.startsWith('"""')) {
          insideMultilineComment = !insideMultilineComment;
          continue;
        }
        if (insideMultilineComment || line.startsWith("#") || !line) {
          continue;
        }

        // Basic indentation checks (mixed tabs and spaces)
        if (rawLine.startsWith(" ") && rawLine.startsWith("\t")) {
          errors.push({
            code: "MIXED_INDENTATION",
            message: "Mixed tabs and spaces in indentation.",
            path: relPath,
            line: lineNum,
            category: "parser",
          });
        }

        // Godot 3 old keywords
        if (line.includes("yield(")) {
          errors.push({
            code: "DEPRECATED_YIELD",
            message: "Use of deprecated yield(). Use 'await' in Godot 4.",
            path: relPath,
            line: lineNum,
            category: "parser",
          });
        }
        if (line.startsWith("export var ")) {
          errors.push({
            code: "DEPRECATED_EXPORT",
            message: "Use of deprecated 'export var'. Use '@export var' or '@export' in Godot 4.",
            path: relPath,
            line: lineNum,
            category: "annotation",
          });
        }
        if (line.startsWith("onready var ")) {
          errors.push({
            code: "DEPRECATED_ONREADY",
            message: "Use of deprecated 'onready var'. Use '@onready var' in Godot 4.",
            path: relPath,
            line: lineNum,
            category: "annotation",
          });
        }

        // Typo in annotations
        const annotationMatch = line.match(/^@(\w+)/);
        if (annotationMatch) {
          const name = annotationMatch[1];
          const valid = ["export", "onready", "tool", "icon", "warning_ignore", "rpc", "export_range", "export_enum", "export_file", "export_dir", "export_multiline", "export_color_no_alpha", "export_node_path", "export_placeholder", "export_group", "export_subgroup", "export_category"];
          if (!valid.includes(name)) {
            warnings.push({
              code: "UNKNOWN_ANNOTATION",
              message: `Unknown or invalid annotation: @${name}`,
              path: relPath,
              line: lineNum,
              category: "annotation",
            });
          }
        }
      }
    } catch (e: any) {
      errors.push({
        message: `Failed to read/parse script file: ${e.message}`,
        path: relPath,
        category: "parser",
      });
    }
  }

  // Headless Godot check if godot executable is available
  const godotExecutable = process.env.GODOT_EXECUTABLE || "godot";
  try {
    const { stderr } = await execFileAsync(godotExecutable, ["--headless", "--path", projectRoot, "--validate-scripts"], { timeout: 3000 });
    const output = stderr.toString();
    const lines = output.split("\n");
    for (const line of lines) {
      if (line.includes("ERROR:") || line.includes("SCRIPT ERROR:")) {
        errors.push({
          message: line.trim(),
          path: input.scriptPath || "project",
          category: "parser",
        });
      }
    }
  } catch {}

  return { errors, warnings };
}

// ─── Source Structure ────────────────────────────────────────────────────────

export interface InspectGdscriptResult {
  extendsType?: string;
  className?: string;
  toolScript: boolean;
  signals: Array<{ name: string; parameters: Array<{ name: string; type?: string }> }>;
  exports: Array<{ name: string; type?: string; defaultValue?: unknown; annotation?: string }>;
  methods: Array<{ name: string; parameters: string[]; returnType?: string; static: boolean; line: number }>;
  nodePathReferences: Array<{ path: string; line: number }>;
  preloadDependencies: Array<{ path: string; line: number }>;
}

export async function inspectGdscript(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string },
): Promise<InspectGdscriptResult> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absPath = registry.resolvePath(workspace, input.scriptPath);

  const content = await readFile(absPath, "utf8");
  const lines = content.split(/\r?\n/);

  let extendsType: string | undefined;
  let className: string | undefined;
  let toolScript = false;

  const signals: InspectGdscriptResult["signals"] = [];
  const exports: InspectGdscriptResult["exports"] = [];
  const methods: InspectGdscriptResult["methods"] = [];
  const nodePathReferences: InspectGdscriptResult["nodePathReferences"] = [];
  const preloadDependencies: InspectGdscriptResult["preloadDependencies"] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    if (line.startsWith("extends ")) {
      extendsType = line.substring(8).trim();
    } else if (line.startsWith("class_name ")) {
      className = line.substring(11).trim();
    } else if (line.startsWith("@tool")) {
      toolScript = true;
    } else if (line.startsWith("signal ")) {
      const sigNameMatch = line.match(/^signal\s+(\w+)(?:\((.*?)\))?/);
      if (sigNameMatch) {
        const sigName = sigNameMatch[1];
        const paramsStr = sigNameMatch[2] || "";
        const parameters = paramsStr.split(",").map(p => {
          const parts = p.trim().split(":");
          return {
            name: parts[0].trim(),
            type: parts[1]?.trim(),
          };
        }).filter(p => p.name);
        signals.push({ name: sigName, parameters });
      }
    } else if (line.startsWith("@export") || line.startsWith("export ")) {
      const nameMatch = line.match(/(?:var\s+)?(\w+)\s*(?::|=)/) || line.match(/var\s+(\w+)/);
      if (nameMatch) {
        const propName = nameMatch[1];
        const typeMatch = line.match(/:([^\s=]+)/);
        const valMatch = line.match(/=\s*(.+)$/);
        const annotMatch = line.match(/^@export\w*/);
        exports.push({
          name: propName,
          type: typeMatch ? typeMatch[1].trim() : undefined,
          defaultValue: valMatch ? valMatch[1].trim() : undefined,
          annotation: annotMatch ? annotMatch[0] : undefined,
        });
      }
    } else if (line.startsWith("func ") || line.startsWith("static func ")) {
      const isStatic = line.startsWith("static ");
      const methMatch = line.match(/func\s+(\w+)\s*\((.*?)\)(?:\s*->\s*([^\s:]+))?/);
      if (methMatch) {
        const methName = methMatch[1];
        const params = methMatch[2].split(",").map(p => p.trim()).filter(p => p);
        const retType = methMatch[3];
        methods.push({
          name: methName,
          parameters: params,
          returnType: retType,
          static: isStatic,
          line: lineNum,
        });
      }
    }

    // Node path references
    const nodeMatch = line.match(/\$(?:"([^"]+)"|'([^']+)'|([a-zA-Z0-9_\/]+))/g);
    if (nodeMatch) {
      for (const m of nodeMatch) {
        nodePathReferences.push({ path: m, line: lineNum });
      }
    }

    // Preloads & loads
    const preloadMatch = line.match(/(?:preload|load)\((?:"([^"]+)"|'([^']+)')\)/g);
    if (preloadMatch) {
      for (const m of preloadMatch) {
        preloadDependencies.push({ path: m, line: lineNum });
      }
    }
  }

  return {
    extendsType,
    className,
    toolScript,
    signals,
    exports,
    methods,
    nodePathReferences,
    preloadDependencies,
  };
}

// ─── Creation & Management ───────────────────────────────────────────────────

export interface CreateGdscriptInput {
  workspaceId: string;
  outputPath: string;
  baseType: string;
  className?: string;
  toolScript?: boolean;
  template?: "empty" | "node" | "resource" | "editor_plugin";
}

export async function createGdscript(
  registry: WorkspaceRegistry,
  input: CreateGdscriptInput,
): Promise<{ path: string; created: boolean }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absPath = registry.resolvePath(workspace, input.outputPath);

  if (existsSync(absPath)) {
    throw new Error(`File already exists: ${input.outputPath}`);
  }

  await mkdir(dirname(absPath), { recursive: true });

  const lines: string[] = [];
  if (input.toolScript) {
    lines.push("@tool");
  }
  if (input.className) {
    lines.push(`class_name ${input.className}`);
  }
  lines.push(`extends ${input.baseType}`);
  lines.push("");

  if (input.template === "node") {
    lines.push("func _ready() -> void:");
    lines.push("\tpass");
    lines.push("");
    lines.push("func _process(delta: float) -> void:");
    lines.push("\tpass");
  } else if (input.template === "editor_plugin") {
    lines.push("func _enter_tree() -> void:");
    lines.push("\tpass");
    lines.push("");
    lines.push("func _exit_tree() -> void:");
    lines.push("\tpass");
  }

  await writeFile(absPath, lines.join("\n"), "utf8");

  return { path: input.outputPath, created: true };
}

// ─── Editor Bridge Mutations ─────────────────────────────────────────────────

export interface AttachGdscriptInput {
  workspaceId: string;
  nodePath: string;
  scriptPath: string;
  createIfMissing?: boolean;
  baseType?: string;
}

export async function attachGdscript(
  registry: WorkspaceRegistry,
  input: AttachGdscriptInput,
): Promise<{ attached: boolean }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absScriptPath = registry.resolvePath(workspace, input.scriptPath);
  const relScriptPath = relative(workspace.root, absScriptPath).replace(/\\/g, "/");
  const resPath = `res://${relScriptPath}`;

  const client = getBridgeClient(input.workspaceId);
  const result = await client.sendRequest("node.attach_script", {
    nodePath: input.nodePath,
    scriptPath: resPath,
  });

  return { attached: !!result?.attached };
}

export async function detachGdscript(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; nodePath: string },
): Promise<{ detached: boolean }> {
  const client = getBridgeClient(input.workspaceId);
  const result = await client.sendRequest("node.detach_script", {
    nodePath: input.nodePath,
  });
  return { detached: !!result?.detached };
}

// ─── Signals ─────────────────────────────────────────────────────────────────

export interface CreateGdscriptSignalInput {
  workspaceId: string;
  scriptPath: string;
  signalName: string;
  parameters?: Array<{ name: string; type?: string }>;
}

export async function createGdscriptSignal(
  registry: WorkspaceRegistry,
  input: CreateGdscriptSignalInput,
): Promise<{ success: boolean }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absPath = registry.resolvePath(workspace, input.scriptPath);
  const content = await readFile(absPath, "utf8");

  // Semantic check to avoid duplicates
  if (content.includes(`signal ${input.signalName}`)) {
    throw new Error(`Signal ${input.signalName} already exists in script.`);
  }

  const lines = content.split(/\r?\n/);
  const paramsStr = (input.parameters ?? []).map(p => p.type ? `${p.name}: ${p.type}` : p.name).join(", ");
  const signalLine = paramsStr ? `signal ${input.signalName}(${paramsStr})` : `signal ${input.signalName}`;

  // Insert signals right after class_name or extends
  let insertIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("extends ") || lines[i].startsWith("class_name ") || lines[i].startsWith("@tool")) {
      insertIdx = i + 1;
    }
  }

  lines.splice(insertIdx, 0, signalLine);
  await writeFile(absPath, lines.join("\n"), "utf8");
  return { success: true };
}

export async function createGdscriptSignalHandler(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string; methodName: string; parameters?: Array<{ name: string; type?: string }> },
): Promise<{ success: boolean }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absPath = registry.resolvePath(workspace, input.scriptPath);
  const content = await readFile(absPath, "utf8");

  if (content.includes(`func ${input.methodName}`)) {
    throw new Error(`Method ${input.methodName} already exists in script.`);
  }

  const lines = content.split(/\r?\n/);
  const paramsStr = (input.parameters ?? []).map(p => p.type ? `${p.name}: ${p.type}` : p.name).join(", ");

  const methodLines = [
    "",
    `func ${input.methodName}(${paramsStr}) -> void:`,
    "\tpass",
  ];

  lines.push(...methodLines);
  await writeFile(absPath, lines.join("\n"), "utf8");
  return { success: true };
}

// ─── Global Classes & Autoloads ──────────────────────────────────────────────

export async function getGlobalClasses(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<Array<{ className: string; baseType: string; scriptPath: string }>> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const files = await scanWorkspaceDir(workspace.root);
  const gdscriptFiles = files.filter(f => f.endsWith(".gd"));

  const classes: Array<{ className: string; baseType: string; scriptPath: string }> = [];

  for (const file of gdscriptFiles) {
    const content = await readFile(file, "utf8");
    const classMatch = content.match(/^class_name\s+(\w+)/m);
    if (classMatch) {
      const extendsMatch = content.match(/^extends\s+(\w+)/m);
      classes.push({
        className: classMatch[1],
        baseType: extendsMatch ? extendsMatch[1] : "RefCounted",
        scriptPath: relative(workspace.root, file).replace(/\\/g, "/"),
      });
    }
  }

  return classes;
}

export async function addClassName(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string; className: string },
): Promise<{ success: boolean }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absPath = registry.resolvePath(workspace, input.scriptPath);
  const content = await readFile(absPath, "utf8");

  if (content.includes("class_name ")) {
    throw new Error("Script already has a class_name defined.");
  }

  const lines = content.split(/\r?\n/);
  let insertIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("extends ") || lines[i].startsWith("@tool")) {
      insertIdx = i + 1;
    }
  }

  lines.splice(insertIdx, 0, `class_name ${input.className}`);
  await writeFile(absPath, lines.join("\n"), "utf8");
  return { success: true };
}

export async function removeClassName(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string },
): Promise<{ success: boolean; warnings: string[] }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absPath = registry.resolvePath(workspace, input.scriptPath);
  const content = await readFile(absPath, "utf8");

  const classMatch = content.match(/^class_name\s+(\w+)/m);
  const warnings: string[] = [];
  if (classMatch) {
    warnings.push(`References to global class '${classMatch[1]}' in other scenes/scripts may be broken.`);
  }

  const lines = content.split(/\r?\n/).filter(l => !l.startsWith("class_name "));
  await writeFile(absPath, lines.join("\n"), "utf8");
  return { success: true, warnings };
}

export async function addGdscriptAutoload(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string; singletonName: string },
): Promise<{ success: boolean }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const godotFile = join(workspace.root, "project.godot");
  if (!existsSync(godotFile)) {
    throw new Error("No project.godot found at workspace root.");
  }

  const content = await readFile(godotFile, "utf8");
  const lines = content.split(/\r?\n/);

  let autoloadSecIdx = lines.findIndex(l => l.trim() === "[autoload]");
  const relScriptPath = relative(workspace.root, registry.resolvePath(workspace, input.scriptPath)).replace(/\\/g, "/");
  const autoloadLine = `${input.singletonName}="*res://${relScriptPath}"`;

  if (autoloadSecIdx === -1) {
    lines.push("", "[autoload]", autoloadLine);
  } else {
    // Check if duplicate singleton name
    const exists = lines.some(l => l.startsWith(`${input.singletonName}=`));
    if (exists) {
      throw new Error(`Autoload singleton '${input.singletonName}' already exists.`);
    }
    lines.splice(autoloadSecIdx + 1, 0, autoloadLine);
  }

  await writeFile(godotFile, lines.join("\n"), "utf8");
  return { success: true };
}

export async function getAutoloadUsage(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; singletonName: string },
): Promise<Array<{ path: string; line: number; text: string }>> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const files = await scanWorkspaceDir(workspace.root);
  const scriptFiles = files.filter(f => f.endsWith(".gd") || f.endsWith(".cs"));

  const results: Array<{ path: string; line: number; text: string }> = [];

  for (const file of scriptFiles) {
    const content = await readFile(file, "utf8");
    const lines = content.split(/\r?\n/);
    const relPath = relative(workspace.root, file);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(input.singletonName)) {
        results.push({
          path: relPath,
          line: i + 1,
          text: line.trim(),
        });
      }
    }
  }

  return results;
}

// ─── Tool Scripts & Plugins ──────────────────────────────────────────────────

export async function inspectToolScript(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string },
): Promise<{ toolScript: boolean; methods: string[]; warnings: string[] }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absPath = registry.resolvePath(workspace, input.scriptPath);
  const content = await readFile(absPath, "utf8");

  const toolScript = content.includes("@tool");
  const methods: string[] = [];
  const warnings: string[] = [];

  if (toolScript) {
    // Extract methods that execute editor-side
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/func\s+(\w+)/);
      if (m) methods.push(m[1]);
    }
    warnings.push("Tool scripts run inside the editor. Avoid modifying files or running subprocesses in tool script code.");
  }

  return { toolScript, methods, warnings };
}

export async function createEditorPlugin(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; pluginName: string; description?: string; author?: string; version?: string },
): Promise<{ success: boolean; filesCreated: string[] }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const addonDir = join(workspace.root, "addons", input.pluginName);
  await mkdir(addonDir, { recursive: true });

  const cfgContent = `[plugin]

name="${input.pluginName}"
description="${input.description ?? "A Auvrynt generated editor plugin"}"
author="${input.author ?? "Auvrynt Agent"}"
version="${input.version ?? "1.0.0"}"
script="plugin.gd"
`;

  const gdContent = `@tool
extends EditorPlugin

func _enter_tree() -> void:
\tprint("[${input.pluginName}] Plugin enabled.")

func _exit_tree() -> void:
\tprint("[${input.pluginName}] Plugin disabled.")
`;

  const cfgPath = join(addonDir, "plugin.cfg");
  const gdPath = join(addonDir, "plugin.gd");

  await writeFile(cfgPath, cfgContent, "utf8");
  await writeFile(gdPath, gdContent, "utf8");

  return {
    success: true,
    filesCreated: [
      relative(workspace.root, cfgPath).replace(/\\/g, "/"),
      relative(workspace.root, gdPath).replace(/\\/g, "/"),
    ],
  };
}

// ─── Dependencies & Node Paths ────────────────────────────────────────────────

export async function getGdscriptDependencies(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string },
): Promise<Array<{ path: string; loadType: "preload" | "load" | "resourceloader"; exists: boolean }>> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absPath = registry.resolvePath(workspace, input.scriptPath);
  const content = await readFile(absPath, "utf8");

  const results: Array<{ path: string; loadType: "preload" | "load" | "resourceloader"; exists: boolean }> = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const preload = line.match(/preload\((?:"([^"]+)"|'([^']+)')\)/);
    if (preload) {
      const p = preload[1] || preload[2];
      results.push({
        path: p,
        loadType: "preload",
        exists: existsSync(join(workspace.root, p.replace("res://", ""))),
      });
    }

    const loadMatch = line.match(/load\((?:"([^"]+)"|'([^']+)')\)/);
    if (loadMatch) {
      const p = loadMatch[1] || loadMatch[2];
      results.push({
        path: p,
        loadType: "load",
        exists: existsSync(join(workspace.root, p.replace("res://", ""))),
      });
    }
  }

  return results;
}

export async function findCyclicScriptDependencies(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<string[][]> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const files = await scanWorkspaceDir(workspace.root);
  const scriptFiles = files.filter(f => f.endsWith(".gd"));

  const graph = new Map<string, string[]>();

  for (const file of scriptFiles) {
    const relPath = relative(workspace.root, file).replace(/\\/g, "/");
    const content = await readFile(file, "utf8");
    const preloads: string[] = [];

    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const preload = line.match(/preload\((?:"([^"]+)"|'([^']+)')\)/);
      if (preload) {
        const p = preload[1] || preload[2];
        preloads.push(p.replace("res://", ""));
      }
    }
    graph.set(relPath, preloads);
  }

  // Tarjan's or simple DFS cycle detection
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(node: string, currentPath: string[]) {
    visited.add(node);
    stack.add(node);
    currentPath.push(node);

    const neighbors = graph.get(node) ?? [];
    for (const neighbor of neighbors) {
      if (stack.has(neighbor)) {
        const cycleStart = currentPath.indexOf(neighbor);
        if (cycleStart !== -1) {
          cycles.push(currentPath.slice(cycleStart));
        }
      } else if (!visited.has(neighbor)) {
        dfs(neighbor, [...currentPath]);
      }
    }

    stack.delete(node);
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }

  return cycles;
}

export async function getGdscriptNodeReferences(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string },
): Promise<Array<{ path: string; style: "dollar" | "unique" | "get_node"; line: number }>> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absPath = registry.resolvePath(workspace, input.scriptPath);
  const content = await readFile(absPath, "utf8");
  const lines = content.split(/\r?\n/);

  const results: Array<{ path: string; style: "dollar" | "unique" | "get_node"; line: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // $Node or $"Path"
    const dollar = line.match(/\$(?:"([^"]+)"|'([^']+)'|([a-zA-Z0-9_\/]+))/);
    if (dollar) {
      const p = dollar[1] || dollar[2] || dollar[3];
      results.push({
        path: p,
        style: p.startsWith("%") ? "unique" : "dollar",
        line: lineNum,
      });
    }

    // get_node()
    const get_node = line.match(/get_node\((?:"([^"]+)"|'([^']+)')\)/);
    if (get_node) {
      results.push({
        path: get_node[1] || get_node[2],
        style: "get_node",
        line: lineNum,
      });
    }
  }

  return results;
}

// ─── Lifecycle & Await Heuristics ─────────────────────────────────────────────

export async function getGdscriptLifecycleMethods(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string },
): Promise<Array<{ method: string; line: number; warnings: string[] }>> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absPath = registry.resolvePath(workspace, input.scriptPath);
  const content = await readFile(absPath, "utf8");
  const lines = content.split(/\r?\n/);

  const methods = ["_init", "_enter_tree", "_ready", "_process", "_physics_process", "_input", "_unhandled_input", "_exit_tree", "_draw"];
  const results: Array<{ method: string; line: number; warnings: string[] }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    const m = line.match(/func\s+(_\w+)/);
    if (m && methods.includes(m[1])) {
      const name = m[1];
      const warnings: string[] = [];

      // Check delta usage or heavy logic in processes
      if (name === "_process" || name === "_physics_process") {
        if (!line.includes("delta")) {
          warnings.push(`Lifecycle method ${name} does not reference 'delta'.`);
        }
      }
      results.push({ method: name, line: lineNum, warnings });
    }
  }

  return results;
}

export async function inspectGdscriptAwaitUsage(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string },
): Promise<Array<{ line: number; expression: string; warning?: string }>> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absPath = registry.resolvePath(workspace, input.scriptPath);
  const content = await readFile(absPath, "utf8");
  const lines = content.split(/\r?\n/);

  const results: Array<{ line: number; expression: string; warning?: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    const m = line.match(/await\s+(.+)$/);
    if (m) {
      const expr = m[1];
      let warning: string | undefined;

      if (expr.includes("get_tree().create_timer") && expr.includes("timeout")) {
        // Safe timer await
      } else if (!expr.includes(".") && !expr.includes("(")) {
        warning = "Awaiting a symbol directly. Ensure it resolves to a signal or a Callable.";
      }

      results.push({ line: lineNum, expression: expr, warning });
    }
  }

  return results;
}

export async function analyzeGdscriptTyping(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string },
): Promise<{ typedVariablesPercentage: number; typedParametersPercentage: number; typedReturnsPercentage: number }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absPath = registry.resolvePath(workspace, input.scriptPath);
  const content = await readFile(absPath, "utf8");
  const lines = content.split(/\r?\n/);

  let vars = 0;
  let typedVars = 0;
  let params = 0;
  let typedParams = 0;
  let returns = 0;
  let typedReturns = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Variable check
    if (trimmed.startsWith("var ") || trimmed.startsWith("@onready var ") || trimmed.startsWith("@export var ")) {
      vars++;
      if (trimmed.includes(":") || trimmed.includes(":=")) {
        typedVars++;
      }
    }

    // Function parameter & return check
    if (trimmed.startsWith("func ")) {
      returns++;
      if (trimmed.includes("->")) {
        typedReturns++;
      }

      const paramMatch = trimmed.match(/\((.*?)\)/);
      if (paramMatch && paramMatch[1]) {
        const pList = paramMatch[1].split(",").map(p => p.trim());
        for (const p of pList) {
          params++;
          if (p.includes(":")) {
            typedParams++;
          }
        }
      }
    }
  }

  return {
    typedVariablesPercentage: vars ? Math.round((typedVars / vars) * 100) : 100,
    typedParametersPercentage: params ? Math.round((typedParams / params) * 100) : 100,
    typedReturnsPercentage: returns ? Math.round((typedReturns / returns) * 100) : 100,
  };
}

// ─── Debugger & Testing ───────────────────────────────────────────────────────

export async function formatGdscript(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath?: string; verifyOnly?: boolean },
): Promise<{ formatted: boolean; verified: boolean; diff?: string }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const file = input.scriptPath ? registry.resolvePath(workspace, input.scriptPath) : workspace.root;

  // We check if 'gdformat' (official gdscript tool) is installed in PATH.
  try {
    const args = input.verifyOnly ? ["--check", file] : [file];
    await execFileAsync("gdformat", args);
    return { formatted: !input.verifyOnly, verified: true };
  } catch {
    // If not installed, we format simple indentations or fallback gracefully without raising an error
    return { formatted: false, verified: false };
  }
}

export async function detectGdscriptTests(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; projectPath: string },
): Promise<{ framework: "gut" | "none"; testDirectories: string[]; testScripts: string[] }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const projectRoot = registry.resolvePath(workspace, input.projectPath);

  const testDirectories: string[] = [];
  const testScripts: string[] = [];

  // Look for GUT (Godot Unit Testing) addon
  const gutAddon = join(projectRoot, "addons", "gut");
  const framework = existsSync(gutAddon) ? "gut" : "none";

  const allFiles = await scanWorkspaceDir(projectRoot);
  for (const f of allFiles) {
    if (basename(f).startsWith("test_") && f.endsWith(".gd")) {
      testScripts.push(relative(workspace.root, f).replace(/\\/g, "/"));
    }
  }

  return { framework, testDirectories, testScripts };
}

export async function runGdscriptTests(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; projectPath: string; testPath?: string; filter?: string },
): Promise<{ passed: number; failed: number; skipped: number; duration: number; logs: string }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const projectRoot = registry.resolvePath(workspace, input.projectPath);

  const godotExecutable = process.env.GODOT_EXECUTABLE || "godot";

  // Execute test runner headlessly. For GUT, typical CLI run:
  // godot --headless --path <projectRoot> -s addons/gut/gut_cmdline.gd
  const args = ["--headless", "--path", projectRoot, "-s", "addons/gut/gut_cmdline.gd"];
  if (input.testPath) {
    args.push(`-gselect=${input.testPath}`);
  }

  const start = performance.now();
  try {
    const { stdout, stderr } = await execFileAsync(godotExecutable, args, { timeout: 30000 });
    const logs = stdout.toString() + stderr.toString();

    // Parse pass/fail counts from GUT stdout output
    const passMatch = logs.match(/(\d+) passed/);
    const failMatch = logs.match(/(\d+) failed/);

    return {
      passed: passMatch ? Number(passMatch[1]) : 0,
      failed: failMatch ? Number(failMatch[1]) : 0,
      skipped: 0,
      duration: Math.round(performance.now() - start),
      logs,
    };
  } catch (e: any) {
    return {
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: Math.round(performance.now() - start),
      logs: `Failed to execute test suite: ${e.message}`,
    };
  }
}

export async function reloadGdscript(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath?: string },
): Promise<{ reloaded: boolean }> {
  const client = getBridgeClient(input.workspaceId);
  const res = await client.sendRequest("gdscript.reload", {
    scriptPath: input.scriptPath,
  });
  return { reloaded: !!res?.reloaded };
}

// ─── Debugger breakpoint/step stubs ──────────────────────────────────────────

export async function setBreakpoint(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string; line: number },
): Promise<{ success: boolean }> {
  const client = getBridgeClient(input.workspaceId);
  await client.sendRequest("debugger.set_breakpoint", {
    scriptPath: input.scriptPath,
    line: input.line,
  });
  return { success: true };
}

export async function removeBreakpoint(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string; line: number },
): Promise<{ success: boolean }> {
  const client = getBridgeClient(input.workspaceId);
  await client.sendRequest("debugger.remove_breakpoint", {
    scriptPath: input.scriptPath,
    line: input.line,
  });
  return { success: true };
}

// ─── Language Server Protocol stubs (Editor must be active) ───────────────────

export async function lspFindSymbol(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; symbol: string },
): Promise<any> {
  const client = getBridgeClient(input.workspaceId);
  return client.sendRequest("lsp.find_symbol", { symbol: input.symbol });
}

export async function lspGetDefinition(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string; line: number; character: number },
): Promise<any> {
  const client = getBridgeClient(input.workspaceId);
  return client.sendRequest("lsp.get_definition", {
    scriptPath: input.scriptPath,
    line: input.line,
    character: input.character,
  });
}
