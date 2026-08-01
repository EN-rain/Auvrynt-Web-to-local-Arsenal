import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import type { ServerConfig } from "../../config.js";
import type { ToolResponse } from "../../pi-tools.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import { discoverLocalIntegrations, processDetected } from "../integration-discovery.js";

const execFileAsync = promisify(execFile);
const RESULT_PREFIX = "AUVRYNT_RESULT:";
const ASEPRITE_TIMEOUT_MS = 60_000;
const MAX_PIXEL_EDITS = 8_192;
const MAX_SHAPES = 1_024;

export type AsepriteColorMode = "rgb" | "grayscale" | "indexed";
export type AsepriteTagDirection = "forward" | "reverse" | "ping_pong";

export interface AsepritePixelEdit {
  x: number;
  y: number;
  color: string;
}

export type AsepriteShape =
  | { type: "point"; x: number; y: number; color: string }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number; color: string }
  | { type: "rect"; x: number; y: number; width: number; height: number; color: string; fill?: boolean };

export function textResponse(value: unknown): ToolResponse {
  return {
    content: [{
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    }],
  };
}

export function errorResponse(message: string): ToolResponse {
  return { content: [{ type: "text", text: message }], isError: true };
}

// Third-party Aseprite extensions (e.g. pixellab and other community scripts)
// print their own Lua tracebacks straight to stdout/stderr when they error,
// and those extensions run inside the same headless Aseprite process we
// shell out to. Left unfiltered, that noise bleeds into our own tool output
// on every call that captures stdout/stderr. Strip any line that looks like
// a third-party extension's Lua traceback before returning CLI output.
const EXTENSION_TRACEBACK_LINE = /extensions[\\/].*\.lua:\d+/i;

export function sanitizeCliOutput(output: string): string {
  if (!output) return output;
  return output
    .split(/\r?\n/)
    .filter((line) => !EXTENSION_TRACEBACK_LINE.test(line))
    .join("\n")
    .trim();
}

function cleanPath(value: string | undefined): string | undefined {
  const cleaned = value?.trim().replace(/^["']|["']$/g, "").trim();
  return cleaned || undefined;
}

function sourceExecutableCandidates(sourcePath: string | undefined): string[] {
  if (!sourcePath) return [];
  return process.platform === "win32"
    ? [
        join(sourcePath, "build", "bin", "aseprite.exe"),
        join(sourcePath, "bin", "aseprite.exe"),
        join(sourcePath, "aseprite.exe"),
      ]
    : [
        join(sourcePath, "build", "bin", "aseprite"),
        join(sourcePath, "bin", "aseprite"),
        join(sourcePath, "aseprite"),
      ];
}

async function findOnPath(): Promise<string | undefined> {
  try {
    const command = process.platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(command, ["aseprite"], {
      timeout: 5_000,
      windowsHide: true,
    });
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  } catch {
    return undefined;
  }
}

export async function resolveAsepriteExecutable(config: ServerConfig): Promise<string> {
  const direct = cleanPath(config.executables.aseprite ?? process.env.AUVRYNT_ASEPRITE_PATH);
  if (direct && existsSync(direct)) return direct;

  const sourcePath = cleanPath(
    config.executables.asepriteSource ?? process.env.AUVRYNT_ASEPRITE_SOURCE_PATH,
  );
  for (const candidate of sourceExecutableCandidates(sourcePath)) {
    if (existsSync(candidate)) return candidate;
  }

  const discovered = await findOnPath();
  if (discovered && existsSync(discovered)) return discovered;

  throw new Error(
    "Aseprite executable was not found. Configure executables.aseprite, "
      + "executables.asepriteSource, AUVRYNT_ASEPRITE_PATH, or AUVRYNT_ASEPRITE_SOURCE_PATH.",
  );
}

export function luaString(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")}"`;
}

interface ParsedColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(value: string): ParsedColor {
  const normalized = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(normalized)) {
    throw new Error(`Invalid color ${value}. Use #RRGGBB or #RRGGBBAA.`);
  }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
    a: normalized.length === 8 ? Number.parseInt(normalized.slice(6, 8), 16) : 255,
  };
}

function luaColor(value: string): string {
  const color = parseColor(value);
  return `{r=${color.r},g=${color.g},b=${color.b},a=${color.a}}`;
}

