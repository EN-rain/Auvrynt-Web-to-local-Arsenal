local C = require("live_common")
local M = {}

local function set_frame_range_duration(sprite, params)
  local from = C.clamp(C.integer(params.from, 1), 1, #sprite.frames)
  local to = C.clamp(C.integer(params.to, from), from, #sprite.frames)
  local duration_ms = C.clamp(C.integer(params.durationMs, 100), 1, 60000)
  app.transaction("Auvrynt Live Frame Durations", function()
    for frame=from,to do sprite.frames[frame].duration = duration_ms / 1000 end
  end)
  return { from=from, to=to, durationMs=duration_ms }
end

local function duplicate_frame(sprite, params)
  local source = C.target_frame_number(sprite, params)
  local created
  app.transaction("Auvrynt Live Duplicate Frame", function()
    sprite:newFrame(source)
    created = sprite.frames[source + 1]
    if params.durationMs ~= nil then created.duration = C.clamp(C.integer(params.durationMs, 100), 1, 60000) / 1000 end
  end)
  app.activeFrame = created
  return { source=source, frame=created.frameNumber, durationMs=math.floor(created.duration * 1000 + 0.5) }
end

local function reverse_frames(sprite, params)
  local from = C.clamp(C.integer(params.from, 1), 1, #sprite.frames)
  local to = C.clamp(C.integer(params.to, #sprite.frames), from, #sprite.frames)
  local frames = {}
  for frame=from,to do frames[#frames+1] = sprite.frames[frame] end
  app.activeSprite = sprite
  app.range.frames = frames
  app.command.ReverseFrames()
  return { from=from, to=to, count=to-from+1 }
end

local function shift_cel(sprite, params)
  local layer, frame_number = C.active_target(sprite, params)
  local dx, dy = C.integer(params.dx, 0), C.integer(params.dy, 0)
  local cel = layer:cel(frame_number)
  if not cel then C.fail("Cel does not exist") end
  app.transaction("Auvrynt Live Shift Cel", function()
    if params.wrap == true then
      cel = C.get_canvas_cel(sprite, layer, frame_number, true)
      local source = Image(cel.image)
      local transparent = C.color_to_pixel(sprite, Color{r=0,g=0,b=0,a=0})
      cel.image:clear(transparent)
      for y=0,sprite.height-1 do
        for x=0,sprite.width-1 do
          local nx = (x + dx) % sprite.width
          local ny = (y + dy) % sprite.height
          cel.image:drawPixel(nx, ny, source:getPixel(x, y))
        end
      end
    else
      cel.position = Point(cel.position.x + dx, cel.position.y + dy)
    end
  end)
  return { layer=layer.name, frame=frame_number, x=cel.position.x, y=cel.position.y, dx=dx, dy=dy, wrap=params.wrap == true }
end

local function flip_sprite(sprite, params)
  local orientation = params.orientation == "vertical" and "vertical" or "horizontal"
  app.activeSprite = sprite
  app.command.Flip { orientation=orientation }
  return { orientation=orientation, width=sprite.width, height=sprite.height }
end

local function rotate_sprite(sprite, params)
  local angle = C.integer(params.angle, 90)
  if angle ~= 90 and angle ~= 180 and angle ~= 270 and angle ~= -90 then C.fail("angle must be 90, 180, 270, or -90") end
  app.activeSprite = sprite
  app.command.Rotate { angle=angle, ui=false }
  return { angle=angle, width=sprite.width, height=sprite.height }
end

local function resolve_open_sprite(params, prefix)
  local id = params[prefix .. "Id"]
  local filename = params[prefix .. "Filename"]
  for _, sprite in ipairs(app.sprites) do
    if id ~= nil and tostring(sprite.id) == tostring(id) then return sprite end
    if filename ~= nil and sprite.filename == filename then return sprite end
  end
  C.fail(prefix .. " sprite was not found among open documents")
end

local function copy_between_sprites(_, params)
  local source = resolve_open_sprite(params, "source")
  local target = resolve_open_sprite(params, "target")
  local source_layer = C.find_layer(source.layers, params.sourceLayer)
  if not source_layer or source_layer.isGroup or source_layer.isTilemap then C.fail("Source drawable layer was not found") end
  local source_frame = C.clamp(C.integer(params.sourceFrame, 1), 1, #source.frames)
  local source_cel = source_layer:cel(source_frame)
  if not source_cel then C.fail("Source cel does not exist") end
  local target_layer = params.targetLayer and C.find_layer(target.layers, params.targetLayer) or nil
  if not target_layer then
    target_layer = target:newLayer()
    target_layer.name = tostring(params.targetLayer or source_layer.name)
  end
  if target_layer.isGroup or target_layer.isTilemap then C.fail("Target must be a normal drawable layer") end
  local target_frame = C.clamp(C.integer(params.targetFrame, 1), 1, #target.frames)
  local created
  app.transaction("Auvrynt Live Copy Between Sprites", function()
    local existing = target_layer:cel(target_frame)
    if existing then target:deleteCel(existing) end
    created = target:newCel(
      target_layer,
      target_frame,
      source_cel.image,
      Point(source_cel.position.x + C.integer(params.offsetX, 0), source_cel.position.y + C.integer(params.offsetY, 0))
    )
    created.opacity = source_cel.opacity
    created.zIndex = source_cel.zIndex
  end)
  app.activeSprite, app.activeLayer, app.activeFrame = target, target_layer, target.frames[target_frame]
  return {
    sourceId=tostring(source.id), targetId=tostring(target.id),
    sourceLayer=source_layer.name, targetLayer=target_layer.name,
    sourceFrame=source_frame, targetFrame=target_frame,
    x=created.position.x, y=created.position.y,
  }
end

M.handlers = {
  set_frame_range_duration=set_frame_range_duration,
  duplicate_frame=duplicate_frame,
  reverse_frames=reverse_frames,
  shift_cel=shift_cel,
  flip_sprite=flip_sprite,
  rotate_sprite=rotate_sprite,
  copy_between_sprites=copy_between_sprites,
}

return M
