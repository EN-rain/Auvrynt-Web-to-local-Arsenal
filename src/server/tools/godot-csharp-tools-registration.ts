import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import type { ProcessManager } from "../../processes.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import {
  MUTATING_ANNOTATIONS,
  PROCESS_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WORKSPACE_ID_SCHEMA,
  toolWidgetDescriptorMeta,
} from "../tool-registration-shared.js";
import { inspectGodotDotnetEnvironment } from "../../godot-dotnet-env.js";
import { inspectGodotDotnetProject, godotBuildSolutions, godotDotnetRestore } from "../../godot-csharp-project.js";
import { godotDotnetBuild, godotDotnetClean } from "../../godot-csharp-build.js";
import { godotRunProject, godotRunScene, getGodotRuntimeLogs } from "../../godot-csharp-runner.js";
import { godotValidateProject, godotImportAssets } from "../../godot-csharp-validate.js";
import { godotEditorConnect, godotEditorStatus, godotEditorDisconnect, getBridgeClient } from "../../godot-editor-bridge.js";
import { findCsharpClasses, getCsharpDiagnostics, getExportedProperties, generateCsharpScript } from "../../godot-csharp-semantic.js";
import {
  getProjectSettings,
  getInputMap,
  getAutoloads,
  applyPixelArtImportPreset,
  generateVscodeConfig,
  listExportPresets,
} from "../../godot-project-settings.js";
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
} from "../../godot-runtime-testing.js";

function toolResult(action: () => unknown | Promise<unknown>) {
  return Promise.resolve()
    .then(action)
    .then((result) => ({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }))
    .catch((error) => ({
      content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
      isError: true as const,
    }));
}

