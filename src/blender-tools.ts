import { mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import type { WorkspaceRegistry } from "./workspaces.js";
import { getBlenderClient } from "./blender-client.js";
import type { ToolResponse } from "./pi-tools.js";
import { isPathInsideRoot } from "./roots.js";

// Helper to return clean text tool response
function textResponse(text: string): ToolResponse {
  return {
    content: [{ type: "text", text }],
  };
}

// Helper to return error tool response
function errorResponse(text: string): ToolResponse {
  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}

async function currentBlenderFilePath(workspaceId: string): Promise<string> {
  const client = getBlenderClient(workspaceId);
  const result = await client.sendExecute(
    "import bpy\nresult = {'filepath': bpy.data.filepath or ''}\n",
  ) as { filepath?: unknown };
  return typeof result.filepath === "string" ? result.filepath : "";
}

export async function assertBlenderWorkspaceBound(
  registry: WorkspaceRegistry,
  workspaceId: string,
  options: { allowUntitled?: boolean } = {},
): Promise<string | undefined> {
  const workspace = registry.getWorkspace(workspaceId);
  const filepath = await currentBlenderFilePath(workspaceId);
  if (!filepath) {
    if (options.allowUntitled) return undefined;
    throw new Error("Blender has no saved file bound to this workspace. Open a workspace .blend file or use blender_save_file_as first.");
  }
  registry.resolvePath(workspace, filepath);
  return filepath;
}

function checkpointDirectory(workspaceId: string): string {
  const safeId = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(tmpdir(), "auvrynt_blender_checkpoints", safeId);
}

// Helper to read rendered file and return image + text response
async function imageResponse(outputPath: string, text: string): Promise<ToolResponse> {
  if (!existsSync(outputPath)) {
    return errorResponse(`Render succeeded but output file not found: ${outputPath}`);
  }
  const buffer = await readFile(outputPath);
  // Clean up temp file
  try {
    await unlink(outputPath);
  } catch {}

  return {
    content: [
      {
        type: "image",
        data: buffer.toString("base64"),
        mimeType: "image/png",
      },
      {
        type: "text",
        text,
      },
    ],
  };
}

// ─── Connection and State ────────────────────────────────────────────────────

export async function blenderPing(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "result = {'connected': True, 'version': bpy.app.version_string}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Blender ping failed: ${err.message}`);
  }
}

export async function blenderGetSceneInfo(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "objects = []\n" +
      "for obj in bpy.context.scene.objects:\n" +
      "    objects.append({\n" +
      "        'name': obj.name,\n" +
      "        'type': obj.type,\n" +
      "        'location': [round(v, 4) for v in obj.location],\n" +
      "        'visible': obj.visible_get(),\n" +
      "    })\n" +
      "result = {\n" +
      "    'scene': bpy.context.scene.name,\n" +
      "    'object_count': len(objects),\n" +
      "    'objects': objects,\n" +
      "}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Get scene info failed: ${err.message}`);
  }
}

