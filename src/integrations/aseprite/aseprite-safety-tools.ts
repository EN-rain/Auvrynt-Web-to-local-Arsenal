import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative } from "node:path";
import { promisify } from "node:util";
import type { ServerConfig } from "../../config.js";
import type { ToolResponse } from "../../pi-tools.js";
import type { ProcessManager } from "../../processes.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import {
  asepriteConvertFile,
  asepriteExportSpriteSheet,
  errorResponse,
  luaString,
  openSpriteScript,
  resolveAsepriteExecutable,
  runLua,
  sanitizeCliOutput,
  textResponse,
  workspacePath,
} from "./aseprite-tools.js";
import { asepriteAuditSprite, asepriteCompareDocuments } from "./aseprite-analysis-tools.js";

const execFileAsync = promisify(execFile);
const MAX_BATCH_FILES = 128;

function safeSegment(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 120) || "sprite";
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function checkpointRoot(registry: WorkspaceRegistry, workspaceId: string, filePath: string): string {
  const workspace = registry.getWorkspace(workspaceId);
  return registry.resolveArtifactPath(
    workspace,
    `checkpoints/${safeSegment(filePath)}`,
    "aseprite",
  );
}

function asepriteUserDataRoot(): string {
  if (process.env.ASEPRITE_USER_DATA_DIR?.trim()) return process.env.ASEPRITE_USER_DATA_DIR.trim();
  if (process.platform === "win32" && process.env.APPDATA) return join(process.env.APPDATA, "Aseprite");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Aseprite");
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "aseprite");
}