export function registerGodotCsharpTools(
  server: McpServer,
  config: ServerConfig,
  workspaces: WorkspaceRegistry,
  processManager: ProcessManager,
): void {
  registerAppTool(server, "godot_dotnet_environment", {
    title: "Godot .NET environment",
    description: "Detect and validate the Godot .NET editor, .NET SDK, architecture, and project target frameworks. Run this before the first C# build.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, projectPath }) => toolResult(() => inspectGodotDotnetEnvironment(workspaces, { workspaceId, projectPath })));

  registerAppTool(server, "inspect_godot_dotnet_project", {
    title: "Inspect Godot .NET project",
    description: "Inspect a Godot 4 C# project: project.godot, .csproj, .sln, target frameworks, Godot.NET.Sdk, autoloads, input actions, C# scripts, and whether solution regeneration is needed.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, projectPath }) => toolResult(() => inspectGodotDotnetProject(workspaces, { workspaceId, projectPath })));

  registerAppTool(server, "godot_build_solutions", {
    title: "Godot build solutions",
    description: "Run Godot --build-solutions to generate or regenerate the .sln and .csproj for a C# project. Run after adding C# files.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, projectPath }) => toolResult(() => godotBuildSolutions(workspaces, { workspaceId, projectPath })));

  registerAppTool(server, "godot_dotnet_restore", {
    title: "dotnet restore (Godot)",
    description: "Restore NuGet packages for a Godot C# project. Credentials and secrets are redacted.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), lockedMode: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, projectPath, lockedMode }) => toolResult(
    () => godotDotnetRestore(workspaces, { workspaceId, projectPath, lockedMode }),
  ));

  registerAppTool(server, "godot_dotnet_build", {
    title: "dotnet build (Godot)",
    description: "Build a Godot C# project. Returns structured C# compiler errors, MSBuild errors, and Godot source-generator issues.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), configuration: z.enum(["Debug", "Release"]).optional(), noRestore: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, projectPath, configuration, noRestore }) => toolResult(
    () => godotDotnetBuild(workspaces, { workspaceId, projectPath, configuration, noRestore }),
  ));

  registerAppTool(server, "godot_dotnet_clean", {
    title: "dotnet clean (Godot)",
    description: "Remove Godot C# build outputs (bin/ and obj/). Mutating.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), configuration: z.enum(["Debug", "Release"]).optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, projectPath, configuration }) => toolResult(
    () => godotDotnetClean(workspaces, { workspaceId, projectPath, configuration }),
  ));

  registerAppTool(server, "godot_run_project", {
    title: "Run Godot project",
    description: "Run a Godot C# project as a persistent process. Returns a processId. Use godot_get_runtime_logs to inspect output.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), debug: z.boolean().optional(), windowed: z.boolean().optional(), resolution: z.object({ width: z.number().int(), height: z.number().int() }).optional(), additionalGodotArguments: z.array(z.string()).optional(), userArguments: z.array(z.string()).optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, projectPath, debug, windowed, resolution, additionalGodotArguments, userArguments }) => toolResult(
    () => godotRunProject(workspaces, processManager, { workspaceId, projectPath, debug, windowed, resolution, additionalGodotArguments, userArguments }),
  ));

  registerAppTool(server, "godot_run_scene", {
    title: "Run Godot scene",
    description: "Run a single .tscn scene in a Godot C# project as a persistent process.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), scenePath: z.string(), debug: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, projectPath, scenePath, debug }) => toolResult(
    () => godotRunScene(workspaces, processManager, { workspaceId, projectPath, scenePath, debug }),
  ));

  registerAppTool(server, "godot_stop", {
    title: "Stop Godot process",
    description: "Gracefully stop a Godot process tracked by Auvrynt for this workspace.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, processId: z.string() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, processId }) => toolResult(() => processManager.stopProcess({ workspaceId, processId })));

  registerAppTool(server, "godot_get_runtime_logs", {
    title: "Get Godot runtime logs",
    description: "Get structured and categorized runtime logs from a running Godot C# process. Groups C# exceptions, stack traces, Godot errors, and GD.Print output.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, processId: z.string(), severity: z.array(z.enum(["error", "warning", "info", "print"])).optional(), lines: z.number().int().optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, processId, severity, lines }) => toolResult(
    () => getGodotRuntimeLogs(processManager, { workspaceId, processId, severity, lines }),
  ));

  registerAppTool(server, "godot_validate_project", {
    title: "Validate Godot project",
    description: "Headless Godot project validation: optionally build C#, detect import errors, missing resources, invalid scripts, and plugin failures.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), buildCsharpFirst: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, projectPath, buildCsharpFirst }) => toolResult(
    () => godotValidateProject(workspaces, { workspaceId, projectPath, buildCsharpFirst }),
  ));

  registerAppTool(server, "godot_import_assets", {
    title: "Godot import assets",
    description: "Run Godot in headless editor mode to import pending assets.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, projectPath }) => toolResult(() => godotImportAssets(workspaces, { workspaceId, projectPath })));

  registerAppTool(server, "godot_editor_connect", {
    title: "Connect Godot editor bridge",
    description: "Connect Auvrynt to the Godot editor bridge plugin. Enables live scene-tree inspection, property editing, node mutation, and UndoRedo.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), host: z.string().optional(), port: z.number().int().optional(), token: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, projectPath, host, port, token }) => toolResult(
    () => godotEditorConnect(workspaces, { workspaceId, projectPath, host, port, token }),
  ));

  registerAppTool(server, "godot_editor_status", {
    title: "Godot editor bridge status",
    description: "Return current Godot editor bridge connection status.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId }) => toolResult(() => godotEditorStatus({ workspaceId })));

  registerAppTool(server, "godot_editor_disconnect", {
    title: "Disconnect Godot editor bridge",
    description: "Disconnect Auvrynt from the Godot editor bridge. Does not close the editor.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId }) => toolResult(() => godotEditorDisconnect({ workspaceId })));

  registerAppTool(server, "godot_get_scene_tree", {
    title: "Get Godot scene tree",
    description: "Get the edited or remote runtime scene tree via the Godot editor bridge.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, mode: z.enum(["edited", "remote"]).optional(), maxDepth: z.number().int().optional() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, mode, maxDepth }) => toolResult(async () => {
    const client = getBridgeClient(workspaceId);
    return mode === "remote"
      ? getRemoteSceneTree({ workspaceId, maxDepth }, client)
      : client.sendRequest("scene.get_tree", { maxDepth });
  }));

  registerAppTool(server, "godot_get_runtime_property", {
    title: "Get runtime node property",
    description: "Read a live runtime property from a node in the running Godot game via the editor bridge.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, nodePath: z.string(), property: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, nodePath, property }) => toolResult(
    () => getRuntimeProperty({ workspaceId, nodePath, property }, getBridgeClient(workspaceId)),
  ));

  registerAppTool(server, "godot_get_performance_monitors", {
    title: "Godot performance monitors",
    description: "Get FPS, physics time, memory, node count, draw calls, and orphan node count from the running game via the editor bridge.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId }) => toolResult(
    () => getPerformanceMonitors({ workspaceId }, getBridgeClient(workspaceId)),
  ));

  registerAppTool(server, "godot_find_csharp_class", {
    title: "Find C# class",
    description: "Locate a C# class in the workspace. Returns file path, base class, partial status, namespace, [Export] properties, [Signal] delegates, and lifecycle overrides.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, className: z.string() },
    ...toolWidgetDescriptorMeta(config, "search"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, className }) => toolResult(() => findCsharpClasses(workspaces, { workspaceId, className })));

  registerAppTool(server, "godot_get_exported_properties", {
    title: "Get exported C# properties",
    description: "List all [Export] properties on a C# script file.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, scriptPath }) => toolResult(() => getExportedProperties(workspaces, { workspaceId, scriptPath })));

  registerAppTool(server, "godot_get_csharp_diagnostics", {
    title: "Get C# diagnostics",
    description: "Scan C# scripts for known anti-patterns and style issues within the workspace.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "search"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, projectPath }) => toolResult(() => getCsharpDiagnostics(workspaces, { workspaceId, projectPath })));

  registerAppTool(server, "godot_get_project_settings", {
    title: "Get project settings",
    description: "Read all settings from project.godot.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, projectPath }) => toolResult(() => getProjectSettings(workspaces, { workspaceId, projectPath })));

  registerAppTool(server, "godot_get_input_map", {
    title: "Get input map",
    description: "Return all input actions from the project.godot input map.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, projectPath }) => toolResult(() => getInputMap(workspaces, { workspaceId, projectPath })));

  registerAppTool(server, "godot_get_autoloads", {
    title: "Get autoloads",
    description: "Return all autoloads from project.godot.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, projectPath }) => toolResult(() => getAutoloads(workspaces, { workspaceId, projectPath })));

  registerAppTool(server, "godot_apply_pixel_art_import_preset", {
    title: "Apply pixel art import preset",
    description: "Apply nearest-neighbour / lossless import settings to specified texture paths. Does not affect unspecified textures.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, paths: z.array(z.string()) },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, paths }) => toolResult(() => applyPixelArtImportPreset(workspaces, { workspaceId, paths })));

  registerAppTool(server, "godot_generate_vscode_config", {
    title: "Generate VS Code config",
    description: "Generate or update .vscode/tasks.json and .vscode/launch.json for Godot C# development. Preserves existing entries.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), godotExecutable: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, projectPath, godotExecutable }) => toolResult(
    () => generateVscodeConfig(workspaces, { workspaceId, projectPath, godotExecutable }),
  ));

  registerAppTool(server, "godot_list_export_presets", {
    title: "List export presets",
    description: "List Godot export presets from export_presets.cfg. Never returns secret credentials.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, projectPath }) => toolResult(() => listExportPresets(workspaces, { workspaceId, projectPath })));

  registerAppTool(server, "godot_export_project", {
    title: "Export Godot project",
    description: "Export a Godot project using a named preset. Output must be inside the workspace. Credentials are never exposed.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), preset: z.string(), outputPath: z.string(), mode: z.enum(["debug", "release"]).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, projectPath, preset, outputPath, mode }) => toolResult(
    () => exportGodotProject(workspaces, { workspaceId, projectPath, preset, outputPath, mode }),
  ));

  registerAppTool(server, "godot_assert_node_exists", {
    title: "Assert node exists",
    description: "Assert that a node exists in the remote runtime scene tree via the editor bridge.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, nodePath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, nodePath }) => toolResult(
    () => godotAssertNodeExists({ workspaceId, nodePath }, getBridgeClient(workspaceId)),
  ));

  registerAppTool(server, "godot_assert_property", {
    title: "Assert runtime property",
    description: "Assert a runtime node property satisfies a comparison (eq/neq/gt/lt/approx/contains/exists).",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, nodePath: z.string(), property: z.string(), comparison: z.enum(["eq", "neq", "gt", "lt", "approx", "contains", "exists", "changed"]), expected: z.unknown() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, nodePath, property, comparison, expected }) => toolResult(
    () => godotAssertProperty({ workspaceId, nodePath, property, comparison, expected }, getBridgeClient(workspaceId)),
  ));

  registerAppTool(server, "godot_run_test_sequence", {
    title: "Run Godot test sequence",
    description: "Execute a bounded sequence of gameplay steps (press_action, wait, screenshot, assert_property, assert_node_exists, assert_no_errors). Max 50 steps, 30s total.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      processId: z.string(),
      steps: z.array(z.object({
        type: z.string(), action: z.string().optional(), durationMs: z.number().optional(),
        outputPath: z.string().optional(), nodePath: z.string().optional(), property: z.string().optional(),
        comparison: z.string().optional(), expected: z.unknown().optional(),
      })),
    },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, processId, steps }) => toolResult(
    () => godotRunTestSequence(
      workspaces,
      processManager,
      { workspaceId, processId, steps: steps as any },
      getBridgeClient(workspaceId),
    ),
  ));

  registerAppTool(server, "godot_press_action", {
    title: "Press Godot input action",
    description: "Inject a Godot input action press via the runtime bridge. Only targets Auvrynt-tracked game processes.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, processId: z.string(), action: z.string(), durationMs: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, processId, action, durationMs }) => toolResult(
    () => godotPressAction({ workspaceId, processId, action, durationMs }, getBridgeClient(workspaceId)),
  ));

  registerAppTool(server, "godot_release_action", {
    title: "Release Godot input action",
    description: "Inject a Godot input action release via the runtime bridge. Only targets Auvrynt-tracked game processes.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, processId: z.string(), action: z.string() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, processId, action }) => toolResult(
    () => godotReleaseAction({ workspaceId, processId, action }, getBridgeClient(workspaceId)),
  ));

  registerAppTool(server, "godot_mouse_click", {
    title: "Simulate Godot mouse click",
    description: "Inject a mouse click event at viewport coordinates via the runtime bridge. Only targets Auvrynt-tracked game processes.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, processId: z.string(), x: z.number(), y: z.number(), button: z.number().optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, processId, x, y, button }) => toolResult(
    () => godotMouseClick({ workspaceId, processId, x, y, button }, getBridgeClient(workspaceId)),
  ));

  registerAppTool(server, "godot_parse_csharp_exceptions", {
    title: "Parse C# exceptions from runtime logs",
    description: "Parse Godot runtime log lines and extract structured C# exception data including stack frames, inner exceptions, and repeat counts.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, logLines: z.array(z.string()) },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ logLines }) => toolResult(() => parseCsharpExceptions(logLines)));

  registerAppTool(server, "godot_generate_csharp_script", {
    title: "Generate C# script template",
    description: "Generate a Godot C# script boilerplate for a given class name, base type, and optional namespace.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, className: z.string(), baseType: z.string().optional(), namespace: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ className, baseType, namespace }) => toolResult(() => generateCsharpScript({ className, baseType, namespace })));
}