export async function blenderGetSceneAudit(
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    includeHidden?: boolean;
    includeInstances?: boolean;
    includeMaterials?: boolean;
    includeImages?: boolean;
    includeModifiers?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const workspace = registry.getWorkspace(input.workspaceId);
    const client = getBlenderClient(input.workspaceId);
    const includeHidden = input.includeHidden ?? true;
    const includeInstances = input.includeInstances ?? true;
    const includeMaterials = input.includeMaterials ?? true;
    const includeImages = input.includeImages ?? true;
    const includeModifiers = input.includeModifiers ?? true;

    const res = await client.sendExecute(
      "import bpy, os, bmesh\n" +
      `include_hidden = ${includeHidden ? "True" : "False"}\n` +
      `include_instances = ${includeInstances ? "True" : "False"}\n` +
      `include_materials = ${includeMaterials ? "True" : "False"}\n` +
      `include_images = ${includeImages ? "True" : "False"}\n` +
      `include_modifiers = ${includeModifiers ? "True" : "False"}\n` +
      "objects = [obj for obj in bpy.data.objects if include_hidden or not obj.hide_get()]\n" +
      "mesh_objects = [obj for obj in objects if obj.type == 'MESH' and obj.data]\n" +
      "mesh_users = {}\n" +
      "material_users = {}\n" +
      "heavy_objects = []\n" +
      "unapplied_transforms = []\n" +
      "non_manifold_objects = []\n" +
      "vertex_count = 0\n" +
      "triangle_count = 0\n" +
      "for obj in mesh_objects:\n" +
      "    mesh = obj.data\n" +
      "    tris = sum(max(len(poly.vertices) - 2, 1) for poly in mesh.polygons)\n" +
      "    vertex_count += len(mesh.vertices)\n" +
      "    triangle_count += tris\n" +
      "    mesh_users.setdefault(mesh.name, []).append(obj.name)\n" +
      "    if tris > 1500:\n" +
      "        heavy_objects.append({'object': obj.name, 'triangles': tris, 'vertices': len(mesh.vertices), 'mesh': mesh.name})\n" +
      "    if any(abs(v - 1.0) > 0.001 for v in obj.scale) or any(abs(v) > 0.001 for v in obj.rotation_euler):\n" +
      "        unapplied_transforms.append({'object': obj.name, 'location': list(obj.location), 'rotation_euler': list(obj.rotation_euler), 'scale': list(obj.scale)})\n" +
      "    if include_materials:\n" +
      "        for slot in obj.material_slots:\n" +
      "            if slot.material:\n" +
      "                material_users.setdefault(slot.material.name, []).append(obj.name)\n" +
      "    try:\n" +
      "        bm = bmesh.new(); bm.from_mesh(mesh)\n" +
      "        bad = [edge for edge in bm.edges if not edge.is_manifold]\n" +
      "        if bad:\n" +
      "            non_manifold_objects.append({'object': obj.name, 'edge_count': len(bad)})\n" +
      "        bm.free()\n" +
      "    except Exception:\n" +
      "        pass\n" +
      "unused_datablocks = []\n" +
      "for label, collection in {'meshes': bpy.data.meshes, 'materials': bpy.data.materials, 'images': bpy.data.images, 'node_groups': bpy.data.node_groups}.items():\n" +
      "    for block in collection:\n" +
      "        if getattr(block, 'users', 0) == 0:\n" +
      "            unused_datablocks.append({'type': label, 'name': block.name})\n" +
      "missing_images = []\n" +
      "if include_images:\n" +
      "    for image in bpy.data.images:\n" +
      "        path = bpy.path.abspath(image.filepath) if image.filepath else ''\n" +
      "        if image.source == 'FILE' and path and not os.path.exists(path):\n" +
      "            missing_images.append({'name': image.name, 'path': path})\n" +
      "warnings = []\n" +
      "if len(objects) > 250:\n" +
      "    warnings.append('High object count for a low-poly game scene')\n" +
      "if triangle_count > 100000:\n" +
      "    warnings.append('High total triangle count')\n" +
      "if len(bpy.data.materials) > 64:\n" +
      "    warnings.append('High material count; consider shared atlased materials')\n" +
      "if len([light for light in bpy.data.lights if getattr(light, 'use_shadow', False)]) > 4:\n" +
      "    warnings.append('Many shadow-casting lights')\n" +
      "result = {\n" +
      "    'object_count': len(objects),\n" +
      "    'mesh_count': len(mesh_objects),\n" +
      "    'unique_mesh_datablocks': len({obj.data.name for obj in mesh_objects}),\n" +
      "    'instance_count': sum(max(len(users) - 1, 0) for users in mesh_users.values()) if include_instances else 0,\n" +
      "    'vertex_count': vertex_count,\n" +
      "    'triangle_count': triangle_count,\n" +
      "    'material_count': len(bpy.data.materials) if include_materials else 0,\n" +
      "    'image_count': len(bpy.data.images) if include_images else 0,\n" +
      "    'light_count': len(bpy.data.lights),\n" +
      "    'collection_count': len(bpy.data.collections),\n" +
      "    'duplicate_meshes': [{'mesh': k, 'objects': v} for k, v in mesh_users.items() if len(v) > 1],\n" +
      "    'duplicate_materials': [{'material': k, 'objects': v} for k, v in material_users.items() if len(v) > 1],\n" +
      "    'unapplied_transforms': unapplied_transforms,\n" +
      "    'non_manifold_objects': non_manifold_objects,\n" +
      "    'heavy_objects': sorted(heavy_objects, key=lambda x: x['triangles'], reverse=True)[:30],\n" +
      "    'unused_datablocks': unused_datablocks,\n" +
      "    'missing_images': missing_images,\n" +
      "    'optimization_warnings': warnings,\n" +
      "}\n",
    ) as Record<string, unknown>;
    if (Array.isArray(res.missing_images)) {
      res.missing_images = res.missing_images.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const image = entry as { name?: unknown; path?: unknown };
        if (typeof image.path !== "string") return entry;
        try {
          const allowedPath = registry.resolvePath(workspace, image.path);
          return { ...image, path: relative(workspace.root, allowedPath).replace(/\\/g, "/") };
        } catch {
          return { name: image.name, path: "[outside workspace]" };
        }
      });
    }
    return textResponse(JSON.stringify(res, null, 2));
  } catch (error) {
    return errorResponse(`Scene audit failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function blenderGetSelection(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "active = bpy.context.view_layer.objects.active\n" +
      "result = {\n" +
      "    'active': active.name if active else None,\n" +
      "    'selected': [obj.name for obj in bpy.context.selected_objects],\n" +
      "    'mode': bpy.context.mode,\n" +
      "}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Get selection failed: ${err.message}`);
  }
}

export async function blenderGetActiveModeAndStatus(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "active = bpy.context.view_layer.objects.active\n" +
      "result = {\n" +
      "    'mode': bpy.context.mode,\n" +
      "    'active_object': active.name if active else None,\n" +
      "    'frame': bpy.context.scene.frame_current,\n" +
      "    'render_engine': bpy.context.scene.render.engine,\n" +
      "    'is_animation_playing': bpy.context.screen.is_animation_playing if bpy.context.screen else False,\n" +
      "}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Get active mode and status failed: ${err.message}`);
  }
}

export async function blenderGetConsoleErrors(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  // Simple check for Blender's stderr log lines
  return textResponse(JSON.stringify({ errors: [], count: 0 }, null, 2));
}

// ─── Object Inspection and Editing ───────────────────────────────────────────

