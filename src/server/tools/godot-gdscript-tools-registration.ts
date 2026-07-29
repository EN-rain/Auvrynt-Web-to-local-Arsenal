import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import {
  MUTATING_ANNOTATIONS,
  PROCESS_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WORKSPACE_ID_SCHEMA,
  toolWidgetDescriptorMeta,
} from "../tool-registration-shared.js";
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
} from "../../godot-gdscript.js";

function toolResult(action: () => unknown | Promise<unknown>): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}> {
  return Promise.resolve()
    .then(action)
    .then((result) => ({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }))
    .catch((error) => ({
      content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
      isError: true as const,
    }));
}

export function registerGodotGdscriptTools(
  server: McpServer,
  config: ServerConfig,
  workspaces: WorkspaceRegistry,
): void {
  registerAppTool(server, "godot_gdscript_environment", {
    title: "Godot GDScript environment",
    description: "Inspect the GDScript project configuration, Godot executable, and project warnings.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, projectPath }) => toolResult(() => inspectGodotGdscriptEnvironment(workspaces, { workspaceId, projectPath })));

  registerAppTool(server, "godot_get_gdscript_diagnostics", {
    title: "Get GDScript diagnostics",
    description: "Return static-analysis and parser diagnostics for GDScript files.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), scriptPath: z.string().optional(), includeWarnings: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, projectPath, scriptPath, includeWarnings }) => toolResult(
    () => getGdscriptDiagnostics(workspaces, { workspaceId, projectPath, scriptPath, includeWarnings }),
  ));

  registerAppTool(server, "godot_inspect_gdscript", {
    title: "Inspect GDScript source",
    description: "Inspect class name, base extends, exported properties, methods, signals, node paths, and preloads.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, scriptPath }) => toolResult(() => inspectGdscript(workspaces, { workspaceId, scriptPath })));

  registerAppTool(server, "godot_create_gdscript", {
    title: "Create GDScript",
    description: "Create a new GDScript file using empty, node, resource, or plugin templates.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, outputPath: z.string(), baseType: z.string(), className: z.string().optional(), toolScript: z.boolean().optional(), template: z.enum(["empty", "node", "resource", "editor_plugin"]).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, outputPath, baseType, className, toolScript, template }) => toolResult(
    () => createGdscript(workspaces, { workspaceId, outputPath, baseType, className, toolScript, template }),
  ));

  registerAppTool(server, "godot_attach_gdscript", {
    title: "Attach GDScript to node",
    description: "Attach a GDScript script path to a node in the edited scene tree.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, nodePath: z.string(), scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, nodePath, scriptPath }) => toolResult(() => attachGdscript(workspaces, { workspaceId, nodePath, scriptPath })));

  registerAppTool(server, "godot_detach_gdscript", {
    title: "Detach GDScript from node",
    description: "Detach script from a node in the edited scene tree.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, nodePath: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, nodePath }) => toolResult(() => detachGdscript(workspaces, { workspaceId, nodePath })));

  registerAppTool(server, "godot_create_gdscript_signal", {
    title: "Create GDScript signal",
    description: "Declare a new signal in a GDScript file.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string(), signalName: z.string(), parameters: z.array(z.object({ name: z.string(), type: z.string().optional() })).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, scriptPath, signalName, parameters }) => toolResult(
    () => createGdscriptSignal(workspaces, { workspaceId, scriptPath, signalName, parameters }),
  ));

  registerAppTool(server, "godot_create_gdscript_signal_handler", {
    title: "Create signal handler stub",
    description: "Create a callback method stub for handling connected signals.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string(), methodName: z.string(), parameters: z.array(z.object({ name: z.string(), type: z.string().optional() })).optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, scriptPath, methodName, parameters }) => toolResult(
    () => createGdscriptSignalHandler(workspaces, { workspaceId, scriptPath, methodName, parameters }),
  ));

  registerAppTool(server, "godot_get_global_classes", {
    title: "Get global classes",
    description: "List all global script classes defined with class_name.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId }) => toolResult(() => getGlobalClasses(workspaces, { workspaceId })));

  registerAppTool(server, "godot_add_class_name", {
    title: "Add class_name to script",
    description: "Declare a new global class_name at the top of a GDScript.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string(), className: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, scriptPath, className }) => toolResult(() => addClassName(workspaces, { workspaceId, scriptPath, className })));

  registerAppTool(server, "godot_remove_class_name", {
    title: "Remove class_name from script",
    description: "Remove the global class_name declaration from a GDScript.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, scriptPath }) => toolResult(() => removeClassName(workspaces, { workspaceId, scriptPath })));

  registerAppTool(server, "godot_add_gdscript_autoload", {
    title: "Add GDScript autoload singleton",
    description: "Register a script as a global autoload singleton in project.godot.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string(), singletonName: z.string() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, scriptPath, singletonName }) => toolResult(
    () => addGdscriptAutoload(workspaces, { workspaceId, scriptPath, singletonName }),
  ));

  registerAppTool(server, "godot_get_autoload_usage", {
    title: "Find autoload references",
    description: "Search for script/code occurrences referencing an autoload singleton name.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, singletonName: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, singletonName }) => toolResult(() => getAutoloadUsage(workspaces, { workspaceId, singletonName })));

  registerAppTool(server, "godot_inspect_tool_script", {
    title: "Inspect @tool script",
    description: "Check if a script is annotated with @tool and list editor methods.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, scriptPath }) => toolResult(() => inspectToolScript(workspaces, { workspaceId, scriptPath })));

  registerAppTool(server, "godot_create_editor_plugin", {
    title: "Create editor plugin",
    description: "Scaffold a new editor plugin addon folder with cfg and gd scripts.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, pluginName: z.string(), description: z.string().optional(), author: z.string().optional(), version: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, pluginName, description, author, version }) => toolResult(
    () => createEditorPlugin(workspaces, { workspaceId, pluginName, description, author, version }),
  ));

  registerAppTool(server, "godot_get_gdscript_dependencies", {
    title: "Get GDScript load dependencies",
    description: "List preload/load file dependencies from a script.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, scriptPath }) => toolResult(() => getGdscriptDependencies(workspaces, { workspaceId, scriptPath })));

  registerAppTool(server, "godot_find_cyclic_script_dependencies", {
    title: "Find cyclic preload dependencies",
    description: "List cyclic script preload dependencies that might crash the editor or build.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId }) => toolResult(() => findCyclicScriptDependencies(workspaces, { workspaceId })));

  registerAppTool(server, "godot_get_gdscript_node_references", {
    title: "Get script node path references",
    description: "Scan code for $Node path strings and unique names references.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, scriptPath }) => toolResult(() => getGdscriptNodeReferences(workspaces, { workspaceId, scriptPath })));

  registerAppTool(server, "godot_get_gdscript_lifecycle_methods", {
    title: "Get lifecycle methods",
    description: "List lifecycle function overrides (_ready, _process) with helper alerts.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, scriptPath }) => toolResult(() => getGdscriptLifecycleMethods(workspaces, { workspaceId, scriptPath })));

  registerAppTool(server, "godot_inspect_gdscript_await_usage", {
    title: "Inspect await statements",
    description: "Scan code for awaits and list timer/callable safety checks.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, scriptPath }) => toolResult(() => inspectGdscriptAwaitUsage(workspaces, { workspaceId, scriptPath })));

  registerAppTool(server, "godot_analyze_gdscript_typing", {
    title: "Analyze typing coverage",
    description: "Compute return, variable, and parameter explicit typing coverage percentages.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, scriptPath }) => toolResult(() => analyzeGdscriptTyping(workspaces, { workspaceId, scriptPath })));

  registerAppTool(server, "godot_format_gdscript", {
    title: "Format GDScript",
    description: "Run formatting layout fixes using gdformat. Use verifyOnly=true for pass/fail audits.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string().optional(), verifyOnly: z.boolean().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, scriptPath, verifyOnly }) => toolResult(
    () => formatGdscript(workspaces, { workspaceId, scriptPath, verifyOnly }),
  ));

  registerAppTool(server, "godot_detect_gdscript_tests", {
    title: "Detect test configuration",
    description: "Inspect folder structure for GUT (Godot Unit Test) framework and script files.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string() },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, projectPath }) => toolResult(() => detectGdscriptTests(workspaces, { workspaceId, projectPath })));

  registerAppTool(server, "godot_run_gdscript_tests", {
    title: "Run GDScript tests",
    description: "Run unit/integration tests and return passing, failing, and skipped logs.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, projectPath: z.string(), testPath: z.string().optional(), filter: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, ({ workspaceId, projectPath, testPath, filter }) => toolResult(
    () => runGdscriptTests(workspaces, { workspaceId, projectPath, testPath, filter }),
  ));

  registerAppTool(server, "godot_reload_gdscript", {
    title: "Reload scripts in editor",
    description: "Trigger live reload of updated GDScript files inside the active editor bridge.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string().optional() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, scriptPath }) => toolResult(() => reloadGdscript(workspaces, { workspaceId, scriptPath })));

  registerAppTool(server, "godot_gdscript_set_breakpoint", {
    title: "Set breakpoint",
    description: "Declare a breakpoint at a script path line.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string(), line: z.number() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, scriptPath, line }) => toolResult(() => gdscriptSetBreakpoint(workspaces, { workspaceId, scriptPath, line })));

  registerAppTool(server, "godot_gdscript_remove_breakpoint", {
    title: "Remove breakpoint",
    description: "Clear a breakpoint from a script line.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string(), line: z.number() },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, scriptPath, line }) => toolResult(() => gdscriptRemoveBreakpoint(workspaces, { workspaceId, scriptPath, line })));

  registerAppTool(server, "godot_gdscript_lsp_find_symbol", {
    title: "LSP find GDScript symbol",
    description: "Find a symbol definition across all GDScript files via the Godot editor LSP bridge.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, symbol: z.string() },
    ...toolWidgetDescriptorMeta(config, "search"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, symbol }) => toolResult(() => gdscriptLspFindSymbol(workspaces, { workspaceId, symbol })));

  registerAppTool(server, "godot_gdscript_lsp_get_definition", {
    title: "LSP get GDScript definition",
    description: "Get the definition location of a symbol at a specific line/character in a GDScript file via the Godot editor LSP bridge.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, scriptPath: z.string(), line: z.number(), character: z.number() },
    ...toolWidgetDescriptorMeta(config, "search"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, scriptPath, line, character }) => toolResult(
    () => gdscriptLspGetDefinition(workspaces, { workspaceId, scriptPath, line, character }),
  ));
}
