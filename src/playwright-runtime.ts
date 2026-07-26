import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const localRequire = createRequire(import.meta.url);
const PLAYWRIGHT_VERSION = "1.62.0";
const MANAGED_ROOT = join(homedir(), ".auvrynt", "browser-support");
const managedRequire = createRequire(join(MANAGED_ROOT, "package.json"));

export interface PlaywrightRuntimeStatus {
  packageInstalled: boolean;
  chromiumInstalled: boolean;
  modulePath?: string;
  chromiumExecutablePath?: string;
  source?: "package" | "managed";
}

function resolvePlaywrightModule(): { path: string; source: "package" | "managed" } | undefined {
  try {
    return { path: localRequire.resolve("playwright"), source: "package" };
  } catch {}

  try {
    return { path: managedRequire.resolve("playwright"), source: "managed" };
  } catch {}

  return undefined;
}

export function getPlaywrightRuntimeStatus(): PlaywrightRuntimeStatus {
  const resolved = resolvePlaywrightModule();
  if (!resolved) {
    return { packageInstalled: false, chromiumInstalled: false };
  }

  try {
    const playwright = resolved.source === "package"
      ? localRequire("playwright")
      : managedRequire("playwright");
    const chromiumExecutablePath = playwright?.chromium?.executablePath?.();
    return {
      packageInstalled: true,
      chromiumInstalled: Boolean(chromiumExecutablePath && existsSync(chromiumExecutablePath)),
      modulePath: resolved.path,
      chromiumExecutablePath,
      source: resolved.source,
    };
  } catch {
    return {
      packageInstalled: true,
      chromiumInstalled: false,
      modulePath: resolved.path,
      source: resolved.source,
    };
  }
}

export async function loadPlaywright(): Promise<any> {
  const resolved = resolvePlaywrightModule();
  if (!resolved) {
    throw new Error("Playwright is not installed.");
  }
  return import(pathToFileURL(resolved.path).href);
}

export function ensurePlaywrightRuntime(): PlaywrightRuntimeStatus {
  let status = getPlaywrightRuntimeStatus();
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";

  if (!status.packageInstalled) {
    mkdirSync(MANAGED_ROOT, { recursive: true });
    execFileSync(
      npm,
      ["install", "--prefix", MANAGED_ROOT, "--no-save", "--package-lock=false", "--ignore-scripts", `playwright@${PLAYWRIGHT_VERSION}`],
      { stdio: "inherit" },
    );
    status = getPlaywrightRuntimeStatus();
  }

  if (!status.packageInstalled || !status.modulePath) {
    throw new Error("Playwright package installation completed, but the package could not be resolved.");
  }

  if (!status.chromiumInstalled) {
    const cliPath = join(dirname(status.modulePath), "cli.js");
    if (!existsSync(cliPath)) {
      throw new Error(`Playwright CLI was not found at ${cliPath}.`);
    }
    execFileSync(process.execPath, [cliPath, "install", "chromium"], { stdio: "inherit" });
    status = getPlaywrightRuntimeStatus();
  }

  if (!status.chromiumInstalled) {
    throw new Error("Playwright Chromium installation completed, but Chromium is still unavailable.");
  }

  return status;
}