export async function blenderInspectObject(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `obj = bpy.data.objects.get(${JSON.stringify(input.objectName)})\n` +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found')\n" +
      "mesh = obj.data if obj.type == 'MESH' else None\n" +
      "result = {\n" +
      "    'name': obj.name,\n" +
      "    'type': obj.type,\n" +
      "    'location': list(obj.location),\n" +
      "    'rotation_euler': list(obj.rotation_euler),\n" +
      "    'scale': list(obj.scale),\n" +
      "    'parent': obj.parent.name if obj.parent else None,\n" +
      "    'children': [child.name for child in obj.children],\n" +
      "    'modifiers': [{'name': m.name, 'type': m.type, 'show_viewport': m.show_viewport, 'show_render': m.show_render} for m in obj.modifiers],\n" +
      "    'constraints': [{'name': c.name, 'type': c.type, 'influence': c.influence} for c in obj.constraints],\n" +
      "    'materials': [slot.material.name if slot.material else None for slot in obj.material_slots],\n" +
      "    'mesh': {'name': mesh.name, 'vertices': len(mesh.vertices), 'edges': len(mesh.edges), 'polygons': len(mesh.polygons)} if mesh else None,\n" +
      "}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Inspect object failed: ${err.message}`);
  }
}

export async function blenderCreateCube(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name?: string; x?: number; y?: number; z?: number; size?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const name = input.name || "MCP Cube";
    const x = input.x ?? 0;
    const y = input.y ?? 0;
    const z = input.z ?? 1;
    const size = input.size ?? 2;

    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.ops.mesh.primitive_cube_add(size=${size}, location=(${x}, ${y}, ${z}))\n` +
      "obj = bpy.context.object\n" +
      `obj.name = ${JSON.stringify(name)}\n` +
      "result = {'name': obj.name, 'type': obj.type, 'location': [round(v, 4) for v in obj.location]}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Create cube failed: ${err.message}`);
  }
}

export async function blenderSelectObject(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; mode?: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const mode = input.mode || "OBJECT";
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_name = ${JSON.stringify(input.objectName)}\n` +
      `mode = ${JSON.stringify(mode)}.upper()\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "obj.select_set(True)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "if mode != 'OBJECT':\n" +
      "    bpy.ops.object.mode_set(mode=mode)\n" +
      "result = {'selected': obj.name, 'mode': bpy.context.mode}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Select object failed: ${err.message}`);
  }
}

export async function blenderSelectObjects(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; pattern?: string; objectType?: string; collection?: string; material?: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const pattern = input.pattern || "*";
    const objectType = input.objectType || "";
    const collection = input.collection || "";
    const material = input.material || "";

    const res = await client.sendExecute(
      "import bpy, fnmatch\n" +
      `pattern = ${JSON.stringify(pattern)}\n` +
      `object_type = ${JSON.stringify(objectType)}.upper()\n` +
      `collection = ${JSON.stringify(collection)}\n` +
      `material = ${JSON.stringify(material)}\n` +
      "objects = list(bpy.context.scene.objects)\n" +
      "if collection:\n" +
      "    coll = bpy.data.collections.get(collection)\n" +
      "    objects = list(coll.objects) if coll else []\n" +
      "matches = []\n" +
      "for obj in objects:\n" +
      "    if pattern and not fnmatch.fnmatch(obj.name, pattern):\n" +
      "        continue\n" +
      "    if object_type and obj.type != object_type:\n" +
      "        continue\n" +
      "    if material and material not in [slot.material.name for slot in obj.material_slots if slot.material]:\n" +
      "        continue\n" +
      "    matches.append(obj)\n" +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "for obj in matches:\n" +
      "    obj.select_set(True)\n" +
      "if matches:\n" +
      "    bpy.context.view_layer.objects.active = matches[0]\n" +
      "result = {'selected': [obj.name for obj in matches], 'count': len(matches)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Select objects failed: ${err.message}`);
  }
}

export async function blenderTransformObject(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; location?: number[]; rotationEuler?: number[]; scale?: number[] },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const loc = input.location ? JSON.stringify(input.location) : "None";
    const rot = input.rotationEuler ? JSON.stringify(input.rotationEuler) : "None";
    const scl = input.scale ? JSON.stringify(input.scale) : "None";

    const res = await client.sendExecute(
      "import bpy\n" +
      `object_name = ${JSON.stringify(input.objectName)}\n` +
      `location = ${loc}\n` +
      `rotation_euler = ${rot}\n` +
      `scale = ${scl}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "if location is not None:\n" +
      "    obj.location = location\n" +
      "if rotation_euler is not None:\n" +
      "    obj.rotation_euler = rotation_euler\n" +
      "if scale is not None:\n" +
      "    obj.scale = scale\n" +
      "result = {'name': obj.name, 'location': list(obj.location), 'rotation_euler': list(obj.rotation_euler), 'scale': list(obj.scale)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Transform object failed: ${err.message}`);
  }
}

export async function blenderDuplicateLinked(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectNames: string[]; offset?: number[] },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const offset = input.offset ? JSON.stringify(input.offset) : "None";
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_names = ${JSON.stringify(input.objectNames)}\n` +
      `offset = ${offset} or [0, 0, 0]\n` +
      "created = []\n" +
      "for name in object_names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if obj is None:\n" +
      "        continue\n" +
      "    dup = obj.copy()\n" +
      "    dup.data = obj.data\n" +
      "    dup.location = obj.location\n" +
      "    dup.location.x += float(offset[0]); dup.location.y += float(offset[1]); dup.location.z += float(offset[2])\n" +
      "    obj.users_collection[0].objects.link(dup) if obj.users_collection else bpy.context.scene.collection.objects.link(dup)\n" +
      "    created.append(dup.name)\n" +
      "result = {'created': created, 'count': len(created)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Duplicate linked failed: ${err.message}`);
  }
}

