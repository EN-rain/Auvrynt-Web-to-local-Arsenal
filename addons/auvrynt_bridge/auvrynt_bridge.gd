    Recreate or edit the Claude connector after restart.@tool
extends EditorPlugin

# ─── Configuration ────────────────────────────────────────────────────────────
const BIND_ADDRESS = "127.0.0.1"
const DEFAULT_PORT = 49322
const MAX_CONNECTIONS = 1
const READ_BUFFER_SIZE = 65536
const PROTOCOL_VERSION = 1

# ─── State ────────────────────────────────────────────────────────────────────
var _server: TCPServer
var _peer: StreamPeerTCP
var _session_token: String = ""
var _port: int = DEFAULT_PORT
var _read_buf: PackedByteArray = PackedByteArray()

# ─── Lifecycle ────────────────────────────────────────────────────────────────
func _enter_tree() -> void:
	var crypto = Crypto.new()
	_session_token = Marshalls.raw_to_base64(crypto.generate_random_bytes(32))
	_server = TCPServer.new()
	_port = ProjectSettings.get_setting("auvrynt_bridge/port", DEFAULT_PORT) as int
	var err = _server.listen(_port, BIND_ADDRESS)
	if err == OK:
		print("[AuvryntBridge] Listening on %s:%d  token=%s" % [BIND_ADDRESS, _port, _session_token])
	else:
		push_error("[AuvryntBridge] Failed to listen on port %d (err=%d)" % [_port, err])

func _exit_tree() -> void:
	if _server:
		_server.stop()
	_peer = null

func _process(_delta: float) -> void:
	# Accept new connection (single-peer model)
	if _server and _server.is_connection_available():
		_peer = _server.take_connection()
		_read_buf = PackedByteArray()

	# Read and dispatch
	if _peer and _peer.get_status() == StreamPeerTCP.STATUS_CONNECTED:
		var available = _peer.get_available_bytes()
		if available > 0:
			var chunk = _peer.get_partial_data(min(available, READ_BUFFER_SIZE))
			if chunk[0] == OK:
				_read_buf.append_array(chunk[1])
				_try_parse_buffer()

# Dispatch a complete newline-delimited JSON frame if available
func _try_parse_buffer() -> void:
	while true:
		var nl_pos = _read_buf.find(10)  # 0x0A = '\n'
		if nl_pos < 0:
			break
		var frame = _read_buf.slice(0, nl_pos).get_string_from_utf8()
		_read_buf = _read_buf.slice(nl_pos + 1)
		_handle_request(frame)

