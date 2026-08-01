import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import type { ProcessManager } from "../../processes.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import {
  asepriteAnimationAudit,
  asepriteAuditSprite,
  asepriteCompareDocuments,
  asepriteReadPixels,
} from "../../integrations/aseprite/aseprite-analysis-tools.js";
import {
  asepriteComposeLayers,
  asepriteDrawStroke,
  asepriteEditRegion,
  asepriteImportSpriteSheet,
  asepriteManageAnimation,
  asepriteManageCels,
  asepriteManageColor,
  asepriteManageDocument,
  asepriteManageMask,
  asepriteRunSafeCommand,
} from "../../integrations/aseprite/aseprite-editing-tools.js";
import {
  asepriteCaptureCanvas,
  asepriteLiveEditor,
} from "../../integrations/aseprite/aseprite-live-tools.js";
import {
  asepriteDrawAdvanced,
  asepriteManageTilemap,
} from "../../integrations/aseprite/aseprite-specialized-tools.js";
import {
  asepriteBatchProcess,
  asepriteExtensions,
  asepriteFileSafety,
  asepriteMaintenance,
  asepriteManageExportPreset,
  asepriteRecovery,
} from "../../integrations/aseprite/aseprite-safety-tools.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import {
  MUTATING_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WORKSPACE_ID_SCHEMA,
  toolWidgetDescriptorMeta,
} from "../tool-registration-shared.js";

const COLOR_SCHEMA = z.string().regex(/^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, "Use #RRGGBB or #RRGGBBAA");
const REGION_SCHEMA = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
const POINT_SCHEMA = z.object({
  x: z.number().int(),
  y: z.number().int(),
  pressure: z.number().min(0).max(1).optional(),
});
const MUTATION_GUARD_SCHEMA = {
  expectedVersion: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  checkpoint: z.boolean().optional(),
};
const EXPORT_PRESET_SCHEMA = z.object({
  filePath: z.string(),
  sheetPath: z.string(),
  dataPath: z.string().optional(),
  sheetType: z.enum(["horizontal", "vertical", "rows", "columns", "packed"]).optional(),
  columns: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  sheetWidth: z.number().int().positive().optional(),
  sheetHeight: z.number().int().positive().optional(),
  tag: z.string().optional(),
  layer: z.string().optional(),
  ignoreLayers: z.array(z.string()).max(128).optional(),
  allLayers: z.boolean().optional(),
  splitLayers: z.boolean().optional(),
  splitTags: z.boolean().optional(),
  splitSlices: z.boolean().optional(),
  splitGrid: z.boolean().optional(),
  playSubtags: z.boolean().optional(),
  ignoreEmpty: z.boolean().optional(),
  trim: z.boolean().optional(),
  trimSprite: z.boolean().optional(),
  trimByGrid: z.boolean().optional(),
  extrude: z.boolean().optional(),
  mergeDuplicates: z.boolean().optional(),
  borderPadding: z.number().int().min(0).optional(),
  shapePadding: z.number().int().min(0).optional(),
  innerPadding: z.number().int().min(0).optional(),
  filenameFormat: z.string().optional(),
  tagnameFormat: z.string().optional(),
  dataFormat: z.enum(["json-array", "json-hash"]).optional(),
});