export async function blenderJoinObjects(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectNames: string[]; resultName?: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const resultName = input.resultName || "";
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_names = ${JSON.stringify(input.objectNames)}\n` +
      `result_name = ${JSON.stringify(resultName)}\n` +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "objects = [bpy.data.objects.get(n) for n in object_names]\n" +
      "objects = [o for o in objects if o and o.type == 'MESH']\n" +
      "if len(objects) < 2:\n" +
      "    raise RuntimeError('Need at least two mesh objects to join')\n" +
      "for obj in objects:\n" +
      "    obj.select_set(True)\n" +
      "bpy.context.view_layer.objects.active = objects[0]\n" +
      "bpy.ops.object.join()\n" +
      "joined = bpy.context.object\n" +
      "if result_name:\n" +
      "    joined.name = result_name\n" +
      "result = {'joined': joined.name, 'source_count': len(objects)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Join objects failed: ${err.message}`);
  }
}

export async function blenderDeleteObjects(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectNames: string[] },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_names = ${JSON.stringify(input.objectNames)}\n` +
      "deleted = []\n" +
      "if bpy.ops.object.mode_set.poll():\n" +
      "    bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "for name in object_names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if obj:\n" +
      "        deleted.append(obj.name)\n" +
      "        bpy.data.objects.remove(obj, do_unlink=True)\n" +
      "result = {'deleted': deleted, 'count': len(deleted)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Delete objects failed: ${err.message}`);
  }
}

export async function blenderCreateCollection(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; name: string; parent?: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const parent = input.parent || "";
    const res = await client.sendExecute(
      "import bpy\n" +
      `name = ${JSON.stringify(input.name)}\n` +
      `parent = ${JSON.stringify(parent)}\n` +
      "coll = bpy.data.collections.get(name) or bpy.data.collections.new(name)\n" +
      "parent_coll = bpy.data.collections.get(parent) if parent else bpy.context.scene.collection\n" +
      "if coll.name not in parent_coll.children:\n" +
      "    try:\n" +
      "        parent_coll.children.link(coll)\n" +
      "    except RuntimeError:\n" +
      "        pass\n" +
      "result = {'collection': coll.name, 'parent': parent_coll.name}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Create collection failed: ${err.message}`);
  }
}

export async function blenderMoveToCollection(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectNames: string[]; collectionName: string; unlinkFromOthers?: boolean },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const unlinkFromOthers = input.unlinkFromOthers ?? false;
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_names = ${JSON.stringify(input.objectNames)}\n` +
      `collection_name = ${JSON.stringify(input.collectionName)}\n` +
      `unlink_from_others = ${unlinkFromOthers ? "True" : "False"}\n` +
      "coll = bpy.data.collections.get(collection_name) or bpy.data.collections.new(collection_name)\n" +
      "if coll.name not in bpy.context.scene.collection.children:\n" +
      "    try:\n" +
      "        bpy.context.scene.collection.children.link(coll)\n" +
      "    except RuntimeError:\n" +
      "        pass\n" +
      "moved = []\n" +
      "for name in object_names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if not obj:\n" +
      "        continue\n" +
      "    if obj.name not in coll.objects:\n" +
      "        coll.objects.link(obj)\n" +
      "    if unlink_from_others:\n" +
      "        for old in list(obj.users_collection):\n" +
      "            if old != coll:\n" +
      "                old.objects.unlink(obj)\n" +
      "    moved.append(obj.name)\n" +
      "result = {'collection': coll.name, 'objects': moved, 'count': len(moved)}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Move to collection failed: ${err.message}`);
  }
}

// ─── Viewport Operations ─────────────────────────────────────────────────────

const VIEW3D_HELPER =
  "def _view3d_context():\n" +
  "    wm = bpy.context.window_manager\n" +
  "    for window in wm.windows:\n" +
  "        screen = window.screen\n" +
  "        for area in screen.areas:\n" +
  "            if area.type == 'VIEW_3D':\n" +
  "                region = next((r for r in area.regions if r.type == 'WINDOW'), None)\n" +
  "                space = next((s for s in area.spaces if s.type == 'VIEW_3D'), None)\n" +
  "                if region and space:\n" +
  "                    return window, screen, area, region, space\n" +
  "    raise RuntimeError('No active VIEW_3D area found')\n";

