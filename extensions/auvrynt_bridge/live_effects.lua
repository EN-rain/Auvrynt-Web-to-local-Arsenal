local C = require("live_common")
local M = {}

local function draw_symmetry(sprite, params)
  local count = C.sequence_length(params.points)
  if not count or count < 1 or count > 8192 then C.fail("points must contain 1-8192 entries") end
  if type(params.color) ~= "string" then C.fail("color is required") end
  local layer, frame_number = C.active_target(sprite, params)
  local pixel = C.color_to_pixel(sprite, C.color_from_hex(params.color))
  local axis_x = tonumber(params.axisX) or ((sprite.width - 1) / 2)
  local axis_y = tonumber(params.axisY) or ((sprite.height - 1) / 2)
  local mirror_x = params.horizontal ~= false
  local mirror_y = params.vertical == true
  local coordinates, unique = {}, {}
  local function add(x, y)
    x, y = C.integer(x, -1), C.integer(y, -1)
    if x < 0 or y < 0 or x >= sprite.width or y >= sprite.height then return end
    local key = x .. ":" .. y
    if unique[key] then return end
    unique[key] = true
    coordinates[#coordinates+1] = {x=x,y=y}
  end
  for index=1,count do
    local point = params.points[index]
    local x, y = C.integer(point.x, -1), C.integer(point.y, -1)
    add(x, y)
    if mirror_x then add(math.floor(2*axis_x-x+0.5), y) end
    if mirror_y then add(x, math.floor(2*axis_y-y+0.5)) end
    if mirror_x and mirror_y then add(math.floor(2*axis_x-x+0.5), math.floor(2*axis_y-y+0.5)) end
  end
  local written = 0
  app.transaction("Auvrynt Live Symmetry", function()
    local cel = C.get_canvas_cel(sprite, layer, frame_number, true)
    for _, point in ipairs(coordinates) do
      if C.selection_allows(sprite, point.x, point.y) then
        cel.image:drawPixel(point.x, point.y, pixel)
        written = written + 1
      end
    end
  end)
  return { written=written, layer=layer.name, frame=frame_number, axisX=axis_x, axisY=axis_y, horizontal=mirror_x, vertical=mirror_y }
end

local BAYER = {
  [2]={0,2,3,1},
  [4]={0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5},
  [8]={
    0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,
    12,44,4,36,14,46,6,38,60,28,52,20,62,30,54,22,
    3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,
    15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21,
  },
}

local function apply_dither(sprite, params)
  if type(params.colorA) ~= "string" or type(params.colorB) ~= "string" then C.fail("colorA and colorB are required") end
  local matrix_size = C.integer(params.matrixSize, 4)
  if not BAYER[matrix_size] then C.fail("matrixSize must be 2, 4, or 8") end
  local amount = C.clamp(tonumber(params.amount) or 0.5, 0, 1)
  local region = params.region or {}
  local x = C.clamp(C.integer(region.x, 0), 0, sprite.width-1)
  local y = C.clamp(C.integer(region.y, 0), 0, sprite.height-1)
  local width = C.clamp(C.integer(region.width, sprite.width-x), 1, sprite.width-x)
  local height = C.clamp(C.integer(region.height, sprite.height-y), 1, sprite.height-y)
  local layer, frame_number = C.active_target(sprite, params)
  local a = C.color_to_pixel(sprite, C.color_from_hex(params.colorA))
  local b = C.color_to_pixel(sprite, C.color_from_hex(params.colorB))
  local matrix = BAYER[matrix_size]
  local changed = 0
  app.transaction("Auvrynt Live Ordered Dither", function()
    local cel = C.get_canvas_cel(sprite, layer, frame_number, true)
    for yy=y,y+height-1 do
      for xx=x,x+width-1 do
        if C.selection_allows(sprite, xx, yy) then
          local index = (yy % matrix_size) * matrix_size + (xx % matrix_size) + 1
          local threshold = (matrix[index] + 0.5) / (matrix_size * matrix_size)
          cel.image:drawPixel(xx, yy, threshold < amount and b or a)
          changed = changed + 1
        end
      end
    end
  end)
  return { changed=changed, matrixSize=matrix_size, amount=amount, region={x=x,y=y,width=width,height=height}, layer=layer.name, frame=frame_number }
end

M.handlers = {
  draw_symmetry=draw_symmetry,
  apply_dither=apply_dither,
}

return M
