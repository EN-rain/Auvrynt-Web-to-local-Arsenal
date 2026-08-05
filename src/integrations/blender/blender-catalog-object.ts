import type { CatalogTool } from "./blender-catalog.js";

const objModePrelude =
  "import bpy\n" +
  "if bpy.ops.object.mode_set.poll():\n" +
  "    bpy.ops.object.mode_set(mode='OBJECT')\n";

export const objectCatalogTools: CatalogTool[] = [
  {
    name: "blender_rename_object",
    title: "Rename Object",
    description: "Rename a single object.",
    readOnly: false,
    params: [
      { name: "objectName", type: "string" },
      { name: "newName", type: "string" },
    ],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      `new_name = ${JSON.stringify(p.newName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "obj.name = new_name\n" +
      "result = {'old_name': object_name, 'new_name': obj.name}\n",
  },
  {
    name: "blender_rename_objects",
    title: "Rename Objects",
    description: "Rename multiple objects, optionally replacing a substring.",
    readOnly: false,
    params: [
      { name: "objectNames", type: "stringArray" },
      { name: "newName", type: "string", optional: true },
      { name: "find", type: "string", optional: true },
      { name: "replace", type: "string", optional: true },
      { name: "prefix", type: "string", optional: true },
      { name: "pattern", type: "string", optional: true, description: "Wildcard to select objects to rename." },
    ],
    build: (p) =>
      "import bpy, fnmatch\n" +
      `names = ${JSON.stringify(p.objectNames ?? [])}\n` +
      `new_name = ${JSON.stringify(p.newName ?? "")}\n` +
      `find = ${JSON.stringify(p.find ?? "")}\n` +
      `replace = ${JSON.stringify(p.replace ?? "")}\n` +
      `prefix = ${JSON.stringify(p.prefix ?? "")}\n` +
      `pattern = ${JSON.stringify(p.pattern ?? "")}\n` +
      "targets = []\n" +
      "for name in names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if obj is not None:\n" +
      "        targets.append(obj)\n" +
      "if pattern and not targets:\n" +
      "    for obj in bpy.data.objects:\n" +
      "        if fnmatch.fnmatch(obj.name, pattern):\n" +
      "            targets.append(obj)\n" +
      "renamed = []\n" +
      "for i, obj in enumerate(targets):\n" +
      "    if new_name:\n" +
      "        base = new_name if len(targets) == 1 else f'{new_name}.{i:03d}'\n" +
      "    else:\n" +
      "        base = obj.name\n" +
      "        if find and replace:\n" +
      "            base = base.replace(find, replace)\n" +
      "        if prefix:\n" +
      "            base = prefix + base\n" +
      "    obj.name = base\n" +
      "    renamed.append(base)\n" +
      "result = {'renamed': renamed, 'count': len(renamed)}\n",
  },
  {
    name: "blender_delete_object",
    title: "Delete Object",
    description: "Delete a single object.",
    readOnly: false,
    params: [{ name: "objectName", type: "string" }],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "bpy.ops.object.mode_set(mode='OBJECT') if bpy.ops.object.mode_set.poll() else None\n" +
      "name = obj.name\n" +
      "bpy.data.objects.remove(obj, do_unlink=True)\n" +
      "result = {'deleted': name}\n",
  },
  {
    name: "blender_delete_objects",
    title: "Delete Objects",
    description: "Delete multiple objects by name.",
    readOnly: false,
    params: [{ name: "objectNames", type: "stringArray" }],
    build: (p) =>
      "import bpy\n" +
      `names = ${JSON.stringify(p.objectNames ?? [])}\n` +
      "bpy.ops.object.mode_set(mode='OBJECT') if bpy.ops.object.mode_set.poll() else None\n" +
      "deleted = []\n" +
      "for name in names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if obj:\n" +
      "        deleted.append(obj.name)\n" +
      "        bpy.data.objects.remove(obj, do_unlink=True)\n" +
      "result = {'deleted': deleted, 'count': len(deleted)}\n",
  },
  {
    name: "blender_make_single_user",
    title: "Make Single User",
    description: "Make selected objects single-user (duplicate their linked data).",
    readOnly: false,
    params: [
      { name: "objectNames", type: "stringArray", optional: true },
      { name: "dataOnly", type: "boolean", optional: true, default: false },
    ],
    build: (p) =>
      objectPrelude +
      `names = ${JSON.stringify(p.objectNames ?? null)}\n` +
      `data_only = ${p.dataOnly === true ? "True" : "False"}\n` +
      "if names:\n" +
      "    bpy.ops.object.select_all(action='DESELECT')\n" +
      "    for name in names:\n" +
      "        obj = bpy.data.objects.get(name)\n" +
      "        if obj:\n" +
      "            obj.select_set(True)\n" +
      "            if bpy.context.view_layer.objects.active is None:\n" +
      "                bpy.context.view_layer.objects.active = obj\n" +
      "if data_only:\n" +
      "    bpy.ops.object.make_single_user(object=True, obdata=True, material=True, animation=True)\n" +
      "else:\n" +
      "    bpy.ops.object.make_single_user(object=True, obdata=True, material=True, animation=True)\n" +
      "result = {'made_single_user': True}\n",
  },
  {
    name: "blender_make_instances",
    title: "Make Instances",
    description: "Convert selected objects to instances sharing mesh data with a parent.",
    readOnly: false,
    params: [{ name: "objectNames", type: "stringArray", optional: true }],
    build: (p) =>
      objectPrelude +
      `names = ${JSON.stringify(p.objectNames ?? null)}\n` +
      "if names:\n" +
      "    bpy.ops.object.select_all(action='DESELECT')\n" +
      "    for name in names:\n" +
      "        obj = bpy.data.objects.get(name)\n" +
      "        if obj:\n" +
      "            obj.select_set(True)\n" +
      "bpy.ops.object.make_links_data(type='OBDATA')\n" +
      "result = {'made_instances': True, 'note': 'Linked mesh data; select target object first for source.'}\n",
  },
  {
    name: "blender_convert_duplicates_to_instances",
    title: "Convert Duplicates to Instances",
    description: "Convert duplicate mesh copies to shared instances to save memory.",
    readOnly: false,
    params: [{ name: "objectNames", type: "stringArray", optional: true }],
    build: (p) =>
      "import bpy\n" +
      "bpy.ops.object.mode_set(mode='OBJECT') if bpy.ops.object.mode_set.poll() else None\n" +
      `names = ${JSON.stringify(p.objectNames ?? null)}\n` +
      "objs = []\n" +
      "if names:\n" +
      "    for name in names:\n" +
      "        o = bpy.data.objects.get(name)\n" +
      "        if o:\n" +
      "            objs.append(o)\n" +
      "else:\n" +
      "    objs = list(bpy.context.scene.objects)\n" +
      "mesh_by_fingerprint = {}\n" +
      "converted = 0\n" +
      "for obj in objs:\n" +
      "    if obj.type != 'MESH' or not obj.data:\n" +
      "        continue\n" +
      "    fp = (len(obj.data.vertices), len(obj.data.polygons))\n" +
      "    if fp not in mesh_by_fingerprint:\n" +
      "        mesh_by_fingerprint[fp] = obj.data.name\n" +
      "    else:\n" +
      "        src = bpy.data.meshes.get(mesh_by_fingerprint[fp])\n" +
      "        if src is not None:\n" +
      "            obj.data = src\n" +
      "            converted += 1\n" +
      "result = {'converted': converted, 'note': 'Fingerprint-based mesh sharing (point-count heuristic).'}\n",
  },
  {
    name: "blender_separate_object",
    title: "Separate Object",
    description: "Separate selected faces/loose parts into new objects.",
    readOnly: false,
    params: [
      { name: "objectName", type: "string" },
      { name: "separateType", type: "string", optional: true, default: "SELECTED", enumValues: ["SELECTED", "MATERIAL", "LOOSE", "BY_MATERIAL"] },
    ],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      `sep_type = ${JSON.stringify((p.separateType ?? "SELECTED").upper().replace("_", " ").replace(" ", "_"))}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Mesh object not found: ' + object_name)\n" +
      "bpy.context.view_layer.objects.active = obj\n" +
      "obj.select_set(True)\n" +
      "if bpy.context.object.mode != 'EDIT':\n" +
      "    bpy.ops.object.mode_set(mode='EDIT')\n" +
      "bpy.ops.mesh.separate(type=sep_type)\n" +
      "bpy.ops.object.mode_set(mode='OBJECT') if bpy.ops.object.mode_set.poll() else None\n" +
      "result = {'separated': True, 'type': sep_type}\n",
  },
  {
    name: "blender_set_parent_inverse",
    title: "Set Parent Inverse",
    description: "Set the parent inverse matrix of selected objects.",
    readOnly: false,
    params: [{ name: "objectNames", type: "stringArray", optional: true }],
    build: (p) =>
      objectPrelude +
      `names = ${JSON.stringify(p.objectNames ?? null)}\n` +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "for name in (names or []):\n" +
      "    o = bpy.data.objects.get(name)\n" +
      "    if o:\n" +
      "        o.select_set(True)\n" +
      "        if bpy.context.view_layer.objects.active is None:\n" +
      "            bpy.context.view_layer.objects.active = o\n" +
      "bpy.ops.object.parent_set(type='OBJECT', keep_transform=True)\n" +
      "result = {'set_parent_inverse': True}\n",
  },
  {
    name: "blender_link_to_collection",
    title: "Link to Collection",
    description: "Link objects to a collection without removing them from others.",
    readOnly: false,
    params: [
      { name: "objectNames", type: "stringArray" },
      { name: "collectionName", type: "string" },
    ],
    build: (p) =>
      "import bpy\n" +
      `names = ${JSON.stringify(p.objectNames ?? [])}\n` +
      `collection_name = ${JSON.stringify(p.collectionName)}\n` +
      "coll = bpy.data.collections.get(collection_name) or bpy.data.collections.new(collection_name)\n" +
      "if coll.name not in bpy.context.scene.collection.children:\n" +
      "    try:\n" +
      "        bpy.context.scene.collection.children.link(coll)\n" +
      "    except RuntimeError:\n" +
      "        pass\n" +
      "linked = []\n" +
      "for name in names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if obj:\n" +
      "        if obj.name not in coll.objects:\n" +
      "            coll.objects.link(obj)\n" +
      "        linked.append(obj.name)\n" +
      "result = {'collection': coll.name, 'linked': linked, 'count': len(linked)}\n",
  },
  {
    name: "blender_unlink_from_collection",
    title: "Unlink from Collection",
    description: "Remove objects from a collection.",
    readOnly: false,
    params: [
      { name: "objectNames", type: "stringArray" },
      { name: "collectionName", type: "string" },
    ],
    build: (p) =>
      "import bpy\n" +
      `names = ${JSON.stringify(p.objectNames ?? [])}\n` +
      `collection_name = ${JSON.stringify(p.collectionName)}\n` +
      "coll = bpy.data.collections.get(collection_name)\n" +
      "if coll is None:\n" +
      "    raise RuntimeError('Collection not found: ' + collection_name)\n" +
      "unlinked = []\n" +
      "for name in names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if obj and obj.name in coll.objects:\n" +
      "        coll.objects.unlink(obj)\n" +
      "        unlinked.append(obj.name)\n" +
      "result = {'collection': coll.name, 'unlinked': unlinked, 'count': len(unlinked)}\n",
  },
  {
    name: "blender_hide_object",
    title: "Hide Object",
    description: "Hide a single object in the viewport.",
    readOnly: false,
    params: [{ name: "objectName", type: "string" }],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "obj.hide_set(True)\n" +
      "result = {'hidden': obj.name}\n",
  },
  {
    name: "blender_unhide_object",
    title: "Unhide Object",
    description: "Unhide a single object in the viewport.",
    readOnly: false,
    params: [{ name: "objectName", type: "string" }],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "obj.hide_set(False)\n" +
      "obj.hide_select = False\n" +
      "result = {'name': obj.name, 'hidden': False}\n",
  },
  {
    name: "blender_set_object_visibility",
    title: "Set Object Visibility",
    description: "Set viewport, render, and select visibility of objects.",
    readOnly: false,
    params: [
      { name: "objectNames", type: "stringArray" },
      { name: "visible", type: "boolean", optional: true, default: true },
      { name: "hideRender", type: "boolean", optional: true },
    ],
    build: (p) =>
      "import bpy\n" +
      `names = ${JSON.stringify(p.objectNames ?? [])}\n` +
      `visible = ${p.visible === false ? "False" : "True"}\n` +
      `hide_render = ${p.hideRender === true ? "True" : p.hideRender === false ? "False" : "None"}\n` +
      "updated = []\n" +
      "for name in names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if obj:\n" +
      "        obj.hide_set(not visible)\n" +
      "        obj.hide_select = not visible\n" +
      "        if hide_render is not None:\n" +
      "            obj.hide_render = hide_render\n" +
      "        updated.append(obj.name)\n" +
      "result = {'updated': updated, 'visible': visible}\n",
  },
  {
    name: "blender_set_render_visibility",
    title: "Set Render Visibility",
    description: "Set render visibility (include/exclude from render) of objects.",
    readOnly: false,
    params: [
      { name: "objectNames", type: "stringArray" },
      { name: "visible", type: "boolean", optional: true, default: true },
    ],
    build: (p) =>
      "import bpy\n" +
      `names = ${JSON.stringify(p.objectNames ?? [])}\n` +
      `visible = ${p.visible === false ? "False" : "True"}\n` +
      "updated = []\n" +
      "for name in names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if obj:\n" +
      "        obj.hide_render = not visible\n" +
      "        updated.append(obj.name)\n" +
      "result = {'updated': updated, 'render_visible': visible}\n",
  },
  {
    name: "blender_set_viewport_visibility",
    title: "Set Viewport Visibility",
    description: "Set viewport visibility of objects.",
    readOnly: false,
    params: [
      { name: "objectNames", type: "stringArray" },
      { name: "visible", type: "boolean", optional: true, default: true },
    ],
    build: (p) =>
      "import bpy\n" +
      `names = ${JSON.stringify(p.objectNames ?? [])}\n` +
      `visible = ${p.visible === false ? "False" : "True"}\n` +
      "updated = []\n" +
      "for name in names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if obj:\n" +
      "        obj.hide_set(not visible)\n" +
      "        updated.append(obj.name)\n" +
      "result = {'updated': updated, 'viewport_visible': visible}\n",
  },
  {
    name: "blender_set_object_display_type",
    title: "Set Object Display Type",
    description: "Set the display type of empty objects in the viewport.",
    readOnly: false,
    params: [
      { name: "objectName", type: "string" },
      { name: "displayType", type: "string", optional: true, default: "PLAIN_AXES", enumValues: ["PLAIN_AXES", "ARROWS", "SINGLE_ARROW", "CIRCLE", "CUBE", "SPHERE", "CONE", "IMAGE"] },
    ],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      `display_type = ${JSON.stringify((p.displayType ?? "PLAIN_AXES").upper())}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "if obj.type != 'EMPTY':\n" +
      "    raise RuntimeError('Only EMPTY objects have display types')\n" +
      "obj.empty_display_type = display_type\n" +
      "result = {'object': obj.name, 'display_type': display_type}\n",
  },
  {
    name: "blender_set_object_color",
    title: "Set Object Color",
    description: "Set the viewport color override of an object.",
    readOnly: false,
    params: [
      { name: "objectName", type: "string" },
      { name: "color", type: "numberArray", optional: true, default: [1, 1, 1, 1] },
    ],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      `color = ${JSON.stringify(p.color ?? [1, 1, 1, 1])}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "obj.color = (color[0], color[1], color[2], color[3] if len(color) > 3 else 1.0)\n" +
      "result = {'object': obj.name, 'color': list(obj.color)}\n",
  },
  {
    name: "blender_set_origin_to_geometry",
    title: "Set Origin to Geometry",
    description: "Move object origin to the center of its geometry.",
    readOnly: false,
    params: [{ name: "objectNames", type: "stringArray" }],
    build: (p) =>
      objectPrelude +
      `names = ${JSON.stringify(p.objectNames ?? [])}\n` +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "for name in names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if obj:\n" +
      "        obj.select_set(True)\n" +
      "        bpy.context.view_layer.objects.active = obj\n" +
      "        bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='MEDIAN')\n" +
      "result = {'origins_set': len(names)}\n",
  },
  {
    name: "blender_set_origin_to_cursor",
    title: "Set Origin to Cursor",
    description: "Move object origin to the 3D cursor.",
    readOnly: false,
    params: [{ name: "objectNames", type: "stringArray" }],
    build: (p) =>
      objectPrelude +
      `names = ${JSON.stringify(p.objectNames ?? [])}\n` +
      "for name in names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if obj:\n" +
      "        bpy.ops.object.select_all(action='DESELECT')\n" +
      "        obj.select_set(True)\n" +
      "        bpy.context.view_layer.objects.active = obj\n" +
      "        bpy.ops.object.origin_set(type='ORIGIN_CURSOR', center='MEDIAN')\n" +
      "result = {'origins_set': len(names)}\n",
  },
  {
    name: "blender_freeze_transforms",
    title: "Freeze Transforms",
    description: "Apply all transforms to selected objects.",
    readOnly: false,
    params: [{ name: "objectNames", type: "stringArray" }],
    build: (p) =>
      objectPrelude +
      `names = ${JSON.stringify(p.objectNames ?? [])}\n` +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "for name in names:\n" +
      "    obj = bpy.data.objects.get(name)\n" +
      "    if obj:\n" +
      "        obj.select_set(True)\n" +
      "        bpy.context.view_layer.objects.active = obj\n" +
      "        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)\n" +
      "        obj.select_set(False)\n" +
      "result = {'frozen': len(names)}\n",
  },
  {
    name: "blender_set_custom_property",
    title: "Set Custom Property",
    description: "Set a custom property on an object.",
    readOnly: false,
    params: [
      { name: "objectName", type: "string" },
      { name: "propertyName", type: "string" },
      { name: "propertyValue", type: "string", optional: true },
      { name: "valueType", type: "string", optional: true, default: "auto", enumValues: ["auto", "string", "float", "int", "bool"] },
    ],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      `prop_name = ${JSON.stringify(p.propertyName)}\n` +
      `prop_value = ${JSON.stringify(p.propertyValue ?? "")}\n` +
      `value_type = ${JSON.stringify((p.valueType ?? "auto").lower())}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "if value_type == 'float':\n" +
      "    val = float(prop_value)\n" +
      "elif value_type == 'int':\n" +
      "    val = int(prop_value)\n" +
      "elif value_type == 'bool':\n" +
      "    val = str(prop_value).lower() in {'1', 'true', 'yes'}\n" +
      "else:\n" +
      "    try:\n" +
      "        val = float(prop_value)\n" +
      "    except ValueError:\n" +
      "        val = prop_value\n" +
      "obj[prop_name] = val\n" +
      "result = {'object': obj.name, 'property': prop_name, 'value': obj[prop_name]}\n",
  },
  {
    name: "blender_remove_custom_property",
    title: "Remove Custom Property",
    description: "Remove a custom property from an object.",
    readOnly: false,
    params: [
      { name: "objectName", type: "string" },
      { name: "propertyName", type: "string" },
    ],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      `prop_name = ${JSON.stringify(p.propertyName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "if prop_name in obj:\n" +
      "    del obj[prop_name]\n" +
      "    removed = True\n" +
      "else:\n" +
      "    removed = False\n" +
      "result = {'object': obj.name, 'property': prop_name, 'removed': removed}\n",
  },
  {
    name: "blender_move_object",
    title: "Move Object",
    description: "Move an object by a relative offset.",
    readOnly: false,
    params: [
      { name: "objectName", type: "string" },
      { name: "delta", type: "numberArray", default: [0, 0, 0] },
    ],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      `delta = ${JSON.stringify(p.delta ?? [0, 0, 0])}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "obj.location += delta\n" +
      "result = {'object': obj.name, 'location': [round(v, 4) for v in obj.location]}\n",
  },
  {
    name: "blender_rotate_object",
    title: "Rotate Object",
    description: "Rotate an object by a delta Euler rotation (degrees).",
    readOnly: false,
    params: [
      { name: "objectName", type: "string" },
      { name: "rotation", type: "numberArray", optional: true, default: [0, 0, 0] },
      { name: "order", type: "string", optional: true, default: "XYZ" },
    ],
    build: (p) =>
      "import bpy\n" +
      "import math\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      `rotation = ${JSON.stringify(p.rotation ?? [0, 0, 0])}\n` +
      `order = ${JSON.stringify((p.order ?? "XYZ").upper())}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "from mathutils import Euler\n" +
      "delta = Euler((rotation[0] * math.pi / 180, rotation[1] * math.pi / 180, rotation[2] * math.pi / 180), order)\n" +
      "obj.rotation_euler = ((obj.rotation_euler.to_matrix() @ delta.to_matrix()).to_euler(order))\n" +
      "result = {'object': obj.name, 'rotation_euler': [round(v, 4) for v in obj.rotation_euler]}\n",
  },
  {
    name: "blender_scale_object",
    title: "Scale Object",
    description: "Scale an object by a factor.",
    readOnly: false,
    params: [
      { name: "objectName", type: "string" },
      { name: "scale", type: "numberArray", optional: true, default: [1, 1, 1] },
      { name: "uniform", type: "number", optional: true },
    ],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      `scale = ${JSON.stringify(p.scale ?? null)}\n` +
      `uniform = ${JSON.stringify(p.uniform ?? null)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None:\n" +
      "    raise RuntimeError('Object not found: ' + object_name)\n" +
      "if uniform is not None:\n" +
      "    obj.scale = (uniform, uniform, uniform)\n" +
      "else:\n" +
      "    obj.scale = scale\n" +
      "result = {'object': obj.name, 'scale': [round(v, 4) for v in obj.scale]}\n",
  },
  {
    name: "blender_align_objects",
    title: "Align Objects",
    description: "Align selected objects by a chosen axis to themselves or the active object.",
    readOnly: false,
    params: [
      { name: "objectNames", type: "stringArray" },
      { name: "align", type: "string", optional: true, default: "MAX", enumValues: ["MIN", "MAX", "CENTER", "ACTIVE"] },
      { name: "axis", type: "string", optional: true, default: "X", enumValues: ["X", "Y", "Z"] },
    ],
    build: (p) =>
      "import bpy\n" +
      `names = ${JSON.stringify(p.objectNames ?? [])}\n` +
      `align = ${JSON.stringify((p.align ?? "MAX").upper())}\n` +
      `axis = ${JSON.stringify((p.axis ?? "X").upper())}\n` +
      "bpy.ops.object.select_all(action='DESELECT')\n" +
      "objs = []\n" +
      "for name in names:\n" +
      "    o = bpy.data.objects.get(name)\n" +
      "    if o:\n" +
      "        o.select_set(True)\n" +
      "        objs.append(o)\n" +
      "if len(objs) < 1:\n" +
      "    raise RuntimeError('Need objects to align')\n" +
      "bpy.ops.object.align(align_axis={axis: align}, relative_to='OPTICS')\n" +
      "result = {'aligned': len(objs), 'axis': axis, 'align': align}\n",
  },
  {
    name: "blender_distribute_objects",
    title: "Distribute Objects",
    description: "Distribute selected objects with spacing along an axis.",
    readOnly: false,
    params: [
      { name: "objectNames", type: "stringArray" },
      { name: "axis", type: "string", optional: true, default: "X", enumValues: ["X", "Y", "Z"] },
      { name: "spacing", type: "number", optional: true, default: 1 },
    ],
    build: (p) =>
      "import bpy\n" +
      `names = ${JSON.stringify(p.objectNames ?? [])}\n` +
      `axis = ${JSON.stringify((p.axis ?? "X").upper())}\n` +
      `spacing = ${JSON.stringify(p.spacing ?? 1)}\n` +
      "axis_index = {'X': 0, 'Y': 1, 'Z': 2}[axis]\n" +
      "objs = []\n" +
      "for name in names:\n" +
      "    o = bpy.data.objects.get(name)\n" +
      "    if o:\n" +
      "        objs.append(o)\n" +
      "if len(objs) < 2:\n" +
      "    result = {'distributed': 0, 'note': 'Need at least two objects.'}\n" +
      "else:\n" +
      "    for i, o in enumerate(objs):\n" +
      "        v = o.location.copy()\n" +
      "        v[axis_index] = i * spacing\n" +
      "        o.location = v\n" +
      "    result = {'distributed': len(objs), 'axis': axis, 'spacing': spacing}\n",
  },
  {
    name: "blender_randomize_transforms",
    title: "Randomize Transforms",
    description: "Randomize location, rotation, and/or scale of selected objects within a range.",
    readOnly: false,
    params: [
      { name: "objectNames", type: "stringArray", optional: true },
      { name: "amount", type: "number", optional: true, default: 0.5 },
      { name: "loc", type: "boolean", optional: true, default: true },
      { name: "rot", type: "boolean", optional: true, default: false },
      { name: "scale", type: "boolean", optional: true, default: false },
    ],
    build: (p) =>
      "import bpy, random\n" +
      `names = ${JSON.stringify(p.objectNames ?? null)}\n` +
      `amount = ${JSON.stringify(p.amount ?? 0.5)}\n` +
      `use_loc = ${p.loc === false ? "False" : "True"}\n` +
      `use_rot = ${p.rot === true ? "True" : "False"}\n` +
      `use_scale = ${p.scale === true ? "True" : "False"}\n` +
      "objs = []\n" +
      "if names:\n" +
      "    for name in names:\n" +
      "        o = bpy.data.objects.get(name)\n" +
      "        if o:\n" +
      "            objs.append(o)\n" +
      "else:\n" +
      "    objs = list(bpy.context.selected_objects)\n" +
      "for o in objs:\n" +
      "    if use_loc:\n" +
      "        o.location += (random.uniform(-amount, amount), random.uniform(-amount, amount), random.uniform(-amount, amount))\n" +
      "    if use_scale:\n" +
      "        s = random.uniform(max(0.1, 1 - amount), 1 + amount)\n" +
      "        o.scale = (s, s, s)\n" +
      "result = {'randomized': len(objs)}\n",
  },
  {
    name: "blender_snap_objects_to_grid",
    title: "Snap Objects to Grid",
    description: "Snap object locations to a grid.",
    readOnly: false,
    params: [
      { name: "objectNames", type: "stringArray", optional: true },
      { name: "gridSize", type: "number", optional: true, default: 0.1 },
    ],
    build: (p) =>
      "import bpy\n" +
      `names = ${JSON.stringify(p.objectNames ?? null)}\n` +
      `grid_size = ${JSON.stringify(p.gridSize ?? 0.1)}\n` +
      "objs = [bpy.data.objects.get(n) for n in (names or []) if bpy.data.objects.get(n)]\n" +
      "if not objs:\n" +
      "    objs = list(bpy.context.selected_objects)\n" +
      "for o in objs:\n" +
      "    o.location.x = round(o.location.x / grid_size) * grid_size\n" +
      "    o.location.y = round(o.location.y / grid_size) * grid_size\n" +
      "    o.location.z = round(o.location.z / grid_size) * grid_size\n" +
      "result = {'snapped': len(objs), 'grid_size': grid_size}\n",
  },
  {
    name: "blender_snap_objects_to_surface",
    title: "Snap Objects to Surface",
    description: "Snap objects down along -Z to the highest ray-hit surface below them.",
    readOnly: false,
    params: [
      { name: "objectNames", type: "stringArray", optional: true },
      { name: "targetObject", type: "string", optional: true },
    ],
    build: (p) =>
      "import bpy\n" +
      "from mathutils import Vector\n" +
      `names = ${JSON.stringify(p.objectNames ?? null)}\n` +
      `target_name = ${JSON.stringify(p.targetObject ?? "")}\n` +
      "objs = [bpy.data.objects.get(n) for n in (names or []) if bpy.data.objects.get(n)]\n" +
      "if not objs:\n" +
      "    objs = list(bpy.context.selected_objects)\n" +
      "if target_name:\n" +
      "    target = bpy.data.objects.get(target_name)\n" +
      "    depsgraph = bpy.context.evaluated_depsgraph_get()\n" +
      "    target_eval = target.evaluated_get(depsgraph) if target else None\n" +
      "else:\n" +
      "    target_eval = None\n" +
      "snapped = 0\n" +
      "for o in objs:\n" +
      "    source = o if target_eval is None else target_eval\n" +
      "    if o.type == 'MESH' and hasattr(o.data, 'polygons'):\n" +
      "        direction = Vector((0, 0, -1))\n" +
      "        origin = o.location + Vector((0, 0, 100))\n" +
      "        hit, loc, normal, index = source.ray_cast(origin, direction)\n" +
      "        if hit:\n" +
      "            o.location.z = loc.z\n" +
      "            snapped += 1\n" +
      "result = {'snapped': snapped}\n",
  },
  {
    name: "blender_set_pivot_point",
    title: "Set Pivot Point",
    description: "Set the transformation pivot point.",
    readOnly: false,
    params: [
      { name: "objectNames", type: "stringArray" },
      { name: "pivotType", type: "string", optional: true, default: "MEDIAN_POINT", enumValues: ["MEDIAN_POINT", "BOUNDING_BOX_CENTER", "CURSOR", "INDIVIDUAL_ORIGINS", "ACTIVE_ELEMENT"] },
    ],
    build: (p) =>
      objectPrelude +
      `pivot_type = ${JSON.stringify((p.pivotType ?? "MEDIAN_POINT").upper())}\n` +
      "bpy.context.tool_settings.transform_pivot_point = pivot_type\n" +
      "result = {'pivot_point': pivot_type}\n",
  },
  {
    name: "blender_set_transform_orientation",
    title: "Set Transform Orientation",
    description: "Set the transform orientation for selected objects.",
    readOnly: false,
    params: [
      { name: "objectNames", type: "stringArray" },
      { name: "orientation", type: "string", optional: true, default: "GLOBAL", enumValues: ["GLOBAL", "LOCAL", "NORMAL", "GIMBAL", "VIEW"] },
    ],
    build: (p) =>
      objectPrelude +
      `orientation = ${JSON.stringify((p.orientation ?? "GLOBAL").upper())}\n` +
      "bpy.context.scene.transform_orientation_slots[0].type = orientation\n" +
      "result = {'orientation': orientation}\n",
  },
  {
    name: "blender_set_snapping",
    title: "Set Snapping",
    description: "Configure snapping for the tool settings.",
    readOnly: false,
    params: [
      { name: "enabled", type: "boolean", optional: true, default: true },
      { name: "element", type: "string", optional: true, default: "FACE", enumValues: ["VERTEX", "EDGE", "FACE", "VOLUME", "EDGE_MIDPOINT", "EDGE_PERPENDICULAR"] },
      { name: "target", type: "string", optional: true, default: "ACTIVE", enumValues: ["ACTIVE", "MEDIAN", "CENTER", "CLOSEST"] },
    ],
    build: (p) =>
      "import bpy\n" +
      `enabled = ${p.enabled === false ? "False" : "True"}\n` +
      `element = ${JSON.stringify((p.element ?? "VERTEX").upper())}\n` +
      `target = ${JSON.stringify((p.target ?? "ACTIVE").upper())}\n` +
      "ts = bpy.context.scene.tool_settings\n" +
      "ts.use_snap = enabled\n" +
      "ts.snap_elements = {element}\n" +
      "result = {'enabled': enabled, 'element': element}\n",
  },
  {
    name: "blender_measure_distance",
    title: "Measure Distance",
    description: "Measure the world-space distance between two objects or points.",
    readOnly: true,
    params: [
      { name: "objectAName", type: "string" },
      { name: "objectBName", type: "string" },
    ],
    build: (p) =>
      "import bpy, math\n" +
      `a_name = ${JSON.stringify(p.objectAName)}\n` +
      `b_name = ${JSON.stringify(p.objectBName)}\n` +
      "a = bpy.data.objects.get(a_name)\n" +
      "b = bpy.data.objects.get(b_name)\n" +
      "if a is None or b is None:\n" +
      "    raise RuntimeError('Both objects must exist')\n" +
      "distance = (b.location - a.location).length\n" +
      "result = {'objectA': a.name, 'objectB': b.name, 'distance': round(distance, 4), 'units': bpy.context.scene.unit_settings.length_unit}\n",
  },
  {
    name: "blender_measure_angle",
    title: "Measure Angle",
    description: "Measure the angle formed by three objects at the vertex object.",
    readOnly: true,
    params: [
      { name: "vertexObject", type: "string" },
      { name: "objectAName", type: "string" },
      { name: "objectBName", type: "string" },
    ],
    build: (p) =>
      "import bpy, math\n" +
      `vertex_name = ${JSON.stringify(p.vertexObject)}\n` +
      `a_name = ${JSON.stringify(p.objectAName)}\n` +
      `b_name = ${JSON.stringify(p.objectBName)}\n` +
      "v_ref = bpy.data.objects.get(vertex_name)\n" +
      "a = bpy.data.objects.get(a_name)\n" +
      "b = bpy.data.objects.get(b_name)\n" +
      "if v_ref is None or a is None or b is None:\n" +
      "    raise RuntimeError('All three objects must exist')\n" +
      "va = a.location - v_ref.location\n" +
      "vb = b.location - v_ref.location\n" +
      "cos = va.dot(vb) / (va.length * vb.length)\n" +
      "ang = math.acos(max(-1.0, min(1.0, cos)))\n" +
      "result = {'vertex': v_ref.name, 'angle_degrees': round(math.degrees(ang), 4), 'angle_radians': round(ang, 6)}\n",
  },
  {
    name: "blender_measure_area",
    title: "Measure Area",
    description: "Measure the total surface area of a mesh object.",
    readOnly: true,
    params: [{ name: "objectName", type: "string" }],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Mesh object not found')\n" +
      "area = sum(p.area for p in obj.data.polygons)\n" +
      "result = {'object': obj.name, 'surface_area': round(area, 4), 'polygons': len(obj.data.polygons)}\n",
  },
  {
    name: "blender_measure_volume",
    title: "Measure Volume",
    description: "Estimate the volume of a closed mesh object.",
    readOnly: true,
    params: [{ name: "objectName", type: "string" }],
    build: (p) =>
      "import bpy\n" +
      `object_name = ${JSON.stringify(p.objectName)}\n` +
      "obj = bpy.data.objects.get(object_name)\n" +
      "if obj is None or obj.type != 'MESH':\n" +
      "    raise RuntimeError('Mesh object not found')\n" +
      "meshes = [obj.data]\n" +
      "deform = mesh.calc_volume() if hasattr(mesh, 'calc_volume') else None\n" +
      "result = {'object': obj.name, 'volume': round(mesh.calc_volume(), 6) if hasattr(mesh, 'calc_volume') else None}\n",
  },
  {
    name: "blender_validate_scale",
    title: "Validate Scale",
    description: "Check whether an object has uniform, non-negative scale.",
    readOnly: true,
    params: [
      { name: "objectNames", type: "stringArray", optional: true },
    ],
    build: (p) =>
      "import bpy\n" +
      `names = ${JSON.stringify(p.objectNames ?? null)}\n` +
      "objs = [bpy.data.objects.get(n) for n in (names or [])] if names else list(bpy.data.objects)\n" +
      "objs = [o for o in objs if o]\n" +
      "report = []\n" +
      "for o in objs:\n" +
      "    uniform = abs(o.scale.x - o.scale.y) < 0.001 and abs(o.scale.y - o.scale.z) < 0.001\n" +
      "    non_negative = o.scale.x >= 0 and o.scale.y >= 0 and o.scale.z >= 0\n" +
      "    report.append({'name': o.name, 'scale': list(o.scale), 'uniform': uniform, 'non_negative': non_negative})\n" +
      "invalid = [r['name'] for r in report if not (r['uniform'] and r['non_negative'])]\n" +
      "result = {'report': report, 'invalid': invalid, 'count': len(invalid)}\n",
  },
  {
    name: "blender_normalize_asset_scale",
    title: "Normalize Asset Scale",
    description: "Normalize objects to unit scale aligned to a target size.",
    readOnly: false,
    params: [
      { name: "objectNames", type: "stringArray" },
      { name: "targetSize", type: "number", optional: true, default: 1 },
      { name: "fit", type: "string", optional: true, default: "MAX", enumValues: ["MAX", "LONGEST"] },
    ],
    build: (p) =>
      "import bpy\n" +
      "from mathutils import Vector\n" +
      `names = ${JSON.stringify(p.objectNames ?? [])}\n` +
      `target_size = ${JSON.stringify(p.targetSize ?? 1)}\n` +
      "for name in names:\n" +
      "    o = bpy.data.objects.get(name)\n" +
      "    if o is None:\n" +
      "        continue\n" +
      "    bounds = [o.matrix_world @ Vector(c) for c in o.bound_box]\n" +
      "    size = Vector((\n" +
      "        max(p.x for p in bounds) - min(p.x for p in bounds),\n" +
      "        max(p.y for p in bounds) - min(p.y for p in bounds),\n" +
      "        max(p.z for p in bounds) - min(p.z for p in bounds),\n" +
      "    ))\n" +
      "    max_dim = max(size.x, size.y, size.z, 1e-6)\n" +
      "    scale = target_size / max_dim\n" +
      "    obj.scale = obj.scale * scale\n" +
      "result = {'normalized': len(names), 'target_size': target_size}\n",
  },
  {
    name: "blender_set_units",
    title: "Set Units",
    description: "Set the scene unit system and scale.",
    readOnly: false,
    params: [
      { name: "lengthUnit", type: "string", optional: true, default: "METERS", enumValues: ["NONE", "METERS", "CENTIMETERS", "MILLIMETERS", "FEET", "INCHES"] },
      { name: "scale", type: "number", optional: true, default: 1 },
      { name: "system", type: "string", optional: true, default: "METRIC", enumValues: ["METRIC", "IMPERIAL"] },
    ],
    build: (p) =>
      "import bpy\n" +
      `system = ${JSON.stringify((p.system ?? "METRIC").upper())}\n` +
      `length_unit = ${JSON.stringify((p.lengthUnit ?? "METERS").upper())}\n` +
      `scale = ${JSON.stringify(p.scale ?? 1)}\n` +
      "units = bpy.context.scene.unit_settings\n" +
      "units.system = system\n" +
      "units.system_units = 'INPUTS'\n" +
      "units.length_unit = length_unit\n" +
      "units.scale_length = scale\n" +
      "result = {'system': system, 'length_unit': length_unit, 'scale_length': units.scale_length}\n",
  },
];

// spin/array helpers used above
const objectPrelude =
  "import bpy\n" +
  "if bpy.ops.object.mode_set.poll():\n" +
  "    bpy.ops.object.mode_set(mode='OBJECT')\n";