local BRIDGE_VERSION = "1.2.0"
local live_commands = nil
local POLL_INTERVAL = 0.10
local timer = nil
local bridge_root = nil
local requests_dir = nil
local responses_dir = nil
local auth_path = nil
local auth_token = nil

local function read_file(path)
  local file = io.open(path, "rb")
  if not file then return nil end
  local value = file:read("*a")
  file:close()
  return value
end

local function write_file(path, value)
  local file, err = io.open(path, "wb")
  if not file then error(err or "Unable to open output file", 0) end
  file:write(value)
  file:flush()
  file:close()
end

local function write_json_atomic(path, value)
  local temporary = path .. ".tmp"
  write_file(temporary, json.encode(value))
  os.remove(path)
  local ok, err = os.rename(temporary, path)
  if not ok then
    os.remove(temporary)
    error(err or "Unable to publish bridge response", 0)
  end
end

local function ensure_directories()
  bridge_root = app.fs.joinPath(app.fs.userConfigPath, "auvrynt-bridge")
  requests_dir = app.fs.joinPath(bridge_root, "requests")
  responses_dir = app.fs.joinPath(bridge_root, "responses")
  auth_path = app.fs.joinPath(bridge_root, "auth.json")
  app.fs.makeAllDirectories(requests_dir)
  app.fs.makeAllDirectories(responses_dir)
end

local function is_json_object(value)
  local kind = type(value)
  return kind == "table" or kind == "userdata"
end

local function refresh_auth_token()
  local raw = read_file(auth_path)
  if not raw then auth_token = nil return end
  local ok, value = pcall(json.decode, raw)
  auth_token = ok and is_json_object(value) and value.token or nil
end

