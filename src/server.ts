import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { checkResourceAllowed, resourceUrlFromServerUrl } from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import {
  registerAppResource,
  registerAppTool as registerExtAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import express from "express";
import type { Request, Response } from "express";
import * as z from "zod/v4";
import { loadConfig, oauthScopesForIntegrations, type AuvryntScope, type ServerConfig, type WidgetMode } from "./config.js";
import {
  logEvent,
  requestIp,
  requestPath,
  commandPreview,
  sessionIdPrefix,
} from "./logger.js";
import {
  editFileTool,
  findFilesTool,
  grepFilesTool,
  listDirectoryTool,
  readFileTool,
  runShellTool,
  writeFileTool,
} from "./pi-tools.js";
import { SingleUserOAuthProvider } from "./oauth-provider.js";
import { createReviewCheckpointManager } from "./review-checkpoints.js";
import { formatPathForPrompt } from "./skills.js";
import { createWorkspaceStore } from "./workspace-store.js";
import { formatAgentsPath, WorkspaceRegistry } from "./workspaces.js";
import { executeViewImage } from "./view-image.js";
import { ProcessManager, redactProcessText } from "./processes.js";
import { getConnectionStatus } from "./connection-status.js";
import { recordConnectedClient } from "./connection-registry.js";
import { globFiles, searchText, inspectProject } from "./search-discovery.js";
import { capturePageScreenshot, inspectPage, startDevServer, testResponsivePage } from "./web-tools.js";
import { inspectImage, compareImages, inspectSprite, splitSpriteSheet } from "./image-tools.js";
import {
  inspectDotnetProject,
  dotnetRestore,
  dotnetBuild,
  dotnetTest,
  dotnetRun,
  dotnetFormat,
} from "./dotnet-tools.js";
import {
  detectGodotProject,
  godotRun,
  inspectGodotScene,
} from "./godot-tools.js";
import { captureWindow } from "./window-capture.js";
import { inspectGodotDotnetEnvironment } from "./godot-dotnet-env.js";
import { inspectGodotDotnetProject, godotBuildSolutions, godotDotnetRestore } from "./godot-csharp-project.js";
import { godotDotnetBuild, godotDotnetClean } from "./godot-csharp-build.js";
import { godotRunProject, godotRunScene, getGodotRuntimeLogs } from "./godot-csharp-runner.js";
import { godotValidateProject, godotImportAssets } from "./godot-csharp-validate.js";
import { godotEditorConnect, godotEditorStatus, godotEditorDisconnect, getBridgeClient, disconnectAllGodotEditorBridges } from "./godot-editor-bridge.js";
import { findCsharpClasses, getCsharpDiagnostics, getExportedProperties, generateCsharpScript } from "./godot-csharp-semantic.js";
import {
  getProjectSettings,
  setProjectSetting,
  getInputMap,
  getAutoloads,
  applyPixelArtImportPreset,
  generateVscodeConfig,
  listExportPresets,
} from "./godot-project-settings.js";
import {
  listAnimations,
  getAnimation,
  createAnimation,
  validateAnimation,
  getTileLayers,
  inspectTileset,
  validateCollisions,
  getCameraState,
  validateCamera,
} from "./godot-animation-tilemap.js";
import {
  getRemoteSceneTree,
  getRuntimeProperty,
  getPerformanceMonitors,
  parseCsharpExceptions,
  pressAction as godotPressAction,
  releaseAction as godotReleaseAction,
  mouseClick as godotMouseClick,
  assertNodeExists as godotAssertNodeExists,
  assertProperty as godotAssertProperty,
  runTestSequence as godotRunTestSequence,
  exportGodotProject,
} from "./godot-runtime-testing.js";
import {
  inspectGodotGdscriptEnvironment,
  getGdscriptDiagnostics,
  inspectGdscript,
  createGdscript,
  attachGdscript,
  detachGdscript,
  createGdscriptSignal,
  createGdscriptSignalHandler,
  getGlobalClasses,
  addClassName,
  removeClassName,
  addGdscriptAutoload,
  getAutoloadUsage,
  inspectToolScript,
  createEditorPlugin,
  getGdscriptDependencies,
  findCyclicScriptDependencies,
  getGdscriptNodeReferences,
  getGdscriptLifecycleMethods,
  inspectGdscriptAwaitUsage,
  analyzeGdscriptTyping,
  formatGdscript,
  detectGdscriptTests,
  runGdscriptTests,
  reloadGdscript,
  setBreakpoint as gdscriptSetBreakpoint,
  removeBreakpoint as gdscriptRemoveBreakpoint,
  lspFindSymbol as gdscriptLspFindSymbol,
  lspGetDefinition as gdscriptLspGetDefinition,
} from "./godot-gdscript.js";
import { clearBlenderClients } from "./blender-client.js";
import {
  blenderPing,
  blenderGetSceneInfo,
  blenderGetSceneAudit,
  blenderGetSelection,
  blenderGetActiveModeAndStatus,
  blenderGetConsoleErrors,
  blenderInspectObject,
  blenderCreateCube,
  blenderSelectObject,
  blenderSelectObjects,
  blenderTransformObject,
  blenderDuplicateLinked,
  blenderJoinObjects,
  blenderDeleteObjects,
  blenderCreateCollection,
  blenderMoveToCollection,
  blenderSetViewportView,
  blenderOrbitViewport,
  blenderPanViewport,
  blenderZoomViewport,
  blenderFrameSelected,
  blenderSetViewportShading,
  blenderInspectMaterial,
  blenderInspectGeometryNodes,
  blenderEditModifier,
  blenderSetRenderSettings,
  blenderRenderCamera,
  blenderRenderObjectIsolation,
  blenderRenderViewport,
  blenderSaveCheckpoint,
  blenderListCheckpoints,
  blenderRollbackCheckpoint,
  blenderExecutePython,
  blenderGetCurrentFile,
  blenderOpenFile,
  blenderSaveFile,
  blenderSaveFileAs,
  blenderExportGlb,
  assertBlenderWorkspaceBound,
} from "./blender-tools.js";
import { SerenaManager, defaultSerenaConfig } from "./serena-manager.js";
import { registerSerenaTools } from "./serena-tools.js";

type Transport = StreamableHTTPServerTransport;
const WORKSPACE_APP_URI = "ui://auvrynt/workspace-app.html";
const WORKSPACE_APP_MANIFEST_ENTRY = "workspace-app.html";
const VIEW_IMAGE_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const PROCESS_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const MUTATING_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
const WEB_READ_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const WEB_WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
const MAX_MCP_SESSIONS = 32;

const WRITE_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};
const EDIT_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};
const SHELL_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export interface RunningServer {
  app: ReturnType<typeof createMcpExpressApp>;
  config: ServerConfig;
  updateIntegrations(
    integrations: ServerConfig["integrations"],
    options?: { serenaExecutable?: string },
  ): Promise<{ updated: boolean; activeRequests: number; activeToolCalls: number; closedSessions: number }>;
  close(): Promise<void>;
}

type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

interface McpServerGuardContext {
  config: ServerConfig;
  allowedScopes: Set<string>;
  workspaces: WorkspaceRegistry;
}

const mcpServerGuards = new WeakMap<McpServer, McpServerGuardContext>();
const PLAYWRIGHT_TOOL_NAMES = new Set(["capture_page_screenshot", "inspect_page", "test_responsive_page"]);
const GENERIC_GODOT_TOOL_NAMES = new Set(["detect_godot_project", "inspect_godot_scene"]);
const GODOT_CSHARP_TOOL_MARKERS = ["dotnet", "csharp", "build_solutions", "generate_vscode_config"];

export function requiredScopesForToolName(name: string): AuvryntScope[] {
  if (name === "blender_execute_python") return ["auvrynt:blender", "auvrynt:blender-python"];
  if (name.startsWith("blender_")) return ["auvrynt:blender"];
  if (name.startsWith("godot_") || GENERIC_GODOT_TOOL_NAMES.has(name)) return ["auvrynt:godot"];
  if (name.startsWith("serena_")) return ["auvrynt:serena"];
  if (name === "start_dev_server") return ["auvrynt:web", "auvrynt:process"];
  if (name === "capture_page_screenshot" || name === "test_responsive_page") return ["auvrynt:web", "auvrynt:write"];
  if (name === "inspect_page") return ["auvrynt:web"];
  if (name === "capture_window") return ["auvrynt:process", "auvrynt:write"];
  if (name === "split_sprite_sheet") return ["auvrynt:write"];
  if (name === "inspect_dotnet_project") return ["auvrynt:software"];
  if (["dotnet_restore", "dotnet_build", "dotnet_test", "dotnet_run", "dotnet_format"].includes(name)) {
    return ["auvrynt:software", "auvrynt:process"];
  }
  if (["start_process", "get_process_logs", "list_processes", "stop_process", "run_shell", "bash"].includes(name)) {
    return ["auvrynt:process"];
  }
  if (["write", "write_file", "edit", "edit_file"].includes(name)) return ["auvrynt:write"];
  return ["auvrynt:read"];
}

export function requiredScopesForToolCall(name: string, input: unknown): AuvryntScope[] {
  const required = new Set<AuvryntScope>(requiredScopesForToolName(name));
  if (name === "compare_images" && input && typeof input === "object" && "diffOutputPath" in input) {
    if (typeof (input as { diffOutputPath?: unknown }).diffOutputPath === "string") required.add("auvrynt:write");
  }
  if (name === "dotnet_format" && input && typeof input === "object") {
    if ((input as { verifyOnly?: unknown }).verifyOnly !== true) required.add("auvrynt:write");
  }
  return Array.from(required);
}

function hasRequiredScopes(scopes: Iterable<string>, required: readonly string[]): boolean {
  const available = scopes instanceof Set ? scopes : new Set(scopes);
  return required.every((scope) => available.has(scope));
}

function godotIntegrationEnabled(config: ServerConfig, toolName: string): boolean {
  if (GODOT_CSHARP_TOOL_MARKERS.some((marker) => toolName.includes(marker))) {
    return config.integrations.godotCsharp;
  }
  if (toolName.includes("gdscript") || [
    "godot_get_global_classes",
    "godot_add_class_name",
    "godot_remove_class_name",
    "godot_get_autoload_usage",
    "godot_inspect_tool_script",
    "godot_create_editor_plugin",
  ].includes(toolName)) {
    return config.integrations.godotGdscript;
  }
  return config.integrations.godotGdscript || config.integrations.godotCsharp;
}

export function toolIntegrationEnabled(config: ServerConfig, name: string): boolean {
  if (name.startsWith("blender_")) return config.integrations.blender;
  if (name.startsWith("godot_") || GENERIC_GODOT_TOOL_NAMES.has(name)) return godotIntegrationEnabled(config, name);
  if (PLAYWRIGHT_TOOL_NAMES.has(name)) return config.integrations.playwright;
  if (name.startsWith("serena_")) return config.integrations.serena && config.serena.enabled;
  return true;
}

const BLENDER_UNBOUND_TOOL_NAMES = new Set([
  "blender_ping",
  "blender_get_current_file",
  "blender_open_file",
  "blender_save_file_as",
  "blender_list_checkpoints",
]);

const registerAppTool = ((server: McpServer, name: string, toolConfig: unknown, handler: Function) => {
  const guard = mcpServerGuards.get(server);
  const requiredScopes = requiredScopesForToolName(name);
  if (guard) {
    if (!toolIntegrationEnabled(guard.config, name)) return undefined;
    if (!hasRequiredScopes(guard.allowedScopes, requiredScopes)) return undefined;
  }

  const guardedHandler = async (...args: unknown[]) => {
    const input = args[0];
    const callScopes = requiredScopesForToolCall(name, input);
    const extra = args.at(-1) as { authInfo?: { scopes?: string[] } } | undefined;
    if (!extra?.authInfo?.scopes || !hasRequiredScopes(extra.authInfo.scopes, callScopes)) {
      throw new Error(`Forbidden: ${name} requires ${callScopes.join(" + ")}`);
    }
    if (guard && input && typeof input === "object" && "workspaceId" in input) {
      const workspaceId = (input as { workspaceId?: unknown }).workspaceId;
      if (typeof workspaceId === "string") {
        guard.workspaces.getWorkspace(workspaceId);
        if (name.startsWith("blender_") && !BLENDER_UNBOUND_TOOL_NAMES.has(name)) {
          await assertBlenderWorkspaceBound(guard.workspaces, workspaceId);
        }
      }
    }
    return Reflect.apply(handler, undefined, args);
  };

  return Reflect.apply(registerExtAppTool, undefined, [server, name, toolConfig, guardedHandler]);
}) as unknown as typeof registerExtAppTool;

interface WorkspaceAppManifestEntry {
  file: string;
  css?: string[];
  isEntry?: boolean;
}

type WorkspaceAppManifest = Record<string, WorkspaceAppManifestEntry>;

interface DiffStats {
  additions: number;
  removals: number;
}

type ToolWidgetKind =
  | "workspace"
  | "read"
  | "write"
  | "edit"
  | "search"
  | "directory"
  | "shell"
  | "show_changes";

interface ToolDefinitionMeta extends Record<string, unknown> {
  ui: {
    resourceUri: string;
    visibility: ["model"];
  };
}

type EmptyToolDefinitionMeta = Record<string, unknown> & {
  "ui/resourceUri"?: string;
};

interface ToolWidgetDescriptorMeta {
  _meta: ToolDefinitionMeta | EmptyToolDefinitionMeta;
}

function shouldAttachWidget(mode: WidgetMode, kind: ToolWidgetKind): boolean {
  switch (mode) {
    case "off":
      return false;
    case "changes":
      return kind === "workspace" || kind === "show_changes";
    case "full":
      return true;
  }
}

