import { execFileSync } from "node:child_process";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  atomicWriteJson,
  getProcessIdentity,
  isProcessRunning,
  processIdentityMatches,
  readJsonFile,
  type ManagedTunnelRecord,
  type TunnelProvider,
} from "../background-lifecycle.js";
import { startCloudflareTunnel } from "./cloudflare-tunnel.js";
import { startNgrokTunnel } from "./ngrok-tunnel.js";
import type { ManagedTunnelOptions, ManagedTunnelResult, TunnelProcess, TunnelStartOptions } from "./tunnel-types.js";
import {
  tunnelExecutableNamePattern,
  tunnelProviderLabel,
  tunnelUrlMatchesProvider,
} from "./tunnel-utils.js";

export { tunnelExecutableNamePattern, tunnelProviderLabel, tunnelUrlMatchesProvider } from "./tunnel-utils.js";
export type { ManagedTunnelOptions, ManagedTunnelResult, TunnelProcess, TunnelStartOptions } from "./tunnel-types.js";

export function managedTunnelPath(stateDir: string): string {
  return join(stateDir, "tunnel.json");
}

export async function startTunnel(
  provider: TunnelProvider,
  port: number,
  options: TunnelStartOptions = {},
): Promise<TunnelProcess> {
  if (provider === "custom") throw new Error("Custom external URLs are managed outside Auvrynt.");
  if (provider === "ngrok") {
    return startNgrokTunnel(port, {
      detached: options.detached,
      logPath: options.logPath,
      authtoken: options.ngrokAuthtoken,
      url: options.ngrokUrl,
    });
  }
  return startCloudflareTunnel(port, { detached: options.detached, logPath: options.logPath });
}

export async function readManagedTunnel(options: ManagedTunnelOptions): Promise<ManagedTunnelRecord | undefined> {
  if (options.provider === "custom") return undefined;
  const tunnelPath = managedTunnelPath(options.stateDir);
  const record = await readJsonFile<ManagedTunnelRecord>(tunnelPath);
  if (!record || !Number.isInteger(record.pid) || record.pid < 1) return undefined;

  const recordProvider: TunnelProvider = record.provider ?? "cloudflare";
  const matchesConfiguration = record.port === options.port
    && recordProvider === options.provider
    && tunnelUrlMatchesProvider(record.url, options.provider, options.ngrokUrl);
  if (!matchesConfiguration) return undefined;
  if (processIdentityMatches(record.pid, record)) return record;

  if (!record.processPath || !record.processStartedAt) {
    const identity = getProcessIdentity(record.pid);
    if (identity && tunnelExecutableNamePattern(options.provider).test(identity.processPath)) {
      const migrated = { ...record, ...identity, provider: options.provider };
      await atomicWriteJson(tunnelPath, migrated);
      return migrated;
    }
  }

  await unlink(tunnelPath).catch(() => undefined);
  return undefined;
}

export async function ensureManagedTunnel(options: ManagedTunnelOptions): Promise<ManagedTunnelResult> {
  if (options.provider === "custom") throw new Error("Custom external URLs do not create a managed tunnel.");
  const existing = await readManagedTunnel(options);
  if (existing) {
    cleanupOrphanedTunnelProcesses(options, existing.pid);
    return { record: existing, created: false };
  }

  await stopManagedTunnel(options);
  const logFileName = options.provider === "ngrok" ? "ngrok.log" : "cloudflared.log";
  const tunnel = await startTunnel(options.provider, options.port, {
    detached: true,
    logPath: join(options.stateDir, logFileName),
    ngrokAuthtoken: options.ngrokAuthtoken,
    ngrokUrl: options.ngrokUrl,
  });
  if (!tunnel.process.pid) throw new Error(`${tunnelProviderLabel(options.provider)} tunnel started without a process ID.`);
  const identity = getProcessIdentity(tunnel.process.pid);
  if (!identity) {
    tunnel.process.kill();
    throw new Error(`Could not verify the ${tunnelProviderLabel(options.provider)} tunnel process.`);
  }
  const record: ManagedTunnelRecord = {
    pid: tunnel.process.pid,
    url: tunnel.url,
    port: options.port,
    provider: options.provider,
    ...identity,
  };
  await atomicWriteJson(managedTunnelPath(options.stateDir), record);
  return { record, created: true };
}

