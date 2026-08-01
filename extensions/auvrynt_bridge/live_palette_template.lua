local C = require("live_common")
local M = {}

local function get_palette(sprite, _)
  local palette = sprite.palettes[1]
  local colors = {}
  for index=0,#palette-1 do
    local color = palette:getColor(index)
    local alpha = index == sprite.transparentColor and 0 or color.alpha
    colors[index+1] = C.color_to_hex(Color{r=color.red,g=color.green,b=color.blue,a=alpha})
  end
  return { size=#palette, transparentIndex=sprite.transparentColor, colors=colors }
end

local function set_palette_color(sprite, params)
  if type(params.color) ~= "string" then C.fail("color is required") end
  local palette = sprite.palettes[1]
  local index = C.integer(params.index, -1)
  if index < 0 or index > 255 then C.fail("Palette index must be between 0 and 255") end
  app.transaction("Auvrynt Live Palette Entry", function()
    if index >= #palette then palette:resize(index + 1) end
    palette:setColor(index, C.color_from_hex(params.color))
  end)
  return { index=index, color=C.color_to_hex(palette:getColor(index)), size=#palette }
end

local function set_palette(sprite, params)
  local count = C.sequence_length(params.colors)
  if not count or count < 1 or count > 256 then C.fail("colors must contain 1-256 entries") end
  local palette = sprite.palettes[1]
  app.transaction("Auvrynt Live Set Palette", function()
    palette:resize(count)
    for index=1,count do palette:setColor(index - 1, C.color_from_hex(params.colors[index])) end
  end)
  return get_palette(sprite, {})
end

local function generate_color_ramp(sprite, params)
  if type(params.startColor) ~= "string" or type(params.endColor) ~= "string" then C.fail("startColor and endColor are required") end
  local start, finish = C.color_from_hex(params.startColor), C.color_from_hex(params.endColor)
  local steps = C.clamp(C.integer(params.steps, 5), 2, 256)
  local colors = {}
  for index=0,steps-1 do
    local t = index / (steps - 1)
    colors[index+1] = C.color_to_hex(Color {
      r=math.floor(start.red + (finish.red-start.red)*t + 0.5),
      g=math.floor(start.green + (finish.green-start.green)*t + 0.5),
      b=math.floor(start.blue + (finish.blue-start.blue)*t + 0.5),
      a=math.floor(start.alpha + (finish.alpha-start.alpha)*t + 0.5),
    })
  end
  if params.apply == true then
    local palette, start_index = sprite.palettes[1], C.clamp(C.integer(params.startIndex, 0), 0, 255)
    if start_index + steps > 256 then C.fail("Color ramp exceeds the 256-entry palette limit") end
    app.transaction("Auvrynt Live Color Ramp", function()
      if #palette < start_index + steps then palette:resize(start_index + steps) end
      for index=1,steps do palette:setColor(start_index + index - 1, C.color_from_hex(colors[index])) end
    end)
  end
  return { colors=colors, steps=steps, applied=params.apply == true }
end

local function sort_palette(sprite, params)
  local palette = sprite.palettes[1]
  local sort_by = tostring(params.sortBy or "hue")
  local reverse = params.reverse == true
  local entries = {}
  for index=0,#palette-1 do
    local color = palette:getColor(index)
    entries[#entries+1] = { old=index, color=color }
  end
  local function value(entry)
    local color = entry.color
    if sort_by == "hue" then return color.hslHue
    elseif sort_by == "saturation" then return color.hslSaturation
    elseif sort_by == "lightness" or sort_by == "brightness" then return color.hslLightness
    elseif sort_by == "red" then return color.red
    elseif sort_by == "green" then return color.green
    elseif sort_by == "blue" then return color.blue
    elseif sort_by == "alpha" then return color.alpha
    else C.fail("sortBy must be hue, saturation, lightness, brightness, red, green, blue, or alpha") end
  end
  table.sort(entries, function(a, b)
    local av, bv = value(a), value(b)
    if av == bv then return a.old < b.old end
    return reverse and av > bv or av < bv
  end)
  local mapping = {}
  for new_index, entry in ipairs(entries) do mapping[entry.old] = new_index - 1 end
  local old_transparent = sprite.transparentColor
  app.transaction("Auvrynt Live Sort Palette", function()
    if sprite.colorMode == ColorMode.INDEXED then
      local seen = {}
      for _, cel in ipairs(sprite.cels) do
        if not cel.layer.isTilemap then
          local image = cel.image
          local key = tostring(image.id)
          if not seen[key] then
            seen[key] = true
            for y=0,image.height-1 do
              for x=0,image.width-1 do
                local old = image:getPixel(x, y)
                image:drawPixel(x, y, mapping[old] or old)
              end
            end
          end
        end
      end
    end
    for new_index, entry in ipairs(entries) do palette:setColor(new_index - 1, entry.color) end
    if sprite.colorMode == ColorMode.INDEXED then sprite.transparentColor = mapping[old_transparent] or old_transparent end
  end)
  local result = get_palette(sprite, {})
  result.sortBy = sort_by
  result.reverse = reverse
  return result
end

local function create_character_template(_, params)
  local width = C.clamp(C.integer(params.width, params.size or 64), 8, 512)
  local height = C.clamp(C.integer(params.height, params.size or 64), 8, 512)
  local sprite = Sprite(width, height, ColorMode.RGB)
  app.activeSprite = sprite
  local definitions = params.animations
  local count = C.sequence_length(definitions)
  if not count or count == 0 then
    definitions = {
      { name="idle", frames=4, durationMs=140 },
      { name="run", frames=8, durationMs=90 },
      { name="attack", frames=6, durationMs=80 },
    }
    count = 3
  end
  local total_frames = 0
  for index=1,count do total_frames = total_frames + C.clamp(C.integer(definitions[index].frames, 1), 1, 64) end
  app.transaction("Auvrynt Character Template", function()
    sprite.layers[1].name = "04 Body"
    local shadow = sprite:newLayer() shadow.name = "01 Shadow" shadow.stackIndex = 1 shadow.opacity = 128
    local silhouette = sprite:newLayer() silhouette.name = "02 Silhouette"
    local outfit = sprite:newLayer() outfit.name = "03 Outfit"
    local weapon = sprite:newLayer() weapon.name = "05 Weapon"
    local effects = sprite:newLayer() effects.name = "06 Effects"
    for frame=2,total_frames do sprite:newEmptyFrame(frame) end
    local offset = 1
    for index=1,count do
      local definition = definitions[index]
      local frames = C.clamp(C.integer(definition.frames, 1), 1, 64)
      local duration = C.clamp(C.integer(definition.durationMs, 100), 1, 60000) / 1000
      local tag = sprite:newTag(offset, offset + frames - 1)
      tag.name = tostring(definition.name or ("animation_" .. index))
      for frame=offset,offset+frames-1 do sprite.frames[frame].duration = duration end
      offset = offset + frames
    end
  end)
  return { id=tostring(sprite.id), width=width, height=height, frames=#sprite.frames, tags=#sprite.tags }
end

M.handlers = {
  get_palette=get_palette,
  set_palette_color=set_palette_color,
  set_palette=set_palette,
  generate_color_ramp=generate_color_ramp,
  sort_palette=sort_palette,
  create_character_template=create_character_template,
}

return M