local function sequence_length(value)
  if value == nil then return nil end
  local ok, count = pcall(function() return #value end)
  return ok and count or nil
end

local function color_table(color)
  if not color then return nil end
  return { r=color.red, g=color.green, b=color.blue, a=color.alpha }
end

local function color_from_request(value, fallback)
  -- NOTE: this JSON decoder represents decoded objects as either "table" or
  -- "userdata" (see is_json_object below, used elsewhere for the same
  -- reason). The previous type(value) ~= "table" check rejected the
  -- userdata case, silently discarding every color sent by the MCP client
  -- and falling back to fully-transparent black (or the untouched current
  -- foreground), which is why live strokes/pixels/set_colors appeared to
  -- draw nothing.
  if not is_json_object(value) then return fallback or Color() end
  return Color{
    r=math.max(0, math.min(255, tonumber(value.r) or 0)),
    g=math.max(0, math.min(255, tonumber(value.g) or 0)),
    b=math.max(0, math.min(255, tonumber(value.b) or 0)),
    a=math.max(0, math.min(255, tonumber(value.a) or 255)),
  }
end

local function plain_properties(properties)
  local result = {}
  if not properties then return result end
  for key, value in pairs(properties) do
    local value_type = type(value)
    if value_type == "string" or value_type == "number" or value_type == "boolean" then
      result[tostring(key)] = value
    else
      result[tostring(key)] = tostring(value)
    end
  end
  return result
end

local function flatten_layers(items, parent, result)
  for _, layer in ipairs(items) do
    table.insert(result, {
      id=tostring(layer.id),
      name=layer.name,
      parent=parent,
      isGroup=layer.isGroup,
      isTilemap=layer.isTilemap,
      isVisible=layer.isVisible,
      isEditable=layer.isEditable,
      opacity=layer.opacity,
      blendMode=tostring(layer.blendMode),
      celCount=#layer.cels,
      data=layer.data,
      properties=plain_properties(layer.properties),
    })
    if layer.isGroup then flatten_layers(layer.layers, layer.name, result) end
  end
end

local function find_layer(items, name_or_id)
  if name_or_id == nil then return nil end
  for _, layer in ipairs(items) do
    if layer.name == name_or_id or tostring(layer.id) == tostring(name_or_id) then return layer end
    if layer.isGroup then
      local nested = find_layer(layer.layers, name_or_id)
      if nested then return nested end
    end
  end
  return nil
end

local function find_sprite(request)
  local target = request.documentId or request.filename
  if target == nil then return app.activeSprite end
  for _, sprite in ipairs(app.sprites) do
    if tostring(sprite.id) == tostring(target) or sprite.filename == target then return sprite end
  end
  return nil
end

local function normalize_path(path)
  if type(path) ~= "string" or path == "" then return nil end
  return path:gsub("\\", "/"):lower()
end

local function find_open_sprite_by_path(path)
  local normalized = normalize_path(path)
  if not normalized then return nil end
  for _, sprite in ipairs(app.sprites) do
    if normalize_path(sprite.filename) == normalized then return sprite end
  end
  return nil
end

local function palette_rows(sprite)
  local result = {}
  if #sprite.palettes == 0 then return result end
  local palette = sprite.palettes[1]
  for index=0,#palette-1 do
    local color = palette:getColor(index)
    table.insert(result, {
      index=index,
      r=color.red,
      g=color.green,
      b=color.blue,
      a=index == sprite.transparentColor and 0 or color.alpha,
    })
  end
  return result
end

local function sprite_state(sprite)
  if not sprite then return nil end
  local layers = {}
  flatten_layers(sprite.layers, nil, layers)
  local frames = {}
  for _, frame in ipairs(sprite.frames) do
    table.insert(frames, { frame=frame.frameNumber, durationMs=math.floor(frame.duration*1000+0.5) })
  end
  local tags = {}
  for _, tag in ipairs(sprite.tags) do
    table.insert(tags, {
      name=tag.name,
      from=tag.fromFrame.frameNumber,
      to=tag.toFrame.frameNumber,
      direction=tostring(tag.aniDir),
      repeats=tag.repeats,
      data=tag.data,
      properties=plain_properties(tag.properties),
    })
  end
  local selection = sprite.selection
  local selection_bounds = nil
  if selection and not selection.isEmpty then
    selection_bounds = {
      x=selection.bounds.x,
      y=selection.bounds.y,
      width=selection.bounds.width,
      height=selection.bounds.height,
    }
  end
  local onionskin = app.preferences.document(sprite).onionskin
  local editor = app.editor
  local brush = app.activeBrush
  return {
    id=tostring(sprite.id),
    filename=sprite.filename,
    hasAssociatedFile=sprite.hasAssociatedFile,
    isModified=sprite.isModified,
    width=sprite.width,
    height=sprite.height,
    colorMode=tostring(sprite.colorMode),
    colorSpace=sprite.colorSpace and sprite.colorSpace.name or nil,
    transparentColor=sprite.transparentColor,
    pixelRatio={ width=sprite.pixelRatio.width, height=sprite.pixelRatio.height },
    grid={ x=sprite.gridBounds.x, y=sprite.gridBounds.y, width=sprite.gridBounds.width, height=sprite.gridBounds.height },
    frameCount=#sprite.frames,
    activeFrame=app.activeFrame and app.activeFrame.frameNumber or nil,
    activeLayer=app.activeLayer and { id=tostring(app.activeLayer.id), name=app.activeLayer.name } or nil,
    activeTool=app.activeTool and app.activeTool.id or nil,
    activeBrush=brush and { type=tostring(brush.type), size=brush.size, angle=brush.angle } or nil,
    foreground=color_table(app.fgColor),
    background=color_table(app.bgColor),
    editorZoom=editor and editor.zoom or nil,
    selection=selection_bounds,
    onionskin={
      active=onionskin.active,
      prevFrames=onionskin.prev_frames,
      nextFrames=onionskin.next_frames,
      opacityBase=onionskin.opacity_base,
      opacityStep=onionskin.opacity_step,
      loopTag=onionskin.loop_tag,
      currentLayer=onionskin.current_layer,
      type=tostring(onionskin.type),
      position=tostring(onionskin.position),
    },
    layers=layers,
    frames=frames,
    tags=tags,
    palette=palette_rows(sprite),
    data=sprite.data,
    properties=plain_properties(sprite.properties),
  }
end

local function document_list()
  local result = {}
  for _, sprite in ipairs(app.sprites) do
    table.insert(result, {
      id=tostring(sprite.id),
      filename=sprite.filename,
      width=sprite.width,
      height=sprite.height,
      frames=#sprite.frames,
      modified=sprite.isModified,
      active=sprite == app.activeSprite,
    })
  end
  return result
end

local function ensure_canvas_cel(sprite, layer, frame_number)
  local cel = layer:cel(frame_number)
  if cel == nil then
    local image = Image(sprite.spec)
    image:clear()
    cel = sprite:newCel(layer, frame_number, image, Point(0, 0))
  elseif cel.position.x ~= 0 or cel.position.y ~= 0 or cel.image.width ~= sprite.width or cel.image.height ~= sprite.height then
    local image = Image(sprite.spec)
    image:clear()
    image:drawImage(cel.image, cel.position)
    cel.image = image
    cel.position = Point(0, 0)
  end
  return cel
end

local function rgba_pixel(sprite, color)
  if sprite.colorMode == ColorMode.RGB then
    return app.pixelColor.rgba(color.red, color.green, color.blue, color.alpha)
  elseif sprite.colorMode == ColorMode.GRAY then
    local gray = math.floor((color.red*299 + color.green*587 + color.blue*114)/1000)
    return app.pixelColor.graya(gray, color.alpha)
  else
    local palette = sprite.palettes[1]
    local best = 0
    local distance = math.huge
    for index=0,#palette-1 do
      local candidate = palette:getColor(index)
      local dr=candidate.red-color.red
      local dg=candidate.green-color.green
      local db=candidate.blue-color.blue
      local da=(index == sprite.transparentColor and 0 or candidate.alpha)-color.alpha
      local current=dr*dr+dg*dg+db*db+da*da
      if current<distance then best=index distance=current end
    end
    return best
  end
end

local function set_active_target(sprite, request)
  app.activeSprite = sprite
  if request.layer then
    local layer = find_layer(sprite.layers, request.layer)
    if not layer then error("Layer was not found", 0) end
    app.activeLayer = layer
  end
  if request.frame then
    local frame_number = math.floor(tonumber(request.frame) or 0)
    if frame_number < 1 or frame_number > #sprite.frames then error("Frame is outside the sprite", 0) end
    app.activeFrame = sprite.frames[frame_number]
  end
end

local function capture_canvas(sprite, request)
  local frame_number = math.floor(tonumber(request.frame) or (app.activeFrame and app.activeFrame.frameNumber) or 1)
  if frame_number < 1 or frame_number > #sprite.frames then error("Frame is outside the sprite", 0) end
  local output_path = request.outputPath
  if type(output_path) ~= "string" or output_path == "" then error("outputPath is required", 0) end
  local scale = math.max(1, math.min(32, math.floor(tonumber(request.scale) or 1)))
  local render = Image(sprite.spec)
  render:clear()
  render:drawSprite(sprite, frame_number, Point(0, 0))
  if scale == 1 then
    if not render:saveAs(output_path) then error("Unable to save canvas capture", 0) end
  else
    local output = Image(sprite.width*scale, sprite.height*scale, ColorMode.RGB)
    output:clear()
    local palette = #sprite.palettes > 0 and sprite.palettes[1] or nil
    for y=0,sprite.height-1 do
      for x=0,sprite.width-1 do
        local source_pixel = render:getPixel(x,y)
        local color
        if sprite.colorMode == ColorMode.RGB then
          color = Color{
            r=app.pixelColor.rgbaR(source_pixel),
            g=app.pixelColor.rgbaG(source_pixel),
            b=app.pixelColor.rgbaB(source_pixel),
            a=app.pixelColor.rgbaA(source_pixel),
          }
        elseif sprite.colorMode == ColorMode.GRAY then
          local gray=app.pixelColor.grayaV(source_pixel)
          color=Color{r=gray,g=gray,b=gray,a=app.pixelColor.grayaA(source_pixel)}
        else
          local palette_color=palette:getColor(source_pixel)
          color=Color{r=palette_color.red,g=palette_color.green,b=palette_color.blue,a=source_pixel==sprite.transparentColor and 0 or palette_color.alpha}
        end
        local pixel=app.pixelColor.rgba(color.red,color.green,color.blue,color.alpha)
        for dy=0,scale-1 do for dx=0,scale-1 do output:drawPixel(x*scale+dx,y*scale+dy,pixel) end end
      end
    end
    if not output:saveAs(output_path) then error("Unable to save scaled canvas capture", 0) end
  end
  return { outputPath=output_path, frame=frame_number, width=sprite.width*scale, height=sprite.height*scale, scale=scale }
end

local SAFE_COMMANDS = {
  DuplicateLayer=true,
  MergeDownLayer=true,
  FlattenLayers=true,
  BackgroundFromLayer=true,
  LayerFromBackground=true,
  ReverseFrames=true,
  ClearCel=true,
  NewFrame=true,
  RemoveFrame=true,
  NewLayer=true,
  RemoveLayer=true,
}

local function handle_request(request)
  local action = request.action
  if action == "status" then
    return { bridgeVersion=BRIDGE_VERSION, asepriteVersion=tostring(app.version), apiVersion=app.apiVersion, uiAvailable=app.isUIAvailable, documents=#app.sprites, liveCommands=live_commands.names(), active=sprite_state(app.activeSprite) }
  elseif action == "list_documents" then
    return { documents=document_list() }
  elseif action == "new_document" then
    local width=math.max(1,math.min(8192,math.floor(tonumber(request.width) or 1)))
    local height=math.max(1,math.min(8192,math.floor(tonumber(request.height) or 1)))
    local mode=request.colorMode == "indexed" and ColorMode.INDEXED or request.colorMode == "grayscale" and ColorMode.GRAY or ColorMode.RGB
    local sprite=Sprite(width,height,mode)
    app.activeSprite=sprite
    return { document=sprite_state(sprite) }
  elseif action == "open_document" then
    if type(request.path)~="string" or request.path=="" then error("path is required",0) end
    -- Reuse an already-open document for this path instead of calling
    -- app.open() again. This makes the action idempotent: if a caller times
    -- out waiting for a slow open and retries with a new request id, the
    -- retry attaches to the same sprite instead of opening a duplicate tab.
    local sprite=find_open_sprite_by_path(request.path)
    if not sprite then
      sprite=app.open(request.path)
      if not sprite then error("Unable to open document",0) end
    end
    app.activeSprite=sprite
    return { document=sprite_state(sprite) }
  end

  local sprite = find_sprite(request)
  if not sprite then error("Aseprite document was not found", 0) end
  set_active_target(sprite, request)

  if action == "inspect" or action == "select_document" or action == "select_layer" or action == "select_frame" then
    return { document=sprite_state(sprite) }
  elseif action == "save" then
    if sprite.filename == "" then error("Document has no associated filename; use save_as", 0) end
    if not sprite:saveAs(sprite.filename) then error("Unable to save document", 0) end
  elseif action == "save_as" then
    if type(request.path)~="string" or request.path=="" then error("path is required",0) end
    if not sprite:saveAs(request.path) then error("Unable to save document",0) end
  elseif action == "close_document" then
    if sprite.isModified and request.discardChanges ~= true then error("Document has unsaved changes; set discardChanges=true to close it",0) end
    sprite:close()
    return { closed=true, documents=document_list() }
  elseif action == "undo" then app.undo()
  elseif action == "redo" then app.redo()
  elseif action == "toggle_playback" then app.command.PlayAnimation()
  elseif action == "set_zoom" then
    if not app.editor then error("No active editor",0) end
    app.editor.zoom=math.max(0.01,math.min(64,tonumber(request.zoom) or 1))
  elseif action == "set_onion_skin" then
    local prefs=app.preferences.document(sprite).onionskin
    if request.active~=nil then prefs.active=request.active==true end
    if request.prevFrames~=nil then prefs.prev_frames=math.max(0,math.floor(request.prevFrames)) end
    if request.nextFrames~=nil then prefs.next_frames=math.max(0,math.floor(request.nextFrames)) end
    if request.opacityBase~=nil then prefs.opacity_base=math.max(0,math.min(255,math.floor(request.opacityBase))) end
    if request.opacityStep~=nil then prefs.opacity_step=math.max(0,math.min(255,math.floor(request.opacityStep))) end
    if request.loopTag~=nil then prefs.loop_tag=request.loopTag==true end
    if request.currentLayer~=nil then prefs.current_layer=request.currentLayer==true end
  elseif action == "set_tool" then
    if type(request.tool)~="string" or request.tool=="" then error("tool is required",0) end
    app.activeTool=request.tool
  elseif action == "set_colors" then
    if request.foreground then app.fgColor=color_from_request(request.foreground,app.fgColor) end
    if request.background then app.bgColor=color_from_request(request.background,app.bgColor) end
  elseif action == "set_brush" then
    local brush_type=request.brushType=="square" and BrushType.SQUARE or request.brushType=="line" and BrushType.LINE or BrushType.CIRCLE
    app.activeBrush=Brush{type=brush_type,size=math.max(1,math.min(256,math.floor(tonumber(request.size) or 1))),angle=math.floor(tonumber(request.angle) or 0)}
  elseif action == "set_selection" then
    local bounds=request.bounds
    if type(bounds)~="table" then error("bounds is required",0) end
    local rectangle=Rectangle(math.floor(bounds.x or 0),math.floor(bounds.y or 0),math.max(1,math.floor(bounds.width or 1)),math.max(1,math.floor(bounds.height or 1)))
    local selection=sprite.selection
    local mode=request.mode or "replace"
    if mode=="replace" then selection:select(rectangle)
    elseif mode=="add" then selection:add(rectangle)
    elseif mode=="subtract" then selection:subtract(rectangle)
    elseif mode=="intersect" then selection:intersect(rectangle)
    else error("Unsupported selection mode",0) end
  elseif action == "clear_selection" then sprite.selection:deselect()
  elseif action == "capture_canvas" then return capture_canvas(sprite,request)
  elseif action == "run_live_command" then
    local result = live_commands.run(sprite, request)
    app.refresh()
    return { command=request.liveCommand, result=result, document=sprite_state(app.activeSprite) }
  elseif action == "set_pixels" then
    local layer=app.activeLayer or sprite.layers[1]
    if layer.isGroup or layer.isTilemap then error("A normal drawable layer is required",0) end
    local frame_number=app.activeFrame and app.activeFrame.frameNumber or 1
    local image=ensure_canvas_cel(sprite,layer,frame_number).image
    local pixels=request.pixels
    local pixel_count=sequence_length(pixels)
    if not pixel_count or pixel_count>8192 then error("pixels must contain at most 8192 entries",0) end
    for index=1,pixel_count do
      local entry=pixels[index]
      local x=math.floor(tonumber(entry.x) or -1) local y=math.floor(tonumber(entry.y) or -1)
      if x<0 or y<0 or x>=sprite.width or y>=sprite.height then error("Pixel is outside the sprite",0) end
      image:drawPixel(x,y,rgba_pixel(sprite,color_from_request(entry.color)))
    end
  elseif action == "draw_stroke" then
    local points={}
    local point_count=sequence_length(request.points)
    if not point_count or point_count<1 or point_count>16384 then error("points must contain 1-16384 entries",0) end
    for index=1,point_count do local entry=request.points[index] table.insert(points,Point(math.floor(entry.x),math.floor(entry.y))) end
    app.useTool{
      tool=request.tool or "pencil",
      color=color_from_request(request.color,app.fgColor),
      opacity=math.max(0,math.min(255,math.floor(tonumber(request.opacity) or 255))),
      brush=Brush{type=BrushType.CIRCLE,size=math.max(1,math.min(256,math.floor(tonumber(request.size) or 1)))},
      freehandAlgorithm=request.pixelPerfect==true and 1 or 0,
      points=points,
    }
  elseif action == "create_layer" then
    local layer=request.group==true and sprite:newGroup() or sprite:newLayer()
    layer.name=request.name or (request.group==true and "Group" or "Layer")
    app.activeLayer=layer
  elseif action == "create_frame" then
    local index=math.max(1,math.min(#sprite.frames+1,math.floor(tonumber(request.frame) or (#sprite.frames+1))))
    local frame=request.duplicate==true and sprite:newFrame(math.min(index,#sprite.frames)) or sprite:newEmptyFrame(index)
    if request.durationMs then frame.duration=math.max(1,math.floor(request.durationMs))/1000 end
    app.activeFrame=frame
  elseif action == "delete_frame" then
    local frame_number=app.activeFrame and app.activeFrame.frameNumber or 1
    if #sprite.frames<=1 then error("Cannot delete the only frame",0) end
    sprite:deleteFrame(frame_number)
  elseif action == "set_frame_duration" then
    local frame=app.activeFrame or sprite.frames[1]
    frame.duration=math.max(1,math.min(60000,math.floor(tonumber(request.durationMs) or 100)))/1000
  elseif action == "safe_command" then
    local command=request.command
    if not SAFE_COMMANDS[command] then error("Command is not allowlisted",0) end
    local fn=app.command[command]
    if type(fn)~="function" then error("Aseprite command is unavailable",0) end
    fn(request.params or {})
  else
    error("Unsupported Auvrynt bridge action: "..tostring(action),0)
  end
  app.refresh()
  return { document=sprite_state(sprite) }
end

local function process_request_file(filename)
  local request_path=app.fs.joinPath(requests_dir,filename)
  local claimed_path=request_path..".processing"
  -- Claim the request file (rename it out of the requests directory) before
  -- doing any work, rather than after. Previously the file was only removed
  -- once handle_request finished, so a slow handler (e.g. open_document on a
  -- large sprite) left it visible to the requests listing for the whole
  -- duration of the call. Claiming it up front closes that window entirely.
  if not os.rename(request_path,claimed_path) then return end
  local raw=read_file(claimed_path)
  if not raw then os.remove(claimed_path) return end
  local response={ok=false}
  local request_id=app.fs.fileTitle(filename)
  local decode_ok,request=pcall(json.decode,raw)
  if not decode_ok or not is_json_object(request) then
    response.error="Invalid request JSON"
  elseif not auth_token or request.token~=auth_token then
    response.error="Invalid bridge token"
  elseif tostring(request.id or "")~=request_id then
    response.error="Request ID mismatch"
  else
    local ok,result=pcall(handle_request,request)
    if ok then response.ok=true response.result=result
    else response.error=tostring(result) end
  end
  response.id=request_id
  response.bridgeVersion=BRIDGE_VERSION
  local response_path=app.fs.joinPath(responses_dir,request_id..".json")
  pcall(write_json_atomic,response_path,response)
  os.remove(claimed_path)
end

local function poll_requests()
  if not auth_token then refresh_auth_token() end
  local files=app.fs.listFiles(requests_dir)
  table.sort(files)
  local processed=0
  for _,filename in ipairs(files) do
    if filename:match("^[%w%-_]+%.json$") then
      process_request_file(filename)
      processed=processed+1
      if processed>=16 then break end
    end
  end
end

function init(plugin)
  -- Aseprite does not guarantee that an extension's directory is in Lua's
  -- module search path. Configure it before loading the bridge's sibling
  -- modules; otherwise the plugin fails during initialization and its timer
  -- never starts polling the request queue.
  local extension_module_path = app.fs.joinPath(plugin.path, "?.lua")
  if not package.path:find(extension_module_path, 1, true) then
    package.path = extension_module_path .. ";" .. package.path
  end
  live_commands = require("live_commands")
  ensure_directories()
  refresh_auth_token()
  timer=Timer{interval=POLL_INTERVAL,ontick=poll_requests}
  timer:start()
  pcall(function()
    plugin:newCommand{
      id="auvrynt_bridge_status",
      title="Auvrynt Bridge Status",
      group="cel_properties",
      onclick=function()
        app.alert{
          title="Auvrynt Bridge",
          text={
            "Bridge version: "..BRIDGE_VERSION,
            auth_token and "Authenticated request queue is ready." or "Waiting for Auvrynt authentication file.",
            bridge_root,
          },
        }
      end,
    }
  end)
end

function exit(plugin)
  if timer then timer:stop() timer=nil end
end
