import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import type { ProcessManager } from "../../processes.js";
import { dotnetBuild, dotnetFormat, dotnetRestore, dotnetRun, dotnetTest, inspectDotnetProject } from "../../dotnet-tools.js";
import { detectGodotProject, godotRun, inspectGodotScene } from "../../godot-tools.js";
import { captureWindow } from "../../window-capture.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import {
  MUTATING_ANNOTATIONS,
  PROCESS_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WORKSPACE_ID_SCHEMA,
  toolWidgetDescriptorMeta,
} from "../tool-registration-shared.js";

function jsonToolResult(action: () => unknown | Promise<unknown>) {
  return Promise.resolve()
    .then(action)
    .then((result) => ({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }))
    .catch((error) => ({
      content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
      isError: true as const,
    }));
}

export function registerDotnetGodotWindowTools(
  server: McpServer,
  config: ServerConfig,
  workspaces: WorkspaceRegistry,
  processManager: ProcessManager,
): void {
  registerAppTool(server, "inspect_dotnet_project", {
    title: "Inspect .NET project",
    description: "Parse a .csproj or .fsproj file and return SDK style, target frameworks, packages, test framework, and project references.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string().describe("Workspace-relative path to .csproj or .fsproj.") },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, projectPath }) => jsonToolResult(() => inspectDotnetProject(workspaces, { workspaceId, projectPath })));

  registerAppTool(server, "dotnet_restore", {
    title: "dotnet restore",
    description: "Run dotnet restore on a .NET project. Returns success, duration, and key output.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string().describe("Workspace-relative path to .csproj/.fsproj/.sln.") },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, projectPath }) => jsonToolResult(() => dotnetRestore(workspaces, { workspaceId, projectPath })));

  registerAppTool(server, "dotnet_build", {
    title: "dotnet build",
    description: "Build a .NET project. Returns structured errors, warnings, and duration. Does not return raw build output.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      projectPath: z.string().describe("Workspace-relative path to .csproj/.fsproj/.sln."),
      configuration: z.enum(["Debug", "Release"]).optional().describe("Build configuration."),
      noRestore: z.boolean().optional().describe("Skip restore step."),
    },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, projectPath, configuration, noRestore }) =>
    jsonToolResult(() => dotnetBuild(workspaces, { workspaceId, projectPath, configuration, noRestore })));

  registerAppTool(server, "dotnet_test", {
    title: "dotnet test",
    description: "Run .NET tests. Returns pass/fail/skip counts, failed test names, and assertion messages.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      projectPath: z.string().describe("Workspace-relative path to test .csproj/.sln."),
      configuration: z.enum(["Debug", "Release"]).optional(),
      filter: z.string().optional().describe("Test filter expression."),
      noBuild: z.boolean().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, projectPath, configuration, filter, noBuild }) =>
    jsonToolResult(() => dotnetTest(workspaces, { workspaceId, projectPath, configuration, filter, noBuild })));

  registerAppTool(server, "dotnet_run", {
    title: "dotnet run",
    description: "Run a .NET project as a persistent process. Returns a processId. Use get_process_logs to tail output.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      projectPath: z.string().describe("Workspace-relative path to .csproj."),
      configuration: z.enum(["Debug", "Release"]).optional(),
      arguments: z.array(z.string()).optional().describe("Arguments to pass to the application."),
      environment: z.record(z.string(), z.string()).optional().describe("Environment variables."),
    },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, projectPath, configuration, arguments: args, environment }) =>
    jsonToolResult(() => dotnetRun(workspaces, processManager, { workspaceId, projectPath, configuration, arguments: args, environment })));

  registerAppTool(server, "dotnet_format", {
    title: "dotnet format",
    description: "Format a .NET project. Use verifyOnly=true to check without modifying files.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      projectPath: z.string().describe("Workspace-relative path to .csproj/.sln."),
      verifyOnly: z.boolean().optional().describe("If true, check formatting without modifying files."),
    },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, projectPath, verifyOnly }) =>
    jsonToolResult(() => dotnetFormat(workspaces, { workspaceId, projectPath, verifyOnly })));

  registerAppTool(server, "detect_godot_project", {
    title: "Detect Godot project",
    description: "Detect a Godot 4 project in the workspace. Reads project.godot for name, main scene, renderer, features, autoloads, and input actions.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, path: z.string().optional().describe("Subdirectory to search, relative to workspace root.") },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, path }) => jsonToolResult(() => detectGodotProject(workspaces, { workspaceId, path })));

  registerAppTool(server, "godot_run", {
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
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, projectPath, scenePath, editor, debug, additionalArguments }) =>
    jsonToolResult(() => godotRun(workspaces, processManager, { workspaceId, projectPath, scenePath, editor, debug, additionalArguments })));

  registerAppTool(server, "inspect_godot_scene", {
    title: "Inspect Godot scene",
    description: "Parse a Godot .tscn text scene file. Returns node tree, types, external resources, signals, and properties. Binary .scn files are not supported.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scenePath: z.string().describe("Workspace-relative path to .tscn scene file.") },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, scenePath }) => jsonToolResult(() => inspectGodotScene(workspaces, { workspaceId, scenePath })));

  registerAppTool(server, "capture_window", {
    title: "Capture window",
    description: "Capture a running application window tracked by Auvrynt. Returns the screenshot as MCP image content and saves it in the workspace. Windows only.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      processId: z.string().optional().describe("Process ID from start_process to target."),
      windowTitle: z.string().optional().describe("Window title substring to target."),
      outputPath: z.string().describe("Workspace-relative path to save the screenshot PNG."),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, processId, windowTitle, outputPath }) =>
    captureWindow(workspaces, processManager, { workspaceId, processId, windowTitle, outputPath }));

  registerAppTool(server, "godot_capture_game", {
    title: "Capture Godot game",
    description: "Capture a screenshot of a running Godot game tracked by an Auvrynt processId. Wraps capture_window.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      processId: z.string().describe("Process ID from godot_run."),
      outputPath: z.string().describe("Workspace-relative path to save the screenshot PNG."),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, processId, outputPath }) =>
    captureWindow(workspaces, processManager, { workspaceId, processId, outputPath }));
}
