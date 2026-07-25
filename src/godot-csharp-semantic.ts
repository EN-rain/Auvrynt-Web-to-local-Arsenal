import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { WorkspaceRegistry } from "./workspaces.js";

// ─── C# Semantic Tools ───────────────────────────────────────────────────────

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

// Regex-based lightweight C# semantic search (for use without Roslyn LSP)
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
  const lines = content.split(/\r?\n/);

  let namespace: string | undefined;
  const nsMatch = content.match(/^namespace\s+([\w.]+)/m);
  if (nsMatch) namespace = nsMatch[1];

  const classRegex = /^(?:\[[\w,=\s"'.()[\]]*\]\s*)*\s*(public|internal|private|protected)?\s*(static|sealed|abstract)?\s*(partial\s+)?class\s+(\w+)(?:\s*:\s*([\w<>, ]+))?/gm;
  let m;
  while ((m = classRegex.exec(content)) !== null) {
    const isPartial = !!m[3];
    const className = m[4];
    const inheritance = (m[5] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const baseClass = inheritance[0] ?? undefined;

    const lineNumber = content.slice(0, m.index).split("\n").length;

    // Extract [Export] properties
    const exportedProperties = extractExportedProperties(content, className);
    const signals = extractCsharpSignals(content);
    const lifecycleOverrides = extractLifecycleOverrides(content);

    classes.push({
      className,
      filePath,
      line: lineNumber,
      baseClass,
      isPartial,
      implementedInterfaces: inheritance.slice(1),
      namespace,
      exportedProperties,
      signals,
      lifecycleOverrides,
    });
  }

  return classes;
}

function extractExportedProperties(content: string, _className: string): ExportedProperty[] {
  const props: ExportedProperty[] = [];
  const exportRegex = /\[Export(?:Group|Subgroup|Category)?\(?"?(.*?)"?\)?\]\s+(?:public\s+)([\w?<>[\]]+)\s+(\w+)/g;
  let m;
  while ((m = exportRegex.exec(content)) !== null) {
    props.push({
      propertyName: m[3],
      inspectorDisplayName: m[3].replace(/([A-Z])/g, " $1").trim(),
      type: m[2],
      exportAttribute: m[0].split("]")[0] + "]",
      isNullable: m[2].endsWith("?"),
    });
  }
  return props;
}

function extractCsharpSignals(content: string): CsharpSignal[] {
  const signals: CsharpSignal[] = [];
  const delegateRegex = /\[Signal\]\s+public\s+delegate\s+void\s+(\w+)\((.*?)\)/g;
  let m;
  while ((m = delegateRegex.exec(content)) !== null) {
    const name = m[1].replace(/EventHandler$/, "");
    const params = m[2] ? m[2].split(",").map((p) => p.trim()) : [];
    signals.push({ name, parameters: params, declaration: m[0] });
  }
  return signals;
}

function extractLifecycleOverrides(content: string): string[] {
  const lifecycles = [
    "_Ready", "_Process", "_PhysicsProcess", "_Input", "_UnhandledInput",
    "_Draw", "_EnterTree", "_ExitTree", "_Notification",
    "_GetConfigurationWarnings",
  ];
  return lifecycles.filter((lc) => new RegExp(`override.*void.*${lc}\\s*\\(`).test(content));
}

export async function getCsharpDiagnostics(
  registry: WorkspaceRegistry,
  input: GodotGetCsharpDiagnosticsInput,
): Promise<{ errors: string[]; warnings: string[] }> {
  // Returns diagnostics by parsing .csproj build output
  // Live diagnostics require a Roslyn LSP; this scans for known anti-patterns
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
        const content = await readFile(join(dir, entry.name), "utf8").catch(() => "");
        const rel = relative(workspace.root, join(dir, entry.name)).replace(/\\/g, "/");
        if (!content.includes("partial class") && content.includes("extends")) {
          warnings.push(`${rel}: GDScript-style 'extends' found in .cs file - check syntax.`);
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
  const absPath = registry.resolvePath(workspace, input.scriptPath);
  const content = await readFile(absPath, "utf8");
  return extractExportedProperties(content, "");
}

export async function generateCsharpScript(params: {
  className: string;
  baseType?: string;
  namespace?: string;
}): Promise<string> {
  const base = params.baseType ?? "Node";
  const nsOpen = params.namespace ? `namespace ${params.namespace}\n{\n` : "";
  const nsClose = params.namespace ? `}\n` : "";
  const indent = params.namespace ? "    " : "";

  return [
    "using Godot;",
    "",
    nsOpen,
    `${indent}public partial class ${params.className} : ${base}`,
    `${indent}{`,
    `${indent}    public override void _Ready()`,
    `${indent}    {`,
    `${indent}    }`,
    `${indent}}`,
    nsClose,
  ]
    .join("\n")
    .trim() + "\n";
}