# ─── Request Handler ──────────────────────────────────────────────────────────
func _handle_request(text: String) -> void:
	var json = JSON.parse_string(text)
	if typeof(json) != TYPE_DICTIONARY:
		return

	var token: String = json.get("token", "")
	var method: String = json.get("method", "")
	var req_id: String = json.get("requestId", "")
	var params: Dictionary = json.get("params", {})

	if token != _session_token:
		_send_error(req_id, "Invalid session token")
		return

	match method:
		"status":
			_send_ok(req_id, {
				"connected": true,
				"godotVersion": Engine.get_version_info().string,
				"projectPath": ProjectSettings.globalize_path("res://"),
				"protocolVersion": PROTOCOL_VERSION,
				"port": _port,
			})

		# ── Scene tree (edited) ──────────────────────────────────────────────
		"scene.get_tree":
			var root = get_tree().edited_scene_root
			var max_depth: int = params.get("maxDepth", 10)
			_send_ok(req_id, {"tree": _serialize_node(root, 0, max_depth)})

		# ── Node inspection ──────────────────────────────────────────────────
		"node.get_properties":
			var node = _resolve_node(params.get("nodePath", ""))
			if not node:
				_send_error(req_id, "Node not found: " + str(params.get("nodePath")))
				return
			var props: Dictionary = {}
			for prop in node.get_property_list():
				if prop.usage & PROPERTY_USAGE_EDITOR:
					var val = node.get(prop.name)
					props[prop.name] = _serialize_value(val)
			_send_ok(req_id, {"properties": props})

		"node.get_property":
			var node = _resolve_node(params.get("nodePath", ""))
			if not node:
				_send_error(req_id, "Node not found: " + str(params.get("nodePath")))
				return
			var prop_name: String = params.get("property", "")
			var val = node.get(prop_name)
			_send_ok(req_id, {"value": _serialize_value(val), "type": typeof(val)})

		"node.set_property":
			var node = _resolve_node(params.get("nodePath", ""))
			if not node:
				_send_error(req_id, "Node not found: " + str(params.get("nodePath")))
				return
			var prop_name: String = params.get("property", "")
			var val = params.get("value")
			var ur = get_undo_redo()
			var old_val = node.get(prop_name)
			ur.create_action("Set property %s.%s" % [node.name, prop_name])
			ur.add_do_property(node, prop_name, val)
			ur.add_undo_property(node, prop_name, old_val)
			ur.commit_action()
			_send_ok(req_id, {"set": true})

		"node.get_signals":
			var node = _resolve_node(params.get("nodePath", ""))
			if not node:
				_send_error(req_id, "Node not found")
				return
			var signals = []
			for sig in node.get_signal_list():
				signals.append(sig.name)
			_send_ok(req_id, {"signals": signals})

		"node.get_connections":
			var node = _resolve_node(params.get("nodePath", ""))
			if not node:
				_send_error(req_id, "Node not found")
				return
			var connections = []
			for sig in node.get_signal_list():
				for conn in node.get_signal_connection_list(sig.name):
					connections.append({
						"signal": sig.name,
						"target": str(conn.callable.get_object().get_path()) if conn.callable.get_object() else "",
						"method": conn.callable.get_method()
					})
			_send_ok(req_id, {"connections": connections})

		"node.connect_signal":
			var src = _resolve_node(params.get("sourcePath", ""))
			var tgt = _resolve_node(params.get("targetPath", ""))
			if not src or not tgt:
				_send_error(req_id, "Source or target node not found")
				return
			var sig_name: String = params.get("signal", "")
			var method_name: String = params.get("method", "")
			var err = src.connect(sig_name, Callable(tgt, method_name))
			if err == OK:
				_send_ok(req_id, {"connected": true})
			else:
				_send_error(req_id, "connect() failed with error %d" % err)

		# ── Node mutation ────────────────────────────────────────────────────
		"node.create":
			var parent = _resolve_node(params.get("parentPath", ""))
			if not parent:
				_send_error(req_id, "Parent node not found")
				return
			var class_name_str: String = params.get("type", "Node")
			var node_name: String = params.get("name", class_name_str)
			if not ClassDB.class_exists(class_name_str):
				_send_error(req_id, "Unknown class: " + class_name_str)
				return
			var new_node: Node = ClassDB.instantiate(class_name_str)
			new_node.name = node_name
			var ur = get_undo_redo()
			ur.create_action("Create node %s" % node_name)
			ur.add_do_method(parent, "add_child", new_node)
			ur.add_do_property(new_node, "owner", get_tree().edited_scene_root)
			ur.add_undo_method(parent, "remove_child", new_node)
			ur.commit_action()
			_send_ok(req_id, {"path": str(new_node.get_path())})

		"node.delete":
			var node = _resolve_node(params.get("nodePath", ""))
			if not node:
				_send_error(req_id, "Node not found")
				return
			var parent = node.get_parent()
			var ur = get_undo_redo()
			ur.create_action("Delete node %s" % node.name)
			ur.add_do_method(parent, "remove_child", node)
			ur.add_undo_method(parent, "add_child", node)
			ur.commit_action()
			_send_ok(req_id, {"deleted": true})

		"node.reparent":
			var node = _resolve_node(params.get("nodePath", ""))
			var new_parent = _resolve_node(params.get("newParentPath", ""))
			if not node or not new_parent:
				_send_error(req_id, "Node or new parent not found")
				return
			var old_parent = node.get_parent()
			var ur = get_undo_redo()
			ur.create_action("Reparent node %s" % node.name)
			ur.add_do_method(node, "reparent", new_parent)
			ur.add_undo_method(node, "reparent", old_parent)
			ur.commit_action()
			_send_ok(req_id, {"reparented": true})

		"node.attach_script":
			var node = _resolve_node(params.get("nodePath", ""))
			if not node:
				_send_error(req_id, "Node not found")
				return
			var script_path: String = params.get("scriptPath", "")
			if not ResourceLoader.exists(script_path):
				_send_error(req_id, "Script not found: " + script_path)
				return
			var script = load(script_path)
			var ur = get_undo_redo()
			var old_script = node.get_script()
			ur.create_action("Attach script to %s" % node.name)
			ur.add_do_property(node, "script", script)
			ur.add_undo_property(node, "script", old_script)
			ur.commit_action()
			_send_ok(req_id, {"attached": true})

		"node.detach_script":
			var node = _resolve_node(params.get("nodePath", ""))
			if not node:
				_send_error(req_id, "Node not found")
				return
			var old_script = node.get_script()
			var ur = get_undo_redo()
			ur.create_action("Detach script from %s" % node.name)
			ur.add_do_property(node, "script", null)
			ur.add_undo_property(node, "script", old_script)
			ur.commit_action()
			_send_ok(req_id, {"detached": true})

		# ── UndoRedo ─────────────────────────────────────────────────────────
		"editor.undo":
			get_undo_redo().undo()
			_send_ok(req_id, {"done": true})

		"editor.redo":
			get_undo_redo().redo()
			_send_ok(req_id, {"done": true})

		# ── Remote scene tree ─────────────────────────────────────────────────
		"remote.get_scene_tree":
			var root = get_tree().root
			var max_depth: int = params.get("maxDepth", 10)
			_send_ok(req_id, {"tree": _serialize_node(root, 0, max_depth)})

		"remote.get_node":
			var node = get_tree().root.get_node_or_null(params.get("nodePath", ""))
			if not node:
				_send_error(req_id, "Node not found: " + str(params.get("nodePath")))
				return
			_send_ok(req_id, {"node": _serialize_node(node, 0, 1)})

		"remote.get_property":
			var node = get_tree().root.get_node_or_null(params.get("nodePath", ""))
			if not node:
				_send_error(req_id, "Node not found")
				return
			var val = node.get(params.get("property", ""))
			_send_ok(req_id, {"value": _serialize_value(val), "type": typeof(val)})

		"remote.get_performance_monitors":
			_send_ok(req_id, {
				"fps": Performance.get_monitor(Performance.TIME_FPS),
				"processTimeMs": Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0,
				"physicsProcessTimeMs": Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0,
				"memoryMb": Performance.get_monitor(Performance.MEMORY_STATIC) / (1024.0 * 1024.0),
				"nodeCount": Performance.get_monitor(Performance.OBJECT_NODE_COUNT),
				"objectCount": Performance.get_monitor(Performance.OBJECT_COUNT),
				"orphanNodeCount": Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT),
			})

		# ── Input simulation ──────────────────────────────────────────────────
		"input.press_action":
			var action: String = params.get("action", "")
			var duration_ms: float = params.get("durationMs", 100)
			var evt = InputEventAction.new()
			evt.action = action
			evt.pressed = true
			Input.parse_input_event(evt)
			await get_tree().create_timer(duration_ms / 1000.0).timeout
			evt = InputEventAction.new()
			evt.action = action
			evt.pressed = false
			Input.parse_input_event(evt)
			_send_ok(req_id, {"sent": true})

		"input.release_action":
			var action: String = params.get("action", "")
			var evt = InputEventAction.new()
			evt.action = action
			evt.pressed = false
			Input.parse_input_event(evt)
			_send_ok(req_id, {"sent": true})

		"input.mouse_click":
			var evt = InputEventMouseButton.new()
			evt.button_index = params.get("button", MOUSE_BUTTON_LEFT)
			evt.position = Vector2(params.get("x", 0), params.get("y", 0))
			evt.pressed = true
			Input.parse_input_event(evt)
			await get_tree().process_frame
			evt.pressed = false
			Input.parse_input_event(evt)
			_send_ok(req_id, {"sent": true})

		# ── Animation ─────────────────────────────────────────────────────────
		"animation.list":
			var node = _resolve_node(params.get("nodePath", ""))
			if not node or not node is AnimationPlayer:
				_send_error(req_id, "AnimationPlayer not found at path")
				return
			_send_ok(req_id, {"animations": node.get_animation_list()})

		"animation.get":
			var node = _resolve_node(params.get("nodePath", ""))
			if not node or not node is AnimationPlayer:
				_send_error(req_id, "AnimationPlayer not found")
				return
			var anim_name: String = params.get("animationName", "")
			if not node.has_animation(anim_name):
				_send_error(req_id, "Animation not found: " + anim_name)
				return
			var anim = node.get_animation(anim_name)
			var tracks = []
			for i in range(anim.get_track_count()):
				var keys = []
				for k in range(anim.track_get_key_count(i)):
					keys.append({"time": anim.track_get_key_time(i, k), "value": _serialize_value(anim.track_get_key_value(i, k))})
				tracks.append({"type": anim.track_get_type(i), "targetPath": str(anim.track_get_path(i)), "keys": keys, "interpolation": anim.track_get_interpolation_type(i)})
			_send_ok(req_id, {"name": anim_name, "lengthSeconds": anim.length, "loop": anim.loop_mode != Animation.LOOP_NONE, "step": anim.step, "tracks": tracks})

		"animation.create":
			var node = _resolve_node(params.get("nodePath", ""))
			if not node or not node is AnimationPlayer:
				_send_error(req_id, "AnimationPlayer not found")
				return
			var anim_name: String = params.get("animationName", "")
			var anim = Animation.new()
			anim.length = params.get("length", 1.0)
			anim.loop_mode = Animation.LOOP_LINEAR if params.get("loop", false) else Animation.LOOP_NONE
			node.add_animation(anim_name, anim)
			_send_ok(req_id, {"created": true})

		# ── TileMap ──────────────────────────────────────────────────────────
		"tilemap.get_layers":
			var node = _resolve_node(params.get("nodePath", ""))
			if not node or not node is TileMap:
				_send_error(req_id, "TileMap not found")
				return
			var layers = []
			for i in range(node.get_layers_count()):
				layers.append({"index": i, "name": node.get_layer_name(i), "enabled": node.is_layer_enabled(i), "layerMask": node.get_layer_physics_collision_mask(i)})
			_send_ok(req_id, {"layers": layers})

		"tilemap.validate":
			var node = _resolve_node(params.get("nodePath", ""))
			if not node or not node is TileMap:
				_send_error(req_id, {"valid": false, "issues": ["TileMap not found"]})
				return
			var issues = []
			if not node.tile_set:
				issues.append("TileMap has no TileSet assigned.")
			_send_ok(req_id, {"valid": issues.is_empty(), "issues": issues})

		# ── Physics ──────────────────────────────────────────────────────────
		"physics.get_configuration":
			_send_ok(req_id, {
				"gravity": ProjectSettings.get_setting("physics/2d/default_gravity", 980),
				"gravityVector": str(ProjectSettings.get_setting("physics/2d/default_gravity_vector", Vector2(0, 1))),
				"physicsEngine": ProjectSettings.get_setting("physics/common/physics_engine", "DEFAULT"),
			})

		"physics.validate_collisions":
			var root = _resolve_node(params.get("nodePath", "/root"))
			var issues = []
			_check_collision_layers(root, issues)
			_send_ok(req_id, {"valid": issues.is_empty(), "issues": issues})

		# ── Camera ──────────────────────────────────────────────────────────
		"camera.get_state":
			var node = _resolve_node(params.get("nodePath", ""))
			if not node or not (node is Camera2D or node is Camera3D):
				_send_error(req_id, "Camera not found")
				return
			_send_ok(req_id, {"position": _serialize_value(node.global_position), "enabled": node.is_current() if node.has_method("is_current") else true})

		"camera.validate":
			var node = _resolve_node(params.get("nodePath", ""))
			var issues = []
			if not node:
				issues.append("Camera node not found")
			elif not (node is Camera2D or node is Camera3D):
				issues.append("Node is not a Camera2D or Camera3D")
			_send_ok(req_id, {"valid": issues.is_empty(), "issues": issues})

		_:
			_send_error(req_id, "Unknown method: " + method)

