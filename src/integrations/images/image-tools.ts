import { access, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import type { WorkspaceRegistry } from "../../workspaces.js";
import type { ToolResponse } from "../../pi-tools.js";
import { inlineImageOrNotice } from "../../tool-result-budget.js";
import { decodePng, encodePng, type DecodedPng } from "./png-codec.js";

const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_COMPARE_PIXELS = 16_777_216;
const MAX_SPRITE_FRAMES = 4_096;

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
  if (buffer.length < 10) throw new Error("Image file buffer is too small to identify.");

  if (isPng(buffer)) {
    if (buffer.length < 24) throw new Error("PNG file is missing its IHDR dimensions.");
    return validateDimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
  }

  if (buffer.toString("ascii", 0, 3) === "GIF") {
    return validateDimensions(buffer.readUInt16LE(6), buffer.readUInt16LE(8));
  }

  if (
    buffer.length >= 30
    && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    const chunkType = buffer.toString("ascii", 12, 16);
    if (chunkType === "VP8 ") {
      return validateDimensions(
        buffer.readUInt16LE(26) & 0x3fff,
        buffer.readUInt16LE(28) & 0x3fff,
      );
    }
    if (chunkType === "VP8L" && buffer[20] === 0x2f) {
      const b1 = buffer[21]!;
      const b2 = buffer[22]!;
      const b3 = buffer[23]!;
      const b4 = buffer[24]!;
      return validateDimensions(
        1 + (((b2 & 0x3f) << 8) | b1),
        1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
      );
    }
    if (chunkType === "VP8X") {
      return validateDimensions(
        1 + readUInt24LE(buffer, 24),
        1 + readUInt24LE(buffer, 27),
      );
    }
    throw new Error(`Unsupported WebP chunk type ${JSON.stringify(chunkType)}.`);
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return parseJpegDimensions(buffer);
  }

  throw new Error("Unsupported or malformed image format. Supported formats: PNG, JPEG, GIF, and WebP.");
}

export async function inspectImage(
  registry: WorkspaceRegistry,
  input: InspectImageInput,
): Promise<ToolResponse> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absolutePath = registry.resolvePath(workspace, input.path);
  const { buffer, fileSize } = await readBoundedImage(absolutePath);
  const ext = extname(input.path).toLowerCase();
  const dimensions = parseImageDimensions(buffer);
  const mimeType = mimeTypeForExtension(ext);

  const info = {
    format: ext.slice(1),
    mimeType,
    width: dimensions.width,
    height: dimensions.height,
    fileSize,
    hasAlpha: detectAlphaCapability(buffer, ext),
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
  const threshold = validateThreshold(input.threshold);

  const [referenceFile, candidateFile] = await Promise.all([
    readBoundedImage(refPath),
    readBoundedImage(candPath),
  ]);
  const reference = decodePng(referenceFile.buffer);
  const candidate = decodePng(candidateFile.buffer);
  const dimensionsMatch = reference.width === candidate.width && reference.height === candidate.height;
  const isExactByteMatch = referenceFile.buffer.equals(candidateFile.buffer);
  const comparison = compareDecodedImages(
    reference,
    candidate,
    threshold,
    input.ignoreTransparentPixels ?? false,
  );

  let diffPath: string | undefined;
  let diffBuffer: Buffer | undefined;
  if (input.diffOutputPath) {
    if (extname(input.diffOutputPath).toLowerCase() !== ".png") {
      throw new Error("Image diff output must use a .png extension.");
    }
    const absoluteDiffPath = registry.resolveArtifactPath(
      workspace,
      input.diffOutputPath,
      "images",
    );
    await mkdir(dirname(absoluteDiffPath), { recursive: true });
    diffBuffer = encodePng(comparison.diff);
    await writeFile(absoluteDiffPath, diffBuffer);
    diffPath = relative(workspace.root, absoluteDiffPath).replace(/\\/g, "/");
  }

  const resultData = {
    referenceDimensions: { width: reference.width, height: reference.height },
    candidateDimensions: { width: candidate.width, height: candidate.height },
    dimensionsMatch,
    isExactByteMatch,
    isExactPixelMatch: dimensionsMatch && comparison.exactMatchingPixels === comparison.comparedPixels,
    threshold,
    ignoredTransparentPixels: comparison.ignoredTransparentPixels,
    comparedPixels: comparison.comparedPixels,
    exactMatchingPixels: comparison.exactMatchingPixels,
    matchingPixels: comparison.matchingPixels,
    changedPixels: comparison.changedPixels,
    exactMatchPercentage: comparison.exactMatchPercentage,
    toleranceMatchPercentage: comparison.toleranceMatchPercentage,
    similarityPercentage: comparison.similarityPercentage,
    maxChannelDifference: comparison.maxChannelDifference,
    meanRgbaDifference: comparison.meanRgbaDifference,
    diffOutputPath: diffPath,
  };

  const responseContent: ToolResponse["content"] = [
    { type: "text", text: JSON.stringify(resultData, null, 2) },
  ];
  if (diffBuffer) {
    responseContent.unshift(
      ...inlineImageOrNotice(diffBuffer, `Image diff ${diffPath ?? "output"}`, "image/png"),
    );
  }
  return { content: responseContent };
}