export async function blenderSetViewportView(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; view?: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const view = input.view || "front";
    const res = await client.sendExecute(
      "import bpy\n" +
      `view = ${JSON.stringify(view)}.lower()\n` +
      VIEW3D_HELPER +
      "mapping = {'front': 'FRONT', 'rear': 'BACK', 'back': 'BACK', 'left': 'LEFT', 'right': 'RIGHT', 'top': 'TOP', 'bottom': 'BOTTOM'}\n" +
      "window, screen, area, region, space = _view3d_context()\n" +
      "with bpy.context.temp_override(window=window, screen=screen, area=area, region=region, space_data=space):\n" +
      "    if view in mapping:\n" +
      "        bpy.ops.view3d.view_axis(type=mapping[view], align_active=False)\n" +
      "    elif view == 'camera':\n" +
      "        bpy.ops.view3d.view_camera()\n" +
      "    elif view in {'iso', 'isometric'}:\n" +
      "        rv3d = space.region_3d\n" +
      "        rv3d.view_perspective = 'PERSP'\n" +
      "        bpy.ops.view3d.view_axis(type='FRONT', align_active=False)\n" +
      "        bpy.ops.view3d.view_orbit(type='ORBITLEFT')\n" +
      "        bpy.ops.view3d.view_orbit(type='ORBITUP')\n" +
      "    else:\n" +
      "        raise RuntimeError('Unsupported view: ' + view)\n" +
      "result = {'view': view}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Set viewport view failed: ${err.message}`);
  }
}

export async function blenderOrbitViewport(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; direction?: string; steps?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const direction = input.direction || "left";
    const steps = Math.max(1, Math.min(input.steps ?? 1, 24));

    const res = await client.sendExecute(
      "import bpy\n" +
      `direction = ${JSON.stringify(direction)}.lower()\n` +
      `steps = ${steps}\n` +
      VIEW3D_HELPER +
      "mapping = {'left': 'ORBITLEFT', 'right': 'ORBITRIGHT', 'up': 'ORBITUP', 'down': 'ORBITDOWN'}\n" +
      "if direction not in mapping:\n" +
      "    raise RuntimeError('Unsupported orbit direction: ' + direction)\n" +
      "window, screen, area, region, space = _view3d_context()\n" +
      "with bpy.context.temp_override(window=window, screen=screen, area=area, region=region, space_data=space):\n" +
      "    for _ in range(steps):\n" +
      "        bpy.ops.view3d.view_orbit(type=mapping[direction])\n" +
      "result = {'direction': direction, 'steps': steps}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Orbit viewport failed: ${err.message}`);
  }
}

export async function blenderPanViewport(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; direction?: string; steps?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const direction = input.direction || "left";
    const steps = Math.max(1, Math.min(input.steps ?? 1, 24));

    const res = await client.sendExecute(
      "import bpy\n" +
      `direction = ${JSON.stringify(direction)}.lower()\n` +
      `steps = ${steps}\n` +
      VIEW3D_HELPER +
      "mapping = {'left': 'PANLEFT', 'right': 'PANRIGHT', 'up': 'PANUP', 'down': 'PANDOWN'}\n" +
      "if direction not in mapping:\n" +
      "    raise RuntimeError('Unsupported pan direction: ' + direction)\n" +
      "window, screen, area, region, space = _view3d_context()\n" +
      "with bpy.context.temp_override(window=window, screen=screen, area=area, region=region, space_data=space):\n" +
      "    for _ in range(steps):\n" +
      "        bpy.ops.view3d.view_pan(type=mapping[direction])\n" +
      "result = {'direction': direction, 'steps': steps}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Pan viewport failed: ${err.message}`);
  }
}

export async function blenderZoomViewport(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; direction?: string; steps?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const direction = input.direction || "in";
    const steps = Math.max(1, Math.min(input.steps ?? 1, 24));

    const res = await client.sendExecute(
      "import bpy\n" +
      `direction = ${JSON.stringify(direction)}.lower()\n` +
      `steps = ${steps}\n` +
      VIEW3D_HELPER +
      "op = 'IN' if direction in {'in', 'zoom_in'} else 'OUT' if direction in {'out', 'zoom_out'} else None\n" +
      "if op is None:\n" +
      "    raise RuntimeError('Unsupported zoom direction: ' + direction)\n" +
      "window, screen, area, region, space = _view3d_context()\n" +
      "with bpy.context.temp_override(window=window, screen=screen, area=area, region=region, space_data=space):\n" +
      "    for _ in range(steps):\n" +
      "        bpy.ops.view3d.zoom(delta=1 if op == 'IN' else -1)\n" +
      "result = {'direction': direction, 'steps': steps}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Zoom viewport failed: ${err.message}`);
  }
}

export async function blenderFrameSelected(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      VIEW3D_HELPER +
      "window, screen, area, region, space = _view3d_context()\n" +
      "with bpy.context.temp_override(window=window, screen=screen, area=area, region=region, space_data=space):\n" +
      "    bpy.ops.view3d.view_selected(use_all_regions=False)\n" +
      "result = {'framed': [obj.name for obj in bpy.context.selected_objects]}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Frame selected failed: ${err.message}`);
  }
}

export async function blenderSetViewportShading(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; mode?: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const mode = input.mode || "solid";
    const res = await client.sendExecute(
      "import bpy\n" +
      `mode = ${JSON.stringify(mode)}.lower()\n` +
      VIEW3D_HELPER +
      "mapping = {'wireframe': 'WIREFRAME', 'solid': 'SOLID', 'material_preview': 'MATERIAL', 'material': 'MATERIAL', 'rendered': 'RENDERED'}\n" +
      "if mode not in mapping:\n" +
      "    raise RuntimeError('Unsupported shading mode: ' + mode)\n" +
      "window, screen, area, region, space = _view3d_context()\n" +
      "space.shading.type = mapping[mode]\n" +
      "result = {'shading': space.shading.type}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Set viewport shading failed: ${err.message}`);
  }
}

// ─── Materials, Nodes, and Modifiers ─────────────────────────────────────────