# ─── Helpers ──────────────────────────────────────────────────────────────────
func _resolve_node(path: String) -> Node:
	if path.is_empty() or path == "/":
		return get_tree().edited_scene_root
	# Try edited scene root first, then global tree
	var root = get_tree().edited_scene_root
	if root:
		var n = root.get_node_or_null(path)
		if n:
			return n
	return get_tree().root.get_node_or_null(path)

func _serialize_node(node: Node, depth: int, max_depth: int) -> Dictionary:
	if not node:
		return {}
	var result = {
		"name": node.name,
		"type": node.get_class(),
		"path": str(node.get_path()),
		"hasScript": node.get_script() != null,
		"children": []
	}
	if depth < max_depth:
		for child in node.get_children():
			result["children"].append(_serialize_node(child, depth + 1, max_depth))
	return result

func _serialize_value(val) -> Variant:
	if typeof(val) == TYPE_VECTOR2:
		return {"x": val.x, "y": val.y}
	elif typeof(val) == TYPE_VECTOR3:
		return {"x": val.x, "y": val.y, "z": val.z}
	elif typeof(val) == TYPE_COLOR:
		return {"r": val.r, "g": val.g, "b": val.b, "a": val.a}
	elif typeof(val) == TYPE_RECT2:
		return {"x": val.position.x, "y": val.position.y, "w": val.size.x, "h": val.size.y}
	elif typeof(val) == TYPE_OBJECT:
		if val == null:
			return null
		return {"type": val.get_class(), "resourcePath": val.resource_path if val.has_method("get_resource_path") else ""}
	return val

func _check_collision_layers(node: Node, issues: Array) -> void:
	if not node:
		return
	if node is CharacterBody2D or node is RigidBody2D or node is StaticBody2D:
		if node.collision_layer == 0 and node.collision_mask == 0:
			issues.append("Node '%s' has no collision layer or mask set." % str(node.get_path()))
	for child in node.get_children():
		_check_collision_layers(child, issues)

func _send_ok(req_id: String, result: Dictionary) -> void:
	_send_response(req_id, true, result)

func _send_error(req_id: String, error) -> void:
	if typeof(error) == TYPE_STRING:
		_send_response(req_id, false, {"error": error})
	else:
		_send_response(req_id, false, error)

func _send_response(req_id: String, ok: bool, result: Dictionary) -> void:
	if not _peer or _peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
		return
	var resp = JSON.stringify({
		"protocolVersion": PROTOCOL_VERSION,
		"requestId": req_id,
		"ok": ok,
		"result": result
	}) + "\n"
	_peer.put_data(resp.to_utf8_buffer())
