import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import type { ProcessManager } from "../../processes.js";
import { getRequestContext } from "../../request-context.js";
import { startDevServer, capturePageScreenshot, inspectPage, testResponsivePage } from "../../web-tools.js";
import { compareImages, inspectImage, inspectSprite, splitSpriteSheet } from "../../image-tools.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import {
  MUTATING_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WEB_READ_ANNOTATIONS,
  WEB_WRITE_ANNOTATIONS,
  WORKSPACE_ID_SCHEMA,
  PROCESS_ANNOTATIONS,
  toolWidgetDescriptorMeta,
} from "../tool-registration-shared.js";

export function registerWebImageTools(
  server: McpServer,
  config: ServerConfig,
  workspaces: WorkspaceRegistry,
  processManager: ProcessManager,
): void {
  registerAppTool(server, "start_dev_server", {
    title: "Start dev server",
    description: "Launch a local web development server as a persistent process. Auto-detects the dev script from the project. Returns a processId for use with get_process_logs and stop_process.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      command: z.string().optional().describe("Override command to run (e.g. 'npm run dev'). Auto-detected if omitted."),
      workingDirectory: z.string().optional().describe("Working directory relative to workspace root."),
      port: z.number().int().optional().describe("Expected port for the dev server."),
    },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, command, workingDirectory, port }) => {
    try {
      const result = await startDevServer(
        workspaces,
        processManager,
        { workspaceId, command, workingDirectory, port },
        getRequestContext()?.ownerClientId,
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text" as const, text: `start_dev_server failed: ${message}` }], isError: true };
    }
  });

  registerAppTool(server, "capture_page_screenshot", {
    title: "Capture page screenshot",
    description: "Screenshot a local or remote web page using Playwright. Saves to workspace and returns as MCP image content. Blocks unsafe schemes and SSRF addresses.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      url: z.string().describe("Page URL (http/https only). Local dev URLs like localhost:3000 are allowed."),
      outputPath: z.string().describe("Workspace-relative path to save the screenshot PNG."),
      fullPage: z.boolean().optional().describe("Capture full scrollable page (default false)."),
      viewportWidth: z.number().int().optional().describe("Viewport width in pixels (default 1280, max 3840)."),
      viewportHeight: z.number().int().optional().describe("Viewport height in pixels (default 800, max 2160)."),
      waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional().describe("Page load event to wait for."),
      delayMs: z.number().int().optional().describe("Additional delay in ms after load (max 5000)."),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: WEB_WRITE_ANNOTATIONS,
  }, ({ workspaceId, url, outputPath, fullPage, viewportWidth, viewportHeight, waitUntil, delayMs }) =>
    capturePageScreenshot(workspaces, { workspaceId, url, outputPath, fullPage, viewportWidth, viewportHeight, waitUntil, delayMs }));

  registerAppTool(server, "inspect_page", {
    title: "Inspect page",
    description: "Inspect DOM structure, headings, buttons, links, and console errors of a web page using Playwright.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      url: z.string().describe("Page URL to inspect."),
      includeAccessibilityTree: z.boolean().optional().describe("Include accessibility tree."),
      includeComputedStyles: z.boolean().optional().describe("Include key computed styles."),
      maxElements: z.number().int().optional().describe("Max elements per category (default 20)."),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: WEB_READ_ANNOTATIONS,
  }, ({ workspaceId, url, includeAccessibilityTree, includeComputedStyles, maxElements }) =>
    inspectPage(workspaces, { workspaceId, url, includeAccessibilityTree, includeComputedStyles, maxElements }));

  registerAppTool(server, "test_responsive_page", {
    title: "Test responsive page",
    description: "Capture the same web page across 1–6 bounded viewports using Playwright. Saves PNGs inside the workspace and returns each screenshot for visual comparison.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      url: z.string().describe("Page URL to test."),
      outputDirectory: z.string().describe("Workspace-relative directory for viewport screenshots."),
      viewports: z.array(z.object({ name: z.string(), width: z.number().int(), height: z.number().int() })).max(6).optional().describe("Optional viewport set. Defaults to mobile, tablet, and desktop."),
      fullPage: z.boolean().optional().describe("Capture the full scrollable page (default true)."),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: WEB_WRITE_ANNOTATIONS,
  }, ({ workspaceId, url, outputDirectory, viewports, fullPage }) =>
    testResponsivePage(workspaces, { workspaceId, url, outputDirectory, viewports, fullPage }));

  registerAppTool(server, "inspect_image", {
    title: "Inspect image",
    description: "Return format, dimensions, file size, alpha capability, and pixel-art likelihood for a local image. Does not resize or recompress.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, path: z.string().describe("Workspace-relative image path.") },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, path }) => inspectImage(workspaces, { workspaceId, path }));

  registerAppTool(server, "compare_images", {
    title: "Compare images",
    description: "Pixel-level comparison of two workspace PNG images. Returns exact and tolerance-based match percentages, changed pixel count, and an optional real diff PNG.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      referencePath: z.string().describe("Reference image path (workspace-relative)."),
      candidatePath: z.string().describe("Candidate image path to compare (workspace-relative)."),
      diffOutputPath: z.string().optional().describe("Workspace-relative path to save the diff image."),
      threshold: z.number().optional().describe("Per-channel tolerance (0–255, default 0)."),
      ignoreTransparentPixels: z.boolean().optional().describe("Skip fully transparent pixels in comparison."),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, referencePath, candidatePath, diffOutputPath, threshold, ignoreTransparentPixels }) =>
    compareImages(workspaces, { workspaceId, referencePath, candidatePath, diffOutputPath, threshold, ignoreTransparentPixels }));

  registerAppTool(server, "inspect_sprite", {
    title: "Inspect sprite",
    description: "Analyze image dimensions against an expected sprite-cell size and report the resulting grid and divisibility.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      path: z.string().describe("Workspace-relative image path."),
      expectedCellWidth: z.number().int().optional().describe("Expected cell width for grid detection."),
      expectedCellHeight: z.number().int().optional().describe("Expected cell height for grid detection."),
    },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, ({ workspaceId, path, expectedCellWidth, expectedCellHeight }) =>
    inspectSprite(workspaces, { workspaceId, path, expectedCellWidth, expectedCellHeight }));

  registerAppTool(server, "split_sprite_sheet", {
    title: "Split sprite sheet",
    description: "Split a PNG sprite sheet into real cropped frame PNGs inside the managed artifact directory. Rejects unsafe filenames and does not overwrite existing files.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      path: z.string().describe("Workspace-relative sprite sheet path."),
      columns: z.number().int().describe("Number of columns."),
      rows: z.number().int().describe("Number of rows."),
      outputDirectory: z.string().describe("Workspace-relative output directory."),
      namingPattern: z.string().optional().describe("Frame filename pattern with {col} and {row} placeholders."),
    },
    ...toolWidgetDescriptorMeta(config, "write"), annotations: MUTATING_ANNOTATIONS,
  }, ({ workspaceId, path, columns, rows, outputDirectory, namingPattern }) =>
    splitSpriteSheet(workspaces, { workspaceId, path, columns, rows, outputDirectory, namingPattern }));
}