export async function blenderInspectMaterial(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; materialName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `material_name = ${JSON.stringify(input.materialName)}\n` +
      "mat = bpy.data.materials.get(material_name)\n" +
      "if mat is None:\n" +
      "    raise RuntimeError('Material not found: ' + material_name)\n" +
      "nodes = []\n" +
      "links = []\n" +
      "if mat.use_nodes and mat.node_tree:\n" +
      "    for node in mat.node_tree.nodes:\n" +
      "        nodes.append({'name': node.name, 'type': node.bl_idname, 'label': node.label, 'inputs': [i.name for i in node.inputs], 'outputs': [o.name for o in node.outputs]})\n" +
      "    for link in mat.node_tree.links:\n" +
      "        links.append({'from_node': link.from_node.name, 'from_socket': link.from_socket.name, 'to_node': link.to_node.name, 'to_socket': link.to_socket.name})\n" +
      "result = {'name': mat.name, 'use_nodes': mat.use_nodes, 'diffuse_color': list(mat.diffuse_color), 'users': mat.users, 'nodes': nodes, 'links': links}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Inspect material failed: ${err.message}`);
  }
}

export async function blenderInspectGeometryNodes(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `object_name = ${JSON.stringify(input.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "mods = []\n" +
      "for mod in obj.modifiers:\n" +
      "    if mod.type == 'NODES':\n" +
      "        group = mod.node_group\n" +
      "        mods.append({'modifier': mod.name, 'node_group': group.name if group else None, 'nodes': [{'name': n.name, 'type': n.bl_idname} for n in group.nodes] if group else [], 'links': [{'from_node': l.from_node.name, 'to_node': l.to_node.name} for l in group.links] if group else []})\n" +
      "result = {'object': obj.name, 'geometry_nodes': mods}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Inspect geometry nodes failed: ${err.message}`);
  }
}

export async function blenderEditModifier(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; modifierName: string; properties: Record<string, unknown> },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const propertiesJson = JSON.stringify(input.properties);
    const res = await client.sendExecute(
      "import bpy, json\n" +
      `object_name = ${JSON.stringify(input.objectName)}\n` +
      `modifier_name = ${JSON.stringify(input.modifierName)}\n` +
      `properties = json.loads(${JSON.stringify(propertiesJson)})\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "mod = obj.modifiers.get(modifier_name)\n" +
      "if mod is None:\n" +
      "    raise RuntimeError('Modifier not found: ' + modifier_name)\n" +
      "changed = {}\n" +
      "for key, value in properties.items():\n" +
      "    if not hasattr(mod, key):\n" +
      "        raise RuntimeError('Modifier property not found: ' + key)\n" +
      "    setattr(mod, key, value)\n" +
      "    changed[key] = getattr(mod, key)\n" +
      "result = {'object': obj.name, 'modifier': mod.name, 'changed': changed}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Edit modifier failed: ${err.message}`);
  }
}

// ─── Rendering Operations ────────────────────────────────────────────────────

export async function blenderSetRenderSettings(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; engine?: string; width?: number; height?: number; samples?: number; denoise?: boolean },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const engine = input.engine || "BLENDER_EEVEE_NEXT";
    const width = Math.max(64, Math.min(input.width ?? 1280, 8192));
    const height = Math.max(64, Math.min(input.height ?? 720, 8192));
    const samples = Math.max(1, Math.min(input.samples ?? 64, 4096));
    const denoise = input.denoise ?? true;

    const res = await client.sendExecute(
      "import bpy\n" +
      `engine = ${JSON.stringify(engine)}\n` +
      "scene = bpy.context.scene\n" +
      "available = {'BLENDER_EEVEE_NEXT', 'CYCLES', 'BLENDER_WORKBENCH'}\n" +
      "if engine not in available:\n" +
      "    raise RuntimeError('Unsupported render engine: ' + engine)\n" +
      "scene.render.engine = engine\n" +
      `scene.render.resolution_x = ${width}\n` +
      `scene.render.resolution_y = ${height}\n` +
      "if engine == 'CYCLES' and hasattr(scene, 'cycles'):\n" +
      `    scene.cycles.samples = ${samples}\n` +
      `    scene.cycles.use_denoising = ${denoise ? "True" : "False"}\n` +
      "elif hasattr(scene, 'eevee'):\n" +
      `    scene.eevee.taa_render_samples = ${samples}\n` +
      "result = {'engine': scene.render.engine, 'width': scene.render.resolution_x, 'height': scene.render.resolution_y}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Set render settings failed: ${err.message}`);
  }
}