async function assertTreeContainsNoSymlinks(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in extension packages: ${path}`);
  if (!info.isDirectory()) return;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    await assertTreeContainsNoSymlinks(join(path, entry.name));
  }
}

async function directorySize(path: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += await directorySize(child);
    else if (entry.isFile()) total += (await stat(child)).size;
  }
  return total;
}

export async function assertAsepriteExpectedVersion(
  registry: WorkspaceRegistry,
  workspaceId: string,
  filePath: string,
  expectedVersion?: string,
): Promise<string> {
  const file = workspacePath(registry, workspaceId, filePath);
  const actual = await sha256(file.absolute);
  if (expectedVersion && expectedVersion !== actual) {
    throw new Error(
      `Aseprite file changed since it was inspected. Expected ${expectedVersion}, current ${actual}.`,
    );
  }
  return actual;
}

export async function asepriteFileSafety(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePath: string;
    action: "status" | "checkpoint" | "list_checkpoints" | "rollback" | "delete_checkpoint" | "assert_version";
    checkpointId?: string;
    expectedVersion?: string;
    label?: string;
  },
): Promise<ToolResponse> {
  try {
    const file = workspacePath(registry, input.workspaceId, input.filePath);
    const root = checkpointRoot(registry, input.workspaceId, file.relative);
    await mkdir(root, { recursive: true });
    if (input.action === "status" || input.action === "assert_version") {
      const info = await stat(file.absolute);
      const version = await assertAsepriteExpectedVersion(
        registry,
        input.workspaceId,
        input.filePath,
        input.action === "assert_version" ? input.expectedVersion : undefined,
      );
      return textResponse({
        file: file.relative,
        version,
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
        asepriteRunning: (await import("../integration-discovery.js")).processDetected(
          await (await import("../integration-discovery.js")).discoverLocalIntegrations({ forceRefresh: true }),
          "aseprite",
        ),
      });
    }
    if (input.action === "checkpoint") {
      const version = await assertAsepriteExpectedVersion(
        registry,
        input.workspaceId,
        input.filePath,
        input.expectedVersion,
      );
      const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${version.slice(0, 12)}`;
      const extension = extname(file.absolute) || ".aseprite";
      const copyPath = join(root, `${id}${extension}`);
      const metadataPath = join(root, `${id}.json`);
      await copyFile(file.absolute, copyPath);
      await writeFile(metadataPath, JSON.stringify({
        id,
        file: file.relative,
        version,
        label: input.label?.trim() || undefined,
        createdAt: new Date().toISOString(),
        copyFile: basename(copyPath),
      }, null, 2), "utf8");
      return textResponse({ checkpointId: id, file: file.relative, version });
    }
    const metadataFiles = (await readdir(root)).filter((name) => name.endsWith(".json")).sort().reverse();
    const checkpoints = [];
    for (const name of metadataFiles) {
      try {
        checkpoints.push(JSON.parse(await readFile(join(root, name), "utf8")));
      } catch {
        checkpoints.push({ id: name.slice(0, -5), invalidMetadata: true });
      }
    }
    if (input.action === "list_checkpoints") return textResponse({ file: file.relative, checkpoints });
    const id = input.checkpointId?.trim();
    if (!id || !/^[a-zA-Z0-9._-]+$/.test(id)) throw new Error("A valid checkpointId is required.");
    const metadata = checkpoints.find((item: any) => item.id === id) as any;
    if (!metadata) throw new Error(`Checkpoint ${id} was not found.`);
    const copyPath = join(root, metadata.copyFile);
    if (input.action === "delete_checkpoint") {
      await rm(copyPath, { force: true });
      await rm(join(root, `${id}.json`), { force: true });
      return textResponse({ deleted: id });
    }
    await assertAsepriteExpectedVersion(registry, input.workspaceId, input.filePath, input.expectedVersion);
    const temporary = `${file.absolute}.auvrynt-rollback-${Date.now()}`;
    await copyFile(copyPath, temporary);
    await rename(temporary, file.absolute);
    return textResponse({
      restored: id,
      file: file.relative,
      version: await sha256(file.absolute),
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

interface ExportPreset {
  filePath: string;
  sheetPath: string;
  dataPath?: string;
  sheetType?: "horizontal" | "vertical" | "rows" | "columns" | "packed";
  columns?: number;
  rows?: number;
  sheetWidth?: number;
  sheetHeight?: number;
  tag?: string;
  layer?: string;
  ignoreLayers?: string[];
  allLayers?: boolean;
  splitLayers?: boolean;
  splitTags?: boolean;
  splitSlices?: boolean;
  splitGrid?: boolean;
  playSubtags?: boolean;
  ignoreEmpty?: boolean;
  trim?: boolean;
  trimSprite?: boolean;
  trimByGrid?: boolean;
  extrude?: boolean;
  mergeDuplicates?: boolean;
  borderPadding?: number;
  shapePadding?: number;
  innerPadding?: number;
  filenameFormat?: string;
  tagnameFormat?: string;
  dataFormat?: "json-array" | "json-hash";
}

function presetDirectory(registry: WorkspaceRegistry, workspaceId: string): string {
  const workspace = registry.getWorkspace(workspaceId);
  return registry.resolvePath(workspace, ".auvrynt/aseprite-export-presets");
}

async function runExtendedExport(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  workspaceId: string,
  preset: ExportPreset,
): Promise<Record<string, unknown>> {
  const workspace = registry.getWorkspace(workspaceId);
  const executable = await resolveAsepriteExecutable(config);
  const source = workspacePath(registry, workspaceId, preset.filePath);
  const sheet = workspacePath(registry, workspaceId, preset.sheetPath);
  const data = preset.dataPath ? workspacePath(registry, workspaceId, preset.dataPath) : undefined;
  await mkdir(dirname(sheet.absolute), { recursive: true });
  if (data) await mkdir(dirname(data.absolute), { recursive: true });
  const args = ["-b", source.absolute, "--sheet", sheet.absolute, "--sheet-type", preset.sheetType ?? "horizontal"];
  if (data) args.push("--data", data.absolute, "--format", preset.dataFormat ?? "json-array");
  if (preset.columns) args.push("--sheet-columns", String(preset.columns));
  if (preset.rows) args.push("--sheet-rows", String(preset.rows));
  if (preset.sheetWidth) args.push("--sheet-width", String(preset.sheetWidth));
  if (preset.sheetHeight) args.push("--sheet-height", String(preset.sheetHeight));
  if (preset.tag) args.push("--tag", preset.tag);
  if (preset.layer) args.push("--layer", preset.layer);
  for (const ignored of preset.ignoreLayers ?? []) args.push("--ignore-layer", ignored);
  if (preset.allLayers) args.push("--all-layers");
  if (preset.splitLayers) args.push("--split-layers");
  if (preset.splitTags) args.push("--split-tags");
  if (preset.splitSlices) args.push("--split-slices");
  if (preset.splitGrid) args.push("--split-grid");
  if (preset.playSubtags) args.push("--play-subtags");
  if (preset.ignoreEmpty) args.push("--ignore-empty");
  if (preset.trim) args.push("--trim");
  if (preset.trimSprite) args.push("--trim-sprite");
  if (preset.trimByGrid) args.push("--trim-by-grid");
  if (preset.extrude) args.push("--extrude");
  if (preset.mergeDuplicates) args.push("--merge-duplicates");
  if (preset.borderPadding !== undefined) args.push("--border-padding", String(preset.borderPadding));
  if (preset.shapePadding !== undefined) args.push("--shape-padding", String(preset.shapePadding));
  if (preset.innerPadding !== undefined) args.push("--inner-padding", String(preset.innerPadding));
  if (preset.filenameFormat) args.push("--filename-format", preset.filenameFormat);
  if (preset.tagnameFormat) args.push("--tagname-format", preset.tagnameFormat);
  const { stdout, stderr } = await execFileAsync(executable, args, {
    cwd: workspace.root,
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    source: source.relative,
    sheet: sheet.relative,
    data: data?.relative,
    output: sanitizeCliOutput([stdout.trim(), stderr.trim()].filter(Boolean).join("\n")).slice(-4000),
  };
}

async function validateExportData(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  workspaceId: string,
  preset: ExportPreset,
): Promise<Record<string, unknown>> {
  const source = workspacePath(registry, workspaceId, preset.filePath);
  const sheet = workspacePath(registry, workspaceId, preset.sheetPath);
  const data = preset.dataPath ? workspacePath(registry, workspaceId, preset.dataPath) : undefined;
  const problems: Array<Record<string, unknown>> = [];
  if (!existsSync(sheet.absolute)) problems.push({ code: "missing_sheet", path: sheet.relative });
  let metadataFrames: any[] = [];
  if (data) {
    if (!existsSync(data.absolute)) problems.push({ code: "missing_metadata", path: data.relative });
    else {
      const parsed = JSON.parse(await readFile(data.absolute, "utf8"));
      const frames = parsed.frames ?? parsed;
      metadataFrames = Array.isArray(frames)
        ? frames
        : frames && typeof frames === "object"
          ? Object.values(frames)
          : [];
      const rectangles = metadataFrames.map((entry: any, index) => ({
        index,
        x: entry.frame?.x,
        y: entry.frame?.y,
        width: entry.frame?.w ?? entry.frame?.width,
        height: entry.frame?.h ?? entry.frame?.height,
      })).filter((rect) => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite));
      for (let i = 0; i < rectangles.length; i++) {
        for (let j = i + 1; j < rectangles.length; j++) {
          const a = rectangles[i];
          const b = rectangles[j];
          const overlap = a.x < b.x + b.width && a.x + a.width > b.x
            && a.y < b.y + b.height && a.y + a.height > b.y;
          if (overlap) problems.push({ code: "overlapping_frames", first: a.index, second: b.index });
        }
      }
    }
  }
  const sourceInfo = await runLua(config, registry, workspaceId, `
${openSpriteScript(source.absolute)}
local count=#sprite.frames
if ${preset.tag ? "true" : "false"} then
  local found=nil
  for _,tag in ipairs(sprite.tags) do if tag.name==${luaString(preset.tag ?? "")} then found=tag break end end
  if found==nil then fail("Configured export tag was not found") end
  count=found.toFrame.frameNumber-found.fromFrame.frameNumber+1
end
emit_result({expected_frames=count,summary=sprite_summary(sprite)})
sprite:close()
`) as any;
  if (data && !preset.mergeDuplicates && metadataFrames.length !== sourceInfo.expected_frames) {
    problems.push({ code: "frame_count_mismatch", expected: sourceInfo.expected_frames, actual: metadataFrames.length });
  }
  return { valid: problems.length === 0, problems, source: sourceInfo.summary, metadataFrames: metadataFrames.length };
}

export async function asepriteManageExportPreset(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    action: "save" | "list" | "delete" | "run" | "repeat" | "validate";
    name?: string;
    preset?: ExportPreset;
  },
): Promise<ToolResponse> {
  try {
    const directory = presetDirectory(registry, input.workspaceId);
    await mkdir(directory, { recursive: true });
    const lastPath = join(directory, "_last-export.json");
    if (input.action === "list") {
      const names = (await readdir(directory)).filter((name) => name.endsWith(".json") && name !== "_last-export.json").map((name) => name.slice(0, -5));
      return textResponse({ presets: names.sort() });
    }
    const name = input.name?.trim();
    if (input.action !== "repeat" && (!name || !/^[a-zA-Z0-9._-]+$/.test(name))) throw new Error("A valid preset name is required.");
    const path = name ? join(directory, `${name}.json`) : lastPath;
    if (input.action === "save") {
      if (!input.preset) throw new Error("preset is required.");
      await writeFile(path, JSON.stringify(input.preset, null, 2), "utf8");
      return textResponse({ saved: name });
    }
    if (input.action === "delete") {
      await rm(path, { force: true });
      return textResponse({ deleted: name });
    }
    const preset = input.action === "repeat"
      ? JSON.parse(await readFile(lastPath, "utf8")) as ExportPreset
      : JSON.parse(await readFile(path, "utf8")) as ExportPreset;
    if (input.action === "validate") return textResponse(await validateExportData(config, registry, input.workspaceId, preset));
    const result = await runExtendedExport(config, registry, input.workspaceId, preset);
    await writeFile(lastPath, JSON.stringify(preset, null, 2), "utf8");
    return textResponse({ ...result, validation: await validateExportData(config, registry, input.workspaceId, preset) });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteBatchProcess(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    filePaths: string[];
    operation: "audit" | "convert" | "export" | "repair";
    dryRun?: boolean;
    outputDirectory?: string;
    inPlace?: boolean;
    scale?: number;
    colorMode?: "rgb" | "grayscale" | "indexed";
    palettePath?: string;
    trim?: boolean;
    sheetType?: "horizontal" | "vertical" | "rows" | "columns" | "packed";
  },
): Promise<ToolResponse> {
  try {
    if (!Array.isArray(input.filePaths) || input.filePaths.length === 0) throw new Error("filePaths must not be empty.");
    if (input.filePaths.length > MAX_BATCH_FILES) throw new Error(`A maximum of ${MAX_BATCH_FILES} files is supported.`);
    if (!input.inPlace && input.operation !== "audit" && !input.outputDirectory) throw new Error("outputDirectory is required unless inPlace is true.");
    const plan = input.filePaths.map((filePath) => ({ filePath, operation: input.operation }));
    if (input.dryRun) return textResponse({ dryRun: true, plan });
    const results: Array<Record<string, unknown>> = [];
    for (const filePath of input.filePaths) {
      const source = workspacePath(registry, input.workspaceId, filePath);
      if (input.operation === "audit") {
        const response = await asepriteAuditSprite(config, registry, { workspaceId: input.workspaceId, filePath });
        results.push({ filePath, response: response.content[0]?.type === "text" ? response.content[0].text : response });
        continue;
      }
      if (input.inPlace) {
        await asepriteFileSafety(config, registry, {
          workspaceId: input.workspaceId,
          filePath,
          action: "checkpoint",
          label: `batch-${input.operation}`,
        });
      }
      const outputPath = input.inPlace
        ? filePath
        : `${input.outputDirectory!.replace(/[\\/]$/, "")}/${basename(filePath)}`;
      if (input.operation === "convert") {
        const response = await asepriteConvertFile(config, registry, {
          workspaceId: input.workspaceId,
          filePath,
          outputPath,
          scale: input.scale,
          colorMode: input.colorMode,
          palettePath: input.palettePath,
          trim: input.trim,
        });
        results.push({ filePath, outputPath, response: response.content[0]?.type === "text" ? response.content[0].text : response });
      } else if (input.operation === "export") {
        const base = basename(filePath, extname(filePath));
        const sheetPath = `${input.outputDirectory!.replace(/[\\/]$/, "")}/${base}.png`;
        const dataPath = `${input.outputDirectory!.replace(/[\\/]$/, "")}/${base}.json`;
        const response = await asepriteExportSpriteSheet(config, registry, {
          workspaceId: input.workspaceId,
          filePath,
          sheetPath,
          dataPath,
          sheetType: input.sheetType,
          trim: input.trim,
        });
        results.push({ filePath, sheetPath, dataPath, response: response.content[0]?.type === "text" ? response.content[0].text : response });
      } else {
        const response = await asepriteMaintenance(config, registry, {
          workspaceId: input.workspaceId,
          action: "repair",
          filePath,
          outputPath,
        });
        results.push({ filePath, outputPath, response: response.content[0]?.type === "text" ? response.content[0].text : response });
      }
    }
    return textResponse({ processed: results.length, results });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function asepriteMaintenance(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    action: "validate" | "repair" | "roundtrip";
    filePath: string;
    outputPath?: string;
    intermediateFormat?: "png" | "gif" | "webp";
  },
): Promise<ToolResponse> {
  try {
    const source = workspacePath(registry, input.workspaceId, input.filePath);
    if (input.action === "validate") {
      const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(source.absolute)}
emit_result({valid=true,summary=sprite_summary(sprite),modified=sprite.isModified})
sprite:close()
`);
      return textResponse(result);
    }
    if (!input.outputPath) throw new Error("outputPath is required.");
    const output = workspacePath(registry, input.workspaceId, input.outputPath);
    await mkdir(dirname(output.absolute), { recursive: true });
    if (input.action === "repair") {
      const result = await runLua(config, registry, input.workspaceId, `
${openSpriteScript(source.absolute)}
if not sprite:saveCopyAs(${luaString(output.absolute)}) then fail("Unable to save repaired copy") end
local reopened=app.open(${luaString(output.absolute)})
if reopened==nil then fail("Repaired copy could not be reopened") end
emit_result({source=${luaString(source.relative)},output=${luaString(output.relative)},summary=sprite_summary(reopened)})
reopened:close() sprite:close()
`);
      return textResponse(result);
    }
    const workspace = registry.getWorkspace(input.workspaceId);
    const executable = await resolveAsepriteExecutable(config);
    const format = input.intermediateFormat ?? "png";
    const intermediate = registry.resolveArtifactPath(workspace, `roundtrip/${Date.now()}.${format}`, "aseprite");
    await mkdir(dirname(intermediate), { recursive: true });
    await execFileAsync(executable, ["-b", source.absolute, "--save-as", intermediate], { cwd: workspace.root, timeout: 120_000, windowsHide: true });
    await execFileAsync(executable, ["-b", intermediate, "--save-as", output.absolute], { cwd: workspace.root, timeout: 120_000, windowsHide: true });
    const comparison = await asepriteCompareDocuments(config, registry, {
      workspaceId: input.workspaceId,
      referencePath: input.filePath,
      candidatePath: input.outputPath,
      comparePixels: true,
    });
    return textResponse({
      source: source.relative,
      output: output.relative,
      intermediateFormat: format,
      comparison: comparison.content[0]?.type === "text" ? JSON.parse(comparison.content[0].text) : comparison,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

async function listRecoverySessions(): Promise<Array<Record<string, unknown>>> {
  const sessionsRoot = join(asepriteUserDataRoot(), "sessions");
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(sessionsRoot, entry.name);
    const info = await stat(path);
    const documents = (await readdir(path, { withFileTypes: true }).catch(() => [])).filter((child) => child.isDirectory()).map((child) => child.name);
    sessions.push({
      id: entry.name,
      modifiedAt: info.mtime.toISOString(),
      bytes: await directorySize(path),
      documents,
      activePidFile: existsSync(join(path, "pid")),
    });
  }
  return sessions.sort((a: any, b: any) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
}

export async function asepriteRecovery(
  config: ServerConfig,
  registry: WorkspaceRegistry,
  processManager: ProcessManager,
  input: {
    workspaceId: string;
    action: "list" | "archive" | "discard" | "open_recovery_ui";
    sessionId?: string;
    outputDirectory?: string;
    allowGlobalWrite?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const sessionsRoot = join(asepriteUserDataRoot(), "sessions");
    if (input.action === "list") return textResponse({ sessions: await listRecoverySessions() });
    if (input.action === "open_recovery_ui") {
      const executable = await resolveAsepriteExecutable(config);
      const command = `"${executable.replace(/"/g, '\\"')}"`;
      return textResponse(processManager.startProcess({
        workspaceId: input.workspaceId,
        command,
        useShell: false,
      }));
    }
    const id = input.sessionId?.trim();
    if (!id || !/^[a-zA-Z0-9._-]+$/.test(id)) throw new Error("A valid sessionId is required.");
    const source = join(sessionsRoot, id);
    if (!existsSync(source)) throw new Error(`Recovery session ${id} was not found.`);
    const sourceInfo = await lstat(source);
    if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error("Recovery session is not a real directory.");
    if (input.action === "archive") {
      if (!input.outputDirectory) throw new Error("outputDirectory is required.");
      const target = workspacePath(registry, input.workspaceId, `${input.outputDirectory.replace(/[\\/]$/, "")}/${id}`);
      await cp(source, target.absolute, { recursive: true, force: true });
      return textResponse({ archived: id, output: target.relative, note: "Open Aseprite's Recovery UI to reconstruct the archived native session." });
    }
    if (!input.allowGlobalWrite) throw new Error("allowGlobalWrite=true is required to discard an Aseprite recovery session.");
    await rm(source, { recursive: true, force: true });
    return textResponse({ discarded: id });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

async function readExtensionManifests(): Promise<Array<Record<string, unknown>>> {
  const root = join(asepriteUserDataRoot(), "extensions");
  const iniPath = join(asepriteUserDataRoot(), "aseprite.ini");
  const ini = await readFile(iniPath, "utf8").catch(() => "");
  const enabledMap = new Map<string, boolean>();
  const section = ini.match(/(?:^|\r?\n)\[extensions\]\r?\n([\s\S]*?)(?=\r?\n\[|$)/i)?.[1] ?? "";
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^([^=]+)=(true|false|yes|no|1|0)$/i);
    if (match) enabledMap.set(match[1].trim(), /^(true|yes|1)$/i.test(match[2]));
  }
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const extensions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(root, entry.name, "package.json");
    let manifest: any = {};
    try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch { manifest = { invalidManifest: true }; }
    const name = String(manifest.name ?? entry.name);
    extensions.push({
      directory: entry.name,
      name,
      displayName: manifest.displayName,
      version: manifest.version,
      description: manifest.description,
      enabled: enabledMap.get(name) ?? true,
      contributes: manifest.contributes,
      invalidManifest: manifest.invalidManifest,
    });
  }
  return extensions;
}

