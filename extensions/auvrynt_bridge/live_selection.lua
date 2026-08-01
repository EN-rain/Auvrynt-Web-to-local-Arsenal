local C = require("live_common")
local M = {}

local function apply_mask(sprite, mask, mode)
  local selection = sprite.selection
  mode = mode or "replace"
  if mode == "replace" then selection:select(mask)
  elseif mode == "add" then selection:add(mask)
  elseif mode == "subtract" then selection:subtract(mask)
  elseif mode == "intersect" then selection:intersect(mask)
  else C.fail("Unsupported selection mode") end
end

local function selection_result(sprite)
  local selection = sprite.selection
  if not selection or selection.isEmpty then return { empty=true } end
  local bounds = selection.bounds
  return {
    empty=false,
    x=bounds.x,
    y=bounds.y,
    width=bounds.width,
    height=bounds.height,
  }
end

local function get_selection(sprite, _)
  return selection_result(sprite)
end

local function select_all(sprite, _)
  sprite.selection:selectAll()
  return selection_result(sprite)
end

local function deselect(sprite, _)
  sprite.selection:deselect()
  return { empty=true }
end

local function invert_selection(sprite, _)
  local inverted = Selection(Rectangle(0, 0, sprite.width, sprite.height))
  if not sprite.selection.isEmpty then inverted:subtract(sprite.selection) end
  sprite.selection:select(inverted)
  return selection_result(sprite)
end

local function select_ellipse(sprite, params)
  local x = C.integer(params.x, 0)
  local y = C.integer(params.y, 0)
  local width = C.integer(params.width, 1)
  local height = C.integer(params.height, 1)
  if width < 1 or height < 1 then C.fail("width and height must be positive") end
  local mask = Selection()
  local rx, ry = width / 2, height / 2
  local cx = x + (width - 1) / 2
  local cy = y + (height - 1) / 2
  for row=0,height-1 do
    local dy = ((y + row) - cy) / ry
    local inside = 1 - dy * dy
    if inside >= 0 then
      local half = math.floor(rx * math.sqrt(inside))
      local left = math.max(0, math.floor(cx - half))
      local right = math.min(sprite.width - 1, math.ceil(cx + half))
      local yy = y + row
      if yy >= 0 and yy < sprite.height and right >= left then
        mask:add(Rectangle(left, yy, right - left + 1, 1))
      end
    end
  end
  apply_mask(sprite, mask, params.mode)
  return selection_result(sprite)
end

local function select_by_color(sprite, params)
  if type(params.color) ~= "string" then C.fail("color is required") end
  if sprite.width * sprite.height > 1048576 then C.fail("Color selection is limited to 1,048,576 canvas pixels") end
  local image = C.read_canvas(sprite, params)
  local target = C.color_to_pixel(sprite, C.color_from_hex(params.color))
  local mask = Selection()
  local matched = 0
  for y=0,sprite.height-1 do
    local run_start = nil
    for x=0,sprite.width do
      local equal = x < sprite.width and image:getPixel(x, y) == target
      if equal and run_start == nil then run_start = x end
      if not equal and run_start ~= nil then
        mask:add(Rectangle(run_start, y, x - run_start, 1))
        matched = matched + (x - run_start)
        run_start = nil
      end
    end
  end
  apply_mask(sprite, mask, params.mode)
  local result = selection_result(sprite)
  result.matched = matched
  result.composite = params.composite == true
  return result
end

M.handlers = {
  get_selection=get_selection,
  select_all=select_all,
  deselect=deselect,
  invert_selection=invert_selection,
  select_ellipse=select_ellipse,
  select_by_color=select_by_color,
}

return M
