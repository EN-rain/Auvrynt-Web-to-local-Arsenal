local C = require("live_common")
local M = {}

local function render_frame(sprite, frame_number, composite, layer_name)
  if frame_number < 1 or frame_number > #sprite.frames then C.fail("Frame is outside the sprite") end
  local image = Image(sprite.spec)
  image:clear()
  if composite ~= false then
    image:drawSprite(sprite, frame_number, Point(0, 0))
  else
    local layer = C.find_layer(sprite.layers, layer_name) or app.activeLayer
    if not layer or layer.isGroup or layer.isTilemap then C.fail("A normal drawable layer is required") end
    local cel = layer:cel(frame_number)
    if cel then image:drawImage(cel.image, cel.position) end
  end
  return image
end

local function image_bounds(sprite, image)
  local min_x, min_y, max_x, max_y = sprite.width, sprite.height, -1, -1
  local count = 0
  for y=0,sprite.height-1 do
    for x=0,sprite.width-1 do
      if C.pixel_alpha(sprite, image:getPixel(x, y)) > 0 then
        count = count + 1
        if x < min_x then min_x = x end
        if y < min_y then min_y = y end
        if x > max_x then max_x = x end
        if y > max_y then max_y = y end
      end
    end
  end
  if count == 0 then return { empty=true, pixels=0 } end
  return {
    empty=false,
    pixels=count,
    x=min_x,
    y=min_y,
    width=max_x-min_x+1,
    height=max_y-min_y+1,
    centerX=(min_x+max_x)/2,
    centerY=(min_y+max_y)/2,
  }
end

local function get_sprite_bounds(sprite, params)
  local frame = C.target_frame_number(sprite, params)
  local image = render_frame(sprite, frame, params.composite ~= false, params.layer)
  local bounds = image_bounds(sprite, image)
  bounds.frame = frame
  bounds.composite = params.composite ~= false
  return bounds
end

local function get_color_stats(sprite, params)
  local frame = C.target_frame_number(sprite, params)
  local image = render_frame(sprite, frame, params.composite ~= false, params.layer)
  local counts, opaque, transparent, semitransparent = {}, 0, 0, 0
  for y=0,sprite.height-1 do
    for x=0,sprite.width-1 do
      local color = C.pixel_to_color(sprite, image:getPixel(x, y))
      if color.alpha == 0 then
        transparent = transparent + 1
      else
        opaque = opaque + 1
        if color.alpha < 255 then semitransparent = semitransparent + 1 end
        local hex = C.color_to_hex(color)
        counts[hex] = (counts[hex] or 0) + 1
      end
    end
  end
  local colors = {}
  for color, count in pairs(counts) do colors[#colors+1] = { color=color, count=count } end
  table.sort(colors, function(a, b)
    if a.count == b.count then return a.color < b.color end
    return a.count > b.count
  end)
  local limit = C.clamp(C.integer(params.limit, 256), 1, 256)
  while #colors > limit do table.remove(colors) end
  local unique = 0
  for _ in pairs(counts) do unique = unique + 1 end
  return {
    frame=frame,
    uniqueColors=unique,
    opaquePixels=opaque,
    transparentPixels=transparent,
    semitransparentPixels=semitransparent,
    colors=colors,
  }
end

local function compare_frames(sprite, params)
  local first = C.clamp(C.integer(params.frameA, 1), 1, #sprite.frames)
  local second = C.clamp(C.integer(params.frameB, math.min(2, #sprite.frames)), 1, #sprite.frames)
  local image_a = render_frame(sprite, first, params.composite ~= false, params.layer)
  local image_b = render_frame(sprite, second, params.composite ~= false, params.layer)
  local changed, min_x, min_y, max_x, max_y = 0, sprite.width, sprite.height, -1, -1
  for y=0,sprite.height-1 do
    for x=0,sprite.width-1 do
      if image_a:getPixel(x, y) ~= image_b:getPixel(x, y) then
        changed = changed + 1
        if x < min_x then min_x = x end
        if y < min_y then min_y = y end
        if x > max_x then max_x = x end
        if y > max_y then max_y = y end
      end
    end
  end
  local total = sprite.width * sprite.height
  return {
    frameA=first,
    frameB=second,
    exact=changed == 0,
    changedPixels=changed,
    matchPercent=total == 0 and 100 or ((total-changed)/total)*100,
    differenceBounds=changed == 0 and nil or { x=min_x, y=min_y, width=max_x-min_x+1, height=max_y-min_y+1 },
  }
end

local function find_tag(sprite, name)
  if name == nil then return nil end
  for _, tag in ipairs(sprite.tags) do if tag.name == name then return tag end end
  return nil
end

local function validate_animation(sprite, params)
  local tag = find_tag(sprite, params.tag)
  if params.tag and not tag then C.fail("Tag was not found") end
  local from = tag and tag.fromFrame.frameNumber or C.clamp(C.integer(params.from, 1), 1, #sprite.frames)
  local to = tag and tag.toFrame.frameNumber or C.clamp(C.integer(params.to, #sprite.frames), from, #sprite.frames)
  local frames, issues = {}, {}
  local previous_image = nil
  local previous_bounds = nil
  for frame=from,to do
    local image = render_frame(sprite, frame, true)
    local bounds = image_bounds(sprite, image)
    local duration = math.floor(sprite.frames[frame].duration * 1000 + 0.5)
    local duplicate = false
    if previous_image then
      duplicate = true
      for y=0,sprite.height-1 do
        for x=0,sprite.width-1 do
          if image:getPixel(x, y) ~= previous_image:getPixel(x, y) then duplicate = false break end
        end
        if not duplicate then break end
      end
    end
    local movement = nil
    if previous_bounds and not previous_bounds.empty and not bounds.empty then
      movement = {
        dx=bounds.centerX-previous_bounds.centerX,
        dy=bounds.centerY-previous_bounds.centerY,
      }
    end
    frames[#frames+1] = { frame=frame, durationMs=duration, bounds=bounds, duplicatePrevious=duplicate, movement=movement }
    if bounds.empty then issues[#issues+1] = { frame=frame, type="empty_frame" } end
    if duplicate then issues[#issues+1] = { frame=frame, type="duplicate_previous" } end
    if duration < 16 or duration > 2000 then issues[#issues+1] = { frame=frame, type="duration_outlier", durationMs=duration } end
    previous_image, previous_bounds = image, bounds
  end
  local loop = compare_frames(sprite, { frameA=from, frameB=to, composite=true })
  return {
    tag=tag and tag.name or nil,
    from=from,
    to=to,
    frameCount=to-from+1,
    frames=frames,
    issues=issues,
    loopEndpointDifference=loop,
    valid=#issues == 0,
  }
end

M.handlers = {
  get_sprite_bounds=get_sprite_bounds,
  get_color_stats=get_color_stats,
  compare_frames=compare_frames,
  validate_animation=validate_animation,
}

return M
