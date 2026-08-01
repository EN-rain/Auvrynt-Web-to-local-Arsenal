local C = require("live_common")
local M = {}

local function get_pixel(sprite, params)
  local x, y = C.integer(params.x, -1), C.integer(params.y, -1)
  if x < 0 or y < 0 or x >= sprite.width or y >= sprite.height then C.fail("Pixel is outside the sprite") end
  local image, frame_number = C.read_canvas(sprite, params)
  local color = C.pixel_to_color(sprite, image:getPixel(x, y))
  return { x=x, y=y, frame=frame_number, color=C.color_to_hex(color), r=color.red, g=color.green, b=color.blue, a=color.alpha }
end

local function get_image_data(sprite, params)
  local image, frame_number = C.read_canvas(sprite, params)
  local region = params.region or {}
  local x = C.clamp(C.integer(region.x, 0), 0, sprite.width - 1)
  local y = C.clamp(C.integer(region.y, 0), 0, sprite.height - 1)
  local width = C.clamp(C.integer(region.width, sprite.width - x), 1, sprite.width - x)
  local height = C.clamp(C.integer(region.height, sprite.height - y), 1, sprite.height - y)
  if width * height > 16384 then C.fail("Live image readback is limited to 16384 pixels") end
  local rows = {}
  for row=0,height-1 do
    local output = {}
    for column=0,width-1 do output[column+1] = C.color_to_hex(C.pixel_to_color(sprite, image:getPixel(x+column, y+row))) end
    rows[row+1] = output
  end
  return { frame=frame_number, x=x, y=y, width=width, height=height, composite=params.composite == true, rows=rows }
end

local function draw_tool(sprite, params, tool, point_count)
  local layer, frame_number = C.active_target(sprite, params)
  local points = { Point(C.integer(params.x, 0), C.integer(params.y, 0)) }
  if point_count == 2 then
    local x2 = params.x2 ~= nil and C.integer(params.x2, 0) or C.integer(params.x, 0) + C.integer(params.width, 1) - 1
    local y2 = params.y2 ~= nil and C.integer(params.y2, 0) or C.integer(params.y, 0) + C.integer(params.height, 1) - 1
    points[2] = Point(x2, y2)
  end
  app.transaction("Auvrynt Live " .. tool, function()
    app.useTool {
      tool=tool,
      color=C.color_from_hex(params.color, app.fgColor),
      opacity=C.clamp(C.integer(params.opacity, 255), 0, 255),
      brush=Brush(C.clamp(C.integer(params.brushSize, 1), 1, 256)),
      points=points,
      layer=layer,
      frame=sprite.frames[frame_number],
    }
  end)
  return { tool=tool, frame=frame_number, layer=layer.name }
end

local function clear_image(sprite, params)
  local layer, frame_number = C.active_target(sprite, params)
  local fill = params.color and C.color_to_pixel(sprite, C.color_from_hex(params.color)) or C.color_to_pixel(sprite, Color{r=0,g=0,b=0,a=0})
  local changed = 0
  app.transaction("Auvrynt Live Clear", function()
    local cel = C.get_canvas_cel(sprite, layer, frame_number, true)
    for y=0,sprite.height-1 do
      for x=0,sprite.width-1 do
        if C.selection_allows(sprite, x, y) then cel.image:drawPixel(x, y, fill) changed = changed + 1 end
      end
    end
  end)
  return { changed=changed, frame=frame_number, layer=layer.name }
end

local function replace_color(sprite, params)
  if type(params.fromColor) ~= "string" or type(params.toColor) ~= "string" then C.fail("fromColor and toColor are required") end
  local layer, frame_number = C.active_target(sprite, params)
  local from_pixel = C.color_to_pixel(sprite, C.color_from_hex(params.fromColor))
  local to_pixel = C.color_to_pixel(sprite, C.color_from_hex(params.toColor))
  local changed = 0
  app.transaction("Auvrynt Live Replace Color", function()
    local cel = C.get_canvas_cel(sprite, layer, frame_number, true)
    for y=0,sprite.height-1 do
      for x=0,sprite.width-1 do
        if C.selection_allows(sprite, x, y) and cel.image:getPixel(x, y) == from_pixel then
          cel.image:drawPixel(x, y, to_pixel)
          changed = changed + 1
        end
      end
    end
  end)
  return { changed=changed, frame=frame_number, layer=layer.name }
end

local function outline(sprite, params)
  if type(params.color) ~= "string" then C.fail("color is required") end
  local layer, frame_number = C.active_target(sprite, params)
  local outline_pixel = C.color_to_pixel(sprite, C.color_from_hex(params.color))
  local neighbors = params.diagonal == true
    and { {-1,-1},{0,-1},{1,-1},{-1,0},{1,0},{-1,1},{0,1},{1,1} }
    or { {0,-1},{-1,0},{1,0},{0,1} }
  local changed = 0
  app.transaction("Auvrynt Live Outline", function()
    local cel = C.get_canvas_cel(sprite, layer, frame_number, true)
    local source = Image(cel.image)
    for y=0,sprite.height-1 do
      for x=0,sprite.width-1 do
        if C.selection_allows(sprite, x, y) and C.pixel_alpha(sprite, source:getPixel(x, y)) == 0 then
          local adjacent = false
          for _, offset in ipairs(neighbors) do
            local nx, ny = x + offset[1], y + offset[2]
            if nx >= 0 and ny >= 0 and nx < sprite.width and ny < sprite.height and C.pixel_alpha(sprite, source:getPixel(nx, ny)) > 0 then adjacent = true break end
          end
          if adjacent then cel.image:drawPixel(x, y, outline_pixel) changed = changed + 1 end
        end
      end
    end
  end)
  return { changed=changed, frame=frame_number, layer=layer.name, diagonal=params.diagonal == true }
end

M.handlers = {
  get_pixel=get_pixel,
  get_image_data=get_image_data,
  draw_line=function(sprite, params) return draw_tool(sprite, params, "line", 2) end,
  draw_rect=function(sprite, params) return draw_tool(sprite, params, params.filled == false and "rectangle" or "filled_rectangle", 2) end,
  draw_ellipse=function(sprite, params) return draw_tool(sprite, params, params.filled == false and "ellipse" or "filled_ellipse", 2) end,
  flood_fill=function(sprite, params) return draw_tool(sprite, params, "paint_bucket", 1) end,
  clear_image=clear_image,
  replace_color=replace_color,
  outline=outline,
}

return M
