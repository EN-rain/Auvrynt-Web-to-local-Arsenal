import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type { ServerConfig } from "../../config.js";
import type { ToolResponse } from "../../pi-tools.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import {
  assertInteger,
  assertPositiveInteger,
  errorResponse,
  getAsepritePalettePreset,
  luaString,
  openSpriteScript,
  parseColor,
  resolveAsepriteExecutable,
  runLua,
  textResponse,
  workspacePath,
} from "./aseprite-tools.js";
import {
  asepriteFileSafety,
  assertAsepriteExpectedVersion,
} from "./aseprite-safety-tools.js";
import type { AsepriteRegion } from "./aseprite-analysis-tools.js";

const execFileAsync = promisify(execFile);
const MAX_MASK_POINTS = 262_144;
const MAX_STROKE_POINTS = 16_384;

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

function normalizeRegion(region: AsepriteRegion): AsepriteRegion {
  return {
    x: assertInteger(region.x, "region.x"),
    y: assertInteger(region.y, "region.y"),
    width: assertPositiveInteger(region.width, "region.width"),
    height: assertPositiveInteger(region.height, "region.height"),
  };
}

export async function asepriteImportSpriteSheet(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    imagePath: string;
    outputPath: string;
    frameWidth: number;
    frameHeight: number;
    marginX?: number;
    marginY?: number;
    spacingX?: number;
    spacingY?: number;
    columns?: number;
    rows?: number;
    frameCount?: number;
    order?: "row_major" | "column_major";
    layerName?: string;
    tagName?: string;
    durationMs?: number;
  },
): Promise<ToolResponse> {
  try {
    const source = workspacePath(registry, input.workspaceId, input.imagePath);
    const output = workspacePath(registry, input.workspaceId, input.outputPath);
    await mkdir(dirname(output.absolute), { recursive: true });
    const frameWidth = assertPositiveInteger(input.frameWidth, "frameWidth");
    const frameHeight = assertPositiveInteger(input.frameHeight, "frameHeight");
    const marginX = Math.max(0, assertInteger(input.marginX ?? 0, "marginX"));
    const marginY = Math.max(0, assertInteger(input.marginY ?? 0, "marginY"));
    const spacingX = Math.max(0, assertInteger(input.spacingX ?? 0, "spacingX"));
    const spacingY = Math.max(0, assertInteger(input.spacingY ?? 0, "spacingY"));
    const durationMs = Math.max(1, Math.min(60_000, assertInteger(input.durationMs ?? 100, "durationMs")));
    const result = await runLua(config, registry, input.workspaceId, `
local source=app.open(${luaString(source.absolute)})
if source==nil then fail("Unable to open sprite sheet") end
local rendered=Image(source.spec) rendered:clear() rendered:drawSprite(source,1,Point(0,0))
local frame_width=${frameWidth} local frame_height=${frameHeight}
local margin_x=${marginX} local margin_y=${marginY} local spacing_x=${spacingX} local spacing_y=${spacingY}
local columns=${input.columns ?? "math.floor((source.width-margin_x+spacing_x)/(frame_width+spacing_x))"}
local rows=${input.rows ?? "math.floor((source.height-margin_y+spacing_y)/(frame_height+spacing_y))"}
if columns<1 or rows<1 then fail("Frame grid does not fit the source image") end
local count=${input.frameCount ?? "columns*rows"}
if count<1 or count>columns*rows then fail("frameCount is outside the available grid") end
local sprite=Sprite(frame_width,frame_height,source.colorMode)
if #source.palettes>0 then sprite:setPalette(source.palettes[1]) end
sprite.transparentColor=source.transparentColor
local layer=sprite.layers[1] layer.name=${luaString(input.layerName?.trim() || "Imported")}
for index=0,count-1 do
  local column local row
  if ${luaString(input.order ?? "row_major")}=="column_major" then column=math.floor(index/rows) row=index%rows
  else row=math.floor(index/columns) column=index%columns end
  local sx=margin_x+column*(frame_width+spacing_x)
  local sy=margin_y+row*(frame_height+spacing_y)
  if sx+frame_width>source.width or sy+frame_height>source.height then fail("Frame rectangle exceeds source image") end
  local image=Image(sprite.spec) image:clear() image:drawImage(rendered,Point(-sx,-sy))
  local frame_number=index+1
  if frame_number==1 then
    layer:cel(1).image=image
  else
    sprite:newEmptyFrame(frame_number)
    sprite:newCel(layer,frame_number,image,Point(0,0))
  end
  sprite.frames[frame_number].duration=${durationMs / 1000}
end
${input.tagName ? `local tag=sprite:newTag(1,count) tag.name=${luaString(input.tagName)}` : ""}
if not sprite:saveAs(${luaString(output.absolute)}) then fail("Unable to save imported sprite") end
emit_result({source=${luaString(source.relative)},output=${luaString(output.relative)},frames=count,columns=columns,rows=rows,summary=sprite_summary(sprite)})
sprite:close() source:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteEditRegion(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    targetPath: string;
    sourcePath?: string;
    sourceLayer?: string;
    sourceFrame?: number;
    sourceRegion: AsepriteRegion;
    targetLayer?: string;
    targetFrame?: number;
    targetX: number;
    targetY: number;
    createTargetLayer?: boolean;
    scale?: number;
    rotation?: 0 | 90 | 180 | 270;
    flipX?: boolean;
    flipY?: boolean;
    blend?: "replace" | "normal" | "behind";
    expectedVersion?: string;
    checkpoint?: boolean;
  },
): Promise<ToolResponse> {
  try {
    await prepareMutation(config, registry, input.workspaceId, input.targetPath, input, "edit-region");
    const target = workspacePath(registry, input.workspaceId, input.targetPath);
    const source = workspacePath(registry, input.workspaceId, input.sourcePath ?? input.targetPath);
    const region = normalizeRegion(input.sourceRegion);
    const sourceFrame = assertPositiveInteger(input.sourceFrame ?? 1, "sourceFrame");
    const targetFrame = assertPositiveInteger(input.targetFrame ?? 1, "targetFrame");
    const targetX = assertInteger(input.targetX, "targetX");
    const targetY = assertInteger(input.targetY, "targetY");
    const scale = Math.min(16, assertPositiveInteger(input.scale ?? 1, "scale"));
    const rotation = input.rotation ?? 0;
    const result = await runLua(config, registry, input.workspaceId, `
local target=app.open(${luaString(target.absolute)})
if target==nil then fail("Unable to open target sprite") end
local source=${source.absolute === target.absolute ? "target" : `app.open(${luaString(source.absolute)})`}
if source==nil then fail("Unable to open source sprite") end
if ${sourceFrame}>#source.frames or ${targetFrame}>#target.frames then fail("Frame is outside a sprite") end
local source_image=Image(source.spec) source_image:clear()
${input.sourceLayer ? `
local source_layer=find_layer(source.layers,${luaString(input.sourceLayer)})
if source_layer==nil or source_layer.isGroup then fail("Source layer was not found") end
local source_cel=source_layer:cel(${sourceFrame})
if source_cel~=nil then source_image:drawImage(source_cel.image,source_cel.position) end
` : `source_image:drawSprite(source,${sourceFrame},Point(0,0))`}
if ${region.x}<0 or ${region.y}<0 or ${region.x + region.width}>source.width or ${region.y + region.height}>source.height then fail("Source region is outside the sprite") end
local rotation=${rotation}
local scaled_width=${region.width * scale} local scaled_height=${region.height * scale}
local output_width=(rotation==90 or rotation==270) and scaled_height or scaled_width
local output_height=(rotation==90 or rotation==270) and scaled_width or scaled_height
local target_layer=${input.targetLayer ? `find_layer(target.layers,${luaString(input.targetLayer)})` : "target.layers[1]"}
if target_layer==nil and ${input.createTargetLayer === true ? "true" : "false"} then target_layer=target:newLayer() target_layer.name=${luaString(input.targetLayer ?? "Region") } end
if target_layer==nil or target_layer.isGroup then fail("Target layer was not found") end
local target_cel=ensure_canvas_cel(target,target_layer,${targetFrame})
local target_image=target_cel.image
local function transformed_source(dx,dy)
  local rx=dx local ry=dy
  if rotation==90 then rx=dy ry=scaled_height-1-dx
  elseif rotation==180 then rx=scaled_width-1-dx ry=scaled_height-1-dy
  elseif rotation==270 then rx=scaled_width-1-dy ry=dx end
  if ${input.flipX === true ? "true" : "false"} then rx=scaled_width-1-rx end
  if ${input.flipY === true ? "true" : "false"} then ry=scaled_height-1-ry end
  local sx=${region.x}+math.floor(rx/${scale})
  local sy=${region.y}+math.floor(ry/${scale})
  return pixel_rgba(source,source_image:getPixel(sx,sy))
end
local blend=${luaString(input.blend ?? "replace")}
local changed=0
for dy=0,output_height-1 do for dx=0,output_width-1 do
  local tx=${targetX}+dx local ty=${targetY}+dy
  if tx>=0 and ty>=0 and tx<target.width and ty<target.height then
    local src=transformed_source(dx,dy)
    local dst=pixel_rgba(target,target_image:getPixel(tx,ty))
    local write=nil
    if blend=="replace" then write=src
    elseif blend=="behind" then if dst.a==0 then write=src end
    elseif src.a>0 then
      if src.a==255 then write=src
      else
        local sa=src.a/255 local da=dst.a/255 local oa=sa+da*(1-sa)
        if oa>0 then write={r=math.floor((src.r*sa+dst.r*da*(1-sa))/oa+0.5),g=math.floor((src.g*sa+dst.g*da*(1-sa))/oa+0.5),b=math.floor((src.b*sa+dst.b*da*(1-sa))/oa+0.5),a=math.floor(oa*255+0.5)} end
      end
    end
    if write~=nil then target_image:drawPixel(tx,ty,color_pixel(target,write)) changed=changed+1 end
  end
end end
if not target:saveAs(${luaString(target.absolute)}) then fail("Unable to save target sprite") end
emit_result({target=${luaString(target.relative)},source=${luaString(source.relative)},changed_pixels=changed,output_bounds={x=${targetX},y=${targetY},width=output_width,height=output_height},layer=target_layer.name,frame=${targetFrame}})
if source~=target then source:close() end target:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteDrawStroke(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    layer?: string;
    frame?: number;
    points: Array<{ x: number; y: number; pressure?: number }>;
    tool?: "pencil" | "eraser" | "paint_bucket";
    color?: string;
    opacity?: number;
    brush?: { type?: "circle" | "square" | "line" | "image"; size?: number; angle?: number; imagePath?: string };
    ink?: "simple" | "alpha" | "copy" | "lock_alpha" | "shading";
    pixelPerfect?: boolean;
    symmetry?: { horizontalX?: number; verticalY?: number };
    tiled?: { horizontal?: boolean; vertical?: boolean };
    expectedVersion?: string;
    checkpoint?: boolean;
  },
): Promise<ToolResponse> {
  try {
    if (!Array.isArray(input.points) || input.points.length < 1 || input.points.length > MAX_STROKE_POINTS) {
      throw new Error(`points must contain 1-${MAX_STROKE_POINTS} entries.`);
    }
    await prepareMutation(config, registry, input.workspaceId, input.filePath, input, "draw-stroke");
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    const frame = assertPositiveInteger(input.frame ?? 1, "frame");
    const points = input.points.map((point) => ({
      x: assertInteger(point.x, "point.x"),
      y: assertInteger(point.y, "point.y"),
      pressure: point.pressure === undefined ? undefined : Math.max(0, Math.min(1, point.pressure)),
    }));
    const size = Math.min(256, assertPositiveInteger(input.brush?.size ?? 1, "brush.size"));
    const angle = assertInteger(input.brush?.angle ?? 0, "brush.angle");
    const opacity = Math.max(0, Math.min(255, assertInteger(input.opacity ?? 255, "opacity")));
    const pointLua = `{${points.map((point) => `Point(${point.x},${point.y})`).join(",")}}`;
    const color = input.color ? luaColor(input.color) : "{r=0,g=0,b=0,a=255}";
    const brushType = input.brush?.type ?? "circle";
    const brushTypeLua = brushType === "square" ? "BrushType.SQUARE" : brushType === "line" ? "BrushType.LINE" : "BrushType.CIRCLE";
    const customBrush = input.brush?.imagePath ? workspacePath(registry, input.workspaceId, input.brush.imagePath) : undefined;
    const inkLua = input.ink === "alpha" ? "Ink.ALPHA_COMPOSITING"
      : input.ink === "copy" ? "Ink.COPY_COLOR"
        : input.ink === "lock_alpha" ? "Ink.LOCK_ALPHA"
          : input.ink === "shading" ? "Ink.SHADING"
            : "Ink.SIMPLE";
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
if ${frame}>#sprite.frames then fail("Frame is outside the sprite") end
local layer=${input.layer ? `find_layer(sprite.layers,${luaString(input.layer)})` : "sprite.layers[1]"}
if layer==nil or layer.isGroup then fail("Drawable layer was not found") end
app.activeLayer=layer app.activeFrame=sprite.frames[${frame}]
ensure_canvas_cel(sprite,layer,${frame})
local brush=nil
${customBrush ? `
local brush_sprite=app.open(${luaString(customBrush.absolute)})
if brush_sprite==nil then fail("Unable to open custom brush image") end
local brush_image=Image(brush_sprite.spec) brush_image:clear() brush_image:drawSprite(brush_sprite,1,Point(0,0))
brush=Brush{type=BrushType.IMAGE,image=brush_image}
app.activeSprite=sprite app.activeLayer=layer app.activeFrame=sprite.frames[${frame}]
` : `brush=Brush{type=${brushTypeLua},size=${size},angle=${angle}}`}
local prefs=app.preferences
local doc_prefs=prefs.document(sprite)
prefs.symmetry_mode.enabled=${input.symmetry ? "true" : "false"}
doc_prefs.symmetry.mode=${input.symmetry ? ((input.symmetry.horizontalX !== undefined ? 1 : 0) + (input.symmetry.verticalY !== undefined ? 2 : 0)) : 0}
doc_prefs.symmetry.x_axis=${input.symmetry?.horizontalX ?? "math.floor(sprite.width/2)"}
doc_prefs.symmetry.y_axis=${input.symmetry?.verticalY ?? "math.floor(sprite.height/2)"}
doc_prefs.tiled.mode=${(input.tiled?.horizontal ? 1 : 0) + (input.tiled?.vertical ? 2 : 0)}
local color=Color(${color})
app.useTool{
  tool=${luaString(input.tool ?? "pencil")},
  freehandAlgorithm=${input.pixelPerfect === true ? 1 : 0},
  brush=brush,
  color=color,
  points=${pointLua},
  ink=${inkLua},
  opacity=${opacity},
}
if not sprite:saveAs(${luaString(file.absolute)}) then fail("Unable to save sprite") end
emit_result({file=${luaString(file.relative)},layer=layer.name,frame=${frame},points=${points.length},tool=${luaString(input.tool ?? "pencil")},brush={type=${luaString(brushType)},size=${size},angle=${angle}},pixel_perfect=${input.pixelPerfect === true ? "true" : "false"}})
${customBrush ? "brush_sprite:close()" : ""} sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteComposeLayers(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    action: "create_group" | "duplicate" | "merge_down" | "flatten_all" | "flatten_visible" | "to_background" | "from_background" | "reorder" | "move_to_group" | "set_locked" | "set_blend_mode" | "solo";
    layer?: string;
    name?: string;
    group?: string;
    stackIndex?: number;
    locked?: boolean;
    blendMode?: "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | "addition" | "subtract" | "divide";
    expectedVersion?: string;
    checkpoint?: boolean;
  },
): Promise<ToolResponse> {
  try {
    await prepareMutation(config, registry, input.workspaceId, input.filePath, input, `layers-${input.action}`);
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    const blendMap: Record<string, string> = {
      normal: "BlendMode.NORMAL", multiply: "BlendMode.MULTIPLY", screen: "BlendMode.SCREEN",
      overlay: "BlendMode.OVERLAY", darken: "BlendMode.DARKEN", lighten: "BlendMode.LIGHTEN",
      addition: "BlendMode.ADDITION", subtract: "BlendMode.SUBTRACT", divide: "BlendMode.DIVIDE",
    };
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
local action=${luaString(input.action)}
local layer=${input.layer ? `find_layer(sprite.layers,${luaString(input.layer)})` : "nil"}
if action=="create_group" then
  local group=sprite:newGroup() group.name=${luaString(input.name?.trim() || "Group")}
elseif layer==nil then fail("Layer was not found")
elseif action=="duplicate" then
  app.activeLayer=layer app.command.DuplicateLayer()
  if ${input.name ? "true" : "false"} then app.activeLayer.name=${luaString(input.name ?? "Layer Copy")} end
elseif action=="merge_down" then app.activeLayer=layer app.command.MergeDownLayer()
elseif action=="flatten_all" then sprite:flatten()
elseif action=="flatten_visible" then
  local hidden={}
  local function visit(items) for _,candidate in ipairs(items) do if not candidate.isVisible then table.insert(hidden,candidate) end if candidate.isGroup then visit(candidate.layers) end end end
  visit(sprite.layers)
  sprite:flatten()
elseif action=="to_background" then app.activeLayer=layer app.command.BackgroundFromLayer()
elseif action=="from_background" then app.activeLayer=layer app.command.LayerFromBackground()
elseif action=="reorder" then layer.stackIndex=${input.stackIndex ?? 1}
elseif action=="move_to_group" then
  local group=find_layer(sprite.layers,${luaString(input.group ?? "")})
  if group==nil or not group.isGroup then fail("Target group was not found") end
  layer.parent=group
elseif action=="set_locked" then layer.isEditable=${input.locked === false ? "true" : "false"}
elseif action=="set_blend_mode" then layer.blendMode=${blendMap[input.blendMode ?? "normal"]}
elseif action=="solo" then
  local function visit(items) for _,candidate in ipairs(items) do candidate.isVisible=(candidate==layer or candidate.isGroup) if candidate.isGroup then visit(candidate.layers) end end end
  visit(sprite.layers) layer.isVisible=true
else fail("Unsupported layer composition action") end
if not sprite:saveAs(${luaString(file.absolute)}) then fail("Unable to save sprite") end
emit_result(sprite_summary(sprite)) sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

interface StoredMask {
  format: "auvrynt-aseprite-mask-v1";
  spriteWidth: number;
  spriteHeight: number;
  points: Array<{ x: number; y: number }>;
}

async function readMask(registry: WorkspaceRegistry, workspaceId: string, path: string): Promise<StoredMask> {
  const file = workspacePath(registry, workspaceId, path);
  const parsed = JSON.parse(await readFile(file.absolute, "utf8")) as StoredMask;
  if (parsed.format !== "auvrynt-aseprite-mask-v1" || !Array.isArray(parsed.points)) throw new Error("Invalid Auvrynt Aseprite mask file.");
  if (parsed.points.length > MAX_MASK_POINTS) throw new Error("Mask contains too many points.");
  return parsed;
}

export async function asepriteManageMask(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    action: "create_rect" | "create_color" | "create_opaque" | "invert" | "move" | "inspect" | "apply_clear" | "apply_fill";
    maskPath: string;
    layer?: string;
    frame?: number;
    rect?: AsepriteRegion;
    color?: string;
    tolerance?: number;
    dx?: number;
    dy?: number;
    movePixels?: boolean;
    fillColor?: string;
    expectedVersion?: string;
    checkpoint?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    const maskFile = workspacePath(registry, input.workspaceId, input.maskPath);
    const frame = assertPositiveInteger(input.frame ?? 1, "frame");
    if (input.action === "inspect") return textResponse(await readMask(registry, input.workspaceId, input.maskPath));
    let existing: StoredMask | undefined;
    if (["invert", "move", "apply_clear", "apply_fill"].includes(input.action)) existing = await readMask(registry, input.workspaceId, input.maskPath);
    if (input.action === "move") {
      const dx = assertInteger(input.dx ?? 0, "dx");
      const dy = assertInteger(input.dy ?? 0, "dy");
      if (input.movePixels) {
        await prepareMutation(config, registry, input.workspaceId, input.filePath, input, "move-mask-pixels");
        const pointsLua = `{${existing!.points.map((point) => `{x=${point.x},y=${point.y}}`).join(",")}}`;
        await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
local layer=${input.layer ? `find_layer(sprite.layers,${luaString(input.layer)})` : "sprite.layers[1]"}
if layer==nil or layer.isGroup then fail("Drawable layer was not found") end
local cel=ensure_canvas_cel(sprite,layer,${frame}) local image=cel.image
local points=${pointsLua} local captured={}
for _,point in ipairs(points) do if point.x>=0 and point.y>=0 and point.x<sprite.width and point.y<sprite.height then table.insert(captured,{x=point.x,y=point.y,p=image:getPixel(point.x,point.y)}) image:drawPixel(point.x,point.y,sprite.colorMode==ColorMode.INDEXED and sprite.transparentColor or 0) end end
for _,point in ipairs(captured) do local x=point.x+${dx} local y=point.y+${dy} if x>=0 and y>=0 and x<sprite.width and y<sprite.height then image:drawPixel(x,y,point.p) end end
if not sprite:saveAs(${luaString(file.absolute)}) then fail("Unable to save sprite") end emit_result({moved=#captured}) sprite:close()
`);
      }
      const moved: StoredMask = { ...existing!, points: existing!.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
      await mkdir(dirname(maskFile.absolute), { recursive: true });
      await writeFile(maskFile.absolute, JSON.stringify(moved, null, 2), "utf8");
      return textResponse({ mask: maskFile.relative, points: moved.points.length, dx, dy, movedPixels: input.movePixels === true });
    }
    if (input.action === "apply_clear" || input.action === "apply_fill") {
      await prepareMutation(config, registry, input.workspaceId, input.filePath, input, `mask-${input.action}`);
      const pointsLua = `{${existing!.points.map((point) => `{x=${point.x},y=${point.y}}`).join(",")}}`;
      const fill = input.action === "apply_fill" ? luaColor(input.fillColor ?? "#000000FF") : undefined;
      const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
local layer=${input.layer ? `find_layer(sprite.layers,${luaString(input.layer)})` : "sprite.layers[1]"}
if layer==nil or layer.isGroup then fail("Drawable layer was not found") end
local image=ensure_canvas_cel(sprite,layer,${frame}).image local points=${pointsLua}
local pixel=${fill ? `color_pixel(sprite,${fill})` : "sprite.colorMode==ColorMode.INDEXED and sprite.transparentColor or 0"}
local changed=0
for _,point in ipairs(points) do if point.x>=0 and point.y>=0 and point.x<sprite.width and point.y<sprite.height then image:drawPixel(point.x,point.y,pixel) changed=changed+1 end end
if not sprite:saveAs(${luaString(file.absolute)}) then fail("Unable to save sprite") end emit_result({changed_pixels=changed}) sprite:close()
`);
      return textResponse(result);
    }
    const rect = input.rect ? normalizeRegion(input.rect) : undefined;
    const targetColor = input.color ? parseColor(input.color) : undefined;
    const tolerance = Math.max(0, Math.min(255, assertInteger(input.tolerance ?? 0, "tolerance")));
    const currentPoints = existing?.points ?? [];
    const pointsLua = `{${currentPoints.map((point) => `{x=${point.x},y=${point.y}}`).join(",")}}`;
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
local points={}
local selected={}
local function add(x,y) local key=x..","..y if not selected[key] then selected[key]=true table.insert(points,{x=x,y=y}) end end
if ${luaString(input.action)}=="create_rect" then
  local x=${rect?.x ?? 0} local y=${rect?.y ?? 0} local width=${rect?.width ?? 0} local height=${rect?.height ?? 0}
  if x<0 or y<0 or x+width>sprite.width or y+height>sprite.height then fail("Mask rectangle is outside the sprite") end
  for py=y,y+height-1 do for px=x,x+width-1 do add(px,py) end end
elseif ${luaString(input.action)}=="invert" then
  local old=${pointsLua} for _,point in ipairs(old) do selected[point.x..","..point.y]=true end
  local inverted={} for y=0,sprite.height-1 do for x=0,sprite.width-1 do if not selected[x..","..y] then table.insert(inverted,{x=x,y=y}) end end end points=inverted
else
  local layer=${input.layer ? `find_layer(sprite.layers,${luaString(input.layer)})` : "sprite.layers[1]"}
  if layer==nil or layer.isGroup then fail("Drawable layer was not found") end
  for y=0,sprite.height-1 do for x=0,sprite.width-1 do
    local c=canvas_pixel(sprite,layer,${frame},x,y)
    if ${luaString(input.action)}=="create_opaque" then if c.a>0 then add(x,y) end
    else
      local target=${targetColor ? `{r=${targetColor.r},g=${targetColor.g},b=${targetColor.b},a=${targetColor.a}}` : "{r=0,g=0,b=0,a=0}"}
      if math.abs(c.r-target.r)<=${tolerance} and math.abs(c.g-target.g)<=${tolerance} and math.abs(c.b-target.b)<=${tolerance} and math.abs(c.a-target.a)<=${tolerance} then add(x,y) end
    end
  end end
end
if #points>${MAX_MASK_POINTS} then fail("Generated mask exceeds ${MAX_MASK_POINTS} points") end
emit_result({spriteWidth=sprite.width,spriteHeight=sprite.height,points=points}) sprite:close()
`) as any;
    const stored: StoredMask = { format: "auvrynt-aseprite-mask-v1", ...result };
    await mkdir(dirname(maskFile.absolute), { recursive: true });
    await writeFile(maskFile.absolute, JSON.stringify(stored, null, 2), "utf8");
    return textResponse({ mask: maskFile.relative, points: stored.points.length, spriteWidth: stored.spriteWidth, spriteHeight: stored.spriteHeight });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteManageColor(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    action: "inspect" | "set_palette_entry" | "set_transparent_index" | "remap_color" | "assign_profile" | "convert_profile" | "remove_profile" | "load_palette" | "save_palette" | "quantize" | "apply_palette_preset";
    index?: number;
    color?: string;
    fromColor?: string;
    toColor?: string;
    tolerance?: number;
    profilePath?: string;
    palettePath?: string;
    preset?: "gameboy" | "pico8" | "cga" | "c64" | "dawnbringer16" | "grayscale_4" | "monochrome";
    maxColors?: number;
    dithering?: "none" | "ordered" | "old";
    ditheringMatrix?: "bayer2x2" | "bayer4x4" | "bayer8x8" | string;
    expectedVersion?: string;
    checkpoint?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    if (input.action === "inspect") {
      const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
local colors={}
if #sprite.palettes>0 then local palette=sprite.palettes[1] for index=0,#palette-1 do local c=palette:getColor(index) table.insert(colors,{index=index,color=rgba_hex({r=c.red,g=c.green,b=c.blue,a=(index==sprite.transparentColor and 0 or c.alpha)})}) end end
emit_result({file=${luaString(file.relative)},color_mode=color_mode_name(sprite.colorMode),color_profile=sprite.colorSpace and sprite.colorSpace.name or nil,transparent_index=sprite.transparentColor,palette=colors}) sprite:close()
`);
      return textResponse(result);
    }
    await prepareMutation(config, registry, input.workspaceId, input.filePath, input, `color-${input.action}`);
    if (input.action === "quantize") {
      const executable = await resolveAsepriteExecutable(config);
      const temporary = `${file.absolute}.auvrynt-quantized.aseprite`;
      const args = ["-b", file.absolute];
      if (input.palettePath) args.push("--palette", workspacePath(registry, input.workspaceId, input.palettePath).absolute);
      args.push("--color-mode", "indexed", "--dithering-algorithm", input.dithering ?? "none");
      if (input.ditheringMatrix) args.push("--dithering-matrix", input.ditheringMatrix);
      args.push("--save-as", temporary);
      await execFileAsync(executable, args, { timeout: 120_000, windowsHide: true });
      if (input.maxColors && !input.palettePath) {
        await runLua(config, registry, input.workspaceId, `
${openSpriteScript(temporary)}
app.command.ColorQuantization{ui=false,withAlpha=true,maxColors=${Math.max(2, Math.min(256, assertInteger(input.maxColors, "maxColors")))}}
if not sprite:saveAs(${luaString(temporary)}) then fail("Unable to save quantized sprite") end emit_result({ok=true}) sprite:close()
`);
      }
      await rename(temporary, file.absolute);
      return textResponse({ file: file.relative, quantized: true, version: await assertAsepriteExpectedVersion(registry, input.workspaceId, input.filePath) });
    }
    const palette = input.palettePath ? workspacePath(registry, input.workspaceId, input.palettePath) : undefined;
    const profile = input.profilePath ? workspacePath(registry, input.workspaceId, input.profilePath) : undefined;
    const from = input.fromColor ? parseColor(input.fromColor) : undefined;
    const to = input.toColor ? parseColor(input.toColor) : undefined;
    const tolerance = Math.max(0, Math.min(255, assertInteger(input.tolerance ?? 0, "tolerance")));
    const presetColors = input.preset ? getAsepritePalettePreset(input.preset) : undefined;
    const presetLua = presetColors ? `{${presetColors.map((color) => {
      const parsed = parseColor(color);
      return `{r=${parsed.r},g=${parsed.g},b=${parsed.b},a=${parsed.a}}`;
    }).join(",")}}` : "nil";
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
local action=${luaString(input.action)}
if action=="apply_palette_preset" then
  if ${presetLua}==nil then fail("preset is required") end
  local colors=${presetLua} local new_palette=Palette(#colors)
  for index,color in ipairs(colors) do new_palette:setColor(index-1,Color(color)) end
  sprite:setPalette(new_palette)
elseif action=="set_palette_entry" then
  local index=${input.index ?? -1} if index<0 or #sprite.palettes==0 or index>=#sprite.palettes[1] then fail("Palette index is outside the palette") end
  sprite.palettes[1]:setColor(index,Color(${input.color ? luaColor(input.color) : "{r=0,g=0,b=0,a=255}"}))
elseif action=="set_transparent_index" then
  if sprite.colorMode~=ColorMode.INDEXED then fail("Transparent index is only valid for indexed sprites") end
  local index=${input.index ?? -1} if index<0 or index>=#sprite.palettes[1] then fail("Transparent index is outside the palette") end sprite.transparentColor=index
elseif action=="remap_color" then
  local from=${from ? `{r=${from.r},g=${from.g},b=${from.b},a=${from.a}}` : "nil"} local replacement=${to ? `{r=${to.r},g=${to.g},b=${to.b},a=${to.a}}` : "nil"}
  if from==nil or replacement==nil then fail("fromColor and toColor are required") end
  local changed=0
  for _,cel in ipairs(sprite.cels) do for pixel in cel.image:pixels() do local c=pixel_rgba(sprite,pixel()) if math.abs(c.r-from.r)<=${tolerance} and math.abs(c.g-from.g)<=${tolerance} and math.abs(c.b-from.b)<=${tolerance} and math.abs(c.a-from.a)<=${tolerance} then pixel(color_pixel(sprite,replacement)) changed=changed+1 end end end
elseif action=="assign_profile" or action=="convert_profile" then
  local cs=${profile ? `ColorSpace{fromFile=${luaString(profile.absolute)}}` : "ColorSpace{sRGB=true}"}
  if action=="assign_profile" then sprite:assignColorSpace(cs) else sprite:convertColorSpace(cs) end
elseif action=="remove_profile" then sprite:assignColorSpace(ColorSpace())
elseif action=="load_palette" then sprite:setPalette(Palette{fromFile=${luaString(palette?.absolute ?? "")}})
elseif action=="save_palette" then app.command.SavePalette{ui=false,filename=${luaString(palette?.absolute ?? "")},columns=16}
else fail("Unsupported color action") end
if action~="save_palette" and not sprite:saveAs(${luaString(file.absolute)}) then fail("Unable to save sprite") end
emit_result({file=${luaString(file.relative)},action=action,color_profile=sprite.colorSpace and sprite.colorSpace.name or nil,transparent_index=sprite.transparentColor,palette_size=#sprite.palettes>0 and #sprite.palettes[1] or 0}) sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteManageDocument(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    action: "resize_sprite" | "resize_canvas" | "crop" | "trim" | "set_grid" | "set_pixel_ratio" | "set_userdata" | "create_slice" | "update_slice" | "delete_slice";
    width?: number;
    height?: number;
    offsetX?: number;
    offsetY?: number;
    region?: AsepriteRegion;
    grid?: AsepriteRegion;
    ratioWidth?: number;
    ratioHeight?: number;
    targetType?: "sprite" | "layer" | "cel" | "tag" | "slice";
    targetName?: string;
    frame?: number;
    data?: string;
    properties?: Record<string, string | number | boolean | null>;
    sliceName?: string;
    center?: AsepriteRegion;
    pivot?: { x: number; y: number };
    expectedVersion?: string;
    checkpoint?: boolean;
  },
): Promise<ToolResponse> {
  try {
    await prepareMutation(config, registry, input.workspaceId, input.filePath, input, `document-${input.action}`);
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    const properties = input.properties ?? {};
    const propertiesLua = `{${Object.entries(properties).map(([key, value]) => {
      const encoded = value === null ? "nil" : typeof value === "string" ? luaString(value) : String(value);
      return `[${luaString(key)}]=${encoded}`;
    }).join(",")}}`;
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
local action=${luaString(input.action)}
if action=="resize_sprite" then sprite:resize(${input.width ?? 0},${input.height ?? 0})
elseif action=="resize_canvas" then
  local old_width=sprite.width local old_height=sprite.height sprite.width=${input.width ?? 0} sprite.height=${input.height ?? 0}
  for _,cel in ipairs(sprite.cels) do cel.position=Point(cel.position.x+${input.offsetX ?? 0},cel.position.y+${input.offsetY ?? 0}) end
elseif action=="crop" then sprite:crop{x=${input.region?.x ?? 0},y=${input.region?.y ?? 0},width=${input.region?.width ?? 0},height=${input.region?.height ?? 0}}
elseif action=="trim" then
  local bounds=nil
  for frame=1,#sprite.frames do local render=Image(sprite.spec) render:clear() render:drawSprite(sprite,frame,Point(0,0)) for y=0,sprite.height-1 do for x=0,sprite.width-1 do if pixel_rgba(sprite,render:getPixel(x,y)).a>0 then if bounds==nil then bounds={x=x,y=y,right=x,bottom=y} else if x<bounds.x then bounds.x=x end if y<bounds.y then bounds.y=y end if x>bounds.right then bounds.right=x end if y>bounds.bottom then bounds.bottom=y end end end end end end
  if bounds~=nil then sprite:crop{x=bounds.x,y=bounds.y,width=bounds.right-bounds.x+1,height=bounds.bottom-bounds.y+1} end
elseif action=="set_grid" then sprite.gridBounds=Rectangle(${input.grid?.x ?? 0},${input.grid?.y ?? 0},${input.grid?.width ?? 16},${input.grid?.height ?? 16})
elseif action=="set_pixel_ratio" then sprite.pixelRatio=Size(${input.ratioWidth ?? 1},${input.ratioHeight ?? 1})
elseif action=="set_userdata" then
  local target=sprite local target_type=${luaString(input.targetType ?? "sprite")}
  if target_type=="layer" then target=find_layer(sprite.layers,${luaString(input.targetName ?? "")})
  elseif target_type=="cel" then local layer=find_layer(sprite.layers,${luaString(input.targetName ?? "")}) target=layer and layer:cel(${input.frame ?? 1}) or nil
  elseif target_type=="tag" then for _,item in ipairs(sprite.tags) do if item.name==${luaString(input.targetName ?? "")} then target=item break end end
  elseif target_type=="slice" then for _,item in ipairs(sprite.slices) do if item.name==${luaString(input.targetName ?? "")} then target=item break end end end
  if target==nil then fail("User-data target was not found") end
  target.data=${luaString(input.data ?? "")} target.properties=${propertiesLua}
elseif action=="create_slice" then
  local region=Rectangle(${input.region?.x ?? 0},${input.region?.y ?? 0},${input.region?.width ?? 1},${input.region?.height ?? 1})
  local slice=sprite:newSlice(region) slice.name=${luaString(input.sliceName ?? "Slice")}
  ${input.center ? `slice.center=Rectangle(${input.center.x},${input.center.y},${input.center.width},${input.center.height})` : ""}
  ${input.pivot ? `slice.pivot=Point(${input.pivot.x},${input.pivot.y})` : ""}
elseif action=="update_slice" then
  local slice=nil for _,item in ipairs(sprite.slices) do if item.name==${luaString(input.sliceName ?? "")} then slice=item break end end if slice==nil then fail("Slice was not found") end
  ${input.region ? `slice.bounds=Rectangle(${input.region.x},${input.region.y},${input.region.width},${input.region.height})` : ""}
  ${input.center ? `slice.center=Rectangle(${input.center.x},${input.center.y},${input.center.width},${input.center.height})` : ""}
  ${input.pivot ? `slice.pivot=Point(${input.pivot.x},${input.pivot.y})` : ""}
elseif action=="delete_slice" then
  local slice=nil for _,item in ipairs(sprite.slices) do if item.name==${luaString(input.sliceName ?? "")} then slice=item break end end if slice==nil then fail("Slice was not found") end sprite:deleteSlice(slice)
else fail("Unsupported document action") end
if not sprite:saveAs(${luaString(file.absolute)}) then fail("Unable to save sprite") end emit_result(sprite_summary(sprite)) sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteManageCels(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    action: "inspect" | "create" | "delete" | "move" | "duplicate" | "link" | "unlink" | "set_opacity" | "set_z_index";
    layer: string;
    frame: number;
    targetLayer?: string;
    targetFrame?: number;
    x?: number;
    y?: number;
    opacity?: number;
    zIndex?: number;
    expectedVersion?: string;
    checkpoint?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    const frame = assertPositiveInteger(input.frame, "frame");
    if (input.action !== "inspect") await prepareMutation(config, registry, input.workspaceId, input.filePath, input, `cel-${input.action}`);
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
local layer=find_layer(sprite.layers,${luaString(input.layer)}) if layer==nil or layer.isGroup then fail("Layer was not found") end
if ${frame}>#sprite.frames then fail("Frame is outside the sprite") end
local cel=layer:cel(${frame}) local action=${luaString(input.action)}
if action=="inspect" then
  emit_result({exists=cel~=nil,cel=cel and {layer=layer.name,frame=${frame},x=cel.position.x,y=cel.position.y,width=cel.image.width,height=cel.image.height,opacity=cel.opacity,z_index=cel.zIndex,image_id=tostring(cel.image.id or cel.image),data=cel.data} or nil}) sprite:close() return
elseif action=="create" then if cel==nil then cel=sprite:newCel(layer,${frame},Image(sprite.spec),Point(${input.x ?? 0},${input.y ?? 0})) end
elseif cel==nil then fail("Cel was not found")
elseif action=="delete" then sprite:deleteCel(cel)
elseif action=="move" then cel.position=Point(${input.x ?? 0},${input.y ?? 0})
elseif action=="set_opacity" then cel.opacity=${input.opacity ?? 255}
elseif action=="set_z_index" then cel.zIndex=${input.zIndex ?? 0}
elseif action=="duplicate" or action=="link" then
  local target_layer=find_layer(sprite.layers,${luaString(input.targetLayer ?? input.layer)}) if target_layer==nil or target_layer.isGroup then fail("Target layer was not found") end
  local target_frame=${input.targetFrame ?? frame} if target_frame>#sprite.frames then fail("Target frame is outside the sprite") end
  local existing=target_layer:cel(target_frame) if existing~=nil then sprite:deleteCel(existing) end
  local image=action=="link" and cel.image or Image(cel.image)
  local target=sprite:newCel(target_layer,target_frame,image,Point(cel.position.x,cel.position.y)) target.opacity=cel.opacity target.zIndex=cel.zIndex
elseif action=="unlink" then cel.image=Image(cel.image)
else fail("Unsupported cel action") end
if not sprite:saveAs(${luaString(file.absolute)}) then fail("Unable to save sprite") end emit_result(sprite_summary(sprite)) sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteManageAnimation(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    action: "move_frame" | "copy_frame" | "reverse_range" | "set_durations" | "update_tag" | "tween_cel_position";
    layer?: string;
    easing?: "linear" | "ease_in" | "ease_out" | "smoothstep";
    targetX?: number;
    targetY?: number;
    frame?: number;
    targetFrame?: number;
    from?: number;
    to?: number;
    durations?: Array<{ frame: number; durationMs: number }>;
    tagName?: string;
    newName?: string;
    direction?: "forward" | "reverse" | "ping_pong";
    repeats?: number;
    expectedVersion?: string;
    checkpoint?: boolean;
  },
): Promise<ToolResponse> {
  try {
    await prepareMutation(config, registry, input.workspaceId, input.filePath, input, `animation-${input.action}`);
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    const durationLua = `{${(input.durations ?? []).map((item) => `{frame=${assertPositiveInteger(item.frame, "duration.frame")},duration=${Math.max(1, Math.min(60000, assertInteger(item.durationMs, "duration.durationMs"))) / 1000}}`).join(",")}}`;
    const directionLua = input.direction === "reverse" ? "AniDir.REVERSE" : input.direction === "ping_pong" ? "AniDir.PING_PONG" : "AniDir.FORWARD";
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
local action=${luaString(input.action)}
if action=="set_durations" then for _,item in ipairs(${durationLua}) do if item.frame>#sprite.frames then fail("Duration frame is outside the sprite") end sprite.frames[item.frame].duration=item.duration end
elseif action=="update_tag" then
  local tag=nil for _,item in ipairs(sprite.tags) do if item.name==${luaString(input.tagName ?? "")} then tag=item break end end if tag==nil then fail("Tag was not found") end
  ${input.newName ? `tag.name=${luaString(input.newName)}` : ""} tag.aniDir=${directionLua} ${input.repeats !== undefined ? `tag.repeats=${Math.max(0, assertInteger(input.repeats, "repeats"))}` : ""}
  ${input.from !== undefined && input.to !== undefined ? `tag.fromFrame=sprite.frames[${input.from}] tag.toFrame=sprite.frames[${input.to}]` : ""}
elseif action=="tween_cel_position" then
  local layer=find_layer(sprite.layers,${luaString(input.layer ?? "")})
  if layer==nil or layer.isGroup then fail("A drawable layer is required") end
  local first=${input.from ?? 1} local last=${input.to ?? 1}
  if first<1 or last>#sprite.frames or first>=last then fail("A valid tween frame range is required") end
  local first_cel=layer:cel(first)
  if first_cel==nil then fail("The first tween frame has no cel on the selected layer") end
  local start_x=first_cel.position.x local start_y=first_cel.position.y
  local end_x=${input.targetX ?? 0} local end_y=${input.targetY ?? 0}
  local easing=${luaString(input.easing ?? "smoothstep")}
  local function ease(t)
    if easing=="ease_in" then return t*t end
    if easing=="ease_out" then return 1-(1-t)*(1-t) end
    if easing=="smoothstep" then return t*t*(3-2*t) end
    return t
  end
  for frame_number=first,last do
    local cel=layer:cel(frame_number)
    if cel~=nil then local t=ease((frame_number-first)/(last-first)) cel.position=Point(math.floor(start_x+(end_x-start_x)*t+0.5),math.floor(start_y+(end_y-start_y)*t+0.5)) end
  end
else
  local frame=${input.frame ?? input.from ?? 1} local target=${input.targetFrame ?? input.to ?? 1}
  if frame<1 or frame>#sprite.frames or target<1 or target>#sprite.frames then fail("Frame is outside the sprite") end
  if action=="copy_frame" or action=="move_frame" then
    local source_frame=sprite.frames[frame]
    local duration=source_frame.duration
    local stored={}
    local function capture_layers(items)
      for _,candidate in ipairs(items) do
        if candidate.isGroup then capture_layers(candidate.layers)
        else
          local cel=candidate:cel(frame)
          if cel~=nil then table.insert(stored,{layer=candidate,image=Image(cel.image),position=Point(cel.position.x,cel.position.y),opacity=cel.opacity,z_index=cel.zIndex,data=cel.data}) end
        end
      end
    end
    capture_layers(sprite.layers)
    local insertion=target
    if action=="move_frame" and target>frame then insertion=target+1 end
    if insertion<1 or insertion>#sprite.frames+1 then fail("Target frame is outside the insertion range") end
    local inserted=sprite:newEmptyFrame(insertion)
    local inserted_number=inserted.frameNumber
    inserted.duration=duration
    for _,item in ipairs(stored) do local cel=sprite:newCel(item.layer,inserted_number,item.image,item.position) cel.opacity=item.opacity cel.zIndex=item.z_index cel.data=item.data end
    if action=="move_frame" then
      local original=target<=frame and frame+1 or frame
      sprite:deleteFrame(original)
    end
  elseif action=="reverse_range" then app.range.frames={} for index=${input.from ?? 1},${input.to ?? 1} do table.insert(app.range.frames,sprite.frames[index]) end app.command.ReverseFrames()
  else fail("Unsupported animation action") end
end
if not sprite:saveAs(${luaString(file.absolute)}) then fail("Unable to save sprite") end emit_result(sprite_summary(sprite)) sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteRunSafeCommand(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    command: "clear_cel" | "flatten" | "merge_down" | "background_from_layer" | "layer_from_background" | "reverse_frames" | "copy_merged_to_layer";
    layer?: string;
    frame?: number;
    from?: number;
    to?: number;
    outputLayerName?: string;
    expectedVersion?: string;
    checkpoint?: boolean;
  },
): Promise<ToolResponse> {
  try {
    await prepareMutation(config, registry, input.workspaceId, input.filePath, input, `safe-command-${input.command}`);
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
local command=${luaString(input.command)}
local layer=${input.layer ? `find_layer(sprite.layers,${luaString(input.layer)})` : "sprite.layers[1]"}
if command=="flatten" then sprite:flatten()
elseif command=="clear_cel" then if layer==nil or layer.isGroup then fail("Layer was not found") end local cel=layer:cel(${input.frame ?? 1}) if cel~=nil then cel.image:clear() end
elseif command=="merge_down" then if layer==nil then fail("Layer was not found") end app.activeLayer=layer app.command.MergeDownLayer()
elseif command=="background_from_layer" then if layer==nil then fail("Layer was not found") end app.activeLayer=layer app.command.BackgroundFromLayer()
elseif command=="layer_from_background" then if layer==nil then fail("Layer was not found") end app.activeLayer=layer app.command.LayerFromBackground()
elseif command=="reverse_frames" then app.range.frames={} for index=${input.from ?? 1},${input.to ?? "#sprite.frames"} do table.insert(app.range.frames,sprite.frames[index]) end app.command.ReverseFrames()
elseif command=="copy_merged_to_layer" then
  local output=sprite:newLayer() output.name=${luaString(input.outputLayerName ?? "Merged Copy")}
  for frame=1,#sprite.frames do local render=Image(sprite.spec) render:clear() render:drawSprite(sprite,frame,Point(0,0)) sprite:newCel(output,frame,render,Point(0,0)) end
else fail("Command is not in the safe allowlist") end
if not sprite:saveAs(${luaString(file.absolute)}) then fail("Unable to save sprite") end emit_result({command=command,summary=sprite_summary(sprite)}) sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}
