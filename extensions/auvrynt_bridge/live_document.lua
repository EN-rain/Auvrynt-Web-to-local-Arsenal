local C = require("live_common")
local M = {}

local function resize_sprite(sprite, params)
  local width = C.clamp(C.integer(params.width, sprite.width), 1, 8192)
  local height = C.clamp(C.integer(params.height, sprite.height), 1, 8192)
  app.activeSprite = sprite
  sprite:resize(width, height)
  return { width=sprite.width, height=sprite.height }
end

local function crop_sprite(sprite, params)
  local x = C.integer(params.x, 0)
  local y = C.integer(params.y, 0)
  local width = C.integer(params.width, sprite.width)
  local height = C.integer(params.height, sprite.height)
  if width < 1 or height < 1 then C.fail("width and height must be positive") end
  sprite:crop(Rectangle(x, y, width, height))
  return { width=sprite.width, height=sprite.height, source={x=x,y=y,width=width,height=height} }
end

local function flatten_sprite(sprite, _)
  sprite:flatten()
  app.activeLayer = sprite.layers[1]
  return { layers=#sprite.layers, activeLayer=sprite.layers[1].name }
end

local function set_grid(sprite, params)
  local x = C.integer(params.x, 0)
  local y = C.integer(params.y, 0)
  local width = C.clamp(C.integer(params.width, 8), 1, 8192)
  local height = C.clamp(C.integer(params.height, 8), 1, 8192)
  sprite.gridBounds = Rectangle(x, y, width, height)
  return { x=x, y=y, width=width, height=height }
end

local function create_tileset_template(_, params)
  local tile_size = C.clamp(C.integer(params.tileSize, 16), 1, 256)
  local columns = C.clamp(C.integer(params.columns, 8), 1, 128)
  local rows = C.clamp(C.integer(params.rows, 8), 1, 128)
  local width, height = tile_size * columns, tile_size * rows
  if width > 8192 or height > 8192 then C.fail("Tileset template exceeds Aseprite's 8192px bridge limit") end
  local sprite = Sprite(width, height, ColorMode.RGB)
  app.activeSprite = sprite
  app.transaction("Auvrynt Tileset Template", function()
    sprite.layers[1].name = "tiles"
    sprite.gridBounds = Rectangle(0, 0, tile_size, tile_size)
    local grid = sprite:newLayer()
    grid.name = "grid-guide"
    grid.opacity = C.clamp(C.integer(params.gridOpacity, 64), 0, 255)
    local image = Image(sprite.spec)
    image:clear()
    local color = C.color_to_pixel(sprite, C.color_from_hex(params.gridColor or "#FFFFFFFF"))
    for column=1,columns-1 do
      local x = column * tile_size
      for y=0,height-1 do image:drawPixel(x, y, color) end
    end
    for row=1,rows-1 do
      local y = row * tile_size
      for x=0,width-1 do image:drawPixel(x, y, color) end
    end
    sprite:newCel(grid, 1, image, Point(0, 0))
  end)
  return {
    id=tostring(sprite.id), tileSize=tile_size, columns=columns, rows=rows,
    width=width, height=height, layers={"tiles","grid-guide"},
  }
end

M.handlers = {
  resize_sprite=resize_sprite,
  crop_sprite=crop_sprite,
  flatten_sprite=flatten_sprite,
  set_grid=set_grid,
  create_tileset_template=create_tileset_template,
}

return M
