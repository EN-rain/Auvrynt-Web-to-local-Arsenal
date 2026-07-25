# BLENDER_AGENT_GUIDE.md

## Scope

This guide applies to 3D modeling, asset creation, material configuration, rigging, animation, rendering, optimization, and exporting tasks using Blender.

Load this guide when `.blend` files or `bpy` python scripts are present, or when the task involves editing, optimizing, rendering, or validating 3D game/web assets.

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
