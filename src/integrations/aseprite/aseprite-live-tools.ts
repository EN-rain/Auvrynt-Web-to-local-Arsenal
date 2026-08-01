import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerConfig } from "../../config.js";
import type { ToolResponse } from "../../pi-tools.js";
import { inlineImageOrNotice } from "../../tool-result-budget.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import { discoverLocalIntegrations, processDetected } from "../integration-discovery.js";
import {
  errorResponse,
  parseColor,
  textResponse,
  workspacePath,
} from "./aseprite-tools.js";

const BRIDGE_NAME = "auvrynt-bridge";
const BRIDGE_VERSION = "1.2.0";
const DEFAULT_TIMEOUT_MS = 10_000;
const STATUS_TIMEOUT_MS = 1_200;
const STATUS_CACHE_MS = 5_000;

interface BridgeAuth {
  token: string;
  createdAt: string;
}

interface BridgeResponse {
  id: string;
  ok: boolean;
  bridgeVersion?: string;
  result?: unknown;
  error?: string;
}

export interface AsepriteBridgeRuntimeStatus {
  installed: boolean;
  connected: boolean;
  bridgeVersion?: string;
  error?: string;
  checkedAt: string;
}

let cachedBridgeStatus: { value: AsepriteBridgeRuntimeStatus; expiresAt: number } | undefined;
let bridgeStatusProbe: Promise<AsepriteBridgeRuntimeStatus> | undefined;

export interface AsepriteLiveEditorInput {
  workspaceId: string;
  action:
    | "install_bridge"
    | "bridge_status"
    | "list_documents"
    | "inspect"
    | "new_document"
    | "open_document"
    | "select_document"
    | "select_layer"
    | "select_frame"
    | "save"
    | "save_as"
    | "close_document"
    | "undo"
    | "redo"
    | "toggle_playback"
    | "set_zoom"
    | "set_onion_skin"
    | "set_tool"
    | "set_colors"
    | "set_brush"
    | "set_selection"
    | "clear_selection"
    | "set_pixels"
    | "draw_stroke"
    | "create_layer"
    | "create_frame"
    | "delete_frame"
    | "set_frame_duration"
    | "run_live_command"
    | "safe_command";
  allowGlobalWrite?: boolean;
  documentId?: string;
  filename?: string;
  path?: string;
  width?: number;
  height?: number;
  colorMode?: "rgb" | "grayscale" | "indexed";
  layer?: string;
  frame?: number;
  discardChanges?: boolean;
  zoom?: number;
  active?: boolean;
  prevFrames?: number;
  nextFrames?: number;
  opacityBase?: number;
  opacityStep?: number;
  loopTag?: boolean;
  currentLayer?: boolean;
  tool?: string;
  foreground?: string;
  background?: string;
  brushType?: "circle" | "square" | "line";
  size?: number;
  angle?: number;
  bounds?: { x: number; y: number; width: number; height: number };
  mode?: "replace" | "add" | "subtract" | "intersect";
  pixels?: Array<{ x: number; y: number; color: string }>;
  points?: Array<{ x: number; y: number }>;
  color?: string;
  opacity?: number;
  pixelPerfect?: boolean;
  name?: string;
  group?: boolean;
  duplicate?: boolean;
  durationMs?: number;
  liveCommand?:
    | "get_pixel"
    | "get_image_data"
    | "draw_line"
    | "draw_rect"
    | "draw_ellipse"
    | "flood_fill"
    | "clear_image"
    | "replace_color"
    | "outline"
    | "draw_symmetry"
    | "apply_dither"
    | "set_layer_properties"
    | "reorder_layer"
    | "get_cel"
    | "set_cel"
    | "create_tag"
    | "update_tag"
    | "delete_tag"
    | "get_palette"
    | "set_palette_color"
    | "set_palette"
    | "generate_color_ramp"
    | "sort_palette"
    | "create_character_template"
    | "create_tileset_template"
    | "get_selection"
    | "select_all"
    | "deselect"
    | "invert_selection"
    | "select_ellipse"
    | "select_by_color"
    | "set_frame_range_duration"
    | "duplicate_frame"
    | "reverse_frames"
    | "shift_cel"
    | "flip_sprite"
    | "rotate_sprite"
    | "copy_between_sprites"
    | "resize_sprite"
    | "crop_sprite"
    | "flatten_sprite"
    | "set_grid"
    | "get_sprite_bounds"
    | "get_color_stats"
    | "compare_frames"
    | "validate_animation";
  arguments?: Record<string, unknown>;
  command?: "DuplicateLayer" | "MergeDownLayer" | "FlattenLayers" | "BackgroundFromLayer" | "LayerFromBackground" | "ReverseFrames" | "ClearCel" | "NewFrame" | "RemoveFrame" | "NewLayer" | "RemoveLayer";
  params?: Record<string, string | number | boolean>;
}

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function asepriteUserDataRoot(): string {
  if (process.env.ASEPRITE_USER_DATA_DIR?.trim()) return process.env.ASEPRITE_USER_DATA_DIR.trim();
  if (process.platform === "win32" && process.env.APPDATA) return join(process.env.APPDATA, "Aseprite");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Aseprite");
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "aseprite");
}

