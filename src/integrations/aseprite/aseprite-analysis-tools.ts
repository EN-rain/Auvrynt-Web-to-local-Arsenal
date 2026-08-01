import type { ServerConfig } from "../../config.js";
import type { ToolResponse } from "../../pi-tools.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import {
  assertInteger,
  assertPositiveInteger,
  errorResponse,
  luaString,
  openSpriteScript,
  runLua,
  textResponse,
  workspacePath,
} from "./aseprite-tools.js";

const MAX_READ_PIXELS = 65_536;
const MAX_ANALYSIS_PIXELS = 4_194_304;

export interface AsepriteRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

function normalizeRegion(region: AsepriteRegion | undefined): AsepriteRegion | undefined {
  if (!region) return undefined;
  return {
    x: assertInteger(region.x, "region.x"),
    y: assertInteger(region.y, "region.y"),
    width: assertPositiveInteger(region.width, "region.width"),
    height: assertPositiveInteger(region.height, "region.height"),
  };
}

export async function asepriteReadPixels(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    layer?: string;
    frame?: number;
    region?: AsepriteRegion;
    format?: "rows" | "points" | "histogram";
    includeTransparent?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    const frame = input.frame === undefined ? 1 : assertPositiveInteger(input.frame, "frame");
    const region = normalizeRegion(input.region);
    const format = input.format ?? "rows";
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
local layer = ${input.layer ? `find_layer(sprite.layers, ${luaString(input.layer)})` : "sprite.layers[1]"}
if layer == nil or layer.isGroup then fail("A drawable layer was not found") end
if ${frame} > #sprite.frames then fail("Frame is outside the sprite") end
local x0 = ${region?.x ?? 0}
local y0 = ${region?.y ?? 0}
local width = ${region?.width ?? "sprite.width"}
local height = ${region?.height ?? "sprite.height"}
if x0 < 0 or y0 < 0 or x0 + width > sprite.width or y0 + height > sprite.height then fail("Region is outside the sprite") end
if width * height > ${MAX_READ_PIXELS} then fail("Requested region exceeds ${MAX_READ_PIXELS} pixels") end
local format = ${luaString(format)}
local rows = {}
local index_rows = {}
local points = {}
local histogram = {}
local transparent = 0
local semi_transparent = 0
local bounds = nil
for y = y0, y0 + height - 1 do
  local row = {}
  local index_row = {}
  for x = x0, x0 + width - 1 do
    local color = canvas_pixel(sprite, layer, ${frame}, x, y)
    local hex = rgba_hex(color)
    histogram[hex] = (histogram[hex] or 0) + 1
    if color.a == 0 then transparent = transparent + 1
    elseif color.a < 255 then semi_transparent = semi_transparent + 1 end
    if color.a > 0 then
      if bounds == nil then bounds = { x=x, y=y, right=x, bottom=y }
      else
        if x < bounds.x then bounds.x = x end
        if y < bounds.y then bounds.y = y end
        if x > bounds.right then bounds.right = x end
        if y > bounds.bottom then bounds.bottom = y end
      end
    end
    if format == "rows" then
      table.insert(row, hex)
      if color.index ~= nil then table.insert(index_row, color.index) end
    elseif format == "points" and (${input.includeTransparent === true ? "true" : "false"} or color.a > 0) then
      table.insert(points, { x=x, y=y, color=hex, index=color.index })
    end
  end
  if format == "rows" then
    table.insert(rows, row)
    if #index_row > 0 then table.insert(index_rows, index_row) end
  end
end
if bounds ~= nil then
  bounds.width = bounds.right - bounds.x + 1
  bounds.height = bounds.bottom - bounds.y + 1
  bounds.right = nil
  bounds.bottom = nil
end
local histogram_rows = {}
for color, count in pairs(histogram) do table.insert(histogram_rows, { color=color, count=count }) end
table.sort(histogram_rows, function(a, b) if a.count == b.count then return a.color < b.color else return a.count > b.count end end)
emit_result({
  file=${luaString(file.relative)}, layer=layer.name, frame=${frame},
  region={x=x0,y=y0,width=width,height=height}, format=format,
  rows=format == "rows" and rows or nil,
  palette_indices=(format == "rows" and #index_rows > 0) and index_rows or nil,
  points=format == "points" and points or nil,
  histogram=histogram_rows,
  alpha_bounds=bounds,
  transparent_pixels=transparent,
  semi_transparent_pixels=semi_transparent,
})
sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteAuditSprite(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    isolatedNeighborMode?: 4 | 8;
  },
): Promise<ToolResponse> {
  try {
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    const neighbors = input.isolatedNeighborMode === 4 ? 4 : 8;
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
if sprite.width * sprite.height * #sprite.frames > ${MAX_ANALYSIS_PIXELS} then fail("Sprite is too large for a full audit") end
local issues = {}
local colors = {}
local frame_rows = {}
local duplicate_map = {}
local empty_frames = {}
local semi = 0
local isolated = 0
local occupied_total = 0
local linked_images = {}
for _, cel in ipairs(sprite.cels) do
  local id = tostring(cel.image.id or cel.image)
  linked_images[id] = (linked_images[id] or 0) + 1
end
for frame_number = 1, #sprite.frames do
  local render = Image(sprite.spec)
  render:clear()
  render:drawSprite(sprite, frame_number, Point(0, 0))
  local hash_parts = {}
  local bounds = nil
  local occupied = 0
  local frame_semi = 0
  local frame_isolated = 0
  for y = 0, sprite.height - 1 do
    for x = 0, sprite.width - 1 do
      local color = pixel_rgba(sprite, render:getPixel(x, y))
      local hex = rgba_hex(color)
      table.insert(hash_parts, hex)
      colors[hex] = (colors[hex] or 0) + 1
      if color.a > 0 then
        occupied = occupied + 1
        occupied_total = occupied_total + 1
        if color.a < 255 then semi = semi + 1; frame_semi = frame_semi + 1 end
        if bounds == nil then bounds = {x=x,y=y,right=x,bottom=y}
        else
          if x < bounds.x then bounds.x=x end
          if y < bounds.y then bounds.y=y end
          if x > bounds.right then bounds.right=x end
          if y > bounds.bottom then bounds.bottom=y end
        end
        local count = 0
        for dy=-1,1 do for dx=-1,1 do
          if not (dx == 0 and dy == 0) and (${neighbors} == 8 or dx == 0 or dy == 0) then
            local nx=x+dx local ny=y+dy
            if nx>=0 and ny>=0 and nx<sprite.width and ny<sprite.height then
              if pixel_rgba(sprite, render:getPixel(nx, ny)).a > 0 then count=count+1 end
            end
          end
        end end
        if count == 0 then isolated=isolated+1; frame_isolated=frame_isolated+1 end
      end
    end
  end
  if bounds ~= nil then
    bounds.width=bounds.right-bounds.x+1 bounds.height=bounds.bottom-bounds.y+1 bounds.right=nil bounds.bottom=nil
  else table.insert(empty_frames, frame_number) end
  local hash = table.concat(hash_parts)
  if duplicate_map[hash] == nil then duplicate_map[hash] = {frame_number}
  else table.insert(duplicate_map[hash], frame_number) end
  table.insert(frame_rows, {
    frame=frame_number,
    duration_ms=math.floor(sprite.frames[frame_number].duration*1000+0.5),
    occupied_pixels=occupied,
    occupancy=occupied/(sprite.width*sprite.height),
    alpha_bounds=bounds,
    semi_transparent_pixels=frame_semi,
    isolated_pixels=frame_isolated,
  })
end
local duplicates = {}
for _, frames in pairs(duplicate_map) do if #frames > 1 then table.insert(duplicates, frames) end end
local palette = {}
local unused_palette = {}
local duplicate_palette = {}
if #sprite.palettes > 0 then
  local seen = {}
  local pal = sprite.palettes[1]
  for index=0,#pal-1 do
    local c=pal:getColor(index)
    local hex=rgba_hex({r=c.red,g=c.green,b=c.blue,a=(index==sprite.transparentColor and 0 or c.alpha)})
    table.insert(palette,{index=index,color=hex})
    if colors[hex] == nil then table.insert(unused_palette,index) end
    if seen[hex] ~= nil then table.insert(duplicate_palette,{index=index,duplicate_of=seen[hex],color=hex}) else seen[hex]=index end
  end
end
local overlapping_tags = {}
for i=1,#sprite.tags do for j=i+1,#sprite.tags do
  local a=sprite.tags[i] local b=sprite.tags[j]
  if a.fromFrame.frameNumber <= b.toFrame.frameNumber and b.fromFrame.frameNumber <= a.toFrame.frameNumber then
    table.insert(overlapping_tags,{first=a.name,second=b.name})
  end
end end
local linked_groups = 0
for _, count in pairs(linked_images) do if count > 1 then linked_groups=linked_groups+1 end end
if #empty_frames > 0 then table.insert(issues,{severity="warning",code="empty_frames",frames=empty_frames}) end
if #duplicates > 0 then table.insert(issues,{severity="info",code="duplicate_frames",groups=duplicates}) end
if semi > 0 then table.insert(issues,{severity="warning",code="semi_transparent_pixels",count=semi}) end
if isolated > 0 then table.insert(issues,{severity="info",code="isolated_pixels",count=isolated}) end
if #unused_palette > 0 then table.insert(issues,{severity="info",code="unused_palette_entries",indices=unused_palette}) end
if #duplicate_palette > 0 then table.insert(issues,{severity="info",code="duplicate_palette_entries",entries=duplicate_palette}) end
if #overlapping_tags > 0 then table.insert(issues,{severity="warning",code="overlapping_tags",pairs=overlapping_tags}) end
if #sprite.tags == 0 and #sprite.frames > 1 then table.insert(issues,{severity="warning",code="animation_without_tags"}) end
local average_occupancy = occupied_total / (sprite.width*sprite.height*#sprite.frames)
if average_occupancy < 0.05 then table.insert(issues,{severity="info",code="oversized_canvas",average_occupancy=average_occupancy}) end
emit_result({
  file=${luaString(file.relative)}, width=sprite.width, height=sprite.height,
  frames=frame_rows, issues=issues, colors_used=colors, palette=palette,
  linked_cel_groups=linked_groups, average_occupancy=average_occupancy,
})
sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteCompareDocuments(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    referencePath: string;
    candidatePath: string;
    comparePixels?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const reference = workspacePath(registry, input.workspaceId, input.referencePath);
    const candidate = workspacePath(registry, input.workspaceId, input.candidatePath);
    const result = await runLua(config, registry, input.workspaceId, `
local reference = app.open(${luaString(reference.absolute)})
if reference == nil then fail("Unable to open reference sprite") end
local candidate = app.open(${luaString(candidate.absolute)})
if candidate == nil then fail("Unable to open candidate sprite") end
if math.max(reference.width,candidate.width)*math.max(reference.height,candidate.height)*math.max(#reference.frames,#candidate.frames) > ${MAX_ANALYSIS_PIXELS} then fail("Documents are too large for full comparison") end
local differences = {}
local function add(code, expected, actual) table.insert(differences,{code=code,expected=expected,actual=actual}) end
if reference.width ~= candidate.width then add("width",reference.width,candidate.width) end
if reference.height ~= candidate.height then add("height",reference.height,candidate.height) end
if reference.colorMode ~= candidate.colorMode then add("color_mode",color_mode_name(reference.colorMode),color_mode_name(candidate.colorMode)) end
if #reference.frames ~= #candidate.frames then add("frame_count",#reference.frames,#candidate.frames) end
local ref_summary=sprite_summary(reference)
local cand_summary=sprite_summary(candidate)
local function encode(value) return json.encode(value) end
if encode(ref_summary.layers) ~= encode(cand_summary.layers) then add("layers",ref_summary.layers,cand_summary.layers) end
if encode(ref_summary.frames) ~= encode(cand_summary.frames) then add("frame_timing",ref_summary.frames,cand_summary.frames) end
if encode(ref_summary.tags) ~= encode(cand_summary.tags) then add("tags",ref_summary.tags,cand_summary.tags) end
if encode(ref_summary.slices) ~= encode(cand_summary.slices) then add("slices",ref_summary.slices,cand_summary.slices) end
local palette_changes = {}
local ref_pal = #reference.palettes > 0 and reference.palettes[1] or nil
local cand_pal = #candidate.palettes > 0 and candidate.palettes[1] or nil
local pal_count = math.max(ref_pal and #ref_pal or 0,cand_pal and #cand_pal or 0)
for index=0,pal_count-1 do
  local a=ref_pal and index<#ref_pal and ref_pal:getColor(index) or nil
  local b=cand_pal and index<#cand_pal and cand_pal:getColor(index) or nil
  local ah=a and rgba_hex({r=a.red,g=a.green,b=a.blue,a=a.alpha}) or nil
  local bh=b and rgba_hex({r=b.red,g=b.green,b=b.blue,a=b.alpha}) or nil
  if ah~=bh then table.insert(palette_changes,{index=index,reference=ah,candidate=bh}) end
end
local pixel_frames = {}
local changed_total = 0
if ${input.comparePixels === false ? "false" : "true"} then
  local max_frames=math.max(#reference.frames,#candidate.frames)
  local max_width=math.max(reference.width,candidate.width)
  local max_height=math.max(reference.height,candidate.height)
  for frame=1,max_frames do
    local a=Image{width=max_width,height=max_height,colorMode=ColorMode.RGB}
    local b=Image{width=max_width,height=max_height,colorMode=ColorMode.RGB}
    a:clear() b:clear()
    if frame<=#reference.frames then a:drawSprite(reference,frame,Point(0,0)) end
    if frame<=#candidate.frames then b:drawSprite(candidate,frame,Point(0,0)) end
    local changed=0
    local bounds=nil
    for y=0,max_height-1 do for x=0,max_width-1 do
      if a:getPixel(x,y) ~= b:getPixel(x,y) then
        changed=changed+1 changed_total=changed_total+1
        if bounds==nil then bounds={x=x,y=y,right=x,bottom=y}
        else
          if x<bounds.x then bounds.x=x end if y<bounds.y then bounds.y=y end
          if x>bounds.right then bounds.right=x end if y>bounds.bottom then bounds.bottom=y end
        end
      end
    end end
    if bounds~=nil then bounds.width=bounds.right-bounds.x+1 bounds.height=bounds.bottom-bounds.y+1 bounds.right=nil bounds.bottom=nil end
    table.insert(pixel_frames,{frame=frame,changed_pixels=changed,bounds=bounds})
  end
end
emit_result({
  reference=${luaString(reference.relative)},candidate=${luaString(candidate.relative)},
  exact_match=#differences==0 and #palette_changes==0 and changed_total==0,
  structural_differences=differences,palette_changes=palette_changes,
  changed_pixels=changed_total,pixel_frames=pixel_frames,
})
reference:close() candidate:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteAnimationAudit(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    tag?: string;
    anchorLayer?: string;
  },
): Promise<ToolResponse> {
  try {
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
if sprite.width*sprite.height*#sprite.frames > ${MAX_ANALYSIS_PIXELS} then fail("Animation is too large for a full audit") end
local from_frame=1 local to_frame=#sprite.frames
${input.tag ? `
local selected_tag=nil
for _,tag in ipairs(sprite.tags) do if tag.name==${luaString(input.tag)} then selected_tag=tag break end end
if selected_tag==nil then fail("Animation tag was not found") end
from_frame=selected_tag.fromFrame.frameNumber to_frame=selected_tag.toFrame.frameNumber
` : ""}
local anchor_layer=${input.anchorLayer ? `find_layer(sprite.layers,${luaString(input.anchorLayer)})` : "nil"}
if ${input.anchorLayer ? "true" : "false"} and (anchor_layer==nil or anchor_layer.isGroup) then fail("Anchor layer was not found") end
local frames={}
local previous=nil
local first=nil
local duplicate_pairs={}
local duration_sum=0
for frame=from_frame,to_frame do
  local render=Image(sprite.spec) render:clear() render:drawSprite(sprite,frame,Point(0,0))
  local bounds=nil local occupied=0 local sum_x=0 local sum_y=0 local changed=0
  local anchor_bounds=nil
  for y=0,sprite.height-1 do for x=0,sprite.width-1 do
    local c=pixel_rgba(sprite,render:getPixel(x,y))
    if c.a>0 then
      occupied=occupied+1 sum_x=sum_x+x sum_y=sum_y+y
      if bounds==nil then bounds={x=x,y=y,right=x,bottom=y}
      else if x<bounds.x then bounds.x=x end if y<bounds.y then bounds.y=y end if x>bounds.right then bounds.right=x end if y>bounds.bottom then bounds.bottom=y end end
    end
    if previous~=nil and render:getPixel(x,y)~=previous:getPixel(x,y) then changed=changed+1 end
    if anchor_layer~=nil then
      local ac=canvas_pixel(sprite,anchor_layer,frame,x,y)
      if ac.a>0 then
        if anchor_bounds==nil then anchor_bounds={x=x,y=y,right=x,bottom=y}
        else if x<anchor_bounds.x then anchor_bounds.x=x end if y<anchor_bounds.y then anchor_bounds.y=y end if x>anchor_bounds.right then anchor_bounds.right=x end if y>anchor_bounds.bottom then anchor_bounds.bottom=y end end
      end
    end
  end end
  if bounds~=nil then bounds.width=bounds.right-bounds.x+1 bounds.height=bounds.bottom-bounds.y+1 bounds.center_x=sum_x/occupied bounds.center_y=sum_y/occupied bounds.right=nil bounds.bottom=nil end
  if anchor_bounds~=nil then anchor_bounds.width=anchor_bounds.right-anchor_bounds.x+1 anchor_bounds.height=anchor_bounds.bottom-anchor_bounds.y+1 anchor_bounds.right=nil anchor_bounds.bottom=nil end
  local duration=math.floor(sprite.frames[frame].duration*1000+0.5) duration_sum=duration_sum+duration
  if previous~=nil and changed==0 then table.insert(duplicate_pairs,{previous=frame-1,current=frame}) end
  table.insert(frames,{frame=frame,duration_ms=duration,bounds=bounds,anchor_bounds=anchor_bounds,changed_from_previous=changed,motion_ratio=changed/(sprite.width*sprite.height)})
  if first==nil then first=Image(render) end previous=Image(render)
end
local loop_difference=0
if first~=nil and previous~=nil then for y=0,sprite.height-1 do for x=0,sprite.width-1 do if first:getPixel(x,y)~=previous:getPixel(x,y) then loop_difference=loop_difference+1 end end end end
local average_duration=duration_sum/#frames
local issues={}
for _,row in ipairs(frames) do
  if row.duration_ms>average_duration*2 or row.duration_ms<average_duration*0.5 then table.insert(issues,{severity="info",code="duration_outlier",frame=row.frame,duration_ms=row.duration_ms,average_ms=average_duration}) end
end
for i=2,#frames do
  local a=frames[i-1].bounds local b=frames[i].bounds
  if a~=nil and b~=nil then
    local dx=b.center_x-a.center_x local dy=b.center_y-a.center_y
    frames[i].center_delta={x=dx,y=dy}
    frames[i].baseline_delta=b.y+b.height-(a.y+a.height)
  end
end
if #duplicate_pairs>0 then table.insert(issues,{severity="info",code="duplicate_consecutive_frames",pairs=duplicate_pairs}) end
if loop_difference>sprite.width*sprite.height*0.25 then table.insert(issues,{severity="warning",code="loop_discontinuity",changed_pixels=loop_difference}) end
emit_result({file=${luaString(file.relative)},from=from_frame,to=to_frame,frames=frames,average_duration_ms=average_duration,loop_changed_pixels=loop_difference,issues=issues})
sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}
