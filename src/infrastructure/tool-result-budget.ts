const KIB = 1024;
const MIB = 1024 * KIB;

export const MAX_TOOL_RESULT_CONTENT_BYTES = 1 * MIB;
export const MAX_TOOL_RESULT_META_BYTES = 512 * KIB;
export const MAX_TOOL_RESULT_STRUCTURED_BYTES = 512 * KIB;
export const MAX_INLINE_BINARY_BYTES = 512 * KIB;
export const MAX_JSON_STRING_BYTES = 256 * KIB;

const TRUNCATION_NOTICE =
  "[Auvrynt truncated this tool result to keep the MCP connection stable. Request a narrower range, fewer items, or a smaller image.]";

export type InlineImageContentBlock =
  | { type: "image"; data: string; mimeType: string }
  | { type: "text"; text: string };

export function inlineImageOrNotice(
  buffer: Buffer,
  label: string,
  mimeType: string,
): InlineImageContentBlock[] {
  if (buffer.length <= MAX_INLINE_BINARY_BYTES) {
    return [{ type: "image", data: buffer.toString("base64"), mimeType }];
  }
  return [{
    type: "text",
    text: `${label} was saved or inspected, but its ${buffer.length}-byte image was not embedded because it exceeded the stable MCP inline-image limit.`,
  }];
}

interface Budget {
  remaining: number;
  truncated: boolean;
}

export function limitToolResultPayload<T>(value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const result = value as Record<string, unknown>;
  const contentBudget: Budget = { remaining: MAX_TOOL_RESULT_CONTENT_BYTES, truncated: false };
  const metaBudget: Budget = { remaining: MAX_TOOL_RESULT_META_BYTES, truncated: false };
  const structuredBudget: Budget = { remaining: MAX_TOOL_RESULT_STRUCTURED_BYTES, truncated: false };

  const content = limitPrimaryContent(result.content, contentBudget);
  const meta = compactJsonValue(result._meta, metaBudget, "_meta", 0, false);
  const structuredContent = compactJsonValue(
    result.structuredContent,
    structuredBudget,
    "structuredContent",
    0,
    true,
  );

  const truncated = contentBudget.truncated || metaBudget.truncated || structuredBudget.truncated;
  if (!truncated) return value;

  const next: Record<string, unknown> = {
    ...result,
    content,
    _meta: meta,
    structuredContent,
  };

  const contentItems = Array.isArray(next.content) ? [...next.content] : [];
  if (!contentItems.some((item) => isTextNotice(item))) {
    contentItems.push({ type: "text", text: TRUNCATION_NOTICE });
  }
  next.content = contentItems;

  return next as T;
}

function limitPrimaryContent(value: unknown, budget: Budget): unknown {
  if (!Array.isArray(value)) return value;

  const limited: unknown[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      limited.push(compactJsonValue(item, budget, "content", 0, false));
      continue;
    }

    const block = item as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") {
      limited.push({ ...block, text: consumeString(block.text, budget, MAX_JSON_STRING_BYTES) });
      continue;
    }

    if ((block.type === "image" || block.type === "audio") && typeof block.data === "string") {
      const estimatedBinaryBytes = base64DecodedBytes(block.data);
      const serializedBytes = Buffer.byteLength(block.data, "utf8");
      if (estimatedBinaryBytes > MAX_INLINE_BINARY_BYTES || serializedBytes > budget.remaining) {
        budget.truncated = true;
        limited.push({
          type: "text",
          text: `[Inline ${String(block.type)} omitted: ${estimatedBinaryBytes} bytes exceeded the stable MCP payload limit.]`,
        });
        continue;
      }
      budget.remaining -= serializedBytes;
      limited.push({ ...block });
      continue;
    }

    limited.push(compactJsonValue(block, budget, "content", 0, false));
  }
  return limited;
}

function compactJsonValue(
  value: unknown,
  budget: Budget,
  key: string,
  depth: number,
  preserveShape: boolean,
): unknown {
  if (value === undefined || value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    if ((key === "data" || key === "blob") && base64DecodedBytes(value) > MAX_INLINE_BINARY_BYTES) {
      budget.truncated = true;
      return `[omitted binary payload: ${base64DecodedBytes(value)} bytes]`;
    }
    return consumeString(value, budget, MAX_JSON_STRING_BYTES);
  }

  if (depth >= 12) {
    budget.truncated = true;
    return preserveShape
      ? schemaSafePlaceholder(value, depth)
      : "[truncated: maximum nesting depth reached]";
  }

  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      if (budget.remaining <= 0) {
        budget.truncated = true;
        if (!preserveShape) result.push(`[truncated ${value.length - index} remaining items]`);
        break;
      }
      result.push(compactJsonValue(value[index], budget, String(index), depth + 1, preserveShape));
    }
    return result;
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      if (budget.remaining <= 0) {
        budget.truncated = true;
        if (preserveShape) {
          result[childKey] = schemaSafePlaceholder(childValue, depth + 1);
          continue;
        }
        result.__auvryntTruncated = true;
        break;
      }
      budget.remaining -= Buffer.byteLength(childKey, "utf8") + 4;
      result[childKey] = compactJsonValue(
        childValue,
        budget,
        childKey,
        depth + 1,
        preserveShape,
      );
    }
    return result;
  }

  return String(value);
}

function schemaSafePlaceholder(value: unknown, depth: number): unknown {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") return "[truncated]";
  if (Array.isArray(value)) return [];
  if (typeof value === "object") {
    if (depth >= 16) return {};
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, schemaSafePlaceholder(child, depth + 1)]),
    );
  }
  return String(value);
}

function consumeString(value: string, budget: Budget, fieldLimit: number): string {
  const available = Math.max(0, Math.min(fieldLimit, budget.remaining));
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength <= available) {
    budget.remaining -= byteLength;
    return value;
  }

  budget.truncated = true;
  if (available <= 0) return "[truncated]";
  const suffix = "\n… [truncated]";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  const prefixBudget = Math.max(0, available - suffixBytes);
  const prefix = truncateUtf8(value, prefixBudget);
  budget.remaining = Math.max(0, budget.remaining - Buffer.byteLength(prefix, "utf8") - suffixBytes);
  return `${prefix}${suffix}`;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  let output = Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8");
  while (output.endsWith("�")) output = output.slice(0, -1);
  return output;
}

function base64DecodedBytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function isTextNotice(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const block = value as { type?: unknown; text?: unknown };
  return block.type === "text" && block.text === TRUNCATION_NOTICE;
}