function bridgePaths(): {
  extensionSource: string;
  extensionTarget: string;
  root: string;
  requests: string;
  responses: string;
  auth: string;
} {
  const userRoot = asepriteUserDataRoot();
  const root = join(userRoot, "auvrynt-bridge");
  return {
    extensionSource: join(packageRoot(), "extensions", "auvrynt_bridge"),
    extensionTarget: join(userRoot, "extensions", BRIDGE_NAME),
    root,
    requests: join(root, "requests"),
    responses: join(root, "responses"),
    auth: join(root, "auth.json"),
  };
}

async function setExtensionEnabled(enabled: boolean): Promise<void> {
  const iniPath = join(asepriteUserDataRoot(), "aseprite.ini");
  let ini = await readFile(iniPath, "utf8").catch(() => "");
  const sectionPattern = /(^|\r?\n)\[extensions\]\r?\n([\s\S]*?)(?=\r?\n\[|$)/i;
  const match = ini.match(sectionPattern);
  const value = `${BRIDGE_NAME}=${enabled ? "true" : "false"}`;
  if (match) {
    let body = match[2];
    const keyPattern = /^auvrynt-bridge=.*$/mi;
    body = keyPattern.test(body) ? body.replace(keyPattern, value) : `${body.trimEnd()}\r\n${value}\r\n`;
    ini = ini.replace(sectionPattern, `${match[1]}[extensions]\r\n${body}`);
  } else {
    ini = `${ini.trimEnd()}\r\n\r\n[extensions]\r\n${value}\r\n`;
  }
  await mkdir(dirname(iniPath), { recursive: true });
  await writeFile(iniPath, ini, "utf8");
}

async function ensureBridgeDirectories(): Promise<void> {
  const paths = bridgePaths();
  await mkdir(paths.requests, { recursive: true });
  await mkdir(paths.responses, { recursive: true });
}

async function readOrCreateAuth(): Promise<BridgeAuth> {
  const paths = bridgePaths();
  await ensureBridgeDirectories();
  try {
    const parsed = JSON.parse(await readFile(paths.auth, "utf8")) as BridgeAuth;
    if (typeof parsed.token === "string" && parsed.token.length >= 32) return parsed;
  } catch {
    // Create a fresh token below.
  }
  const auth: BridgeAuth = {
    token: randomBytes(32).toString("hex"),
    createdAt: new Date().toISOString(),
  };
  const temporary = `${paths.auth}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(auth, null, 2), "utf8");
  if (process.platform !== "win32") await chmod(temporary, 0o600);
  await rename(temporary, paths.auth);
  return auth;
}

export async function ensureGlobalAsepriteBridge(): Promise<{
  installed: boolean;
  targetPath: string;
  authPath: string;
}> {
  const paths = bridgePaths();
  if (!existsSync(paths.extensionSource)) {
    throw new Error(`Bundled Aseprite bridge source is missing: ${paths.extensionSource}`);
  }
  await mkdir(dirname(paths.extensionTarget), { recursive: true });
  await cp(paths.extensionSource, paths.extensionTarget, { recursive: true, force: true });
  await setExtensionEnabled(true);
  await readOrCreateAuth();
  return { installed: true, targetPath: paths.extensionTarget, authPath: paths.auth };
}

async function bridgeRequest(
  payload: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<BridgeResponse> {
  const paths = bridgePaths();
  if (!existsSync(join(paths.extensionTarget, "auvrynt_bridge.lua"))) {
    throw new Error("Auvrynt's Aseprite bridge is not installed. Run install_bridge first.");
  }
  const auth = await readOrCreateAuth();
  const id = randomUUID();
  const requestPath = join(paths.requests, `${id}.json`);
  const responsePath = join(paths.responses, `${id}.json`);
  const temporary = `${requestPath}.tmp`;
  await writeFile(temporary, JSON.stringify({ ...payload, id, token: auth.token }), "utf8");
  await rename(temporary, requestPath);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(responsePath)) {
      const raw = await readFile(responsePath, "utf8");
      await rm(responsePath, { force: true });
      const response = JSON.parse(raw) as BridgeResponse;
      if (response.id !== id) throw new Error("Aseprite bridge response ID mismatch.");
      return response;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 75));
  }
  await rm(requestPath, { force: true });
  throw new Error(
    "Aseprite live bridge did not respond. Restart Aseprite after installing the extension, and close any modal dialog blocking its script timer.",
  );
}

export async function getAsepriteBridgeRuntimeStatus(
  options: { force?: boolean; timeoutMs?: number } = {},
): Promise<AsepriteBridgeRuntimeStatus> {
  const now = Date.now();
  if (!options.force && cachedBridgeStatus && cachedBridgeStatus.expiresAt > now) {
    return cachedBridgeStatus.value;
  }
  if (!options.force && bridgeStatusProbe) return bridgeStatusProbe;

  const probe = (async (): Promise<AsepriteBridgeRuntimeStatus> => {
    const paths = bridgePaths();
    const installed = existsSync(join(paths.extensionTarget, "auvrynt_bridge.lua"));
    let status: AsepriteBridgeRuntimeStatus;
    if (!installed) {
      status = {
        installed: false,
        connected: false,
        error: "Auvrynt's Aseprite live bridge is not installed.",
        checkedAt: new Date().toISOString(),
      };
    } else if (!existsSync(paths.auth)) {
      status = {
        installed: true,
        connected: false,
        error: "Auvrynt's Aseprite live bridge authentication file is missing. Reinstall the bridge.",
        checkedAt: new Date().toISOString(),
      };
    } else {
      try {
        const response = await bridgeRequest(
          { action: "status" },
          options.timeoutMs ?? STATUS_TIMEOUT_MS,
        );
        status = {
          installed: true,
          connected: response.ok,
          bridgeVersion: response.bridgeVersion,
          error: response.ok ? undefined : response.error,
          checkedAt: new Date().toISOString(),
        };
      } catch (error) {
        status = {
          installed: true,
          connected: false,
          error: error instanceof Error ? error.message : String(error),
          checkedAt: new Date().toISOString(),
        };
      }
    }
    cachedBridgeStatus = { value: status, expiresAt: Date.now() + STATUS_CACHE_MS };
    return status;
  })();

  bridgeStatusProbe = probe;
  try {
    return await probe;
  } finally {
    if (bridgeStatusProbe === probe) bridgeStatusProbe = undefined;
  }
}

function colorObject(value: string | undefined): Record<string, number> | undefined {
  if (!value) return undefined;
  const color = parseColor(value);
  return { r: color.r, g: color.g, b: color.b, a: color.a };
}

function assertWorkspaceDocument(
  registry: WorkspaceRegistry,
  workspaceId: string,
  filename: unknown,
): void {
  if (typeof filename !== "string" || !filename) throw new Error("The live document has no associated workspace file. Use save_as.");
  const workspace = registry.getWorkspace(workspaceId);
  const rel = relative(workspace.root, resolve(filename));
  if (rel.startsWith("..") || resolve(workspace.root, rel) !== resolve(filename)) {
    throw new Error("Refusing to save a live document outside the opened workspace.");
  }
}

async function inspectLiveDocument(
  registry: WorkspaceRegistry,
  input: Pick<AsepriteLiveEditorInput, "workspaceId" | "documentId" | "filename">,
): Promise<any> {
  const response = await bridgeRequest({
    action: "inspect",
    documentId: input.documentId,
    filename: input.filename,
  });
  if (!response.ok) throw new Error(response.error || "Aseprite bridge inspection failed.");
  return (response.result as any)?.document;
}

function sanitizeLivePayload(
  registry: WorkspaceRegistry,
  input: AsepriteLiveEditorInput,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...input };
  delete payload.workspaceId;
  delete payload.allowGlobalWrite;
  if (input.action === "open_document" || input.action === "save_as") {
    if (!input.path) throw new Error("path is required.");
    payload.path = workspacePath(registry, input.workspaceId, input.path).absolute;
  }
  payload.foreground = colorObject(input.foreground);
  payload.background = colorObject(input.background);
  payload.color = colorObject(input.color);
  if (input.pixels) {
    payload.pixels = input.pixels.map((pixel) => ({
      x: pixel.x,
      y: pixel.y,
      color: colorObject(pixel.color),
    }));
  }
  return payload;
}

export async function asepriteLiveEditor(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: AsepriteLiveEditorInput,
): Promise<ToolResponse> {
  try {
    registry.getWorkspace(input.workspaceId);
    if (input.action === "install_bridge") {
      if (!input.allowGlobalWrite) throw new Error("allowGlobalWrite=true is required to install the Aseprite extension.");
      const installation = await ensureGlobalAsepriteBridge();
      cachedBridgeStatus = undefined;
      const discovery = await discoverLocalIntegrations({ forceRefresh: true });
      return textResponse({
        ...installation,
        version: BRIDGE_VERSION,
        asepriteRunning: processDetected(discovery, "aseprite"),
        restartRequired: processDetected(discovery, "aseprite"),
      });
    }
    if (input.action === "bridge_status") {
      const paths = bridgePaths();
      const status = await getAsepriteBridgeRuntimeStatus({ force: true });
      return textResponse({ ...status, targetPath: paths.extensionTarget });
    }
    if (input.action === "save") {
      const document = await inspectLiveDocument(registry, input);
      assertWorkspaceDocument(registry, input.workspaceId, document?.filename);
    }
    const response = await bridgeRequest(sanitizeLivePayload(registry, input));
    if (!response.ok) throw new Error(response.error || "Aseprite live bridge request failed.");
    return textResponse({ bridgeVersion: response.bridgeVersion, result: response.result });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteCaptureCanvas(
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    documentId?: string;
    filename?: string;
    frame?: number;
    scale?: number;
    outputPath?: string;
  },
): Promise<ToolResponse> {
  try {
    const workspace = registry.getWorkspace(input.workspaceId);
    const outputPath = registry.resolveArtifactPath(
      workspace,
      input.outputPath?.trim() || "current-canvas.png",
      "aseprite-captures",
    );
    await mkdir(dirname(outputPath), { recursive: true });
    const response = await bridgeRequest({
      action: "capture_canvas",
      documentId: input.documentId,
      filename: input.filename,
      frame: input.frame,
      scale: input.scale,
      outputPath,
    });
    if (!response.ok) throw new Error(response.error || "Aseprite canvas capture failed.");
    const relativePath = relative(workspace.root, outputPath).replace(/\\/g, "/");
    const buffer = await readFile(outputPath);
    return {
      content: [
        ...inlineImageOrNotice(buffer, `Aseprite canvas ${relativePath}`, "image/png"),
        {
          type: "text",
          text: JSON.stringify({
            bridgeVersion: response.bridgeVersion,
            ...(response.result as Record<string, unknown>),
            outputPath: relativePath,
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}
