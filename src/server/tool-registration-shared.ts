import * as z from "zod/v4";
import type { ServerConfig, WidgetMode } from "../config.js";

export const WORKSPACE_ID_SCHEMA = z.string().describe("Workspace identifier returned by open_workspace.");

export const VIEW_IMAGE_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
export const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const PROCESS_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
export const MUTATING_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
export const WEB_READ_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
export const WEB_WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
export const WRITE_TOOL_ANNOTATIONS = MUTATING_ANNOTATIONS;
export const EDIT_TOOL_ANNOTATIONS = MUTATING_ANNOTATIONS;
export const SHELL_TOOL_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

export const WORKSPACE_APP_URI = "ui://auvrynt/workspace-app.html";

type ToolWidgetKind =
  | "workspace"
  | "read"
  | "write"
  | "edit"
  | "search"
  | "directory"
  | "shell"
  | "show_changes";

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

export function toolWidgetDescriptorMeta(config: ServerConfig, kind: ToolWidgetKind): {
  _meta: Record<string, unknown>;
} {
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

export function resultOutputSchema(extra: z.ZodRawShape = {}): z.ZodRawShape {
  return {
    result: z.string().describe("Model-readable result text for follow-up reasoning and plain MCP hosts."),
    ...extra,
  };
}
