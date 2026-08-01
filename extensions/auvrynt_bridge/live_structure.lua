local C = require("live_common")
local M = {}

local BLEND_MODES = {
  normal=BlendMode.NORMAL, multiply=BlendMode.MULTIPLY, screen=BlendMode.SCREEN,
  overlay=BlendMode.OVERLAY, darken=BlendMode.DARKEN, lighten=BlendMode.LIGHTEN,
  addition=BlendMode.ADDITION, subtract=BlendMode.SUBTRACT, divide=BlendMode.DIVIDE,
}

local function target_any_layer(sprite, params)
  local layer = params.layer and C.find_layer(sprite.layers, params.layer) or app.activeLayer
  if not layer then C.fail("Layer was not found") end
  return layer
end

local function set_layer_properties(sprite, params)
  local layer = target_any_layer(sprite, params)
  app.transaction("Auvrynt Live Layer Properties", function()
    if params.name ~= nil then layer.name = tostring(params.name) end
    if params.visible ~= nil then layer.isVisible = params.visible == true end
    if params.editable ~= nil then layer.isEditable = params.editable == true end
    if params.opacity ~= nil then layer.opacity = C.clamp(C.integer(params.opacity, layer.opacity), 0, 255) end
    if params.blendMode ~= nil then
      local mode = BLEND_MODES[tostring(params.blendMode)]
      if not mode then C.fail("Unsupported blend mode") end
      layer.blendMode = mode
    end
  end)
  return { id=tostring(layer.id), name=layer.name, visible=layer.isVisible, editable=layer.isEditable, opacity=layer.opacity, blendMode=tostring(layer.blendMode) }
end

local function reorder_layer(sprite, params)
  local layer = target_any_layer(sprite, params)
  local siblings = layer.parent and layer.parent.layers or sprite.layers
  local index = C.clamp(C.integer(params.stackIndex, layer.stackIndex), 1, #siblings)
  app.transaction("Auvrynt Live Reorder Layer", function() layer.stackIndex = index end)
  return { id=tostring(layer.id), name=layer.name, stackIndex=layer.stackIndex }
end

local function get_cel(sprite, params)
  local layer = C.target_layer(sprite, params)
  local frame_number = C.target_frame_number(sprite, params)
  local cel = layer:cel(frame_number)
  if not cel then return { exists=false, layer=layer.name, frame=frame_number } end
  return { exists=true, layer=layer.name, frame=frame_number, x=cel.position.x, y=cel.position.y, width=cel.image.width, height=cel.image.height, opacity=cel.opacity, zIndex=cel.zIndex }
end

local function set_cel(sprite, params)
  local layer = C.target_layer(sprite, params)
  local frame_number = C.target_frame_number(sprite, params)
  local cel = layer:cel(frame_number)
  if not cel and params.create ~= true then C.fail("Cel does not exist; set create=true") end
  app.transaction("Auvrynt Live Cel Properties", function()
    cel = cel or C.get_canvas_cel(sprite, layer, frame_number, true)
    if params.x ~= nil or params.y ~= nil then cel.position = Point(C.integer(params.x, cel.position.x), C.integer(params.y, cel.position.y)) end
    if params.opacity ~= nil then cel.opacity = C.clamp(C.integer(params.opacity, cel.opacity), 0, 255) end
    if params.zIndex ~= nil then cel.zIndex = C.integer(params.zIndex, cel.zIndex) end
  end)
  return get_cel(sprite, { layer=layer.name, frame=frame_number })
end

local function find_tag(sprite, name)
  for _, tag in ipairs(sprite.tags) do if tag.name == name then return tag end end
  return nil
end

local ANI_DIRECTIONS = {
  forward=AniDir.FORWARD, reverse=AniDir.REVERSE,
  ping_pong=AniDir.PING_PONG, ping_pong_reverse=AniDir.PING_PONG_REVERSE,
}

local function apply_tag_fields(sprite, tag, params)
  if params.name ~= nil then tag.name = tostring(params.name) end
  if params.from ~= nil or params.to ~= nil then
    local from = C.clamp(C.integer(params.from, tag.fromFrame.frameNumber), 1, #sprite.frames)
    local to = C.clamp(C.integer(params.to, tag.toFrame.frameNumber), from, #sprite.frames)
    tag.fromFrame, tag.toFrame = sprite.frames[from], sprite.frames[to]
  end
  if params.direction ~= nil then
    local direction = ANI_DIRECTIONS[tostring(params.direction)]
    if not direction then C.fail("Unsupported tag direction") end
    tag.aniDir = direction
  end
  if params.repeats ~= nil then tag.repeats = C.clamp(C.integer(params.repeats, 0), 0, 65535) end
  if params.color ~= nil then tag.color = C.color_from_hex(params.color) end
end

local function tag_result(tag)
  return { name=tag.name, from=tag.fromFrame.frameNumber, to=tag.toFrame.frameNumber, direction=tostring(tag.aniDir), repeats=tag.repeats, color=C.color_to_hex(tag.color) }
end

local function create_tag(sprite, params)
  local from = C.clamp(C.integer(params.from, 1), 1, #sprite.frames)
  local to = C.clamp(C.integer(params.to, from), from, #sprite.frames)
  local tag
  app.transaction("Auvrynt Live Create Tag", function()
    tag = sprite:newTag(from, to)
    tag.name = tostring(params.name or "tag")
    apply_tag_fields(sprite, tag, params)
  end)
  return tag_result(tag)
end

local function update_tag(sprite, params)
  local tag = find_tag(sprite, tostring(params.tag or params.name or ""))
  if not tag then C.fail("Tag was not found") end
  app.transaction("Auvrynt Live Update Tag", function() apply_tag_fields(sprite, tag, params) end)
  return tag_result(tag)
end

local function delete_tag(sprite, params)
  local tag = find_tag(sprite, tostring(params.tag or params.name or ""))
  if not tag then C.fail("Tag was not found") end
  local name = tag.name
  app.transaction("Auvrynt Live Delete Tag", function() sprite:deleteTag(tag) end)
  return { deleted=name }
end

M.handlers = {
  set_layer_properties=set_layer_properties,
  reorder_layer=reorder_layer,
  get_cel=get_cel,
  set_cel=set_cel,
  create_tag=create_tag,
  update_tag=update_tag,
  delete_tag=delete_tag,
}

return M
