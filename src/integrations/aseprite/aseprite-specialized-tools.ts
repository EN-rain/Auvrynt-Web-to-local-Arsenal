import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type { ServerConfig } from "../../config.js";
import type { ToolResponse } from "../../pi-tools.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import {
  assertInteger,
  assertPositiveInteger,
  errorResponse,
  luaString,
  openSpriteScript,
  parseColor,
  resolveAsepriteExecutable,
  runLua,
  sanitizeCliOutput,
  textResponse,
  workspacePath,
} from "./aseprite-tools.js";
import { asepriteFileSafety, assertAsepriteExpectedVersion } from "./aseprite-safety-tools.js";

const execFileAsync = promisify(execFile);
const MAX_DRAW_POINTS = 16_384;
const MAX_TILE_CELLS = 65_536;
const MAX_TILE_PIXELS = 65_536;

interface MutationGuard {
  expectedVersion?: string;
  checkpoint?: boolean;
}

async function prepareMutation(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  workspaceId: string,
  filePath: string,
  guard: MutationGuard,
  label: string,
): Promise<void> {
  await assertAsepriteExpectedVersion(registry, workspaceId, filePath, guard.expectedVersion);
  if (guard.checkpoint !== false) {
    const response = await asepriteFileSafety(config, registry, {
      workspaceId,
      filePath,
      action: "checkpoint",
      expectedVersion: guard.expectedVersion,
      label,
    });
    if (response.isError) {
      const message = response.content[0]?.type === "text" ? response.content[0].text : "Checkpoint failed.";
      throw new Error(message);
    }
  }
}

function luaColor(value: string): string {
  const color = parseColor(value);
  return `{r=${color.r},g=${color.g},b=${color.b},a=${color.a}}`;
}

