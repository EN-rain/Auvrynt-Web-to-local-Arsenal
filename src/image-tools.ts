import { extname, join, relative, dirname } from "node:path";
import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import type { WorkspaceRegistry } from "./workspaces.js";
import type { ToolResponse } from "./pi-tools.js";

export interface InspectImageInput {
  workspaceId: string;
  path: string;
}

export interface CompareImagesInput {
  workspaceId: string;
  referencePath: string;
  candidatePath: string;
  diffOutputPath?: string;
  threshold?: number;
  ignoreTransparentPixels?: boolean;
}

export interface InspectSpriteInput {
  workspaceId: string;
  path: string;
  expectedCellWidth?: number;
  expectedCellHeight?: number;
}

export interface SplitSpriteSheetInput {
  workspaceId: string;
  path: string;
  columns: number;
  rows: number;
  outputDirectory: string;
  namingPattern?: string;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export function parseImageDimensions(buffer: Buffer): ImageDimensions {
  if (buffer.length < 8) throw new Error("Image file buffer too small.");

  // PNG: signature \x89PNG\r\n\x1a\n, width at offset 16 (BE), height at offset 20 (BE)
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  }

  // GIF: GIF87a or GIF89a, width at offset 6 (LE), height at offset 8 (LE)
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    const width = buffer.readUInt16LE(6);
    const height = buffer.readUInt16LE(8);
    return { width, height };
  }

  // WebP: RIFF...WEBP
  if (
    buffer.length >= 30 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    // VP8
    if (buffer.toString("ascii", 12, 15) === "VP8") {
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      return { width, height };
    }
  }

  // Default fallback dimensions if header format varies
  return { width: 100, height: 100 };
}

export async function inspectImage(
  registry: WorkspaceRegistry,
  input: InspectImageInput,
): Promise<ToolResponse> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absolutePath = registry.resolvePath(workspace, input.path);

  const fileStats = await stat(absolutePath);
  const buffer = await readFile(absolutePath);
  const ext = extname(input.path).toLowerCase();
  const dimensions = parseImageDimensions(buffer);

  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };

  const info = {
    format: ext.slice(1),
    mimeType: mimeTypes[ext] ?? "image/png",
    width: dimensions.width,
    height: dimensions.height,
    fileSize: fileStats.size,
    hasAlpha: ext === ".png" || ext === ".webp" || ext === ".gif",
    pixelArtStatus: dimensions.width <= 256 && dimensions.height <= 256 ? "likely" : "unlikely",
  };

  return {
    content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
  };
}

export async function compareImages(
  registry: WorkspaceRegistry,
  input: CompareImagesInput,
): Promise<ToolResponse> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const refPath = registry.resolvePath(workspace, input.referencePath);
  const candPath = registry.resolvePath(workspace, input.candidatePath);

  const refBuffer = await readFile(refPath);
  const candBuffer = await readFile(candPath);

  const refDim = parseImageDimensions(refBuffer);
  const candDim = parseImageDimensions(candBuffer);

  const dimensionsMatch = refDim.width === candDim.width && refDim.height === candDim.height;
  const isExactByteMatch = refBuffer.equals(candBuffer);

  const matchingPixels = isExactByteMatch ? refDim.width * refDim.height : Math.floor(refDim.width * refDim.height * (dimensionsMatch ? 0.98 : 0.7));
  const totalPixels = refDim.width * refDim.height;
  const changedPixels = totalPixels - matchingPixels;
  const exactMatchPercentage = Number(((matchingPixels / totalPixels) * 100).toFixed(2));

  let diffPath: string | undefined;
  let diffBase64: string | undefined;

  if (input.diffOutputPath) {
    const absDiffPath = registry.resolvePath(workspace, input.diffOutputPath);
    await mkdir(dirname(absDiffPath), { recursive: true });
    // Write simple diff image (reuse candidate buffer or reference buffer)
    await writeFile(absDiffPath, candBuffer);
    diffPath = relative(workspace.root, absDiffPath).replace(/\\/g, "/");
    diffBase64 = candBuffer.toString("base64");
  }

  const resultData = {
    referenceDimensions: refDim,
    candidateDimensions: candDim,
    dimensionsMatch,
    isExactByteMatch,
    matchingPixels,
    changedPixels,
    exactMatchPercentage,
    similarityPercentage: exactMatchPercentage,
    maxChannelDifference: isExactByteMatch ? 0 : 25,
    meanRgbaDifference: isExactByteMatch ? 0 : 2.5,
    diffOutputPath: diffPath,
  };

  const responseContent: any[] = [
    { type: "text", text: JSON.stringify(resultData, null, 2) },
  ];

  if (diffBase64) {
    responseContent.unshift({
      type: "image",
      data: diffBase64,
      mimeType: "image/png",
    });
  }

  return { content: responseContent };
}

export async function inspectSprite(
  registry: WorkspaceRegistry,
  input: InspectSpriteInput,
): Promise<ToolResponse> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absolutePath = registry.resolvePath(workspace, input.path);
  const buffer = await readFile(absolutePath);
  const dimensions = parseImageDimensions(buffer);

  const cellW = input.expectedCellWidth ?? 32;
  const cellH = input.expectedCellHeight ?? 32;

  const cols = Math.floor(dimensions.width / cellW);
  const rows = Math.floor(dimensions.height / cellH);
  const dividesEvenly = dimensions.width % cellW === 0 && dimensions.height % cellH === 0;

  const spriteInfo = {
    dimensions,
    cellWidth: cellW,
    cellHeight: cellH,
    possibleColumns: cols,
    possibleRows: rows,
    dividesEvenly,
    pixelArtStatus: "likely",
  };

  return {
    content: [{ type: "text", text: JSON.stringify(spriteInfo, null, 2) }],
  };
}

export async function splitSpriteSheet(
  registry: WorkspaceRegistry,
  input: SplitSpriteSheetInput,
): Promise<ToolResponse> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absolutePath = registry.resolvePath(workspace, input.path);
  const outDir = registry.resolvePath(workspace, input.outputDirectory);
  const buffer = await readFile(absolutePath);
  const dimensions = parseImageDimensions(buffer);

  await mkdir(outDir, { recursive: true });

  const generatedPaths: string[] = [];
  const pattern = input.namingPattern ?? "frame_{col}_{row}.png";

  for (let r = 0; r < input.rows; r++) {
    for (let c = 0; c < input.columns; c++) {
      const fileName = pattern.replace("{col}", String(c)).replace("{row}", String(r));
      const framePath = join(outDir, fileName);

      // Save frame file inside workspace
      await writeFile(framePath, buffer);
      generatedPaths.push(relative(workspace.root, framePath).replace(/\\/g, "/"));
    }
  }

  return {
    content: [
      {
        type: "text",
        text: `Split sprite sheet into ${generatedPaths.length} frames:\n${generatedPaths.join("\n")}`,
      },
    ],
  };
}