function toolWidgetDescriptorMeta(
  config: ServerConfig,
  kind: ToolWidgetKind,
): ToolWidgetDescriptorMeta {
  if (!shouldAttachWidget(config.widgets, kind)) return { _meta: {} };

  return {
    _meta: {
      ui: {
        resourceUri: WORKSPACE_APP_URI,
        visibility: ["model"],
      },
    },
  };
}

interface ToolNames {
  openWorkspace: "open_workspace";
  read: "read_file" | "read";
  write: "write_file" | "write";
  edit: "edit_file" | "edit";
  grep: "grep_files" | "grep";
  glob: "find_files" | "glob";
  ls: "list_directory" | "ls";
  shell: "run_shell" | "bash";
}

interface ToolLogFields {
  tool: string;
  workspaceId?: string;
  path?: string;
  workingDirectory?: string;
  command?: string;
  commandLength?: number;
  success: boolean;
  durationMs: number;
  error?: string;
}

function toolNamesFor(config: ServerConfig): ToolNames {
  return config.toolNaming === "short"
    ? {
        openWorkspace: "open_workspace",
        read: "read",
        write: "write",
        edit: "edit",
        grep: "grep",
        glob: "glob",
        ls: "ls",
        shell: "bash",
      }
    : {
        openWorkspace: "open_workspace",
        read: "read_file",
        write: "write_file",
        edit: "edit_file",
        grep: "grep_files",
        glob: "find_files",
        ls: "list_directory",
        shell: "run_shell",
      };
}

function serverInstructions(config: ServerConfig, toolNames: ToolNames): string {
  const inspection = config.minimalTools
    ? `In minimal tool mode, ${toolNames.grep}, ${toolNames.glob}, and ${toolNames.ls} are disabled; use ${toolNames.shell} with command-line tools such as grep, rg, find, ls, and tree for search and directory inspection. `
    : `Prefer ${toolNames.read}, ${toolNames.grep}, ${toolNames.glob}, and ${toolNames.ls} for file inspection. `;

  const skills = config.skillsEnabled
    ? `When ${toolNames.openWorkspace} returns available skills and a task matches a skill, use ${toolNames.read} to read that skill's path before proceeding. Skill paths may be outside the workspace, but ${toolNames.read} only permits advertised SKILL.md files and files under already-loaded skill directories. `
    : "";

  const agentsMd = `Follow instructions returned by ${toolNames.openWorkspace}. Before working under a path listed in availableAgentsFiles, use ${toolNames.read} to inspect that instruction file and follow it. `;

  const viewImageInstruction = `Use view_image when asked to inspect, describe, analyze, or compare a local image. Call ${toolNames.openWorkspace} first, pass the returned workspaceId, and use a workspace-relative path. Do not use ${toolNames.read} for binary image files. `;

  const showChanges =
    config.widgets === "changes"
      ? " After creating, editing, or overwriting files, call show_changes once after the related file changes are complete so the user can see the aggregate diff."
      : "";

  const devTools = `
Process management: Use start_process for long-running servers, apps, and games that must stay running. Use get_process_logs to tail output. Use stop_process when done. Do not use ${toolNames.shell} for commands that block indefinitely.
Web development: Use start_dev_server to launch a dev server (auto-detects npm run dev), capture_page_screenshot to capture pages with Playwright, inspect_page for structured DOM/accessibility info, test_responsive_page for multi-viewport testing. Requires Playwright; see docs/DEVELOPMENT_TOOLS.md.
Project discovery: Use inspect_project to detect project type, package manager, and recommended commands. Use glob_files and search_text for structured file search across the workspace.
Image tools: Use inspect_image for dimensions/format/palette. Use compare_images for pixel-level diff. Use inspect_sprite and split_sprite_sheet for sprite sheets. Do not use view_image for analysis—use inspect_image.
.NET tools: Use inspect_dotnet_project to read project structure, dotnet_restore/dotnet_build/dotnet_test for CLI operations, dotnet_run to start a .NET app as a persistent process, dotnet_format for formatting.
Godot tools: Use detect_godot_project when a workspace contains project.godot. Use godot_run to start the game or editor as a persistent process. Use inspect_godot_scene to read .tscn scene trees. Configure the Godot executable via GODOT_EXECUTABLE environment variable.
Window capture: Use capture_window to screenshot a running application tracked by Auvrynt. Use godot_capture_game specifically for Godot game processes.
Security: All paths must be workspace-relative. Never access files outside the opened workspace. Do not claim a screenshot or comparison succeeded unless the tool returned successfully.`;

  return `Use Auvrynt as a local coding workspace. Call ${toolNames.openWorkspace} once per project folder or worktree to obtain a workspaceId. Reuse that same workspaceId for all later file, search, edit, write, show-changes, view-image, and shell tools in that folder; do not call ${toolNames.openWorkspace} again unless switching folders/worktrees, changing checkout/worktree mode, the workspaceId is rejected as unknown, or the user explicitly asks to reopen. ${agentsMd}${skills}${inspection}${viewImageInstruction}Prefer ${toolNames.edit} for targeted source-file modifications and ${toolNames.write} only for new files or complete rewrites. Use ${toolNames.shell} for tests, builds, git inspection, package scripts, and commands that genuinely require a shell. The shell/process tools execute with the local user's privileges and are not a filesystem sandbox; only invoke them when the granted auvrynt:process scope and requested task justify local command execution.${showChanges}${devTools}`;
}
function resultOutputSchema(extra: z.ZodRawShape = {}): z.ZodRawShape {
  return {
    result: z
      .string()
      .describe(
        "Model-readable result text for follow-up reasoning and plain MCP hosts.",
      ),
    ...extra,
  };
}

const workspaceSkillOutputSchema = z.object({
  name: z.string(),
  description: z.string(),
  path: z.string(),
});

const workspaceAgentsFileOutputSchema = z.object({
  path: z.string(),
  content: z.string(),
});

const workspaceAvailableAgentsFileOutputSchema = z.object({
  path: z.string(),
});

const reviewFileOutputSchema = z.object({
  path: z.string(),
  previousPath: z.string().optional(),
  type: z.enum(["change", "rename-pure", "rename-changed", "new", "deleted"]),
  additions: z.number(),
  removals: z.number(),
});

const reviewSummaryOutputSchema = z.object({
  files: z.number(),
  additions: z.number(),
  removals: z.number(),
});

function sendJsonRpcError(
  res: Response,
  status: number,
  code: number,
  message: string,
): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
}

function requestLogFields(req: Request, config: ServerConfig): Record<string, unknown> {
  return {
    ip: requestIp(req),
    host: req.header("host"),
    userAgent: req.header("user-agent"),
    origin: req.header("origin"),
    referer: req.header("referer"),
    contentLength: req.header("content-length"),
  };
}

function mcpClientName(req: Request): string | undefined {
  const headerName = req.header("x-mcp-client-name") ?? req.header("x-client-name");
  if (headerName) return headerName;

  const body = req.body as { params?: { clientInfo?: { name?: unknown } } } | undefined;
  const name = body?.params?.clientInfo?.name;
  return typeof name === "string" ? name : undefined;
}

function logToolCall(config: ServerConfig, fields: ToolLogFields): void {
  if (!config.logging.toolCalls) return;

  const { command, ...safeFields } = fields;
  logEvent(config.logging, fields.success ? "info" : "warn", "tool_call", {
    ...safeFields,
    commandPreview: config.logging.shellCommands && command ? commandPreview(redactProcessText(command)) : undefined,
  });
}

function contentText(content: ToolContent[]): string {
  return content
    .filter(
      (item): item is { type: "text"; text: string } => item.type === "text",
    )
    .map((item) => item.text)
    .join("\n");
}

function toolErrorPreview(content: ToolContent[]): string | undefined {
  const text = redactProcessText(contentText(content)).replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function logFailedToolResponse(
  config: ServerConfig,
  fields: Omit<ToolLogFields, "success" | "durationMs" | "error">,
  content: ToolContent[],
  startedAt: number,
): void {
  logToolCall(config, {
    ...fields,
    success: false,
    durationMs: Math.round(performance.now() - startedAt),
    error: toolErrorPreview(content),
  });
}

function textBlock(text: string): ToolContent {
  return { type: "text", text };
}

function textSummary(content: ToolContent[]): {
  lines: number;
  characters: number;
} {
  const text = contentText(content);
  return {
    lines: text.length === 0 ? 0 : text.split("\n").length,
    characters: text.length,
  };
}

function contentLineCount(content: string): number {
  if (content.length === 0) return 0;
  return content.endsWith("\n")
    ? content.slice(0, -1).split("\n").length
    : content.split("\n").length;
}

function countDiffStats(diff: string | undefined): DiffStats {
  if (!diff) return { additions: 0, removals: 0 };

  let additions = 0;
  let removals = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    if (line.startsWith("-") && !line.startsWith("---")) removals++;
  }

  return { additions, removals };
}

function newFilePatch(path: string, content: string): string {
  const lines =
    content.length === 0
      ? []
      : content.endsWith("\n")
        ? content.slice(0, -1).split("\n")
        : content.split("\n");
  const hunkLength = lines.length;
  const hunkRange = hunkLength === 0 ? "+0,0" : `+1,${hunkLength}`;
  const body = lines.map((line) => `+${line}`).join("\n");

  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 ${hunkRange} @@`,
    body,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function assetBaseUrl(config: ServerConfig): string {
  return `${config.publicBaseUrl.replace(/\/+$/, "")}/mcp-app-assets`;
}

function uiManifestUrl(): URL {
  return new URL("../dist/ui/.vite/manifest.json", import.meta.url);
}

function readWorkspaceAppManifest(): WorkspaceAppManifest {
  return JSON.parse(readFileSync(uiManifestUrl(), "utf8")) as WorkspaceAppManifest;
}

function getWorkspaceAppManifestEntry(): WorkspaceAppManifestEntry {
  const manifest = readWorkspaceAppManifest();
  const entry = manifest[WORKSPACE_APP_MANIFEST_ENTRY];

  if (!entry?.file) {
    throw new Error(`Missing ${WORKSPACE_APP_MANIFEST_ENTRY} in UI manifest.`);
  }

  return entry;
}

function assetUrl(baseUrl: string, assetPath: string): string {
  return `${baseUrl}/${assetPath.replace(/^\/+/, "")}`;
}

function workspaceAppHtml(config: ServerConfig): string {
  const baseUrl = assetBaseUrl(config);
  const entry = getWorkspaceAppManifestEntry();
  const stylesheets = (entry.css ?? [])
    .map(
      (stylesheet) =>
        `    <link rel="stylesheet" crossorigin href="${assetUrl(baseUrl, stylesheet)}" />`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Auvrynt Workspace</title>
    <script type="module" crossorigin src="${assetUrl(baseUrl, entry.file)}"></script>
${stylesheets}
  </head>
  <body>
    <main id="app" class="shell">
      <section class="empty">Waiting for a tool result.</section>
    </main>
  </body>
</html>`;
}

function appCsp(config: ServerConfig): {
  resourceDomains: string[];
  connectDomains: string[];
} {
  const publicBaseUrl = config.publicBaseUrl.replace(/\/+$/, "");
  return {
    resourceDomains: [publicBaseUrl],
    connectDomains: [publicBaseUrl],
  };
}

function uiBuildDirectory(): string {
  return fileURLToPath(new URL("../dist/ui", import.meta.url));
}

function brandAssetDirectory(): string {
  return fileURLToPath(new URL("../docs/assets", import.meta.url));
}

function setAssetHeaders(res: Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
}

async function assertWorkspaceAppAssets(): Promise<void> {
  const entry = getWorkspaceAppManifestEntry();
  const candidates = [entry.file, ...(entry.css ?? [])].map(
    (assetPath) => new URL(`../dist/ui/${assetPath}`, import.meta.url),
  );

  for (const candidate of candidates) {
    await access(candidate);
  }
}

function packageVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : "unknown";
  } catch {
    return "unknown";
  }
}