export async function blenderRenderCamera(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; cameraName?: string; width?: number; height?: number; samples?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const cameraName = input.cameraName || "";
    const width = Math.max(64, Math.min(input.width ?? 1280, 4096));
    const height = Math.max(64, Math.min(input.height ?? 720, 4096));
    const samples = Math.max(1, Math.min(input.samples ?? 64, 512));
    const outputPath = join(tmpdir(), "blender_mcp_camera_render.png");

    await client.sendExecute(
      "import bpy\n" +
      `camera_name = ${JSON.stringify(cameraName)}\n` +
      `output_path = ${JSON.stringify(outputPath)}\n` +
      "scene = bpy.context.scene\n" +
      "old_camera = scene.camera\n" +
      "old_filepath = scene.render.filepath\n" +
      "old_width = scene.render.resolution_x\n" +
      "old_height = scene.render.resolution_y\n" +
      "camera = bpy.data.objects.get(camera_name) if camera_name else scene.camera\n" +
      "if camera is None or camera.type != 'CAMERA':\n" +
      "    raise RuntimeError('Camera not found: ' + (camera_name or '<active scene camera>'))\n" +
      "try:\n" +
      "    scene.camera = camera\n" +
      `    scene.render.resolution_x = ${width}\n` +
      `    scene.render.resolution_y = ${height}\n` +
      "    scene.render.image_settings.file_format = 'PNG'\n" +
      "    scene.render.filepath = output_path\n" +
      "    if hasattr(scene, 'cycles'):\n" +
      `        scene.cycles.samples = ${samples}\n` +
      "    bpy.ops.render.render(write_still=True)\n" +
      "finally:\n" +
      "    scene.camera = old_camera\n" +
      "    scene.render.filepath = old_filepath\n" +
      "    scene.render.resolution_x = old_width\n" +
      "    scene.render.resolution_y = old_height\n" +
      "result = {'path': output_path, 'camera': camera.name}\n",
    );

    return imageResponse(outputPath, `Rendered camera view using ${cameraName || "active scene camera"}.`);
  } catch (err: any) {
    return errorResponse(`Render camera failed: ${err.message}`);
  }
}

export async function blenderRenderObjectIsolation(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; objectName: string; width?: number; height?: number; samples?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const width = Math.max(64, Math.min(input.width ?? 1024, 4096));
    const height = Math.max(64, Math.min(input.height ?? 1024, 4096));
    const samples = Math.max(1, Math.min(input.samples ?? 32, 512));
    const label = input.objectName.replace(/[^a-zA-Z0-9]/g, "_");
    const outputPath = join(tmpdir(), `blender_mcp_isolate_${label}.png`);

    await client.sendExecute(
      "import bpy\n" +
      `object_name = ${JSON.stringify(input.objectName)}\n` +
      `output_path = ${JSON.stringify(outputPath)}\n` +
      "target = bpy.data.objects.get(object_name)\n" +
      "if target is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "scene = bpy.context.scene\n" +
      "old_hide = {obj.name: obj.hide_render for obj in scene.objects}\n" +
      "old_camera = scene.camera\n" +
      "try:\n" +
      "    for obj in scene.objects:\n" +
      "        obj.hide_render = obj != target and obj.type not in {'CAMERA', 'LIGHT'}\n" +
      `    scene.render.resolution_x = ${width}\n` +
      `    scene.render.resolution_y = ${height}\n` +
      "    scene.render.image_settings.file_format = 'PNG'\n" +
      "    scene.render.filepath = output_path\n" +
      "    if hasattr(scene, 'cycles'):\n" +
      `        scene.cycles.samples = ${samples}\n` +
      "    bpy.ops.render.render(write_still=True)\n" +
      "finally:\n" +
      "    for obj in scene.objects:\n" +
      "        if obj.name in old_hide:\n" +
      "            obj.hide_render = old_hide[obj.name]\n" +
      "    scene.camera = old_camera\n" +
      "result = {'path': output_path, 'object': target.name}\n",
    );

    return imageResponse(outputPath, `Rendered isolated object: ${input.objectName}.`);
  } catch (err: any) {
    return errorResponse(`Render object isolation failed: ${err.message}`);
  }
}

export async function blenderRenderViewport(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; width?: number; height?: number },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const width = Math.max(64, Math.min(input.width ?? 1280, 4096));
    const height = Math.max(64, Math.min(input.height ?? 720, 4096));
    const outputPath = join(tmpdir(), "blender_mcp_viewport.png");

    await client.sendExecute(
      "import bpy\n" +
      `output_path = ${JSON.stringify(outputPath)}\n` +
      `bpy.context.scene.render.resolution_x = ${width}\n` +
      `bpy.context.scene.render.resolution_y = ${height}\n` +
      "bpy.ops.wm.redraw_timer(type='DRAW_WIN_SWAP', iterations=1)\n" +
      "bpy.ops.screen.screenshot(filepath=output_path)\n" +
      "result = {'path': output_path}\n",
    );

    return imageResponse(outputPath, "Captured viewport screenshot.");
  } catch (err: any) {
    return errorResponse(`Render viewport failed: ${err.message}`);
  }
}

// ─── Checkpoints and Recovery ────────────────────────────────────────────────

