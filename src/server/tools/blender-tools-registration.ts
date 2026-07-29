import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import {
  MUTATING_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WORKSPACE_ID_SCHEMA,
  toolWidgetDescriptorMeta,
} from "../tool-registration-shared.js";
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
} from "../../integrations/blender/blender-tools.js";

export function registerBlenderTools(
  server: McpServer,
  config: ServerConfig,
  workspaces: WorkspaceRegistry,
): void {
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
}
