# BLENDER_AGENT_GUIDE.md

## Scope

This guide applies to 3D modeling, asset creation, material configuration, rigging, animation, rendering, optimization, and exporting tasks using Blender.

Load this guide when `.blend` files or `bpy` python scripts are present, or when the task involves editing, optimizing, rendering, or validating 3D game/web assets.

---

## Tool Surface

The Blender integration registers the full bridge catalog: **790 tool names** (`blender_<name>`), split into three tiers:

| Tier | Count | Behavior |
|---|---|---|
| **Handwritten implementations** | ~108 | Dedicated handlers in `src/integrations/blender/blender-tools.ts` (e.g. `blender_ping`, `blender_create_cube`, `blender_render_camera`, `blender_execute_python`). |
| **Catalog implementations** | ~120 | Data-driven tools with real `bpy` Python builders (scene/state, selection, mesh edit, object ops). |
| **Bridge-style stubs** | ~577 | Registered so the MCP surface is complete; they return `{"status": "registered"}` and direct the caller to `blender_execute_python`. |

### Recognizing stubs
A stub tool:
- Has an empty param schema and a description ending in `... until this tool is promoted to a dedicated implementation.`
- Returns a dict with `tool`, `status: "registered"`, and a `note` telling you to use `blender_execute_python`.

If you call a stub and it returns `status: "registered"`, **do not claim the operation happened**. Run the actual operation via `blender_execute_python` (or a dedicated non-stub tool) and verify the result.

### Tool families (examples)
- **Scene/state:** `blender_get_scene_info`, `blender_get_scene_audit`, `blender_get_scene_hierarchy`, `blender_get_scene_statistics`, `blender_get_unsaved_changes_status`, `blender_get_recent_operator_log`, `blender_cancel_operation`, `blender_get_task_progress`
- **Selection:** `blender_select_by_wildcard`, `blender_select_by_property`, `blender_select_by_distance`, `blender_select_hierarchy`, `blender_select_visible`, `blender_select_edge_loops`, `blender_select_non_manifold`, `blender_select_similar`
- **Mesh edit:** `blender_extrude_vertices`, `blender_bevel_vertices`, `blender_knife_cut`, `blender_bisect_mesh`, `blender_merge_vertices`, `blender_bridge_edge_loops`, `blender_fill_holes`, `blender_limited_dissolve`, `blender_rip_vertices`, `blender_spin_geometry`
- **Object ops:** `blender_rename_object`, `blender_make_single_user`, `blender_make_instances`, `blender_separate_object`, `blender_set_parent_inverse`, `blender_freeze_transforms`, `blender_set_object_visibility`, `blender_set_origin_to_geometry`, `blender_align_objects`, `blender_snap_objects_to_grid`
- **Create/generators:** `blender_create_*` primitives plus `create_archway`, `create_stairs`, `create_chain_from_curve`, `create_cable_from_curve`, `create_pipe_from_curve`, `create_modular_wall_set`, `create_decal`, `create_scatter_system`
- **Materials/nodes:** `blender_create_material`, `blender_assign_material`, `blender_create_shader_node`, `blender_connect_shader_nodes`, `blender_set_shader_node_input`, `blender_group_shader_nodes`, `blender_transfer_materials`, `blender_merge_duplicate_materials`
- **UV/textures:** `blender_unwrap_uv`, `blender_smart_uv_project`, `blender_pack_uvs`, `blender_stitch_uvs`, `blender_set_texel_density`, `blender_load_texture`, `blender_pack_texture_atlas`, `blender_bake_combined`
- **Modifiers:** `blender_add_modifier`, `blender_edit_modifier`, `blender_configure_subdivision`, `blender_configure_decimate`, `blender_configure_mirror`, `blender_configure_solidify`, `blender_reorder_modifier`, `blender_copy_modifier`
- **Geometry nodes:** `blender_create_geometry_nodes_group`, `blender_assign_geometry_nodes_group`, `blender_set_geometry_nodes_input`, `blender_expose_geometry_nodes_input`, `blender_bake_geometry_nodes_simulation`, `blender_realize_instances`
- **Rendering/baking:** `blender_render_camera`, `blender_render_viewport`, `blender_render_region`, `blender_render_depth`, `blender_render_wireframe`, `blender_render_polycount_heatmap`, `blender_render_uv_checker`, `blender_render_turntable`, `blender_bake_*` family
- **LOD/collision/asset pipeline:** `blender_generate_lods`, `blender_generate_lod_chain`, `blender_create_collision_proxy`, `blender_audit_collisions`, `blender_validate_lods`, `blender_run_final_game_asset_check`, `blender_export_*` family
- **Rig/armature:** `blender_inspect_armature`, `blender_create_bone`, `blender_parent_to_bone`, `blender_configure_ik`, `blender_auto_weight`, `blender_assign_vertex_group`, `blender_transfer_weights`
- **Animation:** `blender_create_action`, `blender_assign_action`, `blender_create_nla_track`, `blender_push_action_to_nla`, `blender_copy_keyframes`, `blender_insert_keyframe`, `blender_set_timeline_range`, `blender_playblast_viewport`
- **Audit/validate:** `blender_audit_*`, `blender_find_*` (duplicates, non-manifold, missing images, internal faces, overdraw), `blender_validate_*` (naming, scale, UVs, normals, materials, budgets)
- **State/transactions:** `blender_begin_transaction`, `blender_capture_before_state`, `blender_diff_scene_states`, `blender_preview_changes`, `blender_commit_transaction`, `blender_save_named_checkpoint`, `blender_rollback_checkpoint`

