import { closeSync, existsSync, openSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { isProcessRunning } from "../background-lifecycle.js";
import type { TunnelProcess } from "./tunnel-types.js";
import { findCommand, isGeneratedNgrokUrl, normalizeNgrokUrl } from "./tunnel-utils.js";

const MAX_STARTUP_OUTPUT_BYTES = 1024 * 1024;
const MAX_NGROK_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const NGROK_DOWNLOAD_ORIGIN = "https://bin.equinox.io";

export function ngrokWindowsDownloadUrl(architecture = process.arch): string {
  const artifact = architecture === "arm64"
    ? "ngrok-v3-stable-windows-arm64.zip"
    : architecture === "ia32"
      ? "ngrok-v3-stable-windows-386.zip"
      : "ngrok-v3-stable-windows-amd64.zip";
  return `${NGROK_DOWNLOAD_ORIGIN}/c/bNyj1mQVY4c/${artifact}`;
}

export interface NgrokStartOptions {
  detached?: boolean;
  logPath?: string;
  authtoken?: string;
  url?: string;
  timeoutMs?: number;
  executable?: string;
  executableArgsPrefix?: string[];
}

export function buildNgrokArgs(port: number, url?: string): string[] {
  const args = ["http", String(port), "--log=stdout", "--log-format=json"];
  const normalizedUrl = normalizeNgrokUrl(url);
  if (normalizedUrl) args.push("--url", normalizedUrl);
  return args;
}

export function extractNgrokPublicUrl(output: string, expectedUrl?: string): string | undefined {
  const expected = normalizeNgrokUrl(expectedUrl);
  const candidates = output.match(/https:\/\/[^\s"'\\]+/g) ?? [];
  for (const raw of candidates) {
    const cleaned = raw.replace(/[),.;]+$/, "");
    try {
      const normalized = normalizeNgrokUrl(cleaned);
      if (!normalized) continue;
      if (expected ? normalized === expected : isGeneratedNgrokUrl(normalized)) return normalized;
    } catch {
      // Startup logs can include unrelated URLs; only valid endpoint origins count.
    }
  }
  return undefined;
}

async function resolveNgrokExecutable(): Promise<string> {
  const found = findCommand("ngrok");
  if (found) return found;
  if (process.platform === "win32") {
    const storeExecutable = findWindowsStoreNgrok();
    if (storeExecutable) return storeExecutable;
    const managedExecutable = join(homedir(), ".auvrynt", "bin", "ngrok.exe");
    if (existsSync(managedExecutable) && verifyWindowsExecutable(managedExecutable)) {
      return managedExecutable;
    }
    return installWindowsNgrok();
  }
  throw new Error(
    "ngrok is required for AUVRYNT_TUNNEL_PROVIDER=ngrok. Install it from https://ngrok.com/download, ensure `ngrok` is on PATH, "
    + "and either run `ngrok config add-authtoken <token>` or set AUVRYNT_NGROK_AUTHTOKEN.",
  );
}

function findWindowsStoreNgrok(): string | undefined {
  try {
    const installLocation = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-AppxPackage -Name 'ngrok.ngrok' | Select-Object -First 1 -ExpandProperty InstallLocation",
      ],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    if (!installLocation) return undefined;
    const executable = join(installLocation, "ngrok.exe");
    return existsSync(executable) ? executable : undefined;
  } catch {
    return undefined;
  }
}

async function installWindowsNgrok(): Promise<string> {
  const targetDir = join(homedir(), ".auvrynt", "bin");
  const executable = join(targetDir, "ngrok.exe");
  const downloadUrl = ngrokWindowsDownloadUrl();
  const tempRoot = await mkdtemp(join(tmpdir(), "auvrynt-ngrok-"));
  const archive = join(tempRoot, "ngrok.zip");
  const extractedDir = join(tempRoot, "extracted");

  try {
    console.log("ngrok is not installed; downloading and verifying the official Windows build...");
    const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Could not download ngrok (HTTP ${response.status}).`);
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && (length <= 0 || length > MAX_NGROK_DOWNLOAD_BYTES)) {
      throw new Error("ngrok download size is invalid or exceeds the 64 MB safety limit.");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength < 4 || bytes.byteLength > MAX_NGROK_DOWNLOAD_BYTES || bytes.subarray(0, 2).toString("ascii") !== "PK") {
      throw new Error("ngrok download is not a valid ZIP archive.");
    }
    await writeFile(archive, bytes, { mode: 0o600 });
    await mkdir(extractedDir, { recursive: true });
    extractNgrokArchive(archive, extractedDir);
    const extractedExecutable = join(extractedDir, "ngrok.exe");
    if (!existsSync(extractedExecutable) || !verifyWindowsExecutable(extractedExecutable)) {
      throw new Error("ngrok signature verification failed; the download was not installed.");
    }
    runWindowsDefenderScan(extractedExecutable);

    await mkdir(targetDir, { recursive: true });
    await rm(executable, { force: true });
    await rename(extractedExecutable, executable);
    execFileSync(executable, ["version"], { stdio: "ignore", windowsHide: true });
    return executable;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function extractNgrokArchive(archive: string, destination: string): void {
  const entries = execFileSync("tar.exe", ["-tf", archive], { encoding: "utf8", windowsHide: true });
  const normalized = entries.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  if (!normalized.includes("ngrok.exe") || normalized.some((entry) => entry.includes("..") || entry.startsWith("/") || entry.startsWith("\\"))) {
    throw new Error("ngrok archive contains an unexpected file layout.");
  }
  execFileSync("tar.exe", ["-xf", archive, "-C", destination], { windowsHide: true });
}

function verifyWindowsExecutable(executable: string): boolean {
  try {
    const quotedPath = executable.replaceAll("'", "''");
    const status = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `(Get-AuthenticodeSignature -LiteralPath '${quotedPath}').Status`],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    return status === "Valid";
  } catch {
    return false;
  }
}

function runWindowsDefenderScan(executable: string): void {
  const quotedPath = executable.replaceAll("'", "''");
  try {
    const available = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "[bool](Get-Command Start-MpScan -ErrorAction SilentlyContinue)"],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    if (available.toLowerCase() === "true") {
      execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", `Start-MpScan -ScanType CustomScan -ScanPath '${quotedPath}' -ErrorAction Stop`],
        { windowsHide: true },
      );
    }
  } catch (error) {
    throw new Error(`Microsoft Defender scan failed; ngrok was not installed. ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function waitForNgrokUrl(
  child: ChildProcess,
  readOutput: () => Promise<string>,
  spawnError: () => Error | undefined,
  expectedUrl: string | undefined,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const error = spawnError();
    if (error) throw new Error(`ngrok tunnel failed to start: ${error.message}`);
    if (!child.pid || !isProcessRunning(child.pid)) throw new Error("ngrok tunnel exited before connecting.");
    const output = await readOutput();
    if (Buffer.byteLength(output, "utf8") > MAX_STARTUP_OUTPUT_BYTES) {
      throw new Error("ngrok startup output exceeded 1 MB before providing a public URL.");
    }
    const url = extractNgrokPublicUrl(output, expectedUrl);
    if (url) return url;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`ngrok tunnel did not provide a public URL within ${Math.round(timeoutMs / 1000)} seconds.`);
}

export async function startNgrokTunnel(port: number, options: NgrokStartOptions = {}): Promise<TunnelProcess> {
  const executable = options.executable ?? await resolveNgrokExecutable();
  const expectedUrl = normalizeNgrokUrl(options.url);
  const spawnEnv = { ...process.env, ...(options.authtoken ? { NGROK_AUTHTOKEN: options.authtoken } : {}) };
  const args = [...(options.executableArgsPrefix ?? []), ...buildNgrokArgs(port, expectedUrl)];
  const timeoutMs = options.timeoutMs ?? (options.detached ? 90_000 : 30_000);

  if (options.detached && options.logPath) {
    await writeFile(options.logPath, "", { mode: 0o600 });
    const logHandle = openSync(options.logPath, "a");
    const child = spawn(executable, args, {
      stdio: ["ignore", logHandle, logHandle],
      windowsHide: true,
      detached: true,
      env: spawnEnv,
    });
    closeSync(logHandle);
    let spawnError: Error | undefined;
    child.once("error", (error) => { spawnError = error; });
    try {
      const url = await waitForNgrokUrl(
        child,
        () => readFile(options.logPath!, "utf8").catch(() => ""),
        () => spawnError,
        expectedUrl,
        timeoutMs,
      );
      child.unref();
      return { process: child, url };
    } catch (error) {
      child.kill();
      throw error;
    }
  }

  const child = spawn(executable, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: options.detached,
    env: spawnEnv,
  });
  let spawnError: Error | undefined;
  let output = "";
  child.once("error", (error) => { spawnError = error; });
  const append = (chunk: Buffer | string) => {
    if (Buffer.byteLength(output, "utf8") <= MAX_STARTUP_OUTPUT_BYTES) output += chunk.toString();
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  try {
    const url = await waitForNgrokUrl(child, async () => output, () => spawnError, expectedUrl, timeoutMs);
    return { process: child, url };
  } catch (error) {
    child.kill();
    throw error;
  } finally {
    child.stdout?.off("data", append);
    child.stderr?.off("data", append);
  }
}