export function registerAsepriteAdvancedTools(
  server: McpServer,
  config: ServerConfig,
  workspaces: WorkspaceRegistry,
  processManager: ProcessManager,
): void {
  registerAppTool(server, "aseprite_read_pixels", {
    title: "Read Aseprite Pixels",
    description: "Read exact RGBA values or palette indices from a sprite layer/frame region, including histogram and alpha bounds.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      layer: z.string().optional(),
      frame: z.number().int().positive().optional(),
      region: REGION_SCHEMA.optional(),
      format: z.enum(["rows", "points", "histogram"]).optional(),
      includeTransparent: z.boolean().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => asepriteReadPixels(config, workspaces, input));

  registerAppTool(server, "aseprite_audit_sprite", {
    title: "Audit Aseprite Sprite",
    description: "Audit empty/duplicate frames, isolated or semi-transparent pixels, palette waste, linked cels, tags, and canvas occupancy.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      isolatedNeighborMode: z.union([z.literal(4), z.literal(8)]).optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => asepriteAuditSprite(config, workspaces, input));

  registerAppTool(server, "aseprite_compare_documents", {
    title: "Compare Aseprite Documents",
    description: "Compare two Aseprite documents structurally and optionally compare every flattened frame pixel-by-pixel.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      referencePath: z.string(),
      candidatePath: z.string(),
      comparePixels: z.boolean().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => asepriteCompareDocuments(config, workspaces, input));

  registerAppTool(server, "aseprite_animation_audit", {
    title: "Audit Aseprite Animation",
    description: "Analyze frame timing, silhouettes, movement centers, anchor-layer jitter, duplicate frames, and loop continuity.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      tag: z.string().optional(),
      anchorLayer: z.string().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => asepriteAnimationAudit(config, workspaces, input));

  registerAppTool(server, "aseprite_file_safety", {
    title: "Manage Aseprite File Safety",
    description: "Read or assert a sprite SHA-256 version, create/list/delete checkpoints, or atomically roll back a source document.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      action: z.enum(["status", "checkpoint", "list_checkpoints", "rollback", "delete_checkpoint", "assert_version"]),
      checkpointId: z.string().optional(),
      expectedVersion: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
      label: z.string().max(256).optional(),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteFileSafety(config, workspaces, input));

  registerAppTool(server, "aseprite_import_sprite_sheet", {
    title: "Import Aseprite Sprite Sheet",
    description: "Split a workspace image into a layered Aseprite animation using exact grid, margin, spacing, order, timing, and tag settings.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      imagePath: z.string(),
      outputPath: z.string(),
      frameWidth: z.number().int().positive(),
      frameHeight: z.number().int().positive(),
      marginX: z.number().int().min(0).optional(),
      marginY: z.number().int().min(0).optional(),
      spacingX: z.number().int().min(0).optional(),
      spacingY: z.number().int().min(0).optional(),
      columns: z.number().int().positive().optional(),
      rows: z.number().int().positive().optional(),
      frameCount: z.number().int().positive().optional(),
      order: z.enum(["row_major", "column_major"]).optional(),
      layerName: z.string().optional(),
      tagName: z.string().optional(),
      durationMs: z.number().int().min(1).max(60000).optional(),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteImportSpriteSheet(config, workspaces, input));

  registerAppTool(server, "aseprite_edit_region", {
    title: "Edit Aseprite Region",
    description: "Copy or composite a sprite region across files, layers, and frames with nearest-neighbor scaling, rotation, flips, and guarded source saving.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      targetPath: z.string(),
      sourcePath: z.string().optional(),
      sourceLayer: z.string().optional(),
      sourceFrame: z.number().int().positive().optional(),
      sourceRegion: REGION_SCHEMA,
      targetLayer: z.string().optional(),
      targetFrame: z.number().int().positive().optional(),
      targetX: z.number().int(),
      targetY: z.number().int(),
      createTargetLayer: z.boolean().optional(),
      scale: z.number().int().positive().max(16).optional(),
      rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
      flipX: z.boolean().optional(),
      flipY: z.boolean().optional(),
      blend: z.enum(["replace", "normal", "behind"]).optional(),
      ...MUTATION_GUARD_SCHEMA,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteEditRegion(config, workspaces, input));

  registerAppTool(server, "aseprite_draw_stroke", {
    title: "Draw Aseprite Stroke",
    description: "Draw with Aseprite's pencil, eraser, or bucket using native brushes, inks, pixel-perfect mode, symmetry, and tiled drawing.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      layer: z.string().optional(),
      frame: z.number().int().positive().optional(),
      points: z.array(POINT_SCHEMA).min(1).max(16384),
      tool: z.enum(["pencil", "eraser", "paint_bucket"]).optional(),
      color: COLOR_SCHEMA.optional(),
      opacity: z.number().int().min(0).max(255).optional(),
      brush: z.object({
        type: z.enum(["circle", "square", "line", "image"]).optional(),
        size: z.number().int().positive().max(256).optional(),
        angle: z.number().int().optional(),
        imagePath: z.string().optional(),
      }).optional(),
      ink: z.enum(["simple", "alpha", "copy", "lock_alpha", "shading"]).optional(),
      pixelPerfect: z.boolean().optional(),
      symmetry: z.object({
        horizontalX: z.number().int().optional(),
        verticalY: z.number().int().optional(),
      }).optional(),
      tiled: z.object({ horizontal: z.boolean().optional(), vertical: z.boolean().optional() }).optional(),
      ...MUTATION_GUARD_SCHEMA,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteDrawStroke(config, workspaces, input));

  registerAppTool(server, "aseprite_compose_layers", {
    title: "Compose Aseprite Layers",
    description: "Create groups, duplicate, merge, flatten, reorder, group, lock, blend, solo, or convert background layers.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      action: z.enum(["create_group", "duplicate", "merge_down", "flatten_all", "flatten_visible", "to_background", "from_background", "reorder", "move_to_group", "set_locked", "set_blend_mode", "solo"]),
      layer: z.string().optional(),
      name: z.string().optional(),
      group: z.string().optional(),
      stackIndex: z.number().int().positive().optional(),
      locked: z.boolean().optional(),
      blendMode: z.enum(["normal", "multiply", "screen", "overlay", "darken", "lighten", "addition", "subtract", "divide"]).optional(),
      ...MUTATION_GUARD_SCHEMA,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteComposeLayers(config, workspaces, input));

  registerAppTool(server, "aseprite_manage_mask", {
    title: "Manage Aseprite Mask",
    description: "Create and persist rectangular, color, or opaque-content masks; inspect, invert, move, clear, or fill masked pixels.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      action: z.enum(["create_rect", "create_color", "create_opaque", "invert", "move", "inspect", "apply_clear", "apply_fill"]),
      maskPath: z.string(),
      layer: z.string().optional(),
      frame: z.number().int().positive().optional(),
      rect: REGION_SCHEMA.optional(),
      color: COLOR_SCHEMA.optional(),
      tolerance: z.number().int().min(0).max(255).optional(),
      dx: z.number().int().optional(),
      dy: z.number().int().optional(),
      movePixels: z.boolean().optional(),
      fillColor: COLOR_SCHEMA.optional(),
      ...MUTATION_GUARD_SCHEMA,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteManageMask(config, workspaces, input));

  registerAppTool(server, "aseprite_manage_color", {
    title: "Manage Aseprite Color",
    description: "Inspect and edit palettes, transparent index, color remaps, ICC profiles, palette files, quantization, and dithering.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      action: z.enum(["inspect", "set_palette_entry", "set_transparent_index", "remap_color", "assign_profile", "convert_profile", "remove_profile", "load_palette", "save_palette", "quantize", "apply_palette_preset"]),
      index: z.number().int().min(0).optional(),
      color: COLOR_SCHEMA.optional(),
      fromColor: COLOR_SCHEMA.optional(),
      toColor: COLOR_SCHEMA.optional(),
      tolerance: z.number().int().min(0).max(255).optional(),
      profilePath: z.string().optional(),
      palettePath: z.string().optional(),
      preset: z.enum(["gameboy", "pico8", "cga", "c64", "dawnbringer16", "grayscale_4", "monochrome"]).optional(),
      maxColors: z.number().int().min(2).max(256).optional(),
      dithering: z.enum(["none", "ordered", "old"]).optional(),
      ditheringMatrix: z.string().optional(),
      ...MUTATION_GUARD_SCHEMA,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteManageColor(config, workspaces, input));

  registerAppTool(server, "aseprite_manage_document", {
    title: "Manage Aseprite Document",
    description: "Resize, crop, trim, configure grid/pixel ratio, edit user data, and create/update/delete slices with pivot and nine-slice data.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      action: z.enum(["resize_sprite", "resize_canvas", "crop", "trim", "set_grid", "set_pixel_ratio", "set_userdata", "create_slice", "update_slice", "delete_slice"]),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      offsetX: z.number().int().optional(),
      offsetY: z.number().int().optional(),
      region: REGION_SCHEMA.optional(),
      grid: REGION_SCHEMA.optional(),
      ratioWidth: z.number().int().positive().optional(),
      ratioHeight: z.number().int().positive().optional(),
      targetType: z.enum(["sprite", "layer", "cel", "tag", "slice"]).optional(),
      targetName: z.string().optional(),
      frame: z.number().int().positive().optional(),
      data: z.string().optional(),
      properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
      sliceName: z.string().optional(),
      center: REGION_SCHEMA.optional(),
      pivot: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
      ...MUTATION_GUARD_SCHEMA,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteManageDocument(config, workspaces, input));

  registerAppTool(server, "aseprite_manage_cels", {
    title: "Manage Aseprite Cels",
    description: "Inspect, create, delete, move, duplicate, link/unlink, and change opacity or z-index of cels.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      action: z.enum(["inspect", "create", "delete", "move", "duplicate", "link", "unlink", "set_opacity", "set_z_index"]),
      layer: z.string(),
      frame: z.number().int().positive(),
      targetLayer: z.string().optional(),
      targetFrame: z.number().int().positive().optional(),
      x: z.number().int().optional(),
      y: z.number().int().optional(),
      opacity: z.number().int().min(0).max(255).optional(),
      zIndex: z.number().int().optional(),
      ...MUTATION_GUARD_SCHEMA,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteManageCels(config, workspaces, input));

  registerAppTool(server, "aseprite_manage_animation", {
    title: "Manage Aseprite Animation",
      description: "Move/copy/reverse frames, set durations, update tags, or tween cel positions with pixel-safe easing.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      action: z.enum(["move_frame", "copy_frame", "reverse_range", "set_durations", "update_tag", "tween_cel_position"]),
      layer: z.string().optional(),
      easing: z.enum(["linear", "ease_in", "ease_out", "smoothstep"]).optional(),
      targetX: z.number().int().optional(),
      targetY: z.number().int().optional(),
      frame: z.number().int().positive().optional(),
      targetFrame: z.number().int().positive().optional(),
      from: z.number().int().positive().optional(),
      to: z.number().int().positive().optional(),
      durations: z.array(z.object({ frame: z.number().int().positive(), durationMs: z.number().int().min(1).max(60000) })).max(10000).optional(),
      tagName: z.string().optional(),
      newName: z.string().optional(),
      direction: z.enum(["forward", "reverse", "ping_pong"]).optional(),
      repeats: z.number().int().min(0).optional(),
      ...MUTATION_GUARD_SCHEMA,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteManageAnimation(config, workspaces, input));

  registerAppTool(server, "aseprite_run_safe_command", {
    title: "Run Safe Aseprite Command",
    description: "Run one curated non-arbitrary Aseprite document command with version and checkpoint protection.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      command: z.enum(["clear_cel", "flatten", "merge_down", "background_from_layer", "layer_from_background", "reverse_frames", "copy_merged_to_layer"]),
      layer: z.string().optional(),
      frame: z.number().int().positive().optional(),
      from: z.number().int().positive().optional(),
      to: z.number().int().positive().optional(),
      outputLayerName: z.string().optional(),
      ...MUTATION_GUARD_SCHEMA,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteRunSafeCommand(config, workspaces, input));

  registerAppTool(server, "aseprite_draw_advanced", {
    title: "Draw Advanced Aseprite Geometry",
    description: "Draw native ellipses, polygons, gradients, outlines, and flood fills with exact layer/frame targeting and guarded saves.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      action: z.enum(["ellipse", "polygon", "gradient", "outline", "flood_fill"]),
      layer: z.string().optional(),
      frame: z.number().int().positive().optional(),
      color: COLOR_SCHEMA.optional(),
      secondaryColor: COLOR_SCHEMA.optional(),
      opacity: z.number().int().min(0).max(255).optional(),
      points: z.array(z.object({ x: z.number().int(), y: z.number().int() })).max(16384).optional(),
      bounds: REGION_SCHEMA.optional(),
      fill: z.boolean().optional(),
      connectivity: z.union([z.literal(4), z.literal(8)]).optional(),
      thickness: z.number().int().positive().max(64).optional(),
      includeDiagonal: z.boolean().optional(),
      ...MUTATION_GUARD_SCHEMA,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteDrawAdvanced(config, workspaces, input));

  registerAppTool(server, "aseprite_manage_tilemap", {
    title: "Manage Aseprite Tilemaps",
    description: "Inspect or edit native tilesets, tilemap layers, tile pixels, encoded map cells, flip flags, metadata, imports, and tileset exports.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePath: z.string(),
      action: z.enum(["inspect", "create_layer", "create_tileset", "assign_tileset", "delete_tileset", "import_tileset", "create_tile", "delete_tile", "set_tile_pixels", "set_cells", "set_metadata", "export_tileset"]),
      layer: z.string().optional(),
      frame: z.number().int().positive().optional(),
      name: z.string().optional(),
      tilesetIndex: z.number().int().positive().optional(),
      tileIndex: z.number().int().min(0).optional(),
      insertAt: z.number().int().min(0).optional(),
      grid: z.object({
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        tileWidth: z.number().int().positive(),
        tileHeight: z.number().int().positive(),
      }).optional(),
      tileCount: z.number().int().positive().optional(),
      sourceImagePath: z.string().optional(),
      columns: z.number().int().positive().optional(),
      rows: z.number().int().positive().optional(),
      marginX: z.number().int().min(0).optional(),
      marginY: z.number().int().min(0).optional(),
      spacingX: z.number().int().min(0).optional(),
      spacingY: z.number().int().min(0).optional(),
      pixels: z.array(z.object({ x: z.number().int(), y: z.number().int(), color: COLOR_SCHEMA })).max(65536).optional(),
      cells: z.array(z.object({
        x: z.number().int(),
        y: z.number().int(),
        tileIndex: z.number().int().min(0),
        flipX: z.boolean().optional(),
        flipY: z.boolean().optional(),
        diagonal: z.boolean().optional(),
      })).max(65536).optional(),
      data: z.string().optional(),
      color: COLOR_SCHEMA.optional(),
      properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
      outputPath: z.string().optional(),
      ...MUTATION_GUARD_SCHEMA,
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteManageTilemap(config, workspaces, input));

  registerAppTool(server, "aseprite_live_editor", {
    title: "Control Live Aseprite Editor",
    description: "Install/status the authenticated Aseprite extension bridge and inspect or control the active unsaved editor through an allowlisted request queue.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      action: z.enum([
        "install_bridge", "bridge_status", "list_documents", "inspect", "new_document", "open_document",
        "select_document", "select_layer", "select_frame", "save", "save_as", "close_document", "undo", "redo",
        "toggle_playback", "set_zoom", "set_onion_skin", "set_tool", "set_colors", "set_brush", "set_selection",
        "clear_selection", "set_pixels", "draw_stroke", "create_layer", "create_frame", "delete_frame",
        "set_frame_duration", "run_live_command", "safe_command",
      ]),
      allowGlobalWrite: z.boolean().optional(),
      documentId: z.string().optional(),
      filename: z.string().optional(),
      path: z.string().optional(),
      width: z.number().int().positive().max(8192).optional(),
      height: z.number().int().positive().max(8192).optional(),
      colorMode: z.enum(["rgb", "grayscale", "indexed"]).optional(),
      layer: z.string().optional(),
      frame: z.number().int().positive().optional(),
      discardChanges: z.boolean().optional(),
      zoom: z.number().positive().max(64).optional(),
      active: z.boolean().optional(),
      prevFrames: z.number().int().min(0).optional(),
      nextFrames: z.number().int().min(0).optional(),
      opacityBase: z.number().int().min(0).max(255).optional(),
      opacityStep: z.number().int().min(0).max(255).optional(),
      loopTag: z.boolean().optional(),
      currentLayer: z.boolean().optional(),
      tool: z.string().optional(),
      foreground: COLOR_SCHEMA.optional(),
      background: COLOR_SCHEMA.optional(),
      brushType: z.enum(["circle", "square", "line"]).optional(),
      size: z.number().int().positive().max(256).optional(),
      angle: z.number().int().optional(),
      bounds: REGION_SCHEMA.optional(),
      mode: z.enum(["replace", "add", "subtract", "intersect"]).optional(),
      pixels: z.array(z.object({ x: z.number().int(), y: z.number().int(), color: COLOR_SCHEMA })).max(8192).optional(),
      points: z.array(z.object({ x: z.number().int(), y: z.number().int() })).max(16384).optional(),
      color: COLOR_SCHEMA.optional(),
      opacity: z.number().int().min(0).max(255).optional(),
      pixelPerfect: z.boolean().optional(),
      name: z.string().optional(),
      group: z.boolean().optional(),
      duplicate: z.boolean().optional(),
      durationMs: z.number().int().min(1).max(60000).optional(),
      liveCommand: z.enum([
        "get_pixel", "get_image_data", "draw_line", "draw_rect", "draw_ellipse",
        "flood_fill", "clear_image", "replace_color", "outline", "draw_symmetry",
        "apply_dither", "set_layer_properties", "reorder_layer", "get_cel", "set_cel",
        "create_tag", "update_tag", "delete_tag", "get_palette", "set_palette_color",
        "set_palette", "generate_color_ramp", "sort_palette", "create_character_template", "create_tileset_template",
        "get_selection", "select_all", "deselect", "invert_selection", "select_ellipse",
        "select_by_color", "set_frame_range_duration", "duplicate_frame", "reverse_frames", "shift_cel",
        "flip_sprite", "rotate_sprite", "copy_between_sprites", "resize_sprite", "crop_sprite",
        "flatten_sprite", "set_grid", "get_sprite_bounds", "get_color_stats", "compare_frames",
        "validate_animation",
      ]).optional(),
      arguments: z.record(z.string(), z.unknown()).optional(),
      command: z.enum(["DuplicateLayer", "MergeDownLayer", "FlattenLayers", "BackgroundFromLayer", "LayerFromBackground", "ReverseFrames", "ClearCel", "NewFrame", "RemoveFrame", "NewLayer", "RemoveLayer"]).optional(),
      params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteLiveEditor(config, workspaces, input));

  registerAppTool(server, "aseprite_capture_canvas", {
    title: "Capture Live Aseprite Canvas",
    description: "Capture only the active unsaved Aseprite canvas at native or nearest-neighbor integer scale, excluding all editor UI.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      documentId: z.string().optional(),
      filename: z.string().optional(),
      frame: z.number().int().positive().optional(),
      scale: z.number().int().positive().max(32).optional(),
      outputPath: z.string().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteCaptureCanvas(workspaces, input));

  registerAppTool(server, "aseprite_manage_export_preset", {
    title: "Manage Aseprite Export Preset",
    description: "Save/list/delete/run/repeat/validate project-local Aseprite export presets with complete CLI sheet options.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      action: z.enum(["save", "list", "delete", "run", "repeat", "validate"]),
      name: z.string().optional(),
      preset: EXPORT_PRESET_SCHEMA.optional(),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteManageExportPreset(config, workspaces, input));

  registerAppTool(server, "aseprite_batch_process", {
    title: "Batch Process Aseprite Files",
    description: "Dry-run or batch audit, convert, export, or repair up to 128 sprite files with optional source checkpoints.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      filePaths: z.array(z.string()).min(1).max(128),
      operation: z.enum(["audit", "convert", "export", "repair"]),
      dryRun: z.boolean().optional(),
      outputDirectory: z.string().optional(),
      inPlace: z.boolean().optional(),
      scale: z.number().positive().max(64).optional(),
      colorMode: z.enum(["rgb", "grayscale", "indexed"]).optional(),
      palettePath: z.string().optional(),
      trim: z.boolean().optional(),
      sheetType: z.enum(["horizontal", "vertical", "rows", "columns", "packed"]).optional(),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteBatchProcess(config, workspaces, input));

  registerAppTool(server, "aseprite_maintenance", {
    title: "Maintain Aseprite Document",
    description: "Validate decoding, save/reopen a clean repaired copy, or test a lossy format round trip and compare the result.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      action: z.enum(["validate", "repair", "roundtrip"]),
      filePath: z.string(),
      outputPath: z.string().optional(),
      intermediateFormat: z.enum(["png", "gif", "webp"]).optional(),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteMaintenance(config, workspaces, input));

  registerAppTool(server, "aseprite_recovery", {
    title: "Manage Aseprite Recovery",
    description: "List, archive, discard, or open Aseprite's native crash-recovery sessions. Global deletion requires explicit allowGlobalWrite.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      action: z.enum(["list", "archive", "discard", "open_recovery_ui"]),
      sessionId: z.string().optional(),
      outputDirectory: z.string().optional(),
      allowGlobalWrite: z.boolean().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteRecovery(config, workspaces, processManager, input));

  registerAppTool(server, "aseprite_extensions", {
    title: "Manage Aseprite Extensions",
    description: "List extensions/resources/startup errors or install, enable, disable, and remove extensions with explicit global-write consent.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      action: z.enum(["list_extensions", "list_resources", "install", "enable", "disable", "remove", "startup_errors"]),
      sourceDirectoryPath: z.string().optional(),
      extensionName: z.string().optional(),
      allowGlobalWrite: z.boolean().optional(),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, async (input) => asepriteExtensions(workspaces, input));
}
