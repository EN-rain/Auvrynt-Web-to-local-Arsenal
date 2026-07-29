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
  const tunnelPath = managedTunnelPath(options.stateDir);
  const record = await readJsonFile<ManagedTunnelRecord>(tunnelPath);
  const recordProvider: TunnelProvider = record?.provider ?? "cloudflare";
  if (record && Number.isInteger(record.pid) && record.pid > 0 && record.port === options.port
    && recordProvider === options.provider
    && tunnelUrlMatchesProvider(record.url, options.provider, options.ngrokUrl)) {
    if (processIdentityMatches(record.pid, record)) return record;

    if (!record.processPath || !record.processStartedAt) {
      const identity = getProcessIdentity(record.pid);
      if (identity && tunnelExecutableNamePattern(options.provider).test(identity.processPath)) {
        const migrated = { ...record, ...identity, provider: options.provider };
        await atomicWriteJson(tunnelPath, migrated);
        return migrated;
      }
    }
  }
  await unlink(tunnelPath).catch(() => undefined);
  return undefined;
}

export async function ensureManagedTunnel(options: ManagedTunnelOptions): Promise<ManagedTunnelResult> {
  const existing = await readManagedTunnel(options);
  if (existing) return { record: existing, created: false };

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
  const tunnel = await readManagedTunnel(options);
  if (!tunnel) return false;
  if (!processIdentityMatches(tunnel.pid, tunnel)) {
    await unlink(managedTunnelPath(options.stateDir)).catch(() => undefined);
    return false;
  }
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill.exe", ["/PID", String(tunnel.pid), "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      process.kill(tunnel.pid, "SIGTERM");
    }
  } catch {
    if (isProcessRunning(tunnel.pid)) {
      throw new Error(`Could not stop ${tunnelProviderLabel(options.provider)} tunnel process ${tunnel.pid}.`);
    }
  } finally {
    await unlink(managedTunnelPath(options.stateDir)).catch(() => undefined);
  }
  return true;
}