export function assertInteger(value: number, label: string): number {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer.`);
  return value;
}

export function assertPositiveInteger(value: number, label: string): number {
  assertInteger(value, label);
  if (value < 1) throw new Error(`${label} must be at least 1.`);
  return value;
}

export function luaCommonPrelude(): string {
  return `
local function fail(message)
  error(message, 0)
end

local function color_mode_name(mode)
  if mode == ColorMode.RGB then return "rgb" end
  if mode == ColorMode.GRAY then return "grayscale" end
  if mode == ColorMode.INDEXED then return "indexed" end
  return tostring(mode)
end

local function ani_dir_name(direction)
  if direction == AniDir.REVERSE then return "reverse" end
  if direction == AniDir.PING_PONG then return "ping_pong" end
  return "forward"
end

local function find_layer(layers, name)
  for _, layer in ipairs(layers) do
    if layer.name == name then return layer end
    if layer.isGroup then
      local nested = find_layer(layer.layers, name)
      if nested then return nested end
    end
  end
  return nil
end

local function color_pixel(sprite, color)
  if sprite.colorMode == ColorMode.RGB then
    return app.pixelColor.rgba(color.r, color.g, color.b, color.a)
  elseif sprite.colorMode == ColorMode.GRAY then
    local gray = math.floor((color.r * 299 + color.g * 587 + color.b * 114) / 1000)
    return app.pixelColor.graya(gray, color.a)
  else
    local palette = sprite.palettes[1]
    local best_index = 0
    local best_distance = math.huge
    for index = 0, #palette - 1 do
      local candidate = palette:getColor(index)
      local dr = candidate.red - color.r
      local dg = candidate.green - color.g
      local db = candidate.blue - color.b
      local da = candidate.alpha - color.a
      local distance = dr*dr + dg*dg + db*db + da*da
      if distance < best_distance then
        best_distance = distance
        best_index = index
      end
    end
    return best_index
  end
end

local function pixel_rgba(sprite, pixel)
  if sprite.colorMode == ColorMode.RGB then
    return {
      r = app.pixelColor.rgbaR(pixel),
      g = app.pixelColor.rgbaG(pixel),
      b = app.pixelColor.rgbaB(pixel),
      a = app.pixelColor.rgbaA(pixel),
      index = nil,
    }
  elseif sprite.colorMode == ColorMode.GRAY then
    local gray = app.pixelColor.grayaV(pixel)
    return {
      r = gray,
      g = gray,
      b = gray,
      a = app.pixelColor.grayaA(pixel),
      index = nil,
    }
  else
    local palette = sprite.palettes[1]
    local color = palette:getColor(pixel)
    return {
      r = color.red,
      g = color.green,
      b = color.blue,
      a = pixel == sprite.transparentColor and 0 or color.alpha,
      index = pixel,
    }
  end
end

local function rgba_hex(color)
  return string.format("#%02X%02X%02X%02X", color.r, color.g, color.b, color.a)
end

local function canvas_pixel(sprite, layer, frame_number, x, y)
  local cel = layer:cel(frame_number)
  if cel == nil then return pixel_rgba(sprite, sprite.colorMode == ColorMode.INDEXED and sprite.transparentColor or 0) end
  local local_x = x - cel.position.x
  local local_y = y - cel.position.y
  if local_x < 0 or local_y < 0 or local_x >= cel.image.width or local_y >= cel.image.height then
    return pixel_rgba(sprite, sprite.colorMode == ColorMode.INDEXED and sprite.transparentColor or 0)
  end
  return pixel_rgba(sprite, cel.image:getPixel(local_x, local_y))
end

local function ensure_canvas_cel(sprite, layer, frame_number)
  local cel = layer:cel(frame_number)
  if cel == nil then
    local image = Image(sprite.spec)
    image:clear()
    cel = sprite:newCel(layer, frame_number, image, Point(0, 0))
  elseif cel.position.x ~= 0 or cel.position.y ~= 0 or
         cel.image.width ~= sprite.width or cel.image.height ~= sprite.height then
    local image = Image(sprite.spec)
    image:clear()
    image:drawImage(cel.image, cel.position)
    cel.image = image
    cel.position = Point(0, 0)
  end
  return cel
end

local function sprite_summary(sprite)
  local layers = {}
  local function append_layers(items, parent)
    for _, layer in ipairs(items) do
      table.insert(layers, {
        name = layer.name,
        parent = parent,
        is_group = layer.isGroup,
        is_visible = layer.isVisible,
        is_editable = layer.isEditable,
        opacity = layer.opacity,
        blend_mode = tostring(layer.blendMode),
        cel_count = #layer.cels,
      })
      if layer.isGroup then append_layers(layer.layers, layer.name) end
    end
  end
  append_layers(sprite.layers, nil)

  local frames = {}
  for _, frame in ipairs(sprite.frames) do
    table.insert(frames, {
      frame = frame.frameNumber,
      duration_ms = math.floor(frame.duration * 1000 + 0.5),
    })
  end

  local tags = {}
  for _, tag in ipairs(sprite.tags) do
    table.insert(tags, {
      name = tag.name,
      from = tag.fromFrame.frameNumber,
      to = tag.toFrame.frameNumber,
      direction = ani_dir_name(tag.aniDir),
      repeats = tag.repeats,
    })
  end

  local slices = {}
  for _, slice in ipairs(sprite.slices) do
    table.insert(slices, { name = slice.name })
  end

  local palette_size = 0
  if #sprite.palettes > 0 then palette_size = #sprite.palettes[1] end
  return {
    filename = sprite.filename,
    width = sprite.width,
    height = sprite.height,
    color_mode = color_mode_name(sprite.colorMode),
    frame_count = #sprite.frames,
    layer_count = #layers,
    palette_size = palette_size,
    layers = layers,
    frames = frames,
    tags = tags,
    slices = slices,
  }
end

local function emit_result(value)
  print(${luaString(RESULT_PREFIX)} .. json.encode(value))
end
`;
}

export async function runLua(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  workspaceId: string,
  scriptBody: string,
): Promise<unknown> {
  const workspace = registry.getWorkspace(workspaceId);
  const executable = await resolveAsepriteExecutable(config);
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const scriptPath = registry.resolveArtifactPath(
    workspace,
    `scripts/${unique}.lua`,
    "aseprite",
  );
  await mkdir(dirname(scriptPath), { recursive: true });
  await writeFile(scriptPath, `${luaCommonPrelude()}\n${scriptBody}\n`, "utf8");

  try {
    const { stdout, stderr } = await execFileAsync(executable, ["-b", "--script", scriptPath], {
      cwd: workspace.root,
      timeout: ASEPRITE_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    const line = stdout.split(/\r?\n/).reverse().find((entry) => entry.startsWith(RESULT_PREFIX));
    if (!line) {
      const details = sanitizeCliOutput([stdout.trim(), stderr.trim()].filter(Boolean).join("\n")).slice(-4_000);
      throw new Error(`Aseprite script returned no structured result.${details ? `\n${details}` : ""}`);
    }
    return JSON.parse(line.slice(RESULT_PREFIX.length));
  } catch (error: any) {
    const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const detail = sanitizeCliOutput([stdout, stderr, error?.message].filter(Boolean).join("\n")).slice(-6_000);
    throw new Error(`Aseprite operation failed: ${detail || "unknown error"}`);
  } finally {
    await unlink(scriptPath).catch(() => undefined);
  }
}

export function workspacePath(
  registry: WorkspaceRegistry,
  workspaceId: string,
  inputPath: string,
): { absolute: string; relative: string } {
  const workspace = registry.getWorkspace(workspaceId);
  const absolute = registry.resolvePath(workspace, inputPath);
  return { absolute, relative: relative(workspace.root, absolute).replace(/\\/g, "/") };
}

function safeCheckpointSegment(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 120) || "sprite";
}

export async function prepareAsepriteSourceMutation(
  registry: WorkspaceRegistry,
  workspaceId: string,
  filePath: string,
  expectedVersion: string | undefined,
  checkpoint: boolean | undefined,
  label: string,
): Promise<string> {
  const workspace = registry.getWorkspace(workspaceId);
  const file = workspacePath(registry, workspaceId, filePath);
  const bytes = await readFile(file.absolute);
  const version = createHash("sha256").update(bytes).digest("hex");
  if (expectedVersion && expectedVersion !== version) {
    throw new Error(`Aseprite file changed since it was inspected. Expected ${expectedVersion}, current ${version}.`);
  }
  if (checkpoint !== false) {
    const root = registry.resolveArtifactPath(
      workspace,
      `checkpoints/${safeCheckpointSegment(file.relative)}`,
      "aseprite",
    );
    await mkdir(root, { recursive: true });
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${version.slice(0, 12)}`;
    const extension = file.absolute.match(/(\.[^./\\]+)$/)?.[1] ?? ".aseprite";
    const copyName = `${id}${extension}`;
    await copyFile(file.absolute, join(root, copyName));
    await writeFile(join(root, `${id}.json`), JSON.stringify({
      id,
      file: file.relative,
      version,
      label,
      createdAt: new Date().toISOString(),
      copyFile: copyName,
    }, null, 2), "utf8");
  }
  return version;
}

