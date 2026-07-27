export type ToolAccess = "read" | "write" | "process" | "web-read" | "web-write";

export interface ToolCapability {
  name: string;
  access: ToolAccess;
  scopes: string[];
  integration: string | undefined;
  requiresWorkspace: boolean;
}

export function toolAccessForName(name: string): ToolAccess {
  if (name.startsWith("blender_")) return "write";
  if (name.startsWith("godot_")) return "write";
  if (name === "start_process" || name === "stop_process" || name === "bash" || name === "run_shell") return "process";
  if (name.startsWith("dotnet_") && (name.includes("build") || name.includes("test") || name.includes("run") || name.includes("restore") || name.includes("format"))) return "process";
  if (name === "start_dev_server") return "web-write";
  if (name === "capture_page_screenshot" || name === "inspect_page" || name === "test_responsive_page") return "web-read";
  if (["write", "write_file", "edit", "edit_file"].includes(name)) return "write";
  if (name === "open_workspace" || name === "close_workspace") return "write";
  return "read";
}

export function integrationForTool(name: string): string | undefined {
  if (name.startsWith("blender_")) return "blender";
  if (name.startsWith("godot_")) return "godot";
  if (name.startsWith("serena_")) return "serena";
  if (name === "capture_page_screenshot" || name === "inspect_page" || name === "test_responsive_page") return "playwright";
  return undefined;
}

export const TOOL_CAPABILITIES = new Map<string, ToolCapability>();

export function registerToolCapability(name: string): void {
  if (TOOL_CAPABILITIES.has(name)) return;
  const caps: ToolCapability = {
    name,
    access: toolAccessForName(name),
    scopes: [], // populated dynamically
    integration: integrationForTool(name),
    requiresWorkspace: name !== "open_workspace" && name !== "close_workspace",
  };
  TOOL_CAPABILITIES.set(name, caps);
}

export function updateToolScopes(): void {
  for (const [name, caps] of TOOL_CAPABILITIES) {
    caps.scopes = requiredScopesForName(name);
  }
}

function requiredScopesForName(name: string): string[] {
  if (name === "blender_execute_python") return ["auvrynt:blender", "auvrynt:blender-python"];
  if (name.startsWith("blender_")) return ["auvrynt:blender"];
  if (name.startsWith("godot_")) return ["auvrynt:godot"];
  if (name.startsWith("serena_")) return ["auvrynt:serena"];
  if (name === "start_dev_server") return ["auvrynt:web", "auvrynt:process"];
  if (name === "capture_page_screenshot" || name === "test_responsive_page") return ["auvrynt:web", "auvrynt:write"];
  if (name === "inspect_page") return ["auvrynt:web"];
  if (name === "capture_window") return ["auvrynt:process", "auvrynt:write"];
  if (name === "split_sprite_sheet") return ["auvrynt:write"];
  if (name === "inspect_dotnet_project") return ["auvrynt:software"];
  if (["dotnet_restore", "dotnet_build", "dotnet_test", "dotnet_run", "dotnet_format"].includes(name)) return ["auvrynt:software", "auvrynt:process"];
  if (["start_process", "get_process_logs", "list_processes", "stop_process", "run_shell", "bash"].includes(name)) return ["auvrynt:process"];
  if (["write", "write_file", "edit", "edit_file"].includes(name)) return ["auvrynt:write"];
  return ["auvrynt:read"];
}