export async function asepriteDrawAdvanced(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    action: "ellipse" | "polygon" | "gradient" | "outline" | "flood_fill";
    layer?: string;
    frame?: number;
    color?: string;
    secondaryColor?: string;
    opacity?: number;
    points?: Array<{ x: number; y: number }>;
    bounds?: { x: number; y: number; width: number; height: number };
    fill?: boolean;
    connectivity?: 4 | 8;
    thickness?: number;
    includeDiagonal?: boolean;
    expectedVersion?: string;
    checkpoint?: boolean;
  },
): Promise<ToolResponse> {
  try {
    await prepareMutation(config, registry, input.workspaceId, input.filePath, input, `draw-${input.action}`);
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    const frame = assertPositiveInteger(input.frame ?? 1, "frame");
    const points = (input.points ?? []).map((point) => ({
      x: assertInteger(point.x, "point.x"),
      y: assertInteger(point.y, "point.y"),
    }));
    if (points.length > MAX_DRAW_POINTS) throw new Error(`A maximum of ${MAX_DRAW_POINTS} points is supported.`);
    const bounds = input.bounds ? {
      x: assertInteger(input.bounds.x, "bounds.x"),
      y: assertInteger(input.bounds.y, "bounds.y"),
      width: assertPositiveInteger(input.bounds.width, "bounds.width"),
      height: assertPositiveInteger(input.bounds.height, "bounds.height"),
    } : undefined;
    const opacity = Math.max(0, Math.min(255, assertInteger(input.opacity ?? 255, "opacity")));
    const thickness = Math.max(1, Math.min(64, assertInteger(input.thickness ?? 1, "thickness")));
    const primary = luaColor(input.color ?? "#000000FF");
    const secondary = luaColor(input.secondaryColor ?? "#FFFFFFFF");
    const pointsLua = `{${points.map((point) => `Point(${point.x},${point.y})`).join(",")}}`;
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
if ${frame}>#sprite.frames then fail("Frame is outside the sprite") end
local layer=${input.layer ? `find_layer(sprite.layers,${luaString(input.layer)})` : "sprite.layers[1]"}
if layer==nil or layer.isGroup or layer.isTilemap then fail("A normal drawable layer was not found") end
app.activeSprite=sprite app.activeLayer=layer app.activeFrame=sprite.frames[${frame}]
local cel=ensure_canvas_cel(sprite,layer,${frame})
local action=${luaString(input.action)}
local primary=Color(${primary})
local secondary=Color(${secondary})
if action=="ellipse" then
  local bounds=Rectangle(${bounds?.x ?? 0},${bounds?.y ?? 0},${bounds?.width ?? 1},${bounds?.height ?? 1})
  app.useTool{tool=${luaString(input.fill ? "filled_ellipse" : "ellipse")},color=primary,opacity=${opacity},brush=Brush{type=BrushType.CIRCLE,size=${thickness}},points={Point(bounds.x,bounds.y),Point(bounds.x+bounds.width-1,bounds.y+bounds.height-1)}}
elseif action=="polygon" then
  local points=${pointsLua}
  if #points<3 then fail("Polygon requires at least three points") end
  if ${input.fill === true ? "true" : "false"} then
    local min_y=points[1].y local max_y=points[1].y
    for _,point in ipairs(points) do if point.y<min_y then min_y=point.y end if point.y>max_y then max_y=point.y end end
    local image=cel.image local pixel=color_pixel(sprite,{r=primary.red,g=primary.green,b=primary.blue,a=primary.alpha})
    for y=min_y,max_y do
      local intersections={}
      local previous=points[#points]
      for _,current in ipairs(points) do
        if (current.y<=y and previous.y>y) or (previous.y<=y and current.y>y) then
          local x=current.x+(y-current.y)*(previous.x-current.x)/(previous.y-current.y)
          table.insert(intersections,math.floor(x+0.5))
        end
        previous=current
      end
      table.sort(intersections)
      for index=1,#intersections-1,2 do
        for x=intersections[index],intersections[index+1] do if x>=0 and y>=0 and x<sprite.width and y<sprite.height then image:drawPixel(x,y,pixel) end end
      end
    end
  end
  app.useTool{tool="polygon",color=primary,opacity=${opacity},brush=Brush{type=BrushType.CIRCLE,size=${thickness}},points=points}
elseif action=="gradient" then
  local points=${pointsLua}
  if #points~=2 then fail("Gradient requires exactly two points") end
  app.fgColor=primary app.bgColor=secondary
  app.useTool{tool="gradient",points=points,opacity=${opacity}}
elseif action=="flood_fill" then
  local points=${pointsLua}
  if #points~=1 then fail("Flood fill requires exactly one point") end
  app.preferences.tool("paint_bucket").floodfill.pixel_connectivity=${input.connectivity === 8 ? 1 : 0}
  app.useTool{tool="paint_bucket",color=primary,opacity=${opacity},points=points}
elseif action=="outline" then
  local image=cel.image
  local original=Image(image)
  local outline_pixel=color_pixel(sprite,{r=primary.red,g=primary.green,b=primary.blue,a=primary.alpha})
  local diagonal=${input.includeDiagonal === true ? "true" : "false"}
  for pass=1,${thickness} do
    local next_image=Image(image)
    for y=0,sprite.height-1 do for x=0,sprite.width-1 do
      if pixel_rgba(sprite,image:getPixel(x,y)).a==0 then
        local adjacent=false
        for dy=-1,1 do for dx=-1,1 do
          if not (dx==0 and dy==0) and (diagonal or dx==0 or dy==0) then
            local nx=x+dx local ny=y+dy
            if nx>=0 and ny>=0 and nx<sprite.width and ny<sprite.height and pixel_rgba(sprite,image:getPixel(nx,ny)).a>0 then adjacent=true end
          end
        end end
        if adjacent then next_image:drawPixel(x,y,outline_pixel) end
      end
    end end
    image=next_image
  end
  image:drawImage(original,Point(0,0))
  cel.image=image
else fail("Unsupported advanced drawing action") end
if not sprite:saveAs(${luaString(file.absolute)}) then fail("Unable to save sprite") end
emit_result({file=${luaString(file.relative)},action=action,layer=layer.name,frame=${frame}})
sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

interface TilePixel {
  x: number;
  y: number;
  color: string;
}

interface TileCell {
  x: number;
  y: number;
  tileIndex: number;
  flipX?: boolean;
  flipY?: boolean;
  diagonal?: boolean;
}

export async function asepriteManageTilemap(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    action: "inspect" | "create_layer" | "create_tileset" | "assign_tileset" | "delete_tileset" | "import_tileset" | "create_tile" | "delete_tile" | "set_tile_pixels" | "set_cells" | "set_metadata" | "export_tileset";
    layer?: string;
    frame?: number;
    name?: string;
    tilesetIndex?: number;
    tileIndex?: number;
    insertAt?: number;
    grid?: { x?: number; y?: number; tileWidth: number; tileHeight: number };
    tileCount?: number;
    sourceImagePath?: string;
    columns?: number;
    rows?: number;
    marginX?: number;
    marginY?: number;
    spacingX?: number;
    spacingY?: number;
    pixels?: TilePixel[];
    cells?: TileCell[];
    data?: string;
    color?: string;
    properties?: Record<string, string | number | boolean | null>;
    outputPath?: string;
    expectedVersion?: string;
    checkpoint?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    const frame = assertPositiveInteger(input.frame ?? 1, "frame");
    if (input.action !== "inspect" && input.action !== "export_tileset") {
      await prepareMutation(config, registry, input.workspaceId, input.filePath, input, `tilemap-${input.action}`);
    }
    if (input.action === "export_tileset") {
      if (!input.outputPath) throw new Error("outputPath is required.");
      const output = workspacePath(registry, input.workspaceId, input.outputPath);
      await mkdir(dirname(output.absolute), { recursive: true });
      const executable = await resolveAsepriteExecutable(config);
      const args = ["-b", file.absolute];
      if (input.layer) args.push("--layer", input.layer);
      args.push("--export-tileset", "--save-as", output.absolute);
      const { stdout, stderr } = await execFileAsync(executable, args, {
        cwd: registry.getWorkspace(input.workspaceId).root,
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      });
      return textResponse({ file: file.relative, output: output.relative, details: sanitizeCliOutput([stdout.trim(), stderr.trim()].filter(Boolean).join("\n")) });
    }
    const grid = input.grid ? {
      x: assertInteger(input.grid.x ?? 0, "grid.x"),
      y: assertInteger(input.grid.y ?? 0, "grid.y"),
      tileWidth: assertPositiveInteger(input.grid.tileWidth, "grid.tileWidth"),
      tileHeight: assertPositiveInteger(input.grid.tileHeight, "grid.tileHeight"),
    } : undefined;
    const pixels = input.pixels ?? [];
    if (pixels.length > MAX_TILE_PIXELS) throw new Error(`A maximum of ${MAX_TILE_PIXELS} tile pixels is supported.`);
    const pixelLua = `{${pixels.map((pixel) => {
      const color = parseColor(pixel.color);
      return `{x=${assertInteger(pixel.x, "pixel.x")},y=${assertInteger(pixel.y, "pixel.y")},color={r=${color.r},g=${color.g},b=${color.b},a=${color.a}}}`;
    }).join(",")}}`;
    const cells = input.cells ?? [];
    if (cells.length > MAX_TILE_CELLS) throw new Error(`A maximum of ${MAX_TILE_CELLS} tile cells is supported.`);
    const cellsLua = `{${cells.map((cell) => `{x=${assertInteger(cell.x, "cell.x")},y=${assertInteger(cell.y, "cell.y")},tile=${Math.max(0, assertInteger(cell.tileIndex, "cell.tileIndex"))},flip_x=${cell.flipX === true ? "true" : "false"},flip_y=${cell.flipY === true ? "true" : "false"},diagonal=${cell.diagonal === true ? "true" : "false"}}`).join(",")}}`;
    const source = input.sourceImagePath ? workspacePath(registry, input.workspaceId, input.sourceImagePath) : undefined;
    const properties = input.properties ?? {};
    const propertiesLua = `{${Object.entries(properties).map(([key, value]) => {
      const encoded = value === null ? "nil" : typeof value === "string" ? luaString(value) : String(value);
      return `[${luaString(key)}]=${encoded}`;
    }).join(",")}}`;
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
if TilesetMode==nil then fail("This Aseprite build does not support tilemaps") end
local action=${luaString(input.action)}
local function tileset_at(index)
  if index<1 or index>#sprite.tilesets then fail("Tileset index is outside the sprite") end
  return sprite.tilesets[index]
end
local function tilemap_summary()
  local sets={}
  for index,tileset in ipairs(sprite.tilesets) do
    local tiles={}
    for tile_index=0,#tileset-1 do
      local tile=tileset:tile(tile_index)
      table.insert(tiles,{index=tile_index,width=tile.image.width,height=tile.image.height,data=tile.data,color={r=tile.color.red,g=tile.color.green,b=tile.color.blue,a=tile.color.alpha},properties=tile.properties})
    end
    table.insert(sets,{index=index,name=tileset.name,base_index=tileset.baseIndex,tile_width=tileset.grid.tileSize.width,tile_height=tileset.grid.tileSize.height,tile_count=#tileset,data=tileset.data,properties=tileset.properties,tiles=tiles})
  end
  local layers={}
  local function visit(items)
    for _,layer in ipairs(items) do
      if layer.isGroup then visit(layer.layers)
      elseif layer.isTilemap then
        local cels={}
        for _,cel in ipairs(layer.cels) do
          local cells={}
          if cel.image.width*cel.image.height<=${MAX_TILE_CELLS} then
            for y=0,cel.image.height-1 do for x=0,cel.image.width-1 do local value=cel.image:getPixel(x,y) table.insert(cells,{x=x,y=y,tile=app.pixelColor.tileI(value),flags=app.pixelColor.tileF(value)}) end end
          end
          table.insert(cels,{frame=cel.frame.frameNumber,x=cel.position.x,y=cel.position.y,width=cel.image.width,height=cel.image.height,cells=cells})
        end
        table.insert(layers,{name=layer.name,tileset_name=layer.tileset and layer.tileset.name or nil,cels=cels})
      end
    end
  end
  visit(sprite.layers)
  return {file=${luaString(file.relative)},grid={x=sprite.gridBounds.x,y=sprite.gridBounds.y,tile_width=sprite.gridBounds.width,tile_height=sprite.gridBounds.height},tilesets=sets,tilemap_layers=layers}
end
if action=="inspect" then emit_result(tilemap_summary()) sprite:close() return end
local selected_tileset=${input.tilesetIndex ? `tileset_at(${input.tilesetIndex})` : "#sprite.tilesets>0 and sprite.tilesets[1] or nil"}
if action=="create_layer" then
  ${grid ? `sprite.gridBounds=Rectangle(${grid.x},${grid.y},${grid.tileWidth},${grid.tileHeight})` : ""}
  app.activeSprite=sprite app.command.NewLayer{tilemap=true}
  local layer=app.activeLayer layer.name=${luaString(input.name?.trim() || "Tilemap")}
  if selected_tileset~=nil then layer.tileset=selected_tileset end
elseif action=="create_tileset" then
  local tileset=sprite:newTileset(Grid(${grid?.x ?? 0},${grid?.y ?? 0},${grid?.tileWidth ?? 16},${grid?.tileHeight ?? 16}),${Math.max(1, assertInteger(input.tileCount ?? 1, "tileCount"))})
  tileset.name=${luaString(input.name?.trim() || "Tileset")}
elseif action=="assign_tileset" then
  local layer=find_layer(sprite.layers,${luaString(input.layer ?? "")}) if layer==nil or not layer.isTilemap then fail("Tilemap layer was not found") end
  if selected_tileset==nil then fail("Tileset was not found") end layer.tileset=selected_tileset
elseif action=="delete_tileset" then
  if selected_tileset==nil then fail("Tileset was not found") end sprite:deleteTileset(selected_tileset)
elseif action=="import_tileset" then
  local source=app.open(${luaString(source?.absolute ?? "")}) if source==nil then fail("Unable to open tileset source image") end
  local rendered=Image(source.spec) rendered:clear() rendered:drawSprite(source,1,Point(0,0))
  app.activeSprite=sprite
  local tile_width=${grid?.tileWidth ?? 16} local tile_height=${grid?.tileHeight ?? 16}
  local margin_x=${Math.max(0, input.marginX ?? 0)} local margin_y=${Math.max(0, input.marginY ?? 0)} local spacing_x=${Math.max(0, input.spacingX ?? 0)} local spacing_y=${Math.max(0, input.spacingY ?? 0)}
  local columns=${input.columns ?? "math.floor((source.width-margin_x+spacing_x)/(tile_width+spacing_x))"}
  local rows=${input.rows ?? "math.floor((source.height-margin_y+spacing_y)/(tile_height+spacing_y))"}
  local tileset=sprite:newTileset(Grid(${grid?.x ?? 0},${grid?.y ?? 0},tile_width,tile_height),columns*rows+1) tileset.name=${luaString(input.name?.trim() || "Imported Tileset")}
  for index=0,columns*rows-1 do local column=index%columns local row=math.floor(index/columns) local image=tileset:getTile(index+1) image:clear() image:drawImage(rendered,Point(-(margin_x+column*(tile_width+spacing_x)),-(margin_y+row*(tile_height+spacing_y)))) end
  source:close()
elseif selected_tileset==nil then fail("Tileset was not found")
elseif action=="create_tile" then sprite:newTile(selected_tileset,${input.insertAt ?? "#selected_tileset"})
elseif action=="delete_tile" then
  local index=${input.tileIndex ?? -1} if index<0 or index>=#selected_tileset then fail("Tile index is outside the tileset") end sprite:deleteTile(selected_tileset:tile(index))
elseif action=="set_tile_pixels" then
  local index=${input.tileIndex ?? -1} if index<0 or index>=#selected_tileset then fail("Tile index is outside the tileset") end
  local image=selected_tileset:getTile(index) local pixels=${pixelLua}
  for _,pixel in ipairs(pixels) do if pixel.x<0 or pixel.y<0 or pixel.x>=image.width or pixel.y>=image.height then fail("Tile pixel is outside the tile") end image:drawPixel(pixel.x,pixel.y,color_pixel(sprite,pixel.color)) end
elseif action=="set_cells" then
  local layer=find_layer(sprite.layers,${luaString(input.layer ?? "")}) if layer==nil or not layer.isTilemap then fail("Tilemap layer was not found") end
  if ${frame}>#sprite.frames then fail("Frame is outside the sprite") end
  app.activeSprite=sprite app.activeLayer=layer app.activeFrame=sprite.frames[${frame}]
  local tile_width=layer.tileset.grid.tileSize.width local tile_height=layer.tileset.grid.tileSize.height
  local origin_x=layer.tileset.grid.origin.x local origin_y=layer.tileset.grid.origin.y
  local cells=${cellsLua}
  for _,cell in ipairs(cells) do
    if cell.tile<0 or cell.tile>=#layer.tileset then fail("Cell tile index is outside the tileset") end
    app.fgTile=cell.tile
    local canvas_x=origin_x+cell.x*tile_width local canvas_y=origin_y+cell.y*tile_height
    app.useTool{tool="pencil",layer=layer,tilemapMode=TilemapMode.TILES,points={Point(canvas_x,canvas_y)}}
    local cel=layer:cel(${frame})
    if cel~=nil then
      local local_x=math.floor((canvas_x-cel.position.x)/tile_width) local local_y=math.floor((canvas_y-cel.position.y)/tile_height)
      if local_x>=0 and local_y>=0 and local_x<cel.image.width and local_y<cel.image.height then
        local flags=0 if cell.flip_x then flags=flags|app.pixelColor.TILE_XFLIP end if cell.flip_y then flags=flags|app.pixelColor.TILE_YFLIP end if cell.diagonal then flags=flags|app.pixelColor.TILE_DFLIP end
        cel.image:drawPixel(local_x,local_y,app.pixelColor.tile(cell.tile,flags))
      end
    end
  end
elseif action=="set_metadata" then
  if ${input.tileIndex !== undefined ? "true" : "false"} then
    local index=${input.tileIndex ?? 0} if index<0 or index>=#selected_tileset then fail("Tile index is outside the tileset") end local target=selected_tileset:tile(index)
    target.data=${luaString(input.data ?? "")} target.color=Color(${input.color ? luaColor(input.color) : "{r=0,g=0,b=0,a=0}"}) target.properties=${propertiesLua}
  else selected_tileset.data=${luaString(input.data ?? "")} selected_tileset.color=Color(${input.color ? luaColor(input.color) : "{r=0,g=0,b=0,a=0}"}) selected_tileset.properties=${propertiesLua} if ${input.name ? "true" : "false"} then selected_tileset.name=${luaString(input.name ?? "Tileset")} end end
else fail("Unsupported tilemap action") end
if not sprite:saveAs(${luaString(file.absolute)}) then fail("Unable to save sprite") end
emit_result(tilemap_summary()) sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}
