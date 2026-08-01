local M = {}
local pc = app.pixelColor

function M.fail(message) error(message, 0) end
function M.clamp(value, minimum, maximum) return math.max(minimum, math.min(maximum, value)) end
function M.integer(value, fallback) return math.floor(tonumber(value) or fallback or 0) end
function M.sequence_length(value)
  if value == nil then return nil end
  local ok, count = pcall(function() return #value end)
  return ok and count or nil
end

function M.color_from_hex(value, fallback)
  if type(value) ~= "string" then return fallback or Color() end
  local hex = value:gsub("^#", "")
  if #hex ~= 6 and #hex ~= 8 then M.fail("Colors must use #RRGGBB or #RRGGBBAA") end
  local r, g, b = tonumber(hex:sub(1, 2), 16), tonumber(hex:sub(3, 4), 16), tonumber(hex:sub(5, 6), 16)
  local a = #hex == 8 and tonumber(hex:sub(7, 8), 16) or 255
  if not r or not g or not b or not a then M.fail("Invalid hexadecimal color") end
  return Color { r=r, g=g, b=b, a=a }
end

function M.color_to_hex(color)
  return string.format("#%02X%02X%02X%02X", color.red, color.green, color.blue, color.alpha)
end

function M.pixel_to_color(sprite, pixel)
  if sprite.colorMode == ColorMode.RGB then
    return Color { r=pc.rgbaR(pixel), g=pc.rgbaG(pixel), b=pc.rgbaB(pixel), a=pc.rgbaA(pixel) }
  elseif sprite.colorMode == ColorMode.GRAY then
    local value = pc.grayaV(pixel)
    return Color { r=value, g=value, b=value, a=pc.grayaA(pixel) }
  end
  local palette = sprite.palettes[1]
  local color = palette:getColor(pixel)
  return Color { r=color.red, g=color.green, b=color.blue, a=pixel == sprite.transparentColor and 0 or color.alpha }
end

function M.color_to_pixel(sprite, color)
  if sprite.colorMode == ColorMode.RGB then return pc.rgba(color.red, color.green, color.blue, color.alpha) end
  if sprite.colorMode == ColorMode.GRAY then
    local gray = math.floor((color.red*299 + color.green*587 + color.blue*114)/1000)
    return pc.graya(gray, color.alpha)
  end
  if color.alpha == 0 then return sprite.transparentColor end
  local palette, best, distance = sprite.palettes[1], 0, math.huge
  for index=0,#palette-1 do
    local candidate = palette:getColor(index)
    local dr, dg, db, da = candidate.red-color.red, candidate.green-color.green, candidate.blue-color.blue, candidate.alpha-color.alpha
    local current = dr*dr + dg*dg + db*db + da*da
    if current < distance then best, distance = index, current end
  end
  return best
end

function M.pixel_alpha(sprite, pixel)
  if sprite.colorMode == ColorMode.RGB then return pc.rgbaA(pixel) end
  if sprite.colorMode == ColorMode.GRAY then return pc.grayaA(pixel) end
  if pixel == sprite.transparentColor then return 0 end
  return sprite.palettes[1]:getColor(pixel).alpha
end

function M.find_layer(items, name_or_id)
  if name_or_id == nil then return nil end
  for _, layer in ipairs(items) do
    if layer.name == name_or_id or tostring(layer.id) == tostring(name_or_id) then return layer end
    if layer.isGroup then
      local nested = M.find_layer(layer.layers, name_or_id)
      if nested then return nested end
    end
  end
  return nil
end

function M.target_layer(sprite, params)
  local layer = params.layer and M.find_layer(sprite.layers, params.layer) or app.activeLayer or sprite.layers[1]
  if not layer then M.fail("Layer was not found") end
  if layer.isGroup or layer.isTilemap then M.fail("A normal drawable layer is required") end
  return layer
end

function M.target_frame_number(sprite, params)
  local number = M.integer(params.frame, app.activeFrame and app.activeFrame.frameNumber or 1)
  if number < 1 or number > #sprite.frames then M.fail("Frame is outside the sprite") end
  return number
end

function M.get_canvas_cel(sprite, layer, frame_number, create)
  local cel = layer:cel(frame_number)
  if not cel and create then
    local image = Image(sprite.spec)
    image:clear()
    cel = sprite:newCel(layer, frame_number, image, Point(0, 0))
  end
  if cel and create and (cel.position.x ~= 0 or cel.position.y ~= 0 or cel.image.width ~= sprite.width or cel.image.height ~= sprite.height) then
    local image = Image(sprite.spec)
    image:clear()
    image:drawImage(cel.image, cel.position)
    cel.image = image
    cel.position = Point(0, 0)
  end
  return cel
end

function M.selection_allows(sprite, x, y)
  local selection = sprite.selection
  return selection == nil or selection.isEmpty or selection:contains(Point(x, y))
end

function M.active_target(sprite, params)
  local layer, frame_number = M.target_layer(sprite, params), M.target_frame_number(sprite, params)
  app.activeSprite, app.activeLayer, app.activeFrame = sprite, layer, sprite.frames[frame_number]
  return layer, frame_number
end

function M.read_canvas(sprite, params)
  local frame_number = M.target_frame_number(sprite, params)
  local image = Image(sprite.spec)
  image:clear()
  if params.composite == true then
    image:drawSprite(sprite, frame_number, Point(0, 0))
  else
    local layer = M.target_layer(sprite, params)
    local cel = layer:cel(frame_number)
    if cel then image:drawImage(cel.image, cel.position) end
  end
  return image, frame_number
end

return M
