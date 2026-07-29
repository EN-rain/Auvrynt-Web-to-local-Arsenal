import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  getProcessIdentity,
  isProcessRunning,
  processIdentityMatches,
  type InstanceLockRecord,
  type IntegrationKey,
} from "../background-lifecycle.js";
import { httpUrl, localProbeHost } from "./runtime-support.js";

export async function acquireInstanceLock(
  stateDir: string,
  host: string,
  port: number,
  profiles?: IntegrationKey[],
  launchRoot?: string,
): Promise<{ release: () => Promise<void> }> {
  const lockPath = join(stateDir, "server.lock");
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await chmod(stateDir, 0o700).catch(() => undefined);
  const identity = getProcessIdentity(process.pid);
  if (!identity) throw new Error("Could not identify the Auvrynt server process.");

  for (let attempt = 0; attempt < 3; attempt++) {
    const instanceId = randomBytes(16).toString("hex");
    try {
      const handle = await open(lockPath, "wx", 0o600);
      const record: InstanceLockRecord = {
        instanceId,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        host,
        port,
        profiles,
        launchRoot,
        controlToken: process.env.AUVRYNT_CONTROL_TOKEN,
        ...identity,
      };
      try {
        await handle.writeFile(JSON.stringify(record));
        await handle.sync();
      } finally {
        await handle.close();
      }
      return { release: () => releaseInstanceLock(lockPath, instanceId) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

      let lock: Partial<InstanceLockRecord> | undefined;
      try {
        lock = JSON.parse(await readFile(lockPath, "utf8")) as Partial<InstanceLockRecord>;
      } catch {
        // A partially written or malformed lock is stale unless another contender replaces it first.
      }

      const ownerPid = Number.isInteger(lock?.pid) && Number(lock?.pid) > 0
        ? Number(lock?.pid)
        : undefined;
      const hasIdentity = Boolean(lock?.processPath && lock?.processStartedAt);
      const ownerMatches = ownerPid
        ? hasIdentity
          ? processIdentityMatches(ownerPid, lock ?? {})
          : isProcessRunning(ownerPid)
        : false;
      if (ownerPid && ownerMatches) {
        const lockHost = typeof lock?.host === "string" ? lock.host : host;
        const candidateLockPort = lock?.port;
        const lockPort = Number.isInteger(candidateLockPort)
          ? Number(candidateLockPort)
          : port;
        const healthy = await isAuvryntHealthReachable(lockHost, lockPort);
        const lockStartedAt = lock?.startedAt;
        const lockAgeMs = typeof lockStartedAt === "string"
          ? Date.now() - Date.parse(lockStartedAt)
          : Number.POSITIVE_INFINITY;
        if (
          healthy
          || (Number.isFinite(lockAgeMs) && lockAgeMs >= 0 && lockAgeMs < 30_000)
        ) {
          throw new Error(
            `Auvrynt is already running (PID ${ownerPid}). Stop that instance before starting another.`,
          );
        }
      }

      await unlink(lockPath).catch((unlinkError) => {
        if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") {
          throw unlinkError;
        }
      });
    }
  }

  throw new Error(
    "Could not acquire the Auvrynt server lock after clearing stale lock state.",
  );
}

export async function isAuvryntHealthReachable(
  host: string,
  port: number,
): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  if (!host || /[\/@?#]/.test(host)) return false;
  try {
    const response = await fetch(httpUrl(localProbeHost(host), port, "/healthz"), {
      signal: AbortSignal.timeout(750),
    });
    if (!response.ok) return false;
    const body = await response.json().catch(() => undefined) as
      | { ok?: unknown; name?: unknown }
      | undefined;
    return body?.ok === true && body?.name === "auvrynt";
  } catch {
    return false;
  }
}

async function releaseInstanceLock(
  lockPath: string,
  instanceId: string,
): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  let current: { instanceId?: unknown };
  try {
    current = JSON.parse(raw) as { instanceId?: unknown };
  } catch {
    // Do not delete a lock whose ownership cannot be proven.
    return;
  }
  if (current.instanceId !== instanceId) return;
  await unlink(lockPath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
}
