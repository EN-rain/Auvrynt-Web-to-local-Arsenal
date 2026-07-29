import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { WorkspaceRegistry } from "../../workspaces.js";

export interface GodotFindCsharpClassInput {
  workspaceId: string;
  className: string;
}

export interface GodotGetCsharpDiagnosticsInput {
  workspaceId: string;
  projectPath: string;
}

export interface CsharpClassInfo {
  className: string;
  filePath: string;
  line?: number;
  baseClass?: string;
  isPartial: boolean;
  implementedInterfaces: string[];
  namespace?: string;
  exportedProperties: ExportedProperty[];
  signals: CsharpSignal[];
  lifecycleOverrides: string[];
}

export interface ExportedProperty {
  propertyName: string;
  inspectorDisplayName: string;
  type: string;
  exportAttribute: string;
  defaultValue?: string;
  isNullable: boolean;
}

export interface CsharpSignal {
  name: string;
  parameters: string[];
  declaration: string;
}

export interface CsharpReference {
  filePath: string;
  line: number;
  column: number;
  snippet: string;
}

export async function findCsharpClasses(
  registry: WorkspaceRegistry,
  input: GodotFindCsharpClassInput,
): Promise<CsharpClassInfo[]> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const results: CsharpClassInfo[] = [];

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
      } else if (entry.name.endsWith(".cs")) {
        const filePath = join(dir, entry.name);
        const content = await readFile(filePath, "utf8").catch(() => "");
        const info = parseCsharpFile(content, relative(workspace.root, filePath).replace(/\\/g, "/"));
        for (const cls of info) {
          if (cls.className === input.className) results.push(cls);
        }
      }
    }
  }

  await scanDir(workspace.root);
  return results;
}

export function parseCsharpFile(content: string, filePath: string): CsharpClassInfo[] {
  const classes: CsharpClassInfo[] = [];
  let namespace: string | undefined;
  const nsMatch = content.match(/^namespace\s+([\w.]+)/m);
  if (nsMatch) namespace = nsMatch[1];

  const classRegex = /^(?:\[[\w,=\s"'.()[\]]*\]\s*)*\s*(public|internal|private|protected)?\s*(static|sealed|abstract)?\s*(partial\s+)?class\s+(\w+)(?:\s*:\s*([\w<>, ]+))?/gm;
  let match;
  while ((match = classRegex.exec(content)) !== null) {
    const inheritance = (match[5] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    classes.push({
      className: match[4],
      filePath,
      line: content.slice(0, match.index).split("\n").length,
      baseClass: inheritance[0] ?? undefined,
      isPartial: !!match[3],
      implementedInterfaces: inheritance.slice(1),
      namespace,
      exportedProperties: extractExportedProperties(content),
      signals: extractCsharpSignals(content),
      lifecycleOverrides: extractLifecycleOverrides(content),
    });
  }

  return classes;
}

function extractExportedProperties(content: string): ExportedProperty[] {
  const properties: ExportedProperty[] = [];
  const exportRegex = /\[Export(?:Group|Subgroup|Category)?\(?"?(.*?)"?\)?\]\s+(?:public\s+)([\w?<>[\]]+)\s+(\w+)/g;
  let match;
  while ((match = exportRegex.exec(content)) !== null) {
    properties.push({
      propertyName: match[3],
      inspectorDisplayName: match[3].replace(/([A-Z])/g, " $1").trim(),
      type: match[2],
      exportAttribute: match[0].split("]")[0] + "]",
      isNullable: match[2].endsWith("?"),
    });
  }
  return properties;
}

function extractCsharpSignals(content: string): CsharpSignal[] {
  const signals: CsharpSignal[] = [];
  const delegateRegex = /\[Signal\]\s+public\s+delegate\s+void\s+(\w+)\((.*?)\)/g;
  let match;
  while ((match = delegateRegex.exec(content)) !== null) {
    const name = match[1].replace(/EventHandler$/, "");
    const parameters = match[2] ? match[2].split(",").map((value) => value.trim()) : [];
    signals.push({ name, parameters, declaration: match[0] });
  }
  return signals;
}

function extractLifecycleOverrides(content: string): string[] {
  const lifecycles = [
    "_Ready", "_Process", "_PhysicsProcess", "_Input", "_UnhandledInput",
    "_Draw", "_EnterTree", "_ExitTree", "_Notification", "_GetConfigurationWarnings",
  ];
  return lifecycles.filter((lifecycle) => new RegExp(`override.*void.*${lifecycle}\\s*\\(`).test(content));
}

export async function getCsharpDiagnostics(
  registry: WorkspaceRegistry,
  input: GodotGetCsharpDiagnosticsInput,
): Promise<{ errors: string[]; warnings: string[] }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const targetDir = registry.resolvePath(workspace, input.projectPath);
  const errors: string[] = [];
  const warnings: string[] = [];

  async function scanDir(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if ([".godot", "bin", "obj"].includes(entry.name)) continue;
        await scanDir(join(dir, entry.name));
      } else if (entry.name.endsWith(".cs")) {
        const filePath = join(dir, entry.name);
        const content = await readFile(filePath, "utf8").catch(() => "");
        const relativePath = relative(workspace.root, filePath).replace(/\\/g, "/");
        if (!content.includes("partial class") && content.includes("extends")) {
          warnings.push(`${relativePath}: GDScript-style 'extends' found in .cs file - check syntax.`);
        }
      }
    }
  }

  await scanDir(targetDir);
  return { errors, warnings };
}

export async function getExportedProperties(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; scriptPath: string },
): Promise<ExportedProperty[]> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absolutePath = registry.resolvePath(workspace, input.scriptPath);
  return extractExportedProperties(await readFile(absolutePath, "utf8"));
}

export async function generateCsharpScript(params: {
  className: string;
  baseType?: string;
  namespace?: string;
}): Promise<string> {
  const base = params.baseType ?? "Node";
  const namespaceOpen = params.namespace ? `namespace ${params.namespace}\n{\n` : "";
  const namespaceClose = params.namespace ? `}\n` : "";
  const indent = params.namespace ? "    " : "";

  return [
    "using Godot;",
    "",
    namespaceOpen,
    `${indent}public partial class ${params.className} : ${base}`,
    `${indent}{`,
    `${indent}    public override void _Ready()`,
    `${indent}    {`,
    `${indent}    }`,
    `${indent}}`,
    namespaceClose,
  ].join("\n").trim() + "\n";
}
