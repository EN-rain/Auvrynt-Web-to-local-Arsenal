import type { AuvryntScope, ServerConfig } from "../config.js";

const PLAYWRIGHT_TOOL_NAMES = new Set(["capture_page_screenshot", "inspect_page", "test_responsive_page"]);
const GENERIC_GODOT_TOOL_NAMES = new Set(["detect_godot_project", "inspect_godot_scene"]);
const GODOT_CSHARP_TOOL_MARKERS = ["dotnet", "csharp", "build_solutions", "generate_vscode_config"];

export function requiredScopesForToolName(name: string): AuvryntScope[] {
  if (name === "open_workspace") return ["auvrynt:read", "auvrynt:write"];
  if (name === "close_workspace") return ["auvrynt:write", "auvrynt:process"];
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
  if (name === "open_workspace" && input && typeof input === "object") {
    if ((input as { mode?: unknown }).mode === "worktree") required.add("auvrynt:process");
  }
  if (name === "compare_images" && input && typeof input === "object" && "diffOutputPath" in input) {
    if (typeof (input as { diffOutputPath?: unknown }).diffOutputPath === "string") required.add("auvrynt:write");
  }
  if (name === "dotnet_format" && input && typeof input === "object") {
    if ((input as { verifyOnly?: unknown }).verifyOnly !== true) required.add("auvrynt:write");
  }
  return Array.from(required);
}

export function hasRequiredScopes(scopes: Iterable<string>, required: readonly string[]): boolean {
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