export async function inspectSprite(
  registry: WorkspaceRegistry,
  input: InspectSpriteInput,
): Promise<ToolResponse> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absolutePath = registry.resolvePath(workspace, input.path);
  const { buffer } = await readBoundedImage(absolutePath);
  const dimensions = parseImageDimensions(buffer);
  const cellWidth = validateCellDimension(input.expectedCellWidth ?? 32, "width");
  const cellHeight = validateCellDimension(input.expectedCellHeight ?? 32, "height");

  const possibleColumns = Math.floor(dimensions.width / cellWidth);
  const possibleRows = Math.floor(dimensions.height / cellHeight);
  const dividesEvenly = dimensions.width % cellWidth === 0 && dimensions.height % cellHeight === 0;

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        dimensions,
        cellWidth,
        cellHeight,
        possibleColumns,
        possibleRows,
        dividesEvenly,
        pixelArtStatus: dimensions.width <= 1024 && dimensions.height <= 1024 ? "likely" : "unknown",
      }, null, 2),
    }],
  };
}

export async function splitSpriteSheet(
  registry: WorkspaceRegistry,
  input: SplitSpriteSheetInput,
): Promise<ToolResponse> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absolutePath = registry.resolvePath(workspace, input.path);
  const outputDirectory = registry.resolveArtifactPath(
    workspace,
    input.outputDirectory,
    "images",
  );
  const columns = validateGridDimension(input.columns, "columns");
  const rows = validateGridDimension(input.rows, "rows");
  if (columns * rows > MAX_SPRITE_FRAMES) {
    throw new Error(`Sprite grid exceeds the ${MAX_SPRITE_FRAMES}-frame safety limit.`);
  }

  const { buffer } = await readBoundedImage(absolutePath);
  const source = decodePng(buffer);
  if (source.width % columns !== 0 || source.height % rows !== 0) {
    throw new Error(
      `Sprite dimensions ${source.width}x${source.height} are not evenly divisible by ${columns} columns and ${rows} rows.`,
    );
  }

  const frameWidth = source.width / columns;
  const frameHeight = source.height / rows;
  const pattern = input.namingPattern ?? "frame_{col}_{row}.png";
  const plannedFrames: Array<{ path: string; relativePath: string; buffer: Buffer }> = [];
  const plannedNames = new Set<string>();

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const fileName = frameFileName(pattern, column, row);
      const normalizedName = fileName.toLowerCase();
      if (plannedNames.has(normalizedName)) {
        throw new Error(`Sprite naming pattern produces duplicate filename: ${fileName}`);
      }
      plannedNames.add(normalizedName);
      const framePath = join(outputDirectory, fileName);
      const frame = cropRgba(source, column * frameWidth, row * frameHeight, frameWidth, frameHeight);
      plannedFrames.push({
        path: framePath,
        relativePath: relative(workspace.root, framePath).replace(/\\/g, "/"),
        buffer: encodePng(frame),
      });
    }
  }

  for (const frame of plannedFrames) {
    try {
      await access(frame.path);
      throw new Error(`Refusing to overwrite existing sprite frame: ${frame.relativePath}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Refusing to overwrite")) throw error;
    }
  }

  await mkdir(outputDirectory, { recursive: true });
  const writtenPaths: string[] = [];
  try {
    for (const frame of plannedFrames) {
      await writeFile(frame.path, frame.buffer, { flag: "wx" });
      writtenPaths.push(frame.path);
    }
  } catch (error) {
    await Promise.allSettled(writtenPaths.map((path) => unlink(path)));
    throw error;
  }

  return {
    content: [{
      type: "text",
      text: `Split sprite sheet into ${plannedFrames.length} frames (${frameWidth}x${frameHeight} each):\n${plannedFrames.map((frame) => frame.relativePath).join("\n")}`,
    }],
  };
}

function compareDecodedImages(
  reference: DecodedPng,
  candidate: DecodedPng,
  threshold: number,
  ignoreTransparentPixels: boolean,
): {
  comparedPixels: number;
  ignoredTransparentPixels: number;
  exactMatchingPixels: number;
  matchingPixels: number;
  changedPixels: number;
  exactMatchPercentage: number;
  toleranceMatchPercentage: number;
  similarityPercentage: number;
  maxChannelDifference: number;
  meanRgbaDifference: number;
  diff: DecodedPng;
} {
  const width = Math.max(reference.width, candidate.width);
  const height = Math.max(reference.height, candidate.height);
  if (width * height > MAX_COMPARE_PIXELS) {
    throw new Error(`Comparison canvas exceeds the ${MAX_COMPARE_PIXELS.toLocaleString("en-US")}-pixel safety limit.`);
  }

  const diffData = Buffer.alloc(width * height * 4);
  let comparedPixels = 0;
  let ignoredTransparentPixels = 0;
  let exactMatchingPixels = 0;
  let matchingPixels = 0;
  let changedPixels = 0;
  let maximumDifference = 0;
  let differenceSum = 0;
  let similaritySum = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const referenceContainsPixel = x < reference.width && y < reference.height;
      const candidateContainsPixel = x < candidate.width && y < candidate.height;
      if (!referenceContainsPixel && !candidateContainsPixel) continue;
      const ref = pixelAt(reference, x, y);
      const cand = pixelAt(candidate, x, y);
      if (ignoreTransparentPixels && ref[3] === 0 && cand[3] === 0) {
        ignoredTransparentPixels++;
        continue;
      }

      comparedPixels++;
      const differences = [
        Math.abs(ref[0] - cand[0]),
        Math.abs(ref[1] - cand[1]),
        Math.abs(ref[2] - cand[2]),
        Math.abs(ref[3] - cand[3]),
      ];
      const pixelMaximum = Math.max(...differences);
      const pixelDifference = differences.reduce((sum, value) => sum + value, 0);
      maximumDifference = Math.max(maximumDifference, pixelMaximum);
      differenceSum += pixelDifference;
      similaritySum += 1 - pixelDifference / (4 * 255);

      const target = (y * width + x) * 4;
      if (pixelMaximum === 0) exactMatchingPixels++;
      if (pixelMaximum <= threshold) {
        matchingPixels++;
        diffData[target] = differences[0];
        diffData[target + 1] = differences[1];
        diffData[target + 2] = differences[2];
        diffData[target + 3] = pixelMaximum;
      } else {
        changedPixels++;
        diffData[target] = 255;
        diffData[target + 1] = Math.min(255, differences[1]);
        diffData[target + 2] = 255;
        diffData[target + 3] = Math.max(96, pixelMaximum);
      }
    }
  }

  const denominator = Math.max(comparedPixels, 1);
  return {
    comparedPixels,
    ignoredTransparentPixels,
    exactMatchingPixels,
    matchingPixels,
    changedPixels,
    exactMatchPercentage: Number(((exactMatchingPixels / denominator) * 100).toFixed(2)),
    toleranceMatchPercentage: Number(((matchingPixels / denominator) * 100).toFixed(2)),
    similarityPercentage: Number(((similaritySum / denominator) * 100).toFixed(2)),
    maxChannelDifference: maximumDifference,
    meanRgbaDifference: Number((differenceSum / (denominator * 4)).toFixed(4)),
    diff: { width, height, data: diffData },
  };
}

function cropRgba(
  source: DecodedPng,
  startX: number,
  startY: number,
  width: number,
  height: number,
): DecodedPng {
  const data = Buffer.alloc(width * height * 4);
  const sourceRowBytes = source.width * 4;
  const targetRowBytes = width * 4;
  for (let row = 0; row < height; row++) {
    const sourceOffset = (startY + row) * sourceRowBytes + startX * 4;
    source.data.copy(data, row * targetRowBytes, sourceOffset, sourceOffset + targetRowBytes);
  }
  return { width, height, data };
}

function pixelAt(image: DecodedPng, x: number, y: number): [number, number, number, number] {
  if (x >= image.width || y >= image.height) return [0, 0, 0, 0];
  const offset = (y * image.width + x) * 4;
  return [
    image.data[offset]!,
    image.data[offset + 1]!,
    image.data[offset + 2]!,
    image.data[offset + 3]!,
  ];
}

async function readBoundedImage(path: string): Promise<{ buffer: Buffer; fileSize: number }> {
  const fileStats = await stat(path);
  if (!fileStats.isFile()) throw new Error(`Image path is not a file: ${path}`);
  if (fileStats.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`Image file size exceeds the ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024} MB safety limit.`);
  }
  return { buffer: await readFile(path), fileSize: fileStats.size };
}

function frameFileName(pattern: string, column: number, row: number): string {
  const fileName = pattern
    .replaceAll("{col}", String(column))
    .replaceAll("{row}", String(row));
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.png$/i.test(fileName)) {
    throw new Error("Sprite namingPattern must produce a safe PNG filename, not a path.");
  }
  const stem = fileName.slice(0, -4).toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/.test(stem)) {
    throw new Error(`Sprite frame filename is reserved on Windows: ${fileName}`);
  }
  return fileName;
}

function validateThreshold(value: number | undefined): number {
  const threshold = value ?? 0;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) {
    throw new Error("Image comparison threshold must be between 0 and 255.");
  }
  return threshold;
}

function validateGridDimension(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 256) {
    throw new Error(`Sprite ${label} must be an integer between 1 and 256.`);
  }
  return value;
}

function validateCellDimension(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 16_384) {
    throw new Error(`Sprite cell ${label} must be an integer between 1 and 16384.`);
  }
  return value;
}

function validateDimensions(width: number, height: number): ImageDimensions {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`Invalid image dimensions: ${width}x${height}.`);
  }
  return { width, height };
}

function mimeTypeForExtension(extension: string): string {
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  const mimeType = mimeTypes[extension];
  if (!mimeType) throw new Error(`Unsupported image extension ${JSON.stringify(extension)}.`);
  return mimeType;
}

function detectAlphaCapability(buffer: Buffer, extension: string): boolean {
  if (extension === ".png" && buffer.length > 25) return [4, 6].includes(buffer[25]!);
  if (extension === ".gif") return true;
  if (extension === ".webp") return true;
  return false;
}

function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a;
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer[offset]! | (buffer[offset + 1]! << 8) | (buffer[offset + 2]! << 16);
}

function parseJpegDimensions(buffer: Buffer): ImageDimensions {
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++]!;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      throw new Error("JPEG contains an invalid segment length.");
    }
    const isStartOfFrame = [
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
      0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ].includes(marker);
    if (isStartOfFrame) {
      if (segmentLength < 7) throw new Error("JPEG start-of-frame segment is too short.");
      return validateDimensions(
        buffer.readUInt16BE(offset + 5),
        buffer.readUInt16BE(offset + 3),
      );
    }
    offset += segmentLength;
  }
  throw new Error("JPEG dimensions were not found.");
}
