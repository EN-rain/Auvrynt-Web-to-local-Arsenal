import * as z from "zod/v4";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { existsSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerConfig } from "../../config.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import { getBlenderClient } from "./blender-client.js";
import type { ToolResponse } from "../../pi-tools.js";
import { inlineImageOrNotice } from "../../tool-result-budget.js";
import { registerAppTool as registerAppToolImpl } from "../../server/mcp-tool-registrar.js";
import {
  MUTATING_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WORKSPACE_ID_SCHEMA,
  toolWidgetDescriptorMeta,
} from "../../server/tool-registration-shared.js";

export interface CatalogParam {
  name: string;
  type: "string" | "number" | "boolean" | "stringArray" | "numberArray" | "record" | "enum";
  enumValues?: string[];
  optional?: boolean;
  default?: unknown;
  description?: string;
}

export interface CatalogContext {
  workspaceRoot: string;
  resolveArtifactPath: (relPath: string) => string;
  artifactTimestamp: () => string;
}

export interface CatalogTool {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  params: CatalogParam[];
  build: (p: Record<string, any>, ctx: CatalogContext) => string;
  /** When true, the python result dict must include a `path` key pointing to a PNG artifact that is returned as an image. */
  image?: boolean;
}

function textResponse(text: string): ToolResponse {
  return { content: [{ type: "text", text }] };
}

function errorResponse(text: string): ToolResponse {
  return { content: [{ type: "text", text }], isError: true };
}

export function catalogResponse(res: unknown): ToolResponse {
  return textResponse(JSON.stringify(res, null, 2));
}

export function artifactTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function makeContext(registry: WorkspaceRegistry, workspaceId: string): CatalogContext {
  const workspace = registry.getWorkspace(workspaceId);
  return {
    workspaceRoot: workspace.root,
    resolveArtifactPath: (relPath: string) =>
      registry.resolveArtifactPath(workspace, relPath, "blender"),
    artifactTimestamp,
  };
}

export function runCatalogTool(
  registry: WorkspaceRegistry,
  workspaceId: string,
  tool: CatalogTool,
  input: Record<string, any>,
): Promise<ToolResponse> {
  const exec = async (): Promise<ToolResponse> => {
    try {
      const ctx = makeContext(registry, workspaceId);
      let code: string;
      try {
        code = tool.build(input, ctx);
      } catch (err: any) {
        return errorResponse(`${tool.name} argument build failed: ${err.message}`);
      }
      const client = getBlenderClient(workspaceId);
      const res = await client.sendExecute(code);

      if (tool.image) {
        const path = (res as any)?.path;
        if (typeof path === "string" && existsSync(path)) {
          const buffer = await readFile(path);
          const relativePath = relative(ctx.workspaceRoot, path).replace(/\\/g, "/");
          return {
            content: [
              ...inlineImageOrNotice(buffer, `Blender render ${relativePath}`, "image/png"),
              {
                type: "text",
                text: `Rendered image saved to ${relativePath}`,
              },
            ],
          };
        }
        return catalogResponse(res);
      }

      return catalogResponse(res);
    } catch (err: any) {
      return errorResponse(`${tool.name} failed: ${err.message}`);
    }
  };
  return exec();
}

// ─── Small python builders shared by catalog tools ────────────────────────────

/** Python prelude that resolves an object by name or raises. */
export function objPrelude(name: string, varName = "obj"): string {
  return (
    `import bpy\n` +
    `${varName}_name = ${JSON.stringify(name)}\n` +
    `${varName} = bpy.data.objects.get(${varName}_name)\n` +
    `if ${varName} is None:\n` +
    `    raise RuntimeError('Object not found: ' + ${varName}_name)\n`
  );
}

/** Python prelude that resolves an object (objectName param) and enters edit mode. */
export function editModePrelude(objVar = "obj"): string {
  return (
    `import bpy\n` +
    `${objVar} = bpy.context.active_object\n` +
    `if ${objVar} is None:\n` +
    `    raise RuntimeError('No active object')\n` +
    `if ${objVar}.type != 'MESH':\n` +
    `    raise RuntimeError('Active object is not a mesh')\n` +
    `bpy.context.view_layer.objects.active = ${objVar}\n` +
    `${objVar}.select_set(True)\n` +
    `if bpy.context.object.mode != 'EDIT':\n` +
    `    bpy.ops.object.mode_set(mode='EDIT')\n`
  );
}

/** Python prelude that ensures a material exists by name. */
export function materialPrelude(name: string, matVar = "mat"): string {
  return (
    `import bpy\n` +
    `${matVar} = bpy.data.materials.get(${JSON.stringify(name)})\n` +
    `if ${matVar} is None:\n` +
    `    raise RuntimeError('Material not found: ' + ${JSON.stringify(name)})\n`
  );
}

/** Python helper to build a color array from input (defaults to white). */
export function colorExpr(input: Record<string, any>, key = "color", fallback = [1, 1, 1, 1]): string {
  const c = input[key];
  if (Array.isArray(c) && c.length >= 3) {
    const r = Number(c[0] ?? 1);
    const g = Number(c[1] ?? 1);
    const b = Number(c[2] ?? 1);
    const a = Number(c[3] ?? 1);
    return `[${r}, ${g}, ${b}, ${a}]`;
  }
  return JSON.stringify(fallback);
}

/** Python helper: numeric value clamped to a range. */
export function clampExpr(input: Record<string, any>, key: string, min: number, max: number, fallback: number): string {
  let v = Number(input[key] ?? fallback);
  if (!Number.isFinite(v)) v = fallback;
  v = Math.max(min, Math.min(max, v));
  return String(v);
}

// ─── Zod schema building and registration ────────────────────────────────────

function paramSchema(p: CatalogParam): z.ZodType {
  let schema: z.ZodType;
  switch (p.type) {
    case "string":
      schema = z.string();
      break;
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "stringArray":
      schema = z.array(z.string());
      break;
    case "numberArray":
      schema = z.array(z.number());
      break;
    case "record":
      schema = z.record(z.string(), z.unknown());
      break;
    case "enum":
      schema = z.enum((p.enumValues ?? []) as [string, ...string[]]);
      break;
    default:
      schema = z.unknown();
  }
  if (p.optional) schema = schema.optional();
  else if (p.default !== undefined) schema = schema.default(p.default);
  return schema;
}

export function registerCatalogTools(
  server: McpServer,
  config: ServerConfig,
  workspaces: WorkspaceRegistry,
  tools: CatalogTool[],
): void {
  for (const tool of tools) {
    const inputShape: Record<string, z.ZodType> = { workspaceId: WORKSPACE_ID_SCHEMA };
    for (const p of tool.params) {
      inputShape[p.name] = paramSchema(p);
    }
    const annotations = tool.readOnly ? READ_ONLY_ANNOTATIONS : MUTATING_ANNOTATIONS;
    registerAppToolImpl(
      server,
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: z.object(inputShape),
        ...toolWidgetDescriptorMeta(config, tool.readOnly ? "read" : "write"),
        annotations,
      },
      async (input: any) =>
        runCatalogTool(workspaces, input.workspaceId, tool, input),
    );
  }
}
