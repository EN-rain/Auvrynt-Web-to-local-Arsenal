import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import type { ProcessManager } from "../../processes.js";
import { captureWindow } from "../../integrations/images/window-capture.js";
import {
  asepriteConvertFile,
  asepriteCreateSprite,
  asepriteDetect,
  asepriteDrawShapes,
  asepriteExportSpriteSheet,
  asepriteInspectFile,
  asepriteManageFrames,
  asepriteManageLayers,
  asepriteManageTags,
  asepriteSetPalette,
  asepriteSetPixels,
} from "../../integrations/aseprite/aseprite-tools.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import { registerAsepriteAdvancedTools } from "./aseprite-advanced-tools-registration.js";
import {
  MUTATING_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WORKSPACE_ID_SCHEMA,
  toolWidgetDescriptorMeta,
} from "../tool-registration-shared.js";

const COLOR_SCHEMA = z.string().regex(/^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, "Use #RRGGBB or #RRGGBBAA");
const COLOR_MODE_SCHEMA = z.enum(["rgb", "grayscale", "indexed"]);
const MUTATION_GUARD_SCHEMA = {
  expectedVersion: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  checkpoint: z.boolean().optional(),
};
const POINT_SCHEMA = z.object({
  type: z.literal("point"),
  x: z.number().int(),
  y: z.number().int(),
  color: COLOR_SCHEMA,
});
const LINE_SCHEMA = z.object({
  type: z.literal("line"),
  x1: z.number().int(),
  y1: z.number().int(),
  x2: z.number().int(),
  y2: z.number().int(),
  color: COLOR_SCHEMA,
});
const RECT_SCHEMA = z.object({
  type: z.literal("rect"),
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  color: COLOR_SCHEMA,
  fill: z.boolean().optional(),
});