async function setExtensionEnabled(name: string, enabled: boolean): Promise<void> {
  const iniPath = join(asepriteUserDataRoot(), "aseprite.ini");
  let ini = await readFile(iniPath, "utf8").catch(() => "");
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionPattern = /(^|\r?\n)\[extensions\]\r?\n([\s\S]*?)(?=\r?\n\[|$)/i;
  const match = ini.match(sectionPattern);
  const value = `${name}=${enabled ? "true" : "false"}`;
  if (match) {
    let body = match[2];
    const keyPattern = new RegExp(`^${escaped}=.*$`, "mi");
    body = keyPattern.test(body) ? body.replace(keyPattern, value) : `${body.trimEnd()}\r\n${value}\r\n`;
    ini = ini.replace(sectionPattern, `${match[1]}[extensions]\r\n${body}`);
  } else {
    ini = `${ini.trimEnd()}\r\n\r\n[extensions]\r\n${value}\r\n`;
  }
  await writeFile(iniPath, ini, "utf8");
}

export async function asepriteExtensions(
  registry: WorkspaceRegistry,
  input: {
    workspaceId: string;
    action: "list_extensions" | "list_resources" | "install" | "enable" | "disable" | "remove" | "startup_errors";
    sourceDirectoryPath?: string;
    extensionName?: string;
    allowGlobalWrite?: boolean;
  },
): Promise<ToolResponse> {
  try {
    registry.getWorkspace(input.workspaceId);
    const root = asepriteUserDataRoot();
    if (input.action === "list_extensions") return textResponse({ root, extensions: await readExtensionManifests() });
    if (input.action === "list_resources") {
      const resources: Record<string, string[]> = {};
      for (const name of ["extensions", "palettes", "scripts", "themes", "brushes", "files", "sessions"]) {
        const path = join(root, name);
        resources[name] = (await readdir(path).catch(() => [])).sort();
      }
      const standalone = (await readdir(root).catch(() => [])).filter((name) => /\.(aseprite-brushes|aseprite-layouts|ini)$/i.test(name));
      return textResponse({ root, resources, standalone });
    }
    if (input.action === "startup_errors") {
      const logPath = join(root, "Aseprite.log");
      const lines = (await readFile(logPath, "utf8").catch(() => "")).split(/\r?\n/);
      return textResponse({ logPath, errors: lines.filter((line) => /error|failed|exception/i.test(line)).slice(-200) });
    }
    if (!input.allowGlobalWrite) throw new Error("allowGlobalWrite=true is required for extension changes.");
    const extensionsRoot = join(root, "extensions");
    await mkdir(extensionsRoot, { recursive: true });
    if (input.action === "install") {
      if (!input.sourceDirectoryPath) throw new Error("sourceDirectoryPath is required.");
      const source = workspacePath(registry, input.workspaceId, input.sourceDirectoryPath);
      const info = await lstat(source.absolute);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Extension source must be a real workspace directory.");
      await assertTreeContainsNoSymlinks(source.absolute);
      const manifest = JSON.parse(await readFile(join(source.absolute, "package.json"), "utf8"));
      const name = safeSegment(String(manifest.name ?? basename(source.absolute)));
      const target = join(extensionsRoot, name);
      await cp(source.absolute, target, { recursive: true, force: true, dereference: false });
      await setExtensionEnabled(String(manifest.name ?? name), true);
      return textResponse({ installed: manifest.name ?? name, target, restartRequired: true });
    }
    const name = input.extensionName?.trim();
    if (!name) throw new Error("extensionName is required.");
    const extensions = await readExtensionManifests();
    const extension = extensions.find((item: any) => item.name === name || item.directory === name) as any;
    if (!extension) throw new Error(`Extension ${name} was not found.`);
    if (input.action === "enable" || input.action === "disable") {
      await setExtensionEnabled(extension.name, input.action === "enable");
      return textResponse({ extension: extension.name, enabled: input.action === "enable", restartRequired: true });
    }
    await rm(join(extensionsRoot, extension.directory), { recursive: true, force: true });
    await setExtensionEnabled(extension.name, false);
    return textResponse({ removed: extension.name, restartRequired: true });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}
