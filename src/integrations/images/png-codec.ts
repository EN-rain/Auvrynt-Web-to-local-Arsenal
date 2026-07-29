import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PNG_PIXELS = 16_777_216;
const MAX_PNG_CHUNK_BYTES = 20 * 1024 * 1024;

export interface DecodedPng {
  width: number;
  height: number;
  data: Buffer;
}

interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  compression: number;
  filter: number;
  interlace: number;
}

export function decodePng(buffer: Buffer): DecodedPng {
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Pixel operations currently require a PNG image.");
  }

  let offset = PNG_SIGNATURE.length;
  let header: PngHeader | undefined;
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  const idatChunks: Buffer[] = [];
  let sawIend = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    if (length > MAX_PNG_CHUNK_BYTES) {
      throw new Error(`PNG chunk exceeds ${MAX_PNG_CHUNK_BYTES} bytes.`);
    }
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.length) throw new Error("PNG chunk extends beyond the file boundary.");

    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(Buffer.concat([Buffer.from(type, "ascii"), data]));
    if (actualCrc !== expectedCrc) throw new Error(`PNG ${type} chunk failed CRC validation.`);

    if (type === "IHDR") {
      if (header || length !== 13) throw new Error("PNG must contain exactly one valid IHDR chunk.");
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8]!,
        colorType: data[9]!,
        compression: data[10]!,
        filter: data[11]!,
        interlace: data[12]!,
      };
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "tRNS") {
      transparency = Buffer.from(data);
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    } else if (type === "IEND") {
      sawIend = true;
      break;
    }

    offset = chunkEnd;
  }

  if (!header || idatChunks.length === 0 || !sawIend) {
    throw new Error("PNG is missing IHDR, IDAT, or IEND data.");
  }
  validateHeader(header);

  const bytesPerPixel = bytesPerPixelForColorType(header.colorType);
  const rowBytes = header.width * bytesPerPixel;
  const expectedInflatedBytes = (rowBytes + 1) * header.height;
  const inflated = inflateSync(Buffer.concat(idatChunks), {
    maxOutputLength: expectedInflatedBytes,
  });
  if (inflated.length !== expectedInflatedBytes) {
    throw new Error(`PNG decompressed to ${inflated.length} bytes; expected ${expectedInflatedBytes}.`);
  }

  const raw = unfilterRows(inflated, header.width, header.height, bytesPerPixel);
  const rgba = convertToRgba(raw, header, palette, transparency);
  return { width: header.width, height: header.height, data: rgba };
}

export function encodePng(image: DecodedPng): Buffer {
  validateDimensions(image.width, image.height);
  const expectedBytes = image.width * image.height * 4;
  if (image.data.length !== expectedBytes) {
    throw new Error(`RGBA buffer contains ${image.data.length} bytes; expected ${expectedBytes}.`);
  }

  const rowBytes = image.width * 4;
  const filtered = Buffer.alloc((rowBytes + 1) * image.height);
  for (let y = 0; y < image.height; y++) {
    const outputOffset = y * (rowBytes + 1);
    filtered[outputOffset] = 0;
    image.data.copy(filtered, outputOffset + 1, y * rowBytes, (y + 1) * rowBytes);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    createChunk("IHDR", ihdr),
    createChunk("IDAT", deflateSync(filtered, { level: 9 })),
    createChunk("IEND", Buffer.alloc(0)),
  ]);
}

