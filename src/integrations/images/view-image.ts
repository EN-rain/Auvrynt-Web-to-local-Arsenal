import { extname } from "node:path";
import { readFile, stat } from "node:fs/promises";
import type { WorkspaceRegistry, Workspace } from "../../workspaces.js";
import type { ToolResponse } from "../../pi-tools.js";
import { inlineImageOrNotice } from "../../tool-result-budget.js";

const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;

const SUPPORTED_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export interface ViewImageInput {
  workspaceId: string;
  path: string;
}

export async function executeViewImage(
  registry: WorkspaceRegistry,
  input: ViewImageInput,
): Promise<ToolResponse> {
  let workspace: Workspace;
  try {
    workspace = registry.getWorkspace(input.workspaceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }

  const ext = extname(input.path).toLowerCase();
  const mimeType = SUPPORTED_MIME_TYPES[ext];
  if (!mimeType) {
    return {
      content: [
        {
          type: "text",
          text: `Unsupported image extension "${ext}". Supported extensions: .png, .jpg, .jpeg, .webp, .gif`,
        },
      ],
      isError: true,
    };
  }

  let absolutePath: string;
  try {
    absolutePath = registry.resolvePath(workspace, input.path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }

  let stats;
  try {
    stats = await stat(absolutePath);
  } catch {
    return {
      content: [{ type: "text", text: `File not found: ${input.path}` }],
      isError: true,
    };
  }

  if (stats.isDirectory()) {
    return {
      content: [
        { type: "text", text: `Path is a directory, not a file: ${input.path}` },
      ],
      isError: true,
    };
  }

  if (!stats.isFile()) {
    return {
      content: [
        { type: "text", text: `Path is not a regular file: ${input.path}` },
      ],
      isError: true,
    };
  }

  if (stats.size > MAX_IMAGE_SIZE_BYTES) {
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
    return {
      content: [
        {
          type: "text",
          text: `Image file size (${sizeMb} MB) exceeds maximum allowed limit of 20 MB.`,
        },
      ],
      isError: true,
    };
  }

  try {
    const buffer = await readFile(absolutePath);
    return {
      content: inlineImageOrNotice(buffer, `Image ${input.path}`, mimeType),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Failed to read image file: ${message}` }],
      isError: true,
    };
  }
}