For any of these, call the tool first; if it returns `status: "registered"`, fall back to `blender_execute_python` or a dedicated tool.

---

## Core Anti-Hallucination Rules
- **Never invent** a Blender object, collection, material, modifier, image, node group, bone, action, scene, camera, render, checkpoint, task ID, file path, or tool result.
- Inspect the current Blender state before making scene mutations.
- Never assume Blender is open or the MCP add-on socket is running.
- Call a Blender connection/status tool (`blender_ping`) first in an unfamiliar session.
- Do not claim a render was produced unless image output was returned successfully.
- Do not claim geometry is manifold, optimized, rigged, UV-mapped, or game-ready without inspection evidence.
- Do not assume an active object, selected object, mode, scene, view layer, collection, or camera.
- Use only exact registered Blender tool names and schemas.
- Treat live Blender state as the source of truth.
- Reinspect state after large mutations.
- Use checkpoints before risky or broad changes.
- Never execute arbitrary Blender Python when a dedicated structured tool can perform the operation.
- **Never treat a `status: "registered"` stub response as a completed operation.** Verify with real state inspection.
- Do not repeat the same failed mutation without reinspection.
- Do not use Blender tools for Godot scene nodes or web DOM elements.

---

## Workflow Loop

> Inspect → checkpoint when risky → mutate minimally → render or audit → verify.

### Asset Modeling & Optimization Loop
1. **Audit:** Run `blender_get_scene_audit` to check mesh statistics, non-manifold geometry, duplicate vertices, and texture scales.
2. **Checkpoint:** Save a scene checkpoint before performing mesh decimation, normal recalculation, or modifier application.
3. **Mutate:** Perform targeted modeling/optimization operations.
4. **Inspect:** Re-evaluate geometry stats and verify vertex/triangle reductions.
5. **Render Viewport:** Generate a camera or viewport render to visually inspect topology and material look.
6. **Export:** Export to `.glb` or `.gltf` and validate file sizes and engine compatibility.

---

## Serena (Semantic Code)

Serena is relevant only to Blender Python/add-on source.

**Use Serena for:**
- `bpy` scripts
- Addon modules
- Operator classes, panel classes
- Python symbol references

**Do not use Serena for:**
- Blender objects, meshes, materials, UVs, rigs, animations, renders
- Live scene state

Use the Blender integration (`blender_ping`, `blender_get_scene_info`, etc.) for live Blender operations. Serena handles source code navigation only.

---

## Security Restrictions
- All file paths (opening, saving, exporting) must resolve inside the approved Auvrynt workspace.
- Unrestricted Python execution (`blender_execute_python`) requires explicit user approval and is blocked from accessing system calls (`os.system`, `subprocess`), network ports, or secrets.
- Checkpoint rollbacks are restricted to the registered checkpoint directory.
- Socket communication is bound to loopback `127.0.0.1` and is never exposed publicly.

---

## Verification Criteria

| Claim | Required Evidence |
|---|---|
| **"Blender is connected"** | Successful `blender_ping` response. |
| **"Object mutated/added"** | Successful tool return + updated object list from `blender_get_scene_info`. |
| **"Model looks correct"** | Rendered image file returned and visually validated. |
| **"Mesh is manifold"** | Scene audit reports 0 non-manifold edges. |
| **"Asset is game-ready"** | Triangles count under target budget, scale applied (1, 1, 1), and GLTF export completes successfully. |