function validateHeader(header: PngHeader): void {
  validateDimensions(header.width, header.height);
  if (header.bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${header.bitDepth}; only 8-bit PNGs are supported.`);
  if (![0, 2, 3, 4, 6].includes(header.colorType)) {
    throw new Error(`Unsupported PNG color type ${header.colorType}.`);
  }
  if (header.compression !== 0 || header.filter !== 0) throw new Error("Unsupported PNG compression or filter method.");
  if (header.interlace !== 0) throw new Error("Interlaced PNGs are not supported for pixel operations.");
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`Invalid PNG dimensions: ${width}x${height}.`);
  }
  if (width * height > MAX_PNG_PIXELS) {
    throw new Error(`PNG dimensions exceed the ${MAX_PNG_PIXELS.toLocaleString("en-US")}-pixel safety limit.`);
  }
}

function bytesPerPixelForColorType(colorType: number): number {
  switch (colorType) {
    case 0: return 1;
    case 2: return 3;
    case 3: return 1;
    case 4: return 2;
    case 6: return 4;
    default: throw new Error(`Unsupported PNG color type ${colorType}.`);
  }
}

function unfilterRows(inflated: Buffer, width: number, height: number, bytesPerPixel: number): Buffer {
  const rowBytes = width * bytesPerPixel;
  const output = Buffer.alloc(rowBytes * height);

  for (let y = 0; y < height; y++) {
    const inputOffset = y * (rowBytes + 1);
    const filterType = inflated[inputOffset]!;
    const row = inflated.subarray(inputOffset + 1, inputOffset + 1 + rowBytes);
    const outputOffset = y * rowBytes;

    for (let x = 0; x < rowBytes; x++) {
      const encoded = row[x]!;
      const left = x >= bytesPerPixel ? output[outputOffset + x - bytesPerPixel]! : 0;
      const up = y > 0 ? output[outputOffset + x - rowBytes]! : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel
        ? output[outputOffset + x - rowBytes - bytesPerPixel]!
        : 0;

      switch (filterType) {
        case 0:
          output[outputOffset + x] = encoded;
          break;
        case 1:
          output[outputOffset + x] = (encoded + left) & 0xff;
          break;
        case 2:
          output[outputOffset + x] = (encoded + up) & 0xff;
          break;
        case 3:
          output[outputOffset + x] = (encoded + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4:
          output[outputOffset + x] = (encoded + paeth(left, up, upperLeft)) & 0xff;
          break;
        default:
          throw new Error(`Unsupported PNG row filter ${filterType}.`);
      }
    }
  }

  return output;
}

function convertToRgba(
  raw: Buffer,
  header: PngHeader,
  palette: Buffer | undefined,
  transparency: Buffer | undefined,
): Buffer {
  const pixels = header.width * header.height;
  const rgba = Buffer.alloc(pixels * 4);
  const sourceStride = bytesPerPixelForColorType(header.colorType);

  if (header.colorType === 3 && (!palette || palette.length === 0 || palette.length % 3 !== 0)) {
    throw new Error("Indexed PNG is missing a valid PLTE chunk.");
  }

  for (let pixel = 0; pixel < pixels; pixel++) {
    const source = pixel * sourceStride;
    const target = pixel * 4;

    switch (header.colorType) {
      case 0: {
        const gray = raw[source]!;
        rgba[target] = gray;
        rgba[target + 1] = gray;
        rgba[target + 2] = gray;
        rgba[target + 3] = 255;
        break;
      }
      case 2:
        rgba[target] = raw[source]!;
        rgba[target + 1] = raw[source + 1]!;
        rgba[target + 2] = raw[source + 2]!;
        rgba[target + 3] = 255;
        break;
      case 3: {
        const paletteIndex = raw[source]!;
        const paletteOffset = paletteIndex * 3;
        if (!palette || paletteOffset + 2 >= palette.length) {
          throw new Error(`Indexed PNG references missing palette entry ${paletteIndex}.`);
        }
        rgba[target] = palette[paletteOffset]!;
        rgba[target + 1] = palette[paletteOffset + 1]!;
        rgba[target + 2] = palette[paletteOffset + 2]!;
        rgba[target + 3] = transparency?.[paletteIndex] ?? 255;
        break;
      }
      case 4: {
        const gray = raw[source]!;
        rgba[target] = gray;
        rgba[target + 1] = gray;
        rgba[target + 2] = gray;
        rgba[target + 3] = raw[source + 1]!;
        break;
      }
      case 6:
        raw.copy(rgba, target, source, source + 4);
        break;
    }
  }

  return rgba;
}

function paeth(left: number, up: number, upperLeft: number): number {
  const prediction = left + up - upperLeft;
  const distanceLeft = Math.abs(prediction - left);
  const distanceUp = Math.abs(prediction - up);
  const distanceUpperLeft = Math.abs(prediction - upperLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpperLeft) return left;
  if (distanceUp <= distanceUpperLeft) return up;
  return upperLeft;
}

function createChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
