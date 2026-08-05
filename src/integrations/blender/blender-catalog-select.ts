import type { CatalogTool } from "./blender-catalog.js";

const objectModePrelude =
  "import bpy\n" +
  "if bpy.ops.object.mode_set.poll():\n" +
  "    bpy.ops.object.mode_set(mode='OBJECT')\n";

export const selectCatalogTools: CatalogTool[] = [
  {
    name: "blender_select_by_name",
    title: "Select by Name",
    description: "Select one object by exact name.",
    readOnly: false,
    params: [{ name: "objectName", type: "string" }],
    build: (p) =>
      objectModePrelude +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "obj.select_set(True)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "result = {'selected': obj.name}\n",
  },
  {
    name: "blender_select_by_wildcard",
    title: "Select by Wildcard",
    description: "Select objects whose name matches a wildcard pattern.",
    readOnly: false,
    params: [
      { name: "pattern", type: "string", description: "fnmatch-style wildcard, e.g. Cube.*" },
      { name: "deselectOthers", type: "boolean", optional: true, default: true },
    ],
    build: (p) =>
      objectModePrelude +
      `pattern = ${JSON.stringify(p.pattern)}\n` +
      `deselect_others = ${p.deselectOthers === false ? "False" : "True"}\n` +
      "import fnmatch\n" +
      "if deselect_others:\n" +
      "    bpy.ops.object.select_all(action='DESELECT')\n" +
      "matched = []\n" +
      "for obj in bpy.data.objects:\n" +
      "    if fnmatch.fnmatch(obj.name, pattern):\n" +
      "        obj.select_set(True)\n" +
      "        matched.append(obj.name)\n" +
      "if matched:\n" +
      "    bpy.context.view_layer.objects.active = bpy.data.objects[matched[0]]\n" +
      "result = {'selected': matched, 'count': len(matched)}\n",
  },
  {
    name: "blender_select_by_modifier",
    title: "Select by Modifier",
    description: "Select all objects that have a modifier of a given type.",
    readOnly: false,
    params: [
      { name: "modifierType", type: "string", description: "Blender modifier type, e.g. SUBSURF" },
      { name: "modifierName", type: "string", optional: true },
      { name: "deselectOthers", type: "boolean", optional: true, default: true },
    ],
    build: (p) =>
      objectModePrelude +
      `modifier_type = ${JSON.stringify((p.modifierType ?? "").upper())}\n` +
      `modifier_name = ${JSON.stringify(p.modifierName ?? "")}\n` +
      `deselect_others = ${p.deselectOthers === false ? "False" : "True"}\n` +
      "if deselect_others:\n" +
      "    bpy.ops.object.select_all(action='DESELECT')\n" +
      "matched = []\n" +
      "for obj in bpy.data.objects:\n" +
      "    for mod in obj.modifiers:\n" +
      "        if mod.type == modifier_type and (not modifier_name or mod.name == modifier_name):\n" +
      "            obj.select_set(True)\n" +
      "            matched.append(obj.name)\n" +
      "            break\n" +
      "result = {'selected': matched, 'count': len(matched)}\n",
  },
  {
    name: "blender_select_by_property",
    title: "Select by Property",
    description: "Select objects where a custom property matches a value.",
    readOnly: false,
    params: [
      { name: "propertyName", type: "string" },
      { name: "propertyValue", type: "string", optional: true },
      { name: "deselectOthers", type: "boolean", optional: true, default: true },
    ],
    build: (p) =>
      objectModePrelude +
      `property_name = ${JSON.stringify(p.propertyName)}\n` +
      `property_value = ${JSON.stringify(p.propertyValue ?? "")}\n` +
      `deselect_others = ${p.deselectOthers === false ? "False" : "True"}\n` +
      "if deselect_others:\n" +
      "    bpy.ops.object.select_all(action='DESELECT')\n" +
      "matched = []\n" +
      "for obj in bpy.data.objects:\n" +
      "    if property_name in obj:\n" +
      "        val = obj[property_name]\n" +
      "        if not property_value or str(val) == property_value:\n" +
      "            obj.select_set(True)\n" +
      "            matched.append(obj.name)\n" +
      "result = {'selected': matched, 'count': len(matched)}\n",
  },
  {
    name: "blender_select_by_distance",
    title: "Select by Distance",
    description: "Select objects within a distance of a reference object or point.",
    readOnly: false,
    params: [
      { name: "distance", type: "number", description: "Selection radius in world units." },
      { name: "referenceObject", type: "string", optional: true },
      { name: "location", type: "numberArray", optional: true },
      { name: "deselectOthers", type: "boolean", optional: true, default: true },
    ],
    build: (p) =>
      objectModePrelude +
      "import math\n" +
      `distance = ${JSON.stringify(p.distance ?? 1)}\n` +
      `reference_object = ${JSON.stringify(p.referenceObject ?? "")}\n` +
      `location = ${JSON.stringify(p.location ?? null)}\n` +
      `deselect_others = ${p.deselectOthers === false ? "False" : "True"}\n` +
      "if reference_object:\n" +
      "    ref = bpy.data.objects.get(reference_object)\n" +
      "    if ref is None:\n" +
      "        raise RuntimeError('Reference object not found')\n" +
      "    center = ref.location\n" +
      "elif location:\n" +
      "    center = location\n" +
      "else:\n" +
      "    center = bpy.context.scene.cursor.location\n" +
      "if deselect_others:\n" +
      "    bpy.ops.object.select_all(action='DESELECT')\n" +
      "matched = []\n" +
      "for obj in bpy.data.objects:\n" +
      "    if (obj.location - center).length <= distance:\n" +
      "        obj.select_set(True)\n" +
      "        matched.append(obj.name)\n" +
      "result = {'selected': matched, 'count': len(matched)}\n",
  },
  {
    name: "blender_select_by_bounds",
    title: "Select by Bounds",
    description: "Select mesh objects whose world-space bounding box falls inside given min/max bounds.",
    readOnly: false,
    params: [
      { name: "min", type: "numberArray", description: "Minimum corner [x, y, z]." },
      { name: "max", type: "numberArray", description: "Maximum corner [x, y, z]." },
      { name: "deselectOthers", type: "boolean", optional: true, default: true },
    ],
    build: (p) =>
      objectModePrelude +
      "from mathutils import Vector\n" +
      `min_corner = Vector(${JSON.stringify(p.min ?? [0, 0, 0])})\n` +
      `max_corner = Vector(${JSON.stringify(p.max ?? [1, 1, 1])})\n` +
      `deselect_others = ${p.deselectOthers === false ? "False" : "True"}\n` +
      "if deselect_others:\n" +
      "    bpy.ops.object.select_all(action='DESELECT')\n" +
      "matched = []\n" +
      "for obj in bpy.data.objects:\n" +
      "    if not hasattr(obj, 'bound_box'):\n" +
      "        continue\n" +
      "    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]\n" +
      "    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))\n" +
      "    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))\n" +
      "    if all(lo[i] >= min_corner[i] and hi[i] <= max_corner[i] for i in range(3)):\n" +
      "        obj.select_set(True)\n" +
      "        matched.append(obj.name)\n" +
      "result = {'selected': matched, 'count': len(matched)}\n",
  },
  {
    name: "blender_select_by_screen_region",
    title: "Select by Screen Region",
    description: "Select objects that project inside a normalized viewport screen region.",
    readOnly: false,
    params: [
      { name: "region", type: "string", enumValues: ["left", "right", "top", "bottom", "center"] },
      { name: "deselectOthers", type: "boolean", optional: true, default: true },
    ],
    build: (p) =>
      objectModePrelude +
      "from mathutils import Vector\n" +
      `region = ${JSON.stringify(p.region ?? "center")}\n` +
      `deselect_others = ${p.deselectOthers === false ? "False" : "True"}\n` +
      "def _screen_region(obj):\n" +
      "    for area in (bpy.context.screen.areas if bpy.context.screen else []):\n" +
      "        if area.type != 'VIEW_3D':\n" +
      "            continue\n" +
      "        for space in area.spaces:\n" +
      "            if space.type != 'VIEW_3D' or not space.region_3d:\n" +
      "                continue\n" +
      "            rv3d = space.region_3d\n" +
      "            viewport = rv3d.view_rotation\n" +
      "            if obj.type == 'CAMERA':\n" +
      "                center = obj.location\n" +
      "            else:\n" +
      "                corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]\n" +
      "                center = sum(corners, Vector((0, 0, 0))) / len(corners)\n" +
      "            delta = center - rv3d.view_location\n" +
      "            forward = viewport @ Vector((0, 0, -1))\n" +
      "            if forward.dot(delta) <= 0:\n" +
      "                return 'back'\n" +
      "            right = viewport @ Vector((1, 0, 0))\n" +
      "            up = viewport @ Vector((0, 1, 0))\n" +
      "            x = right.dot(delta)\n" +
      "            y = up.dot(delta)\n" +
      "            if abs(x) > abs(y):\n" +
      "                return 'left' if x < 0 else 'right'\n" +
      "            return 'bottom' if y < 0 else 'top'\n" +
      "    return 'unknown'\n" +
      "if deselect_others:\n" +
      "    bpy.ops.object.select_all(action='DESELECT')\n" +
      "matched = []\n" +
      "for obj in bpy.data.objects:\n" +
      "    if _screen_region(obj) == region:\n" +
      "        obj.select_set(True)\n" +
      "        matched.append(obj.name)\n" +
      "result = {'selected': matched, 'count': len(matched), 'region': region}\n",
  },
  {
    name: "blender_select_hierarchy",
    title: "Select Hierarchy",
    description: "Select an object and all of its descendants.",
    readOnly: false,
    params: [
      { name: "objectName", type: "string" },
      { name: "deselectOthers", type: "boolean", optional: true, default: true },
    ],
    build: (p) =>
      objectModePrelude +
      `root_name = ${JSON.stringify(p.objectName)}\n` +
      `deselect_others = ${p.deselectOthers === false ? "False" : "True"}\n` +
      "root = bpy.data.objects.get(root_name)\n" +
      "if root is None:\n" +
      "    raise RuntimeError('Object not found: ' + root_name)\n" +
      "if deselect_others:\n" +
      "    bpy.ops.object.select_all(action='DESELECT')\n" +
      "selected = []\n" +
      "def _walk(obj):\n" +
      "    obj.select_set(True)\n" +
      "    selected.append(obj.name)\n" +
      "    for child in obj.children:\n" +
      "        _walk(child)\n" +
      "_walk(root)\n" +
      "bpy.context.view_layer.objects.active = root\n" +
      "result = {'selected': selected, 'count': len(selected)}\n",
  },
  {
    name: "blender_select_visible",
    title: "Select Visible",
    description: "Select only objects visible in the viewport.",
    readOnly: false,
    params: [
      { name: "deselectOthers", type: "boolean", optional: true, default: true },
      { name: "onlyRenderable", type: "boolean", optional: true, default: false },
    ],
    build: (p) =>
      objectModePrelude +
      `only_renderable = ${p.onlyRenderable === true ? "True" : "False"}\n` +
      `deselect_others = ${p.deselectOthers === false ? "False" : "True"}\n` +
      "if deselect_others:\n" +
      "    bpy.ops.object.select_all(action='DESELECT')\n" +
      "matched = []\n" +
      "for obj in bpy.context.scene.objects:\n" +
      "    if not obj.visible_get():\n" +
      "        continue\n" +
      "    if only_renderable and obj.hide_render:\n" +
      "        continue\n" +
      "    obj.select_set(True)\n" +
      "    matched.append(obj.name)\n" +
      "result = {'selected': matched, 'count': len(matched)}\n",
  },
  {
    name: "blender_select_vertices",
    title: "Select Vertices",
    description: "In edit mode, select vertices matching a condition (all by default).",
    readOnly: false,
    params: [
      { name: "objectName", type: "string" },
      { name: "condition", type: "string", optional: true, enumValues: ["all", "none", "front"] },
    ],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Mesh object not found: ' + object_name)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "obj.select_set(True)\n" +
      "if bpy.context.object.mode != 'EDIT':\n" +
      "    bpy.ops.object.mode_set(mode='EDIT')\n" +
      "bpy.ops.mesh.select_mode(type='VERT')\n" +
      "bpy.ops.mesh.select_all(action='SELECT')\n" +
      "result = {'mode': 'VERT', 'selected_all': True}\n",
  },
  {
    name: "blender_select_edges",
    title: "Select Edges",
    description: "In edit mode, select all edges.",
    readOnly: false,
    params: [{ name: "objectName", type: "string" }],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Mesh object not found: ' + object_name)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "obj.select_set(True)\n" +
      "if bpy.context.object.mode != 'EDIT':\n" +
      "    bpy.ops.object.mode_set(mode='EDIT')\n" +
      "bpy.ops.mesh.select_mode(type='EDGE')\n" +
      "bpy.ops.mesh.select_all(action='SELECT')\n" +
      "result = {'mode': 'EDGE', 'selected_all': True}\n",
  },
  {
    name: "blender_select_faces",
    title: "Select Faces",
    description: "In edit mode, select all faces.",
    readOnly: false,
    params: [{ name: "objectName", type: "string" }],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Mesh object not found: ' + object_name)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "obj.select_set(True)\n" +
      "if bpy.context.object.mode != 'EDIT':\n" +
      "    bpy.ops.object.mode_set(mode='EDIT')\n" +
      "bpy.ops.mesh.select_mode(type='FACE')\n" +
      "bpy.ops.mesh.select_all(action='SELECT')\n" +
      "result = {'mode': 'FACE', 'selected_all': True}\n",
  },
  {
    name: "blender_select_edge_loops",
    title: "Select Edge Loops",
    description: "In edit mode, select edge loops connected to the current selection.",
    readOnly: false,
    params: [{ name: "objectName", type: "string" }],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Mesh object not found: ' + object_name)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "obj.select_set(True)\n" +
      "if bpy.context.object.mode != 'EDIT':\n" +
      "    bpy.ops.object.mode_set(mode='EDIT')\n" +
      "bpy.ops.mesh.loop_multi_select(ring=False)\n" +
      "result = {'selected_loops': True}\n",
  },
  {
    name: "blender_select_edge_rings",
    title: "Select Edge Rings",
    description: "In edit mode, select edge rings connected to the current selection.",
    readOnly: false,
    params: [{ name: "objectName", type: "string" }],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Mesh object not found: ' + object_name)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "obj.select_set(True)\n" +
      "if bpy.context.object.mode != 'EDIT':\n" +
      "    bpy.ops.object.mode_set(mode='EDIT')\n" +
      "bpy.ops.mesh.loop_multi_select(ring=True)\n" +
      "result = {'selected_rings': True}\n",
  },
  {
    name: "blender_select_boundary",
    title: "Select Boundary",
    description: "In edit mode, select boundary edges of the current selection.",
    readOnly: false,
    params: [{ name: "objectName", type: "string" }],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Mesh object not found: ' + object_name)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "obj.select_set(True)\n" +
      "if bpy.context.object.mode != 'EDIT':\n" +
      "    bpy.ops.object.mode_set(mode='EDIT')\n" +
      "bpy.ops.mesh.select_mode(type='EDGE')\n" +
      "bpy.ops.mesh.region_to_loop()\n" +
      "result = {'selected_boundary': True}\n",
  },
  {
    name: "blender_select_sharp_edges",
    title: "Select Sharp Edges",
    description: "In edit mode, select edges with a sharp angle above the given threshold.",
    readOnly: false,
    params: [
      { name: "objectName", type: "string" },
      { name: "angle", type: "number", optional: true, default: 30 },
    ],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      `angle = ${JSON.stringify(p.angle ?? 30)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Mesh object not found: ' + object_name)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "obj.select_set(True)\n" +
      "if bpy.context.object.mode != 'EDIT':\n" +
      "    bpy.ops.object.mode_set(mode='EDIT')\n" +
      "bpy.ops.mesh.select_mode(type='EDGE')\n" +
      "bpy.ops.mesh.edges_select_sharp(sharpness=angle)\n" +
      "result = {'selected_sharp_edges': True, 'angle': angle}\n",
  },
  {
    name: "blender_select_non_manifold",
    title: "Select Non-Manifold",
    description: "In edit mode, select non-manifold geometry.",
    readOnly: false,
    params: [{ name: "objectName", type: "string" }],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Mesh object not found: ' + object_name)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "obj.select_set(True)\n" +
      "if bpy.context.object.mode != 'EDIT':\n" +
      "    bpy.ops.object.mode_set(mode='EDIT')\n" +
      "bpy.ops.mesh.select_non_manifold()\n" +
      "import bmesh\n" +
      "bm = bmesh.from_edit_mesh(obj.data)\n" +
      "count = sum(1 for v in bm.verts if v.select)\n" +
      "result = {'selected_non_manifold': True, 'count': count}\n",
  },
  {
    name: "blender_select_loose_geometry",
    title: "Select Loose Geometry",
    description: "In edit mode, select loose vertices and edges not part of any face.",
    readOnly: false,
    params: [{ name: "objectName", type: "string" }],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Mesh object not found: ' + object_name)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "obj.select_set(True)\n" +
      "if bpy.context.object.mode != 'EDIT':\n" +
      "    bpy.ops.object.mode_set(mode='EDIT')\n" +
      "bpy.ops.mesh.select_loose_verts()\n" +
      "bpy.ops.mesh.select_loose_edges()\n" +
      "import bmesh\n" +
      "bm = bmesh.from_edit_mesh(obj.data)\n" +
      "count = sum(1 for v in bm.verts if v.select)\n" +
      "result = {'selected_loose_geometry': True, 'count': count}\n",
  },
  {
    name: "blender_select_similar",
    title: "Select Similar",
    description: "In edit mode, select geometry similar to the current selection.",
    readOnly: false,
    params: [
      { name: "objectName", type: "string" },
      { name: "similarityType", type: "string", optional: true, default: "AREA", enumValues: ["AREA", "PERIMETER", "NORMAL", "COPLANAR", "FACE_MAP", "MATERIAL", "VERTEX_GROUPS", "LENGTH", "DIRECTION", "FACE_SETS"] },
      { name: "threshold", type: "number", optional: true, default: 0.1 },
    ],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      `similarity_type = ${JSON.stringify((p.similarityType ?? "AREA").upper())}\n` +
      `threshold = ${JSON.stringify(p.threshold ?? 0.1)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Mesh object not found: ' + object_name)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "obj.select_set(True)\n" +
      "if bpy.context.object.mode != 'EDIT':\n" +
      "    bpy.ops.object.mode_set(mode='EDIT')\n" +
      "bpy.ops.mesh.select_similar(type=similarity_type, threshold=threshold)\n" +
      "result = {'selected_similar': True, 'type': similarity_type}\n",
  },
  {
    name: "blender_select_by_normal",
    title: "Select by Normal",
    description: "In edit mode, select faces whose normals point within a direction cone.",
    readOnly: false,
    params: [
      { name: "objectName", type: "string" },
      { name: "direction", type: "numberArray", optional: true, default: [0, 0, 1] },
      { name: "angle", type: "number", optional: true, default: 45 },
    ],
    build: (p) =>
      "import bpy, bmesh\n" +
      "from mathutils import Vector\n" +
      "import math\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      `direction = Vector(${JSON.stringify(p.direction ?? [0, 0, 1])})\n` +
      `angle_deg = ${JSON.stringify(p.angle ?? 45)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Mesh object not found: ' + object_name)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "obj.select_set(True)\n" +
      "if bpy.context.object.mode != 'EDIT':\n" +
      "    bpy.ops.object.mode_set(mode='EDIT')\n" +
      "direction = direction.normalized()\n" +
      "threshold = math.cos(math.radians(angle_deg))\n" +
      "bm = bmesh.from_edit_mesh(obj.data)\n" +
      "for f in bm.faces:\n" +
      "    world_normal = obj.matrix_world.to_3x3() @ f.normal\n" +
      "    world_normal.normalize()\n" +
      "    f.select = world_normal.dot(direction) >= threshold\n" +
      "bmesh.update_edit_mesh(obj.data)\n" +
      "count = sum(1 for f in bm.faces if f.select)\n" +
      "result = {'selected_by_normal': True, 'count': count}\n",
  },
  {
    name: "blender_select_by_material_slot",
    title: "Select by Material Slot",
    description: "In edit mode, select faces assigned to a material slot index.",
    readOnly: false,
    params: [
      { name: "objectName", type: "string" },
      { name: "slotIndex", type: "number", default: 0 },
    ],
    build: (p) =>
      "import bpy, bmesh\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      `slot_index = ${JSON.stringify(p.slotIndex ?? 0)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Mesh object not found: ' + object_name)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "obj.select_set(True)\n" +
      "if bpy.context.object.mode != 'EDIT':\n" +
      "    bpy.ops.object.mode_set(mode='EDIT')\n" +
      "bm = bmesh.from_edit_mesh(obj.data)\n" +
      "mat_layer = bm.faces.layers.int.get('material_index')\n" +
      "count = 0\n" +
      "for f in bm.faces:\n" +
      "    if mat_layer is not None:\n" +
      "        idx = f[mat_layer]\n" +
      "    else:\n" +
      "        idx = f.material_index if hasattr(f, 'material_index') else 0\n" +
      "    f.select = idx == slot_index\n" +
      "    if f.select:\n" +
      "        count += 1\n" +
      "bmesh.update_edit_mesh(obj.data)\n" +
      "result = {'selected_by_material_slot': True, 'slot_index': slot_index, 'count': count}\n",
  },
  {
    name: "blender_select_by_face_area",
    title: "Select by Face Area",
    description: "In edit mode, select faces within a triangle/face area range.",
    readOnly: false,
    params: [
      { name: "objectName", type: "string" },
      { name: "minArea", type: "number", optional: true, default: 0 },
      { name: "maxArea", type: "number", optional: true, default: 1e9 },
    ],
    build: (p) =>
      "import bpy, bmesh\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      `min_area = ${JSON.stringify(p.minArea ?? 0)}\n` +
      `max_area = ${JSON.stringify(p.maxArea ?? 1e9)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Mesh object not found: ' + object_name)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "obj.select_set(True)\n" +
      "if bpy.context.object.mode != 'EDIT':\n" +
      "    bpy.ops.object.mode_set(mode='EDIT')\n" +
      "bm = bmesh.from_edit_mesh(obj.data)\n" +
      "count = 0\n" +
      "for f in bm.faces:\n" +
      "    f.select = min_area <= f.calc_area() <= max_area\n" +
      "    if f.select:\n" +
      "        count += 1\n" +
      "bmesh.update_edit_mesh(obj.data)\n" +
      "result = {'selected_by_face_area': True, 'count': count}\n",
  },
  {
    name: "blender_select_linked_geometry",
    title: "Select Linked Geometry",
    description: "In edit mode, select all geometry connected to the current selection.",
    readOnly: false,
    params: [{ name: "objectName", type: "string" }],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Mesh object not found: ' + object_name)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "obj.select_set(True)\n" +
      "if bpy.context.object.mode != 'EDIT':\n" +
      "    bpy.ops.object.mode_set(mode='EDIT')\n" +
      "bpy.ops.mesh.select_linked(delimit=set())\n" +
      "import bmesh\n" +
      "bm = bmesh.from_edit_mesh(obj.data)\n" +
      "count = sum(1 for v in bm.verts if v.select)\n" +
      "result = {'selected_linked_geometry': True, 'count': count}\n",
  },
];
