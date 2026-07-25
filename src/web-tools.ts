import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { WorkspaceRegistry } from "./workspaces.js";
import type { ProcessManager } from "./processes.js";
import { inspectProject } from "./search-discovery.js";
import type { ToolResponse } from "./pi-tools.js";

export interface StartDevServerInput {
  workspaceId: string;
  command?: string;
  workingDirectory?: string;
  port?: number;
}

export interface CapturePageScreenshotInput {
  workspaceId: string;
  url: string;
  outputPath: string;
  fullPage?: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  delayMs?: number;
}

export interface InspectPageInput {
  workspaceId: string;
  url: string;
  includeAccessibilityTree?: boolean;
  includeComputedStyles?: boolean;
  maxElements?: number;
}

export interface TestResponsivePageInput {
  workspaceId: string;
  url: string;
  outputDirectory: string;
  viewports?: Array<{
    name: string;
    width: number;
    height: number;
  }>;
}

export function validateWebUrl(urlStr: string): string {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid URL format: ${urlStr}`);
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`Blocked unsafe scheme "${protocol}". Only http: and https: are allowed.`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Allowed local dev hosts
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "0.0.0.0") {
    return parsed.href;
  }

  // SSRF defense: block cloud metadata & internal IP ranges
  if (
    hostname === "169.254.169.254" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
  ) {
    throw new Error(`Blocked SSRF request to internal address: ${hostname}`);
  }

  return parsed.href;
}

export async function startDevServer(
  registry: WorkspaceRegistry,
  processManager: ProcessManager,
  input: StartDevServerInput,
): Promise<{
  processId: string;
  command: string;
  status: string;
  detectedUrls: string[];
  recentOutput: string[];
}> {
  let command = input.command;

  if (!command) {
    const summary = await inspectProject(registry, {
      workspaceId: input.workspaceId,
      path: input.workingDirectory,
    });
    command = summary.recommendedCommands.run;
    if (!command) {
      throw new Error("No development run command detected in project. Please specify command parameter.");
    }
  }

  const result = processManager.startProcess({
    workspaceId: input.workspaceId,
    command,
    workingDirectory: input.workingDirectory,
  });

  return {
    processId: result.processId,
    command,
    status: result.status,
    detectedUrls: result.detectedUrls,
    recentOutput: result.recentOutput,
  };
}

export async function capturePageScreenshot(
  registry: WorkspaceRegistry,
  input: CapturePageScreenshotInput,
): Promise<ToolResponse> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const validatedUrl = validateWebUrl(input.url);
  const absoluteOutputPath = registry.resolvePath(workspace, input.outputPath);

  let playwright: any;
  try {
    // Dynamic import to avoid static resolution error when optional playwright package is missing
    const moduleName = "playwright";
    playwright = await import(moduleName);
  } catch {
    return {
      content: [
        {
          type: "text",
          text: "Playwright dependency is not installed. Run 'npm install playwright' and 'npx playwright install' to enable browser screenshots.",
        },
      ],
      isError: true,
    };
  }

  let browser: any;
  try {
    const width = Math.min(Math.max(input.viewportWidth ?? 1280, 320), 3840);
    const height = Math.min(Math.max(input.viewportHeight ?? 800, 240), 2160);

    browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();

    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on("console", (msg: any) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("requestfailed", (req: any) => {
      failedRequests.push(`${req.url()} (${req.failure()?.errorText ?? "failed"})`);
    });

    await page.goto(validatedUrl, {
      waitUntil: input.waitUntil ?? "domcontentloaded",
      timeout: 15000,
    });

    if (input.delayMs && input.delayMs > 0) {
      const delay = Math.min(input.delayMs, 5000);
      await page.waitForTimeout(delay);
    }

    await mkdir(dirname(absoluteOutputPath), { recursive: true });
    const buffer = await page.screenshot({
      fullPage: input.fullPage ?? false,
      type: "png",
    });

    await writeFile(absoluteOutputPath, buffer);
    await browser.close();

    const relPath = relative(workspace.root, absoluteOutputPath).replace(/\\/g, "/");

    return {
      content: [
        {
          type: "image",
          data: buffer.toString("base64"),
          mimeType: "image/png",
        },
        {
          type: "text",
          text: `Saved screenshot to ${relPath}${consoleErrors.length > 0 ? `\nConsole Errors: ${consoleErrors.join("; ")}` : ""}${failedRequests.length > 0 ? `\nFailed Requests: ${failedRequests.join("; ")}` : ""}`,
        },
      ],
    };
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Browser screenshot failed: ${msg}` }],
      isError: true,
    };
  }
}

export async function inspectPage(
  registry: WorkspaceRegistry,
  input: InspectPageInput,
): Promise<ToolResponse> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const validatedUrl = validateWebUrl(input.url);

  let playwright: any;
  try {
    const moduleName = "playwright";
    playwright = await import(moduleName);
  } catch {
    return {
      content: [
        {
          type: "text",
          text: "Playwright dependency is not installed. Run 'npm install playwright' to enable page inspection.",
        },
      ],
      isError: true,
    };
  }

  let browser: any;
  try {
    browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on("console", (msg: any) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("requestfailed", (req: any) => {
      failedRequests.push(`${req.url()} (${req.failure()?.errorText ?? "failed"})`);
    });

    await page.goto(validatedUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    const title = await page.title();

    const elementsSummary = await page.evaluate((maxElem: number) => {
      const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
        .slice(0, maxElem)
        .map((el) => `${el.tagName}: ${el.textContent?.trim()}`);

      const buttons = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit']"))
        .slice(0, maxElem)
        .map((el) => el.textContent?.trim() || (el as HTMLInputElement).value || "button");

      const links = Array.from(document.querySelectorAll("a[href]"))
        .slice(0, maxElem)
        .map((el) => `${el.textContent?.trim() || "link"} -> ${(el as HTMLAnchorElement).href}`);

      return { headings, buttons, links };
    }, input.maxElements ?? 20);

    await browser.close();

    const summaryText = JSON.stringify(
      {
        url: validatedUrl,
        title,
        elements: elementsSummary,
        consoleErrors,
        failedRequests,
      },
      null,
      2,
    );

    return {
      content: [{ type: "text", text: summaryText }],
    };
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Inspect page failed: ${msg}` }],
      isError: true,
    };
  }
}
