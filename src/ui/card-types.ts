import type { App } from "@modelcontextprotocol/ext-apps";

export type ToolName =
  | "open_workspace"
  | "read_file"
  | "write_file"
  | "edit_file"
  | "grep_files"
  | "find_files"
  | "list_directory"
  | "run_shell"
  | "show_changes"
  | "view_image"
  | "read"
  | "write"
  | "edit"
  | "grep"
  | "glob"
  | "ls"
  | "bash"
  | "start_process"
  | "get_process_logs"
  | "list_processes"
  | "stop_process"
  | "glob_files"
  | "search_text"
  | "inspect_project"
  | "start_dev_server"
  | "capture_page_screenshot"
  | "inspect_page"
  | "inspect_image"
  | "compare_images"
  | "inspect_sprite"
  | "split_sprite_sheet"
  | "inspect_dotnet_project"
  | "dotnet_restore"
  | "dotnet_build"
  | "dotnet_test"
  | "dotnet_run"
  | "dotnet_format"
  | "detect_godot_project"
  | "godot_run"
  | "inspect_godot_scene"
  | "capture_window"
  | "godot_capture_game"
  | "godot_dotnet_environment"
  | "inspect_godot_dotnet_project"
  | "godot_build_solutions"
  | "godot_dotnet_restore"
  | "godot_dotnet_build"
  | "godot_dotnet_clean"
  | "godot_run_project"
  | "godot_run_scene"
  | "godot_stop"
  | "godot_get_runtime_logs"
  | "godot_validate_project"
  | "godot_import_assets"
  | "godot_editor_connect"
  | "godot_editor_status"
  | "godot_editor_disconnect"
  | "godot_get_scene_tree"
  | "godot_get_runtime_property"
  | "godot_get_performance_monitors"
  | "godot_find_csharp_class"
  | "godot_get_exported_properties"
  | "godot_get_csharp_diagnostics"
  | "godot_get_project_settings"
  | "godot_get_input_map"
  | "godot_get_autoloads"
  | "godot_apply_pixel_art_import_preset"
  | "godot_generate_vscode_config"
  | "godot_list_export_presets"
  | "godot_export_project"
  | "godot_assert_node_exists"
  | "godot_assert_property"
  | "godot_run_test_sequence"
  | "godot_press_action";

export type HostContext = NonNullable<ReturnType<App["getHostContext"]>>;

export interface ToolResultCard {
  tool: ToolName;
  workspaceId?: string;
  path?: string;
  root?: string;
  status?: string;
  summary?: Record<string, unknown>;
  files?: Array<{
    path?: string;
    previousPath?: string;
    type?: string;
    additions?: number;
    removals?: number;
  }>;
  payload?: ToolPayload;
  agentsFiles?: Array<{
    path?: string;
    content?: string;
  }>;
  availableAgentsFiles?: Array<{
    path?: string;
  }>;
  skills?: Array<{
    name?: string;
    description?: string;
    path?: string;
  }>;
  skillDiagnostics?: unknown[];
  instruction?: string;
}

export interface ToolContent {
  type: "text" | "image";
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface ToolPayload {
  content?: ToolContent[];
  diff?: string;
  patch?: string;
}

export function isToolName(value: unknown): value is ToolName {
  return (
    value === "open_workspace" ||
    value === "read_file" ||
    value === "write_file" ||
    value === "edit_file" ||
    value === "grep_files" ||
    value === "find_files" ||
    value === "list_directory" ||
    value === "run_shell" ||
    value === "show_changes" ||
    value === "view_image" ||
    value === "read" ||
    value === "write" ||
    value === "edit" ||
    value === "grep" ||
    value === "glob" ||
    value === "ls" ||
    value === "bash" ||
    value === "start_process" ||
    value === "get_process_logs" ||
    value === "list_processes" ||
    value === "stop_process" ||
    value === "glob_files" ||
    value === "search_text" ||
    value === "inspect_project" ||
    value === "start_dev_server" ||
    value === "capture_page_screenshot" ||
    value === "inspect_page" ||
    value === "inspect_image" ||
    value === "compare_images" ||
    value === "inspect_sprite" ||
    value === "split_sprite_sheet" ||
    value === "inspect_dotnet_project" ||
    value === "dotnet_restore" ||
    value === "dotnet_build" ||
    value === "dotnet_test" ||
    value === "dotnet_run" ||
    value === "dotnet_format" ||
    value === "detect_godot_project" ||
    value === "godot_run" ||
    value === "inspect_godot_scene" ||
    value === "capture_window" ||
    value === "godot_capture_game" ||
    (typeof value === "string" && value.startsWith("godot_")) ||
    (typeof value === "string" && value.startsWith("blender_")) ||
    value === "inspect_godot_dotnet_project"
  );
}

export function isReadTool(tool: ToolName): boolean {
  return tool === "read_file" || tool === "read";
}

export function isWriteTool(tool: ToolName): boolean {
  return tool === "write_file" || tool === "write";
}

export function isEditTool(tool: ToolName): boolean {
  return tool === "edit_file" || tool === "edit";
}

export function isSearchTool(tool: ToolName): boolean {
  return tool === "grep_files" || tool === "find_files" || tool === "grep" || tool === "glob";
}

export function isShellTool(tool: ToolName): boolean {
  return tool === "run_shell" || tool === "bash";
}

export function isReviewTool(tool: ToolName): boolean {
  return tool === "show_changes";
}

export function isToolResultCard(value: unknown): value is Omit<ToolResultCard, "tool"> {
  return Boolean(value && typeof value === "object");
}

export function payloadText(payload: ToolPayload | undefined): string {
  return (
    payload?.content
      ?.map((item) => {
        if (item.type === "text") return item.text ?? "";
        return `[${item.mimeType ?? "image"} image payload]`;
      })
      .filter(Boolean)
      .join("\n\n") ?? ""
  );
}

export function summaryNumber(
  summary: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = summary?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function isExpandableCard(card: ToolResultCard): boolean {
  if (card.tool === "open_workspace") {
    return (
      Number(card.summary?.agentsFiles ?? 0) > 0 ||
      Number(card.summary?.skills ?? 0) > 0 ||
      Number(card.summary?.skillDiagnostics ?? 0) > 0 ||
      Boolean(card.agentsFiles?.length) ||
      Boolean(card.availableAgentsFiles?.length) ||
      Boolean(card.skills?.length) ||
      Boolean(card.skillDiagnostics?.length)
    );
  }

  if (isReviewTool(card.tool)) return Boolean(card.files?.length || card.payload?.patch);

  return Boolean(card.payload);
}
