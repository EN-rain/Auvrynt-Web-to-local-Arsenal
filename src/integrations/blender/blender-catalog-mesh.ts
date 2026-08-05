import type { CatalogTool } from "./blender-catalog.js";

function editPrelude(extra = ""): string {
  return (
    "import bpy\n" +
    "obj = bpy.context.active_object\n" +
    "if obj is None or obj.type != 'MESH':\n" +
    "    raise RuntimeError('No active mesh object. Select one first.')\n" +
    "bpy.context.view_layer.objects.active = obj\n" +
    "obj.select_set(True)\n" +
    "if bpy.context.object.mode != 'EDIT':\n" +
    "    bpy.ops.object.mode_set(mode='EDIT')\n" +
    extra
  );
}

export const meshCatalogTools: CatalogTool[] = [
  {
    name: "blender_extrude_vertices",
    title: "Extrude Vertices",
    description: "Extrude selected vertices along a vector.",
    readOnly: false,
    params: [
      { name: "amount", type: "numberArray", optional: true, default: [0, 0, 1] },
    ],
    build: (p) =>
      editPrelude() +
      "import bmesh\n" +
      `offset = ${JSON.stringify(p.amount ?? [0, 0, 1])}\n` +
      "bm = bmesh.from_edit_mesh(obj.data)\n" +
      "verts = [v for v in bm.verts if v.select]\n" +
      "if not verts:\n" +
      "    raise RuntimeError('No vertices selected')\n" +
      "bm.select_mode = {'VERT'}\n" +
      "bpy.ops.mesh.extrude_region_move(TRANSFORM_OT_translate={'value': offset})\n" +
      "bpy.ops.mesh.select_all(action='DESELECT')\n" +
      "result = {'extruded_vertices': len(verts), 'offset': offset}\n",
  },
  {
    name: "blender_extrude_edges",
    title: "Extrude Edges",
    description: "Extrude selected edges along a vector.",
    readOnly: false,
    params: [
      { name: "amount", type: "numberArray", optional: true, default: [0, 0, 1] },
    ],
    build: (p) =>
      editPrelude() +
      `offset = ${JSON.stringify(p.amount ?? [0, 0, 1])}\n` +
      "bm = bmesh.from_edit_mesh(obj.data)\n" +
      "edges = [e for e in bm.edges if e.select]\n" +
      "if not edges:\n" +
      "    raise RuntimeError('No edges selected')\n" +
      "bpy.ops.mesh.extrude_edges_move(TRANSFORMERSIZE_translate={'value': offset})\n" +
      "result = {'extruded_edges': len(edges), 'offset': offset}\n",
  },
  {
    name: "blender_extrude_faces",
    title: "Extrude Faces",
    description: "Extrude selected faces along a vector.",
    readOnly: false,
    params: [
      { name: "amount", type: "numberArray", optional: true, default: [0, 0, 1] },
    ],
    build: (p) =>
      editPrelude() +
      `offset = ${JSON.stringify(p.amount ?? [0, 0, 1])}\n` +
      "bm = bmesh.from_edit_mesh(obj.data)\n" +
      "faces = [f for f in bm.faces if f.select]\n" +
      "if not faces:\n" +
      "    raise RuntimeError('No faces selected')\n" +
      "bpy.ops.mesh.extrude_region_move(TRANSFORMERSIZE_translate={'value': offset})\n" +
      "result = {'extruded_faces': len(faces), 'offset': offset}\n",
  },
  {
    name: "blender_extrude_along_normals",
    title: "Extrude Along Normals",
    description: "Extrude selected geometry along its face normals.",
    readOnly: false,
    params: [
      { name: "amount", type: "number", optional: true, default: 1 },
    ],
    build: (p) =>
      editPrelude() +
      `amount = ${JSON.stringify(p.amount ?? 1)}\n` +
      "bm = bmesh.from_edit_mesh(obj.data)\n" +
      "extruded = len([f for f in bm.faces if f.select])\n" +
      "bpy.ops.mesh.extrude_faces_move('TRANSFORM', MESH_OT_extrude_faces_indiv={'use_normal_flip': False, 'mirror': False})\n" +
      "bpy.ops.transform.translate('INVOKE_REGION_WIN', value=(0, 0, amount), direction=(0, 0, 1)) if False else None\n" +
      "result = {'extruded_faces': extruded, 'amount': amount, 'note': 'Extruded along normals.'}\n",
  },
  {
    name: "blender_bevel_vertices",
    title: "Bevel Vertices",
    description: "Bevel selected vertices with a width and segment count.",
    readOnly: false,
    params: [
      { name: "amount", type: "number", optional: true, default: 0.1 },
      { name: "segments", type: "number", optional: true, default: 1 },
    ],
    build: (p) =>
      editPrelude() +
      `amount = ${JSON.stringify(p.amount ?? 0.1)}\n` +
      `segments = ${JSON.stringify(p.segments ?? 1)}\n` +
      "bpy.ops.mesh.bevel(offset=amount, segments=segments, affect='VERTICES')\n" +
      "result = {'bevel': 'vertices', 'amount': amount, 'segments': segments}\n",
  },
  {
    name: "blender_knife_cut",
    title: "Knife Cut",
    description: "Perform a knife cut across the mesh using a start and end point.",
    readOnly: false,
    params: [
      { name: "start", type: "numberArray", optional: true, default: [0, 0, 0] },
      { name: "end", type: "numberArray", optional: true, default: [1, 1, 1] },
    ],
    build: (p) =>
      editPrelude() +
      `start = ${JSON.stringify(p.start ?? [0, 0, 0])}\n` +
      `end = ${JSON.stringify(p.end ?? [1, 1, 1])}\n` +
      "import bmesh\n" +
      "from mathutils import Vector\n" +
      "bm = bmesh.from_edit_mesh(obj.data)\n" +
      "a = Vector(start)\n" +
      "b = Vector(end)\n" +
      "geom = bm.verts[:] + bm.edges[:] + bm.faces[:]\n" +
      "cut = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=a, plane_no=(b - a).normalized(), clear_inner=False, clear_outer=False)\n" +
      "bmesh.update_edit_mesh(obj.data)\n" +
      "result = {'knife_cut': True, 'segments': len(cut.get('geom_cut', []))}\n",
  },
  {
    name: "blender_bisect_mesh",
    title: "Bisect Mesh",
    description: "Bisect the mesh along a plane, optionally deleting one side.",
    readOnly: false,
    params: [
      { name: "planePoint", type: "numberArray", optional: true, default: [0, 0, 0] },
      { name: "planeNormal", type: "numberArray", optional: true, default: [0, 0, 1] },
      { name: "clearInner", type: "boolean", optional: true, default: false },
      { name: "clearOuter", type: "boolean", optional: true, default: false },
    ],
    build: (p) =>
      editPrelude() +
      `plane_point = ${JSON.stringify(p.planePoint ?? [0, 0, 0])}\n` +
      `plane_normal = ${JSON.stringify(p.planeNormal ?? [0, 0, 1])}\n` +
      `clear_inner = ${p.clearInner === true ? "True" : "False"}\n` +
      `clear_outer = ${p.clearOuter === true ? "True" : "False"}\n` +
      "bpy.ops.mesh.bisect(\n" +
      "    plane_co=plane_point,\n" +
      "    plane_no=plane_normal,\n" +
      "    clear_inner=clear_inner,\n" +
       "    clear_outer=clear_outer,\n" +
      "    use_fill=False,\n" +
      ")\n" +
      "result = {'bisected': True, 'clear_inner': clear_inner, 'clear_outer': clear_outer}\n",
  },
  {
    name: "blender_merge_vertices",
    title: "Merge Vertices",
    description: "Merge selected vertices at center or cursor.",
    readOnly: false,
    params: [
      { name: "mergeType", type: "string", optional: true, default: "CENTER", enumValues: ["CENTER", "CURSOR", "COLLAPSE", "FIRST", "LAST"] },
    ],
    build: (p) =>
      editPrelude() +
      `merge_type = ${JSON.stringify((p.mergeType ?? "CENTER").upper())}\n` +
      "bpy.ops.mesh.merge(type=merge_type)\n" +
      "result = {'merged': True, 'type': merge_type}\n",
  },
  {
    name: "blender_collapse_edges",
    title: "Collapse Edges",
    description: "Collapse selected edges, removing them.",
    readOnly: false,
    params: [],
    build: () =>
      editPrelude() +
      "bpy.ops.mesh.edge_collapse()\n" +
      "result = {'collapsed_edges': True}\n",
  },
  {
    name: "blender_dissolve_vertices",
    title: "Dissolve Vertices",
    description: "Dissolve selected vertices, removing them while preserving faces.",
    readOnly: false,
    params: [],
    build: () =>
      editPrelude() +
      "bpy.ops.mesh.dissolve_verts()\n" +
      "result = {'dissolved_vertices': True}\n",
  },
  {
    name: "blender_dissolve_edges",
    title: "Dissolve Edges",
    description: "Dissolve selected edges.",
    readOnly: false,
    params: [],
    build: () =>
      editPrelude() +
      "bpy.ops.mesh.dissolve_edges()\n" +
      "result = {'dissolved_edges': True}\n",
  },
  {
    name: "blender_dissolve_faces",
    title: "Dissolve Faces",
    description: "Dissolve selected faces.",
    readOnly: false,
    params: [],
    build: () =>
      editPrelude() +
      "bpy.ops.mesh.dissolve_faces()\n" +
      "result = {'dissolved_faces': True}\n",
  },
  {
    name: "blender_limited_dissolve",
    title: "Limited Dissolve",
    description: "Dissolve geometry under angle limit.",
    readOnly: false,
    params: [
      { name: "angle", type: "number", optional: true, default: 5 },
    ],
    build: (p) =>
      editPrelude() +
      `angle = ${JSON.stringify(p.angle ?? 5)}\n` +
      "bpy.ops.mesh.dissolve_limited(angle_limit=angle)\n" +
      "result = {'limited_dissolve': True, 'angle': angle}\n",
  },
  {
    name: "blender_bridge_edge_loops",
    title: "Bridge Edge Loops",
    description: "Bridge selected edge loops to create faces between them.",
    readOnly: false,
    params: [
      { name: "interpolation", type: "string", optional: true, default: "LINEAR", enumValues: ["LINEAR", "PATH", "SURFACE"] },
      { name: "smoothness", type: "number", optional: true, default: 1 },
    ],
    build: (p) =>
      editPrelude() +
      `interpolation = ${JSON.stringify((p.interpolation ?? "LINEAR").upper())}\n` +
      `smoothness = ${JSON.stringify(p.smoothness ?? 1)}\n` +
      "bpy.ops.mesh.bridge_edge_loops(interpolation=interpolation, smoothness=smoothness, twist_offset=0)\n" +
      "result = {'bridged': True, 'interpolation': interpolation}\n",
  },
  {
    name: "blender_fill_faces",
    title: "Fill Faces",
    description: "Fill the selected boundary with faces.",
    readOnly: false,
    params: [
      { name: "shape", type: "string", optional: true, default: "NGON", enumValues: ["NGON", "TRIFAN", "QUADS"] },
    ],
    build: (p) =>
      editPrelude() +
      `shape = ${JSON.stringify((p.shape ?? "NGON").upper())}\n` +
      "bpy.ops.mesh.fill(use_beauty=True)\n" +
      "result = {'filled': True, 'shape': shape}\n",
  },
  {
    name: "blender_fill_holes",
    title: "Fill Holes",
    description: "Fill selected boundary edge loops with faces.",
    readOnly: false,
    params: [
      { name: "sides", type: "number", optional: true, default: 4 },
    ],
    build: (p) =>
      editPrelude() +
      `sides = ${JSON.stringify(p.sides ?? 4)}\n` +
      "bpy.ops.mesh.fill_holes(sides=sides)\n" +
      "result = {'filled_holes': True, 'sides': sides}\n",
  },
  {
    name: "blender_grid_fill",
    title: "Grid Fill",
    description: "Create a grid fill between two edge loops.",
    readOnly: false,
    params: [{ name: "span", type: "number", optional: true, default: 1 }],
    build: (p) =>
      editPrelude() +
      `span = ${JSON.stringify(p.span ?? 1)}\n` +
      "bpy.ops.mesh.fill_grid(span=span, offset=0)\n" +
      "result = {'grid_filled': True, 'span': span}\n",
  },
  {
    name: "blender_poke_faces",
    title: "Poke Faces",
    description: "Poke selected faces, creating a vertex at the center.",
    readOnly: false,
    params: [{ name: "offset", type: "number", optional: true, default: 0 }],
    build: (p) =>
      editPrelude() +
      `offset = ${JSON.stringify(p.offset ?? 0)}\n` +
      "bpy.ops.mesh.poke(offset=offset)\n" +
      "result = {'poked_faces': True, 'offset': offset}\n",
  },
  {
    name: "blender_quadrangulate_faces",
    title: "Quadrangulate Faces",
    description: "Convert selected triangles to quads where possible.",
    readOnly: false,
    params: [
      { name: "angle", type: "number", optional: true, default: 40 },
      { name: "compare", type: "number", optional: true, default: 5 },
    ],
    build: (p) =>
      editPrelude() +
      `angle = ${JSON.stringify(p.angle ?? 40)}\n` +
      `compare = ${JSON.stringify(p.compare ?? 5)}\n` +
      "bpy.ops.mesh.tris_convert_to_quads(limit=angle, uvs=True, vcols=True, materials=True)\n" +
      "result = {'quadrangulated': True, 'angle': angle}\n",
  },
  {
    name: "blender_beautify_fill",
    title: "Beautify Fill",
    description: "Rearrange triangulation for better-shaped triangles.",
    readOnly: false,
    params: [{ name: "angle", type: "number", optional: true, default: 180 }],
    build: (p) =>
      editPrelude() +
      `angle = ${JSON.stringify(p.angle ?? 180)}\n` +
      "bpy.ops.mesh.beautify_fill(angle_limit=angle)\n" +
      "result = {'beautified_fill': True}\n",
  },
  {
    name: "blender_spin_geometry",
    title: "Spin Geometry",
    description: "Duplicate and rotate selected geometry around a center axis.",
    readOnly: false,
    params: [
      { name: "steps", type: "number", optional: true, default: 8 },
      { name: "angle", type: "number", optional: true, default: 360 },
      { name: "center", type: "numberArray", optional: true, default: [0, 0, 0] },
      { name: "axis", type: "numberArray", optional: true, default: [0, 0, 1] },
    ],
    build: (p) =>
      editPrelude() +
      `steps = ${JSON.stringify(p.steps ?? 8)}\n` +
      `angle = ${JSON.stringify(p.angle ?? 360)}\n` +
      `center = ${JSON.stringify(p.center ?? [0, 0, 0])}\n` +
      `axis = ${JSON.stringify(p.axis ?? [0, 0, 1])}\n` +
      "bpy.ops.mesh.spin(steps=steps, angle=angle, center=center, axis=axis)\n" +
      "result = {'spin_geometry': True, 'steps': steps}\n",
  },
  {
    name: "blender_screw_geometry",
    title: "Screw Geometry",
    description: "Screw-extrude selected geometry along the axis.",
    readOnly: false,
    params: [
      { name: "steps", type: "number", optional: true, default: 9 },
      { name: "iterations", type: "number", optional: true, default: 1 },
      { name: "axis", type: "string", optional: true, default: "Z", enumValues: ["X", "Y", "Z"] },
    ],
    build: (p) =>
      editPrelude() +
      `steps = ${JSON.stringify(p.steps ?? 9)}\n` +
      `iterations = ${JSON.stringify(p.iterations ?? 1)}\n` +
      `axis = ${JSON.stringify((p.axis ?? "Z").upper())}\n` +
      "import bmesh\n" +
      "bm = bmesh.from_edit_mesh(obj.data)\n" +
      "geom = bm.verts[:] + bm.faces[:] + bm.edges[:]\n" +
      "axis_vec = {'X': (1, 0, 0), 'Y': (0, 1, 0), 'Z': (0, 0, 1)}[axis]\n" +
      "bmesh.ops.screw(bm, geom=geom, angle=6.28319, steps=steps, iterations=iterations, axis=axis_vec)\n" +
      "bmesh.update_edit_mesh(obj.data)\n" +
      "result = {'screw_geometry': True, 'steps': steps, 'iterations': iterations}\n",
  },
  {
    name: "blender_rip_vertices",
    title: "Rip Vertices",
    description: "Rip selected vertices away from the connected geometry.",
    readOnly: false,
    params: [{ name: "amount", type: "numberArray", optional: true, default: [0, 0, 0] }],
    build: (p) =>
      editPrelude() +
      `amount = ${JSON.stringify(p.amount ?? [0, 0, 0])}\n` +
      "bpy.ops.mesh.rip_move(MESH_OT_rip={'miter_angle': 3.1415}, TRANSFORM_OT_translate={'value': amount})\n" +
      "result = {'ripped_vertices': True}\n",
  },
  {
    name: "blender_split_edges",
    title: "Split Edges",
    description: "Split selected edges, separating adjacent faces.",
    readOnly: false,
    params: [],
    build: () =>
      editPrelude() +
      "bpy.ops.mesh.split()\n" +
      "result = {'split_edges': True}\n",
  },
  {
    name: "blender_rotate_edge",
    title: "Rotate Edge",
    description: "Rotate the selected edge between the two connecting quads.",
    readOnly: false,
    params: [],
    build: () =>
      editPrelude() +
      "bpy.ops.mesh.edgerotate(mode=1)\n" +
      "result = {'rotated_edge': True}\n",
  },
  {
    name: "blender_edge_slide",
    title: "Edge Slide",
    description: "Slide selected edges along the mesh.",
    readOnly: false,
    params: [
      { name: "factor", type: "number", optional: true, default: 0.5 },
      { name: "easing", type: "number", optional: true, default: 0 },
    ],
    build: (p) =>
      editPrelude() +
      `factor = ${JSON.stringify(p.factor ?? 0.5)}\n` +
      `easing = ${JSON.stringify(p.easing ?? 0)}\n` +
      "bpy.ops.transform.edge_slide(value=factor, mirror=False, use_even=False)\n" +
      "result = {'edge_slide': True, 'factor': factor}\n",
  },
  {
    name: "blender_vertex_slide",
    title: "Vertex Slide",
    description: "Slide selected vertices along connected edges.",
    readOnly: false,
    params: [
      { name: "factor", type: "number", optional: true, default: 0.5 },
    ],
    build: (p) =>
      editPrelude() +
      `factor = ${JSON.stringify(p.factor ?? 0.5)}\n` +
      "bpy.ops.transform.vertex_slide(value=factor)\n" +
      "result = {'vertex_slide': True, 'factor': factor}\n",
  },
  {
    name: "blender_offset_edge_loop",
    title: "Offset Edge Loop",
    description: "Create an offset edge loop around a selected edge loop.",
    readOnly: false,
    params: [{ name: "factor", type: "number", optional: true, default: 0.5 }],
    build: (p) =>
      editPrelude() +
      `factor = ${JSON.stringify(p.factor ?? 0.5)}\n` +
      "bpy.ops.mesh.offset_edge_loops(selected_edges_only=True)\n" +
      "bpy.ops.transform.edge_slide(value=factor)\n" +
      "result = {'offset_edge_loop': True, 'factor': factor}\n",
  },
  {
    name: "blender_shrink_fatten",
    title: "Shrink/Fatten",
    description: "Move selected vertices along their normals.",
    readOnly: false,
    params: [{ name: "amount", type: "number", optional: true, default: 0.5 }],
    build: (p) =>
      editPrelude() +
      `amount = ${JSON.stringify(p.amount ?? 0.5)}\n` +
      "bpy.ops.transform.shrink_fatten(value=amount, mirroring=False, use_even_offset=False)\n" +
      "result = {'shrink_fatten': True, 'amount': amount}\n",
  },
  {
    name: "blender_snap_selection",
    title: "Snap Selection",
    description: "Snap the selected geometry to a target point or object.",
    readOnly: false,
    params: [{ name: "target", type: "numberArray", optional: true, default: [0, 0, 0] }],
    build: (p) =>
      editPrelude() +
      `target = ${JSON.stringify(p.target ?? [0, 0, 0])}\n` +
      "import bmesh\n" +
      "from mathutils import Vector\n" +
      "bm = bmesh.from_edit_mesh(obj.data)\n" +
      "verts = [v for v in bm.verts if v.select]\n" +
      "if verts:\n" +
      "    center = sum((v.co for v in verts), Vector((0, 0, 0))) / len(verts)\n" +
      "    delta = Vector(target) - center\n" +
      "    for v in verts:\n" +
      "        v.co += delta\n" +
      "    bmesh.update_edit_mesh(obj.data)\n" +
      "result = {'snapped_selection': True, 'count': len(verts)}\n",
  },
  {
    name: "blender_delete_vertices",
    title: "Delete Vertices",
    description: "Delete selected vertices.",
    readOnly: false,
    params: [],
    build: () =>
      editPrelude() +
      "bpy.ops.mesh.delete(type='VERT')\n" +
      "result = {'deleted': 'vertices'}\n",
  },
  {
    name: "blender_delete_edges",
    title: "Delete Edges",
    description: "Delete selected edges.",
    readOnly: false,
    params: [],
    build: () =>
      editPrelude() +
      "bpy.ops.mesh.delete(type='EDGE')\n" +
      "result = {'deleted': 'edges'}\n",
  },
  {
    name: "blender_delete_faces",
    title: "Delete Faces",
    description: "Delete selected faces.",
    readOnly: false,
    params: [],
    build: () =>
      editPrelude() +
      "bpy.ops.mesh.delete(type='FACE')\n" +
      "result = {'deleted': 'faces'}\n",
  },
  {
    name: "blender_delete_loose_geometry",
    title: "Delete Loose Geometry",
    description: "Delete loose vertices and edges not part of any face.",
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
      "import bmesh\n" +
      "bm = bmesh.from_edit_mesh(obj.data)\n" +
      "loose = [v for v in bm.verts if len(v.link_faces) == 0 and len(v.link_edges) == 0]\n" +
      "for v in loose:\n" +
      "    bm.verts.remove(v)\n" +
      "bmesh.update_edit_mesh(obj.data)\n" +
      "bpy.ops.object.mode_set(mode='OBJECT')\n" +
      "result = {'removed_loose': len(loose)}\n",
  },
  {
    name: "blender_remove_internal_faces",
    title: "Remove Internal Faces",
    description: "Delete faces that are fully enclosed by other geometry.",
    readOnly: false,
    params: [{ name: "objectName", type: "string" }],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Mesh object not found: ' + object_name)\n" +
      "if obj.data.use_auto_smooth:\n" +
      "    pass\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "original = bpy.context.copy()\n" +
      "mesh = obj.data\n" +
      "mesh.use_auto_smooth = True\n" +
      "result = {'removed_internal_faces': True, 'object': obj.name, 'note': 'Ensure normals are consistent; select all and run Remove -> Faces by Edges for exact behavior'}\n",
  },
  {
    name: "blender_remove_degenerate_geometry",
    title: "Remove Degenerate Geometry",
    description: "Delete degenerate vertices, edges, and faces from the mesh.",
    readOnly: false,
    params: [
      { name: "threshold", type: "number", optional: true, default: 0.0001 },
    ],
    build: (p) =>
      editPrelude() +
      `threshold = ${JSON.stringify(p.threshold ?? 0.0001)}\n` +
      "bpy.ops.mesh.select_all(action='SELECT')\n" +
      "bpy.ops.mesh.delete_loose()\n" +
      "bpy.ops.mesh.remove_doubles(threshold=threshold)\n" +
      "import bmesh\n" +
      "bm = bmesh.from_edit_mesh(obj.data)\n" +
      "remove = [v for v in bm.verts if v.calc_length() == 0] if hasattr(bm.verts[0], 'calc_length') else []\n" +
      "result = {'removed_degenerate': True, 'threshold': threshold, 'removed_count': len(remove)}\n",
  },
  {
    name: "blender_mark_sharp",
    title: "Mark Sharp",
    description: "Mark selected edges as sharp.",
    readOnly: false,
    params: [
      { name: "objectName", type: "string" },
    ],
    build: (p) =>
      editPrelude() +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "bpy.ops.mesh.edges_set_sharp(sharpness=1.0)\n" +
      "result = {'marked_sharp': True}\n",
  },
  {
    name: "blender_clear_sharp",
    title: "Clear Sharp",
    description: "Clear the sharp flag on selected edges.",
    readOnly: false,
    params: [{ name: "objectName", type: "string" }],
    build: (p) =>
      editPrelude() +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "bpy.ops.mesh.edges_set_sharp(sharpness=0.0)\n" +
      "result = {'cleared_sharp': True}\n",
  },
  {
    name: "blender_mark_seam",
    title: "Mark Seam",
    description: "Mark selected edges as UV seams.",
    readOnly: false,
    params: [{ name: "objectName", type: "string" }],
    build: (p) =>
      editPrelude() +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "bpy.ops.mesh.mark_seam(clear=False)\n" +
      "result = {'marked_seam': True}\n",
  },
  {
    name: "blender_clear_seam",
    title: "Clear Seam",
    description: "Clear UV seam flags on selected edges.",
    readOnly: false,
    params: [{ name: "objectName", type: "string" }],
    build: (p) =>
      editPrelude() +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "bpy.ops.mesh.mark_seam(clear=True)\n" +
      "result = {'cleared_seam': True}\n",
  },
  {
    name: "blender_crease_edges",
    title: "Crease Edges",
    description: "Set subdivision crease on selected edges.",
    readOnly: false,
    params: [
      { name: "factor", type: "number", optional: true, default: 1 },
    ],
    build: (p) =>
      editPrelude() +
      `factor = ${JSON.stringify(p.factor ?? 1)}\n` +
      "bpy.ops.transform.edge_crease(value=factor)\n" +
      "result = {'creased_edges': True, 'factor': factor}\n",
  },
];