export async function stopManagedTunnel(options: ManagedTunnelOptions): Promise<boolean> {
  const tunnelPath = managedTunnelPath(options.stateDir);
  const tunnel = await readJsonFile<ManagedTunnelRecord>(tunnelPath);
  let stopped = false;

  if (tunnel && Number.isInteger(tunnel.pid) && tunnel.pid > 0) {
    const provider: TunnelProvider = tunnel.provider ?? "cloudflare";
    if (processIdentityMatches(tunnel.pid, tunnel)) {
      stopTunnelProcess(tunnel.pid, provider);
      stopped = true;
    }
  }

  await unlink(tunnelPath).catch(() => undefined);
  return cleanupOrphanedTunnelProcesses(options) > 0 || stopped;
}

interface TunnelProcessCandidate {
  pid: number;
  commandLine: string;
}

export function tunnelCommandMatches(
  provider: TunnelProvider,
  port: number,
  commandLine: string,
): boolean {
  const escapedPort = String(port).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (provider === "custom") return false;
  if (provider === "ngrok") {
    return new RegExp(`ngrok(?:\\.exe)?["']?\\s+http\\s+${escapedPort}(?:\\s|$)`, "i").test(commandLine);
  }
  return /cloudflared(?:\.exe)?["']?\s+tunnel(?:\s|$)/i.test(commandLine)
    && new RegExp(`--url(?:=|\\s+)https?://(?:127\\.0\\.0\\.1|localhost):${escapedPort}(?:\\s|$)`, "i").test(commandLine);
}

function cleanupOrphanedTunnelProcesses(
  options: ManagedTunnelOptions,
  keepPid?: number,
): number {
  let stopped = 0;
  for (const candidate of listTunnelProcessCandidates(options.provider)) {
    if (candidate.pid === keepPid || !tunnelCommandMatches(options.provider, options.port, candidate.commandLine)) {
      continue;
    }
    const identity = getProcessIdentity(candidate.pid);
    if (!identity || !tunnelExecutableNamePattern(options.provider).test(identity.processPath)) continue;
    stopTunnelProcess(candidate.pid, options.provider);
    stopped++;
  }
  return stopped;
}

function listTunnelProcessCandidates(provider: TunnelProvider): TunnelProcessCandidate[] {
  if (provider === "custom") return [];
  try {
    if (process.platform === "win32") {
      const executable = provider === "ngrok" ? "ngrok.exe" : "cloudflared.exe";
      const script = [
        `$items = @(Get-CimInstance Win32_Process -Filter \"Name = '${executable}'\" -ErrorAction Stop`,
        "| ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; commandLine = [string]$_.CommandLine } })",
        "$items | ConvertTo-Json -Compress",
      ].join(" ; ").replace(/ ; \|/g, " |");
      const raw = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      }).trim();
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      const values = Array.isArray(parsed) ? parsed : [parsed];
      return values.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const item = value as Record<string, unknown>;
        return Number.isInteger(item.pid) && typeof item.commandLine === "string"
          ? [{ pid: item.pid as number, commandLine: item.commandLine }]
          : [];
      });
    }

    const raw = execFileSync("ps", ["-eo", "pid=,args="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return raw.split(/\r?\n/).flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      return match ? [{ pid: Number(match[1]), commandLine: match[2] }] : [];
    });
  } catch {
    return [];
  }
}

function stopTunnelProcess(pid: number, provider: TunnelProvider): void {
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill.exe", ["/PID", String(pid), "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    if (isProcessRunning(pid)) {
      throw new Error(`Could not stop ${tunnelProviderLabel(provider)} tunnel process ${pid}.`);
    }
  }
}