export function registerAsepriteTools(
  server: McpServer,
  config: ServerConfig,
  workspaces: WorkspaceRegistry,
  processManager: ProcessManager,
): void {
  registerAppTool(server, "aseprite_detect", {
    title: "Detect Aseprite",
    description: "Detect the configured Aseprite source build or executable, version, and running process state.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => asepriteDetect(config, workspaces, input));

  registerAppTool(server, "aseprite_capture_current", {
    title: "Capture Current Aseprite Window",
    description: "Capture the currently visible Aseprite application window, including unsaved canvas edits, active frame, timeline, layers, and editor UI. This is a window screenshot, not a clean canvas-only export.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      outputPath: z.string().optional(),
      windowTitle: z.string().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async ({ workspaceId, outputPath, windowTitle }) => captureWindow(workspaces, processManager, {
    workspaceId,
    windowTitle: windowTitle?.trim() || "Aseprite",
    outputPath: outputPath?.trim() || "aseprite/current-window.png",
  }));

  registerAppTool(server, "aseprite_inspect_file", {
    title: "Inspect Aseprite File",
    description: "Inspect sprite dimensions, color mode, layers, frames, durations, tags, slices, and palette size.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => asepriteInspectFile(config, workspaces, input));

  registerAppTool(server, "aseprite_create_sprite", {
    title: "Create Aseprite Sprite",
    description: "Create a new workspace-bound .aseprite/.ase/PNG sprite with a chosen canvas, color mode, first layer, and optional background.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      outputPath: z.string(),
      width: z.number().int().positive().max(8192),
      height: z.number().int().positive().max(8192),
      colorMode: COLOR_MODE_SCHEMA.optional(),
      layerName: z.string().optional(),
      backgroundColor: COLOR_SCHEMA.optional(),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteCreateSprite(config, workspaces, input));

  registerAppTool(server, "aseprite_set_pixels", {
    title: "Set Aseprite Pixels",
    description: "Draw exact pixels into one layer and frame using canvas coordinates and RGBA hex colors.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      layer: z.string().optional(),
      frame: z.number().int().positive().optional(),
      pixels: z.array(z.object({
        x: z.number().int(),
        y: z.number().int(),
        color: COLOR_SCHEMA,
      })).min(1).max(8192),
      ...MUTATION_GUARD_SCHEMA,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteSetPixels(config, workspaces, input));

  registerAppTool(server, "aseprite_draw_shapes", {
    title: "Draw Aseprite Shapes",
    description: "Draw pixel-perfect points, Bresenham lines, outlined rectangles, or filled rectangles into one layer/frame.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      layer: z.string().optional(),
      frame: z.number().int().positive().optional(),
      shapes: z.array(z.discriminatedUnion("type", [POINT_SCHEMA, LINE_SCHEMA, RECT_SCHEMA])).min(1).max(1024),
      ...MUTATION_GUARD_SCHEMA,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteDrawShapes(config, workspaces, input));

  registerAppTool(server, "aseprite_manage_layers", {
    title: "Manage Aseprite Layers",
    description: "Add, rename, delete, show/hide, or change opacity of a sprite layer.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      action: z.enum(["add", "rename", "delete", "set_visibility", "set_opacity"]),
      layer: z.string().optional(),
      name: z.string().optional(),
      visible: z.boolean().optional(),
      opacity: z.number().int().min(0).max(255).optional(),
      ...MUTATION_GUARD_SCHEMA,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteManageLayers(config, workspaces, input));

  registerAppTool(server, "aseprite_manage_frames", {
    title: "Manage Aseprite Frames",
    description: "Add an empty frame, duplicate a frame, delete a frame, or set frame duration in milliseconds.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      action: z.enum(["add_empty", "duplicate", "delete", "set_duration"]),
      frame: z.number().int().positive().optional(),
      durationMs: z.number().int().min(1).max(60000).optional(),
      ...MUTATION_GUARD_SCHEMA,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteManageFrames(config, workspaces, input));

  registerAppTool(server, "aseprite_manage_tags", {
    title: "Manage Aseprite Animation Tags",
    description: "Add, rename, or delete animation tags with forward, reverse, or ping-pong playback.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      action: z.enum(["add", "rename", "delete"]),
      name: z.string(),
      newName: z.string().optional(),
      from: z.number().int().positive().optional(),
      to: z.number().int().positive().optional(),
      direction: z.enum(["forward", "reverse", "ping_pong"]).optional(),
      ...MUTATION_GUARD_SCHEMA,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteManageTags(config, workspaces, input));

  registerAppTool(server, "aseprite_set_palette", {
    title: "Set Aseprite Palette",
    description: "Replace the sprite document palette with 1-256 RGBA hex colors.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      colors: z.array(COLOR_SCHEMA).min(1).max(256),
      ...MUTATION_GUARD_SCHEMA,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteSetPalette(config, workspaces, input));

  registerAppTool(server, "aseprite_export_sprite_sheet", {
    title: "Export Aseprite Sprite Sheet",
    description: "Export frames to a sprite sheet and optional JSON metadata using Aseprite's native CLI packer.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      sheetPath: z.string(),
      dataPath: z.string().optional(),
      sheetType: z.enum(["horizontal", "vertical", "rows", "columns", "packed"]).optional(),
      columns: z.number().int().positive().optional(),
      rows: z.number().int().positive().optional(),
      tag: z.string().optional(),
      layer: z.string().optional(),
      trim: z.boolean().optional(),
      mergeDuplicates: z.boolean().optional(),
      borderPadding: z.number().int().min(0).optional(),
      shapePadding: z.number().int().min(0).optional(),
      innerPadding: z.number().int().min(0).optional(),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteExportSpriteSheet(config, workspaces, input));

  registerAsepriteAdvancedTools(server, config, workspaces, processManager);

  registerAppTool(server, "aseprite_convert_file", {
    title: "Convert Aseprite File",
    description: "Save a sprite to another format with optional nearest-neighbor scaling, color-mode conversion, palette, crop, frame range, tag, layer, or trim.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      outputPath: z.string(),
      scale: z.number().positive().max(64).optional(),
      colorMode: COLOR_MODE_SCHEMA.optional(),
      palettePath: z.string().optional(),
      trim: z.boolean().optional(),
      crop: z.object({
        x: z.number().int(),
        y: z.number().int(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }).optional(),
      frameRange: z.object({
        from: z.number().int().positive(),
        to: z.number().int().positive(),
      }).optional(),
      tag: z.string().optional(),
      layer: z.string().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteConvertFile(config, workspaces, input));

}