function createMcpServer(
  config: ServerConfig,
  workspaces: WorkspaceRegistry,
  reviewCheckpoints: ReturnType<typeof createReviewCheckpointManager>,
  serenaManager: SerenaManager,
  processManager: ProcessManager,
  allowedScopes: readonly string[],
): McpServer {
  const toolNames = toolNamesFor(config);
  const server = new McpServer(
    {
      name: "auvrynt",
      title: "Auvrynt",
      version: packageVersion(),
      description:
        "Secure local coding workspace for MCP clients. Provides workspace-scoped file, search, edit, write, and shell tools.",
    },
    {
      instructions: serverInstructions(config, toolNames),
    },
  );
  mcpServerGuards.set(server, { config, allowedScopes: new Set(allowedScopes), workspaces });

  registerAppResource(
    server,
    "Auvrynt Diff Card",
    WORKSPACE_APP_URI,
    {
      description: "Interactive card for viewing Auvrynt file diffs.",
      _meta: {
        ui: {
          csp: appCsp(config),
        },
      },
    },
    async () => {
      await assertWorkspaceAppAssets();
      return {
        contents: [
          {
            uri: WORKSPACE_APP_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: workspaceAppHtml(config),
            _meta: {
              ui: {
                csp: appCsp(config),
              },
            },
          },
        ],
      };
    },
  );

  registerAppTool(
    server,
    "open_workspace",
    {
      title: "Open workspace",
      description:
        "Open a local project directory as a coding workspace. Call this once per project folder or worktree before reading, editing, searching, writing, showing changes, or running commands. Reuse the returned workspaceId for later calls in the same folder; do not call open_workspace again unless switching folders/worktrees, changing checkout/worktree mode, the workspaceId is rejected as unknown, or the user explicitly asks to reopen. By default this opens the actual checkout; set mode=\"worktree\" when the user asks for an isolated or parallel coding session. Returns a workspaceId, loaded root project instructions, and nested instruction file paths the model should read before working in those directories.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Absolute path, or a leading-tilde home path such as ~/project, to a local project directory inside an allowed root.",
          ),
        mode: z
          .enum(["checkout", "worktree"])
          .optional()
          .describe(
            "Defaults to checkout. Use checkout to work in the actual directory. Use worktree to create an isolated managed Git worktree for parallel work.",
          ),
        baseRef: z
          .string()
          .optional()
          .describe("Git ref to base a worktree on. Only used with mode=\"worktree\". Defaults to HEAD."),
      },
      outputSchema: {
        workspaceId: z.string(),
        root: z.string(),
        mode: z.enum(["checkout", "worktree"]),
        sourceRoot: z.string().optional(),
        worktree: z
          .object({
            path: z.string(),
            baseRef: z.string(),
            baseSha: z.string(),
            dirtySource: z.boolean(),
            detached: z.boolean(),
            managed: z.boolean(),
          })
          .optional(),
        agentsFiles: z.array(workspaceAgentsFileOutputSchema),
        availableAgentsFiles: z.array(workspaceAvailableAgentsFileOutputSchema),
        skills: z.array(workspaceSkillOutputSchema),
        skillDiagnostics: z.array(z.unknown()),
        instruction: z.string(),
      },
      ...toolWidgetDescriptorMeta(config, "workspace"),
      annotations: { readOnlyHint: true },
    },
    async ({ path, mode, baseRef }) => {
      const startedAt = performance.now();
      const { workspace, agentsFiles, availableAgentsFiles } = await workspaces.openWorkspace({ path, mode, baseRef });
      if (config.widgets === "changes") {
        void reviewCheckpoints.initializeWorkspace({
          workspaceId: workspace.id,
          root: workspace.root,
        });
      }
      const visibleSkills = workspace.skills
        .filter((skill) => !skill.disableModelInvocation)
        .map((skill) => ({
          name: skill.name,
          description: skill.description,
          path: formatPathForPrompt(skill.filePath),
        }));
      const loadedAgentsFiles = agentsFiles.map((file) => ({
        path: formatAgentsPath(file.path, workspace.root),
        content: file.content,
      }));
      const availableAgentsFileOutputs = availableAgentsFiles.map((file) => ({
        path: formatAgentsPath(file.path, workspace.root),
      }));
      const instruction = config.skillsEnabled
        ? "Use this workspaceId in all subsequent tool calls for this project. Do not call open_workspace again for this same folder unless this workspaceId stops working, the user asks to reopen, or you switch to a different folder/worktree. Follow loaded agentsFiles instructions. Before working under a path listed in availableAgentsFiles, read that instruction file. When a task matches an available skill in skills, read its path before proceeding."
        : "Use this workspaceId in all subsequent tool calls for this project. Do not call open_workspace again for this same folder unless this workspaceId stops working, the user asks to reopen, or you switch to a different folder/worktree. Follow loaded agentsFiles instructions. Before working under a path listed in availableAgentsFiles, read that instruction file.";
      const resultContent: ToolContent[] = [
        {
          type: "text" as const,
          text: [
            `Opened workspace ${workspace.id}`,
            `Root: ${workspace.root}`,
            `Mode: ${workspace.mode}`,
            loadedAgentsFiles.length > 0
              ? `Loaded project instructions: ${loadedAgentsFiles.map((file) => file.path).join(", ")}`
              : undefined,
            availableAgentsFileOutputs.length > 0
              ? `Available nested instructions: ${availableAgentsFileOutputs.map((file) => file.path).join(", ")}`
              : undefined,
            visibleSkills.length > 0
              ? `Available skills: ${visibleSkills.map((skill) => skill.name).join(", ")}`
              : undefined,
            instruction,
          ].filter(Boolean).join("\n"),
        },
      ];
      logToolCall(config, {
        tool: "open_workspace",
        workspaceId: workspace.id,
        path: workspace.root,
        success: true,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return {
        content: resultContent,
        _meta: {
          tool: "open_workspace",
          card: {
            workspaceId: workspace.id,
            root: workspace.root,
            path: workspace.root,
            summary: {
              agentsFiles: loadedAgentsFiles.length,
              availableAgentsFiles: availableAgentsFileOutputs.length,
              skills: visibleSkills.length,
              skillDiagnostics: workspace.skillDiagnostics.length,
            },
          },
        },
        structuredContent: {
          workspaceId: workspace.id,
          root: workspace.root,
          mode: workspace.mode,
          sourceRoot: workspace.sourceRoot,
          worktree: workspace.worktree,
          agentsFiles: loadedAgentsFiles,
          availableAgentsFiles: availableAgentsFileOutputs,
          skills: visibleSkills,
          skillDiagnostics: workspace.skillDiagnostics,
          instruction,
        },
      };
    },
  );

  registerAppTool(
    server,
    toolNames.read,
    {
      title: "Read file",
      description:
        [
          "Read a file inside an open workspace. Use this for file inspection instead of shell commands like cat or sed. Call open_workspace first and pass workspaceId.",
          "Use this tool to inspect relevant AGENTS.md or CLAUDE.md files listed by open_workspace before working in nested directories.",
          config.skillsEnabled
            ? "If available skills were returned and a task matches one, read that skill's path before proceeding. Skill paths may be outside the workspace; only advertised SKILL.md files and files under already-loaded skill directories are readable."
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        path: z
          .string()
          .describe(
            config.skillsEnabled
              ? "File path to read, relative to the workspace root. May also be an advertised skill path from open_workspace skills."
              : "File path to read, relative to the workspace root.",
          ),
        offset: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("1-indexed line number to start reading from."),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of lines to read."),
      },
      outputSchema: resultOutputSchema(),
      ...toolWidgetDescriptorMeta(config, "read"),
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);
      const readPath = workspaces.resolveReadPath(workspace, input.path);
      const response = await readFileTool(
        { ...input, path: readPath.absolutePath },
        {
          cwd: workspace.root,
          root: workspace.root,
          readRoots: readPath.readRoots,
        },
      );

      if (response.isError) {
        logFailedToolResponse(config, {
          tool: toolNames.read,
          workspaceId,
          path: input.path,
        }, response.content, startedAt);
        return response;
      }
      workspaces.markReadPathLoaded(workspace, readPath);

      const summary = {
        ...textSummary(response.content),
        offset: input.offset ?? 1,
        limited: input.limit !== undefined,
      };
      logToolCall(config, {
        tool: toolNames.read,
        workspaceId,
        path: input.path,
        success: true,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return {
        ...response,
        _meta: {
          tool: toolNames.read,
          card: {
            workspaceId,
            path: input.path,
            summary,
            payload: { content: response.content },
          },
        },
        structuredContent: {
          result: contentText(response.content),
        },
      };
    },
  );

  registerAppTool(
    server,
    "view_image",
    {
      title: "View image",
      description:
        "View a local image file (.png, .jpg, .jpeg, .webp, .gif) inside an open workspace as visual MCP image content. Use this when asked to inspect, describe, analyze, or compare images. Call open_workspace first and pass workspaceId.",
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        path: z
          .string()
          .describe("Image file path, relative to the workspace root."),
      },
      ...toolWidgetDescriptorMeta(config, "read"),
      annotations: VIEW_IMAGE_TOOL_ANNOTATIONS,
    },
    async ({ workspaceId, path }) => {
      const startedAt = performance.now();
      const response = await executeViewImage(workspaces, { workspaceId, path });

      if (response.isError) {
        logFailedToolResponse(
          config,
          { tool: "view_image", workspaceId, path },
          response.content,
          startedAt,
        );
        return response;
      }

      logToolCall(config, {
        tool: "view_image",
        workspaceId,
        path,
        success: true,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return response;
    },
  );

  registerAppTool(
    server,
    toolNames.write,
    {
      title: "Write file",
      description:
        `Create or completely overwrite a file inside an open workspace. Prefer ${toolNames.edit} for targeted changes to existing files. Call open_workspace first and pass workspaceId.`,
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        path: z
          .string()
          .describe("File path to write, relative to the workspace root."),
        content: z.string().describe("Complete new file content."),
      },
      outputSchema: resultOutputSchema(),
      ...toolWidgetDescriptorMeta(config, "write"),
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async ({ workspaceId, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);
      workspaces.resolvePath(workspace, input.path);
      const response = await writeFileTool(input, {
        cwd: workspace.root,
        root: workspace.root,
      });

      if (response.isError) {
        logFailedToolResponse(config, {
          tool: toolNames.write,
          workspaceId,
          path: input.path,
        }, response.content, startedAt);
        return response;
      }

      const patch = newFilePatch(input.path, input.content);
      const stats = countDiffStats(patch);
      const summary = {
        ...stats,
        lines: contentLineCount(input.content),
        characters: input.content.length,
      };
      logToolCall(config, {
        tool: toolNames.write,
        workspaceId,
        path: input.path,
        success: true,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return {
        ...response,
        _meta: {
          tool: toolNames.write,
          card: {
            workspaceId,
            path: input.path,
            summary,
            payload: {
              content: response.content,
              patch,
            },
          },
        },
        structuredContent: {
          result: contentText(response.content),
        },
      };
    },
  );

  registerAppTool(
    server,
    toolNames.edit,
    {
      title: "Edit file",
      description:
        `Edit one file inside an open workspace by replacing exact text blocks. Prefer this over ${toolNames.write} for targeted changes. Each oldText must match a unique, non-overlapping region of the original file; merge nearby changes into one edit and keep oldText as small as possible while still unique. Call open_workspace first and pass workspaceId.`,
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        path: z
          .string()
          .describe("File path to edit, relative to the workspace root."),
        edits: z
          .array(
            z.object({
              oldText: z
                .string()
                .describe(
                  "Exact text to replace. Must match uniquely in the original file.",
                ),
              newText: z.string().describe("Replacement text."),
            }),
          )
          .min(1),
      },
      outputSchema: resultOutputSchema({
        status: z.literal("applied"),
      }),
      ...toolWidgetDescriptorMeta(config, "edit"),
      annotations: EDIT_TOOL_ANNOTATIONS,
    },
    async ({ workspaceId, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);
      workspaces.resolvePath(workspace, input.path);
      const response = await editFileTool(input, {
        cwd: workspace.root,
        root: workspace.root,
      });

      if (response.isError) {
        logFailedToolResponse(config, {
          tool: toolNames.edit,
          workspaceId,
          path: input.path,
        }, response.content, startedAt);
        return response;
      }

      const stats = countDiffStats(
        response.details?.patch ?? response.details?.diff,
      );
      const summary = {
        ...stats,
        editCount: input.edits.length,
      };
      const editResultText = `Edited ${input.path} (+${stats.additions} -${stats.removals}).`;
      const editContent = [textBlock(editResultText)];
      logToolCall(config, {
        tool: toolNames.edit,
        workspaceId,
        path: input.path,
        success: true,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return {
        content: editContent,
        _meta: {
          tool: toolNames.edit,
          card: {
            workspaceId,
            path: input.path,
            summary,
            payload: {
              diff: response.details?.diff,
              patch: response.details?.patch,
            },
          },
        },
        structuredContent: {
          status: "applied",
          result: contentText(editContent),
        },
      };
    },
  );

  if (config.widgets === "changes") {
    registerAppTool(
      server,
      "show_changes",
      {
        title: "Show changes",
        description:
          "Show aggregate file changes in an open workspace since the last shown checkpoint or since the workspace was opened. After you create, edit, or overwrite files, call this once when the related file changes are complete so the user can inspect the combined diff.",
        inputSchema: {
          workspaceId: z
            .string()
            .describe("Workspace identifier returned by open_workspace."),
          since: z
            .enum(["last_shown", "workspace_open"])
            .optional()
            .describe("Defaults to last_shown. Use workspace_open to compare against the initial open_workspace checkpoint."),
          markReviewed: z
            .boolean()
            .optional()
            .describe("Defaults to true. When true, advances the last shown checkpoint to the current workspace state."),
        },
        outputSchema: resultOutputSchema(),
        ...toolWidgetDescriptorMeta(config, "show_changes"),
        annotations: { readOnlyHint: true },
      },
      async ({ workspaceId, since, markReviewed }) => {
        const startedAt = performance.now();
        const workspace = workspaces.getWorkspace(workspaceId);
        const review = await reviewCheckpoints.reviewChanges({
          workspaceId,
          root: workspace.root,
          since: since ?? "last_shown",
          markReviewed: markReviewed ?? true,
        });

        const content = [textBlock(review.result)];
        logToolCall(config, {
          tool: "show_changes",
          workspaceId,
          success: true,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          content,
          _meta: {
            tool: "show_changes",
            card: {
              workspaceId,
              summary: review.summary,
              files: review.files,
              payload: {
                patch: review.patch,
              },
            },
          },
          structuredContent: {
            result: contentText(content),
          },
        };
      },
    );
  }

  if (!config.minimalTools) {
    registerAppTool(
      server,
      toolNames.grep,
      {
        title: config.toolNaming === "short" ? "Grep" : "Grep files",
        description:
          "Search file contents inside an open workspace. Use this before broad reads when looking for symbols, text, or usage sites. Respects project ignore rules. Call open_workspace first and pass workspaceId.",
        inputSchema: {
          workspaceId: z
            .string()
            .describe("Workspace identifier returned by open_workspace."),
          pattern: z.string().describe("Search pattern."),
          path: z
            .string()
            .optional()
            .describe(
              "Optional path or glob scope relative to the workspace root.",
            ),
          include: z.string().optional().describe("Optional include glob."),
        },
        outputSchema: resultOutputSchema(),
        ...toolWidgetDescriptorMeta(config, "search"),
        annotations: { readOnlyHint: true },
      },
      async ({ workspaceId, ...input }) => {
        const startedAt = performance.now();
        const workspace = workspaces.getWorkspace(workspaceId);
        if (input.path) workspaces.resolvePath(workspace, input.path);
        const response = await grepFilesTool(input, {
          cwd: workspace.root,
          root: workspace.root,
        });

        if (response.isError) {
          logFailedToolResponse(config, {
            tool: toolNames.grep,
            workspaceId,
            path: input.path,
          }, response.content, startedAt);
          return response;
        }

        const summary = {
          pattern: input.pattern,
          scope: input.path ?? ".",
          ...textSummary(response.content),
        };
        logToolCall(config, {
          tool: toolNames.grep,
          workspaceId,
          path: input.path,
          success: true,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          ...response,
          _meta: {
            tool: toolNames.grep,
            card: {
              workspaceId,
              path: input.path,
              summary,
              payload: { content: response.content },
            },
          },
          structuredContent: {
            result: contentText(response.content),
          },
        };
      },
    );

    registerAppTool(
      server,
      toolNames.glob,
      {
        title: config.toolNaming === "short" ? "Glob" : "Find files",
        description:
          "Find files by glob pattern inside an open workspace. Use this to discover filenames or narrow file sets before reading. Respects project ignore rules. Call open_workspace first and pass workspaceId.",
        inputSchema: {
          workspaceId: z
            .string()
            .describe("Workspace identifier returned by open_workspace."),
          pattern: z.string().describe("File glob pattern."),
          path: z
            .string()
            .optional()
            .describe("Optional path scope relative to the workspace root."),
        },
        outputSchema: resultOutputSchema(),
        ...toolWidgetDescriptorMeta(config, "search"),
        annotations: { readOnlyHint: true },
      },
      async ({ workspaceId, ...input }) => {
        const startedAt = performance.now();
        const workspace = workspaces.getWorkspace(workspaceId);
        if (input.path) workspaces.resolvePath(workspace, input.path);
        const response = await findFilesTool(input, {
          cwd: workspace.root,
          root: workspace.root,
        });

        if (response.isError) {
          logFailedToolResponse(config, {
            tool: toolNames.glob,
            workspaceId,
            path: input.path,
          }, response.content, startedAt);
          return response;
        }

        const summary = {
          pattern: input.pattern,
          scope: input.path ?? ".",
          ...textSummary(response.content),
        };
        logToolCall(config, {
          tool: toolNames.glob,
          workspaceId,
          path: input.path,
          success: true,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          ...response,
          _meta: {
            tool: toolNames.glob,
            card: {
              workspaceId,
              path: input.path,
              summary,
              payload: { content: response.content },
            },
          },
          structuredContent: {
            result: contentText(response.content),
          },
        };
      },
    );

    registerAppTool(
      server,
      toolNames.ls,
      {
        title: config.toolNaming === "short" ? "Ls" : "List directory",
        description:
          "List a directory inside an open workspace. Use this for directory inspection before reading files. Call open_workspace first and pass workspaceId.",
        inputSchema: {
          workspaceId: z
            .string()
            .describe("Workspace identifier returned by open_workspace."),
          path: z
            .string()
            .describe(
              "Directory path to list, relative to the workspace root.",
            ),
        },
        outputSchema: resultOutputSchema(),
        ...toolWidgetDescriptorMeta(config, "directory"),
        annotations: { readOnlyHint: true },
      },
      async ({ workspaceId, ...input }) => {
        const startedAt = performance.now();
        const workspace = workspaces.getWorkspace(workspaceId);
        workspaces.resolvePath(workspace, input.path);
        const response = await listDirectoryTool(input, {
          cwd: workspace.root,
          root: workspace.root,
        });

        if (response.isError) {
          logFailedToolResponse(config, {
            tool: toolNames.ls,
            workspaceId,
            path: input.path,
          }, response.content, startedAt);
          return response;
        }

        const summary = textSummary(response.content);
        logToolCall(config, {
          tool: toolNames.ls,
          workspaceId,
          path: input.path,
          success: true,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          ...response,
          _meta: {
            tool: toolNames.ls,
            card: {
              workspaceId,
              path: input.path,
              summary,
              payload: { content: response.content },
            },
          },
          structuredContent: {
            result: contentText(response.content),
          },
        };
      },
    );
  }

  registerAppTool(
    server,
    toolNames.shell,
    {
      title: config.toolNaming === "short" ? "Bash" : "Run shell",
      description: config.minimalTools
        ? `Run a shell command inside an open workspace. Use for tests, builds, git inspection, package scripts, search, file discovery, and directory inspection. In minimal tool mode, ${toolNames.grep}, ${toolNames.glob}, and ${toolNames.ls} are disabled; command-line search tools may be used instead. Prefer ${toolNames.read} for direct file reads and the dedicated edit/write tools for source changes. Shell commands execute with the local user's privileges and can modify files or run programs beyond what path-scoped file tools can do, so this tool requires the privileged auvrynt:process scope. Call open_workspace first and pass workspaceId.`
        : `Run a shell command inside an open workspace for tests, builds, git inspection, package scripts, and commands that genuinely require a shell. Prefer ${toolNames.read}, ${toolNames.grep}, ${toolNames.glob}, and ${toolNames.ls} for inspection and the dedicated edit/write tools for source changes. Shell commands execute with the local user's privileges and can modify files or run programs beyond what path-scoped file tools can do, so this tool requires the privileged auvrynt:process scope. Call open_workspace first and pass workspaceId.`,
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        command: z
          .string()
          .describe(
            `Shell command to run. This executes with local-user privileges; prefer ${toolNames.edit} or ${toolNames.write} for ordinary source-file changes.`,
          ),
        workingDirectory: z
          .string()
          .optional()
          .describe(
            "Optional working directory relative to the workspace root. Defaults to the workspace root.",
          ),
        timeout: z
          .number()
          .positive()
          .max(300)
          .optional()
          .describe("Timeout in seconds. Defaults to 30, max 300."),
      },
      outputSchema: resultOutputSchema(),
      ...toolWidgetDescriptorMeta(config, "shell"),
      annotations: SHELL_TOOL_ANNOTATIONS,
    },
    async ({ workspaceId, workingDirectory, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);
      const cwd = workspaces.resolveWorkingDirectory(
        workspace,
        workingDirectory,
      );
      const response = await runShellTool(input, {
        cwd,
        root: workspace.root,
      });

      if (response.isError) {
        logFailedToolResponse(config, {
          tool: toolNames.shell,
          workspaceId,
          workingDirectory: workingDirectory ?? ".",
          command: input.command,
          commandLength: input.command.length,
        }, response.content, startedAt);
        return response;
      }

      const summary = {
        command: input.command,
        workingDirectory: workingDirectory ?? ".",
        ...textSummary(response.content),
      };
      logToolCall(config, {
        tool: toolNames.shell,
        workspaceId,
        workingDirectory: workingDirectory ?? ".",
        command: input.command,
        commandLength: input.command.length,
        success: true,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return {
        ...response,
        _meta: {
          tool: toolNames.shell,
          card: {
            workspaceId,
            path: workingDirectory,
            summary,
            payload: { content: response.content },
          },
        },
        structuredContent: {
          result: contentText(response.content),
        },
      };
    },
  );

  // --- Process Management Tools ---
  const WORKSPACE_ID_SCHEMA = z.string().describe("Workspace identifier returned by open_workspace.");

  registerAppTool(
    server,
    "get_connection_status",
    {
      title: "Connection status",
      description: "Automatically check which local integrations are connected for this workspace: MCP, Blender, Godot, browser support, Chrome MCP availability, and tracked processes.",
      inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
      ...toolWidgetDescriptorMeta(config, "read"),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ workspaceId }, extra) => {
      try {
        const result = await getConnectionStatus(
          workspaces,
          processManager,
          config,
          extra.authInfo?.scopes ?? [],
          workspaceId,
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `get_connection_status failed: ${message}` }], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "start_process",
    {
      title: "Start process",
      description: "Start a persistent background process (server, app, game) inside an open workspace. Returns a processId. Use get_process_logs to tail output. Do not use run_shell for long-running processes.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        command: z.string().describe("Shell command to run."),
        workingDirectory: z.string().optional().describe("Working directory relative to workspace root."),
        environment: z.record(z.string(), z.string()).optional().describe("Additional environment variables (secrets will be redacted in responses)."),
      },
      ...toolWidgetDescriptorMeta(config, "shell"),
      annotations: PROCESS_ANNOTATIONS,
    },
    async ({ workspaceId, command, workingDirectory, environment }) => {
      const startedAt = performance.now();
      try {
        const result = processManager.startProcess({ workspaceId, command, workingDirectory, environment });
        logToolCall(config, { tool: "start_process", workspaceId, command, success: true, durationMs: Math.round(performance.now() - startedAt) });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logToolCall(config, { tool: "start_process", workspaceId, command, success: false, durationMs: Math.round(performance.now() - startedAt), error: msg });
        return { content: [{ type: "text" as const, text: `start_process failed: ${msg}` }], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "get_process_logs",
    {
      title: "Get process logs",
      description: "Retrieve recent stdout/stderr from a running or exited process started by start_process.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        processId: z.string().describe("Process ID returned by start_process."),
        lines: z.number().int().optional().describe("Number of recent lines to return (default 100, max 500)."),
        stream: z.enum(["stdout", "stderr", "both"]).optional().describe("Which stream to return."),
      },
      ...toolWidgetDescriptorMeta(config, "shell"),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ workspaceId, processId, lines, stream }) => {
      try {
        const result = processManager.getProcessLogs({ workspaceId, processId, lines, stream });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `get_process_logs failed: ${msg}` }], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "list_processes",
    {
      title: "List processes",
      description: "List all tracked processes for the current workspace.",
      inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
      ...toolWidgetDescriptorMeta(config, "shell"),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ workspaceId }) => {
      try {
        const result = processManager.listProcesses({ workspaceId });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `list_processes failed: ${msg}` }], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "stop_process",
    {
      title: "Stop process",
      description: "Stop a tracked process gracefully. Set force=true to kill the process tree immediately.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        processId: z.string().describe("Process ID returned by start_process."),
        force: z.boolean().optional().describe("If true, forcibly kill the process tree."),
      },
      ...toolWidgetDescriptorMeta(config, "shell"),
      annotations: PROCESS_ANNOTATIONS,
    },
    async ({ workspaceId, processId, force }) => {
      try {
        const result = await processManager.stopProcess({ workspaceId, processId, force });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `stop_process failed: ${msg}` }], isError: true };
      }
    },
  );

  // --- Project Discovery and Search Tools ---
  registerAppTool(
    server,
    "glob_files",
    {
      title: "Glob files",
      description: "Find files by glob pattern within the workspace. Respects common ignore directories. Returns workspace-relative paths.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        pattern: z.string().describe("Glob pattern such as *.ts or src/**/*.json."),
        basePath: z.string().optional().describe("Base directory relative to workspace root to search in."),
        maxResults: z.number().int().optional().describe("Maximum results (default 100, max 1000)."),
      },
      ...toolWidgetDescriptorMeta(config, "search"),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ workspaceId, pattern, basePath, maxResults }) => {
      try {
        const result = await globFiles(workspaces, { workspaceId, pattern, basePath, maxResults });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `glob_files failed: ${msg}` }], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "search_text",
    {
      title: "Search text",
      description: "Search for text across workspace files. Returns file path, line, column, match snippet, and context lines.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        query: z.string().describe("Text or pattern to search for."),
        paths: z.array(z.string()).optional().describe("Limit search to these workspace-relative paths."),
        filePattern: z.string().optional().describe("Filter by file extension pattern, e.g. *.ts."),
        caseSensitive: z.boolean().optional().describe("Default false."),
        maxResults: z.number().int().optional().describe("Max matches (default 50, max 500)."),
      },
      ...toolWidgetDescriptorMeta(config, "search"),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ workspaceId, query, paths, filePattern, caseSensitive, maxResults }) => {
      try {
        const result = await searchText(workspaces, { workspaceId, query, paths, filePattern, caseSensitive, maxResults });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `search_text failed: ${msg}` }], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "inspect_project",
    {
      title: "Inspect project",
      description: "Detect project type, package managers, frameworks, and recommended build/run/test commands. Supports Node.js, TypeScript, .NET, Godot, Python, and Git.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        path: z.string().optional().describe("Subdirectory to inspect, relative to workspace root."),
      },
      ...toolWidgetDescriptorMeta(config, "search"),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ workspaceId, path }) => {
      try {
        const result = await inspectProject(workspaces, { workspaceId, path });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `inspect_project failed: ${msg}` }], isError: true };
      }
    },
  );

  // --- Web Development Tools ---
  registerAppTool(
    server,
    "start_dev_server",
    {
      title: "Start dev server",
      description: "Launch a local web development server as a persistent process. Auto-detects the dev script from the project. Returns a processId for use with get_process_logs and stop_process.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        command: z.string().optional().describe("Override command to run (e.g. 'npm run dev'). Auto-detected if omitted."),
        workingDirectory: z.string().optional().describe("Working directory relative to workspace root."),
        port: z.number().int().optional().describe("Expected port for the dev server."),
      },
      ...toolWidgetDescriptorMeta(config, "shell"),
      annotations: PROCESS_ANNOTATIONS,
    },
    async ({ workspaceId, command, workingDirectory, port }) => {
      try {
        const result = await startDevServer(workspaces, processManager, { workspaceId, command, workingDirectory, port });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `start_dev_server failed: ${msg}` }], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "capture_page_screenshot",
    {
      title: "Capture page screenshot",
      description: "Screenshot a local or remote web page using Playwright. Saves to workspace and returns as MCP image content. Blocks unsafe schemes and SSRF addresses.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        url: z.string().describe("Page URL (http/https only). Local dev URLs like localhost:3000 are allowed."),
        outputPath: z.string().describe("Workspace-relative path to save the screenshot PNG."),
        fullPage: z.boolean().optional().describe("Capture full scrollable page (default false)."),
        viewportWidth: z.number().int().optional().describe("Viewport width in pixels (default 1280, max 3840)."),
        viewportHeight: z.number().int().optional().describe("Viewport height in pixels (default 800, max 2160)."),
        waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional().describe("Page load event to wait for."),
        delayMs: z.number().int().optional().describe("Additional delay in ms after load (max 5000)."),
      },
      ...toolWidgetDescriptorMeta(config, "write"),
      annotations: WEB_WRITE_ANNOTATIONS,
    },
    async ({ workspaceId, url, outputPath, fullPage, viewportWidth, viewportHeight, waitUntil, delayMs }) => {
      return capturePageScreenshot(workspaces, { workspaceId, url, outputPath, fullPage, viewportWidth, viewportHeight, waitUntil, delayMs });
    },
  );

  registerAppTool(
    server,
    "inspect_page",
    {
      title: "Inspect page",
      description: "Inspect DOM structure, headings, buttons, links, and console errors of a web page using Playwright.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        url: z.string().describe("Page URL to inspect."),
        includeAccessibilityTree: z.boolean().optional().describe("Include accessibility tree."),
        includeComputedStyles: z.boolean().optional().describe("Include key computed styles."),
        maxElements: z.number().int().optional().describe("Max elements per category (default 20)."),
      },
      ...toolWidgetDescriptorMeta(config, "read"),
      annotations: WEB_READ_ANNOTATIONS,
    },
    async ({ workspaceId, url, includeAccessibilityTree, includeComputedStyles, maxElements }) => {
      return inspectPage(workspaces, { workspaceId, url, includeAccessibilityTree, includeComputedStyles, maxElements });
    },
  );

  registerAppTool(
    server,
    "test_responsive_page",
    {
      title: "Test responsive page",
      description: "Capture the same web page across 1–6 bounded viewports using Playwright. Saves PNGs inside the workspace and returns each screenshot for visual comparison.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        url: z.string().describe("Page URL to test."),
        outputDirectory: z.string().describe("Workspace-relative directory for viewport screenshots."),
        viewports: z.array(z.object({
          name: z.string(),
          width: z.number().int(),
          height: z.number().int(),
        })).max(6).optional().describe("Optional viewport set. Defaults to mobile, tablet, and desktop."),
        fullPage: z.boolean().optional().describe("Capture the full scrollable page (default true)."),
      },
      ...toolWidgetDescriptorMeta(config, "write"),
      annotations: WEB_WRITE_ANNOTATIONS,
    },
    async ({ workspaceId, url, outputDirectory, viewports, fullPage }) =>
      testResponsivePage(workspaces, { workspaceId, url, outputDirectory, viewports, fullPage }),
  );

  // --- Image Inspection and Comparison Tools ---
  registerAppTool(
    server,
    "inspect_image",
    {
      title: "Inspect image",
      description: "Return format, dimensions, file size, alpha, and basic color info for a local image. Does not resize or recompress.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        path: z.string().describe("Workspace-relative image path."),
      },
      ...toolWidgetDescriptorMeta(config, "read"),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ workspaceId, path }) => inspectImage(workspaces, { workspaceId, path }),
  );

  registerAppTool(
    server,
    "compare_images",
    {
      title: "Compare images",
      description: "Pixel-level comparison of two workspace images. Returns exact match percentage, changed pixel count, and optional diff PNG.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        referencePath: z.string().describe("Reference image path (workspace-relative)."),
        candidatePath: z.string().describe("Candidate image path to compare (workspace-relative)."),
        diffOutputPath: z.string().optional().describe("Workspace-relative path to save the diff image."),
        threshold: z.number().optional().describe("Per-channel tolerance (0–255, default 0)."),
        ignoreTransparentPixels: z.boolean().optional().describe("Skip fully transparent pixels in comparison."),
      },
      ...toolWidgetDescriptorMeta(config, "write"),
      annotations: MUTATING_ANNOTATIONS,
    },
    async ({ workspaceId, referencePath, candidatePath, diffOutputPath, threshold, ignoreTransparentPixels }) =>
      compareImages(workspaces, { workspaceId, referencePath, candidatePath, diffOutputPath, threshold, ignoreTransparentPixels }),
  );

  registerAppTool(
    server,
    "inspect_sprite",
    {
      title: "Inspect sprite",
      description: "Analyze a sprite sheet or pixel-art image: dimensions, probable grid, palette, and frame bounding boxes.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        path: z.string().describe("Workspace-relative image path."),
        expectedCellWidth: z.number().int().optional().describe("Expected cell width for grid detection."),
        expectedCellHeight: z.number().int().optional().describe("Expected cell height for grid detection."),
      },
      ...toolWidgetDescriptorMeta(config, "read"),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ workspaceId, path, expectedCellWidth, expectedCellHeight }) =>
      inspectSprite(workspaces, { workspaceId, path, expectedCellWidth, expectedCellHeight }),
  );

  registerAppTool(
    server,
    "split_sprite_sheet",
    {
      title: "Split sprite sheet",
      description: "Split a sprite sheet into individual frame images saved inside the workspace. Does not overwrite existing files.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        path: z.string().describe("Workspace-relative sprite sheet path."),
        columns: z.number().int().describe("Number of columns."),
        rows: z.number().int().describe("Number of rows."),
        outputDirectory: z.string().describe("Workspace-relative output directory."),
        namingPattern: z.string().optional().describe("Frame filename pattern with {col} and {row} placeholders."),
      },
      ...toolWidgetDescriptorMeta(config, "write"),
      annotations: MUTATING_ANNOTATIONS,
    },
    async ({ workspaceId, path, columns, rows, outputDirectory, namingPattern }) =>
      splitSpriteSheet(workspaces, { workspaceId, path, columns, rows, outputDirectory, namingPattern }),
  );

  // --- .NET Tools ---
  registerAppTool(
    server,
    "inspect_dotnet_project",
    {
      title: "Inspect .NET project",
      description: "Parse a .csproj or .fsproj file and return SDK style, target frameworks, packages, test framework, and project references.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        projectPath: z.string().describe("Workspace-relative path to .csproj or .fsproj."),
      },
      ...toolWidgetDescriptorMeta(config, "read"),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ workspaceId, projectPath }) => {
      try {
        const result = await inspectDotnetProject(workspaces, { workspaceId, projectPath });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: msg }], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "dotnet_restore",
    {
      title: "dotnet restore",
      description: "Run dotnet restore on a .NET project. Returns success, duration, and key output.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        projectPath: z.string().describe("Workspace-relative path to .csproj/.fsproj/.sln."),
      },
      ...toolWidgetDescriptorMeta(config, "shell"),
      annotations: PROCESS_ANNOTATIONS,
    },
    async ({ workspaceId, projectPath }) => {
      try {
        const result = await dotnetRestore(workspaces, { workspaceId, projectPath });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: msg }], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "dotnet_build",
    {
      title: "dotnet build",
      description: "Build a .NET project. Returns structured errors, warnings, and duration. Does not return raw build output.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        projectPath: z.string().describe("Workspace-relative path to .csproj/.fsproj/.sln."),
        configuration: z.enum(["Debug", "Release"]).optional().describe("Build configuration."),
        noRestore: z.boolean().optional().describe("Skip restore step."),
      },
      ...toolWidgetDescriptorMeta(config, "shell"),
      annotations: PROCESS_ANNOTATIONS,
    },
    async ({ workspaceId, projectPath, configuration, noRestore }) => {
      try {
        const result = await dotnetBuild(workspaces, { workspaceId, projectPath, configuration, noRestore });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: msg }], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "dotnet_test",
    {
      title: "dotnet test",
      description: "Run .NET tests. Returns pass/fail/skip counts, failed test names, and assertion messages.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        projectPath: z.string().describe("Workspace-relative path to test .csproj/.sln."),
        configuration: z.enum(["Debug", "Release"]).optional(),
        filter: z.string().optional().describe("Test filter expression."),
        noBuild: z.boolean().optional(),
      },
      ...toolWidgetDescriptorMeta(config, "shell"),
      annotations: PROCESS_ANNOTATIONS,
    },
    async ({ workspaceId, projectPath, configuration, filter, noBuild }) => {
      try {
        const result = await dotnetTest(workspaces, { workspaceId, projectPath, configuration, filter, noBuild });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: msg }], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "dotnet_run",
    {
      title: "dotnet run",
      description: "Run a .NET project as a persistent process. Returns a processId. Use get_process_logs to tail output.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        projectPath: z.string().describe("Workspace-relative path to .csproj."),
        configuration: z.enum(["Debug", "Release"]).optional(),
        arguments: z.array(z.string()).optional().describe("Arguments to pass to the application."),
        environment: z.record(z.string(), z.string()).optional().describe("Environment variables."),
      },
      ...toolWidgetDescriptorMeta(config, "shell"),
      annotations: PROCESS_ANNOTATIONS,
    },
    async ({ workspaceId, projectPath, configuration, arguments: args, environment }) => {
      try {
        const result = await dotnetRun(workspaces, processManager, { workspaceId, projectPath, configuration, arguments: args, environment });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: msg }], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "dotnet_format",
    {
      title: "dotnet format",
      description: "Format a .NET project. Use verifyOnly=true to check without modifying files.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        projectPath: z.string().describe("Workspace-relative path to .csproj/.sln."),
        verifyOnly: z.boolean().optional().describe("If true, check formatting without modifying files."),
      },
      ...toolWidgetDescriptorMeta(config, "shell"),
      annotations: MUTATING_ANNOTATIONS,
    },
    async ({ workspaceId, projectPath, verifyOnly }) => {
      try {
        const result = await dotnetFormat(workspaces, { workspaceId, projectPath, verifyOnly });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: msg }], isError: true };
      }
    },
  );

  // --- Godot Tools ---
  registerAppTool(
    server,
    "detect_godot_project",
    {
      title: "Detect Godot project",
      description: "Detect a Godot 4 project in the workspace. Reads project.godot for name, main scene, renderer, features, autoloads, and input actions.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        path: z.string().optional().describe("Subdirectory to search, relative to workspace root."),
      },
      ...toolWidgetDescriptorMeta(config, "read"),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ workspaceId, path }) => {
      try {
        const result = await detectGodotProject(workspaces, { workspaceId, path });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: msg }], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "godot_run",
    {
      title: "Run Godot",
      description: "Launch a Godot 4 game or editor as a persistent process. Returns a processId. Configure Godot executable via GODOT_EXECUTABLE env var.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        projectPath: z.string().describe("Workspace-relative path to the project directory (containing project.godot)."),
        scenePath: z.string().optional().describe("Workspace-relative scene path to run."),
        editor: z.boolean().optional().describe("Open Godot editor instead of running game."),
        debug: z.boolean().optional().describe("Enable debug mode."),
        additionalArguments: z.array(z.string()).optional().describe("Additional CLI arguments."),
      },
      ...toolWidgetDescriptorMeta(config, "shell"),
      annotations: PROCESS_ANNOTATIONS,
    },
    async ({ workspaceId, projectPath, scenePath, editor, debug, additionalArguments }) => {
      try {
        const result = await godotRun(workspaces, processManager, { workspaceId, projectPath, scenePath, editor, debug, additionalArguments });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: msg }], isError: true };
      }
    },
  );

  registerAppTool(
    server,
    "inspect_godot_scene",
    {
      title: "Inspect Godot scene",
      description: "Parse a Godot .tscn text scene file. Returns node tree, types, external resources, signals, and properties. Binary .scn files are not supported.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        scenePath: z.string().describe("Workspace-relative path to .tscn scene file."),
      },
      ...toolWidgetDescriptorMeta(config, "read"),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ workspaceId, scenePath }) => {
      try {
        const result = await inspectGodotScene(workspaces, { workspaceId, scenePath });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: msg }], isError: true };
      }
    },
  );

  // --- Window Capture Tools ---
  registerAppTool(
    server,
    "capture_window",
    {
      title: "Capture window",
      description: "Capture a running application window tracked by Auvrynt. Returns the screenshot as MCP image content and saves it in the workspace. Windows only.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        processId: z.string().optional().describe("Process ID from start_process to target."),
        windowTitle: z.string().optional().describe("Window title substring to target."),
        outputPath: z.string().describe("Workspace-relative path to save the screenshot PNG."),
      },
      ...toolWidgetDescriptorMeta(config, "write"),
      annotations: MUTATING_ANNOTATIONS,
    },
    async ({ workspaceId, processId, windowTitle, outputPath }) =>
      captureWindow(workspaces, processManager, { workspaceId, processId, windowTitle, outputPath }),
  );

  registerAppTool(
    server,
    "godot_capture_game",
    {
      title: "Capture Godot game",
      description: "Capture a screenshot of a running Godot game tracked by a Auvrynt processId. Wraps capture_window.",
      inputSchema: {
        workspaceId: WORKSPACE_ID_SCHEMA,
        processId: z.string().describe("Process ID from godot_run."),
        outputPath: z.string().describe("Workspace-relative path to save the screenshot PNG."),
      },
      ...toolWidgetDescriptorMeta(config, "write"),
      annotations: MUTATING_ANNOTATIONS,
    },
    async ({ workspaceId, processId, outputPath }) =>
      captureWindow(workspaces, processManager, { workspaceId, processId, outputPath }),
  );

  // ──────────────────────────────────────────────────────────────────────────
  // GODOT C# / .NET TOOLS
  // ──────────────────────────────────────────────────────────────────────────

  // Phase 1 & 2: Environment + Project Inspection
  registerAppTool(server, "godot_dotnet_environment", {
    title: "Godot .NET environment",
    description: "Detect and validate the Godot .NET editor, .NET SDK, architecture, and project target frameworks. Run this before the first C# build.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, projectPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await inspectGodotDotnetEnvironment(workspaces, { workspaceId, projectPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "inspect_godot_dotnet_project", {
    title: "Inspect Godot .NET project",
    description: "Inspect a Godot 4 C# project: project.godot, .csproj, .sln, target frameworks, Godot.NET.Sdk, autoloads, input actions, C# scripts, and whether solution regeneration is needed.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, projectPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await inspectGodotDotnetProject(workspaces, { workspaceId, projectPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  // Phase 3: Solution generation, restore, build, clean
  registerAppTool(server, "godot_build_solutions", {
    title: "Godot build solutions",
    description: "Run Godot --build-solutions to generate or regenerate the .sln and .csproj for a C# project. Run after adding C# files.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, projectPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await godotBuildSolutions(workspaces, { workspaceId, projectPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_dotnet_restore", {
    title: "dotnet restore (Godot)",
    description: "Restore NuGet packages for a Godot C# project. Credentials and secrets are redacted.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), lockedMode: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, projectPath, lockedMode }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await godotDotnetRestore(workspaces, { workspaceId, projectPath, lockedMode }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_dotnet_build", {
    title: "dotnet build (Godot)",
    description: "Build a Godot C# project. Returns structured C# compiler errors, MSBuild errors, and Godot source-generator issues.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), configuration: z.enum(["Debug", "Release"]).optional(), noRestore: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, projectPath, configuration, noRestore }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await godotDotnetBuild(workspaces, { workspaceId, projectPath, configuration, noRestore }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_dotnet_clean", {
    title: "dotnet clean (Godot)",
    description: "Remove Godot C# build outputs (bin/ and obj/). Mutating.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), configuration: z.enum(["Debug", "Release"]).optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, projectPath, configuration }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await godotDotnetClean(workspaces, { workspaceId, projectPath, configuration }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  // Phase 4 & 5: Running + Runtime Logs
  registerAppTool(server, "godot_run_project", {
    title: "Run Godot project",
    description: "Run a Godot C# project as a persistent process. Returns a processId. Use godot_get_runtime_logs to inspect output.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), debug: z.boolean().optional(), windowed: z.boolean().optional(), resolution: z.object({ width: z.number().int(), height: z.number().int() }).optional(), additionalGodotArguments: z.array(z.string()).optional(), userArguments: z.array(z.string()).optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, projectPath, debug, windowed, resolution, additionalGodotArguments, userArguments }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await godotRunProject(workspaces, processManager, { workspaceId, projectPath, debug, windowed, resolution, additionalGodotArguments, userArguments }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_run_scene", {
    title: "Run Godot scene",
    description: "Run a single .tscn scene in a Godot C# project as a persistent process.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), scenePath: z.string(), debug: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, projectPath, scenePath, debug }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await godotRunScene(workspaces, processManager, { workspaceId, projectPath, scenePath, debug }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_stop", {
    title: "Stop Godot process",
    description: "Gracefully stop a Godot process tracked by Auvrynt for this workspace.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, processId: z.string() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, processId }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await processManager.stopProcess({ workspaceId, processId }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_get_runtime_logs", {
    title: "Get Godot runtime logs",
    description: "Get structured and categorized runtime logs from a running Godot C# process. Groups C# exceptions, stack traces, Godot errors, and GD.Print output.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, processId: z.string(), severity: z.array(z.enum(["error", "warning", "info", "print"])).optional(), lines: z.number().int().optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, processId, severity, lines }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(getGodotRuntimeLogs(processManager, { workspaceId, processId, severity, lines }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  // Phase 6: Validation + Import
  registerAppTool(server, "godot_validate_project", {
    title: "Validate Godot project",
    description: "Headless Godot project validation: optionally build C#, detect import errors, missing resources, invalid scripts, and plugin failures.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), buildCsharpFirst: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, projectPath, buildCsharpFirst }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await godotValidateProject(workspaces, { workspaceId, projectPath, buildCsharpFirst }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_import_assets", {
    title: "Godot import assets",
    description: "Run Godot in headless editor mode to import pending assets.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, projectPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await godotImportAssets(workspaces, { workspaceId, projectPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  // Phase 7: Editor Bridge
  registerAppTool(server, "godot_editor_connect", {
    title: "Connect Godot editor bridge",
    description: "Connect Auvrynt to the Godot editor bridge plugin. Enables live scene-tree inspection, property editing, node mutation, and UndoRedo.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), host: z.string().optional(), port: z.number().int().optional(), token: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, projectPath, host, port, token }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await godotEditorConnect(workspaces, { workspaceId, projectPath, host, port, token }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_editor_status", {
    title: "Godot editor bridge status",
    description: "Return current Godot editor bridge connection status.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await godotEditorStatus({ workspaceId }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_editor_disconnect", {
    title: "Disconnect Godot editor bridge",
    description: "Disconnect Auvrynt from the Godot editor bridge. Does not close the editor.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId }) => {
    return { content: [{ type: "text" as const, text: JSON.stringify(godotEditorDisconnect({ workspaceId }), null, 2) }] };
  });

  // Phase 8: Scene Tree Inspection (requires editor bridge)
  registerAppTool(server, "godot_get_scene_tree", {
    title: "Get Godot scene tree",
    description: "Get the edited or remote runtime scene tree via the Godot editor bridge.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, mode: z.enum(["edited", "remote"]).optional(), maxDepth: z.number().int().optional() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, mode, maxDepth }) => {
    try {
      const client = getBridgeClient(workspaceId);
      const result = mode === "remote"
        ? await getRemoteSceneTree({ workspaceId, maxDepth }, client)
        : await client.sendRequest("scene.get_tree", { maxDepth });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  // Phase 9: Runtime Properties
  registerAppTool(server, "godot_get_runtime_property", {
    title: "Get runtime node property",
    description: "Read a live runtime property from a node in the running Godot game via the editor bridge.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, nodePath: z.string(), property: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, nodePath, property }) => {
    try {
      const client = getBridgeClient(workspaceId);
      return { content: [{ type: "text" as const, text: JSON.stringify(await getRuntimeProperty({ workspaceId, nodePath, property }, client), null, 2) }] };
    } catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_get_performance_monitors", {
    title: "Godot performance monitors",
    description: "Get FPS, physics time, memory, node count, draw calls, and orphan node count from the running game via the editor bridge.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => {
    try {
      const client = getBridgeClient(workspaceId);
      return { content: [{ type: "text" as const, text: JSON.stringify(await getPerformanceMonitors({ workspaceId }, client), null, 2) }] };
    } catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  // Phase 10: C# Semantic Tools
  registerAppTool(server, "godot_find_csharp_class", {
    title: "Find C# class",
    description: "Locate a C# class in the workspace. Returns file path, base class, partial status, namespace, [Export] properties, [Signal] delegates, and lifecycle overrides.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, className: z.string() },
    ...toolWidgetDescriptorMeta(config, "search"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, className }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await findCsharpClasses(workspaces, { workspaceId, className }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_get_exported_properties", {
    title: "Get exported C# properties",
    description: "List all [Export] properties on a C# script file.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, scriptPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await getExportedProperties(workspaces, { workspaceId, scriptPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_get_csharp_diagnostics", {
    title: "Get C# diagnostics",
    description: "Scan C# scripts for known anti-patterns and style issues within the workspace.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "search"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, projectPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await getCsharpDiagnostics(workspaces, { workspaceId, projectPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  // Phase 11: Project Settings & Input Map
  registerAppTool(server, "godot_get_project_settings", {
    title: "Get project settings",
    description: "Read all settings from project.godot.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, projectPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await getProjectSettings(workspaces, { workspaceId, projectPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_get_input_map", {
    title: "Get input map",
    description: "Return all input actions from the project.godot input map.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, projectPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await getInputMap(workspaces, { workspaceId, projectPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_get_autoloads", {
    title: "Get autoloads",
    description: "Return all autoloads from project.godot.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, projectPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await getAutoloads(workspaces, { workspaceId, projectPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  // Phase 12: Pixel Art Import
  registerAppTool(server, "godot_apply_pixel_art_import_preset", {
    title: "Apply pixel art import preset",
    description: "Apply nearest-neighbour / lossless import settings to specified texture paths. Does not affect unspecified textures.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, paths: z.array(z.string()) },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, paths }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await applyPixelArtImportPreset(workspaces, { workspaceId, paths }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  // Phase 13: VS Code Config
  registerAppTool(server, "godot_generate_vscode_config", {
    title: "Generate VS Code config",
    description: "Generate or update .vscode/tasks.json and .vscode/launch.json for Godot C# development. Preserves existing entries.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), godotExecutable: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, projectPath, godotExecutable }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await generateVscodeConfig(workspaces, { workspaceId, projectPath, godotExecutable }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  // Phase 14: Export
  registerAppTool(server, "godot_list_export_presets", {
    title: "List export presets",
    description: "List Godot export presets from export_presets.cfg. Never returns secret credentials.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, projectPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await listExportPresets(workspaces, { workspaceId, projectPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_export_project", {
    title: "Export Godot project",
    description: "Export a Godot project using a named preset. Output must be inside the workspace. Credentials are never exposed.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), preset: z.string(), outputPath: z.string(), mode: z.enum(["debug", "release"]).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, projectPath, preset, outputPath, mode }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await exportGodotProject(workspaces, { workspaceId, projectPath, preset, outputPath, mode }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  // Phase 15: Runtime Assertions & Test Sequence
  registerAppTool(server, "godot_assert_node_exists", {
    title: "Assert node exists",
    description: "Assert that a node exists in the remote runtime scene tree via the editor bridge.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, nodePath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, nodePath }) => {
    try {
      const client = getBridgeClient(workspaceId);
      return { content: [{ type: "text" as const, text: JSON.stringify(await godotAssertNodeExists({ workspaceId, nodePath }, client), null, 2) }] };
    } catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_assert_property", {
    title: "Assert runtime property",
    description: "Assert a runtime node property satisfies a comparison (eq/neq/gt/lt/approx/contains/exists).",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, nodePath: z.string(), property: z.string(), comparison: z.enum(["eq", "neq", "gt", "lt", "approx", "contains", "exists", "changed"]), expected: z.unknown() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, nodePath, property, comparison, expected }) => {
    try {
      const client = getBridgeClient(workspaceId);
      return { content: [{ type: "text" as const, text: JSON.stringify(await godotAssertProperty({ workspaceId, nodePath, property, comparison, expected }, client), null, 2) }] };
    } catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_run_test_sequence", {
    title: "Run Godot test sequence",
    description: "Execute a bounded sequence of gameplay steps (press_action, wait, screenshot, assert_property, assert_node_exists, assert_no_errors). Max 50 steps, 30s total.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      processId: z.string(),
      steps: z.array(z.object({
        type: z.string(),
        action: z.string().optional(),
        durationMs: z.number().optional(),
        outputPath: z.string().optional(),
        nodePath: z.string().optional(),
        property: z.string().optional(),
        comparison: z.string().optional(),
        expected: z.unknown().optional(),
      })),
    },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, processId, steps }) => {
    try {
      const client = getBridgeClient(workspaceId);
      return { content: [{ type: "text" as const, text: JSON.stringify(await godotRunTestSequence(workspaces, processManager, { workspaceId, processId, steps: steps as any }, client), null, 2) }] };
    } catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  // Phase 16: Input Simulation
  registerAppTool(server, "godot_press_action", {
    title: "Press Godot input action",
    description: "Inject a Godot input action press via the runtime bridge. Only targets Auvrynt-tracked game processes.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, processId: z.string(), action: z.string(), durationMs: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, processId, action, durationMs }) => {
    try {
      const client = getBridgeClient(workspaceId);
      return { content: [{ type: "text" as const, text: JSON.stringify(await godotPressAction({ workspaceId, processId, action, durationMs }, client), null, 2) }] };
    } catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_release_action", {
    title: "Release Godot input action",
    description: "Inject a Godot input action release via the runtime bridge. Only targets Auvrynt-tracked game processes.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, processId: z.string(), action: z.string() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, processId, action }) => {
    try {
      const client = getBridgeClient(workspaceId);
      return { content: [{ type: "text" as const, text: JSON.stringify(await godotReleaseAction({ workspaceId, processId, action }, client), null, 2) }] };
    } catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_mouse_click", {
    title: "Simulate Godot mouse click",
    description: "Inject a mouse click event at viewport coordinates via the runtime bridge. Only targets Auvrynt-tracked game processes.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, processId: z.string(), x: z.number(), y: z.number(), button: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, processId, x, y, button }) => {
    try {
      const client = getBridgeClient(workspaceId);
      return { content: [{ type: "text" as const, text: JSON.stringify(await godotMouseClick({ workspaceId, processId, x, y, button }, client), null, 2) }] };
    } catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_parse_csharp_exceptions", {
    title: "Parse C# exceptions from runtime logs",
    description: "Parse Godot runtime log lines and extract structured C# exception data including stack frames, inner exceptions, and repeat counts.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, logLines: z.array(z.string()) },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ logLines }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(parseCsharpExceptions(logLines), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_generate_csharp_script", {
    title: "Generate C# script template",
    description: "Generate a Godot C# script boilerplate for a given class name, base type, and optional namespace.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, className: z.string(), baseType: z.string().optional(), namespace: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ className, baseType, namespace }) => {
    try { return { content: [{ type: "text" as const, text: await generateCsharpScript({ className, baseType, namespace }) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GODOT GDSCRIPT TOOLS
  // ──────────────────────────────────────────────────────────────────────────

  registerAppTool(server, "godot_gdscript_environment", {
    title: "Godot GDScript environment",
    description: "Inspect the GDScript project configuration, Godot executable, and project warnings.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, projectPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await inspectGodotGdscriptEnvironment(workspaces, { workspaceId, projectPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_get_gdscript_diagnostics", {
    title: "Get GDScript diagnostics",
    description: "Return static-analysis and parser diagnostics for GDScript files.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), scriptPath: z.string().optional(), includeWarnings: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, projectPath, scriptPath, includeWarnings }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await getGdscriptDiagnostics(workspaces, { workspaceId, projectPath, scriptPath, includeWarnings }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_inspect_gdscript", {
    title: "Inspect GDScript source",
    description: "Inspect class name, base extends, exported properties, methods, signals, node paths, and preloads.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, scriptPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await inspectGdscript(workspaces, { workspaceId, scriptPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_create_gdscript", {
    title: "Create GDScript",
    description: "Create a new GDScript file using empty, node, resource, or plugin templates.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, outputPath: z.string(), baseType: z.string(), className: z.string().optional(), toolScript: z.boolean().optional(), template: z.enum(["empty", "node", "resource", "editor_plugin"]).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, outputPath, baseType, className, toolScript, template }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await createGdscript(workspaces, { workspaceId, outputPath, baseType, className, toolScript, template }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_attach_gdscript", {
    title: "Attach GDScript to node",
    description: "Attach a GDScript script path to a node in the edited scene tree.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, nodePath: z.string(), scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, nodePath, scriptPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await attachGdscript(workspaces, { workspaceId, nodePath, scriptPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_detach_gdscript", {
    title: "Detach GDScript from node",
    description: "Detach script from a node in the edited scene tree.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, nodePath: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, nodePath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await detachGdscript(workspaces, { workspaceId, nodePath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_create_gdscript_signal", {
    title: "Create GDScript signal",
    description: "Declare a new signal in a GDScript file.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string(), signalName: z.string(), parameters: z.array(z.object({ name: z.string(), type: z.string().optional() })).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, scriptPath, signalName, parameters }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await createGdscriptSignal(workspaces, { workspaceId, scriptPath, signalName, parameters }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_create_gdscript_signal_handler", {
    title: "Create signal handler stub",
    description: "Create a callback method stub for handling connected signals.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string(), methodName: z.string(), parameters: z.array(z.object({ name: z.string(), type: z.string().optional() })).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, scriptPath, methodName, parameters }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await createGdscriptSignalHandler(workspaces, { workspaceId, scriptPath, methodName, parameters }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_get_global_classes", {
    title: "Get global classes",
    description: "List all global script classes defined with class_name.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await getGlobalClasses(workspaces, { workspaceId }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_add_class_name", {
    title: "Add class_name to script",
    description: "Declare a new global class_name at the top of a GDScript.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string(), className: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, scriptPath, className }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await addClassName(workspaces, { workspaceId, scriptPath, className }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_remove_class_name", {
    title: "Remove class_name from script",
    description: "Remove the global class_name declaration from a GDScript.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, scriptPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await removeClassName(workspaces, { workspaceId, scriptPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_add_gdscript_autoload", {
    title: "Add GDScript autoload singleton",
    description: "Register a script as a global autoload singleton in project.godot.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string(), singletonName: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, scriptPath, singletonName }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await addGdscriptAutoload(workspaces, { workspaceId, scriptPath, singletonName }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_get_autoload_usage", {
    title: "Find autoload references",
    description: "Search for script/code occurrences referencing an autoload singleton name.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, singletonName: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, singletonName }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await getAutoloadUsage(workspaces, { workspaceId, singletonName }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_inspect_tool_script", {
    title: "Inspect @tool script",
    description: "Check if a script is annotated with @tool and list editor methods.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, scriptPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await inspectToolScript(workspaces, { workspaceId, scriptPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_create_editor_plugin", {
    title: "Create editor plugin",
    description: "Scaffold a new editor plugin addon folder with cfg and gd scripts.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, pluginName: z.string(), description: z.string().optional(), author: z.string().optional(), version: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, pluginName, description, author, version }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await createEditorPlugin(workspaces, { workspaceId, pluginName, description, author, version }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_get_gdscript_dependencies", {
    title: "Get GDScript load dependencies",
    description: "List preload/load file dependencies from a script.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, scriptPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await getGdscriptDependencies(workspaces, { workspaceId, scriptPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_find_cyclic_script_dependencies", {
    title: "Find cyclic preload dependencies",
    description: "List cyclic script preload dependencies that might crash the editor or build.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await findCyclicScriptDependencies(workspaces, { workspaceId }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_get_gdscript_node_references", {
    title: "Get script node path references",
    description: "Scan code for $Node path strings and unique names references.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, scriptPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await getGdscriptNodeReferences(workspaces, { workspaceId, scriptPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_get_gdscript_lifecycle_methods", {
    title: "Get lifecycle methods",
    description: "List lifecycle function overrides (_ready, _process) with helper alerts.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, scriptPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await getGdscriptLifecycleMethods(workspaces, { workspaceId, scriptPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_inspect_gdscript_await_usage", {
    title: "Inspect await statements",
    description: "Scan code for awaits and list timer/callable safety checks.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, scriptPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await inspectGdscriptAwaitUsage(workspaces, { workspaceId, scriptPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_analyze_gdscript_typing", {
    title: "Analyze typing coverage",
    description: "Compute return, variable, and parameter explicit typing coverage percentages.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, scriptPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await analyzeGdscriptTyping(workspaces, { workspaceId, scriptPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_format_gdscript", {
    title: "Format GDScript",
    description: "Run formatting layout fixes using gdformat. Use verifyOnly=true for pass/fail audits.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string().optional(), verifyOnly: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, scriptPath, verifyOnly }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await formatGdscript(workspaces, { workspaceId, scriptPath, verifyOnly }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_detect_gdscript_tests", {
    title: "Detect test configuration",
    description: "Inspect folder structure for GUT (Godot Unit Test) framework and script files.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, projectPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await detectGdscriptTests(workspaces, { workspaceId, projectPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_run_gdscript_tests", {
    title: "Run GDScript tests",
    description: "Run unit/integration tests and return passing, failing, and skipped logs.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), testPath: z.string().optional(), filter: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, projectPath, testPath, filter }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await runGdscriptTests(workspaces, { workspaceId, projectPath, testPath, filter }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_reload_gdscript", {
    title: "Reload scripts in editor",
    description: "Trigger live reload of updated GDScript files inside the active editor bridge.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, scriptPath }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await reloadGdscript(workspaces, { workspaceId, scriptPath }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_gdscript_set_breakpoint", {
    title: "Set breakpoint",
    description: "Declare a breakpoint at a script path line.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string(), line: z.number() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, scriptPath, line }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await gdscriptSetBreakpoint(workspaces, { workspaceId, scriptPath, line }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_gdscript_remove_breakpoint", {
    title: "Remove breakpoint",
    description: "Clear a breakpoint from a script line.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string(), line: z.number() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, scriptPath, line }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await gdscriptRemoveBreakpoint(workspaces, { workspaceId, scriptPath, line }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_gdscript_lsp_find_symbol", {
    title: "LSP find GDScript symbol",
    description: "Find a symbol definition across all GDScript files via the Godot editor LSP bridge.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, symbol: z.string() },
    ...toolWidgetDescriptorMeta(config, "search"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, symbol }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await gdscriptLspFindSymbol(workspaces, { workspaceId, symbol }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  registerAppTool(server, "godot_gdscript_lsp_get_definition", {
    title: "LSP get GDScript definition",
    description: "Get the definition location of a symbol at a specific line/character in a GDScript file via the Godot editor LSP bridge.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string(), line: z.number(), character: z.number() },
    ...toolWidgetDescriptorMeta(config, "search"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, scriptPath, line, character }) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await gdscriptLspGetDefinition(workspaces, { workspaceId, scriptPath, line, character }), null, 2) }] }; }
    catch (err) { return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true }; }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BLENDER MCP TOOLS
  // ──────────────────────────────────────────────────────────────────────────

  registerAppTool(server, "blender_ping", {
    title: "Blender Ping",
    description: "Verify local Blender connection is reachable, returning version and active scene status.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => blenderPing(workspaces, { workspaceId }));

  registerAppTool(server, "blender_get_scene_info", {
    title: "Get Blender Scene Info",
    description: "Return current active scene properties, frame, and list of objects.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => blenderGetSceneInfo(workspaces, { workspaceId }));

  registerAppTool(server, "blender_get_scene_audit", {
    title: "Blender Low-Poly Scene Audit",
    description: "Audit scene configuration for low-poly budgets, duplicate assets, and non-manifold mesh objects.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      includeHidden: z.boolean().optional(),
      includeInstances: z.boolean().optional(),
      includeMaterials: z.boolean().optional(),
      includeImages: z.boolean().optional(),
      includeModifiers: z.boolean().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => blenderGetSceneAudit(workspaces, input));

  registerAppTool(server, "blender_get_console_errors", {
    title: "Get Blender console errors",
    description: "Retrieve recent error and warning messages from the Blender console output.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => blenderGetConsoleErrors(workspaces, { workspaceId }));

  registerAppTool(server, "blender_get_selection", {
    title: "Get Selected Objects",
    description: "List currently selected objects, active object, and Blender interaction mode.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => blenderGetSelection(workspaces, { workspaceId }));

  registerAppTool(server, "blender_get_active_mode_and_status", {
    title: "Get active mode",
    description: "Check selection mode, rendering engine, and whether animation is playing.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => blenderGetActiveModeAndStatus(workspaces, { workspaceId }));

  registerAppTool(server, "blender_inspect_object", {
    title: "Inspect Blender Object",
    description: "Inspect specific object mesh details, applied modifiers, parent/child state, and materials.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => blenderInspectObject(workspaces, input));

  registerAppTool(server, "blender_create_cube", {
    title: "Create Blender Cube",
    description: "Create a primitive cube mesh at location.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, name: z.string().optional(), x: z.number().optional(), y: z.number().optional(), z: z.number().optional(), size: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateCube(workspaces, input));

  registerAppTool(server, "blender_select_object", {
    title: "Select Object",
    description: "Select a single object and optionally set interaction mode.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), mode: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSelectObject(workspaces, input));

  registerAppTool(server, "blender_select_objects", {
    title: "Select Objects",
    description: "Select multiple objects by wildcard name, type, collection, or material.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, pattern: z.string().optional(), objectType: z.string().optional(), collection: z.string().optional(), material: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSelectObjects(workspaces, input));

  registerAppTool(server, "blender_transform_object", {
    title: "Transform Object",
    description: "Set object local translation, scale, or Euler rotation settings.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), location: z.array(z.number()).optional(), rotationEuler: z.array(z.number()).optional(), scale: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderTransformObject(workspaces, input));

  registerAppTool(server, "blender_duplicate_linked", {
    title: "Duplicate Linked",
    description: "Create linked duplicates of objects.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectNames: z.array(z.string()), offset: z.array(z.number()).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderDuplicateLinked(workspaces, input));

  registerAppTool(server, "blender_join_objects", {
    title: "Join Objects",
    description: "Join selected mesh objects into one mesh container.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectNames: z.array(z.string()), resultName: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderJoinObjects(workspaces, input));

  registerAppTool(server, "blender_delete_objects", {
    title: "Delete Objects",
    description: "Remove objects from data dictionary completely.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectNames: z.array(z.string()) },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderDeleteObjects(workspaces, input));

  registerAppTool(server, "blender_create_collection", {
    title: "Create Collection",
    description: "Create collection node under hierarchy.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, name: z.string(), parent: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderCreateCollection(workspaces, input));

  registerAppTool(server, "blender_move_to_collection", {
    title: "Move Objects to Collection",
    description: "Move objects to collection and optionally unlink from parent.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectNames: z.array(z.string()), collectionName: z.string(), unlinkFromOthers: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderMoveToCollection(workspaces, input));

  registerAppTool(server, "blender_set_viewport_view", {
    title: "Set Viewport View",
    description: "Orient 3D viewport camera view angles.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, view: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSetViewportView(workspaces, input));

  registerAppTool(server, "blender_orbit_viewport", {
    title: "Orbit Viewport",
    description: "Orbit camera.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, direction: z.string().optional(), steps: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderOrbitViewport(workspaces, input));

  registerAppTool(server, "blender_pan_viewport", {
    title: "Pan Viewport",
    description: "Pan camera.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, direction: z.string().optional(), steps: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderPanViewport(workspaces, input));

  registerAppTool(server, "blender_zoom_viewport", {
    title: "Zoom Viewport",
    description: "Zoom camera.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, direction: z.string().optional(), steps: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderZoomViewport(workspaces, input));

  registerAppTool(server, "blender_frame_selected", {
    title: "Frame Selected",
    description: "Align view to frame selected elements.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId }) => blenderFrameSelected(workspaces, { workspaceId }));

  registerAppTool(server, "blender_set_viewport_shading", {
    title: "Set Viewport Shading",
    description: "Modify view display shading mode.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, mode: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSetViewportShading(workspaces, input));

  registerAppTool(server, "blender_inspect_material", {
    title: "Inspect Material",
    description: "Get material setup details.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, materialName: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => blenderInspectMaterial(workspaces, input));

  registerAppTool(server, "blender_inspect_geometry_nodes", {
    title: "Inspect Geometry Nodes",
    description: "Inspect modifier setup.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => blenderInspectGeometryNodes(workspaces, input));

  registerAppTool(server, "blender_edit_modifier", {
    title: "Edit Modifier Parameters",
    description: "Modify simple modifier settings.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), modifierName: z.string(), properties: z.record(z.string(), z.unknown()) },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderEditModifier(workspaces, input));

  registerAppTool(server, "blender_set_render_settings", {
    title: "Set Render Settings",
    description: "Alter render properties.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, engine: z.string().optional(), width: z.number().optional(), height: z.number().optional(), samples: z.number().optional(), denoise: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSetRenderSettings(workspaces, input));

  registerAppTool(server, "blender_render_camera", {
    title: "Render Camera",
    description: "Generate render image output for active camera.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, cameraName: z.string().optional(), width: z.number().optional(), height: z.number().optional(), samples: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderRenderCamera(workspaces, input));

  registerAppTool(server, "blender_render_object_isolation", {
    title: "Render Object Isolation",
    description: "Isolate object render.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, objectName: z.string(), width: z.number().optional(), height: z.number().optional(), samples: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderRenderObjectIsolation(workspaces, input));

  registerAppTool(server, "blender_render_viewport", {
    title: "Render Viewport Screenshot",
    description: "Capture screenshot of Blender window.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, width: z.number().optional(), height: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderRenderViewport(workspaces, input));

  registerAppTool(server, "blender_save_checkpoint", {
    title: "Save Checkpoint",
    description: "Save snapshot of active work session.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, label: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSaveCheckpoint(workspaces, input));

  registerAppTool(server, "blender_list_checkpoints", {
    title: "List Blender Checkpoints",
    description: "List all saved Blender session checkpoint files.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => blenderListCheckpoints(workspaces, { workspaceId }));

  registerAppTool(server, "blender_rollback_checkpoint", {
    title: "Rollback Checkpoint",
    description: "Open past checkpoint file.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, path: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderRollbackCheckpoint(workspaces, input));

  registerAppTool(server, "blender_execute_python", {
    title: "Execute python",
    description: "Run custom Python script on active Blender session.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, code: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderExecutePython(workspaces, input));

  registerAppTool(server, "blender_get_current_file", {
    title: "Get current blend file",
    description: "Retrieve current file path.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => blenderGetCurrentFile(workspaces, { workspaceId }));

  registerAppTool(server, "blender_open_file", {
    title: "Open blend file",
    description: "Load project blend file.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, filepath: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderOpenFile(workspaces, input));

  registerAppTool(server, "blender_save_file", {
    title: "Save blend file",
    description: "Overwrites current active blend file.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId }) => blenderSaveFile(workspaces, { workspaceId }));

  registerAppTool(server, "blender_save_file_as", {
    title: "Save blend file as",
    description: "Save active session to new file path.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, filepath: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderSaveFileAs(workspaces, input));

  registerAppTool(server, "blender_export_glb", {
    title: "Export GLB asset",
    description: "Generate GLB 3D scene file.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, filepath: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => blenderExportGlb(workspaces, input));

  if (config.integrations.serena && config.serena.enabled && allowedScopes.includes("auvrynt:serena")) {
    registerSerenaTools(server, config, serenaManager, workspaces);
  }

  return server;
}

export function createServer(config = loadConfig()): RunningServer {
  const allowedHosts = config.allowedHosts.includes("*")
    ? undefined
    : Array.from(new Set([config.host, ...config.allowedHosts]));
  const app = createMcpExpressApp({
    host: config.host,
    ...(allowedHosts ? { allowedHosts } : {}),
  });
  const transports = new Map<string, Transport>();
  const mcpServers = new Map<string, McpServer>();
  const sessionOwners = new Map<string, string>();
  const mcpUrl = new URL("/mcp", config.publicBaseUrl);
  const resourceServerUrl = resourceUrlFromServerUrl(mcpUrl);
  const oauthProvider = new SingleUserOAuthProvider(config.oauth, mcpUrl);
  const bearerAuth = requireBearerAuth({
    verifier: oauthProvider,
    requiredScopes: [],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl),
  });
  const workspaceStore = createWorkspaceStore(config.stateDir);
  const workspaces = new WorkspaceRegistry(config, workspaceStore);
  const processManager = new ProcessManager(workspaces);
  const reviewCheckpoints = createReviewCheckpointManager();
  const serenaConfig = {
    enabled: config.serena.enabled,
    executable: config.serena.executable,
    backend: config.serena.backend,
    context: config.serena.context,
    startupTimeoutMs: config.serena.startupTimeoutMs,
    requestTimeoutMs: config.serena.requestTimeoutMs,
    idleTimeoutMinutes: config.serena.idleTimeoutMinutes,
    maxInstances: config.serena.maxInstances,
  };
  const serenaManager = new SerenaManager(serenaConfig);
  let activeMcpRequests = 0;
  let activeToolCalls = 0;
  let reconfiguring = false;

  const closeMcpSessions = async (): Promise<number> => {
    const servers = Array.from(new Set(mcpServers.values()));
    mcpServers.clear();
    transports.clear();
    sessionOwners.clear();
    await Promise.allSettled(servers.map((server) => server.close()));
    return servers.length;
  };

  // Auvrynt is commonly exposed through a local reverse proxy/tunnel (for example Cloudflare).
  // Only loopback proxies are trusted. Never switch this to boolean `true`: that would let a
  // direct remote client spoof forwarding headers and undermine IP-based rate limits/logging.
  app.set("trust proxy", "loopback");

  app.use((req, res, next) => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    res.locals.requestId = requestId;

    res.on("finish", () => {
      const path = requestPath(req);
      if (!config.logging.requests) return;
      if (!config.logging.assets && path.startsWith("/mcp-app-assets")) return;

      logEvent(config.logging, "info", "http_request", {
        requestId,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
        ...requestLogFields(req, config),
      });
    });

    next();
  });

  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: new URL(config.publicBaseUrl),
      baseUrl: new URL(config.publicBaseUrl),
      resourceServerUrl,
      scopesSupported: config.oauth.scopes,
      resourceName: "Auvrynt",
    }),
  );

  app.options("/mcp-app-assets/{*asset}", (_req, res) => {
    setAssetHeaders(res);
    res.sendStatus(204);
  });

  app.use(
    "/brand-assets",
    express.static(brandAssetDirectory(), {
      maxAge: "1d",
      fallthrough: false,
      setHeaders: setAssetHeaders,
    }),
  );

  app.use(
    "/mcp-app-assets",
    express.static(uiBuildDirectory(), {
      immutable: true,
      maxAge: "1y",
      fallthrough: false,
      setHeaders: setAssetHeaders,
    }),
  );

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, name: "auvrynt" });
  });

  app.all("/mcp", async (req, res) => {
    const requestId = res.locals.requestId as string | undefined;
    const sessionId = req.header("mcp-session-id");
    const initializeRequest = req.method === "POST" && isInitializeRequest(req.body);
    if (reconfiguring) {
      sendJsonRpcError(res, 503, -32000, "Auvrynt integrations are being refreshed; reconnect and retry.");
      return;
    }
    activeMcpRequests++;
    let requestReleased = false;
    const releaseRequest = () => {
      if (requestReleased) return;
      requestReleased = true;
      activeMcpRequests--;
    };
    res.once("finish", releaseRequest);
    res.once("close", releaseRequest);

    await new Promise<void>((resolve, reject) => {
      bearerAuth(req, res, (error?: unknown) => {
        if (error) reject(error);
        else resolve();
      });
    });
    if (res.headersSent) return;

    if (!req.auth?.resource || !checkResourceAllowed({ requestedResource: req.auth.resource, configuredResource: resourceServerUrl })) {
      logEvent(config.logging, "warn", "auth_denied", {
        requestId,
        method: req.method,
        path: requestPath(req),
        reason: "invalid_oauth_resource",
        ...requestLogFields(req, config),
      });
      sendJsonRpcError(res, 401, -32001, "Unauthorized");
      return;
    }

    const authScopes = req.auth.scopes ?? [];
    const toolCalls = Array.isArray(req.body) ? req.body : [req.body];
    for (const message of toolCalls) {
      if (!message || typeof message !== "object") continue;
      const rpc = message as { method?: unknown; params?: { name?: unknown; arguments?: unknown } };
      if (rpc.method !== "tools/call" || typeof rpc.params?.name !== "string") continue;
      const toolName = rpc.params.name;
      const requiredScopes = requiredScopesForToolCall(toolName, rpc.params.arguments);
      if (!toolIntegrationEnabled(config, toolName)) {
        logEvent(config.logging, "warn", "auth_denied", {
          requestId,
          tool: toolName,
          reason: "integration_disabled",
        });
        sendJsonRpcError(res, 403, -32003, "Forbidden: integration disabled");
        return;
      }
      if (!hasRequiredScopes(authScopes, requiredScopes)) {
        logEvent(config.logging, "warn", "auth_denied", {
          requestId,
          tool: toolName,
          reason: "missing_scope",
          requiredScopes,
        });
        sendJsonRpcError(res, 403, -32003, "Forbidden: insufficient OAuth scope");
        return;
      }
    }

    if (sessionId) {
      const ownerClientId = sessionOwners.get(sessionId);
      if (ownerClientId && ownerClientId !== req.auth.clientId) {
        logEvent(config.logging, "warn", "auth_denied", {
          requestId,
          reason: "mcp_session_owner_mismatch",
          sessionIdPrefix: sessionIdPrefix(sessionId),
        });
        sendJsonRpcError(res, 403, -32003, "Forbidden: MCP session belongs to a different OAuth client");
        return;
      }
    }

    const containsToolCall = toolCalls.some((message) => {
      if (!message || typeof message !== "object") return false;
      return (message as { method?: unknown }).method === "tools/call";
    });
    if (containsToolCall) activeToolCalls++;

    try {
      recordConnectedClient(config.stateDir, {
        clientName: mcpClientName(req),
        userAgent: req.header("user-agent") ?? undefined,
      });
    } catch (error) {
      logEvent(config.logging, "warn", "connection_registry_write_failed", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logEvent(config.logging, "debug", "mcp_request", {
      requestId,
      method: req.method,
      sessionIdPresent: Boolean(sessionId),
      sessionIdPrefix: sessionIdPrefix(sessionId),
      isInitialize: initializeRequest,
    });

    try {
      let transport: Transport | undefined;

      if (sessionId) {
        transport = transports.get(sessionId);
        if (!transport) {
          sendJsonRpcError(res, 404, -32000, "Unknown MCP session");
          return;
        }
      } else if (initializeRequest) {
        if (transports.size >= MAX_MCP_SESSIONS) {
          sendJsonRpcError(res, 503, -32000, "MCP session capacity reached");
          return;
        }

        let mcpServer: McpServer | undefined;
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            if (transport) transports.set(newSessionId, transport);
            if (mcpServer) mcpServers.set(newSessionId, mcpServer);
            sessionOwners.set(newSessionId, req.auth!.clientId);
            logEvent(config.logging, "info", "mcp_session_created", {
              requestId,
              sessionIdPrefix: sessionIdPrefix(newSessionId),
              ...requestLogFields(req, config),
            });
          },
        });

        transport.onclose = () => {
          const closedSessionId = transport?.sessionId;
          if (closedSessionId) {
            transports.delete(closedSessionId);
            mcpServers.delete(closedSessionId);
            sessionOwners.delete(closedSessionId);
            logEvent(config.logging, "info", "mcp_session_closed", {
              sessionIdPrefix: sessionIdPrefix(closedSessionId),
            });
          }
        };

        mcpServer = createMcpServer(
          config,
          workspaces,
          reviewCheckpoints,
          serenaManager,
          processManager,
          authScopes,
        );
        await mcpServer.connect(transport);
      } else {
        sendJsonRpcError(res, 400, -32000, "No valid MCP session");
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logEvent(config.logging, "error", "mcp_request_error", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, "Internal server error");
      }
    } finally {
      if (containsToolCall) activeToolCalls--;
    }
  });

  app.use((error: unknown, req: Request, res: Response, next: (error?: unknown) => void) => {
    logEvent(config.logging, "error", "http_unhandled_error", {
      requestId: res.locals.requestId,
      method: req.method,
      path: requestPath(req),
      error: error instanceof Error ? error.message : String(error),
    });
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  });

  let closed = false;
  return {
    app,
    config,
    async updateIntegrations(integrations, options): Promise<{ updated: boolean; activeRequests: number; activeToolCalls: number; closedSessions: number }> {
      if (activeMcpRequests > 0 || activeToolCalls > 0 || reconfiguring) {
        return { updated: false, activeRequests: activeMcpRequests, activeToolCalls, closedSessions: 0 };
      }

      reconfiguring = true;
      try {
        Object.assign(config.integrations, integrations);
        const allowBlenderPython = config.oauth.scopes.includes("auvrynt:blender-python");
        const nextScopes = oauthScopesForIntegrations(config.integrations);
        if (allowBlenderPython && config.integrations.blender) nextScopes.push("auvrynt:blender-python");
        config.oauth.scopes.splice(
          0,
          config.oauth.scopes.length,
          ...nextScopes,
        );
        if (options?.serenaExecutable) config.serena.executable = options.serenaExecutable;
        config.serena.enabled = integrations.serena;
        serenaManager.updateConfig({
          ...serenaManager.getConfig(),
          enabled: integrations.serena,
          executable: options?.serenaExecutable ?? config.serena.executable,
        });
        const closedSessions = await closeMcpSessions();
        return { updated: true, activeRequests: 0, activeToolCalls: 0, closedSessions };
      } finally {
        reconfiguring = false;
      }
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;

      await closeMcpSessions();
      await Promise.allSettled([
        serenaManager.stopAllSessions(),
        processManager.stopAllProcesses(),
      ]);
      disconnectAllGodotEditorBridges();
      clearBlenderClients();
      workspaceStore.close?.();
    },
  };
}

async function isMainModule(): Promise<boolean> {
  if (!process.argv[1]) return false;

  const modulePath = await realpath(fileURLToPath(import.meta.url));
  const entrypointPath = await realpath(process.argv[1]);
  return modulePath === entrypointPath;
}

if (await isMainModule()) {
  const { app, config } = createServer();
  app.listen(config.port, config.host, () => {
    console.log(
      `auvrynt listening on http://${config.host}:${config.port}/mcp`,
    );
    console.log(`allowed roots: ${config.allowedRoots.join(", ")}`);
    console.log("auth: oauth owner-token flow required");
    console.log(`logging: ${config.logging.level} ${config.logging.format}`);
    console.log(`request logging: ${config.logging.requests ? "enabled" : "disabled"}`);
    console.log(`asset logging: ${config.logging.assets ? "enabled" : "disabled"}`);
    console.log("trust proxy: loopback only");
  });
}