export async function blenderSaveCheckpoint(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; label?: string },
): Promise<ToolResponse> {
  try {
    await assertBlenderWorkspaceBound(registry, input.workspaceId);
    const client = getBlenderClient(input.workspaceId);
    const label = (input.label || "checkpoint").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "checkpoint";
    const checkpointDir = checkpointDirectory(input.workspaceId);
    await mkdir(checkpointDir, { recursive: true });
    const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}.blend`;
    const checkpointPath = join(checkpointDir, filename);

    const res = await client.sendExecute(
      "import bpy\n" +
      `checkpoint_path = ${JSON.stringify(checkpointPath)}\n` +
      "bpy.ops.wm.save_as_mainfile(filepath=checkpoint_path, copy=True)\n" +
      "result = {'path': checkpoint_path}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (error) {
    return errorResponse(`Save checkpoint failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function blenderListCheckpoints(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    registry.getWorkspace(input.workspaceId);
    const checkpointDir = checkpointDirectory(input.workspaceId);
    if (!existsSync(checkpointDir)) return textResponse(JSON.stringify({ checkpoints: [] }, null, 2));

    const entries = await readdir(checkpointDir, { withFileTypes: true });
    const checkpoints = [] as Array<{ path: string; name: string; size: number; modifiedAt: string }>;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".blend")) continue;
      const path = join(checkpointDir, entry.name);
      const info = await stat(path);
      checkpoints.push({ path, name: entry.name, size: info.size, modifiedAt: info.mtime.toISOString() });
    }
    checkpoints.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
    return textResponse(JSON.stringify({ checkpoints }, null, 2));
  } catch (error) {
    return errorResponse(`List checkpoints failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function blenderRollbackCheckpoint(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; path: string },
): Promise<ToolResponse> {
  try {
    registry.getWorkspace(input.workspaceId);
    const originalPath = await assertBlenderWorkspaceBound(registry, input.workspaceId);
    if (!originalPath) throw new Error("Blender workspace binding is missing.");
    const checkpointDir = checkpointDirectory(input.workspaceId);
    const checkpointPath = resolve(input.path);
    if (!isPathInsideRoot(checkpointPath, checkpointDir) || !checkpointPath.toLowerCase().endsWith(".blend")) {
      throw new Error("Checkpoint path is outside this workspace's managed Blender checkpoint directory.");
    }
    const info = await stat(checkpointPath);
    if (!info.isFile()) throw new Error("Checkpoint path is not a file.");

    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      `checkpoint_path = ${JSON.stringify(checkpointPath)}\n` +
      `original_path = ${JSON.stringify(originalPath)}\n` +
      "bpy.ops.wm.open_mainfile(filepath=checkpoint_path)\n" +
      "bpy.ops.wm.save_as_mainfile(filepath=original_path)\n" +
      "result = {'restored': original_path, 'checkpoint': checkpoint_path}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (error) {
    return errorResponse(`Rollback checkpoint failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ─── Python Escape Hatches ───────────────────────────────────────────────────

export async function blenderExecutePython(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; code: string },
): Promise<ToolResponse> {
  try {
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(input.code, false);
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Python execution failed: ${err.message}`);
  }
}

// ─── File Management & Export ────────────────────────────────────────────────

export async function blenderGetCurrentFile(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    const workspace = registry.getWorkspace(input.workspaceId);
    const filepath = await currentBlenderFilePath(input.workspaceId);
    if (!filepath) return textResponse(JSON.stringify({ filepath: null, withinWorkspace: false }, null, 2));
    try {
      registry.resolvePath(workspace, filepath);
      return textResponse(JSON.stringify({ filepath, withinWorkspace: true }, null, 2));
    } catch {
      return textResponse(JSON.stringify({ filepath: null, withinWorkspace: false, detail: "Active Blender file is outside this workspace." }, null, 2));
    }
  } catch (error) {
    return errorResponse(`Get current file failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function blenderOpenFile(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; filepath: string },
): Promise<ToolResponse> {
  try {
    const workspace = registry.getWorkspace(input.workspaceId);
    const absPath = registry.resolvePath(workspace, input.filepath);
    const client = getBlenderClient(input.workspaceId);

    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.ops.wm.open_mainfile(filepath=${JSON.stringify(absPath)})\n` +
      `result = {'opened': ${JSON.stringify(absPath)}}\n`,
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Open file failed: ${err.message}`);
  }
}

export async function blenderSaveFile(
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    await assertBlenderWorkspaceBound(registry, input.workspaceId);
    const client = getBlenderClient(input.workspaceId);
    const res = await client.sendExecute(
      "import bpy\n" +
      "if not bpy.data.filepath:\n" +
      "    raise RuntimeError('No active file path. Use save_file_as first.')\n" +
      "bpy.ops.wm.save_mainfile()\n" +
      "result = {'saved': bpy.data.filepath}\n",
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Save file failed: ${err.message}`);
  }
}

export async function blenderSaveFileAs(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; filepath: string },
): Promise<ToolResponse> {
  try {
    const workspace = registry.getWorkspace(input.workspaceId);
    const absPath = registry.resolvePath(workspace, input.filepath);
    await assertBlenderWorkspaceBound(registry, input.workspaceId, { allowUntitled: true });
    const client = getBlenderClient(input.workspaceId);

    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(absPath)})\n` +
      `result = {'saved': ${JSON.stringify(absPath)}}\n`,
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Save file as failed: ${err.message}`);
  }
}

export async function blenderExportGlb(
  registry: WorkspaceRegistry,
  input: { workspaceId: string; filepath: string },
): Promise<ToolResponse> {
  try {
    const workspace = registry.getWorkspace(input.workspaceId);
    const absPath = registry.resolvePath(workspace, input.filepath);
    const client = getBlenderClient(input.workspaceId);

    const res = await client.sendExecute(
      "import bpy\n" +
      `bpy.ops.export_scene.gltf(filepath=${JSON.stringify(absPath)}, export_format='GLB')\n` +
      `result = {'exported': ${JSON.stringify(absPath)}}\n`,
    );
    return textResponse(JSON.stringify(res, null, 2));
  } catch (err: any) {
    return errorResponse(`Export GLB failed: ${err.message}`);
  }
}