export function openSpriteScript(filePath: string): string {
  return `
local sprite = app.open(${luaString(filePath)})
if sprite == nil then fail("Unable to open sprite") end
app.activeSprite = sprite
`;
}

export function selectLayerAndFrameScript(layerName: string | undefined, frame: number | undefined): string {
  const frameNumber = frame === undefined ? 1 : assertPositiveInteger(frame, "frame");
  return `
local layer = ${layerName ? `find_layer(sprite.layers, ${luaString(layerName)})` : "sprite.layers[1]"}
if layer == nil then fail("Layer not found") end
if layer.isGroup then fail("A group layer cannot contain pixels") end
if ${frameNumber} > #sprite.frames then fail("Frame is outside the sprite") end
local frame_number = ${frameNumber}
`;
}

export async function asepriteDetect(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: { workspaceId: string },
): Promise<ToolResponse> {
  try {
    registry.getWorkspace(input.workspaceId);
    const executable = await resolveAsepriteExecutable(config);
    const { stdout, stderr } = await execFileAsync(executable, ["--version"], {
      timeout: 10_000,
      windowsHide: true,
    });
    const discovery = await discoverLocalIntegrations({ forceRefresh: true });
    return textResponse({
      detected: true,
      executable,
      sourcePath: cleanPath(config.executables.asepriteSource ?? process.env.AUVRYNT_ASEPRITE_SOURCE_PATH),
      version: (stdout || stderr).split(/\r?\n/).map((line) => line.trim()).find((line) => /^Aseprite\s/i.test(line)) ?? (stdout || stderr).trim(),
      running: processDetected(discovery, "aseprite"),
      integration: "native-cli",
      pluginRequired: false,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteInspectFile(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: { workspaceId: string; filePath: string },
): Promise<ToolResponse> {
  try {
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
local result = sprite_summary(sprite)
result.filename = ${luaString(file.relative)}
emit_result(result)
sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteCreateSprite(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    outputPath: string;
    width: number;
    height: number;
    colorMode?: AsepriteColorMode;
    layerName?: string;
    backgroundColor?: string;
  },
): Promise<ToolResponse> {
  try {
    const output = workspacePath(registry, input.workspaceId, input.outputPath);
    await mkdir(dirname(output.absolute), { recursive: true });
    const width = assertPositiveInteger(input.width, "width");
    const height = assertPositiveInteger(input.height, "height");
    if (width > 8192 || height > 8192) throw new Error("Sprite dimensions cannot exceed 8192x8192.");
    const mode = input.colorMode ?? "rgb";
    const modeLua = mode === "indexed" ? "ColorMode.INDEXED" : mode === "grayscale" ? "ColorMode.GRAY" : "ColorMode.RGB";
    const background = input.backgroundColor ? luaColor(input.backgroundColor) : undefined;
    const result = await runLua(config, registry, input.workspaceId, `
local sprite = Sprite(${width}, ${height}, ${modeLua})
sprite.layers[1].name = ${luaString(input.layerName?.trim() || "Layer 1")}
${background ? `sprite.cels[1].image:clear(color_pixel(sprite, ${background}))` : "sprite.cels[1].image:clear()"}
if not sprite:saveAs(${luaString(output.absolute)}) then fail("Unable to save sprite") end
local result = sprite_summary(sprite)
result.filename = ${luaString(output.relative)}
emit_result(result)
sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteSetPixels(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    layer?: string;
    frame?: number;
    pixels: AsepritePixelEdit[];
    expectedVersion?: string;
    checkpoint?: boolean;
  },
): Promise<ToolResponse> {
  try {
    await prepareAsepriteSourceMutation(registry, input.workspaceId, input.filePath, input.expectedVersion, input.checkpoint, "set-pixels");
    if (!Array.isArray(input.pixels) || input.pixels.length === 0) throw new Error("pixels must not be empty.");
    if (input.pixels.length > MAX_PIXEL_EDITS) throw new Error(`A maximum of ${MAX_PIXEL_EDITS} pixels can be changed per call.`);
    const pixels = input.pixels.map((pixel) => ({
      x: assertInteger(pixel.x, "pixel.x"),
      y: assertInteger(pixel.y, "pixel.y"),
      color: parseColor(pixel.color),
    }));
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    const pixelsLua = `{${pixels.map((pixel) => `{x=${pixel.x},y=${pixel.y},color={r=${pixel.color.r},g=${pixel.color.g},b=${pixel.color.b},a=${pixel.color.a}}}`).join(",")}}`;
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
${selectLayerAndFrameScript(input.layer, input.frame)}
local cel = ensure_canvas_cel(sprite, layer, frame_number)
local image = cel.image
local pixels = ${pixelsLua}
for _, pixel in ipairs(pixels) do
  if pixel.x < 0 or pixel.x >= sprite.width or pixel.y < 0 or pixel.y >= sprite.height then
    fail("Pixel coordinate is outside the sprite")
  end
  image:drawPixel(pixel.x, pixel.y, color_pixel(sprite, pixel.color))
end
if not sprite:saveAs(${luaString(file.absolute)}) then fail("Unable to save sprite") end
emit_result({ file = ${luaString(file.relative)}, changed_pixels = #pixels, layer = layer.name, frame = frame_number })
sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteDrawShapes(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    layer?: string;
    frame?: number;
    shapes: AsepriteShape[];
    expectedVersion?: string;
    checkpoint?: boolean;
  },
): Promise<ToolResponse> {
  try {
    await prepareAsepriteSourceMutation(registry, input.workspaceId, input.filePath, input.expectedVersion, input.checkpoint, "draw-shapes");
    if (!Array.isArray(input.shapes) || input.shapes.length === 0) throw new Error("shapes must not be empty.");
    if (input.shapes.length > MAX_SHAPES) throw new Error(`A maximum of ${MAX_SHAPES} shapes can be drawn per call.`);
    const shapes = input.shapes.map((shape) => {
      const color = parseColor(shape.color);
      if (shape.type === "point") return { ...shape, x: assertInteger(shape.x, "point.x"), y: assertInteger(shape.y, "point.y"), color };
      if (shape.type === "line") return {
        ...shape,
        x1: assertInteger(shape.x1, "line.x1"), y1: assertInteger(shape.y1, "line.y1"),
        x2: assertInteger(shape.x2, "line.x2"), y2: assertInteger(shape.y2, "line.y2"), color,
      };
      return {
        ...shape,
        x: assertInteger(shape.x, "rect.x"), y: assertInteger(shape.y, "rect.y"),
        width: assertPositiveInteger(shape.width, "rect.width"), height: assertPositiveInteger(shape.height, "rect.height"), color,
      };
    });
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    const shapesLua = `{${shapes.map((shape) => {
      const color = `{r=${shape.color.r},g=${shape.color.g},b=${shape.color.b},a=${shape.color.a}}`;
      if (shape.type === "point") return `{type="point",x=${shape.x},y=${shape.y},color=${color}}`;
      if (shape.type === "line") return `{type="line",x1=${shape.x1},y1=${shape.y1},x2=${shape.x2},y2=${shape.y2},color=${color}}`;
      return `{type="rect",x=${shape.x},y=${shape.y},width=${shape.width},height=${shape.height},fill=${shape.fill === true ? "true" : "false"},color=${color}}`;
    }).join(",")}}`;
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
${selectLayerAndFrameScript(input.layer, input.frame)}
local cel = ensure_canvas_cel(sprite, layer, frame_number)
local image = cel.image
local shapes = ${shapesLua}
local function put(x, y, pixel)
  if x >= 0 and x < sprite.width and y >= 0 and y < sprite.height then image:drawPixel(x, y, pixel) end
end
local function line(x0, y0, x1, y1, pixel)
  local dx = math.abs(x1 - x0)
  local sx = x0 < x1 and 1 or -1
  local dy = -math.abs(y1 - y0)
  local sy = y0 < y1 and 1 or -1
  local err = dx + dy
  while true do
    put(x0, y0, pixel)
    if x0 == x1 and y0 == y1 then break end
    local e2 = 2 * err
    if e2 >= dy then err = err + dy; x0 = x0 + sx end
    if e2 <= dx then err = err + dx; y0 = y0 + sy end
  end
end
for _, shape in ipairs(shapes) do
  local pixel = color_pixel(sprite, shape.color)
  if shape.type == "point" then
    put(shape.x, shape.y, pixel)
  elseif shape.type == "line" then
    line(shape.x1, shape.y1, shape.x2, shape.y2, pixel)
  elseif shape.fill then
    for y = shape.y, shape.y + shape.height - 1 do
      for x = shape.x, shape.x + shape.width - 1 do put(x, y, pixel) end
    end
  else
    line(shape.x, shape.y, shape.x + shape.width - 1, shape.y, pixel)
    line(shape.x, shape.y + shape.height - 1, shape.x + shape.width - 1, shape.y + shape.height - 1, pixel)
    line(shape.x, shape.y, shape.x, shape.y + shape.height - 1, pixel)
    line(shape.x + shape.width - 1, shape.y, shape.x + shape.width - 1, shape.y + shape.height - 1, pixel)
  end
end
if not sprite:saveAs(${luaString(file.absolute)}) then fail("Unable to save sprite") end
emit_result({ file = ${luaString(file.relative)}, shapes = #shapes, layer = layer.name, frame = frame_number })
sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteManageLayers(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    action: "add" | "rename" | "delete" | "set_visibility" | "set_opacity";
    layer?: string;
    name?: string;
    visible?: boolean;
    opacity?: number;
    expectedVersion?: string;
    checkpoint?: boolean;
  },
): Promise<ToolResponse> {
  try {
    await prepareAsepriteSourceMutation(registry, input.workspaceId, input.filePath, input.expectedVersion, input.checkpoint, `manage-layer-${input.action}`);
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    if (["rename", "delete", "set_visibility", "set_opacity"].includes(input.action) && !input.layer?.trim()) {
      throw new Error("layer is required for this action.");
    }
    if (["add", "rename"].includes(input.action) && !input.name?.trim()) throw new Error("name is required for this action.");
    if (input.opacity !== undefined && (!Number.isInteger(input.opacity) || input.opacity < 0 || input.opacity > 255)) {
      throw new Error("opacity must be an integer from 0 to 255.");
    }
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
local action = ${luaString(input.action)}
local layer = ${input.layer ? `find_layer(sprite.layers, ${luaString(input.layer)})` : "nil"}
if action == "add" then
  layer = sprite:newLayer()
  layer.name = ${luaString(input.name?.trim() || "Layer")}
elseif layer == nil then
  fail("Layer not found")
elseif action == "rename" then
  layer.name = ${luaString(input.name?.trim() || "Layer")}
elseif action == "delete" then
  sprite:deleteLayer(layer)
elseif action == "set_visibility" then
  layer.isVisible = ${input.visible === false ? "false" : "true"}
elseif action == "set_opacity" then
  layer.opacity = ${input.opacity ?? 255}
else
  fail("Unsupported layer action")
end
if not sprite:saveAs(${luaString(file.absolute)}) then fail("Unable to save sprite") end
emit_result(sprite_summary(sprite))
sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteManageFrames(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    action: "add_empty" | "duplicate" | "delete" | "set_duration";
    frame?: number;
    durationMs?: number;
    expectedVersion?: string;
    checkpoint?: boolean;
  },
): Promise<ToolResponse> {
  try {
    await prepareAsepriteSourceMutation(registry, input.workspaceId, input.filePath, input.expectedVersion, input.checkpoint, `manage-frame-${input.action}`);
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    const frame = input.frame === undefined ? 1 : assertPositiveInteger(input.frame, "frame");
    if (input.durationMs !== undefined && (!Number.isInteger(input.durationMs) || input.durationMs < 1 || input.durationMs > 60_000)) {
      throw new Error("durationMs must be an integer from 1 to 60000.");
    }
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
local action = ${luaString(input.action)}
local frame_number = ${frame}
if action == "add_empty" then
  sprite:newEmptyFrame(math.min(frame_number, #sprite.frames + 1))
elseif frame_number > #sprite.frames then
  fail("Frame is outside the sprite")
elseif action == "duplicate" then
  sprite:newFrame(frame_number)
elseif action == "delete" then
  if #sprite.frames <= 1 then fail("Cannot delete the only frame") end
  sprite:deleteFrame(frame_number)
elseif action == "set_duration" then
  sprite.frames[frame_number].duration = ${(input.durationMs ?? 100) / 1000}
else
  fail("Unsupported frame action")
end
if not sprite:saveAs(${luaString(file.absolute)}) then fail("Unable to save sprite") end
emit_result(sprite_summary(sprite))
sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteManageTags(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    action: "add" | "rename" | "delete";
    name: string;
    newName?: string;
    from?: number;
    to?: number;
    direction?: AsepriteTagDirection;
    expectedVersion?: string;
    checkpoint?: boolean;
  },
): Promise<ToolResponse> {
  try {
    await prepareAsepriteSourceMutation(registry, input.workspaceId, input.filePath, input.expectedVersion, input.checkpoint, `manage-tag-${input.action}`);
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    if (!input.name.trim()) throw new Error("name is required.");
    const from = input.from === undefined ? 1 : assertPositiveInteger(input.from, "from");
    const to = input.to === undefined ? from : assertPositiveInteger(input.to, "to");
    if (from > to) throw new Error("from cannot be greater than to.");
    if (input.action === "rename" && !input.newName?.trim()) throw new Error("newName is required when renaming a tag.");
    const direction = input.direction ?? "forward";
    const directionLua = direction === "reverse" ? "AniDir.REVERSE" : direction === "ping_pong" ? "AniDir.PING_PONG" : "AniDir.FORWARD";
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
local action = ${luaString(input.action)}
local name = ${luaString(input.name.trim())}
local tag = nil
for _, candidate in ipairs(sprite.tags) do if candidate.name == name then tag = candidate; break end end
if action == "add" then
  if ${to} > #sprite.frames then fail("Tag range is outside the sprite") end
  if tag ~= nil then fail("Tag already exists") end
  tag = sprite:newTag(${from}, ${to})
  tag.name = name
  tag.aniDir = ${directionLua}
elseif tag == nil then
  fail("Tag not found")
elseif action == "rename" then
  tag.name = ${luaString(input.newName?.trim() || input.name.trim())}
elseif action == "delete" then
  sprite:deleteTag(tag)
else
  fail("Unsupported tag action")
end
if not sprite:saveAs(${luaString(file.absolute)}) then fail("Unable to save sprite") end
emit_result(sprite_summary(sprite))
sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteSetPalette(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    colors: string[];
    expectedVersion?: string;
    checkpoint?: boolean;
  },
): Promise<ToolResponse> {
  try {
    await prepareAsepriteSourceMutation(registry, input.workspaceId, input.filePath, input.expectedVersion, input.checkpoint, "set-palette");
    if (!Array.isArray(input.colors) || input.colors.length < 1 || input.colors.length > 256) {
      throw new Error("colors must contain between 1 and 256 entries.");
    }
    const colors = input.colors.map(parseColor);
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    const colorsLua = `{${colors.map((color) => `{r=${color.r},g=${color.g},b=${color.b},a=${color.a}}`).join(",")}}`;
    const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(file.absolute)}
local colors = ${colorsLua}
local palette = Palette(#colors)
for index, color in ipairs(colors) do palette:setColor(index - 1, Color(color)) end
sprite:setPalette(palette)
if not sprite:saveAs(${luaString(file.absolute)}) then fail("Unable to save sprite") end
emit_result({ file = ${luaString(file.relative)}, palette_size = #colors })
sprite:close()
`);
    return textResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteExportSpriteSheet(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    sheetPath: string;
    dataPath?: string;
    sheetType?: "horizontal" | "vertical" | "rows" | "columns" | "packed";
    columns?: number;
    rows?: number;
    tag?: string;
    layer?: string;
    trim?: boolean;
    mergeDuplicates?: boolean;
    borderPadding?: number;
    shapePadding?: number;
    innerPadding?: number;
  },
): Promise<ToolResponse> {
  try {
    const workspace = registry.getWorkspace(input.workspaceId);
    const executable = await resolveAsepriteExecutable(config);
    const source = workspacePath(registry, input.workspaceId, input.filePath);
    const sheet = workspacePath(registry, input.workspaceId, input.sheetPath);
    const data = input.dataPath ? workspacePath(registry, input.workspaceId, input.dataPath) : undefined;
    await mkdir(dirname(sheet.absolute), { recursive: true });
    if (data) await mkdir(dirname(data.absolute), { recursive: true });
    const args = ["-b", source.absolute, "--sheet", sheet.absolute, "--sheet-type", input.sheetType ?? "horizontal"];
    if (data) args.push("--data", data.absolute, "--format", "json-array");
    if (input.columns !== undefined) args.push("--sheet-columns", String(assertPositiveInteger(input.columns, "columns")));
    if (input.rows !== undefined) args.push("--sheet-rows", String(assertPositiveInteger(input.rows, "rows")));
    if (input.tag) args.push("--tag", input.tag);
    if (input.layer) args.push("--layer", input.layer);
    if (input.trim) args.push("--trim");
    if (input.mergeDuplicates) args.push("--merge-duplicates");
    if (input.borderPadding !== undefined) args.push("--border-padding", String(Math.max(0, assertInteger(input.borderPadding, "borderPadding"))));
    if (input.shapePadding !== undefined) args.push("--shape-padding", String(Math.max(0, assertInteger(input.shapePadding, "shapePadding"))));
    if (input.innerPadding !== undefined) args.push("--inner-padding", String(Math.max(0, assertInteger(input.innerPadding, "innerPadding"))));
    const { stdout, stderr } = await execFileAsync(executable, args, {
      cwd: workspace.root,
      timeout: ASEPRITE_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    return textResponse({
      success: true,
      source: source.relative,
      sheet: sheet.relative,
      data: data?.relative,
      output: sanitizeCliOutput([stdout.trim(), stderr.trim()].filter(Boolean).join("\n")).slice(-2_000),
    });
  } catch (error: any) {
    return errorResponse(`Aseprite export failed: ${sanitizeCliOutput(String(error?.stderr || error?.message || String(error)))}`);
  }
}

export async function asepriteConvertFile(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    outputPath: string;
    scale?: number;
    colorMode?: AsepriteColorMode;
    palettePath?: string;
    trim?: boolean;
    crop?: { x: number; y: number; width: number; height: number };
    frameRange?: { from: number; to: number };
    tag?: string;
    layer?: string;
  },
): Promise<ToolResponse> {
  try {
    const workspace = registry.getWorkspace(input.workspaceId);
    const executable = await resolveAsepriteExecutable(config);
    const source = workspacePath(registry, input.workspaceId, input.filePath);
    const output = workspacePath(registry, input.workspaceId, input.outputPath);
    await mkdir(dirname(output.absolute), { recursive: true });
    const args = ["-b", source.absolute];
    if (input.scale !== undefined) {
      if (!Number.isFinite(input.scale) || input.scale <= 0 || input.scale > 64) throw new Error("scale must be greater than 0 and no more than 64.");
      args.push("--scale", String(input.scale));
    }
    if (input.colorMode) args.push("--color-mode", input.colorMode === "grayscale" ? "grayscale" : input.colorMode);
    if (input.palettePath) args.push("--palette", workspacePath(registry, input.workspaceId, input.palettePath).absolute);
    if (input.trim) args.push("--trim");
    if (input.crop) {
      args.push("--crop", [
        assertInteger(input.crop.x, "crop.x"),
        assertInteger(input.crop.y, "crop.y"),
        assertPositiveInteger(input.crop.width, "crop.width"),
        assertPositiveInteger(input.crop.height, "crop.height"),
      ].join(","));
    }
    if (input.frameRange) {
      const from = assertPositiveInteger(input.frameRange.from, "frameRange.from");
      const to = assertPositiveInteger(input.frameRange.to, "frameRange.to");
      if (from > to) throw new Error("frameRange.from cannot be greater than frameRange.to.");
      args.push("--frame-range", `${from},${to}`);
    }
    if (input.tag) args.push("--tag", input.tag);
    if (input.layer) args.push("--layer", input.layer);
    args.push("--save-as", output.absolute);
    const { stdout, stderr } = await execFileAsync(executable, args, {
      cwd: workspace.root,
      timeout: ASEPRITE_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    return textResponse({
      success: true,
      source: source.relative,
      output: output.relative,
      details: sanitizeCliOutput([stdout.trim(), stderr.trim()].filter(Boolean).join("\n")).slice(-2_000),
    });
  } catch (error: any) {
    return errorResponse(`Aseprite conversion failed: ${sanitizeCliOutput(String(error?.stderr || error?.message || String(error)))}`);
  }
}

